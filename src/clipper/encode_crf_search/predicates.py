"""Pure decision predicates and calibration helpers for the CRF search.

Everything in here takes :class:`CrfSearchTrial` / :class:`VmafSummary`
inputs and returns a verdict (bool, distance, prediction). No I/O, no
algorithm orchestration — this module is the place to look when
debugging "why did the search make this decision."

Layered (rough):

1. **Atomic verdicts** — :func:`passes_targets`,
   :func:`is_trial_confidently_decided`,
   :func:`_distance_to_pass_boundary`. Used everywhere.
2. **Cross-trial calibration helpers** — given a small set of trials,
   predict outcomes at other CRFs. Drive the various
   "skip step-down / skip bisection / cascade fallback" decisions.
3. **Constants** — safety buffers and confidence margins used by the
   above. Centralized here so the trade-offs they encode are visible
   in one place rather than scattered through the search file.
"""

from __future__ import annotations

from clipper.quality import VmafSummary

from .types import (
    CrfSearchTarget,
    CrfSearchTrial,
    get_low_percentile_value,
    min_frames_for_low_percentile,
)

# ---------------------------------------------------------------------------
# Constants — safety margins and confidence thresholds
# ---------------------------------------------------------------------------

# Margin (in VMAF points, applied to both mean and p1) by which the partial
# trial summary must clear / miss the targets for us to decide further
# windows wouldn't change the verdict. Same magnitude as the upward-
# expansion headroom thresholds — both express "this trial isn't on the
# boundary, so additional data is unlikely to flip it".
DEFAULT_CONFIDENCE_MARGIN: float = 3.0


# Buffer (in VMAF points) added to the extrapolated low-percentile
# value before comparing to the cap-relaxed target. Protects against
# slope-estimation error from a small number of refinement trials.
# Skip bisection only when extrapolation has at least this margin of
# confidence that lower CRFs won't reach the relaxed target.
DEFAULT_HOPELESS_EXTRAPOLATION_BUFFER: float = 1.0


# Buffer for the step-down-skip decision. Smaller than the full
# hopeless buffer because the failure mode of "wrong skip" is mild:
# bisection still runs over the wider [crf_min, candidate-1] range
# and finds the pass anyway, costing at most a few extra bisection
# trials. Worth the slightly more aggressive trigger to reliably
# eliminate step-down trials that mathematically can't close Phase 2's
# deficit.
DEFAULT_STEP_DOWN_SKIP_BUFFER: float = 0.5


# ---------------------------------------------------------------------------
# Atomic verdicts
# ---------------------------------------------------------------------------


def is_trial_confidently_decided(
    summary: VmafSummary,
    target: CrfSearchTarget,
    confidence_margin: float = DEFAULT_CONFIDENCE_MARGIN,
) -> bool:
    """Whether ``summary`` is far enough from the pass/fail boundary that
    additional sampled windows wouldn't change the pass/fail verdict.

    Used by the progressive-sampling encode loop to short-circuit the
    remaining window encodes once we've measured enough to be sure of the
    answer. Saves ~33-67% of trial encode time on clips that are clearly
    easy or clearly hard, which is most of them outside the bisection
    boundary.

    Logic:

    - **Frame count below the configured percentile's threshold**: not
      yet decided. The orchestrator must encode another window so the
      low-percentile measurement becomes meaningful (matching the
      adaptive :func:`passes_targets` predicate).
    - **Confident pass**: BOTH mean and the low percentile sit at least
      ``confidence_margin`` above their targets. Adding another window's
      frames is very unlikely to drop either by enough to flip the
      verdict.
    - **Confident fail**: EITHER mean or the low percentile sits at
      least ``confidence_margin`` below its target. One axis failing is
      enough to fail the trial; if it's already deeply failing, more
      frames won't save it.
    - **Otherwise**: at the boundary on at least one axis. Encode another
      window for a more reliable read.
    """
    min_frames = min_frames_for_low_percentile(target.target_vmaf_low_pct)
    if summary.frame_count < min_frames:
        return False

    low_value = get_low_percentile_value(summary, target.target_vmaf_low_pct)
    mean_pass = summary.mean >= target.target_vmaf_mean + confidence_margin
    mean_fail = summary.mean <= target.target_vmaf_mean - confidence_margin
    low_pass = low_value >= target.target_vmaf_low + confidence_margin
    low_fail = low_value <= target.target_vmaf_low - confidence_margin

    confident_pass = mean_pass and low_pass
    confident_fail = mean_fail or low_fail
    return confident_pass or confident_fail


