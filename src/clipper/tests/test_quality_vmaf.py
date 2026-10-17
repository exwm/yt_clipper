"""Unit tests for ``clipper.quality.vmaf``.

Covers the aggregation math directly and the ``FfmpegQualityMetrics``
wiring via mock: no real ffmpeg invocation, fast (sub-second), offline.
"""

from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path
from statistics import quantiles
from unittest.mock import MagicMock, patch

import pytest

from clipper.quality import (
    VMAF_NEG_MODEL_FILENAME,
    VmafSummary,
    measure_per_frame_vmaf_neg,
    measure_vmaf_neg,
    summarize_vmaf,
)

# ---------------------------------------------------------------------------
# summarize_vmaf: pure-function aggregation math
# ---------------------------------------------------------------------------


def test_summarize_vmaf_empty_list_returns_nan_summary() -> None:
    """Empty input yields NaN aggregates and zero frame count.

    Distinguishes "no data" from "data with score zero" for downstream
    callers without requiring them to special-case the empty list.
    """
    summary = summarize_vmaf([])
    assert math.isnan(summary.mean)
    assert math.isnan(summary.p1)
    assert math.isnan(summary.p5)
    assert math.isnan(summary.p10)
    assert math.isnan(summary.p15)
    assert math.isnan(summary.p20)
    assert math.isnan(summary.p25)
    assert math.isnan(summary.minimum)
    assert summary.frame_count == 0


def test_summarize_vmaf_single_frame_collapses_all_aggregates() -> None:
    """One frame -> mean / p1..p25 / min are all that one score.

    Avoids the percentile-on-too-few-samples pitfall (statistics.quantiles
    requires >=2 samples). All percentile fields collapse to the single
    value so downstream callers don't get NaN holes.
    """
    summary = summarize_vmaf([88.5])
    assert summary.mean == pytest.approx(88.5)
    assert summary.p1 == pytest.approx(88.5)
    assert summary.p5 == pytest.approx(88.5)
    assert summary.p10 == pytest.approx(88.5)
    assert summary.p15 == pytest.approx(88.5)
    assert summary.p20 == pytest.approx(88.5)
    assert summary.p25 == pytest.approx(88.5)
    assert summary.minimum == pytest.approx(88.5)
    assert summary.frame_count == 1


@pytest.mark.parametrize(
    "scores",
    [[70.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0], [80.0 + i * 0.2 for i in range(100)], [3.0, 1.0]],
    ids=["7 frames", "100 frames", "2 frames unsorted"],
)
def test_summarize_vmaf_n_frames_computes_mean_percentiles_min(scores: list[float]) -> None:
    """mean = arithmetic mean, p1..p25 = inclusive percentiles, min = min.

    The percentiles also rise from p1 to p25, below the mean, which the auto-scaling threshold
    logic in SampleGuidedEncodeTarget relies on.
    """
    summary = summarize_vmaf(scores)

    assert summary.frame_count == len(scores)
    assert summary.mean == pytest.approx(sum(scores) / len(scores))
    assert summary.minimum == pytest.approx(min(scores))
    cuts = quantiles(scores, n=100, method="inclusive")
    assert summary.p1 == pytest.approx(cuts[0])
    assert summary.p5 == pytest.approx(cuts[4])
    assert summary.p10 == pytest.approx(cuts[9])
    assert summary.p15 == pytest.approx(cuts[14])
    assert summary.p20 == pytest.approx(cuts[19])
    assert summary.p25 == pytest.approx(cuts[24])
    assert summary.p1 <= summary.p5 <= summary.p10 <= summary.p15 <= summary.p20 <= summary.p25 <= summary.mean


# ---------------------------------------------------------------------------
# measure_per_frame_vmaf_neg: wiring around the mocked library
# ---------------------------------------------------------------------------


def _make_fake_ffqm(per_frame_payload: list[dict]) -> MagicMock:
    """Build a MagicMock that mimics FfmpegQualityMetrics(...).calculate(...).

    Returns the per-frame payload caller specifies under the "vmaf" key,
    matching the real library's shape: ``{"vmaf": [{"vmaf": 90.1, ...}, ...]}``.
    """
    instance = MagicMock()
    instance.calculate.return_value = {"vmaf": per_frame_payload}
    return instance


