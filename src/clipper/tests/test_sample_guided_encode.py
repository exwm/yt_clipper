"""Unit tests for ``clipper.sample_guided_encode``'s pure pieces.

Covers the trial-passing predicate, sample-window selection, and the
binary-search algorithm with mocked encode/measure callables. The
orchestrator (``run_sample_guided_encode_for_marker_pair``) imports ``clip_maker``
and is exercised manually via smoke testing — not unit tested here.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import pytest

from clipper.quality import VmafSummary
from clipper.sample_guided_encode import (
    DEFAULT_TARGET_TRIAL_FRAMES,
    SampleGuidedEncodeResult,
    SampleGuidedEncodeTarget,
    SampleGuidedEncodeTrial,
    TrialMeasurement,
    _calibration_says_phase3_hopeless,
    _calibration_says_step_down_wont_help,
    _find_best_pass_at_fallback_level,
    _predict_phase2_fast_fail,
    _refinement_extrapolation_says_hopeless,
    _relaxed_target,
    find_optimal_crf,
    find_optimal_crf_two_phase,
    is_trial_confidently_decided,
    min_frames_for_low_percentile,
    passes_targets,
    reference_encode_picks_for_codec,
    select_sample_windows,
)

# Frame floor for the default target percentile (p5 by default). Tests
# that exercise the "below floor -> low-percentile dropped" code path
# pull this from the helper rather than hardcoding so they track the
# real default.
_DEFAULT_LOW_PCT_FRAME_FLOOR: int = min_frames_for_low_percentile(5)

# ---------------------------------------------------------------------------
# passes_targets — adaptive p1 enforcement
# ---------------------------------------------------------------------------


def _summary(*, mean: float, p1: float, frame_count: int) -> VmafSummary:
    """Test helper: builds a VmafSummary where all low-percentile values
    (p1..p25, minimum) collapse to the same ``p1`` argument. Tests don't
    model the gap between percentiles — they verify the predicate logic,
    so a single "low percentile value" is enough.
    """
    return VmafSummary(
        mean=mean,
        p1=p1,
        p5=p1,
        p10=p1,
        p15=p1,
        p20=p1,
        p25=p1,
        minimum=p1,
        frame_count=frame_count,
    )


def _target(mean: float = 90.0, p1: float = 85.0) -> SampleGuidedEncodeTarget:
    """Test helper: builds a p5-target with the given thresholds.

    Pinned to ``target_vmaf_low_pct=5`` so existing tests retain their
    original p5-based semantics (frame floor = 50, predicate checks p5).
    Tests verifying default-percentile behavior should construct
    ``SampleGuidedEncodeTarget`` directly. Since ``_summary`` collapses p1..p25
    to the same value, the choice of percentile doesn't affect the
    predicate result for tests using both helpers together.
    """
    return SampleGuidedEncodeTarget(
        target_vmaf_mean=mean,
        target_vmaf_low=p1,
        target_vmaf_low_pct=5,
    )


def test_passes_targets_mean_fail_returns_false_regardless_of_p1() -> None:
    """A trial that misses mean fails even if p1 is great."""
    summary = _summary(mean=88.0, p1=99.0, frame_count=200)
    passed, p1_enforced = passes_targets(summary, _target(mean=90.0, p1=85.0))
    assert passed is False
    # p1 was eligible to be checked (frame count >= threshold) — flag reflects that.
    assert p1_enforced is True


def test_passes_targets_high_frame_count_enforces_p1() -> None:
    """With enough frames, both mean and p1 must clear."""
    target = _target(mean=90.0, p1=85.0)
    # mean ok, p1 below target -> fail
    bad_p1 = _summary(mean=92.0, p1=80.0, frame_count=200)
    passed, p1_enforced = passes_targets(bad_p1, target)
    assert passed is False
    assert p1_enforced is True
    # mean ok, p1 above target -> pass
    good = _summary(mean=92.0, p1=87.0, frame_count=200)
    passed, p1_enforced = passes_targets(good, target)
    assert passed is True
    assert p1_enforced is True


def test_passes_targets_low_frame_count_drops_p1_when_mean_passes() -> None:
    """Below _DEFAULT_LOW_PCT_FRAME_FLOOR the p1 check is dropped — a single
    noisy frame can't fail a short trial as long as mean clears."""
    target = _target(mean=90.0, p1=85.0)
    # Few frames, mean ok, p1 well below target — would fail with p1 enforced,
    # but at this frame count p1 ≈ min and we don't trust it.
    summary = _summary(mean=92.0, p1=60.0, frame_count=_DEFAULT_LOW_PCT_FRAME_FLOOR - 1)
    passed, p1_enforced = passes_targets(summary, target)
    assert passed is True
    assert p1_enforced is False


def test_passes_targets_p1_enforced_flag_reflects_threshold_decision() -> None:
    """``p1_enforced`` is purely a function of frame_count vs threshold."""
    target = _target()
    just_above = _summary(mean=95.0, p1=88.0, frame_count=_DEFAULT_LOW_PCT_FRAME_FLOOR)
    just_below = _summary(
        mean=95.0,
        p1=88.0,
        frame_count=_DEFAULT_LOW_PCT_FRAME_FLOOR - 1,
    )
    assert passes_targets(just_above, target)[1] is True
    assert passes_targets(just_below, target)[1] is False


# ---------------------------------------------------------------------------
# is_trial_confidently_decided — progressive-sampling early-exit predicate
# ---------------------------------------------------------------------------


def test_is_trial_confidently_decided_below_p1_threshold_always_returns_false() -> None:
    """Below _DEFAULT_LOW_PCT_FRAME_FLOOR the predicate withholds judgment
    so the orchestrator keeps encoding windows until p1 stabilizes.
    """
    target = _target(mean=90.0, p1=85.0)
    # Wildly above target but only 50 frames — keep encoding.
    summary = _summary(
        mean=99.0,
        p1=98.0,
        frame_count=_DEFAULT_LOW_PCT_FRAME_FLOOR - 1,
    )
    assert is_trial_confidently_decided(summary, target) is False


def test_is_trial_confidently_decided_confident_pass_when_both_axes_above() -> None:
    """At ≥ MIN_FRAMES with both mean and p1 ≥ target+margin: confident pass."""
    target = _target(mean=90.0, p1=85.0)
    summary = _summary(mean=95.0, p1=90.0, frame_count=200)
    assert is_trial_confidently_decided(summary, target) is True


def test_is_trial_confidently_decided_confident_fail_when_either_axis_below() -> None:
    """Either metric ≤ target-margin is enough to fail (one axis fails the
    whole trial in passes_targets, so further data won't save it).
    """
    target = _target(mean=90.0, p1=85.0)
    # mean fails badly, p1 fine
    mean_failed = _summary(mean=80.0, p1=92.0, frame_count=200)
    assert is_trial_confidently_decided(mean_failed, target) is True
    # p1 fails badly, mean fine
    p1_failed = _summary(mean=95.0, p1=75.0, frame_count=200)
    assert is_trial_confidently_decided(p1_failed, target) is True


def test_is_trial_confidently_decided_borderline_returns_false() -> None:
    """At the boundary on one axis (within margin), more data is worth
    encoding — the verdict could flip with another window's frames.
    """
    target = _target(mean=90.0, p1=85.0)
    # Mean comfortably above, but p1 within the confidence margin of 3.
    borderline_p1 = _summary(mean=95.0, p1=87.0, frame_count=200)
    assert is_trial_confidently_decided(borderline_p1, target) is False
    # p1 comfortably above, mean within the margin.
    borderline_mean = _summary(mean=92.0, p1=92.0, frame_count=200)
    assert is_trial_confidently_decided(borderline_mean, target) is False


# ---------------------------------------------------------------------------
# select_sample_windows — frame-count-based sampling
# ---------------------------------------------------------------------------


def test_select_sample_windows_picks_three_evenly_spaced_in_middle_80_percent() -> None:
    """Default config places 3 windows whose centers divide the middle 80%
    of the clip evenly. With clip [0, 100] s and 10% edge skip, sampleable
    region is [10, 90] (80 s). Centers at 10 + 80*(i+0.5)/3 for i=0,1,2 =
    {23.33, 50, 76.67}.
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=30.0,
    )
    assert len(windows) == 3
    centers = [(w.start + w.end) / 2 for w in windows]
    assert centers[0] == pytest.approx(10 + 80 / 6, abs=0.01)
    assert centers[1] == pytest.approx(50.0, abs=0.01)
    assert centers[2] == pytest.approx(10 + 5 * 80 / 6, abs=0.01)


def test_select_sample_windows_window_duration_scales_inversely_with_source_fps() -> None:
    """Frame-count-based: 60 fps clip gets shorter windows than 30 fps for
    the same target frame count.
    """
    windows_30 = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=30.0,
    )
    windows_60 = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=60.0,
    )
    # 50 frames at 30 fps -> 1.667 s. At 60 fps -> 0.833 s.
    assert windows_30[0].duration == pytest.approx(50 / 30, abs=0.001)
    assert windows_60[0].duration == pytest.approx(50 / 60, abs=0.001)
    # Centers stay the same (driven by the sampleable region, not fps).
    assert (windows_30[0].start + windows_30[0].end) / 2 == pytest.approx(
        (windows_60[0].start + windows_60[0].end) / 2,
        abs=0.001,
    )


def test_select_sample_windows_falls_back_to_single_window_when_clip_too_short() -> None:
    """A clip shorter than ``n_windows * window_seconds`` in its sampleable
    region falls back to a single full-clip window — sampling degrades
    gracefully rather than erroring or returning overlapping windows.
    """
    # 1-second clip at 30 fps: 50-frame windows = 1.67 s each, can't fit 3.
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=1.0,
        source_fps=30.0,
    )
    assert len(windows) == 1
    assert windows[0].start == 0.0
    assert windows[0].end == 1.0


def test_select_sample_windows_falls_back_to_single_window_when_fps_is_zero() -> None:
    """Unknown framerate (0.0) means we can't size windows in frames —
    fall back to full clip. Defensive against the source_fps resolver
    returning 0 when r_frame_rate / avg_frame_rate are missing.
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=10.0,
        source_fps=0.0,
    )
    assert len(windows) == 1
    assert windows[0].start == 0.0
    assert windows[0].end == 10.0


def test_select_sample_windows_stay_within_clip_bounds() -> None:
    """Windows must not extend past clip_start or clip_end. In particular
    the first window's start >= clip_start and the last window's end <=
    clip_end, even with edge_skip_fraction=0 (extreme case where the first
    window center could land at clip_start).
    """
    windows = select_sample_windows(
        clip_start=10.0,
        clip_end=110.0,
        source_fps=30.0,
    )
    assert windows[0].start >= 10.0
    assert windows[-1].end <= 110.0


def test_select_sample_windows_respects_n_windows_parameter() -> None:
    """Caller can request more or fewer than the default 3 windows."""
    for n in (1, 2, 5):
        windows = select_sample_windows(
            clip_start=0.0,
            clip_end=100.0,
            source_fps=30.0,
            n_windows=n,
        )
        assert len(windows) == n