def passes_targets(
    summary: VmafSummary,
    target: CrfSearchTarget,
) -> tuple[bool, bool]:
    """Whether ``summary`` clears the user's quality targets, and whether
    the low-percentile check actually got applied.

    Returns ``(passed, low_enforced)``:

    - ``passed``: trial cleared every check that applied
    - ``low_enforced``: ``True`` when the trial had at least
      :func:`min_frames_for_low_percentile` combined frames so the
      configured low percentile was part of the decision; ``False`` when
      the trial fell below the threshold and only mean was checked.
      Surfaced so logs can show ``PASS (mean only)`` vs
      ``PASS (mean+p5)`` etc.

    Mean is *always* enforced (a 1-frame trial is still meaningful for
    mean). The low percentile is dropped for too-few-frame trials so
    short clips don't get spurious failures from a single noisy frame
    that the percentile interpolation can't smooth over.
    """
    min_frames = min_frames_for_low_percentile(target.target_vmaf_low_pct)
    low_enforced = summary.frame_count >= min_frames
    if summary.mean < target.target_vmaf_mean:
        return False, low_enforced
    if low_enforced:
        low_value = get_low_percentile_value(summary, target.target_vmaf_low_pct)
        if low_value < target.target_vmaf_low:
            return False, True
        return True, True
    return True, low_enforced


def _distance_to_pass_boundary(
    summary: VmafSummary, target: CrfSearchTarget,
) -> float:
    """Signed VMAF distance from a trial's summary to the pass boundary.

    Positive = the trial passed by this margin; negative = it failed by
    this margin. The metric mirrors :func:`passes_targets`'s decision
    logic: mean is always part of the distance, the configured low
    percentile only when the trial has enough frames to enforce it.
    Returns the *minimum* of the relevant axes — the limiting target —
    so interpolation tracks the axis closest to failing.
    """
    mean_distance = summary.mean - target.target_vmaf_mean
    min_frames = min_frames_for_low_percentile(target.target_vmaf_low_pct)
    if summary.frame_count >= min_frames:
        low_value = get_low_percentile_value(
            summary, target.target_vmaf_low_pct,
        )
        low_distance = low_value - target.target_vmaf_low
        return min(mean_distance, low_distance)
    return mean_distance


# ---------------------------------------------------------------------------
# Cross-trial calibration helpers
# ---------------------------------------------------------------------------


