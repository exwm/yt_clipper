"""Sampling, bisection, and two-phase CRF search algorithms.

Three layers, in order of how they're built up:

1. **Sampling** — :func:`select_sample_windows` decides where in the
   clip to encode trial windows. Frame-count sized, with adaptive
   floor/ceiling so percentile measurements stay statistically
   meaningful regardless of clip length.
2. **Single-phase search** — :func:`legacy_find_optimal_crf` runs
   interpolated bisection over a CRF range, calling an injected
   ``evaluate_trial`` callback. Pure algorithm: no encoder, no I/O.
3. **Two-phase search** — :func:`legacy_find_optimal_crf_two_phase` is the
   real entry point. Coordinates Phase 1 (single-window discovery),
   Phase 2 (full-windows validation), and Phase 3 (refinement via
   step-down + bisection) with calibration-driven shortcuts. See its
   docstring for the full decision tree.

The orchestrator (:mod:`.orchestrator`) wires these into the encoder
pipeline; this module never imports from there.
"""

from __future__ import annotations

# math.ceil is used in select_sample_windows for ceiling division.
import math
import time
from dataclasses import replace
from typing import Callable

from clipper.quality import VmafSummary
from clipper.ytc_logger import Subsystem, make_subsystem_logger

from .predicates import (
    _calibration_says_phase3_hopeless,
    _calibration_says_step_down_wont_help,
    _distance_to_pass_boundary,
    _find_best_pass_at_fallback_level,
    _predict_phase2_fast_fail,
    _refinement_extrapolation_says_hopeless,
    get_low_percentile_value,
    passes_targets,
)
from .types import (
    DEFAULT_LOW_PERCENTILE,
    DEFAULT_N_WINDOWS,
    DEFAULT_TARGET_SAMPLE_PERCENT,
    DEFAULT_TARGET_TRIAL_FRAMES,
    CrfSearchResult,
    CrfSearchTarget,
    CrfSearchTrial,
    SampleWindow,
    TrialMeasurement,
    min_frames_for_low_percentile,
)

logger = make_subsystem_logger(Subsystem.CRF_SEARCH)

# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------


def select_sample_windows(
    *,
    clip_start: float,
    clip_end: float,
    source_fps: float,
    final_frames_estimate: int = 0,
    n_windows: int = DEFAULT_N_WINDOWS,
    target_sample_percent: float = DEFAULT_TARGET_SAMPLE_PERCENT,
    min_combined_frames: int | None = None,
    max_combined_frames: int | None = None,
    target_combined_frames: int | None = None,
    edge_skip_fraction: float = 0.10,
) -> list[SampleWindow]:
    """Pick evenly-spaced sample windows for binary-search trial encodes.

    Sizing is PERCENT-of-final with a frame-count floor: each trial targets
    ``target_sample_percent`` of ``final_frames_estimate`` (default 10%),
    clamped to ``[min_combined_frames, max_combined_frames]``. Long clips
    sample a small fraction of their frames (10x speedup vs full-clip);
    short clips floor at ``min_combined_frames`` (default 100, matching
    :data:`MIN_FRAMES_FOR_RELIABLE_P1`) so p1 stays meaningful.

    Worked examples (assume 30 fps, default 10% / 100 floor):

    - 1-minute clip (1800 frames): 10% = 180 frames -> 180 frames
      (~60 per window, ~2 s windows). ~10 % of final.
    - 5-second clip (150 frames): 10% = 15 -> floored at 100 frames
      (~33 per window, ~1.1 s windows). ~67 % of final — sampling
      barely helps on short clips, which is expected.
    - 10-minute clip (18000 frames): 10% = 1800 -> 1800 frames (~600
      per window, ~20 s windows). ~10 % of final.

    The combined-frame target is split evenly across ``n_windows`` (default
    3) and the actual window duration is derived per clip from
    ``source_fps``: ``window_seconds = (target / n_windows) / source_fps``.

    ``target_combined_frames`` is an explicit override that bypasses the
    percent + floor + ceiling logic. Set it when the caller wants a
    deterministic frame count regardless of clip length (also used by the
    legacy code path before percent-sizing existed).

    Windows are evenly distributed over the middle 80 % of the clip range
    (``edge_skip_fraction`` 10 % off each end) — the first and last 10 %
    often contain less-representative content (lead-in fades, end-card
    frames). Sampling axis is wall-clock time in source-video coordinates,
    so the same windows align across reference and trial encodes.

    If the clip is too short to fit ``n_windows * window_seconds`` in the
    sampleable region, OR ``source_fps`` is non-positive (unknown
    framerate), returns a single ``SampleWindow`` covering the full clip
    range. Sampling degrades to a full-clip trial gracefully.
    """
    clip_duration = clip_end - clip_start
    if clip_duration <= 0 or source_fps <= 0 or n_windows <= 0:
        return [SampleWindow(start=clip_start, end=clip_end)]

    if target_combined_frames is None:
        # Percent-of-final with floor and optional ceiling. When the final
        # frame count is unknown (caller didn't pass it), fall back to the
        # legacy fixed-count default — matches the behavior before
        # percent-sizing was added.
        if final_frames_estimate > 0:
            target_combined_frames = round(
                final_frames_estimate * target_sample_percent / 100.0,
            )
        else:
            target_combined_frames = DEFAULT_TARGET_TRIAL_FRAMES
        # ``min_combined_frames`` defaults to the floor for the default
        # low percentile (p5 -> 50). Callers needing a different floor
        # (e.g. p1 -> 100) override explicitly. Tracking the percentile
        # default keeps the trial frame count just high enough to make
        # the configured low percentile statistically meaningful.
        effective_floor = (
            min_combined_frames
            if min_combined_frames is not None
            else min_frames_for_low_percentile(DEFAULT_LOW_PERCENTILE)
        )
        target_combined_frames = max(target_combined_frames, effective_floor)
        if max_combined_frames is not None:
            target_combined_frames = min(target_combined_frames, max_combined_frames)

    # Ceil division (not floor): integer rounding when splitting target
    # frames across windows must err *upward* so the combined frame count
    # ``frames_per_window * n_windows`` stays at or above
    # ``target_combined_frames``. Floor division silently drops 1-2
    # frames per window — enough to push combined below the percentile
    # floor (e.g. target=50, n_windows=3, floor: 50//3=16, combined=48 <
    # 50 -> percentile silently dropped, verdicts go mean-only). With
    # ceil: 17 per window, combined=51 >= 50, percentile enforced.
    frames_per_window = max(1, math.ceil(target_combined_frames / n_windows))
    window_seconds = frames_per_window / source_fps

    sampleable_start = clip_start + clip_duration * edge_skip_fraction
    sampleable_end = clip_end - clip_duration * edge_skip_fraction
    sampleable_duration = sampleable_end - sampleable_start

    needed_duration = n_windows * window_seconds
    if needed_duration > sampleable_duration:
        # Not enough room — fall back to the full clip range as one window.
        return [SampleWindow(start=clip_start, end=clip_end)]

    # Evenly distribute the windows: place each window's CENTER at the
    # midpoint of its slice of the sampleable region. With n_windows=3 and
    # sampleable region [a, b], the centers land at a+R/6, a+R/2, a+5R/6
    # (where R = sampleable_duration). This avoids stacking windows at the
    # very start or end and gives equal spacing between all centers.
    windows: list[SampleWindow] = []
    for i in range(n_windows):
        slice_center = sampleable_start + sampleable_duration * (i + 0.5) / n_windows
        window_start = slice_center - window_seconds / 2
        window_end = window_start + window_seconds
        windows.append(SampleWindow(start=window_start, end=window_end))
    return windows


