"""Curve-fit + heuristic-pick CRF search algorithm.

Replaces the strict-pass/fail bisection (``find_optimal_crf_two_phase``)
with a probe-fit-pick pipeline:

1. Probe a small set of fixed CRFs (default 3 evenly-spaced across the
   search range, adaptive up to 5 if data looks weird).
2. Drop saturated probes (adjacent CRFs giving same VMAF — encoder
   ceiling case).
3. Fit three curve models on the (CRF, p_low) data: piecewise linear
   (default), global linear (least-squares), logarithmic (captures the
   high-CRF cliff). All three are computed and logged so we can
   validate the default choice on real-world data.
4. Compute three heuristic picks per curve: TARGET (CRF where p_low
   hits the user's target threshold), KNEE (where the slope steepens
   most — last "good" step before quality cliff), BUDGET (highest CRF
   whose interpolated p_low stays within tolerance of target). Nine
   total picks; default is KNEE on PIECEWISE.
5. Verify-encode at the chosen CRF (cache hit if already a probe) so
   the returned ``CrfSearchResult`` carries a real measured summary
   for downstream logging + cross-pair learning.

Why this replaces bisection:

- **Determinism**: same content + same probe set always picks the
  same CRF. Bisection's pass/fail-driven walk can flip across runs
  when measurements oscillate at the strict-target boundary.
- **No noise amplification**: the curve fit averages noise across
  multiple CRF probes; a single noisy probe shifts the picked CRF by
  fractions of a step rather than several CRFs.
- **Soft target**: ``--crf-search-target-vmaf-low`` becomes a guide rather than
  a hard cutoff. We can land near it with no strict pass/fail flag,
  side-stepping the "everything fails because the reference encode
  caps achievable VMAF" cascade-and-bail failure mode.

Entry point: :func:`find_crf_via_curve_fit`. Pure functions for unit
testing live above it.
"""

from __future__ import annotations

import contextlib
import math
import re
import time
from dataclasses import dataclass, field, replace
from typing import Callable, Generator, Literal

from clipper.ytc_logger import Subsystem, make_subsystem_logger

from .search import _build_trial_from_measurement
from .types import (
    CrfSearchResult,
    CrfSearchTarget,
    CrfSearchTrial,
    TrialMeasurement,
    get_low_percentile_value,
)

logger = make_subsystem_logger(Subsystem.CRF_SEARCH)

# Algorithm version: bumped manually whenever curve-fit logic changes in
# a way that would meaningfully shift outcomes for the same input data.
# The run cache uses this as part of the freshness gate — a prior run
# tagged with an older version is ignored for cache reuse (its picks
# may be wrong under the new logic) but still usable for auto-delta
# rendering with a stale-version flag.
#
# Bump triggers (any of):
# - Initial probe selection (count, spacing, sentinel values).
# - Adaptive refit triggers (boundary expansion, saturation drop,
#   sparse-coverage thresholds).
# - Pick-heuristic logic (target / knee / budget computation).
# - Saturation drop policy.
# - Default curve / heuristic pair.
#
# Don't bump for: log message tweaks, chart rendering changes,
# refactors that don't alter outcomes, new heuristics added but not
# made default.
ALGORITHM_VERSION: int = 1


# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------

# Initial probe count. Three evenly-spaced probes give us two segments
# for piecewise linear and the minimum data needed for knee detection.
DEFAULT_INITIAL_PROBE_COUNT: int = 3

# Maximum probe count. Adaptive refit can add probes up to this cap when
# initial data looks weird (saturation, sparse coverage, knee at
# boundary). 5 is enough wall time (~50s @ 10s/probe) without sacrificing
# the curve-fit's "fast + simple" character.
DEFAULT_MAX_PROBE_COUNT: int = 5

# Two adjacent probes' VMAF measurements within this tolerance are
# treated as the same — we drop the lower CRF since it gives equivalent
# quality at higher cost. With maxrate disabled in trials this should
# rarely trigger; left in as a safety net for content where the
# encoder's quality-vs-CRF curve has a flat region.
DEFAULT_SATURATION_EPSILON: float = 0.05

# A segment slope must be more negative than the previous segment's by
# at least this many VMAF points per CRF for us to call it a "knee".
# Below this, we treat the curve as smooth (no clear cliff) and fall
# back to the TARGET heuristic.
DEFAULT_KNEE_STEEPENING_THRESHOLD: float = 0.3

# BUDGET heuristic accepts CRFs whose interpolated p_low stays within
# this many VMAF points below the user's target. Reflects "near enough"
# rather than strict pass/fail.
DEFAULT_BUDGET_TOLERANCE: float = 1.0

# When the largest CRF gap between adjacent valid probes exceeds this,
# the curve is too sparse to fit reliably across that range and we add
# a refit probe at the gap's midpoint.
DEFAULT_REFIT_GAP_THRESHOLD: int = 8


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


CurveModelName = Literal["piecewise", "linear", "log"]
HeuristicName = Literal["target", "knee", "budget"]


@dataclass(frozen=True)
class CurveFit:
    """All three curve models fit to the same (crf, p_low) probe data.

    Each model exposes an ``evaluate(crf) -> float`` callable so the
    heuristics can interpolate without knowing which model produced the
    callable. ``valid_probes`` is the saturation-filtered probe list the
    fit was computed from; downstream heuristics use it for piecewise
    walks and for knee detection.
    """

    valid_probes: list[CrfSearchTrial]
    low_pct: int
    piecewise_eval: Callable[[int], float]
    linear_slope: float
    linear_intercept: float
    log_slope: float
    log_intercept: float
    crf_max: int  # for the log model's reflection point


@dataclass(frozen=True)
class HeuristicPicks:
    """The 3-x-3 grid of (curve, heuristic) → picked CRF.

    None for entries where the heuristic can't produce a pick (e.g.
    knee on <3 valid probes; target outside the CRF range).
    """

    by_curve_and_heuristic: dict[CurveModelName, dict[HeuristicName, int | None]]
    chosen_curve: CurveModelName
    chosen_heuristic: HeuristicName
    chosen_crf: int


@dataclass(frozen=True)
class CurveFitSearchResult:
    """Curve-fit specific result data attached to ``CrfSearchResult``.

    Exposed so ``orchestrator.py`` can format it into log lines + the
    JSONL metadata file. Doesn't replace ``CrfSearchResult`` — coexists.
    """

    fit: CurveFit
    picks: HeuristicPicks
    refit_reasons: list[str] = field(default_factory=list)
    compressibility: CompressibilityScore | None = None