def _predict_phase2_fast_fail(
    summary: VmafSummary,
    target: CrfSearchTarget,
    *,
    n_windows: int,
    safety_margin: float,
) -> tuple[bool, str]:
    """Predict whether a Phase 2 trial at the same CRF would fail.

    Uses Phase 1's single-window summary to estimate what the
    full-windows trial will measure:

    - **Mean** barely shifts when more frames are sampled (mean of more
      samples ≈ mean of fewer samples for stationary content). The
      Phase 1 mean is a direct proxy for Phase 2's mean.
    - **Low percentile** is the trickier axis. With ``M`` more samples
      the percentile boundary moves upward roughly as ``p_k(NxM) ≈
      p_{kxM}(N)`` — the "worst k%" of NxM frames sits at the position
      "worst kxM%" of N frames lands. We don't carry every percentile
      in :class:`VmafSummary`, but for the typical p5 target with 3
      windows we use Phase 1's p10 as the bridge (5%x3 ≈ 15%, close
      enough to p10 to be a useful predictor). For p1 target we use
      Phase 1's p5 by the same logic.

    The prediction errs conservative: only returns ``True`` when the
    predicted measurement is below target by at least ``safety_margin``
    on either axis. False positives (skip Phase 2 when it would have
    passed) cost ~1 CRF of compression efficiency — Phase 3 step-down
    finds the next CRF down — but never quality, since the final
    encode still clears the user's target. False negatives (run Phase 2
    when it would fail) are status quo, no regression.

    Returns ``(should_skip, reason)``. ``reason`` is a short human-
    readable string for the log line; empty when ``should_skip`` is
    ``False``.
    """
    if summary.mean + safety_margin < target.target_vmaf_mean:
        return True, (
            f"predicted mean={summary.mean:.2f} below target "
            f"{target.target_vmaf_mean}"
        )

    # Pick the percentile bridge. p_k(combined) ≈ p_{kxn_windows}(single).
    # Available single-window percentiles in the summary: p1, p5, p10.
    if target.target_vmaf_low_pct == 5:
        # p5(combined) ≈ p15(single); we approximate with p10.
        predicted_low = summary.p10
        predictor_label = f"p10(single)→p{target.target_vmaf_low_pct}(combined)"
    elif target.target_vmaf_low_pct == 1:
        # p1(combined) ≈ p3(single); we approximate with p5.
        predicted_low = summary.p5
        predictor_label = f"p5(single)→p{target.target_vmaf_low_pct}(combined)"
    else:
        # p10(combined) ≈ p30(single); we don't carry p20/p30 in the
        # summary, so no usable bridge. Fall back to running Phase 2.
        return False, ""

    # Only fast-fail on the percentile axis when Phase 2 will actually
    # enforce its percentile (combined frame count above the floor).
    # Otherwise Phase 2 ends up mean-only too and our percentile
    # prediction wouldn't gate the verdict in either direction.
    min_frames = min_frames_for_low_percentile(target.target_vmaf_low_pct)
    estimated_phase2_frames = n_windows * summary.frame_count
    if estimated_phase2_frames < min_frames:
        return False, ""

    if predicted_low + safety_margin < target.target_vmaf_low:
        return True, (
            f"predicted {predictor_label}={predicted_low:.2f} below target "
            f"{target.target_vmaf_low}"
        )
    return False, ""


def _phase1_to_phase2_bridge_pct(target_pct: int) -> int | None:
    """Single-window percentile to use as the predictor of full-window
    target_pct. Mirrors the bridge logic used by Phase 2 fast-fail
    prediction: ``p_k(combined) ~= p_{k * n_windows}(single)``, so single
    p10 predicts multi p5 (with 3 windows), single p5 predicts multi p1.

    Returns ``None`` when the user's target percentile has no usable
    single-window bridge in :class:`VmafSummary` (e.g. p10 target —
    we'd need single p20+ which isn't carried).
    """
    if target_pct == 5:
        return 10
    if target_pct == 1:
        return 5
    return None