# ---------------------------------------------------------------------------
# Pure binary-search algorithm
# ---------------------------------------------------------------------------


# When interpolation rounds the predicted boundary back to the rightmost
# passing trial AND that trial passes by less than this VMAF-points
# margin, the bisection accepts the trial as optimal and stops probing
# upward. Tightens convergence on shallow slopes (Phase 1's flat
# single-window mean-only curves) where every marginal passing CRF sits
# 0.1-0.5 points above target — without this guard the bisection would
# walk lo + 1 several times, each adding a trial to confirm what
# interpolation already said.
_INTERP_CONVERGENCE_LO_DISTANCE: float = 1.0


def _predict_next_bisection_crf(
    *,
    lo: int,
    hi: int,
    trials: list[CrfSearchTrial],
    target: CrfSearchTarget,
) -> int:
    """Pick the next CRF to probe within ``(lo, hi)`` exclusive.

    When the trial history holds both a passing and a failing trial that
    bracket the boundary (``best_pass.crf < best_fail.crf``), linearly
    interpolate where the pass-distance crosses zero and probe there.
    The interpolation uses :func:`_distance_to_pass_boundary` — the
    limiting-axis distance — so the prediction tracks whichever target
    (mean or low percentile) is closer to its threshold.

    Falls back to plain midpoint when no usable pass/fail bracket exists
    (early in the search) or when the data isn't a clean boundary
    bracket (both trials passing or both failing — shouldn't happen with
    rightmost-passing bisection but guarded anyway). Always returns a
    value strictly between ``lo`` and ``hi`` so the bisection makes
    progress.

    Worked example (Phase 3 with this clip): probe ``crf_max=34`` →
    fail (low_d=-0.33). Then midpoint=25 → pass (low_d=3.69).
    Interpolation predicts ``25 + 3.69/(3.69+0.33) * 9 = 33`` and probes
    33 directly, instead of bisection's 5+ iterations to walk down from
    25 toward 34.
    """
    in_range = [t for t in trials if lo <= t.crf <= hi]
    pass_trials = [t for t in in_range if t.passed]
    fail_trials = [t for t in in_range if not t.passed]
    if pass_trials and fail_trials:
        best_pass = max(pass_trials, key=lambda t: t.crf)
        best_fail = min(fail_trials, key=lambda t: t.crf)
        if best_pass.crf < best_fail.crf:
            lo_d = _distance_to_pass_boundary(best_pass.summary, target)
            hi_d = _distance_to_pass_boundary(best_fail.summary, target)
            # ``lo_d >= 0`` (passing trial) and ``hi_d < 0`` (failing
            # trial) is the valid interpolation bracket. ``lo_d == 0``
            # means the passing trial sits exactly on the boundary; the
            # formula then predicts the passing CRF itself, clamping
            # below pushes us one step toward ``hi`` to confirm the
            # bracket.
            if lo_d >= 0 > hi_d:
                # Linear: distance(crf) = lo_d + (hi_d - lo_d) *
                # (crf - best_pass.crf) / (best_fail.crf - best_pass.crf)
                # Solve for distance == 0:
                predicted = (
                    best_pass.crf
                    + lo_d
                    / (lo_d - hi_d)
                    * (best_fail.crf - best_pass.crf)
                )
                next_crf = round(predicted)
                # Convergence: when the predicted boundary rounds back
                # to ``best_pass.crf`` AND that trial barely cleared
                # (small lo_d), interpolation is signaling "the answer
                # is at this trial, not above it." Return that CRF so
                # the bisection caller breaks instead of clamping by 1
                # and burning a confirmation probe. Especially helpful
                # on shallow VMAF-vs-CRF curves (e.g. Phase 1's
                # single-window mean-only data) where each marginal
                # passing trial sits within 0.1-0.5 VMAF points of the
                # target. We require lo_d < CONVERGENCE_LO_DISTANCE so
                # we don't short-circuit when predicted just *rounded*
                # to lo (e.g. via banker's rounding of x.5) but the
                # actual boundary is still 1+ CRF higher.
                if (
                    next_crf == best_pass.crf
                    and lo_d < _INTERP_CONVERGENCE_LO_DISTANCE
                ):
                    return next_crf
                # Strict progress: must be in (lo, hi) exclusive so the
                # bisection narrows on each remaining iteration.
                return max(lo + 1, min(hi - 1, next_crf))
    return (lo + hi) // 2