def test_measure_per_frame_asks_the_library_for_vmaf_neg_and_returns_floats_in_frame_order() -> None:
    """The library gets our ffmpeg path, ref/dist as strings, threads, the vmaf metric and the NEG
    model (our calibration and shipping decisions are tuned against NEG, not vmaf_v0.6.1). Scores
    come back in frame order as floats: some libvmaf payloads emit integers, which mixed types would
    trip in ``statistics.quantiles``.
    """
    fake_instance = _make_fake_ffqm([{"n": 1, "vmaf": 95.5}, {"n": 2, "vmaf": 100}, {"n": 3, "vmaf": 91.0}])
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ) as ffqm_cls:
        result = measure_per_frame_vmaf_neg(
            ffmpeg_path="/path/to/ffmpeg",
            reference_path=Path("ref.mp4"),
            encoded_path=Path("enc.mp4"),
            threads=4,
        )
    ffqm_cls.assert_called_once()
    kwargs = ffqm_cls.call_args.kwargs
    assert kwargs["ref"] == "ref.mp4"
    assert kwargs["dist"] == "enc.mp4"
    assert kwargs["ffmpeg_path"] == "/path/to/ffmpeg"
    assert kwargs["threads"] == 4
    fake_instance.calculate.assert_called_once()
    call_kwargs = fake_instance.calculate.call_args.kwargs
    assert call_kwargs["metrics"] == ["vmaf"]
    assert call_kwargs["vmaf_options"]["model_path"] == VMAF_NEG_MODEL_FILENAME
    assert result == [95.5, 100.0, 91.0]
    assert all(isinstance(score, float) for score in result)


# ---------------------------------------------------------------------------
# measure_vmaf_neg: composition end-to-end
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def ffmpeg_with_vmaf() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    filters = subprocess.run(
        [path, "-hide_banner", "-filters"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    if "libvmaf" not in filters:
        pytest.skip("needs ffmpeg with libvmaf")
    return path


def test_an_mp4_encode_is_scored_frame_by_frame_against_a_webm_reference(
    ffmpeg_with_vmaf: str,
    tmp_path: Path,
) -> None:
    # WebM keeps timestamps in milliseconds (33, 67, 100) and mp4 exactly (33.3, 66.7): pairing frames by
    # timestamp matched every third mp4 frame with the reference's frame before. Lossless copies of the
    # same moving frames must score near the top on every frame.
    source = ["-f", "lavfi", "-i", "testsrc2=s=320x180:r=30", "-t", "2", "-an"]
    quiet = [ffmpeg_with_vmaf, "-hide_banner", "-loglevel", "error", "-y"]
    reference, encoded = tmp_path / "reference.webm", tmp_path / "encoded.mp4"
    subprocess.run(
        [*quiet, *source, "-c:v", "libvpx-vp9", "-lossless", "1", str(reference)],
        check=True,
    )
    subprocess.run(
        [*quiet, *source, "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p", str(encoded)],
        check=True,
    )
    per_frame = measure_per_frame_vmaf_neg(
        ffmpeg_path=ffmpeg_with_vmaf,
        reference_path=reference,
        encoded_path=encoded,
    )
    assert len(per_frame) == 60
    assert min(per_frame) > 90


def test_measure_vmaf_neg_threads_through_to_summary() -> None:
    """Convenience wrapper composes measure_per_frame + summarize_vmaf.

    The returned summary's mean/p1/frame_count come from the same per-frame
    payload that the underlying library mock emits.
    """
    fake_instance = _make_fake_ffqm(
        [
            {"vmaf": 80.0},
            {"vmaf": 85.0},
            {"vmaf": 90.0},
            {"vmaf": 95.0},
        ],
    )
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ):
        summary = measure_vmaf_neg(
            ffmpeg_path="ffmpeg",
            reference_path=Path("ref.mp4"),
            encoded_path=Path("enc.mp4"),
        )
    assert isinstance(summary, VmafSummary)
    assert summary.frame_count == 4
    assert summary.mean == pytest.approx((80 + 85 + 90 + 95) / 4)
    assert summary.minimum == pytest.approx(80.0)