def _calibration_says_step_down_wont_help(
    trials: list[CrfSearchTrial],
    target: CrfSearchTarget,
    *,
    step_down_limit: int,
    relaxation_cap: float,
    safety_buffer: float = DEFAULT_STEP_DOWN_SKIP_BUFFER,
) -> bool:
    """Predict whether Phase 3's step-down sub-stage can close the gap
    between Phase 2's measurement and the cap-relaxed target.

    Step-down probes ``candidate-1, candidate-2, ..., candidate-N`` at
    full sampling. Each step-down trial's full-window low-percentile
    measurement improves over Phase 2's by approximately the same amount
    that Phase 1's single-window bridge improved per CRF (assuming the
    Phase 2-vs-Phase 1 calibration delta is roughly constant across CRFs,
    which holds for typical content). Maximum total improvement after
    ``step_down_limit`` trials: ``|slope| * step_down_limit``.

    If Phase 2's deficit (cap-relaxed target - phase2_low) exceeds that
    expected improvement plus a safety buffer, step-down is mathematically
    unable to find a passing CRF. Skip it and let bisection probe deeper
    into the search range directly. Saves the wasted step-down trials
    when the seeded candidate (or Phase 1's pick) is far from the actual
    rightmost-passing CRF.

    Returns ``False`` (let step-down run) when the predicted gap is
    closeable, when there's not enough Phase 1 data to fit a slope, when
    the slope is anomalous, or when Phase 2 already clears the relaxed
    target (no gap to close).
    """
    bridge_pct = _phase1_to_phase2_bridge_pct(target.target_vmaf_low_pct)
    if bridge_pct is None:
        return False

    phase1_passing = [
        t for t in trials if t.phase == "phase1" and t.passed
    ]
    phase2_trials = [t for t in trials if t.phase == "phase2"]
    if not phase2_trials or len(phase1_passing) < 2:
        return False

    target_pct = target.target_vmaf_low_pct
    phase2_low = get_low_percentile_value(phase2_trials[0].summary, target_pct)
    cap_relaxed_target = target.target_vmaf_low - relaxation_cap
    deficit = cap_relaxed_target - phase2_low
    if deficit <= 0:
        # Phase 2 actually passes cap-relaxed (caller normally wouldn't
        # call us here, but guard against misuse). Step-down might find
        # a strict pass; let it run.
        return False

    # Slope from PASSING Phase 1 trials only. Mixing in failing trials
    # produces an artificially-steep "across-cliff" slope on clips
    # whose VMAF curve has a sharp pass/fail boundary, overstating
    # what step-down can deliver. Passing-only slope captures the
    # gradual within-region improvement that step-down's neighboring
    # CRFs will actually ride along.
    high_passing = max(phase1_passing, key=lambda t: t.crf)
    low_passing = min(phase1_passing, key=lambda t: t.crf)
    if high_passing.crf == low_passing.crf:
        return False
    high_bridge = get_low_percentile_value(high_passing.summary, bridge_pct)
    low_bridge = get_low_percentile_value(low_passing.summary, bridge_pct)
    slope = (low_bridge - high_bridge) / (low_passing.crf - high_passing.crf)
    if slope >= 0:
        # Anomaly or cliff (passing trials all measured the same bridge
        # value, slope == 0). Don't trust the prediction; let step-down
        # run and discover the actual rate of improvement.
        return False

    # Maximum improvement step-down can deliver: |slope| times step_down_limit trials.
    expected_improvement = abs(slope) * step_down_limit
    return expected_improvement + safety_buffer < deficit