def legacy_find_optimal_crf(
    *,
    target: CrfSearchTarget,
    evaluate_trial: Callable[[int], TrialMeasurement],
    sample_windows: list[SampleWindow] | None = None,
    reference_size_bytes: int = 0,
    final_frames_estimate: int = 0,
    on_trial_complete: Callable[[CrfSearchTrial], None] | None = None,
    phase: str = "",
) -> CrfSearchResult:
    """Bisect over ``[crf_min, crf_max]`` for the largest CRF that clears
    ``target.target_vmaf_mean`` and ``target.target_vmaf_p1`` simultaneously.

    Higher CRF = more compression = lower quality, so we want the maximum
    CRF that still passes (rightmost-passing-element bisection). No I/O:
    callers inject ``encode_at_crf`` (encodes one trial, returns the list
    of per-window output paths) and ``measure_vs_reference`` (VMAF NEG of
    the trial windows vs the reference). Trivially unit-testable with
    in-memory mocks.

    Edge cases handled:

    - **Easy clip with headroom**: probe ``crf_max`` first. If it passes
      *with* both mean and p1 well above target (see
      ``expansion_min_*_headroom``), galloping-expand upward in
      ``expansion_step`` increments until either a probe fails (then
      bisect between last passing and first failing) or we hit
      ``crf_absolute_max`` / run out of iterations / lose headroom.
    - **Easy clip without headroom**: ``crf_max`` passes but barely.
      Returns ``crf_max`` immediately — bisection upward would just hit
      the actual edge and the gain isn't worth more trials.
    - **Hard clip**: ``crf_max`` fails. Plain bisection over
      ``[crf_min, crf_max]`` toward rightmost-passing.
    - **Truly hard clip**: no CRF passes. ``optimal_crf`` is ``None`` and
      the orchestrator falls back to ``crf_min`` with a warning.
    - **Iteration cap**: respects ``max_iterations`` even if the range
      hasn't fully closed — pragmatic stop, returns the best passing CRF
      found so far.
    """
    trials: list[CrfSearchTrial] = []
    best_crf: int | None = None
    best_summary: VmafSummary | None = None

    def _try_crf(crf: int) -> tuple[bool, VmafSummary]:
        nonlocal best_crf, best_summary
        start_time = time.monotonic()
        measurement = evaluate_trial(crf)
        elapsed = time.monotonic() - start_time
        trial = _build_trial_from_measurement(
            crf=crf,
            measurement=measurement,
            elapsed=elapsed,
            target_for_verdict=target,
            phase=phase,
            reference_size_bytes=reference_size_bytes,
        )
        summary = measurement.summary
        passed = trial.passed
        trials.append(trial)
        if passed and (best_crf is None or crf > best_crf):
            best_crf = crf
            best_summary = summary
        # Fire the per-trial callback inside the search so callers can log
        # progress immediately rather than waiting until the whole search
        # finishes — important for visibility during 30-90s-per-trial runs.
        if on_trial_complete is not None:
            on_trial_complete(trial)
        return passed, summary

    def _build_result() -> CrfSearchResult:
        # Combined frames the search actually encoded across every trial,
        # so callers can compare to ``final_frames_estimate`` and decide
        # whether sampling is paying off (small ratio = win, large ratio =
        # consider full-clip trials or fewer sample windows).
        search_frames = sum(t.summary.frame_count for t in trials)
        search_seconds = sum(t.encode_seconds for t in trials)
        return CrfSearchResult(
            optimal_crf=best_crf,
            optimal_summary=best_summary,
            trials=trials,
            target=target,
            sample_windows=list(sample_windows or []),
            reference_size_bytes=reference_size_bytes,
            search_frames=search_frames,
            final_frames_estimate=final_frames_estimate,
            search_seconds=search_seconds,
        )

    def _has_expansion_headroom(summary: VmafSummary) -> bool:
        """Whether the trial passed by enough margin to justify probing
        higher CRFs. Conservative — both checks must hold so we don't
        expand into the cliff edge on barely-passing trials."""
        mean_headroom = summary.mean - target.target_vmaf_mean
        low_value = get_low_percentile_value(
            summary,
            target.target_vmaf_low_pct,
        )
        low_headroom = low_value - target.target_vmaf_low
        return (
            mean_headroom >= target.expansion_min_mean_headroom
            and low_headroom >= target.expansion_min_low_headroom
        )

    iterations_remaining = target.max_iterations

    # Probe crf_max first — establishes whether we expand upward (easy
    # clip with headroom) or bisect downward (crf_max didn't pass).
    crf_max_passed, crf_max_summary = _try_crf(target.crf_max)
    iterations_remaining -= 1

    if crf_max_passed:
        # Galloping-expansion phase: try CRFs above crf_max while we still
        # have headroom, until one fails (-> bracket for bisection) or we
        # hit the absolute ceiling / run out of iterations.
        last_passing_crf = target.crf_max
        last_passing_summary = crf_max_summary
        first_failing_crf: int | None = None

        while iterations_remaining > 0 and _has_expansion_headroom(last_passing_summary):
            next_probe = last_passing_crf + target.expansion_step
            if next_probe > target.crf_absolute_max:
                break
            passed, summary = _try_crf(next_probe)
            iterations_remaining -= 1
            if passed:
                last_passing_crf = next_probe
                last_passing_summary = summary
            else:
                first_failing_crf = next_probe
                break

        # If expansion never found a failing CRF, the best passing trial
        # we have is the answer. No bisection to run.
        if first_failing_crf is None:
            return _build_result()

        # Bisect between the last passing and the first failing CRF.
        lo = last_passing_crf
        hi = first_failing_crf
    else:
        # crf_max didn't pass — standard downward bisection over the
        # original [crf_min, crf_max] range.
        lo, hi = target.crf_min, target.crf_max

    # Bisect narrowing toward rightmost-passing CRF. Uses interpolation
    # over the trial history's pass/fail bracket when available — predicts
    # the boundary CRF directly rather than walking down via blind
    # midpoint, which on shallow VMAF-vs-CRF curves can take several
    # iterations to converge.
    while iterations_remaining > 0 and hi - lo > 1:
        mid = _predict_next_bisection_crf(
            lo=lo, hi=hi, trials=trials, target=target,
        )
        if mid in {trial.crf for trial in trials}:
            # Range closed enough that the prediction landed on an
            # already-tested CRF — bisection can't extract more info.
            break
        passed, _ = _try_crf(mid)
        if passed:
            lo = mid  # passing — try higher (more compression) next
        else:
            hi = mid  # failing — try lower (more quality) next
        iterations_remaining -= 1

    return _build_result()