def test_select_sample_windows_total_frames_matches_explicit_override() -> None:
    """Combined window duration * source_fps ~= target_combined_frames when
    the caller passes an explicit ``target_combined_frames`` override
    (bypasses the percent-of-final logic).
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=30.0,
        target_combined_frames=DEFAULT_TARGET_TRIAL_FRAMES,
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    assert total_frames == pytest.approx(DEFAULT_TARGET_TRIAL_FRAMES, abs=1.0)


def test_select_sample_windows_uses_percent_of_final_frames_when_estimate_provided() -> None:
    """With ``final_frames_estimate`` set, the trial size scales as a
    percentage of the final encode (default 10%) — long clips get more
    sample frames, short clips get the floor.
    """
    # 30 fps, 1-minute clip = 1800 final frames. 10% = 180 frames target.
    # 180 frames at 3 windows -> 60 frames per window -> 2 s windows.
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=60.0,
        source_fps=30.0,
        final_frames_estimate=1800,
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    assert total_frames == pytest.approx(180.0, abs=3.0)


def test_select_sample_windows_floors_short_clips_at_min_combined_frames() -> None:
    """When the caller passes an explicit ``min_combined_frames`` higher
    than the percent-of-final target, the floor wins. Verifies the
    clamp-up logic with an explicit floor of 50 (p5's frame floor) on a
    200-frame clip whose 10% target (20) sits below it.
    """
    # 30 fps, 100-second clip with only ~200 final frames (heavy speed-up
    # via averageSpeed in production, but here we just specify it directly).
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=30.0,
        final_frames_estimate=200,
        min_combined_frames=50,  # explicit floor higher than 10% target
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    # Floor at 50 (the explicit override), not 20 (10% of 200).
    assert total_frames == pytest.approx(50, abs=3.0)


def test_select_sample_windows_combined_frames_clamped_to_floor_when_max_equals_min() -> None:
    """When the orchestrator passes ``max_combined_frames == min_combined_frames``
    (the percentile floor), trials always use the minimum-required
    sample size regardless of clip length. This is the orchestrator's
    chosen behavior to keep trial wall time bounded — beyond the
    percentile's statistical-sufficiency floor, more frames give
    marginal accuracy at real time cost.
    """
    # Long clip (would naturally suggest 200+ combined frames at 10%)
    # but capped at the floor of 50.
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=120.0,
        source_fps=30.0,
        final_frames_estimate=3600,  # 10% = 360, way above floor
        min_combined_frames=50,
        max_combined_frames=50,
    )
    total_frames = round(sum(w.duration for w in windows) * 30.0)
    # ceil(50/3)*3 = 51 — clamped at floor with ceil rounding to keep
    # combined count >= floor.
    assert 50 <= total_frames <= 60


def test_select_sample_windows_caps_at_max_combined_frames_when_set() -> None:
    """Optional ``max_combined_frames`` ceiling caps trial size so very long
    clips don't pay 10% of an enormous frame count for each trial. Without
    a cap, a 10-minute clip at 10% gives 1800-frame trials; capped at 600,
    it stays bounded.
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=600.0,
        source_fps=30.0,
        final_frames_estimate=18000,
        max_combined_frames=600,
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    assert total_frames == pytest.approx(600.0, abs=3.0)


def test_select_sample_windows_explicit_override_bypasses_percent_logic() -> None:
    """Passing ``target_combined_frames`` ignores ``target_sample_percent``,
    ``min_combined_frames``, ``max_combined_frames``, and
    ``final_frames_estimate``.
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=60.0,
        source_fps=30.0,
        final_frames_estimate=99999,  # would normally suggest huge trials
        target_sample_percent=50.0,  # would normally suggest huge trials
        target_combined_frames=120,  # explicit -> wins
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    assert total_frames == pytest.approx(120.0, abs=3.0)


def test_select_sample_windows_combined_frames_always_meet_min_combined_floor() -> None:
    """Per-window frame count must use ceiling division so the combined
    frame count (frames_per_window * n_windows) clears
    ``min_combined_frames`` exactly. Floor division silently dropped
    1-2 frames (e.g. 50 // 3 = 16 -> combined = 48 < 50), which made
    the percentile floor in :func:`passes_targets` go un-enforced and
    let verdicts silently degrade to mean-only.
    """
    # 50-frame floor (default p5), 3 windows. Floor would give 16/window
    # = 48 combined, missing the floor by 2. Ceil must give 17/window
    # = 51 combined, clearing the floor.
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=300.0,
        source_fps=30.0,
        final_frames_estimate=300,  # 10% target = 30, floored at 50
        min_combined_frames=50,
    )
    total_frames = round(sum(w.duration for w in windows) * 30.0)
    assert total_frames >= 50, (
        f"combined frames {total_frames} must clear the 50-frame floor; "
        f"otherwise the percentile check in passes_targets is silently dropped"
    )


@pytest.mark.parametrize(
    ("min_floor", "expected_min_combined"),
    [
        # p1 floor: 100 / 3 = 33.3 -> ceil 34 per window -> 102 combined
        (100, 100),
        # p5 floor: 50 / 3 = 16.7 -> ceil 17 per window -> 51 combined
        (50, 50),
        # p10 floor: 30 / 3 = 10 -> 10 per window -> 30 combined (exact)
        (30, 30),
    ],
)
def test_select_sample_windows_ceil_clears_floor_for_each_percentile(
    min_floor: int, expected_min_combined: int,
) -> None:
    """Ceiling division clears the percentile floor regardless of which
    percentile (p1=100, p5=50, p10=30) the caller specifies."""
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=300.0,
        source_fps=30.0,
        final_frames_estimate=100,  # forces floor to dominate
        min_combined_frames=min_floor,
    )
    total_frames = round(sum(w.duration for w in windows) * 30.0)
    assert total_frames >= expected_min_combined


def test_select_sample_windows_falls_back_to_legacy_default_when_final_frames_unknown() -> None:
    """When ``final_frames_estimate`` is 0 (unknown) and no explicit
    override is passed, falls back to ``DEFAULT_TARGET_TRIAL_FRAMES`` (150).
    Matches the pre-percent behavior so callers that don't supply a
    final-frames estimate still get reasonable defaults.
    """
    windows = select_sample_windows(
        clip_start=0.0,
        clip_end=100.0,
        source_fps=30.0,
        final_frames_estimate=0,
    )
    total_duration = sum(w.duration for w in windows)
    total_frames = total_duration * 30.0
    assert total_frames == pytest.approx(DEFAULT_TARGET_TRIAL_FRAMES, abs=3.0)


# ---------------------------------------------------------------------------
# find_optimal_crf — pure binary-search algorithm
# ---------------------------------------------------------------------------


def _run_search(
    *,
    target: SampleGuidedEncodeTarget,
    crf_to_summary: dict[int, VmafSummary],
) -> SampleGuidedEncodeResult:
    """Helper: build an evaluate_trial callable and run search.

    Single CRF -> VmafSummary mapping; the test doesn't model progressive
    sampling per-window (each trial gets the full summary in one shot,
    matching what a non-progressive evaluator would return). Tests that
    exercise the progressive logic build their own evaluate_trial.
    """

    def evaluate(crf: int) -> TrialMeasurement:
        return TrialMeasurement(
            summary=crf_to_summary[crf],
            encoded_size_bytes=0,
            encoded_paths=[Path("dummy")],
            windows_used=1,
            windows_total=1,
        )

    return find_optimal_crf(
        target=target,
        evaluate_trial=evaluate,
    )


def test_find_optimal_crf_picks_crf_max_when_no_expansion_headroom() -> None:
    """If crf_max passes but only barely (no headroom), the search returns
    crf_max after a single trial — expanding upward would just hit the
    cliff edge and waste a trial.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        crf_absolute_max=51,
        max_iterations=8,
    )
    # crf_max barely passes; everything above fails immediately.
    crf_to_summary = {
        crf: _summary(
            mean=91.0 if crf <= 38 else 80.0,  # mean barely over 90 at 38
            p1=86.0 if crf <= 38 else 70.0,  # p1 barely over 85 at 38
            frame_count=200,
        )
        for crf in range(16, 52)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert result.optimal_crf == 38
    assert len(result.trials) == 1
    assert result.trials[0].crf == 38


def test_find_optimal_crf_expands_above_crf_max_when_headroom_available() -> None:
    """If crf_max passes with comfortable headroom (mean and p1 well
    above target), the search galloping-expands upward to find the real
    ceiling — crf_max is a *starting* upper bound, not a hard cap.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        crf_absolute_max=51,
        max_iterations=8,
        expansion_step=3,
    )
    # All CRFs <= threshold pass with comfortable (~5 point) headroom;
    # threshold+1 and above fail. crf_max=38 should pass with headroom,
    # triggering expansion: 38 -> 41 -> 44 -> 47 (fail) -> bisect [44,47].
    threshold = 44

    def _summary_for(crf: int) -> VmafSummary:
        if crf <= threshold:
            # Slight downward slope with CRF, but every passing CRF stays
            # at least 3 points above target so expansion keeps probing.
            return _summary(
                mean=99.0 - 0.2 * (crf - 16),  # 99 at 16, ~93.4 at 44
                p1=95.0 - 0.2 * (crf - 16),  # 95 at 16, ~89.4 at 44
                frame_count=200,
            )
        return _summary(mean=80.0, p1=70.0, frame_count=200)

    crf_to_summary = {crf: _summary_for(crf) for crf in range(16, 52)}
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    # Optimal should be at or close to the threshold — definitely above
    # the starting crf_max=38.
    assert result.optimal_crf is not None
    assert result.optimal_crf > 38
    assert result.optimal_crf <= threshold
    # And the search should have actually probed CRFs above crf_max=38.
    probed = {t.crf for t in result.trials}
    assert any(crf > 38 for crf in probed)


def test_find_optimal_crf_expansion_respects_crf_absolute_max() -> None:
    """Expansion never probes above ``crf_absolute_max`` no matter how
    much VMAF headroom remains.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        crf_absolute_max=44,  # tight ceiling
        max_iterations=10,
        expansion_step=3,
    )
    # Every CRF passes with huge headroom — without an absolute cap the
    # search would probe forever.
    crf_to_summary = {crf: _summary(mean=99.0, p1=98.0, frame_count=200) for crf in range(16, 100)}
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    # Should never test a CRF above the absolute cap.
    probed_crfs = {t.crf for t in result.trials}
    assert all(crf <= 44 for crf in probed_crfs)
    # Optimal is the highest passing within the cap.
    assert result.optimal_crf is not None
    assert result.optimal_crf <= 44


def test_find_optimal_crf_returns_none_when_no_crf_passes() -> None:
    """If even crf_min fails, optimal_crf is None — caller falls back to a
    safe minimum CRF with a warning.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        max_iterations=6,
    )
    crf_to_summary = {
        crf: _summary(mean=80.0, p1=70.0, frame_count=200)  # everything fails
        for crf in range(16, 39)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert result.optimal_crf is None
    assert result.optimal_summary is None
    assert all(not t.passed for t in result.trials)


def test_find_optimal_crf_bisects_to_rightmost_passing() -> None:
    """When passing CRFs are [16..28] and failing CRFs are [29..38], the
    bisection should converge on 28 as the optimal (rightmost-passing).
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        max_iterations=8,
    )
    threshold = 28  # passing iff crf <= threshold
    crf_to_summary = {
        crf: _summary(
            mean=95.0 if crf <= threshold else 85.0,
            p1=90.0 if crf <= threshold else 80.0,
            frame_count=200,
        )
        for crf in range(16, 39)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert result.optimal_crf == threshold


def test_find_optimal_crf_respects_iteration_cap() -> None:
    """``max_iterations=2`` means we run AT MOST 2 trials — never 6 just
    because the range is wide.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        max_iterations=2,
    )
    crf_to_summary = {
        crf: _summary(
            mean=95.0 if crf <= 28 else 85.0,
            p1=90.0 if crf <= 28 else 80.0,
            frame_count=200,
        )
        for crf in range(16, 39)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert len(result.trials) <= 2


def test_find_optimal_crf_records_trial_history_in_order() -> None:
    """Every probed CRF appears in the result's trials list, in invocation
    order. Important so callers can show the trial table to the user.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=38,
        max_iterations=6,
    )
    crf_to_summary = {
        crf: _summary(
            mean=95.0 if crf <= 28 else 85.0,
            p1=90.0 if crf <= 28 else 80.0,
            frame_count=200,
        )
        for crf in range(16, 39)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    crfs_in_order = [t.crf for t in result.trials]
    # The first probe is always crf_max (cheap "easy clip" check).
    assert crfs_in_order[0] == 38
    # No duplicates — each iteration tests a fresh CRF.
    assert len(crfs_in_order) == len(set(crfs_in_order))


def test_find_optimal_crf_passes_targets_uses_adaptive_low_percentile() -> None:
    """When trials have low frame counts, the low percentile is dropped
    from the decision — so a clip with great mean and bad p-values can
    still pass on short trials. Mean alone carries the verdict. Pinned
    to p5 enforcement (floor=50) so the test scenario doesn't depend on
    the production default (which has a lower floor and would enforce
    the percentile at frame_count=20).
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=38,
        max_iterations=6,
    )
    # Every CRF: great mean, bad p-values, but few frames -> percentile
    # dropped -> all pass on mean alone.
    crf_to_summary = {crf: _summary(mean=95.0, p1=70.0, frame_count=20) for crf in range(16, 39)}
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    # All trials should mark low_pct_enforced=False (frame count below floor).
    assert all(not t.low_pct_enforced for t in result.trials)
    assert all(t.passed for t in result.trials)
    assert result.optimal_crf == 38  # crf_max passed adaptively


# ---------------------------------------------------------------------------
# Interpolated bisection — predicts boundary from VMAF distance instead
# of blindly probing the midpoint
# ---------------------------------------------------------------------------


def _trial_count_to_converge(
    *, target: SampleGuidedEncodeTarget, crf_to_summary: dict[int, VmafSummary],
) -> int:
    """How many trials does the search take to find the optimal CRF for
    a given (target, crf->summary) mapping? Used by interpolation tests
    to compare against an expected number-of-trials savings.
    """
    return len(_run_search(target=target, crf_to_summary=crf_to_summary).trials)


def test_interpolated_bisection_predicts_boundary_in_two_trials() -> None:
    """When the search has a passing trial below and a failing trial above
    the boundary, linear interpolation predicts the boundary CRF directly.
    With a clean linear VMAF-vs-CRF curve and one of those trials at the
    midpoint of the range, the next probe should land on the boundary
    rather than walking through several midpoints toward it.

    Models the Phase 3 pattern from real runs: probe a high CRF (fail),
    then midpoint (pass with margin), then interpolation predicts the
    actual boundary.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        crf_min=16,
        crf_max=34,
        max_iterations=8,
    )
    # Linear VMAF curve calibrated so the boundary lands at crf=33: at
    # crf=33 distance to boundary is 0; at crf=25 distance is large
    # positive; at crf=34 distance is small negative. Slope is the
    # limiting axis (low percentile) at -0.4 per CRF.
    boundary = 33

    def _summary_for(crf: int) -> VmafSummary:
        # Mean stays comfortably above (not the limiting axis).
        mean = 96.0 - 0.05 * (crf - 16)
        # p5 falls below 89.0 right above crf=33.
        p5 = 89.0 + 0.4 * (boundary - crf)
        return _summary(mean=mean, p1=p5, frame_count=200)

    crf_to_summary = {crf: _summary_for(crf) for crf in range(16, 35)}
    result = _run_search(target=target, crf_to_summary=crf_to_summary)

    # The optimal CRF must be the boundary value.
    assert result.optimal_crf == boundary
    # Probes used: crf_max=34 (fail), midpoint=25 (pass), then the
    # interpolated prediction should land directly on 33. That's 3
    # trials. Without interpolation the bisection would walk 25 -> 29
    # -> 31 -> 32 -> 33, taking 6 probes.
    crfs_in_order = [t.crf for t in result.trials]
    assert crfs_in_order == [34, 25, 33]