def _calibration_says_phase3_hopeless(
    trials: list[CrfSearchTrial],
    target: CrfSearchTarget,
    candidate_crf: int,
    *,
    relaxation_cap: float,
    safety_buffer: float = DEFAULT_HOPELESS_EXTRAPOLATION_BUFFER,
) -> bool:
    """Check whether Phase 2's measurement, calibrated against the
    Phase 1 single-window data at the same CRF, predicts that no CRF
    in ``[crf_min, candidate_crf - 1]`` will reach the cap-relaxed
    target. If so, signal the orchestrator to skip step-down + bisection
    entirely and proceed straight to the cascade fallback.

    Why this works: the gap between a clip's single-window VMAF
    measurement (Phase 1) and its full-windows measurement (Phase 2)
    is content-determined and roughly stable across CRFs. For typical
    content the gap is small (~+1 point because percentile bridges to
    a higher percentile in the smaller-sample distribution); for
    transient-bad content (white camera flashes, brief artifacts) the
    gap is large and negative because full sampling catches the bad
    frames the middle window missed. Once we have *one* matched pair
    of (Phase 1 single, Phase 2 full) measurements, that gap is a
    clip-specific calibration we can apply to the rest of Phase 1's
    cached single-window data to predict full-window outcomes at other
    CRFs without encoding.

    Algorithm:
    1. Compute ``delta = phase2_full_low - phase1_candidate_bridge``.
       The bridge is single p10 (when target is p5) or single p5 (p1
       target) — same predictor fast-fail used.
    2. Fit the slope of single-window bridge vs CRF from existing
       Phase 1 trials.
    3. Extrapolate single-window bridge to ``crf_min``.
    4. Apply ``delta`` to get predicted full-window low at crf_min.
       This is the BEST achievable in the search range (lower CRF =
       more bits = higher VMAF).
    5. If predicted + ``safety_buffer`` is still below the cap-relaxed
       target, no CRF in range will pass — declare hopeless.

    Returns ``False`` when the data isn't sufficient for a confident
    prediction (no Phase 2 trial, fewer than 2 Phase 1 trials, no
    matching Phase 1 candidate measurement, anomalous slope, no
    bridge percentile available, etc.) — let the existing pipeline run.
    """
    bridge_pct = _phase1_to_phase2_bridge_pct(target.target_vmaf_low_pct)
    if bridge_pct is None:
        return False

    phase1_trials = [t for t in trials if t.phase == "phase1"]
    phase2_trials = [t for t in trials if t.phase == "phase2"]
    if not phase2_trials or len(phase1_trials) < 2:
        return False

    # The candidate's Phase 1 single-window measurement is what
    # calibrates against the Phase 2 result.
    phase1_candidate = next(
        (t for t in phase1_trials if t.crf == candidate_crf), None,
    )
    if phase1_candidate is None:
        return False

    target_pct = target.target_vmaf_low_pct
    phase2_low = get_low_percentile_value(phase2_trials[0].summary, target_pct)
    phase1_candidate_bridge = get_low_percentile_value(
        phase1_candidate.summary, bridge_pct,
    )
    delta = phase2_low - phase1_candidate_bridge

    # Slope of the single-window bridge percentile vs CRF, fitted
    # from the highest- and lowest-CRF Phase 1 trials.
    high_phase1 = max(phase1_trials, key=lambda t: t.crf)
    low_phase1 = min(phase1_trials, key=lambda t: t.crf)
    if high_phase1.crf == low_phase1.crf:
        return False
    high_bridge = get_low_percentile_value(high_phase1.summary, bridge_pct)
    low_bridge = get_low_percentile_value(low_phase1.summary, bridge_pct)
    slope = (low_bridge - high_bridge) / (low_phase1.crf - high_phase1.crf)
    if slope >= 0:
        # Anomaly: lower CRF didn't improve single-window bridge.
        # Don't trust extrapolation; let step-down run.
        return False

    # Extrapolate single-window bridge value at crf_min, then apply
    # the calibration delta to predict full-window low.
    extrapolated_bridge_at_min = (
        phase1_candidate_bridge + slope * (target.crf_min - candidate_crf)
    )
    predicted_full_low_at_min = extrapolated_bridge_at_min + delta

    cap_relaxed_target = target.target_vmaf_low - relaxation_cap
    return predicted_full_low_at_min + safety_buffer < cap_relaxed_target