# ---------------------------------------------------------------------------
# Two-phase search algorithm
# ---------------------------------------------------------------------------


# Phase 3's linear step-down probes ``candidate-1, candidate-2, ...``
# at full sampling before falling into bisection. Phase 1's mean-only
# bias is typically small (1-3 CRF off truth), so step-down often finds
# the answer in 1-3 trials — much faster than bisection's 4-6 trials
# walking down from ``midpoint(crf_min, candidate)``. Capped to avoid
# pathological clips (Phase 1 way off truth) burning many trials before
# bisection takes over.
DEFAULT_PHASE3_STEP_DOWN_LIMIT: int = 3


# VMAF points by which Phase 3's effective target softens for each
# successive refinement trial after Phase 2. Phase 1 + Phase 2 always
# evaluate against the user's strict target; once Phase 2 has confirmed
# the candidate doesn't pass strictly, refinement trials accept
# progressively-failing measurements as "good enough" rather than walk
# many CRFs to find a strict pass. Step-down trial 1 sees target -
# per_step; trial 2 sees target - 2*per_step; etc. After step-down
# exhausts, the bisection sub-stage runs at the next depth's relaxation.
DEFAULT_TARGET_RELAXATION_PER_STEP: float = 0.3


# Hard cap on total relaxation. Search never accepts a measurement more
# than this many VMAF points below the user's stated targets, even on
# adversarial clips where the boundary is far from Phase 1's candidate.
# 1.5 still leaves yt_clipper's defaults (mean>=92, p5>=89) above
# industry-standard streaming targets (mean>=90, p5>=85).
DEFAULT_TARGET_RELAXATION_CAP: float = 1.5


def _build_trial_from_measurement(
    *,
    crf: int,
    measurement: TrialMeasurement,
    elapsed: float,
    target_for_verdict: CrfSearchTarget,
    phase: str,
    reference_size_bytes: int,
) -> CrfSearchTrial:
    """Construct a :class:`CrfSearchTrial` from a :class:`TrialMeasurement`.

    Centralizes the boilerplate every call site needs after running an
    evaluator: derive pass/fail from the summary, compute size-percent
    relative to the matching reference subset (preferring the
    measurement's per-trial value when set, falling back to the global
    reference total), and stamp the result with the right phase label.

    ``target_for_verdict`` is the target the trial's pass/fail check
    runs against. For Phase 1, Phase 2, and bisection trials this is
    the user's strict (or cap-relaxed) target; for step-down trials
    it's the depth-relaxed target so a marginally-failing measurement
    counts as "good enough" for that step.
    """
    summary = measurement.summary
    passed, low_pct_enforced = passes_targets(summary, target_for_verdict)
    ref_for_size = (
        measurement.reference_size_bytes_for_windows or reference_size_bytes
    )
    size_percent = (
        measurement.encoded_size_bytes / ref_for_size * 100.0
        if ref_for_size > 0
        else 0.0
    )
    return CrfSearchTrial(
        crf=crf,
        summary=summary,
        encode_seconds=elapsed,
        passed=passed,
        low_pct_enforced=low_pct_enforced,
        encoded_size_bytes=measurement.encoded_size_bytes,
        size_percent_of_reference=size_percent,
        windows_used=measurement.windows_used,
        windows_total=measurement.windows_total,
        phase=phase,
        bitrate_kbps=measurement.bitrate_kbps,
    )