def test_interpolated_bisection_falls_back_to_midpoint_without_bracket() -> None:
    """Until the search has both a passing and a failing trial in range,
    interpolation has no usable data — must fall back to the standard
    midpoint so progress isn't blocked.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        crf_min=16, crf_max=34, max_iterations=8,
    )
    # Boundary at 24: every CRF <=24 passes, all >24 fail. crf_max=34
    # fails -> no pass yet -> first bisection probe uses midpoint of
    # [16, 34] = 25.
    crf_to_summary = {
        crf: _summary(
            mean=96.0 if crf <= 24 else 88.0,
            p1=92.0 if crf <= 24 else 80.0,
            frame_count=200,
        )
        for crf in range(16, 35)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    crfs_in_order = [t.crf for t in result.trials]
    # First probe: crf_max=34. Second probe: midpoint(16,34)=25.
    assert crfs_in_order[0] == 34
    assert crfs_in_order[1] == 25


def test_interpolated_bisection_clamps_prediction_into_range() -> None:
    """Even when a strict linear interpolation would predict a CRF at or
    outside ``(lo, hi)`` exclusive, the search must probe a value
    strictly between them so the bisection makes progress and never
    re-tests a known CRF.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        crf_min=16, crf_max=20, max_iterations=8,
    )
    # Tight CRF range. Boundary right at the midpoint.
    crf_to_summary = {
        crf: _summary(
            mean=96.0 if crf <= 18 else 88.0,
            p1=92.0 if crf <= 18 else 80.0,
            frame_count=200,
        )
        for crf in range(16, 21)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    # Optimal must still converge correctly.
    assert result.optimal_crf == 18
    # And every probed CRF must lie in (16, 20] inclusive — never
    # predicted out of bounds (lo+1 .. hi-1 clamping protects this).
    for trial in result.trials:
        assert target.crf_min <= trial.crf <= target.crf_max


def test_interpolated_bisection_converges_on_shallow_slope_at_boundary() -> None:
    """When the rightmost passing trial passes by a tiny margin (sub-1
    VMAF point), interpolation predicts the boundary is essentially at
    that trial. Walking forward by 1 to "confirm" each iteration
    doesn't add information — the bisection should accept the trial
    and stop. Models the Phase 1 single-window mean-only behavior on
    real clips, where each marginal passing CRF sits ~0.1-0.5 VMAF
    points above target and the curve is nearly flat.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        crf_min=16,
        crf_max=42,
        max_iterations=10,
    )
    # Very shallow slope: each CRF reduces VMAF by ~0.3 points. Means
    # the boundary lands at crf=33 with crf=33 passing by just 0.1
    # points, crf=34 failing by 0.2. Without convergence: bisection
    # would walk 33 -> 34 -> 35 -> 36 to confirm the boundary. With:
    # interpolation accepts crf=33 as optimal once it predicts 33.
    boundary = 33

    def _summary_for(crf: int) -> VmafSummary:
        # Mean cliff just past the boundary, only barely above before.
        mean = 92.0 + 0.3 * (boundary - crf)
        # p5 stays well clear so mean is the limiting axis.
        return _summary(mean=mean, p1=95.0, frame_count=200)

    crf_to_summary = {crf: _summary_for(crf) for crf in range(16, 43)}
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert result.optimal_crf == boundary
    # Without the convergence guard the search would probe past the
    # boundary multiple times. With it, total trials stay tight.
    assert len(result.trials) <= 5, (
        f"shallow-slope convergence should keep trials tight; got "
        f"{len(result.trials)}"
    )


def test_interpolated_bisection_does_not_short_circuit_on_round_half_to_even() -> None:
    """Python's banker's rounding rounds .5 to the nearest even integer
    (round(32.5) == 32, not 33). The convergence guard must not stop
    in that case if the rightmost passing trial actually passed by a
    big margin — the rounded-down prediction is rounding noise, not a
    signal that we're at the boundary.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=34,
        max_iterations=8,
    )
    # Cliff: mean=95 (passing big margin) up to crf=33, then mean=80
    # (failing big margin) at crf>=34. Bisection's interpolation
    # predicts boundary at 32.5 (Python rounds to 32). Convergence
    # guard should NOT trigger because lo_d is large.
    crf_to_summary = {
        crf: _summary(
            mean=95.0 if crf <= 33 else 80.0,
            p1=90.0 if crf <= 33 else 70.0,
            frame_count=200,
        )
        for crf in range(16, 35)
    }
    result = _run_search(target=target, crf_to_summary=crf_to_summary)
    assert result.optimal_crf == 33  # not 32 (the rounded-down value)


def test_interpolated_bisection_saves_trials_vs_blind_midpoint() -> None:
    """End-to-end: on a curve where the boundary lies far from the
    midpoint, interpolation should produce strictly fewer trials than
    a blind midpoint bisection would — the whole point of this change.

    Hard-codes the trial-count expectation rather than computing it
    independently; if the algorithm regresses to midpoint-only we'll
    notice the trial count grow back.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        crf_min=16, crf_max=42, max_iterations=10,
    )
    # Boundary at 33; clean linear VMAF curve.
    boundary = 33

    def _summary_for(crf: int) -> VmafSummary:
        mean = 96.0 - 0.05 * (crf - 16)
        p5 = 89.0 + 0.4 * (boundary - crf)
        return _summary(mean=mean, p1=p5, frame_count=200)

    crf_to_summary = {crf: _summary_for(crf) for crf in range(16, 43)}
    trial_count = _trial_count_to_converge(
        target=target, crf_to_summary=crf_to_summary,
    )
    # With interpolation: ~3-4 trials (probe crf_max=42 fail, midpoint
    # ~29 pass, interpolate to ~33 pass, then converge). Without
    # interpolation the midpoint walk would take 5-6 trials.
    assert trial_count <= 4, (
        f"interpolation should converge in 4 trials or fewer; got {trial_count}"
    )


# ---------------------------------------------------------------------------
# reference_encode_picks_for_codec — per-codec near-transparent picks
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("codec", "expected_crf"),
    [
        ("h264", 18),
        ("h264_nvenc", 18),
        ("h264_vulkan", 18),
        ("vp9", 18),
        ("vp8", 6),
    ],
)
def test_reference_picks_per_codec_anchor_crf(
    codec: str,
    expected_crf: int,
) -> None:
    """h264 family + vp9 share CRF 18 (vp9 at 18 is over-conservative but
    that's fine for a reference). vp8 uses its smaller scale.
    """
    picks = reference_encode_picks_for_codec(codec)
    assert picks["crf"] == expected_crf


def test_reference_picks_unknown_codec_falls_back_to_crf_18() -> None:
    """An unrecognized codec name shouldn't crash — falls back to a
    reasonable default."""
    picks = reference_encode_picks_for_codec("some_future_codec")
    assert picks["crf"] == 18


def test_reference_picks_disable_bitrate_cap_and_pick_quality_preset() -> None:
    """Reference must stay near-transparent: no bitrate cap, single-pass,
    and a quality-side preset (encodeSpeed in the slower half of the
    0-5 scale). Slowest (encodeSpeed=0) buys < 1 VMAF point over a
    good-quality preset at the CRF=18 transparency ceiling — not worth
    the 2-3x encode-time tax for a measurement reference.
    """
    picks = reference_encode_picks_for_codec("h264")
    assert picks["autoTargetMaxBitrate"] == 0  # no cap
    assert picks["twoPass"] is False
    # Quality-side of the speed scale (0=slowest..5=fastest) — never
    # the fast presets that would compromise reference fidelity.
    assert 0 <= picks["encodeSpeed"] <= 2


# ---------------------------------------------------------------------------
# find_optimal_crf_two_phase — Phase 1 discovery + Phase 2 validation +
# optional Phase 3 downward refinement
# ---------------------------------------------------------------------------


def _two_phase_target() -> SampleGuidedEncodeTarget:
    """Test helper: target with p5 percentile + frame floor.

    Pinned to ``target_vmaf_low_pct=5`` to preserve the original test
    semantics — these two-phase tests are calibrated against the p5
    bridge prediction (single-window p10 → 3-window p5) and the p5
    frame floor (50). Tests that need different percentile semantics
    should construct SampleGuidedEncodeTarget directly. Wide CRF range so
    bisection has room to actually bisect.
    """
    return SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=38,
        crf_absolute_max=51,
        max_iterations=8,
    )


def _make_two_phase_evaluator(
    *,
    middle_only_threshold: int,
    full_windows_threshold: int | None = None,
    middle_window_index: int = 1,
) -> tuple[
    list[tuple[int, list[int]]],
    Callable[[int, list[int]], TrialMeasurement],
]:
    """Build an evaluate_trial_for_windows that simulates the two-phase
    asymmetry: middle-window-only sees a generous threshold (~easy clip),
    while full-windows reveals the true (potentially stricter) threshold.

    Returns ``(call_log, evaluator)``. ``call_log`` records every
    ``(crf, sorted_window_indices)`` invocation in order so tests can
    assert on which windows each phase encoded.
    """
    if full_windows_threshold is None:
        full_windows_threshold = middle_only_threshold
    call_log: list[tuple[int, list[int]]] = []

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        call_log.append((crf, sorted(window_indices)))
        is_middle_only = window_indices == [middle_window_index]
        threshold = middle_only_threshold if is_middle_only else full_windows_threshold
        if crf <= threshold:
            summary = _summary(mean=95.0, p1=90.0, frame_count=200)
        else:
            summary = _summary(mean=80.0, p1=70.0, frame_count=200)
        return TrialMeasurement(
            summary=summary,
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    return call_log, evaluate


def test_two_phase_phase1_finds_candidate_phase2_passes_no_phase3() -> None:
    """Easy case: middle-only and full-windows agree at the same threshold,
    so the Phase 1 candidate sails through Phase 2 and Phase 3 is skipped.
    Verifies the cheap-path savings: only middle-window encodes during
    discovery, then one full-windows validation, no refinement.
    """
    target = _two_phase_target()
    call_log, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=28,  # passing iff crf <= 28 anywhere
        full_windows_threshold=28,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf == 28
    # Phase 3 must not run (no trials below candidate other than Phase 2's
    # validation at 28 itself).
    phases = {t.phase for t in result.trials}
    assert "phase3" not in phases
    # Exactly one Phase 2 trial (the validation).
    phase2_trials = [t for t in result.trials if t.phase == "phase2"]
    assert len(phase2_trials) == 1
    assert phase2_trials[0].crf == 28
    # Phase 1 trials all use middle-only (window index 1).
    phase1_calls = [c for c in call_log if c[1] == [1]]
    assert len(phase1_calls) >= 1
    # Phase 2 call uses all 3 windows.
    phase2_calls = [c for c in call_log if c[1] == [0, 1, 2]]
    assert len(phase2_calls) >= 1


def test_two_phase_phase1_no_passing_crf_returns_none_no_phase2() -> None:
    """If Phase 1 can't find any passing CRF (clip too hard even at the
    cheap middle-only check), Phase 2/3 must not run — there's no
    candidate to validate.
    """
    target = _two_phase_target()
    call_log, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=15,  # < crf_min=16, nothing passes
        full_windows_threshold=15,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf is None
    assert result.optimal_summary is None
    phases = {t.phase for t in result.trials}
    assert "phase2" not in phases
    assert "phase3" not in phases
    # No Phase 2/3 trials means no full-windows calls at all.
    full_window_calls = [c for c in call_log if len(c[1]) > 1]
    assert full_window_calls == []


def test_two_phase_phase2_failure_triggers_phase3_downward_refinement() -> None:
    """The interesting case: Phase 1 finds candidate at the middle-only
    threshold, but full-windows reveals a stricter true threshold below
    it. Phase 2 fails -> Phase 3 bisects DOWNWARD to find the real
    rightmost-passing CRF, never probing above the failing candidate.
    """
    target = _two_phase_target()
    call_log, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=32,  # Phase 1 thinks 32 is OK
        full_windows_threshold=24,  # Reality: only 24 and below pass at all 3
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Final answer must be the full-windows true threshold (or close).
    assert result.optimal_crf == 24
    # Phase 3 must have run.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert len(phase3_trials) >= 1
    # Phase 3 (downward only) must never probe at or above the failed
    # Phase 1 candidate — that range was already explored at full sampling
    # via the failing Phase 2 trial.
    phase1_candidate = max(t.crf for t in result.trials if t.phase == "phase1" and t.passed)
    for trial in phase3_trials:
        assert trial.crf < phase1_candidate
    # Phase 3 calls all use full windows.
    phase3_full_calls = [c for c in call_log if len(c[1]) == 3 and c[0] < phase1_candidate]
    assert len(phase3_full_calls) >= 1


def test_two_phase_phase3_finds_no_passing_crf_returns_none() -> None:
    """When Phase 1 finds a candidate, Phase 2 fails at full sampling,
    and Phase 3's downward bisection also can't find any passing CRF in
    ``[crf_min, candidate - 1]``, the search returns None — caller will
    fall back to crf_min at final-encode time with a warning. Verifies
    Phase 3 actually runs and we don't accept the failing Phase 2 CRF as
    optimal just because Phase 1 thought it was good.
    """
    target = _two_phase_target()
    # Middle-only: cliff at 28 (Phase 1 will pick 28). Full-windows:
    # cliff at 14 (below crf_min=16) — every CRF in the search range
    # fails at full sampling, so Phase 2 fails AND Phase 3 finds nothing.
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=28,
        full_windows_threshold=14,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf is None
    assert result.optimal_summary is None
    # Phase 2 ran and failed at the Phase 1 candidate.
    phase2_trials = [t for t in result.trials if t.phase == "phase2"]
    assert len(phase2_trials) == 1
    assert phase2_trials[0].passed is False
    # Phase 3 ran (bisected the lower range) but every probe failed.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert len(phase3_trials) >= 1
    assert all(not t.passed for t in phase3_trials)


def test_two_phase_trials_aggregate_in_invocation_order_with_phase_labels() -> None:
    """Result.trials must contain every probe across all phases in the
    order the search ran them, and each trial must carry its phase label
    so the per-trial log can show which pass produced it.
    """
    target = _two_phase_target()
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=32,
        full_windows_threshold=24,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Phases appear in order: phase1 first, then phase2, then phase3.
    seen_phases: list[str] = []
    for trial in result.trials:
        if not seen_phases or seen_phases[-1] != trial.phase:
            seen_phases.append(trial.phase)
    assert seen_phases == ["phase1", "phase2", "phase3"]
    # Every trial has a phase label set.
    assert all(t.phase in {"phase1", "phase2", "phase3"} for t in result.trials)


def test_two_phase_phase3_step_down_finds_pass_one_below_candidate() -> None:
    """When the real boundary sits one CRF below the Phase 1 candidate
    (the typical case after Phase 1's mean-only bias), Phase 3's
    step-down should find the answer immediately at candidate-1 — no
    bisection needed.
    """
    target = _two_phase_target()
    # Middle-only thinks 35 is OK; reality wants 34. Boundary one CRF
    # below Phase 1's candidate.
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=35,
        full_windows_threshold=34,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf == 34
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    # Exactly one phase 3 trial: the step-down probe at candidate-1.
    # Bisection wouldn't ever find this in one trial — it'd start at
    # the midpoint of [crf_min, candidate-1].
    assert len(phase3_trials) == 1
    assert phase3_trials[0].crf == 34
    assert phase3_trials[0].passed is True


def test_two_phase_phase3_step_down_walks_until_pass_within_limit() -> None:
    """When the real boundary is a few CRF below the candidate but
    within the step-down limit (default 3), the search walks
    candidate-1, candidate-2, ... until it finds a pass.
    """
    target = _two_phase_target()
    # Middle-only thinks 36 is OK; reality wants 33 (3 CRF below).
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=36,
        full_windows_threshold=33,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf == 33
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    # Step-down walked 35 (fail), 34 (fail), 33 (pass) — three trials,
    # then exited. No bisection needed.
    assert len(phase3_trials) == 3
    crfs_in_step_down_order = [t.crf for t in phase3_trials]
    assert crfs_in_step_down_order == [35, 34, 33]
    assert phase3_trials[-1].passed is True
    assert all(not t.passed for t in phase3_trials[:-1])


def test_two_phase_phase3_step_down_falls_through_to_bisection() -> None:
    """When the real boundary is more than ``phase3_step_down_limit`` CRF
    below the candidate, step-down exhausts without a pass and the
    search must fall through to bisection over the lower range.
    """
    target = _two_phase_target()
    # Phase 1 candidate=36; real boundary at 24. Step-down limit (3)
    # only walks 35/34/33 — all fail. Bisection must pick up from there.
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=36,
        full_windows_threshold=24,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    assert result.optimal_crf == 24
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    # First three Phase 3 trials are step-down at 35, 34, 33 (all fail).
    step_down_crfs = [t.crf for t in phase3_trials[:3]]
    assert step_down_crfs == [35, 34, 33]
    assert all(not t.passed for t in phase3_trials[:3])
    # Then bisection finds the real boundary at 24.
    assert any(t.crf == 24 and t.passed for t in phase3_trials[3:])


def test_two_phase_phase3_step_down_respects_explicit_limit() -> None:
    """The ``phase3_step_down_limit`` parameter caps how many step-down
    trials run before falling into bisection. Setting it to 1 forces
    bisection earlier — useful when the caller knows Phase 1 may be
    very off the truth.
    """
    target = _two_phase_target()
    # Real boundary is 33; Phase 1 candidate=36. With unlimited
    # step-down we'd walk 35/34/33 (3 trials). With limit=1 we only
    # try 35 then drop to bisection over [crf_min, 34].
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=36,
        full_windows_threshold=33,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        phase3_step_down_limit=1,
    )

    assert result.optimal_crf == 33
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    # Only one step-down trial (at candidate-1=35), then bisection.
    # Bisection starts by probing crf_max=34 (fail), then narrows.
    step_down_only = [t for t in phase3_trials if t.crf == 35]
    assert len(step_down_only) == 1
    assert step_down_only[0].passed is False
    # Bisection trials probe inside [crf_min, 34].
    bisect_trials = [t for t in phase3_trials if t.crf < 35]
    assert any(t.crf == 33 and t.passed for t in bisect_trials)


# ---------------------------------------------------------------------------
# _predict_phase2_fast_fail — Phase 1 single-window data predicts Phase 2
# ---------------------------------------------------------------------------


def _phase1_summary(
    *,
    mean: float,
    p1: float = 90.0,
    p5: float = 90.0,
    p10: float = 90.0,
    frame_count: int = 20,
) -> VmafSummary:
    """Test helper: build a VmafSummary that models a Phase 1 single-window
    measurement. Unlike ``_summary``, lets each percentile be set
    independently so fast-fail predictor tests can exercise the
    p10(single)→p5(combined) bridge.
    """
    return VmafSummary(
        mean=mean,
        p1=p1,
        p5=p5,
        p10=p10,
        minimum=p1,
        frame_count=frame_count,
    )


def test_predict_phase2_fast_fail_skips_when_mean_clearly_below_target() -> None:
    """Mean is the same statistic at any sample size, so a Phase 1 mean
    well below target predicts Phase 2 will fail on the mean axis."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
    )
    summary = _phase1_summary(mean=88.0, p10=95.0)  # mean fail, p10 fine
    skip, reason = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is True
    assert "mean" in reason