def _refinement_extrapolation_says_hopeless(
    trials: list[CrfSearchTrial],
    target: CrfSearchTarget,
    *,
    relaxation_cap: float,
    safety_buffer: float = DEFAULT_HOPELESS_EXTRAPOLATION_BUFFER,
) -> bool:
    """Predict whether bisection over ``[crf_min, last_step_down_failure]``
    can reach the cap-relaxed low-percentile target, by linearly
    extrapolating from step-down measurements.

    On adversarial clips (e.g. periodic high-luminance "flash" frames
    that VMAF NEG penalizes heavily despite their perceptual
    invisibility), the percentile measurement saturates well below
    target across the entire CRF range. Bisection trials at crf_min
    don't lift the percentile enough to matter, but each costs a full
    3-window encode. Returns ``True`` when extrapolation says even
    crf_min won't close the gap, signaling the orchestrator to skip
    bisection and go straight to the cascade fallback.

    Algorithm: take the highest-CRF and lowest-CRF Phase 2/3 trials,
    fit a line through their low-percentile values vs CRF, and
    extrapolate to ``target.crf_min``. If extrapolated value plus
    ``safety_buffer`` is still below ``target.target_vmaf_low -
    relaxation_cap``, declare hopeless.

    Conservatism notes:

    - Returns ``False`` when fewer than 2 Phase 2/3 trials are
      available (no slope possible).
    - Returns ``False`` when the slope is non-negative (anomaly:
      lower CRF didn't improve quality). Could indicate noisy
      measurements; let bisection run.
    - The safety buffer is calibrated against typical encoder
      saturation behavior — VMAF improvements taper off at very low
      CRFs, so linear extrapolation tends to *over*-predict the value
      at crf_min. Buffer guards against the rare opposite case.
    """
    full_trials = [
        trial for trial in trials
        if trial.phase in {"phase2", "phase3"}
    ]
    if len(full_trials) < 2:
        return False

    high_crf_trial = max(full_trials, key=lambda t: t.crf)
    low_crf_trial = min(full_trials, key=lambda t: t.crf)
    if high_crf_trial.crf == low_crf_trial.crf:
        return False

    pct = target.target_vmaf_low_pct
    high_crf_low = get_low_percentile_value(high_crf_trial.summary, pct)
    low_crf_low = get_low_percentile_value(low_crf_trial.summary, pct)

    # Slope: change in percentile value per unit decrease in CRF.
    # Normal sign is negative (low CRF -> higher percentile -> increase
    # as CRF decreases means the (Δlow / ΔCRF) ratio is negative).
    delta_crf = low_crf_trial.crf - high_crf_trial.crf
    slope = (low_crf_low - high_crf_low) / delta_crf
    if slope >= 0:
        # Anomaly — lower CRF gave equal or worse percentile. Don't
        # trust extrapolation.
        return False

    extrapolated_low = low_crf_low + slope * (target.crf_min - low_crf_trial.crf)
    cap_relaxed_target = target.target_vmaf_low - relaxation_cap
    return extrapolated_low + safety_buffer < cap_relaxed_target


def _find_best_pass_at_fallback_level(
    trials: list[CrfSearchTrial],
    target: CrfSearchTarget,
    *,
    fallback_pct: int | None,
    relaxation_cap: float,
) -> CrfSearchTrial | None:
    """Find the highest-CRF Phase 2/3 trial passing at a more permissive
    fallback level than the user's chosen percentile.

    Used as a graceful-degradation cascade after the strict-with-relaxed
    search returns no pass. Two flavors:

    - ``fallback_pct=<int>``: re-evaluate cached trials against
      ``target.target_vmaf_low`` measured at a *higher* percentile
      (e.g. p10 instead of p5). Useful for clips whose worst frames
      are perceptually transient (white camera flashes, cuts) and drag
      down strict p5 / p1 measurements without affecting the bulk of
      the clip's quality. The threshold value stays the same; only
      the percentile bracket softens.
    - ``fallback_pct=None``: mean-only fallback. Drop the percentile
      check entirely; pick the highest CRF clearing the relaxed mean
      target. Last resort before falling back to ``crf_min``.

    Both use ``target.target_vmaf_mean - relaxation_cap`` as the mean
    floor (consistent with the relaxation already applied during
    refinement) and ``target.target_vmaf_low - relaxation_cap`` as the
    low-percentile floor when one applies.

    Only Phase 2/3 trials are eligible because Phase 1 measurements are
    single-window and not representative of the final encode.
    """
    relaxed_mean = target.target_vmaf_mean - relaxation_cap
    relaxed_low = target.target_vmaf_low - relaxation_cap
    candidates: list[CrfSearchTrial] = []
    for trial in trials:
        if trial.phase not in {"phase2", "phase3"}:
            continue
        if trial.summary.mean < relaxed_mean:
            continue
        if fallback_pct is not None:
            low_value = get_low_percentile_value(trial.summary, fallback_pct)
            if low_value < relaxed_low:
                continue
        candidates.append(trial)
    if not candidates:
        return None
    return max(candidates, key=lambda t: t.crf)