def _relaxed_target(
    target: CrfSearchTarget,
    *,
    depth: int,
    per_step: float,
    cap: float,
) -> CrfSearchTarget:
    """Soften ``target``'s mean and low-percentile thresholds proportionally
    to ``depth``, capped at ``cap`` VMAF points. ``depth=0`` returns the
    original target unchanged so callers can pass through Phase 1 and
    Phase 2 with the same helper.

    Used by the two-phase orchestrator's refinement stages to accept
    slightly-failing trials as good enough rather than walk indefinitely
    down through CRFs at strict targets. The cap prevents adversarial
    clips from accepting wildly under-quality results.
    """
    delta = min(max(0, depth) * per_step, cap)
    if delta <= 0:
        return target
    return replace(
        target,
        target_vmaf_mean=target.target_vmaf_mean - delta,
        target_vmaf_low=target.target_vmaf_low - delta,
    )


# Safety margin (in VMAF points) for the Phase 2 fast-fail prediction.
# Phase 2 is skipped only when Phase 1's percentile prediction sits at
# least this far below the target — so borderline cases still get the
# full-windows validation. Higher = more conservative (rare skips,
# fewer false positives). Lower = more aggressive (skips more often,
# but may occasionally accept a slightly-lower-than-optimal CRF when
# the prediction was wrong about Phase 2 failing). 1.0 is calibrated
# from observed runs where single-window p10 was within ~1 VMAF point
# of full-window p5 across multiple CRFs.
DEFAULT_PHASE2_FAST_FAIL_MARGIN: float = 1.0


# Minimum Phase 1 single-window trial count for the calibration-based
# hopeless check to fit a slope. When cross-pair learning seeds the
# search with ``crf_max=prior_optimal``, Phase 1 typically returns in
# one trial (the crf_max probe passes without expansion headroom),
# leaving the calibration helper with only one data point. We force
# one extra single-window probe at a lower CRF after Phase 2 fails so
# the slope can be fit and the calibration check can fire.
MIN_PHASE1_TRIALS_FOR_CALIBRATION: int = 2