# ---------------------------------------------------------------------------
# Probe selection
# ---------------------------------------------------------------------------


def select_initial_probe_crfs(
    *,
    crf_min: int,
    crf_max: int,
    n_probes: int = DEFAULT_INITIAL_PROBE_COUNT,
) -> list[int]:
    """Evenly-spaced probe CRFs across ``[crf_min, crf_max]``.

    Always includes the endpoints so the curve fit has data at the
    range edges. Middle probes split the interval evenly. Deduplicates
    (e.g. n_probes=3 with crf_min=crf_max returns ``[crf_min]``).
    """
    if n_probes <= 0 or crf_max < crf_min:
        return []
    if n_probes == 1 or crf_min == crf_max:
        return [crf_min]
    span = crf_max - crf_min
    step = span / (n_probes - 1)
    raw = [round(crf_min + step * i) for i in range(n_probes)]
    # Dedup while preserving order.
    seen: set[int] = set()
    result: list[int] = []
    for crf in raw:
        if crf not in seen:
            seen.add(crf)
            result.append(crf)
    return result


# ---------------------------------------------------------------------------
# Saturation handling
# ---------------------------------------------------------------------------


def drop_saturated_probes(
    probes: list[CrfSearchTrial],
    *,
    low_pct: int,
    epsilon: float = DEFAULT_SATURATION_EPSILON,
) -> list[CrfSearchTrial]:
    """Remove probes whose VMAF is within ``epsilon`` of an adjacent
    probe's at a *lower* CRF (same quality at higher cost).

    Probes are first sorted by CRF ascending. Walking pairs, if the
    higher-CRF probe's p_low is within epsilon of the lower-CRF probe's
    p_low, the lower-CRF probe is saturated (the encoder gives equivalent
    quality at the higher CRF, so the lower CRF is wasted compression
    headroom). Drop the lower-CRF one.

    With ``--target-max-bitrate`` disabled in trials this rarely
    triggers — the saturation root cause was the bitrate cap, not
    encoder behavior. Left as a safety net for content with intrinsic
    encoder plateaus.
    """
    if len(probes) < 2:
        return list(probes)
    sorted_probes = sorted(probes, key=lambda p: p.crf)
    keep: list[CrfSearchTrial] = []
    for i, probe in enumerate(sorted_probes):
        # Compare to the next-higher-CRF probe (if any). If they're
        # within epsilon, drop THIS probe (lower CRF, same quality).
        if i + 1 < len(sorted_probes):
            this_p = get_low_percentile_value(probe.summary, low_pct)
            next_p = get_low_percentile_value(sorted_probes[i + 1].summary, low_pct)
            if abs(next_p - this_p) <= epsilon:
                continue
        keep.append(probe)
    return keep


# ---------------------------------------------------------------------------
# Curve fits
# ---------------------------------------------------------------------------


def _piecewise_evaluator(
    probes: list[CrfSearchTrial],
    low_pct: int,
) -> Callable[[int], float]:
    """Return a function that linearly interpolates p_low at any CRF
    using the probes' (crf, p_low) data points.

    Probes outside the [min_probe_crf, max_probe_crf] range get clamped
    to the nearest endpoint (no extrapolation — risky on small sample).
    Within range: walk segments to find the bracketing pair, linearly
    interpolate.
    """
    sorted_probes = sorted(probes, key=lambda p: p.crf)
    points = [(p.crf, get_low_percentile_value(p.summary, low_pct)) for p in sorted_probes]

    def evaluate(crf: int) -> float:
        if not points:
            return float("nan")
        if len(points) == 1:
            return points[0][1]
        if crf <= points[0][0]:
            return points[0][1]
        if crf >= points[-1][0]:
            return points[-1][1]
        for (lo_crf, lo_v), (hi_crf, hi_v) in zip(points, points[1:]):
            if lo_crf <= crf <= hi_crf:
                # Linear interpolation within segment.
                if hi_crf == lo_crf:
                    return lo_v
                t = (crf - lo_crf) / (hi_crf - lo_crf)
                return lo_v + t * (hi_v - lo_v)
        return points[-1][1]  # unreachable; guards against rounding edge

    return evaluate


def _fit_global_linear(
    probes: list[CrfSearchTrial],
    low_pct: int,
) -> tuple[float, float]:
    """Ordinary least-squares fit ``p_low = slope * crf + intercept``.

    Returns ``(0.0, p_low)`` when there's only one valid probe — flat
    line at the measured value. Returns ``(0.0, 0.0)`` for empty input.
    """
    if not probes:
        return 0.0, 0.0
    if len(probes) == 1:
        return 0.0, get_low_percentile_value(probes[0].summary, low_pct)
    n = len(probes)
    xs = [float(p.crf) for p in probes]
    ys = [get_low_percentile_value(p.summary, low_pct) for p in probes]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0.0:
        return 0.0, mean_y
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


def _fit_log(
    probes: list[CrfSearchTrial],
    low_pct: int,
    *,
    crf_max: int,
) -> tuple[float, float]:
    """Log fit: ``p_low = slope * log(crf_max - crf + 1) + intercept``.

    The reflection ``crf_max - crf + 1`` makes the input strictly
    positive across the search range and grows as CRF *decreases* —
    so as CRF rises (lower quality), log(reflection) shrinks, and a
    positive slope produces decreasing VMAF. This shape captures the
    "cliff at high CRF" behavior typical of VMAF curves: the curve
    flattens at low CRF (saturation) and drops sharply near the max.

    Returns ``(0.0, p_low)`` for one probe, ``(0.0, 0.0)`` for empty.
    """
    if not probes:
        return 0.0, 0.0
    if len(probes) == 1:
        return 0.0, get_low_percentile_value(probes[0].summary, low_pct)
    xs = [math.log(crf_max - p.crf + 1) for p in probes]
    ys = [get_low_percentile_value(p.summary, low_pct) for p in probes]
    n = len(probes)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    if den == 0.0:
        return 0.0, mean_y
    slope = num / den
    intercept = mean_y - slope * mean_x
    return slope, intercept


