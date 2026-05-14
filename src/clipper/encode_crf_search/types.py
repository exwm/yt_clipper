"""Data shapes, constants, and percentile-table helpers for the CRF search.

Pure-data layer. Everything in here is either:

- A dataclass holding search inputs / outputs (``CrfSearchTarget``,
  ``SampleWindow``, ``CrfSearchTrial``, ``TrialMeasurement``,
  ``CrfSearchResult``).
- A constant calibrated for yt_clipper's typical workload.
- A trivial helper that maps the user's chosen low-percentile value
  (1, 5, or 10) to its corresponding floor / threshold / summary field.

No I/O, no algorithms — those live in sibling modules so this file
stays small, stable, and the natural import target for type-only
references throughout the codebase.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from clipper.quality import VmafSummary

# ---------------------------------------------------------------------------
# Percentile choice + thresholds
# ---------------------------------------------------------------------------

# Supported low-percentile choices for the trial-passing predicate.
# Higher percentile values are more permissive (10% of frames allowed
# below threshold vs 1%) but stabler at lower frame counts. yt_clipper's
# default is p5 — middle ground for short / slowed clips where p1 is
# noisy from single-frame artifacts but p10 too readily ignores real
# encoder mistakes. p15-p25 are also supported for users who want
# higher signal-to-noise at the cost of less worst-frame protection;
# at the same threshold value, p20 typically responds 2-3x more
# strongly to CRF changes than p5 with much lower noise. The trade-off
# is that p20-p25 sit on the bulk-distribution shoulder rather than the
# left tail, so they care less about isolated bad frames. The default
# stays at p5 because the strict-target ladder is calibrated around
# its threshold (89.0); switching the default to a higher percentile
# requires retuning the threshold against your content corpus.
SUPPORTED_LOW_PERCENTILES: tuple[int, ...] = (1, 5, 10, 15, 20, 25)
DEFAULT_LOW_PERCENTILE: int = 5


# Minimum combined frames for each low percentile to be a meaningful
# percentile (rather than essentially equal to ``min``). A clip's
# combined trial frame count is checked against this — below the floor,
# the orchestrator either keeps encoding more windows or, if it can't,
# the adaptive ``passes_targets`` drops the percentile check entirely
# and falls back to mean-only.
#
# Rule of thumb: enough frames so the percentile boundary lands above
# the lowest 1-3 outlier frames. p1 needs 100 frames (1% of 100 = 1
# frame, essentially min); p5 needs 50 (5% of 50 = 2.5); p10 needs 30.
# p15, p20, p25 are stable at progressively smaller counts as more of
# the distribution falls within the bracket.
_MIN_FRAMES_BY_LOW_PERCENTILE: dict[int, int] = {
    1: 100,
    5: 50,
    10: 30,
    15: 20,
    20: 15,
    25: 12,
}


# Default low-percentile threshold tied to which percentile the user
# (or the auto-default) picks. Calibrated for yt_clipper's quality-
# conscious user base + short / slowed clips: targets transparency-
# adjacent quality (industry/Netflix uses p1 ≥ 85, mean ≥ 90; ab-av1
# uses mean ≥ 95 with no percentile backstop). The yt_clipper defaults
# sit at the strict end because short / slowed clips amplify artifacts
# that long-form streaming viewers would miss.
#
# The ladder accounts for higher percentiles being more permissive at
# the same threshold value: p5 ≥ 89 allows 5% of frames below 89, where
# p1 ≥ 89 only allows 1% below. The spacing shrinks at higher
# percentiles because successive percentile cuts converge toward the
# median (the bulk of the distribution lives in a narrow band of high
# VMAF values), so equal strictness across percentile choices requires
# higher thresholds at higher percentiles.
_DEFAULT_LOW_THRESHOLD_BY_PERCENTILE: dict[int, float] = {
    1: 91.0,  # industry-standard 85 + 6 (yt_clipper stricter floor)
    5: 93.0,  # p1 + 2
    10: 95.0,  # p1 + 4
    15: 96.0,  # +1 over p10 (smaller spacing as percentiles converge)
    20: 96.5,  # +0.5 over p15
    25: 97.0,  # +0.5 over p20
}

# yt_clipper-stricter mean default. Industry/Netflix uses 90, ab-av1
# uses 95 (no percentile backstop). 95 matches ab-av1's transparency-
# adjacent target, paired with the low-percentile ladder above as a
# worst-frame backstop — short / slowed clips need both because mean
# alone can mask localized artifact bursts.
DEFAULT_TARGET_VMAF_MEAN: float = 95.0


def get_low_percentile_value(summary: VmafSummary, percentile: int) -> float:
    """Return the per-summary VMAF value for the given low percentile.

    Picks the matching ``summary.pN`` field by the integer percentile
    choice. Falls back to the default percentile (``p20``) for
    unsupported values so unknown percentile inputs degrade gracefully
    rather than crash mid-search.
    """
    if percentile == 1:
        return summary.p1
    if percentile == 5:
        return summary.p5
    if percentile == 10:
        return summary.p10
    if percentile == 15:
        return summary.p15
    if percentile == 25:
        return summary.p25
    return summary.p20


def min_frames_for_low_percentile(percentile: int) -> int:
    """Minimum combined-frame count for a stable percentile measurement.

    Below this count the percentile interpolation is too noisy and the
    orchestrator should keep encoding more windows. Falls back to the p5
    threshold for unsupported percentile values.
    """
    return _MIN_FRAMES_BY_LOW_PERCENTILE.get(
        percentile,
        _MIN_FRAMES_BY_LOW_PERCENTILE[DEFAULT_LOW_PERCENTILE],
    )


def default_low_threshold_for_percentile(percentile: int) -> float:
    """Default low-VMAF threshold scaled to the chosen percentile.

    Calibrated to maintain equivalent shipping-quality strictness across
    percentile choices — see ``_DEFAULT_LOW_THRESHOLD_BY_PERCENTILE`` for
    rationale. Falls back to the p5 default for unsupported values.
    """
    return _DEFAULT_LOW_THRESHOLD_BY_PERCENTILE.get(
        percentile,
        _DEFAULT_LOW_THRESHOLD_BY_PERCENTILE[DEFAULT_LOW_PERCENTILE],
    )


# Backwards-compatible alias for the old MIN_FRAMES_FOR_RELIABLE_P1
# constant. New code should use ``min_frames_for_low_percentile(pct)``.
MIN_FRAMES_FOR_RELIABLE_P1: int = _MIN_FRAMES_BY_LOW_PERCENTILE[1]

# ---------------------------------------------------------------------------
# Sampling defaults
# ---------------------------------------------------------------------------

# Default sampling target as a percentage of the final encode's frame count.
# Set so for a typical multi-minute clip the search encodes roughly 10% of
# the final-encode work, getting a 10x speedup vs full-clip trials. For
# short clips the floor (MIN_FRAMES_FOR_RELIABLE_P1 below) takes over so
# p1 stays meaningful — sampling 10% of a 200-frame clip would only give
# 20 combined frames, well below the threshold for stable p1.
DEFAULT_TARGET_SAMPLE_PERCENT: float = 10.0

# Default fallback frame count when the final-encode frame count is unknown
# (e.g. source fps couldn't be resolved). 150 sits above
# MIN_FRAMES_FOR_RELIABLE_P1 so the adaptive p1 check stays enforced.
DEFAULT_TARGET_TRIAL_FRAMES: int = 150
DEFAULT_N_WINDOWS: int = 3

# ---------------------------------------------------------------------------
# Reference-encode picks
# ---------------------------------------------------------------------------

# Per-codec near-transparent CRF for the reference encode. Same choice as
# the parked branch's calibration-compare reference mode — empirically
# validated to give VMAF NEG > 95 mean across the test clips.
_REFERENCE_CRF_BY_CODEC: dict[str, int] = {
    "h264": 18,
    "h264_nvenc": 18,
    "h264_vulkan": 18,
    "vp9": 18,
    "vp8": 6,
}
_REFERENCE_CRF_FALLBACK: int = 18

# Filename suffix for the cached per-window reference encodes. Includes
# {window_index} so each window has a stable filename across runs and the
# existing ``mp["exists"]`` cache skips re-encoding on subsequent runs.
REFERENCE_SUFFIX_TEMPLATE: str = ".crfsearch-ref-w{window_index}"
TRIAL_SUFFIX_TEMPLATE: str = ".crfsearch-trial-crf{crf}-w{window_index}"


# ---------------------------------------------------------------------------
# Data shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CrfSearchTarget:
    """User-specified VMAF NEG floor an encode must clear to be acceptable.

    Two checks combine to decide pass/fail:

    1. ``target_vmaf_mean`` — arithmetic mean across all sampled frames.
       Always enforced.
    2. ``target_vmaf_low`` at the percentile named by
       ``target_vmaf_low_pct`` — captures worst-case frames. Lower
       percentiles are stricter (1% of frames vs 5% vs 10% allowed below
       threshold) but require more frames to be statistically meaningful.
       Defaults to p5 — a middle ground for yt_clipper's typical short /
       slowed clips where p1 over-penalizes single-frame artifacts and
       p10 too readily ignores real encoder mistakes. The threshold
       value scales with the percentile choice (see
       :func:`default_low_threshold_for_percentile`) so equivalent
       shipping-quality strictness is preserved across choices.

    The low-percentile check is enforced only when the trial has at
    least :func:`min_frames_for_low_percentile` combined frames; below
    that the verdict is mean-only and ``passed`` reflects mean alone.

    ``crf_max`` is the *starting* upper bound, not a hard cap. If the
    initial probe at ``crf_max`` passes with comfortable VMAF headroom
    (see ``expansion_min_*_headroom``), the search expands upward in
    ``expansion_step`` increments — up to ``crf_absolute_max`` — to find
    the real compression ceiling rather than declaring an early "easy
    clip" win that leaves bits on the table.
    """

    target_vmaf_mean: float
    target_vmaf_low: float
    target_vmaf_low_pct: int = DEFAULT_LOW_PERCENTILE
    crf_min: int = 16  # safest (highest quality, biggest file)
    crf_max: int = 42  # starting upper bound — raised when easy clips pass
    crf_absolute_max: int = 51  # hard ceiling — never probe above this
    max_iterations: int = 8  # bumped from 6 to leave headroom for expansion + bisect
    expansion_step: int = 3  # CRF increment per upward-expansion probe
    # Minimum VMAF margin above the target (in points) required to bother
    # probing higher. Both must be exceeded — we don't want to expand when
    # mean has room but the low percentile is at the edge (the next CRF
    # likely fails it).
    expansion_min_mean_headroom: float = 3.0
    expansion_min_low_headroom: float = 3.0


@dataclass(frozen=True)
class SampleWindow:
    """One time window within a marker pair's range, in source-video
    coordinates (matching ``mp["start"]`` / ``mp["end"]`` semantics)."""

    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class CrfSearchTrial:
    """One step of the binary search: tried this CRF, got this VMAF."""

    crf: int
    summary: VmafSummary
    encode_seconds: float
    passed: bool  # see passes_targets()
    low_pct_enforced: bool  # was the configured low percentile part of the pass/fail decision?
    encoded_size_bytes: int  # total file size across the windows actually encoded for this trial
    size_percent_of_reference: float  # encoded_size_bytes / reference total * 100
    windows_used: int = 0  # number of sample windows actually encoded (≤ total)
    windows_total: int = 0  # number of sample windows the orchestrator could have encoded
    # Two-phase search labels each trial by which phase produced it
    # ("phase1" middle-window discovery, "phase2" full-windows validation,
    # "phase3" full-windows downward bisection). Empty string means
    # single-phase search (the trial wasn't part of a phased flow).
    phase: str = ""
    # Bitrate at this CRF (kbps), derived from ``encoded_size_bytes``
    # over the trial's measured frame duration. Per-frame size scales
    # linearly with frame count, so this also predicts the full final
    # encode's bitrate at the same CRF.
    bitrate_kbps: float = 0.0


@dataclass(frozen=True)
class TrialMeasurement:
    """Single trial's encode + measurement outcome.

    Returned from the orchestrator's ``evaluate_trial`` callback to
    :func:`find_optimal_crf`. Combines what was previously two separate
    callbacks (``encode_at_crf`` then ``measure_vs_reference``) so the
    orchestrator can interleave encoding and measurement and short-circuit
    after the first window if we're already confident in the verdict.

    ``reference_size_bytes_for_windows`` lets evaluators that encode a
    subset of the available windows (e.g. Phase 1 of two-phase search,
    which uses middle window only) report the matching reference subset's
    size — so the trial's ``size_percent_of_reference`` compares like to
    like rather than 1-window-encoded vs N-window-reference. Default 0
    means "use the search's global reference_size_bytes" — back-compat
    for single-phase callers that always encode every window.
    """

    summary: VmafSummary
    encoded_size_bytes: int
    encoded_paths: list[Path]
    windows_used: int  # 1..n_windows, depending on early-exit
    windows_total: int  # the n_windows the trial COULD have encoded
    reference_size_bytes_for_windows: int = 0
    # Bitrate at this trial's CRF, derived from the trial's own
    # ``encoded_size_bytes`` over its measured duration. Per-frame size
    # scales linearly with frame count, so this kbps figure is also the
    # *predicted* bitrate of the full final encode at the same CRF —
    # enabling the orchestrator's joint CRF + maxrate decision in
    # ``--crf-search`` mode without extra computation downstream.
    bitrate_kbps: float = 0.0


@dataclass(frozen=True)
class CrfSearchResult:
    """Final outcome of a per-clip binary search.

    ``optimal_crf`` is ``None`` iff no trial passed (clip is harder than
    ``crf_min`` can handle at the given targets). Caller falls back to
    ``crf_min`` for the final encode and emits a warning.

    Frame-count fields surface how much encode work the search did vs how
    much the final user-visible encode will do. Useful for tuning
    sampling parameters: if ``search_frames`` is a big fraction of
    ``final_frames_estimate``, sampling is barely saving any work and the
    user could either lower ``target_combined_frames`` or accept full-clip
    trials. If it's a small fraction, sampling is paying off.
    """

    optimal_crf: int | None
    optimal_summary: VmafSummary | None
    trials: list[CrfSearchTrial] = field(default_factory=list)
    target: CrfSearchTarget | None = None
    sample_windows: list[SampleWindow] = field(default_factory=list)
    reference_size_bytes: int = 0  # total ref size across sampled windows
    search_frames: int = 0  # frames encoded across all trials (sum)
    final_frames_estimate: int = 0  # estimated frame count of the final encode
    search_seconds: float = 0.0  # cumulative wall time across all trials
    # The trial measured at the CRF yt_clipper would have auto-picked
    # if --crf-search were OFF. Encoded once at search start (or
    # reconstructed from the prior run's ``fit`` JSONL record on a cache
    # hit); never part of the search probe set. Surfaced separately so
    # the summary block can show a "delta vs. baseline" line without
    # the picked-trial iterators having to skip a fake probe.
    baseline_trial: CrfSearchTrial | None = None