def legacy_find_optimal_crf_two_phase(  # noqa: PLR0912, PLR0913 — phased flow with independent tuning knobs per phase; collapsing into a config object would obscure each parameter's role
    *,
    target: CrfSearchTarget,
    n_windows: int,
    middle_window_index: int,
    evaluate_trial_for_windows: Callable[[int, list[int]], TrialMeasurement],
    sample_windows: list[SampleWindow] | None = None,
    reference_size_bytes: int = 0,
    final_frames_estimate: int = 0,
    on_trial_complete: Callable[[CrfSearchTrial], None] | None = None,
    phase3_step_down_limit: int = DEFAULT_PHASE3_STEP_DOWN_LIMIT,
    phase2_fast_fail_margin: float = DEFAULT_PHASE2_FAST_FAIL_MARGIN,
    target_relaxation_per_step: float = DEFAULT_TARGET_RELAXATION_PER_STEP,
    target_relaxation_cap: float = DEFAULT_TARGET_RELAXATION_CAP,
    allow_low_pct_cascade: bool = True,
    allow_mean_only_fallback: bool = True,
) -> CrfSearchResult:
    """Three-phase CRF search: cheap discovery, full validation, optional refinement.

    Decision flow at a glance::

        Phase 1 (single-window bisection of [crf_min, crf_max])
          |
          +-- candidate is None
          |     -> _build() -> cascade fallback (p10 -> mean-only)
          |
          +-- candidate found
                |
                +-- fast-fail predicts Phase 2 fail?
                |     yes -> skip Phase 2; jump to Phase 3
                |     no  -> run Phase 2 (full sampling at candidate)
                |             |
                |             +-- pass -> done (optimal = candidate)
                |             +-- fail -> enter refinement
                |
                +-- refinement (Phase 3)
                      |
                      +-- candidate <= crf_min -> _build(None) -> cascade
                      +-- (Phase 2 ran) ensure >= 2 Phase 1 trials by
                      |     forcing one extra single-window probe at the
                      |     midpoint of [crf_min, candidate]
                      +-- (Phase 2 ran) calibration says no CRF in
                      |     [crf_min, candidate-1] reaches relaxed target?
                      |     yes -> _build(None) -> cascade
                      |     no  -> proceed
                      +-- (Phase 2 ran) calibration says step-down's max
                      |     improvement < Phase 2 deficit?
                      |     yes -> skip step-down loop; bisect directly
                      |     no  -> run step-down loop
                      +-- step-down probes candidate-1 ... candidate-N
                      |     each at depth-relaxed target
                      |     - any pass -> done
                      |     - all fail -> proceed
                      +-- slope-based hopeless check after step-down
                      |     extrapolation says crf_min won't reach target?
                      |     yes -> _build(None) -> cascade
                      |     no  -> proceed
                      +-- bisection over [crf_min, last_step_down_failure - 1]
                            at cap-relaxed target
                            - pass found -> done (with cap-level relaxation)
                            - nothing passes -> _build(None) -> cascade

        cascade fallback (in _build):
          1. Higher percentile (p5 -> p10) at cap-relaxed target
          2. Mean-only at cap-relaxed mean target
          3. Return None (caller falls back to crf_min with a warning)

    Built atop :func:`legacy_find_optimal_crf` to avoid duplicating the bisection
    + galloping-expansion logic. Each phase configures a different subset
    of sample windows via the injected ``evaluate_trial_for_windows``
    callback, which the orchestrator backs with a per-(crf, window_index)
    cache so repeated CRFs across phases reuse encoded artifacts.

    Phases:

    - **Phase 1 (middle-window discovery)**: bisect over ``[crf_min, crf_max]``
      using the middle sample window only. Each Phase 1 trial encodes one
      window instead of all ``n_windows`` -> ~3x faster than single-phase
      while still finding the right neighborhood. The middle window is the
      most representative single sample (avoids lead-in / end-card frames
      via the existing edge-skip in ``select_sample_windows``).
    - **Phase 2 (validate)**: re-evaluate the Phase 1 candidate with all
      ``n_windows`` -> confirms the candidate holds up against the harder
      sections of the clip. The cache makes Phase 2's middle-window encode
      free (already done in Phase 1).
    - **Phase 3 (refinement, optional)**: only runs when Phase 2 fails.
      Has two sub-stages:

        - **Step-down**: linearly probe ``candidate-1, candidate-2, ...``
          at full sampling, up to ``phase3_step_down_limit`` trials.
          Phase 1's mean-only bias is usually small, so the boundary
          tends to sit right next to the candidate — step-down finds it
          in 1-2 trials versus bisection's 4-6.
        - **Bisection** (only if step-down exhausts without a pass):
          falls into :func:`legacy_find_optimal_crf` over
          ``[crf_min, last_step_down_failure - 1]``. Trial cache makes
          re-probing already-tested CRFs free.

      Phase 1 already proved candidate+1 fails at middle-only (so it
      can't pass with the harder windows added); Phase 2's failure means
      we need *more* bits, i.e. lower CRF. Refinement is therefore
      strictly downward.

    Trial labels (``CrfSearchTrial.phase``): ``"phase1"``, ``"phase2"``,
    ``"phase3"`` — surface in the per-trial log so users can see which
    pass each trial belongs to. Step-down and bisection trials both
    carry ``"phase3"``; their position in the trial list distinguishes
    them.

    Returns a single :class:`CrfSearchResult` whose ``trials`` list
    aggregates every probe across all three phases in invocation order.
    """
    all_window_indices = list(range(n_windows))
    middle_only = [middle_window_index]
    all_trials: list[CrfSearchTrial] = []

    def collect(trial: CrfSearchTrial) -> None:
        all_trials.append(trial)
        if on_trial_complete is not None:
            on_trial_complete(trial)

    def _build(
        optimal_crf: int | None,
        optimal_summary: VmafSummary | None,
    ) -> CrfSearchResult:
        # Graceful-degradation cascade when strict + relaxed search
        # found nothing. Try progressively more permissive levels:
        #   1. Higher percentile (e.g. p5 -> p10) with relaxed targets
        #   2. Mean-only with relaxed mean target
        # Stop at the first level with a passing cached trial. Common
        # use case: clips with transient bright frames (camera
        # flashes) where p5 specifically catches the flash frames and
        # never reaches target, but p10 or mean alone clear comfortably.
        if optimal_crf is None:
            # Order matters in the cascade: try higher percentiles in
            # increasing permissiveness order so we honor the strongest
            # quality guarantee that any cached trial supports.
            cascade: list[tuple[int | None, str]] = (
                [
                    (pct, f"p{pct}")
                    for pct in (5, 10)
                    if pct > target.target_vmaf_low_pct
                ]
                if allow_low_pct_cascade
                else []
            )
            if allow_mean_only_fallback:
                cascade.append((None, "mean-only"))
            for fallback_pct, label in cascade:
                fallback = _find_best_pass_at_fallback_level(
                    all_trials,
                    target,
                    fallback_pct=fallback_pct,
                    relaxation_cap=target_relaxation_cap,
                )
                if fallback is not None:
                    optimal_crf = fallback.crf
                    optimal_summary = fallback.summary
                    user_pct_label = f"p{target.target_vmaf_low_pct}"
                    if fallback_pct is not None:
                        fallback_value = get_low_percentile_value(
                            fallback.summary, fallback_pct,
                        )
                        logger.notice(
                            f"target {user_pct_label} unreachable "
                            f"on this clip; settling via {label} fallback at "
                            f"crf={optimal_crf} ({label}={fallback_value:.2f} "
                            f"clears relaxed target "
                            f"{target.target_vmaf_low - target_relaxation_cap:.2f}).",
                        )
                    else:
                        logger.notice(
                            f"percentile target unreachable on "
                            f"this clip; settling via {label} fallback at "
                            f"crf={optimal_crf} (mean={fallback.summary.mean:.2f} "
                            f"clears relaxed target "
                            f"{target.target_vmaf_mean - target_relaxation_cap:.2f}).",
                        )
                    break
        return CrfSearchResult(
            optimal_crf=optimal_crf,
            optimal_summary=optimal_summary,
            trials=all_trials,
            target=target,
            sample_windows=list(sample_windows or []),
            reference_size_bytes=reference_size_bytes,
            search_frames=sum(t.summary.frame_count for t in all_trials),
            final_frames_estimate=final_frames_estimate,
            search_seconds=sum(t.encode_seconds for t in all_trials),
        )

    # ---- Phase 1: middle-window bisection ----
    phase1_result = legacy_find_optimal_crf(
        target=target,
        evaluate_trial=lambda crf: evaluate_trial_for_windows(crf, middle_only),
        sample_windows=sample_windows,
        reference_size_bytes=reference_size_bytes,
        final_frames_estimate=final_frames_estimate,
        on_trial_complete=collect,
        phase="phase1",
    )

    candidate_crf = phase1_result.optimal_crf
    if candidate_crf is None:
        # Even the cheap middle-only check failed at every probed CRF.
        # No point validating; the clip is harder than crf_min handles.
        return _build(optimal_crf=None, optimal_summary=None)

    # Fast-fail prediction: use Phase 1's already-computed (but not
    # enforced) percentile data on the candidate to estimate whether
    # the full-windows Phase 2 trial will pass. Skips the ~3x-cost
    # Phase 2 encode when prediction is clearly below target.
    candidate_phase1_summary: VmafSummary | None = next(
        (
            t.summary
            for t in all_trials
            if t.crf == candidate_crf and t.phase == "phase1"
        ),
        None,
    )
    skip_phase2 = False
    if candidate_phase1_summary is not None:
        skip_phase2, fast_fail_reason = _predict_phase2_fast_fail(
            candidate_phase1_summary,
            target,
            n_windows=n_windows,
            safety_margin=phase2_fast_fail_margin,
        )
        if skip_phase2:
            logger.info(
                f"fast-fail predicting Phase 2 would fail "
                f"at crf={candidate_crf} ({fast_fail_reason}); skipping "
                f"to Phase 3 step-down.",
            )

    if not skip_phase2:
        # ---- Phase 2: validate candidate at all windows ----
        start_time = time.monotonic()
        measurement = evaluate_trial_for_windows(candidate_crf, all_window_indices)
        elapsed = time.monotonic() - start_time
        phase2_trial = _build_trial_from_measurement(
            crf=candidate_crf,
            measurement=measurement,
            elapsed=elapsed,
            target_for_verdict=target,
            phase="phase2",
            reference_size_bytes=reference_size_bytes,
        )
        collect(phase2_trial)

        if phase2_trial.passed:
            return _build(
                optimal_crf=candidate_crf,
                optimal_summary=phase2_trial.summary,
            )

    # ---- Phase 3: refinement at all windows ----
    if candidate_crf <= target.crf_min:
        # Already at the floor; nothing lower to try.
        return _build(optimal_crf=None, optimal_summary=None)

    # When Phase 1 lands the candidate at crf_max in one shot — the
    # typical pattern after cross-pair learning seeds crf_max from a
    # prior pair's optimal — calibration has only one Phase 1 data
    # point and can't fit a slope. Force one extra single-window
    # probe at a lower CRF so the calibration helper has two data
    # points to work with. The probe lands at the midpoint of
    # ``[crf_min, candidate]`` (or one above crf_min if the range is
    # tight) for a wide-baseline slope fit. Cheap (~7s for one
    # single-window encode) and only fires when calibration would
    # otherwise be silent.
    if not skip_phase2:
        phase1_trial_count = sum(
            1 for trial in all_trials if trial.phase == "phase1"
        )
        if phase1_trial_count < MIN_PHASE1_TRIALS_FOR_CALIBRATION:
            calibration_probe_crf = max(
                target.crf_min + 1,
                (target.crf_min + candidate_crf) // 2,
            )
            if calibration_probe_crf < candidate_crf:
                logger.info(
                    f"Phase 1 had only "
                    f"{phase1_trial_count} trial(s); probing "
                    f"single-window at crf={calibration_probe_crf} to "
                    f"enable calibration check before step-down.",
                )
                probe_start_time = time.monotonic()
                probe_measurement = evaluate_trial_for_windows(
                    calibration_probe_crf, [middle_window_index],
                )
                probe_elapsed = time.monotonic() - probe_start_time
                probe_trial = _build_trial_from_measurement(
                    crf=calibration_probe_crf,
                    measurement=probe_measurement,
                    elapsed=probe_elapsed,
                    target_for_verdict=target,
                    phase="phase1",
                    reference_size_bytes=reference_size_bytes,
                )
                collect(probe_trial)

    # Calibration-based hopeless check: when Phase 2 actually ran
    # (i.e. fast-fail didn't skip it), the (Phase 2 - Phase 1) low-
    # percentile delta calibrates the relationship between single-
    # window and full-window measurements for this clip's content.
    # Apply that delta to Phase 1's other CRFs to predict the BEST
    # achievable full-window low (at crf_min). If even that's below
    # the cap-relaxed target, step-down + bisection are guaranteed
    # to fail; skip them and go straight to cascade. Triggers earlier
    # than the slope-based hopelessness check below (which needs
    # step-down trials to fit a slope).
    if not skip_phase2 and _calibration_says_phase3_hopeless(
        all_trials,
        target,
        candidate_crf,
        relaxation_cap=target_relaxation_cap,
    ):
        logger.notice(
            f"Phase 2 vs Phase 1 calibration says no CRF >= "
            f"{target.crf_min} will reach the cap-relaxed percentile "
            f"target; skipping step-down and bisection, proceeding to "
            f"cascade fallback.",
        )
        return _build(optimal_crf=None, optimal_summary=None)

    # When Phase 2's deficit on the limiting axis is wider than
    # step-down's mathematical maximum improvement (slope * step-down
    # trials), step-down is guaranteed to fail every probe and
    # bisection has to do the actual work. Skip step-down and let
    # bisection take over the wider [crf_min, candidate-1] range.
    # Saves ~3 wasted full-windows trials on clips where the seeded
    # candidate (or Phase 1's pick) sits far from the actual
    # rightmost-passing CRF — which is the typical pattern when
    # cross-pair learning's seed turns out to be wrong.
    skip_step_down = not skip_phase2 and _calibration_says_step_down_wont_help(
        all_trials,
        target,
        step_down_limit=phase3_step_down_limit,
        relaxation_cap=target_relaxation_cap,
    )

    last_step_down_failure = candidate_crf
    if skip_step_down:
        logger.info(
            "calibration predicts step-down's max "
            "improvement won't close Phase 2's deficit on the "
            "limiting axis; skipping step-down and going directly "
            f"to bisection over crf_min={target.crf_min} to "
            f"candidate-1={candidate_crf - 1}.",
        )

    # Step-down sub-stage: linearly walk candidate-1, candidate-2, ...
    # at full sampling. Phase 1's mean-only bias is typically small so
    # the answer often sits next-door to the candidate; step-down finds
    # it in 1-2 trials. Each step-down probe softens the verdict target
    # by ``target_relaxation_per_step`` (capped at
    # ``target_relaxation_cap``) so a borderline-failing measurement is
    # accepted rather than triggering further refinement — a deliberate
    # speed-vs-quality trade. Skipped entirely when calibration predicts
    # the deficit can't be closed (see above).
    for step in range(1, 0 if skip_step_down else phase3_step_down_limit + 1):
        next_crf = candidate_crf - step
        if next_crf < target.crf_min:
            break
        start_time = time.monotonic()
        step_measurement = evaluate_trial_for_windows(next_crf, all_window_indices)
        step_elapsed = time.monotonic() - start_time
        step_target = _relaxed_target(
            target,
            depth=step,
            per_step=target_relaxation_per_step,
            cap=target_relaxation_cap,
        )
        step_trial = _build_trial_from_measurement(
            crf=next_crf,
            measurement=step_measurement,
            elapsed=step_elapsed,
            target_for_verdict=step_target,
            phase="phase3",
            reference_size_bytes=reference_size_bytes,
        )
        collect(step_trial)
        if step_trial.passed:
            return _build(
                optimal_crf=next_crf,
                optimal_summary=step_trial.summary,
            )
        last_step_down_failure = next_crf

    # Step-down exhausted without finding a pass; fall through to
    # bisection over the remaining lower range. The orchestrator's
    # per-(crf, window_index) cache makes any re-tested CRF free.
    # Bisection runs at the next deeper relaxation (one step beyond
    # step-down's last trial) and keeps that level for all bisection
    # probes — the search has already committed to "we're past strict;
    # find anything that passes within cap."
    if last_step_down_failure <= target.crf_min:
        return _build(optimal_crf=None, optimal_summary=None)

    # Hopeless-shortfall early exit: extrapolate the slope of the
    # limiting axis from the step-down measurements; if even crf_min
    # won't reach the cap-relaxed target, skip bisection and go
    # straight to the cascade fallback. Bisection trials cost ~3x a
    # step-down trial each; on adversarial clips (flash frames, etc.)
    # they all fail by the same wide margin step-down already
    # demonstrated, so they're pure waste.
    if _refinement_extrapolation_says_hopeless(
        all_trials,
        target,
        relaxation_cap=target_relaxation_cap,
    ):
        logger.notice(
            "refinement extrapolation says no CRF >= "
            f"{target.crf_min} will reach the cap-relaxed percentile "
            "target; skipping bisection and proceeding to cascade fallback.",
        )
        return _build(optimal_crf=None, optimal_summary=None)

    bisection_relaxed_target = _relaxed_target(
        target,
        depth=phase3_step_down_limit + 1,
        per_step=target_relaxation_per_step,
        cap=target_relaxation_cap,
    )
    phase3_target = replace(bisection_relaxed_target, crf_max=last_step_down_failure - 1)
    phase3_result = legacy_find_optimal_crf(
        target=phase3_target,
        evaluate_trial=lambda crf: evaluate_trial_for_windows(
            crf,
            all_window_indices,
        ),
        sample_windows=sample_windows,
        reference_size_bytes=reference_size_bytes,
        final_frames_estimate=final_frames_estimate,
        on_trial_complete=collect,
        phase="phase3",
    )
    return _build(
        optimal_crf=phase3_result.optimal_crf,
        optimal_summary=phase3_result.optimal_summary,
    )


# Back-compat aliases. The bisection path was renamed to ``legacy_*``
# when curve-fit became the default search algorithm; old code that
# imports the bare names (notably the test suite) continues to resolve
# through these aliases. New code should use the ``legacy_*`` names so
# the deprecated status of the path is visible at the call site.
find_optimal_crf = legacy_find_optimal_crf
find_optimal_crf_two_phase = legacy_find_optimal_crf_two_phase