def fit_curves(
    probes: list[CrfSearchTrial],
    *,
    target: CrfSearchTarget,
) -> CurveFit:
    """Fit all three curve models to the saturation-filtered probes.

    Pure function: takes already-filtered probes and returns the fit
    callables + parameters. Caller chooses whether to refit / which
    heuristic to apply.
    """
    low_pct = target.target_vmaf_low_pct
    valid = drop_saturated_probes(probes, low_pct=low_pct)
    piecewise_eval = _piecewise_evaluator(valid, low_pct)
    linear_slope, linear_intercept = _fit_global_linear(valid, low_pct)
    log_slope, log_intercept = _fit_log(valid, low_pct, crf_max=target.crf_max)
    return CurveFit(
        valid_probes=valid,
        low_pct=low_pct,
        piecewise_eval=piecewise_eval,
        linear_slope=linear_slope,
        linear_intercept=linear_intercept,
        log_slope=log_slope,
        log_intercept=log_intercept,
        crf_max=target.crf_max,
    )


def evaluate_curve(
    fit: CurveFit,
    *,
    crf: int,
    model: CurveModelName,
) -> float:
    """Predict p_low at ``crf`` using the named curve model."""
    if model == "piecewise":
        return fit.piecewise_eval(crf)
    if model == "linear":
        return fit.linear_slope * crf + fit.linear_intercept
    if model == "log":
        # Reflection mirrors _fit_log; keep the +1 guard.
        return fit.log_slope * math.log(fit.crf_max - crf + 1) + fit.log_intercept
    return float("nan")


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------


def _solve_for_target_crf(
    fit: CurveFit,
    *,
    model: CurveModelName,
    target_low: float,
    crf_min: int,
    crf_max: int,
) -> int | None:
    """Search the integer CRF range for the largest CRF whose predicted
    p_low is at or above ``target_low``.

    Walks from crf_max down to crf_min — the first CRF whose model
    prediction clears target is the pick. Returns None if no CRF in
    range clears (target above the curve everywhere).
    """
    for crf in range(crf_max, crf_min - 1, -1):
        if evaluate_curve(fit, crf=crf, model=model) >= target_low:
            return crf
    return None


def pick_target(
    fit: CurveFit,
    *,
    target: CrfSearchTarget,
    model: CurveModelName = "piecewise",
) -> int | None:
    """Highest CRF whose model-predicted p_low >= target.target_vmaf_low.

    The "soft target" heuristic: bias toward the user's quality
    threshold without making it a strict pass/fail. Returns None when
    the curve is entirely below target across the range — caller
    should fall back to the highest probed CRF or some other policy.
    """
    return _solve_for_target_crf(
        fit,
        model=model,
        target_low=target.target_vmaf_low,
        crf_min=target.crf_min,
        crf_max=target.crf_max,
    )


def pick_budget(
    fit: CurveFit,
    *,
    target: CrfSearchTarget,
    tolerance: float = DEFAULT_BUDGET_TOLERANCE,
    model: CurveModelName = "piecewise",
) -> int | None:
    """Highest CRF whose model-predicted p_low >= (target_low - tolerance).

    The "near enough" heuristic: accept slightly-below-target if it lets
    us pick a more aggressive CRF. Useful when the strict target is
    unreachable (reference encode quality ceiling case) but a CRF a few
    points lower than target is acceptable.
    """
    return _solve_for_target_crf(
        fit,
        model=model,
        target_low=target.target_vmaf_low - tolerance,
        crf_min=target.crf_min,
        crf_max=target.crf_max,
    )


def pick_knee(
    fit: CurveFit,
    *,
    target: CrfSearchTarget,
    steepening_threshold: float = DEFAULT_KNEE_STEEPENING_THRESHOLD,
) -> int | None:
    """Find the CRF just before the curve's slope steepens most.

    Walks segment slopes between consecutive probes. The "knee" is the
    boundary between adjacent segments where slope_higher_crf is more
    negative than slope_lower_crf by at least ``steepening_threshold``
    VMAF points per CRF. Picks the CRF at the higher-CRF end of the
    segment BEFORE the steepening — i.e. the last CRF where the slope
    was still acceptable.

    Returns None when:
    - <3 probes (can't compute slope deltas across two segments)
    - No segment-pair shows the threshold steepening (curve is smooth)

    Caller should fall back to TARGET when knee returns None.

    ``target`` is accepted for API symmetry with the other heuristics
    (callers pass the same target to all three) but isn't currently
    used — knee detection is target-independent. Kept in the signature
    so we can add target-aware tie-breaking later without an API break.
    """
    _ = target  # signature-only; see docstring
    probes = fit.valid_probes
    if len(probes) < 3:
        return None
    sorted_probes = sorted(probes, key=lambda p: p.crf)
    points = [
        (p.crf, get_low_percentile_value(p.summary, fit.low_pct))
        for p in sorted_probes
    ]
    # Compute per-segment slopes (VMAF per CRF unit, sign carried).
    slopes: list[tuple[int, int, float]] = []  # (lo_crf, hi_crf, slope)
    for (lo_crf, lo_v), (hi_crf, hi_v) in zip(points, points[1:]):
        if hi_crf == lo_crf:
            continue
        slope = (hi_v - lo_v) / (hi_crf - lo_crf)
        slopes.append((lo_crf, hi_crf, slope))
    if len(slopes) < 2:
        return None
    # Find the segment-boundary where slope steepens (becomes more
    # negative) most. Threshold filters out smooth curves where every
    # segment's slope is similar.
    best_steepening = 0.0
    best_knee_crf: int | None = None
    for prev_seg, next_seg in zip(slopes, slopes[1:]):
        # Steepening = slope of next segment is more negative than the
        # previous segment's. Negative delta = more steepening.
        slope_a = prev_seg[2]
        a_hi = prev_seg[1]
        slope_b = next_seg[2]
        delta = slope_b - slope_a
        if delta < -steepening_threshold and delta < best_steepening:
            best_steepening = delta
            # Knee sits at the boundary between the two segments
            # (a_hi == b_lo). "Last good step" CRF is a_hi.
            best_knee_crf = a_hi
    return best_knee_crf


# ---------------------------------------------------------------------------
# Adaptive refit
# ---------------------------------------------------------------------------