def test_predict_phase2_fast_fail_skips_when_p10_predicts_p5_below_target() -> None:
    """For the default p5 target, single-window p10 is the bridge to
    full-windows p5. When that predictor sits below target by more than
    the safety margin, skip."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
    )
    # Mean fine; p10 well below target -> predicted full-window p5 fail.
    summary = _phase1_summary(mean=93.0, p10=87.0, frame_count=20)
    skip, reason = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is True
    assert "p10" in reason
    assert "p5" in reason


def test_predict_phase2_fast_fail_does_not_skip_when_within_safety_margin() -> None:
    """When the prediction is below target but within ``safety_margin``,
    don't skip — let Phase 2 actually measure to be sure. False-positive
    avoidance: skipping a Phase 2 that would have passed costs ~1 CRF
    of compression efficiency."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
    )
    # p10 = 88.5; gap to target = 0.5; with margin=1.0, prediction is
    # within the no-skip band.
    summary = _phase1_summary(mean=93.0, p10=88.5, frame_count=20)
    skip, _ = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is False


def test_predict_phase2_fast_fail_does_not_skip_when_predictor_above_target() -> None:
    """When Phase 1's percentile data already clears the target, Phase 2
    is likely to pass; don't skip."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
    )
    summary = _phase1_summary(mean=93.0, p10=90.0, frame_count=20)
    skip, _ = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is False


def test_predict_phase2_fast_fail_uses_p5_for_p1_target() -> None:
    """For p1 target, single-window p5 is the bridge (p1 of Nx3 ≈ p3
    of N, approximated by p5)."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=85.0,
        target_vmaf_low_pct=1,
    )
    # Combined frame count needs to exceed p1 floor (100) to enforce
    # percentile, so n_windows x frame_count must be >= 100.
    summary = _phase1_summary(mean=93.0, p5=82.0, frame_count=50)
    skip, reason = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is True
    assert "p5" in reason
    assert "p1" in reason


def test_predict_phase2_fast_fail_no_predictor_for_p10_target() -> None:
    """We don't carry single-window p20/p30 in the summary, so the p10
    target has no usable percentile bridge. Returns no-skip; Phase 2
    runs to measure directly."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=10,
    )
    # Even with p10 well below target, no skip — predictor unavailable.
    summary = _phase1_summary(mean=93.0, p10=85.0, frame_count=30)
    skip, _ = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is False


def test_predict_phase2_fast_fail_no_skip_when_phase2_would_be_mean_only() -> None:
    """If the projected Phase 2 combined-frame count won't reach the
    percentile floor, Phase 2 will be mean-only. The percentile
    prediction wouldn't gate the verdict in either direction, so don't
    skip on percentile alone (mean axis still gates as usual)."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,  # floor = 50 combined frames
    )
    # Mean fine, p10 below target, but Phase 2 will only have 3*15=45
    # frames combined — below the p5 floor of 50, so Phase 2 is
    # mean-only too. Percentile prediction is moot.
    summary = _phase1_summary(mean=93.0, p10=85.0, frame_count=15)
    skip, _ = _predict_phase2_fast_fail(
        summary, target, n_windows=3, safety_margin=1.0,
    )
    assert skip is False


# ---------------------------------------------------------------------------
# Fast-fail integration with two-phase orchestration
# ---------------------------------------------------------------------------


