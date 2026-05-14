"""VMAF NEG measurement helpers, layered over ffmpeg-quality-metrics.

Wraps :class:`ffmpeg_quality_metrics.FfmpegQualityMetrics` so callers get a
stable Python API for "measure VMAF NEG of an encoded video against a
reference, return mean and 1st-percentile". Designed to be the building block
for the upcoming empirical CRF binary-search driver, which encodes the same
source at multiple CRFs and picks the lowest CRF whose :class:`VmafSummary`
clears user-specified mean/p1 targets.

Inputs are expected to have matching frame counts and dimensions. This holds
by construction in our pipeline: we always compare encodes derived from the
same source range with the same filter chain (only the encoder CRF differs).
Callers that violate this invariant get noisy or nonsensical results; we
don't try to auto-sync.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import quantiles

from ffmpeg_quality_metrics import FfmpegQualityMetrics, VmafOptions

# Bundled with the ffmpeg-quality-metrics package's ``vmaf_models/`` data
# directory. The library searches that directory first when given a bare
# filename, so no absolute path is needed at the call site.
VMAF_NEG_MODEL_FILENAME = "vmaf_v0.6.1neg.json"


@dataclass(frozen=True)
class VmafSummary:
    """Aggregated VMAF NEG scores across all frames of one encode.

    Multiple low-percentile values (p1, p5, p10, p15, p20, p25) are
    precomputed so callers can pick which one to enforce as a
    shipping-quality target. Lower percentiles are stricter (a smaller
    fraction of frames is allowed below threshold) but need more total
    frames to be statistically meaningful — at 100 frames p1 is
    essentially ``minimum``, while p20-p25 are stable from 15 frames
    upward. The "right" percentile for a given clip depends on its
    per-frame VMAF distribution: p5 is sensitive to small left-tail
    outliers (good for content with sharp artifacts), while p20-p25 sit
    on the bulk distribution's shoulder (better signal-to-noise for
    content with mostly-uniform per-frame quality). Pre-computing all
    six lets the caller pick the percentile that matches its frame
    budget and content type, and report the others for visibility.

    ``mean`` is always meaningful regardless of frame count and is the
    reliable secondary target. ``minimum`` is reported for diagnostics
    but rarely used for decisions — too noisy on short clips.

    The p15-p25 fields default to NaN so tests that build mock summaries
    via small constructors don't need to enumerate every percentile.
    Production code (``summarize_vmaf``) always sets them.
    """

    mean: float
    p1: float
    p5: float
    p10: float
    minimum: float
    frame_count: int
    p15: float = float("nan")
    p20: float = float("nan")
    p25: float = float("nan")


def measure_per_frame_vmaf_neg(
    *,
    ffmpeg_path: str,
    reference_path: Path,
    encoded_path: Path,
    threads: int = 0,
) -> list[float]:
    """Return one VMAF NEG score per matched frame pair.

    ``threads=0`` lets libvmaf pick (effectively all CPU cores).
    """
    ffqm = FfmpegQualityMetrics(
        ref=str(reference_path),
        dist=str(encoded_path),
        ffmpeg_path=ffmpeg_path,
        threads=threads,
    )
    vmaf_options: VmafOptions = {
        "model_path": VMAF_NEG_MODEL_FILENAME,
        "model_params": [],
        "n_threads": None,
        "n_subsample": None,
        "features": [],
    }
    metrics = ffqm.calculate(metrics=["vmaf"], vmaf_options=vmaf_options)
    return [float(frame["vmaf"]) for frame in metrics["vmaf"]]


def summarize_vmaf(per_frame: list[float]) -> VmafSummary:
    """Aggregate per-frame VMAF NEG scores into mean / p1..p25 / min.

    All six low percentiles (p1, p5, p10, p15, p20, p25) are computed
    unconditionally so callers can pick which to enforce without a
    re-aggregation pass. Cost is negligible — ``statistics.quantiles``
    is a single O(n log n) sort.
    """
    if not per_frame:
        nan = float("nan")
        return VmafSummary(
            mean=nan, p1=nan, p5=nan, p10=nan, p15=nan, p20=nan, p25=nan,
            minimum=nan, frame_count=0,
        )
    if len(per_frame) == 1:
        only = per_frame[0]
        return VmafSummary(
            mean=only, p1=only, p5=only, p10=only,
            p15=only, p20=only, p25=only,
            minimum=only, frame_count=1,
        )
    cuts = quantiles(per_frame, n=100, method="inclusive")
    # cuts has 99 entries dividing the sorted data into 100 equal groups;
    # cuts[i] is the (i+1)-th percentile.
    return VmafSummary(
        mean=sum(per_frame) / len(per_frame),
        p1=cuts[0],
        p5=cuts[4],
        p10=cuts[9],
        p15=cuts[14],
        p20=cuts[19],
        p25=cuts[24],
        minimum=min(per_frame),
        frame_count=len(per_frame),
    )


def measure_vmaf_neg(
    *,
    ffmpeg_path: str,
    reference_path: Path,
    encoded_path: Path,
    threads: int = 0,
) -> VmafSummary:
    """Per-frame measurement plus aggregation in one call."""
    return summarize_vmaf(
        measure_per_frame_vmaf_neg(
            ffmpeg_path=ffmpeg_path,
            reference_path=reference_path,
            encoded_path=encoded_path,
            threads=threads,
        ),
    )