def needs_extra_probe(
    probes: list[CrfSearchTrial],
    *,
    target: CrfSearchTarget,
    refit_gap_threshold: int = DEFAULT_REFIT_GAP_THRESHOLD,
) -> tuple[int | None, str]:
    """Decide whether an additional probe would improve the fit.

    Returns ``(crf_to_probe, reason)`` or ``(None, reason)`` when no
    extra probe is needed.

    Trigger conditions, checked in order:
    1. Saturation collapse: <2 probes remain after dropping saturated.
       Pick the midpoint of the original range.
    2. Unbounded above: every valid probe's p_low is at or above the
       user's target_vmaf_low. The curve hasn't crossed the target
       within the probed range, so the target heuristic is forced to
       pick the highest probe — leaving compression headroom unused.
       Probe at ``min(crf_absolute_max, max_probed + 6)`` to push
       toward a failing CRF that bounds the curve.
    3. Sparse coverage: largest CRF gap between adjacent valid probes
       exceeds ``refit_gap_threshold``. Probe at the gap midpoint.
    4. Knee at boundary: the knee detection lands on the lowest- or
       highest-CRF probe. Suggests the real knee is outside the
       probed range (or on top of an endpoint). Add a probe between
       the boundary and its neighbor to disambiguate.

    Otherwise returns None.
    """
    valid = drop_saturated_probes(probes, low_pct=target.target_vmaf_low_pct)
    if len(valid) < 2:
        midpoint = (target.crf_min + target.crf_max) // 2
        return midpoint, "saturation collapsed probes; need another data point"
    sorted_valid = sorted(valid, key=lambda p: p.crf)
    probed_crfs = {p.crf for p in probes}
    # Unbounded above: no probe sits below the user's target. The curve
    # hasn't crossed the target threshold, so target heuristic would
    # pick the highest probe (leaving compression headroom unused).
    # Push past max_probed toward crf_absolute_max to find a failing CRF.
    target_low = target.target_vmaf_low
    low_pct = target.target_vmaf_low_pct
    valid_lows = [
        get_low_percentile_value(p.summary, low_pct) for p in sorted_valid
    ]
    has_below_target = any(v < target_low for v in valid_lows)
    if not has_below_target:
        max_probed = sorted_valid[-1].crf
        # Step size: roughly the largest existing gap, but at least 4
        # CRFs so we don't crawl. Capped so we don't shoot past the
        # absolute hard ceiling.
        step = max(4, max(
            (hi.crf - lo.crf for lo, hi in zip(sorted_valid, sorted_valid[1:])),
            default=4,
        ) // 2)
        candidate = min(target.crf_absolute_max, max_probed + step)
        if candidate > max_probed and candidate not in probed_crfs:
            return (
                candidate,
                f"all valid probes pass target_vmaf_low={target_low}; "
                f"probing crf={candidate} (max_probed={max_probed}) to bound "
                f"the curve past target",
            )
    # Sparse coverage: walk pairs, find biggest gap.
    biggest_gap = 0
    biggest_gap_midpoint = -1
    for lo, hi in zip(sorted_valid, sorted_valid[1:]):
        gap = hi.crf - lo.crf
        if gap > biggest_gap:
            biggest_gap = gap
            biggest_gap_midpoint = (lo.crf + hi.crf) // 2
    if biggest_gap > refit_gap_threshold and biggest_gap_midpoint not in probed_crfs:
        return (
            biggest_gap_midpoint,
            f"largest gap {biggest_gap} between probes exceeds threshold "
            f"{refit_gap_threshold}; probing midpoint",
        )
    # Knee at boundary: only worth checking when knee would be returned
    # at all. We check by re-running pick_knee on a quick fit.
    if len(sorted_valid) >= 3:
        fit = fit_curves(valid, target=target)
        knee = pick_knee(fit, target=target)
        if knee is not None:
            crfs_sorted = [p.crf for p in sorted_valid]
            if knee == crfs_sorted[0] or knee == crfs_sorted[-1]:
                # Knee at boundary — probe outside-the-pair to disambiguate.
                if knee == crfs_sorted[0]:
                    # Knee at lowest probe — push downward.
                    candidate = max(target.crf_min, knee - max(1, biggest_gap // 2))
                else:
                    candidate = min(target.crf_max, knee + max(1, biggest_gap // 2))
                if candidate not in probed_crfs:
                    return (
                        candidate,
                        f"knee detected at boundary crf={knee}; probing crf={candidate}",
                    )
    return None, ""


# ---------------------------------------------------------------------------
# Compressibility score
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CompressibilityScore:
    """How much bitrate the encoder saves per VMAF point sacrificed.

    Computed by walking adjacent valid probes and dividing the
    bitrate drop by the VMAF drop within each segment. Higher values
    mean each VMAF point you give up buys more compression — i.e. the
    content is *more compressible*. Lower values mean the encoder is
    near its limit: each VMAF point costs only a little bitrate to
    keep, so giving up quality doesn't save much.

    ``segments`` is the per-segment list of (lo_crf, hi_crf, kbps_per_vmaf)
    tuples for inspection / charting. ``mean_kbps_per_vmaf`` averages
    across all segments. ``at_chosen_crf_kbps_per_vmaf`` is the score
    of the segment containing the picked CRF — a local measure of
    "how compressible is this content right where we chose to encode".
    """

    segments: list[tuple[int, int, float]]
    mean_kbps_per_vmaf: float
    at_chosen_crf_kbps_per_vmaf: float | None


def compute_compressibility(
    fit: CurveFit,
    *,
    chosen_crf: int,
) -> CompressibilityScore:
    """Compare the bitrate↔CRF curve to the VMAF↔CRF curve.

    For each adjacent (probe_lo, probe_hi) pair where ``probe_hi``
    has more compression (higher CRF, lower bitrate, lower VMAF):

        kbps_per_vmaf = (kbps_lo - kbps_hi) / (vmaf_lo - vmaf_hi)

    Skips segments where the VMAF delta is tiny (encoder cliff /
    saturation regions) — the ratio is undefined / explodes there.
    Returns NaN-safe defaults when fewer than 2 probes have bitrates.
    """
    sorted_probes = sorted(fit.valid_probes, key=lambda p: p.crf)
    rated = [p for p in sorted_probes if p.bitrate_kbps > 0]
    segments: list[tuple[int, int, float]] = []
    for lo, hi in zip(rated, rated[1:]):
        vmaf_lo = get_low_percentile_value(lo.summary, fit.low_pct)
        vmaf_hi = get_low_percentile_value(hi.summary, fit.low_pct)
        vmaf_drop = vmaf_lo - vmaf_hi
        kbps_drop = lo.bitrate_kbps - hi.bitrate_kbps
        # Skip segments where VMAF didn't move (within 0.1) so
        # division stays well-defined; same threshold as the
        # saturation-drop epsilon scaled up for noise tolerance.
        if vmaf_drop < 0.1:
            continue
        segments.append((lo.crf, hi.crf, kbps_drop / vmaf_drop))
    mean_score = (
        sum(s[2] for s in segments) / len(segments) if segments else 0.0
    )
    at_chosen: float | None = None
    for lo_crf, hi_crf, score in segments:
        if lo_crf <= chosen_crf <= hi_crf:
            at_chosen = score
            break
    return CompressibilityScore(
        segments=segments,
        mean_kbps_per_vmaf=mean_score,
        at_chosen_crf_kbps_per_vmaf=at_chosen,
    )


# ---------------------------------------------------------------------------
# ASCII curve rendering (for log visibility)
# ---------------------------------------------------------------------------


# SGR foreground-color codes that plotille emits (via the ``lc=`` arg)
# mapped to the rich markup tags our logger renders correctly. Plotille
# emits raw ANSI; the rich-aware logger wraps each message with
# ``[color]…`` markup and runs ``markup=True``, which then tries to
# parse plotille's ``\x1b[33m`` as a markup tag and falls over showing
# the literal ``[33m``. Translating ahead lets the logger render
# colors correctly. Reset (``[0m``) maps to rich's generic close ``[/]``
# which closes the most-recent open tag.
_ANSI_SGR_RE = re.compile(r"\x1b\[(\d+)m")
_ANSI_SGR_TO_RICH: dict[str, str] = {
    "0": "/",
    "30": "black",
    "31": "red",
    "32": "green",
    "33": "yellow",
    "34": "blue",
    "35": "magenta",
    "36": "cyan",
    "37": "white",
    # Bright variants (codes 90-97). Standard 30-37 codes render to
    # the terminal's "default" 8-color palette, which on most
    # themes leaves "yellow" looking olive/khaki and "blue" looking
    # nearly invisible. Bright codes map to rich's bright_X names
    # which render vivid versions, so the chart markers + legend
    # color terms actually look like what their names say.
    "90": "bright_black",
    "91": "bright_red",
    "92": "bright_green",
    "93": "bright_yellow",
    "94": "bright_blue",
    "95": "bright_magenta",
    "96": "bright_cyan",
    "97": "bright_white",
}


def _ansi_to_rich_markup(text: str) -> str:
    """Replace plotille's ANSI SGR codes with rich markup tags."""
    def replace(match: re.Match[str]) -> str:
        code = match.group(1)
        rich_name = _ANSI_SGR_TO_RICH.get(code)
        return f"[{rich_name}]" if rich_name else ""

    return _ANSI_SGR_RE.sub(replace, text)


@contextlib.contextmanager
def _plotille_force_color() -> Generator[None, None, None]:
    """Force plotille to emit ANSI colors regardless of stdout TTY state.

    plotille's ``color()`` helper silently returns the raw text when
    ``sys.stdout`` isn't a TTY (see plotille/_colors.py). The curve
    chart here is captured as a string and routed through the logger
    pipeline — plotille never writes to stdout, but its tty check
    still trips off the real stdout's status and drops every color
    escape. Result: ``with_colors=True`` produces zero ANSI codes,
    :func:`_ansi_to_rich_markup` has nothing to translate, and the
    chart renders monotone in the outer log-level color.

    Setting ``FORCE_COLOR=1`` for the duration of ``Figure.show()``
    bypasses the tty check (plotille honors FORCE_COLOR explicitly).
    Restoring the prior value on exit means an upstream caller's
    choice — e.g. ``FORCE_COLOR=0`` for a test that captures plain
    text — is respected outside this rendering.
    """
    import os
    prev = os.environ.get("FORCE_COLOR")
    os.environ["FORCE_COLOR"] = "1"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("FORCE_COLOR", None)
        else:
            os.environ["FORCE_COLOR"] = prev


def render_curve_ascii(  # noqa: PLR0912
    fit: CurveFit,
    *,
    target: CrfSearchTarget,
    chosen_crf: int,
    baseline: CrfSearchTrial | None = None,
    reference: CrfSearchTrial | None = None,
    width: int = 60,
    vmaf_height: int = 12,
    bitrate_height: int = 9,
) -> list[str]:
    """Return log-friendly lines visualizing the curve fit + bitrate curve.

    Two stacked plotille (braille) sub-charts:

    1. **VMAF** vs CRF — the user-target percentile (``low_pct``) plotted
       across all valid probes, with a horizontal target reference line
       and a vertical chosen-CRF marker. Probes appear as scatter dots,
       the piecewise interpolation as a connected curve.
    2. **Bitrate** vs CRF (kbps) — the predicted final-encode bitrate
       at each probe, with the same chosen-CRF marker. Lets operators
       see size and quality on the same axis without parsing JSONL.

    Both charts use the same X-axis range (``[crf_min, crf_max]``).
    Plotille's braille rendering gives ~8x the resolution per cell of
    plain ASCII, so the curve looks smooth even with 3-5 probes. Color
    (cyan curve, yellow probes, red target line, green chosen CRF) is
    emitted as ANSI when terminals support it; rich-aware loggers pass
    the codes through.

    Returns an empty list when there's no probe data to draw.
    """
    # Lazy-import plotille so test environments without the dependency
    # don't break at import time. Plotille is a runtime dep declared in
    # pyproject.toml; it ships in the standard install.
    import plotille

    if not fit.valid_probes:
        return []
    sorted_probes = sorted(fit.valid_probes, key=lambda p: p.crf)
    crfs = [float(p.crf) for p in sorted_probes]
    vmafs = [
        float(get_low_percentile_value(p.summary, fit.low_pct)) for p in sorted_probes
    ]
    bitrates = [float(p.bitrate_kbps) for p in sorted_probes]

    # X-range: span the search's configured ``[crf_min, crf_max]`` plus
    # any marker (reference / baseline / chosen) that landed outside
    # that band. Previously we extended to ``crf_absolute_max`` (51) so
    # the chart had a fixed frame, but on narrow searches that left
    # half the width empty. The configured search range is the natural
    # visual reference and packs the chart densely with the actual
    # data the operator cares about.
    crf_lo = target.crf_min
    crf_hi = target.crf_max
    crf_lo = min(crf_lo, chosen_crf)
    crf_hi = max(crf_hi, chosen_crf)
    if reference is not None:
        crf_lo = min(crf_lo, reference.crf)
        crf_hi = max(crf_hi, reference.crf)
    if baseline is not None:
        crf_lo = min(crf_lo, baseline.crf)
        crf_hi = max(crf_hi, baseline.crf)
    if crf_hi <= crf_lo:
        return []

    def _replace_x_axis_labels(chart: str) -> str:
        """Replace plotille's auto-spaced x-axis label line with our
        own integer-CRF ticks every 2 CRFs across the full plot width.

        Plotille auto-picks ~5 evenly-spaced ticks at fractional
        positions which (a) round oddly on an integer-only axis and
        (b) leave too few labels to read precise CRF values. We want
        every-other CRF labeled (16, 18, 20, ...) so operators can
        eyeball where probes / markers / target line sit precisely.

        Found by anchoring to the x-axis baseline (line ending in
        ``(crf)`` / ``(x)``), the label line is the line immediately
        following. We rebuild it from scratch using the same column
        alignment as plotille's chart content area (everything after
        ``"| "`` on the label line).
        """
        chart_lines = chart.splitlines()
        out_lines: list[str] = []
        for prev, raw_line in zip(["", *chart_lines], chart_lines):
            if "(crf)" in prev or "(x)" in prev:
                out_lines.append(_build_x_label_line(raw_line))
            else:
                out_lines.append(raw_line)
        return "\n".join(out_lines)

    def _build_x_label_line(original: str) -> str:
        """Build the x-axis label line: integer CRF labels every 2 CRFs
        evenly distributed across the chart's plot area, preserving
        the original line's prefix so the labels still align with
        plotille's tick marks."""
        pipe_idx = original.find("|")
        if pipe_idx < 0:
            return original
        # Plot area starts one column after "| ". Plot width matches
        # the figure's ``width`` parameter (we passed `width` above).
        content_start = pipe_idx + 2
        # Build labels every 2 CRFs; always include both endpoints.
        candidates: list[int] = list(range(crf_lo, crf_hi + 1, 2))
        if not candidates or candidates[-1] != crf_hi:
            candidates.append(crf_hi)
        if candidates[0] != crf_lo:
            candidates.insert(0, crf_lo)
        span = max(1, crf_hi - crf_lo)
        out_chars = list(original)
        # Pad ``out_chars`` so we can write past the original length.
        max_col_needed = content_start + width + 4
        while len(out_chars) < max_col_needed:
            out_chars.append(" ")
        # Clear the existing label area before writing custom labels.
        for i in range(content_start, max_col_needed):
            out_chars[i] = " "
        last_end = -1
        for crf in candidates:
            col = content_start + round((crf - crf_lo) / span * (width - 1))
            label = str(crf)
            # Skip overlapping labels to keep the line readable.
            if col <= last_end + 1:
                continue
            for i, ch in enumerate(label):
                pos = col + i
                if 0 <= pos < len(out_chars):
                    out_chars[pos] = ch
            last_end = col + len(label) - 1
        return "".join(out_chars).rstrip()

    lines: list[str] = []

    # ---- VMAF sub-chart -----------------------------------------------
    y_lo = min(*vmafs, target.target_vmaf_low) - 1.0
    y_hi = max(*vmafs, target.target_vmaf_low) + 1.0
    if y_hi <= y_lo:
        y_hi = y_lo + 1.0
    fig_v = plotille.Figure()
    fig_v.width = width
    fig_v.height = vmaf_height
    fig_v.with_colors = True
    fig_v.x_label = "crf"
    fig_v.y_label = f"p{fit.low_pct}"
    fig_v.set_x_limits(min_=crf_lo, max_=crf_hi)
    fig_v.set_y_limits(min_=y_lo, max_=y_hi)
    # VMAF axis: 2 decimal places. The float formatter applies to BOTH
    # axes of this figure but we post-process the x-axis label line to
    # rebuild it as integer ticks, so x labels are unaffected by this.
    # ``chars`` is the column width plotille reserved for the label;
    # right-justify into it so labels of different widths still keep
    # the y-axis pipes column-aligned (otherwise e.g. ``99.76`` and
    # ``9.76`` would shift the chart's left edge between rows).
    fig_v.register_label_formatter(
        float,
        lambda val, chars, delta, left: f"{val:>{max(1, chars)}.2f}",
    )
    fig_v.plot(crfs, vmafs, lc="bright_cyan", label="curve")
    fig_v.scatter(crfs, vmafs, lc="bright_yellow", label="probes")
    # Target reference line + chosen-CRF marker, both as normalized
    # coordinates (plotille's axhline/axvline expect 0..1 within the
    # chart area).
    if y_lo <= target.target_vmaf_low <= y_hi:
        target_norm = (target.target_vmaf_low - y_lo) / (y_hi - y_lo)
        fig_v.axhline(target_norm, lc="bright_red")
    chosen_norm = (chosen_crf - crf_lo) / (crf_hi - crf_lo)
    if 0 <= chosen_norm <= 1:
        fig_v.axvline(chosen_norm, lc="bright_green")
    # Baseline auto-pick: ``B`` marker (magenta) — disconnected from
    # the curve (it was encoded with maxrate enabled, different
    # bitrate-vs-CRF regime). Distinct character so the marker is
    # identifiable even when the chart is copied into log captures
    # that strip ANSI color.
    if baseline is not None:
        baseline_p = get_low_percentile_value(baseline.summary, fit.low_pct)
        if y_lo <= baseline_p <= y_hi and crf_lo <= baseline.crf <= crf_hi:
            fig_v.scatter(
                [float(baseline.crf)], [float(baseline_p)],
                lc="bright_magenta", label="baseline", marker="★",
            )
    # Reference encode anchor: ``R`` marker (blue) at VMAF=100 — the
    # comparison ceiling by definition.
    if reference is not None and crf_lo <= reference.crf <= crf_hi:
        ref_p = get_low_percentile_value(reference.summary, fit.low_pct)
        if y_lo <= ref_p <= y_hi:
            fig_v.scatter(
                [float(reference.crf)], [float(ref_p)],
                lc="bright_blue", label="reference", marker="▲",
            )
    with _plotille_force_color():
        fig_v_text = fig_v.show()
    lines.extend(
        _ansi_to_rich_markup(_replace_x_axis_labels(fig_v_text)).splitlines(),
    )

    # ---- Bitrate sub-chart --------------------------------------------
    if any(b > 0 for b in bitrates):
        kbps_lo = max(0.0, min(bitrates) * 0.9)
        kbps_hi = max(bitrates) * 1.1
        if kbps_hi <= kbps_lo:
            kbps_hi = kbps_lo + 1.0
        fig_b = plotille.Figure()
        fig_b.width = width
        fig_b.height = bitrate_height
        fig_b.with_colors = True
        fig_b.x_label = "crf"
        fig_b.y_label = "kbps"
        fig_b.set_x_limits(min_=crf_lo, max_=crf_hi)
        fig_b.set_y_limits(min_=kbps_lo, max_=kbps_hi)
        # Bitrate axis: round to integer kbps. (Numbers in the 5000+
        # range don't benefit from decimals.) Right-justify into
        # ``chars`` width so e.g. ``9931`` aligns with ``23935``
        # without shifting the y-axis pipe column.
        fig_b.register_label_formatter(
            float,
            lambda val, chars, delta, left: f"{val:>{max(1, chars)}.0f}",
        )
        fig_b.plot(crfs, bitrates, lc="bright_cyan")
        fig_b.scatter(crfs, bitrates, lc="bright_yellow")
        if 0 <= chosen_norm <= 1:
            fig_b.axvline(chosen_norm, lc="bright_green")
        if (
            baseline is not None
            and baseline.bitrate_kbps > 0
            and kbps_lo <= baseline.bitrate_kbps <= kbps_hi
            and crf_lo <= baseline.crf <= crf_hi
        ):
            fig_b.scatter(
                [float(baseline.crf)], [float(baseline.bitrate_kbps)],
                lc="bright_magenta", marker="★",
            )
        if (
            reference is not None
            and reference.bitrate_kbps > 0
            and crf_lo <= reference.crf <= crf_hi
        ):
            # Stretch kbps axis if reference exceeds it (reference's
            # CRF=18 typically has the highest bitrate of any probe).
            if reference.bitrate_kbps > kbps_hi:
                fig_b.set_y_limits(min_=kbps_lo, max_=reference.bitrate_kbps * 1.05)
            fig_b.scatter(
                [float(reference.crf)], [float(reference.bitrate_kbps)],
                lc="bright_blue", marker="▲",
            )
        with _plotille_force_color():
            fig_b_text = fig_b.show()
        lines.extend(
            _ansi_to_rich_markup(_replace_x_axis_labels(fig_b_text)).splitlines(),
        )

    # Rich markup wraps each color name in its own color so the
    # legend renders self-documenting (the word ``yellow`` is yellow,
    # etc.). The outer level-color wrap from YTCLogger.log applies
    # to the surrounding text; the explicit `[color]` spans override
    # for that color name only and close back to the level color.
    #
    # Use the ``bright_X`` variants so the rendered color visibly
    # matches the operator's expectation of what the name "yellow"
    # / "blue" / etc. should look like — the standard 8-color
    # palette renders olive / dim navy on many themes and the labels
    # read as misleading. Must stay paired with the ``bright_*``
    # ``lc=`` values in the plotille calls above and the bright SGR
    # codes (90-97) in ``_ANSI_SGR_TO_RICH``.
    legend = (
        f"  legend: [bright_yellow]yellow[/bright_yellow]=probes  "
        f"[bright_cyan]cyan[/bright_cyan]=curve  "
        f"[bright_red]red[/bright_red]"
        f"=target(p{fit.low_pct}={target.target_vmaf_low})  "
        f"[bright_green]green[/bright_green]=chose crf={chosen_crf}"
    )
    if reference is not None:
        legend += (
            f"  [bright_blue]blue ▲[/bright_blue]"
            f"=reference crf={reference.crf}"
        )
    if baseline is not None:
        legend += (
            f"  [bright_magenta]magenta ★[/bright_magenta]"
            f"=baseline auto-pick crf={baseline.crf}"
        )
    # Indent chart lines so they align with the legend's 2-space
    # offset and don't sit flush against column 0 — gives the y-axis
    # labels visible breathing room and reads as a unified block.
    lines = [f"  {line}" if line.strip() else line for line in lines]
    lines.append(legend)
    return lines


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------


def find_crf_via_curve_fit(
    *,
    target: CrfSearchTarget,
    evaluate_at_crf: Callable[[int], TrialMeasurement],
    on_trial_complete: Callable[[CrfSearchTrial], None] | None = None,
    n_initial_probes: int = DEFAULT_INITIAL_PROBE_COUNT,
    max_probes: int = DEFAULT_MAX_PROBE_COUNT,
    final_frames_estimate: int = 0,
    reference_size_bytes: int = 0,
    baseline_trial: CrfSearchTrial | None = None,
    reference_marker: CrfSearchTrial | None = None,
) -> tuple[CrfSearchResult, CurveFitSearchResult]:
    """Run the probe-fit-pick search.

    Probes ``n_initial_probes`` evenly-spaced CRFs across
    ``target.crf_min..target.crf_max``, adaptively adds up to
    ``max_probes - n_initial_probes`` extra probes when the data is
    weird (saturation collapse, sparse coverage, knee at boundary),
    fits all three curve models, computes all 3x3 heuristic picks,
    and chooses the default = KNEE on PIECEWISE (with TARGET fallback).

    Returns ``(crf_search_result, curve_fit_result)``. The first matches
    the bisection's result shape so the orchestrator's downstream
    logging + cross-pair learning works without changes. The second
    carries curve-fit-specific data for the JSONL metadata file +
    detailed log lines.
    """
    trials: list[CrfSearchTrial] = []
    refit_reasons: list[str] = []

    def probe_at(crf: int) -> CrfSearchTrial:
        clamped = max(target.crf_min, min(target.crf_max, crf))
        start = time.perf_counter()
        measurement = evaluate_at_crf(clamped)
        elapsed = time.perf_counter() - start
        trial = _build_trial_from_measurement(
            crf=clamped,
            measurement=measurement,
            elapsed=elapsed,
            target_for_verdict=target,
            phase="probe",
            reference_size_bytes=reference_size_bytes,
        )
        trials.append(trial)
        if on_trial_complete is not None:
            on_trial_complete(trial)
        return trial

    # ---- Phase 1: initial probes ------------------------------------------
    initial_crfs = select_initial_probe_crfs(
        crf_min=target.crf_min,
        crf_max=target.crf_max,
        n_probes=n_initial_probes,
    )
    for crf in initial_crfs:
        probe_at(crf)

    # ---- Phase 2: adaptive refit ------------------------------------------
    while len(trials) < max_probes:
        extra_crf, reason = needs_extra_probe(trials, target=target)
        if extra_crf is None:
            break
        # Avoid re-probing the same CRF.
        if any(t.crf == extra_crf for t in trials):
            break
        refit_reasons.append(reason)
        probe_at(extra_crf)

    # If the boundary-expansion probe pushed past the original
    # ``crf_max``, extend the target's crf_max so the pick heuristics
    # actually consider the expanded range. Without this update,
    # target/budget heuristics walk ``range(crf_max, ...)`` and never
    # see the new probe — defeating the whole purpose of expanding.
    max_probed_crf = max((t.crf for t in trials), default=target.crf_max)
    fit_target = target
    if max_probed_crf > target.crf_max:
        fit_target = replace(target, crf_max=max_probed_crf)

    # ---- Phase 3: fit curves + compute picks ------------------------------
    fit = fit_curves(trials, target=fit_target)
    picks_grid: dict[CurveModelName, dict[HeuristicName, int | None]] = {}
    for model in ("piecewise", "linear", "log"):
        picks_grid[model] = {
            "target": pick_target(fit, target=fit_target, model=model),
            "knee": (
                pick_knee(fit, target=fit_target) if model == "piecewise" else None
            ),
            "budget": pick_budget(fit, target=fit_target, model=model),
        }
    # Default: target on piecewise — pick the highest CRF whose
    # interpolated p_low clears the user's ``target_vmaf_low``.
    # Lands close to the target threshold rather than leaving
    # compression headroom unused. Knee is computed and logged for
    # comparison but not used for the default choice; with maxrate
    # disabled in trials the encoder's CRF response is monotonic and
    # the cliff (if any) sits at the top of the search range — knee
    # detection mostly amounts to "stop one CRF before the worst
    # probe" which is more conservative than needed.
    chosen_curve: CurveModelName = "piecewise"
    chosen_heuristic: HeuristicName
    chosen_crf = picks_grid["piecewise"]["target"]
    if chosen_crf is not None:
        chosen_heuristic = "target"
    else:
        # Target unreachable in range — try knee as a fallback
        # signal of "use the last good step before the cliff".
        chosen_crf = picks_grid["piecewise"]["knee"]
        chosen_heuristic = "knee"
    if chosen_crf is None:
        # Both target and knee failed. Fall back to the highest valid
        # probe — most aggressive CRF that was actually measured.
        # ``target.crf_min`` is the absolute last resort if saturation
        # drop ate every probe.
        chosen_crf = (
            max(p.crf for p in fit.valid_probes)
            if fit.valid_probes
            else target.crf_min
        )
        chosen_heuristic = "target"
    picks = HeuristicPicks(
        by_curve_and_heuristic=picks_grid,
        chosen_curve=chosen_curve,
        chosen_heuristic=chosen_heuristic,
        chosen_crf=chosen_crf,
    )

    # ---- Phase 4: verify-encode at chosen CRF -----------------------------
    # Cache hit if chosen_crf was already a probe; otherwise this is one
    # extra encode to get a real measured summary at the picked CRF.
    verify_trial = next((t for t in trials if t.crf == chosen_crf), None)
    if verify_trial is None:
        verify_trial = probe_at(chosen_crf)
        # Re-tag the phase to indicate this is the verification probe,
        # not a regular curve-fit probe. ``dataclasses.replace`` keeps
        # every other field — including ``bitrate_kbps`` — intact;
        # listing fields manually here previously dropped bitrate, which
        # bubbled into the optimal-summary log line as ``bitrate=0kbps``.
        verify_trial = replace(verify_trial, phase="verify")
        # Replace last appended trial with the re-tagged one.
        trials[-1] = verify_trial

    # ---- Phase 5: build CrfSearchResult -----------------------------------
    # Use ``fit_target`` so the result records the effective range the
    # search actually explored (which may be wider than the input
    # target.crf_max if boundary expansion fired).
    search_result = CrfSearchResult(
        optimal_crf=chosen_crf,
        optimal_summary=verify_trial.summary,
        trials=trials,
        target=fit_target,
        sample_windows=[],  # filled in by orchestrator (it owns the window list)
        reference_size_bytes=reference_size_bytes,
        search_frames=sum(t.summary.frame_count for t in trials),
        final_frames_estimate=final_frames_estimate,
        search_seconds=sum(t.encode_seconds for t in trials),
    )
    compressibility = compute_compressibility(fit, chosen_crf=chosen_crf)
    curve_fit_result = CurveFitSearchResult(
        fit=fit,
        picks=picks,
        refit_reasons=refit_reasons,
        compressibility=compressibility,
    )
    # Combine the curve-fit summary and the ASCII chart into one log
    # call. Rich renders ``\n`` as line breaks within a single message,
    # which gives one timestamp + level prefix at the top and continues
    # the chart rows indented underneath — much easier to read than
    # interleaving timestamps between every chart row.
    at_chosen_str = (
        f"{compressibility.at_chosen_crf_kbps_per_vmaf:.0f}"
        if compressibility.at_chosen_crf_kbps_per_vmaf is not None
        else "n/a"
    )
    summary_line = (
        f"curve-fit: {len(fit.valid_probes)}/{len(trials)} valid probes; "
        f"chose crf={chosen_crf} via {chosen_curve}+{chosen_heuristic} "
        f"(target_low={target.target_vmaf_low}, low_pct=p{target.target_vmaf_low_pct}); "
        f"compressibility={compressibility.mean_kbps_per_vmaf:.0f} kbps/p"
        f"{target.target_vmaf_low_pct} mean, {at_chosen_str} at chosen"
    )
    chart_lines = render_curve_ascii(
        fit,
        target=fit_target,
        chosen_crf=chosen_crf,
        baseline=baseline_trial,
        reference=reference_marker,
    )
    # ``highlighter=None`` disables rich's default ReprHighlighter
    # for this record. The highlighter has an ``attrib_name`` regex
    # that matches identifiers before ``=`` and colors them yellow —
    # which overrides our explicit ``[bright_X]`` legend markup
    # ("yellow=probes", "cyan=curve" etc. all came out yellow). The
    # ``blue ▲=`` / ``magenta ★=`` keys survived only because the
    # space + glyph broke the attrib_name regex. Suppressing the
    # highlighter lets our markup decide every color.
    logger.notice(
        "\n".join([summary_line, *chart_lines]),
        extra={"highlighter": None},
    )
    return search_result, curve_fit_result