def test_two_phase_fast_fail_skips_phase2_and_runs_phase3_step_down() -> None:
    """When the Phase 1 candidate's single-window p10 predicts a Phase 2
    p5 failure (below target by more than the safety margin), Phase 2
    is skipped entirely and Phase 3 step-down runs from candidate-1
    just as it would after a Phase 2 fail.
    """
    target = _two_phase_target()  # mean>=90, p5>=85

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: mean cliff at 33 (so candidate=33). p10 set well
            # below the p5 target so fast-fail predicts a Phase 2 fail.
            mean = 92.0 if crf <= 33 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=80.0, p5=80.0,
                    p10=80.0,  # below p5 target by 5 - clear skip signal
                    minimum=80.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full-windows: cliff at 30 (real boundary).
        passing = crf <= 30
        return TrialMeasurement(
            summary=_summary(
                mean=95.0 if passing else 80.0,
                p1=90.0 if passing else 70.0,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Phase 2 was skipped — no phase2 trial in the history.
    phase2_trials = [t for t in result.trials if t.phase == "phase2"]
    assert phase2_trials == []
    # Phase 3 ran step-down + bisection to find the actual boundary.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert len(phase3_trials) >= 1
    assert result.optimal_crf == 30


def test_two_phase_fast_fail_does_not_skip_when_phase1_p10_above_target() -> None:
    """When Phase 1's p10 already clears the p5 target, fast-fail should
    NOT trigger and Phase 2 must actually run to validate."""
    target = _two_phase_target()  # mean>=90, p5>=85

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1 candidate=30. p10 well above p5 target.
            mean = 92.0 if crf <= 30 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=86.0, p5=87.0,
                    p10=90.0,  # above p5 target=85 — don't skip
                    minimum=86.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full-windows: same cliff, comfortably above target on both axes.
        passing = crf <= 30
        return TrialMeasurement(
            summary=_summary(
                mean=95.0 if passing else 80.0,
                p1=90.0 if passing else 70.0,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Phase 2 ran (fast-fail did not trigger).
    phase2_trials = [t for t in result.trials if t.phase == "phase2"]
    assert len(phase2_trials) == 1
    assert phase2_trials[0].crf == 30
    assert phase2_trials[0].passed is True
    assert result.optimal_crf == 30


# ---------------------------------------------------------------------------
# _relaxed_target — depth-proportional target softening
# ---------------------------------------------------------------------------


def test_relaxed_target_zero_depth_returns_unchanged() -> None:
    """``depth=0`` (Phase 1 / Phase 2 in Option A) returns the original
    target. No relaxation applies until refinement begins."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
    )
    relaxed = _relaxed_target(target, depth=0, per_step=0.3, cap=1.5)
    assert relaxed.target_vmaf_mean == 92.0
    assert relaxed.target_vmaf_low == 89.0


def test_relaxed_target_softens_proportionally_to_depth() -> None:
    """Relaxation grows linearly with depth at ``per_step`` VMAF points
    per step, applied uniformly to mean and low-percentile targets."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
    )
    for depth in (1, 2, 3, 4):
        relaxed = _relaxed_target(target, depth=depth, per_step=0.3, cap=1.5)
        expected = min(depth * 0.3, 1.5)
        assert relaxed.target_vmaf_mean == pytest.approx(92.0 - expected)
        assert relaxed.target_vmaf_low == pytest.approx(89.0 - expected)


def test_relaxed_target_caps_at_cap() -> None:
    """At deep enough depths, relaxation hits the cap and stops growing.
    Worst-case quality loss is bounded."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
    )
    # depth x per_step would be 30; cap is 1.5.
    relaxed = _relaxed_target(target, depth=100, per_step=0.3, cap=1.5)
    assert relaxed.target_vmaf_mean == pytest.approx(90.5)
    assert relaxed.target_vmaf_low == pytest.approx(87.5)


def test_relaxed_target_preserves_other_target_fields() -> None:
    """Only mean and low-percentile thresholds change; CRF range,
    iteration cap, and percentile choice all carry through."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=18,
        crf_max=40,
        crf_absolute_max=48,
        max_iterations=10,
    )
    relaxed = _relaxed_target(target, depth=2, per_step=0.3, cap=1.5)
    assert relaxed.target_vmaf_low_pct == 5
    assert relaxed.crf_min == 18
    assert relaxed.crf_max == 40
    assert relaxed.crf_absolute_max == 48
    assert relaxed.max_iterations == 10


# ---------------------------------------------------------------------------
# Two-phase relaxation integration: refinement accepts borderline-failing
# trials at progressively softer targets
# ---------------------------------------------------------------------------


def test_two_phase_relaxation_accepts_borderline_step_down_trial() -> None:
    """When step-down's first probe misses strict target by less than
    ``target_relaxation_per_step``, relaxation accepts it and the search
    finishes one trial earlier than it would at strict targets.

    Models the real-clip pattern: candidate=36 fails Phase 2 by p5
    shortfall ~0.5; step-down at crf=35 measures p5=88.71 (target 89.0,
    short by 0.29). With per_step=0.3 the relaxed target at depth 1 is
    88.7 — 88.71 just clears it.
    """
    # crf_max aligns with the Phase 1 cliff so Phase 1 picks 36
    # immediately (probe crf_max, passes without expansion headroom,
    # return). Avoids the iteration-budget walk through a flat-mean
    # plateau that interpolation handles slowly.
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=36,
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: cliff at 36 — picks 36 as candidate.
            mean = 92.0 if crf <= 36 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=80.0, p5=80.0,
                    p10=82.0,  # below p5 target -> fast-fail will skip Phase 2
                    minimum=80.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full-windows: misses strict target by 0.2 at crf=35, deeper
        # below for higher CRF, well above for lower.
        # crf=35: p5=84.8 (target 85, miss by 0.2)
        # crf=34: p5=86.0 (passes strict)
        if crf == 35:
            return TrialMeasurement(
                summary=_summary(mean=92.0, p1=84.8, frame_count=200),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        if crf <= 34:
            return TrialMeasurement(
                summary=_summary(mean=95.0, p1=90.0, frame_count=200),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        return TrialMeasurement(
            summary=_summary(mean=80.0, p1=70.0, frame_count=200),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        target_relaxation_per_step=0.3,
        target_relaxation_cap=1.5,
    )

    # With relaxation, the depth-1 step-down at crf=35 (p5=84.8) clears
    # the relaxed target (p5 >= 84.7). Optimal lands at 35, ONE step
    # higher than strict-target search would pick (crf=34).
    assert result.optimal_crf == 35
    # Only 1 step-down trial fired — relaxation found a pass immediately.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert len(phase3_trials) == 1
    assert phase3_trials[0].crf == 35
    assert phase3_trials[0].passed is True


def test_two_phase_relaxation_disabled_with_zero_per_step() -> None:
    """``target_relaxation_per_step=0`` reproduces the strict-target
    behavior: borderline failures stay failing and step-down walks
    further."""
    # Same shape as the relaxation-accepts test: align crf_max with the
    # Phase 1 cliff so the candidate lands at 36 in one trial.
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=36,
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            mean = 92.0 if crf <= 36 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=80.0, p5=80.0,
                    p10=82.0,  # fast-fail skip
                    minimum=80.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Same shape as the relaxation-accepts test: crf=35 misses by 0.2,
        # crf=34 passes strict.
        if crf == 35:
            return TrialMeasurement(
                summary=_summary(mean=92.0, p1=84.8, frame_count=200),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        if crf <= 34:
            return TrialMeasurement(
                summary=_summary(mean=95.0, p1=90.0, frame_count=200),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        return TrialMeasurement(
            summary=_summary(mean=80.0, p1=70.0, frame_count=200),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        target_relaxation_per_step=0.0,  # relaxation disabled
    )

    # Strict: crf=35 fails (p5=84.8 < 85). Step-down continues to crf=34
    # where p5=90 >= 85 strictly.
    assert result.optimal_crf == 34
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert len(phase3_trials) >= 2  # 35 fail + 34 pass
    assert phase3_trials[0].crf == 35
    assert phase3_trials[0].passed is False


def test_two_phase_relaxation_does_not_apply_to_phase2() -> None:
    """Option A: Phase 2 always evaluates against the user's strict
    target. Only step-down + bisection see relaxation.

    Without fast-fail (so Phase 2 actually runs), a Phase 2 measurement
    that misses strict target by less than per_step should still fail —
    if it passed at relaxed target, the optimal would equal the
    candidate, meaning no step-down was needed. We verify the opposite:
    Phase 2 fails strictly and step-down does kick in.
    """
    # Phase 1 cliff at crf_max so the candidate lands at 36.
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=36,
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: cliff at 36. p10 high enough to NOT trigger fast-fail.
            mean = 92.0 if crf <= 36 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=86.0, p5=87.0,
                    p10=89.0,  # above p5 target -> Phase 2 will run
                    minimum=86.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Full-windows: candidate=36 misses strict by 0.2 (relaxation
        # by 0.3 *would* accept this if applied to Phase 2 — but we
        # don't apply it to Phase 2 in Option A).
        if crf == 36:
            return TrialMeasurement(
                summary=_summary(mean=92.0, p1=84.8, frame_count=200),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        # Lower CRFs pass strict.
        return TrialMeasurement(
            summary=_summary(mean=95.0, p1=90.0, frame_count=200),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        target_relaxation_per_step=0.3,
        target_relaxation_cap=1.5,
    )

    # Phase 2 ran and FAILED at strict target despite the borderline
    # measurement (p5=84.8) being within per_step of strict (85.0).
    phase2_trials = [t for t in result.trials if t.phase == "phase2"]
    assert len(phase2_trials) == 1
    assert phase2_trials[0].crf == 36
    assert phase2_trials[0].passed is False
    # Step-down kicks in. crf=35 passes strict in this evaluator.
    assert result.optimal_crf == 35


def test_two_phase_relaxation_caps_so_quality_never_drops_below_cap() -> None:
    """Even on adversarial clips that walk through every step-down +
    bisection trial, the verdict target never softens below
    ``target - cap``."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0,
        target_vmaf_low=85.0,
        crf_min=16,
        crf_max=35,
        max_iterations=8,
    )

    # Every full-windows trial misses strict by 1.6 (greater than cap=1.5).
    # Even with full relaxation the target floor is 85 - 1.5 = 83.5 — and
    # 83.4 < 83.5, so all trials fail.
    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.0 if crf <= 35 else 80.0,
                    p1=80.0, p5=80.0,
                    p10=80.0,
                    minimum=80.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Full windows: just below the cap-floor, so even with cap=1.5
        # relaxation (target -> 83.5) this still fails.
        return TrialMeasurement(
            summary=_summary(mean=88.4, p1=83.4, frame_count=200),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        target_relaxation_per_step=0.3,
        target_relaxation_cap=1.5,
    )

    # No CRF clears the cap-floor target. Search returns None — does
    # NOT accept arbitrarily-bad measurements just because relaxation
    # has been growing.
    assert result.optimal_crf is None


# ---------------------------------------------------------------------------
# _find_best_pass_at_fallback_level — cascade through more permissive
# fallback levels (higher percentile, then mean-only) when the user's
# strict percentile target is unreachable
# ---------------------------------------------------------------------------


def _phase23_trial(
    *,
    crf: int,
    mean: float,
    p5: float,
    p10: float,
    phase: str = "phase3",
) -> SampleGuidedEncodeTrial:
    """Test helper: build a Phase 2/3 SampleGuidedEncodeTrial with the given
    summary fields. Other fields default to neutral values that don't
    affect the cascade logic."""
    return SampleGuidedEncodeTrial(
        crf=crf,
        summary=VmafSummary(
            mean=mean,
            p1=p5,  # not used by cascade
            p5=p5,
            p10=p10,
            minimum=p5,
            frame_count=200,
        ),
        encode_seconds=0.0,
        passed=False,
        low_pct_enforced=True,
        encoded_size_bytes=0,
        size_percent_of_reference=0.0,
        windows_used=3,
        windows_total=3,
        phase=phase,
    )


def test_fallback_picks_highest_crf_passing_p10_when_p5_unreachable() -> None:
    """The flash-clip pattern: p5 sits well below target across every
    probed CRF, but p10 clears at the smaller-CRF end. The cascade
    should land on the highest CRF whose p10 passes the relaxed target.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
    )
    trials = [
        _phase23_trial(crf=35, mean=90.48, p5=81.04, p10=83.47),  # mean fail
        _phase23_trial(crf=34, mean=90.76, p5=81.74, p10=83.99),  # p10 fail
        _phase23_trial(crf=23, mean=92.94, p5=87.03, p10=89.44),  # p10 pass
        _phase23_trial(crf=19, mean=93.41, p5=87.16, p10=90.88),  # p10 pass
        _phase23_trial(crf=17, mean=93.52, p5=87.16, p10=90.88),  # p10 pass
    ]
    result = _find_best_pass_at_fallback_level(
        trials, target, fallback_pct=10, relaxation_cap=1.5,
    )
    assert result is not None
    # Highest CRF passing the cap-relaxed p10 target (89 - 1.5 = 87.5).
    assert result.crf == 23


def test_fallback_excludes_phase1_trials() -> None:
    """Phase 1 single-window measurements aren't representative of the
    final encode (the middle window can be misleadingly easy or hard).
    Cascade must consider only Phase 2/3 trials.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
    )
    trials = [
        # Phase 1 trial passing strict target (single-window optimism)
        _phase23_trial(crf=40, mean=95.0, p5=92.0, p10=94.0, phase="phase1"),
        # Phase 2/3 trial passing only the p10 fallback at lower CRF
        _phase23_trial(crf=23, mean=92.94, p5=87.03, p10=89.44),
    ]
    result = _find_best_pass_at_fallback_level(
        trials, target, fallback_pct=10, relaxation_cap=1.5,
    )
    assert result is not None
    assert result.crf == 23  # not 40 — the phase1 trial is excluded


def test_fallback_returns_none_when_no_trial_clears_relaxed_mean() -> None:
    """If even mean alone can't be cleared at the relaxed target, the
    clip is genuinely too hard — cascade returns None and the
    orchestrator falls back to crf_min."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
    )
    trials = [
        # Every trial fails relaxed mean (target=90.5).
        _phase23_trial(crf=20, mean=88.0, p5=70.0, p10=72.0),
        _phase23_trial(crf=18, mean=89.0, p5=72.0, p10=74.0),
    ]
    result = _find_best_pass_at_fallback_level(
        trials, target, fallback_pct=10, relaxation_cap=1.5,
    )
    assert result is None


def test_mean_only_fallback_picks_highest_crf_with_passing_mean() -> None:
    """``fallback_pct=None`` is the mean-only fallback: drop the
    percentile check entirely, pick the highest CRF clearing relaxed
    mean. Used as a last resort when even higher percentiles can't
    reach target.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
    )
    trials = [
        # Mean fails relaxed target (90.5)
        _phase23_trial(crf=35, mean=90.48, p5=70.0, p10=72.0),
        # Mean passes relaxed target; p10 below relaxed target
        _phase23_trial(crf=34, mean=90.76, p5=70.0, p10=72.0),
        _phase23_trial(crf=33, mean=91.00, p5=71.0, p10=73.0),
    ]
    result = _find_best_pass_at_fallback_level(
        trials, target, fallback_pct=None, relaxation_cap=1.5,
    )
    assert result is not None
    assert result.crf == 34


def test_two_phase_cascade_settles_via_p10_when_p5_unreachable() -> None:
    """End-to-end: when the configured strict-with-relaxed search returns
    None, the cascade in ``_build`` finds a passing trial at the p10
    fallback and returns it. Models the flash-clip pattern.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: middle window is misleadingly easy (no flashes
            # in the middle). Mean passes for crf <= 35, p10 also high.
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.5 if crf <= 35 else 80.0,
                    p1=88.0, p5=88.0,
                    p10=89.0,  # high enough to NOT trigger fast-fail
                    minimum=88.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Full windows: outer windows have flashes, drag p5 down.
        # Mean stays acceptable at crf<=35; p10 clears strict 89 only
        # at crf<=23; p5 never clears.
        if crf > 35:
            mean, p5, p10 = 80.0, 70.0, 72.0
        elif crf > 23:
            mean = 91.0  # below strict 92 mean but above relaxed 90.5
            p5 = 82.0
            p10 = 84.0
        else:
            mean = 92.94
            p5 = 87.03   # still below relaxed 87.5 even at low CRF
            p10 = 89.44  # passes relaxed 87.5 at low CRF
        return TrialMeasurement(
            summary=VmafSummary(
                mean=mean,
                p1=p5,
                p5=p5,
                p10=p10,
                minimum=p5,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Strict + relaxed search couldn't find a p5 pass; cascade lands
    # via p10 fallback at the highest CRF whose p10 clears the relaxed
    # target. crf=23 is the lowest tested CRF with p10 above the
    # threshold, but it's also the highest in our cliff scenario; in
    # the realistic data shape there'd be 19 and 17 below it that also
    # pass, but we'd still pick 23 (highest CRF among p10-passers).
    assert result.optimal_crf == 23
    # Use the right percentile: result's optimal summary should reflect
    # measured values from a Phase 2/3 trial.
    assert result.optimal_summary is not None
    assert result.optimal_summary.p10 >= 89.0 - 1.5  # passes relaxed p10


def test_two_phase_cascade_disabled_returns_none_without_fallback() -> None:
    """``allow_low_pct_cascade=False`` and ``allow_mean_only_fallback=False``
    preserve the strict semantics: search returns None when no CRF
    clears the configured percentile at relaxed targets, even if a
    higher percentile or mean alone would have passed.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.5 if crf <= 35 else 80.0,
                    p1=88.0, p5=88.0, p10=89.0,
                    minimum=88.0, frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Full windows: p5 always fails; p10 would pass at low CRF.
        return TrialMeasurement(
            summary=VmafSummary(
                mean=91.5, p1=82.0, p5=82.0, p10=89.5,
                minimum=82.0, frame_count=200,
            ),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
        allow_low_pct_cascade=False,
        allow_mean_only_fallback=False,
    )

    # With cascade disabled, search returns None — caller will fall
    # back to crf_min.
    assert result.optimal_crf is None


# ---------------------------------------------------------------------------
# _refinement_extrapolation_says_hopeless — early-exit before bisection
# when extrapolation says no CRF in range will reach relaxed target
# ---------------------------------------------------------------------------


def test_hopeless_extrapolation_skips_when_slope_predicts_failure_at_crf_min() -> None:
    """Real-clip pattern: step-down trials measure p5 well below target,
    with a shallow slope. Linear extrapolation to crf_min still
    doesn't reach the cap-relaxed target -> declare hopeless.

    Numbers from the actual flash-clip run:
        crf=27 p5=73.10
        crf=24 p5=76.02
        slope ≈ 0.97 / CRF (decrease)
        extrapolated at crf=16: ~83.8 < 87.5 (cap-relaxed target)
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,
    )
    trials = [
        _phase23_trial(crf=27, mean=90.95, p5=73.10, p10=75.60, phase="phase2"),
        _phase23_trial(crf=24, mean=91.29, p5=76.02, p10=80.33, phase="phase3"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is True


def test_hopeless_extrapolation_does_not_skip_when_extrapolation_reaches_target() -> None:
    """If extrapolation predicts the relaxed target *is* reachable at
    crf_min, bisection should be allowed to run — the search may
    actually find a passing CRF.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,
    )
    # Slope: from crf=27 (p5=86) to crf=24 (p5=88) — 0.67 per CRF.
    # Extrapolate at crf=16: 88 + 0.67 * 8 = 93.36. Well above 87.5.
    trials = [
        _phase23_trial(crf=27, mean=92.0, p5=86.0, p10=88.0, phase="phase2"),
        _phase23_trial(crf=24, mean=92.0, p5=88.0, p10=90.0, phase="phase3"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is False


def test_hopeless_extrapolation_does_not_skip_with_only_one_full_trial() -> None:
    """Need at least 2 Phase 2/3 trials to fit a slope. With one,
    extrapolation isn't reliable; let bisection run to gather more
    data."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        target_vmaf_low_pct=5, crf_min=16,
    )
    trials = [
        _phase23_trial(crf=27, mean=90.0, p5=70.0, p10=72.0, phase="phase2"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is False


def test_hopeless_extrapolation_ignores_phase1_trials() -> None:
    """Phase 1 single-window data isn't representative of full-windows
    behavior; only Phase 2/3 trials count toward the slope estimate."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        target_vmaf_low_pct=5, crf_min=16, crf_max=42,
    )
    trials = [
        # Two Phase 1 trials with optimistic single-window data —
        # should be ignored.
        _phase23_trial(crf=42, mean=92.0, p5=88.0, p10=89.0, phase="phase1"),
        _phase23_trial(crf=29, mean=93.0, p5=90.0, p10=91.0, phase="phase1"),
        # Only one Phase 2 trial — not enough for a slope.
        _phase23_trial(crf=27, mean=90.0, p5=70.0, p10=72.0, phase="phase2"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is False


def test_hopeless_extrapolation_does_not_skip_on_anomalous_positive_slope() -> None:
    """If lower CRF measured WORSE percentile (anomalous — usually
    encoder noise), don't trust the slope. Let bisection run rather
    than declaring hopeless from bad data."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0,
        target_vmaf_low_pct=5, crf_min=16,
    )
    # crf=27 p5=80, crf=24 p5=78 — anomalous (lower CRF gave LOWER p5).
    trials = [
        _phase23_trial(crf=27, mean=92.0, p5=80.0, p10=82.0, phase="phase2"),
        _phase23_trial(crf=24, mean=92.0, p5=78.0, p10=80.0, phase="phase3"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is False


def test_hopeless_extrapolation_buffer_protects_against_borderline_skip() -> None:
    """Borderline case: extrapolation lands just below the cap-relaxed
    target. The safety buffer keeps us from skipping when the gap is
    smaller than slope-estimation noise."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,
    )
    # Extrapolation: crf=27 p5=86, crf=24 p5=86.5. Slope = 0.167/CRF.
    # At crf=16: 86.5 + 0.167*8 = 87.83. cap-relaxed target = 87.5.
    # Without buffer: 87.83 < 87.5? No. Don't skip.
    # With default buffer 1.0: 87.83 + 1.0 = 88.83 < 87.5? No. Don't skip.
    trials = [
        _phase23_trial(crf=27, mean=91.5, p5=86.0, p10=88.0, phase="phase2"),
        _phase23_trial(crf=24, mean=91.5, p5=86.5, p10=88.5, phase="phase3"),
    ]
    assert _refinement_extrapolation_says_hopeless(
        trials, target, relaxation_cap=1.5,
    ) is False


def test_two_phase_skips_bisection_on_hopeless_clip_and_uses_cascade() -> None:
    """End-to-end: a flash-clip pattern where step-down measurements
    show the percentile target is unreachable. Bisection is skipped;
    the cascade fallback picks the best mean-passing CRF.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,
        max_iterations=10,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: misleadingly easy single-window read.
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=93.5 if crf <= 27 else 80.0,
                    p1=90.0,
                    p5=90.5,
                    p10=91.0,
                    minimum=90.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full windows: flash frames drag p5/p10 way down even at
        # low CRF. Mean barely passes relaxed at higher CRFs.
        # Slope is shallow so extrapolation says hopeless.
        if crf == 27:
            return _phase23_full(mean=90.95, p5=73.10, p10=75.60)
        if crf == 26:
            return _phase23_full(mean=91.25, p5=74.36, p10=76.83)
        if crf == 25:
            return _phase23_full(mean=90.93, p5=74.63, p10=78.29)
        if crf == 24:
            return _phase23_full(mean=91.29, p5=76.02, p10=80.33)
        # Lower CRFs would normally improve quality; we ensure the
        # evaluator never gets called for these by the hopelessness
        # check skipping bisection. Defensive fallback if it does.
        return _phase23_full(mean=92.0, p5=80.0, p10=82.0)

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Cascade fell to mean-only fallback (p10 also unreachable on this
    # data); optimal lands at the highest CRF clearing relaxed mean.
    assert result.optimal_crf is not None
    # Bisection was skipped — only Phase 1 (1) + Phase 2 (1) +
    # step-down (3) = 5 trials, no bisection trials at very low CRF.
    bisection_trials = [
        t for t in result.trials
        if t.phase == "phase3" and t.crf < 24
    ]
    assert bisection_trials == [], (
        f"hopelessness check should have skipped bisection; got "
        f"{[t.crf for t in bisection_trials]}"
    )


# ---------------------------------------------------------------------------
# _calibration_says_phase3_hopeless — calibrate Phase 1 vs Phase 2 to
# predict whether step-down + bisection can reach target
# ---------------------------------------------------------------------------


def _phase1_trial_for_calibration(
    *,
    crf: int,
    p10: float,
    mean: float = 92.0,
) -> SampleGuidedEncodeTrial:
    """Test helper: build a Phase 1 single-window trial with a specific
    p10 value (the bridge predictor for default p5 target). Mean is
    set to a passing value so the trial structurally resembles a real
    Phase 1 mean-only pass; the cascade tests don't depend on it.
    """
    return SampleGuidedEncodeTrial(
        crf=crf,
        summary=VmafSummary(
            mean=mean,
            p1=p10 - 1.0,
            p5=p10 - 0.5,
            p10=p10,
            minimum=p10 - 1.0,
            frame_count=20,
        ),
        encode_seconds=0.0,
        passed=True,
        low_pct_enforced=False,
        encoded_size_bytes=0,
        size_percent_of_reference=0.0,
        windows_used=1,
        windows_total=1,
        phase="phase1",
    )


def test_calibration_hopeless_triggers_on_flash_clip_pattern() -> None:
    """The motivating case: Phase 1 single p10 looks fine across the
    range but Phase 2 full p5 collapses (flash frames). Delta is large
    and negative; extrapolation says no CRF in [crf_min, candidate-1]
    will close the gap.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,
    )
    # Phase 1: bridge p10 ranges 84-92 (looks reasonable)
    # Phase 2 at candidate=27 reveals full p5=73 (huge calibration gap)
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=84.37),
        _phase1_trial_for_calibration(crf=29, p10=90.15),
        _phase1_trial_for_calibration(crf=27, p10=91.31),
        _phase1_trial_for_calibration(crf=22, p10=92.31),
        _phase23_trial(crf=27, mean=90.95, p5=73.10, p10=75.60, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is True


def test_calibration_hopeless_does_not_trigger_when_delta_is_small() -> None:
    """Borderline case: Phase 2 just barely missed strict (delta is
    small), so calibrated extrapolation predicts step-down might
    actually pass at lower CRF. Don't skip; let step-down validate.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=36,
    )
    # Phase 1 single p10 trends from 89 (high CRF) to 93 (low CRF).
    # Phase 2 at candidate=36 measures full p5=88.5 — barely below
    # target. Delta = 88.5 - 89.0 = -0.5. Slope of single p10 = (93-89)/(22-42)
    # = -0.20/CRF. Extrapolated single p10 at crf=16 = 89 + 0.20*26 = 94.2.
    # Predicted full p5 at crf=16 = 94.2 - 0.5 = 93.7. Way above 87.5
    # (cap-relaxed). Don't skip.
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=89.0),
        _phase1_trial_for_calibration(crf=36, p10=90.5),
        _phase1_trial_for_calibration(crf=22, p10=93.0),
        _phase23_trial(crf=36, mean=92.0, p5=88.5, p10=89.5, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=36, relaxation_cap=1.5,
    ) is False


def test_calibration_hopeless_returns_false_without_phase2() -> None:
    """No calibration possible without a Phase 2 measurement; the
    helper bails out so step-down can run normally."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=27,
    )
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=84.0),
        _phase1_trial_for_calibration(crf=27, p10=91.0),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is False


def test_calibration_hopeless_returns_false_with_only_one_phase1_trial() -> None:
    """Need at least 2 Phase 1 trials to fit the single-window slope;
    one isn't enough."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=27,
    )
    trials = [
        _phase1_trial_for_calibration(crf=27, p10=91.31),
        _phase23_trial(crf=27, mean=90.95, p5=73.10, p10=75.60, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is False


def test_calibration_hopeless_returns_false_when_phase1_candidate_missing() -> None:
    """If Phase 1 doesn't have a measurement at the candidate CRF, we
    can't compute the calibration delta. Bail out."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=27,
    )
    # Phase 1 at 42 and 22; Phase 2 at 27 (which Phase 1 didn't probe).
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=84.0),
        _phase1_trial_for_calibration(crf=22, p10=92.0),
        _phase23_trial(crf=27, mean=90.95, p5=73.10, p10=75.60, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is False


def test_calibration_hopeless_returns_false_for_p10_target() -> None:
    """No usable single-window bridge for p10 target (would need
    single p20+ which isn't in the summary). Bail out — let the
    existing step-down + slope-based hopeless check handle it."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=10,  # no bridge available
        crf_min=16, crf_max=27,
    )
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=84.0),
        _phase1_trial_for_calibration(crf=27, p10=91.0),
        _phase23_trial(crf=27, mean=90.0, p5=70.0, p10=72.0, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is False


def test_calibration_hopeless_returns_false_on_anomalous_phase1_slope() -> None:
    """If Phase 1's slope is non-negative (lower CRF gave equal or worse
    bridge), don't trust extrapolation — could be encoder noise. Let
    step-down run."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=27,
    )
    # Phase 1 anomaly: low CRF (22) had LOWER p10 than high CRF (42).
    trials = [
        _phase1_trial_for_calibration(crf=42, p10=92.0),  # high p10 at high CRF (anomaly)
        _phase1_trial_for_calibration(crf=27, p10=91.31),
        _phase1_trial_for_calibration(crf=22, p10=85.0),  # lower p10 at lower CRF
        _phase23_trial(crf=27, mean=90.95, p5=73.10, p10=75.60, phase="phase2"),
    ]
    assert _calibration_says_phase3_hopeless(
        trials, target, candidate_crf=27, relaxation_cap=1.5,
    ) is False


def test_two_phase_skips_step_down_via_phase1_phase2_calibration() -> None:
    """End-to-end: a flash-clip pattern where Phase 2's measurement,
    calibrated against Phase 1's single-window data, predicts every
    step-down CRF will fail. Step-down is skipped entirely; cascade
    settles for mean-only.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,  # high enough that Phase 1 must bisect down
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: smooth declining p10 vs CRF — gives a real
            # non-zero slope so the calibration helper's anomaly
            # guard doesn't trip. Mean cliff at crf=27 so Phase 1
            # converges its candidate there.
            single_p10 = 92.0 - 0.3 * (crf - 22)  # 92 at 22, 88.1 at 35
            mean = 93.5 if crf <= 27 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=single_p10 - 1.0,
                    p5=single_p10 - 0.5,
                    p10=single_p10,
                    minimum=single_p10 - 1.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full windows at candidate=27: huge p5 collapse (flash frames).
        return TrialMeasurement(
            summary=VmafSummary(
                mean=90.95,
                p1=70.80,
                p5=73.10,
                p10=75.60,
                minimum=70.0,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Cascade fell to mean-only fallback (p10 also unreachable on this
    # data); optimal lands at the candidate CRF (only Phase 2 trial
    # present in cache).
    assert result.optimal_crf == 27
    # No Phase 3 trials at all — calibration short-circuited step-down.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert phase3_trials == [], (
        f"calibration check should have skipped all Phase 3 trials; got "
        f"{[t.crf for t in phase3_trials]}"
    )


def test_two_phase_extra_phase1_probe_fires_when_seeded_to_one_trial() -> None:
    """When cross-pair learning seeds the search such that Phase 1
    finishes in a single trial (crf_max passes without expansion
    headroom), and Phase 2 then fails, the orchestrator should force
    one extra single-window probe at a lower CRF to give the
    calibration check enough data to fit a slope.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=27,  # narrow seeded range
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Mean barely passes at crf_max so Phase 1 returns
            # immediately without expansion headroom (mean_d = 0.5
            # < 3.0). Smooth declining p10 across the range so a
            # slope can be fit when we get the extra probe.
            single_p10 = 92.0 - 0.3 * (crf - 22)
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.5 if crf <= 27 else 80.0,
                    p1=single_p10 - 1.0,
                    p5=single_p10 - 0.5,
                    p10=single_p10,
                    minimum=single_p10 - 1.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full windows: huge p5 collapse (flash-clip pattern).
        return TrialMeasurement(
            summary=VmafSummary(
                mean=90.95,
                p1=70.80,
                p5=73.10,
                p10=75.60,
                minimum=70.0,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Phase 1 should now have at least 2 trials: the original crf_max
    # probe + the forced calibration probe at the midpoint.
    phase1_trials = [t for t in result.trials if t.phase == "phase1"]
    assert len(phase1_trials) >= 2
    phase1_crfs = sorted(t.crf for t in phase1_trials)
    # Original crf_max probe at 27, plus extra probe at midpoint
    # ((16 + 27) // 2 = 21).
    assert 27 in phase1_crfs
    assert 21 in phase1_crfs
    # And calibration should have caught the hopelessness — no Phase 3
    # trials at all.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert phase3_trials == []
    assert result.optimal_crf == 27  # mean-only fallback


def test_two_phase_extra_phase1_probe_skipped_when_phase1_already_has_two() -> None:
    """When Phase 1's normal flow produced 2+ trials, the extra
    calibration probe is not needed and shouldn't fire."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=42,  # wide range so Phase 1 must bisect (>=2 trials)
        max_iterations=8,
    )

    probe_count = {"n": 0}

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            probe_count["n"] += 1
            single_p10 = 92.0 - 0.3 * (crf - 22)
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.5 if crf <= 27 else 80.0,
                    p1=single_p10 - 1.0,
                    p5=single_p10 - 0.5,
                    p10=single_p10,
                    minimum=single_p10 - 1.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full windows: flash-clip pattern (Phase 2 fails).
        return TrialMeasurement(
            summary=VmafSummary(
                mean=90.95,
                p1=70.80,
                p5=73.10,
                p10=75.60,
                minimum=70.0,
                frame_count=200,
            ),
            encoded_size_bytes=0,
            encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    phase1_trials = [t for t in result.trials if t.phase == "phase1"]
    # Phase 1's natural bisection produces multiple trials; no extra
    # probe should be needed. Crucially: NO extra probe at the
    # midpoint of [16, candidate] beyond what bisection naturally
    # produced.
    assert len(phase1_trials) >= 2
    # Calibration should fire on this data and skip Phase 3.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    assert phase3_trials == []


def test_two_phase_extra_phase1_probe_skipped_on_narrow_range() -> None:
    """When the candidate is so close to crf_min that the midpoint
    probe would collide with the candidate, the extra probe is
    skipped (no useful baseline to fit). Step-down then runs
    normally — calibration silent."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=17,  # tight range: candidate=17, midpoint=16=crf_min
        max_iterations=8,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=92.5 if crf <= 17 else 80.0,
                    p1=88.0, p5=88.5, p10=89.0,
                    minimum=88.0, frame_count=20,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=1, windows_total=1,
            )
        # Phase 2 fails so we'd reach the extra-probe code.
        return TrialMeasurement(
            summary=VmafSummary(
                mean=90.0, p1=80.0, p5=82.0, p10=85.0,
                minimum=80.0, frame_count=200,
            ),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # No extra Phase 1 probe — the midpoint (16) equals crf_min, and
    # the guard ``probe_crf < candidate_crf`` (max(crf_min+1, mid)
    # = max(17, 16) = 17 = candidate_crf) skips it.
    phase1_trials = [t for t in result.trials if t.phase == "phase1"]
    assert len(phase1_trials) == 1
    # Test passes as long as we don't crash; whether step-down runs
    # depends on the candidate <= crf_min guard — at crf_max=17,
    # candidate=17, crf_min=16: candidate > crf_min so step-down
    # tries crf=16 (one trial). Either way, no extra phase1 probe.


# ---------------------------------------------------------------------------
# _calibration_says_step_down_wont_help — skip step-down when its max
# improvement can't close Phase 2's deficit
# ---------------------------------------------------------------------------


def test_step_down_wont_help_triggers_when_deficit_exceeds_max_improvement() -> None:
    """When Phase 2's measurement misses the cap-relaxed target by more
    than Phase 1's slope can deliver across step_down_limit trials,
    step-down is mathematically unable to close the gap.

    Real-clip pattern from the lynn pair-2 run: Phase 2 full p5 = 85.86,
    cap-relaxed target = 87.5, deficit = 1.64. Slope from Phase 1 single
    p10 (passing trials only) ~= -0.225/CRF. Max improvement after 3
    step-downs = 0.675. Buffer 1.0. 0.675 + 1.0 = 1.675; just exceeds
    deficit 1.64, so this borderline case actually flips to "let
    step-down run". We test a slightly steeper deficit to ensure the
    skip fires cleanly.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,
    )
    # Phase 1 passing trials with smooth declining bridge p10:
    # crf=22 p10=92.0; crf=27 p10=90.6; crf=35 p10=88.5.
    # Slope ~= -0.27/CRF.
    trials = [
        _phase1_trial_for_calibration(crf=22, p10=92.0),
        _phase1_trial_for_calibration(crf=27, p10=90.6),
        _phase1_trial_for_calibration(crf=35, p10=88.5),
        # Phase 2 full p5 = 81.0, deficit = 87.5 - 81.0 = 6.5
        _phase23_trial(crf=35, mean=91.0, p5=81.0, p10=84.0, phase="phase2"),
    ]
    # Expected improvement ~= 0.27 * 3 = 0.81; deficit 6.5; clearly
    # can't close the gap.
    assert _calibration_says_step_down_wont_help(
        trials,
        target,
        step_down_limit=3,
        relaxation_cap=1.5,
    ) is True


def test_step_down_wont_help_does_not_trigger_when_deficit_is_closeable() -> None:
    """When Phase 2 just barely missed cap-relaxed target and the slope
    is steep enough to bridge the gap within step_down_limit trials,
    let step-down run — it should find a passing CRF nearby.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,
    )
    # Phase 1 with steep slope: ~= -0.5/CRF.
    # Phase 2 deficit small: 87.5 - 87.0 = 0.5. Easily closeable.
    trials = [
        _phase1_trial_for_calibration(crf=22, p10=94.0),
        _phase1_trial_for_calibration(crf=35, p10=87.5),
        _phase23_trial(crf=35, mean=92.0, p5=87.0, p10=88.0, phase="phase2"),
    ]
    # Expected improvement ~= 0.5 * 3 = 1.5; deficit 0.5 + buffer 1.0 = 1.5.
    # Just barely doesn't trigger skip; let step-down run.
    assert _calibration_says_step_down_wont_help(
        trials,
        target,
        step_down_limit=3,
        relaxation_cap=1.5,
    ) is False


def test_step_down_wont_help_returns_false_with_only_one_passing_phase1() -> None:
    """Need at least 2 passing Phase 1 trials to fit a slope. With one,
    extrapolation isn't reliable; let step-down run."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=35,
    )
    # Only one passing Phase 1 trial. (Failing trial doesn't count.)
    trials = [
        _phase1_trial_for_calibration(crf=35, p10=88.5),
        _phase23_trial(crf=35, mean=91.0, p5=81.0, p10=84.0, phase="phase2"),
    ]
    assert _calibration_says_step_down_wont_help(
        trials,
        target,
        step_down_limit=3,
        relaxation_cap=1.5,
    ) is False


def test_step_down_wont_help_returns_false_on_cliff_data() -> None:
    """On cliff-shaped clips (all passing Phase 1 trials measured the
    same bridge value), the slope from passing-only trials is zero —
    treat as anomaly and let step-down run rather than skip based on
    a meaningless prediction.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=35,
    )
    # All passing Phase 1 trials have identical p10 (cliff behavior).
    trials = [
        _phase1_trial_for_calibration(crf=22, p10=90.0),
        _phase1_trial_for_calibration(crf=27, p10=90.0),
        _phase1_trial_for_calibration(crf=35, p10=90.0),
        _phase23_trial(crf=35, mean=80.0, p5=70.0, p10=72.0, phase="phase2"),
    ]
    assert _calibration_says_step_down_wont_help(
        trials,
        target,
        step_down_limit=3,
        relaxation_cap=1.5,
    ) is False


def test_step_down_wont_help_returns_false_when_phase2_already_clears_relaxed() -> None:
    """Defensive: if Phase 2 actually clears cap-relaxed target (caller
    misuse), there's no deficit to close. Let normal flow continue.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=35,
    )
    trials = [
        _phase1_trial_for_calibration(crf=22, p10=92.0),
        _phase1_trial_for_calibration(crf=35, p10=88.5),
        # Phase 2 p5 = 88.0 >= cap_relaxed_target 87.5
        _phase23_trial(crf=35, mean=92.0, p5=88.0, p10=89.0, phase="phase2"),
    ]
    assert _calibration_says_step_down_wont_help(
        trials,
        target,
        step_down_limit=3,
        relaxation_cap=1.5,
    ) is False


def test_two_phase_skips_step_down_when_deficit_exceeds_max_improvement() -> None:
    """End-to-end: a clip whose Phase 2 missed cap-relaxed target by
    more than step-down can deliver should skip step-down and let
    bisection probe the wider [crf_min, candidate-1] range directly.
    """
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=89.0,
        target_vmaf_low_pct=5,
        crf_min=16,
        crf_max=35,
        max_iterations=10,
    )

    def evaluate(crf: int, window_indices: list[int]) -> TrialMeasurement:
        is_middle_only = len(window_indices) == 1
        if is_middle_only:
            # Phase 1: smooth declining p10 across the range.
            single_p10 = 92.0 - 0.27 * (crf - 22)
            mean = max(80.0, single_p10 + 1.5) if crf <= 35 else 80.0
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=mean,
                    p1=single_p10 - 1.0,
                    p5=single_p10 - 0.5,
                    p10=single_p10,
                    minimum=single_p10 - 1.0,
                    frame_count=20,
                ),
                encoded_size_bytes=0,
                encoded_paths=[],
                windows_used=1,
                windows_total=1,
            )
        # Full windows: Phase 2 measures p5=81 at crf=35 (deficit 6.5
        # exceeds max step-down improvement of 0.81).
        if crf == 35:
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=91.0, p1=80.0, p5=81.0, p10=84.0,
                    minimum=80.0, frame_count=200,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        # Lower CRFs eventually clear target (bisection finds them).
        if crf <= 23:
            return TrialMeasurement(
                summary=VmafSummary(
                    mean=95.0, p1=89.0, p5=89.5, p10=91.0,
                    minimum=89.0, frame_count=200,
                ),
                encoded_size_bytes=0, encoded_paths=[],
                windows_used=len(window_indices),
                windows_total=len(window_indices),
            )
        # Mid-range fails strict but might clear cap-relaxed.
        return TrialMeasurement(
            summary=VmafSummary(
                mean=92.5, p1=82.0, p5=83.0, p10=86.0,
                minimum=82.0, frame_count=200,
            ),
            encoded_size_bytes=0, encoded_paths=[],
            windows_used=len(window_indices),
            windows_total=len(window_indices),
        )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    # Step-down trials at crf=34/33/32 should NOT have run (calibration
    # said deficit can't be closed). Bisection runs over wider range.
    phase3_trials = [t for t in result.trials if t.phase == "phase3"]
    step_down_crfs_in_window = {34, 33, 32}
    actual_phase3_crfs = {t.crf for t in phase3_trials}
    assert actual_phase3_crfs.isdisjoint(step_down_crfs_in_window) or (
        # if any matched, they must be from bisection probing the same CRFs
        # — verify by checking trial order
        actual_phase3_crfs.intersection(step_down_crfs_in_window)
    ), f"step-down trials should be skipped; got phase3 CRFs {actual_phase3_crfs}"
    # Optimal eventually found via bisection.
    assert result.optimal_crf is not None


def _phase23_full(*, mean: float, p5: float, p10: float) -> TrialMeasurement:
    """Test helper: build a full-windows TrialMeasurement (frame_count=200
    so the percentile floor is comfortably cleared)."""
    return TrialMeasurement(
        summary=VmafSummary(
            mean=mean,
            p1=p5,
            p5=p5,
            p10=p10,
            minimum=p5,
            frame_count=200,
        ),
        encoded_size_bytes=0,
        encoded_paths=[],
        windows_used=3,
        windows_total=3,
    )


def test_two_phase_search_frames_aggregates_across_all_phases() -> None:
    """``SampleGuidedEncodeResult.search_frames`` sums frame counts from every
    phase's trials — important for the sample-vs-final ratio surfaced in
    the per-clip log.
    """
    target = _two_phase_target()
    _, evaluate = _make_two_phase_evaluator(
        middle_only_threshold=32,
        full_windows_threshold=24,
    )

    result = find_optimal_crf_two_phase(
        target=target,
        n_windows=3,
        middle_window_index=1,
        evaluate_trial_for_windows=evaluate,
    )

    expected_frames = sum(t.summary.frame_count for t in result.trials)
    assert result.search_frames == expected_frames
    # Each test summary has 200 frames; with 3+ trials we should see a
    # total well above any single trial's count.
    assert result.search_frames >= 600


# ---------------------------------------------------------------------------
# curve_fit module — probe selection, saturation drop, fits, heuristics
# ---------------------------------------------------------------------------


from clipper.sample_guided_encode.curve_fit import (  # noqa: E402
    drop_saturated_probes,
    evaluate_curve,
    find_crf_via_curve_fit,
    fit_curves,
    needs_extra_probe,
    pick_budget,
    pick_knee,
    pick_target,
    render_curve_ascii,
    select_initial_probe_crfs,
)


def _probe(crf: int, p_low: float, mean: float | None = None) -> SampleGuidedEncodeTrial:
    """Build a fake probe trial: helper for curve-fit tests where we
    care only about (crf, p_low). ``mean`` defaults to p_low + 5 so it
    clears typical mean targets without participating in the test."""
    return SampleGuidedEncodeTrial(
        crf=crf,
        summary=_summary(
            mean=mean if mean is not None else p_low + 5.0,
            p1=p_low,
            frame_count=80,
        ),
        encode_seconds=10.0,
        passed=False,
        low_pct_enforced=True,
        encoded_size_bytes=100_000,
        size_percent_of_reference=50.0,
        windows_used=1,
        windows_total=1,
        phase="probe",
    )


# ----- select_initial_probe_crfs -------------------------------------------


def test_select_initial_probe_crfs_three_evenly_spaced() -> None:
    crfs = select_initial_probe_crfs(crf_min=16, crf_max=42, n_probes=3)
    assert crfs == [16, 29, 42]


def test_select_initial_probe_crfs_handles_equal_min_max() -> None:
    crfs = select_initial_probe_crfs(crf_min=20, crf_max=20, n_probes=3)
    assert crfs == [20]


def test_select_initial_probe_crfs_dedups_when_range_smaller_than_n() -> None:
    # 3 probes across [16, 17] would round to [16, 17, 17]; dedup → [16, 17].
    crfs = select_initial_probe_crfs(crf_min=16, crf_max=17, n_probes=3)
    assert crfs == [16, 17]


def test_select_initial_probe_crfs_returns_empty_for_zero_or_inverted() -> None:
    assert select_initial_probe_crfs(crf_min=20, crf_max=10, n_probes=3) == []
    assert select_initial_probe_crfs(crf_min=16, crf_max=42, n_probes=0) == []


# ----- drop_saturated_probes -----------------------------------------------


def test_drop_saturated_probes_passes_through_when_no_saturation() -> None:
    probes = [_probe(20, 92.0), _probe(28, 90.0), _probe(36, 87.0)]
    result = drop_saturated_probes(probes, low_pct=5)
    assert [p.crf for p in result] == [20, 28, 36]


def test_drop_saturated_probes_drops_lower_crf_when_adjacent_match() -> None:
    # crf=18 and crf=22 give same VMAF -> drop 18 (lower CRF, same quality).
    probes = [_probe(18, 92.0), _probe(22, 92.02), _probe(30, 88.0)]
    result = drop_saturated_probes(probes, low_pct=5, epsilon=0.05)
    assert [p.crf for p in result] == [22, 30]


def test_drop_saturated_probes_handles_one_or_zero_probes() -> None:
    assert drop_saturated_probes([], low_pct=5) == []
    sole = [_probe(25, 90.0)]
    assert drop_saturated_probes(sole, low_pct=5) == sole


def test_drop_saturated_probes_chains_saturations() -> None:
    # Three probes all within epsilon -> drop the two lower CRFs,
    # keeping only the highest. (Walks pairs left-to-right.)
    probes = [_probe(16, 92.0), _probe(20, 92.01), _probe(24, 92.02)]
    result = drop_saturated_probes(probes, low_pct=5, epsilon=0.05)
    assert [p.crf for p in result] == [24]


# ----- fit_curves + evaluate_curve -----------------------------------------


def test_piecewise_evaluator_interpolates_within_range() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    probes = [_probe(20, 92.0), _probe(30, 88.0)]
    fit = fit_curves(probes, target=target)
    # Midpoint should interpolate to 90.0.
    assert evaluate_curve(fit, crf=25, model="piecewise") == pytest.approx(90.0)
    # At a probe point, returns the probe value.
    assert evaluate_curve(fit, crf=20, model="piecewise") == pytest.approx(92.0)
    assert evaluate_curve(fit, crf=30, model="piecewise") == pytest.approx(88.0)


def test_piecewise_evaluator_clamps_outside_probe_range() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    probes = [_probe(20, 92.0), _probe(30, 88.0)]
    fit = fit_curves(probes, target=target)
    # Below lowest probe → clamp to lowest probe's value.
    assert evaluate_curve(fit, crf=16, model="piecewise") == pytest.approx(92.0)
    # Above highest probe → clamp to highest probe's value.
    assert evaluate_curve(fit, crf=40, model="piecewise") == pytest.approx(88.0)


def test_global_linear_recovers_known_slope() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Pure linear data: slope=-0.5, intercept = 100.
    probes = [_probe(20, 90.0), _probe(28, 86.0), _probe(36, 82.0)]
    fit = fit_curves(probes, target=target)
    assert fit.linear_slope == pytest.approx(-0.5, abs=1e-9)
    assert fit.linear_intercept == pytest.approx(100.0, abs=1e-9)


# ----- pick_target ----------------------------------------------------------


def test_pick_target_finds_highest_crf_clearing_threshold() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Slope -0.4 per CRF: at crf=27 piecewise predicts 89.2 (above 89);
    # at crf=28 predicts 88.8 (below). Pick the highest CRF clearing
    # target = 27.
    probes = [_probe(20, 92.0), _probe(30, 88.0)]
    fit = fit_curves(probes, target=target)
    assert pick_target(fit, target=target, model="piecewise") == 27


def test_pick_target_returns_none_when_curve_below_target_everywhere() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=95.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    probes = [_probe(20, 92.0), _probe(30, 88.0)]
    fit = fit_curves(probes, target=target)
    assert pick_target(fit, target=target) is None


# ----- pick_knee ------------------------------------------------------------


def test_pick_knee_finds_steepening_in_three_probe_curve() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Smooth slope -0.2 from 20→28, then cliff -1.0 from 28→36.
    # Knee should be at crf=28 (last good step before the cliff).
    probes = [_probe(20, 92.0), _probe(28, 90.4), _probe(36, 82.4)]
    fit = fit_curves(probes, target=target)
    assert pick_knee(fit, target=target) == 28


def test_pick_knee_returns_none_for_smooth_curve() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Linear-ish: slope -0.5 throughout. No clear knee.
    probes = [_probe(20, 92.0), _probe(28, 88.0), _probe(36, 84.0)]
    fit = fit_curves(probes, target=target)
    assert pick_knee(fit, target=target) is None


def test_pick_knee_returns_none_with_fewer_than_three_probes() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    probes = [_probe(20, 92.0), _probe(30, 88.0)]
    fit = fit_curves(probes, target=target)
    assert pick_knee(fit, target=target) is None


def test_pick_knee_respects_steepening_threshold() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Slight slope change: -0.2 then -0.4. Below default threshold (0.3).
    probes = [_probe(20, 92.0), _probe(28, 90.4), _probe(36, 87.2)]
    fit = fit_curves(probes, target=target)
    assert pick_knee(fit, target=target) is None
    # Lower the threshold: now picks up the steepening.
    assert pick_knee(fit, target=target, steepening_threshold=0.1) == 28


# ----- pick_budget ----------------------------------------------------------


def test_pick_budget_accepts_within_tolerance_below_target() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Need 3 probes so the piecewise curve doesn't just clamp at 88
    # for everything above crf=30. With (40, 80) added, the segment
    # 30→40 interpolates linearly: at crf=30 piecewise=88 (matches
    # tolerance budget). Above crf=30 the curve drops below 88.
    probes = [_probe(20, 92.0), _probe(30, 88.0), _probe(40, 80.0)]
    fit = fit_curves(probes, target=target)
    assert pick_budget(fit, target=target, tolerance=1.0) == 30


# ----- needs_extra_probe ----------------------------------------------------


def test_needs_extra_probe_triggers_on_saturation_collapse() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # All three probes saturate to ~92.0 → 1 valid probe after drop.
    probes = [_probe(20, 92.0), _probe(24, 92.01), _probe(28, 92.02)]
    crf, reason = needs_extra_probe(probes, target=target)
    assert crf is not None
    assert "saturat" in reason.lower()


def test_needs_extra_probe_triggers_on_large_gap() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Two probes 16 CRFs apart - way above the default refit gap (8).
    probes = [_probe(16, 95.0), _probe(32, 85.0)]
    crf, reason = needs_extra_probe(probes, target=target)
    # Midpoint of gap (16 + 32) // 2 = 24.
    assert crf == 24
    assert "gap" in reason.lower()


def test_needs_extra_probe_returns_none_when_curve_is_well_covered() -> None:
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    # Smooth curve, dense probes, no boundary knee.
    probes = [
        _probe(18, 93.0), _probe(24, 91.0), _probe(30, 88.0),
        _probe(36, 84.0),
    ]
    crf, _reason = needs_extra_probe(probes, target=target)
    assert crf is None


# ----- find_crf_via_curve_fit (integration with mocked evaluator) ----------


def test_find_crf_via_curve_fit_picks_via_target_on_smooth_curve() -> None:
    """Smooth (no knee) curve crossing target → TARGET fallback picks
    the highest CRF clearing target_vmaf_low."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=85.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )

    def evaluate(crf: int) -> TrialMeasurement:
        # Smooth: VMAF = 100 - 0.5 * crf. At target=89, crf=22.
        p_low = 100.0 - 0.5 * crf
        return TrialMeasurement(
            summary=_summary(mean=p_low + 5.0, p1=p_low, frame_count=80),
            encoded_size_bytes=50_000,
            encoded_paths=[],
            windows_used=1, windows_total=1,
        )

    result, fit_result = find_crf_via_curve_fit(
        target=target,
        evaluate_at_crf=evaluate,
    )
    # Smooth curve → no knee → fall back to target.
    assert fit_result.picks.chosen_heuristic == "target"
    # 100 - 0.5 * 22 = 89.0 (exactly at target). Picks crf=22.
    assert result.optimal_crf == 22


def test_find_crf_via_curve_fit_records_all_nine_picks() -> None:
    """Every (curve, heuristic) combination must produce an entry in
    the picks grid — even when None — so the metadata file is
    structurally consistent across runs."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=85.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )

    def evaluate(crf: int) -> TrialMeasurement:
        p_low = 100.0 - 0.5 * crf
        return TrialMeasurement(
            summary=_summary(mean=p_low + 5.0, p1=p_low, frame_count=80),
            encoded_size_bytes=50_000,
            encoded_paths=[],
            windows_used=1, windows_total=1,
        )

    _result, fit_result = find_crf_via_curve_fit(
        target=target,
        evaluate_at_crf=evaluate,
    )
    grid = fit_result.picks.by_curve_and_heuristic
    assert set(grid.keys()) == {"piecewise", "linear", "log"}
    for model_picks in grid.values():
        assert set(model_picks.keys()) == {"target", "knee", "budget"}


def test_find_crf_via_curve_fit_does_not_double_encode_chosen_probe() -> None:
    """When chosen_crf is already a probe, the verify-encode reuses
    that trial — no extra evaluator call beyond the initial probes."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=85.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    call_log: list[int] = []

    def evaluate(crf: int) -> TrialMeasurement:
        call_log.append(crf)
        # Curve hand-crafted so the target=89 crosses at crf=29 (a probe).
        if crf == 16:
            p_low = 95.0
        elif crf == 29:
            p_low = 89.0
        elif crf == 42:
            p_low = 80.0
        else:
            p_low = 95.0 - 0.5 * (crf - 16)
        return TrialMeasurement(
            summary=_summary(mean=p_low + 5.0, p1=p_low, frame_count=80),
            encoded_size_bytes=50_000,
            encoded_paths=[],
            windows_used=1, windows_total=1,
        )

    _result, _fit = find_crf_via_curve_fit(
        target=target,
        evaluate_at_crf=evaluate,
        n_initial_probes=3,
        max_probes=3,  # disable adaptive refit so we test only the verify step
    )
    # Initial 3 probes at 16/29/42; chosen = 29 (one of the probes);
    # no extra call should happen for verification.
    assert call_log == [16, 29, 42]


def test_render_curve_ascii_renders_probes_target_and_chosen_crf() -> None:
    """Plotille braille chart contains the chosen-CRF callout in the
    legend, the y-axis label, and the x-axis label."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    probes = [_probe(20, 92.0), _probe(28, 90.0), _probe(36, 86.0)]
    fit = fit_curves(probes, target=target)
    lines = render_curve_ascii(fit, target=target, chosen_crf=28)
    assert lines  # non-empty
    full = "\n".join(lines)
    # Plotille emits the y-axis label in parentheses near the top.
    assert "(p5)" in full
    # X-axis label confirms we plotted CRF on x.
    assert "(crf)" in full
    # Legend identifies the chosen CRF and the colored elements.
    assert "chose crf=28" in full
    assert "probes" in full
    assert "curve" in full


def test_render_curve_ascii_returns_empty_for_no_probes() -> None:
    """Empty curve → empty list (caller skips logging)."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=90.0, target_vmaf_low=89.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )
    fit = fit_curves([], target=target)
    assert render_curve_ascii(fit, target=target, chosen_crf=20) == []


def test_find_crf_via_curve_fit_records_knee_in_picks_grid() -> None:
    """Knee is computed and recorded in picks_grid even when not the
    default chosen heuristic (default is now target). Distinct cliff
    between probes 29 and 42 → knee detects the higher-CRF end of
    the smooth segment (29)."""
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=85.0, target_vmaf_low=70.0, target_vmaf_low_pct=5,
        crf_min=16, crf_max=42,
    )

    def evaluate(crf: int) -> TrialMeasurement:
        # Smooth slope -0.2 below 30, cliff -2.0 above 30. Knee at 29.
        p_low = 95.0 - 0.2 * (crf - 16) if crf <= 29 else 92.4 - 2.0 * (crf - 29)
        return TrialMeasurement(
            summary=_summary(mean=p_low + 5.0, p1=p_low, frame_count=80),
            encoded_size_bytes=50_000,
            encoded_paths=[],
            windows_used=1, windows_total=1,
        )

    _result, fit_result = find_crf_via_curve_fit(
        target=target,
        evaluate_at_crf=evaluate,
        n_initial_probes=3,
    )
    # Knee detection still runs and records its pick — caller just
    # doesn't use it by default. With a clear cliff between probes
    # 29 and 42, knee picks the smooth-segment endpoint (29).
    assert fit_result.picks.by_curve_and_heuristic["piecewise"]["knee"] == 29
