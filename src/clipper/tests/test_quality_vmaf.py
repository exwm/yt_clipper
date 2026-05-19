"""Unit tests for ``clipper.quality.vmaf``.

Covers the aggregation math directly and the ``FfmpegQualityMetrics``
wiring via mock — no real ffmpeg invocation, fast (sub-second), offline.
"""

from __future__ import annotations

import math
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
# summarize_vmaf — pure-function aggregation math
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


def test_summarize_vmaf_n_frames_computes_mean_percentiles_min() -> None:
    """mean = arithmetic mean, p1..p25 = inclusive percentiles, min = min."""
    scores = [70.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0]
    summary = summarize_vmaf(scores)

    assert summary.mean == pytest.approx(sum(scores) / len(scores))
    assert summary.minimum == pytest.approx(70.0)
    cuts = quantiles(scores, n=100, method="inclusive")
    assert summary.p1 == pytest.approx(cuts[0])
    assert summary.p5 == pytest.approx(cuts[4])
    assert summary.p10 == pytest.approx(cuts[9])
    assert summary.p15 == pytest.approx(cuts[14])
    assert summary.p20 == pytest.approx(cuts[19])
    assert summary.p25 == pytest.approx(cuts[24])


def test_summarize_vmaf_percentiles_ordered_low_to_high() -> None:
    """p1 <= p5 <= p10 <= p15 <= p20 <= p25 <= mean for typical scores.

    Locks the documented invariant that the lower percentiles report
    strictly-or-equal lower scores than higher percentiles, which the
    auto-scaling threshold logic in SampleGuidedEncodeTarget relies on.
    """
    # Long enough that quantile interpolation has data to work with.
    scores = [80.0 + i * 0.2 for i in range(100)]  # 80..100 in 0.2 steps
    summary = summarize_vmaf(scores)
    assert (
        summary.p1
        <= summary.p5
        <= summary.p10
        <= summary.p15
        <= summary.p20
        <= summary.p25
        <= summary.mean
    )


def test_summarize_vmaf_frame_count_matches_input_length() -> None:
    """Whatever-the-length input list, frame_count reflects it exactly."""
    for n in (2, 5, 10, 100):
        scores = [float(i) for i in range(n)]
        assert summarize_vmaf(scores).frame_count == n


# ---------------------------------------------------------------------------
# measure_per_frame_vmaf_neg — wiring around the mocked library
# ---------------------------------------------------------------------------


def _make_fake_ffqm(per_frame_payload: list[dict]) -> MagicMock:
    """Build a MagicMock that mimics FfmpegQualityMetrics(...).calculate(...).

    Returns the per-frame payload caller specifies under the "vmaf" key,
    matching the real library's shape: ``{"vmaf": [{"vmaf": 90.1, ...}, ...]}``.
    """
    instance = MagicMock()
    instance.calculate.return_value = {"vmaf": per_frame_payload}
    return instance


def test_measure_per_frame_passes_ffmpeg_path_and_inputs_to_library() -> None:
    """Constructor receives our ffmpeg_path, ref/dist as strings, threads."""
    fake_instance = _make_fake_ffqm([{"vmaf": 92.0}])
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ) as ffqm_cls:
        measure_per_frame_vmaf_neg(
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


def test_measure_per_frame_requests_vmaf_metric_with_neg_model() -> None:
    """calculate() is invoked with metrics=["vmaf"] and the NEG model path.

    Guards against accidentally swapping to the default vmaf_v0.6.1 (non-NEG)
    model — the NEG variant is what our calibration / shipping decisions
    are tuned against.
    """
    fake_instance = _make_fake_ffqm([{"vmaf": 92.0}])
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ):
        measure_per_frame_vmaf_neg(
            ffmpeg_path="ffmpeg",
            reference_path=Path("ref.mp4"),
            encoded_path=Path("enc.mp4"),
        )
    fake_instance.calculate.assert_called_once()
    call_kwargs = fake_instance.calculate.call_args.kwargs
    assert call_kwargs["metrics"] == ["vmaf"]
    assert call_kwargs["vmaf_options"]["model_path"] == VMAF_NEG_MODEL_FILENAME


def test_measure_per_frame_returns_list_of_floats_in_frame_order() -> None:
    """Per-frame scores extracted in order from the library's payload."""
    fake_instance = _make_fake_ffqm([
        {"n": 1, "vmaf": 95.5},
        {"n": 2, "vmaf": 88.2},
        {"n": 3, "vmaf": 91.0},
    ])
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ):
        result = measure_per_frame_vmaf_neg(
            ffmpeg_path="ffmpeg",
            reference_path=Path("ref.mp4"),
            encoded_path=Path("enc.mp4"),
        )
    assert result == [95.5, 88.2, 91.0]


def test_measure_per_frame_coerces_int_scores_to_float() -> None:
    """Some libvmaf payloads emit integer-valued scores. We guarantee floats
    so downstream ``statistics.quantiles`` doesn't get bit by mixed types.
    """
    fake_instance = _make_fake_ffqm([{"vmaf": 100}])
    with patch(
        "clipper.quality.vmaf.FfmpegQualityMetrics",
        return_value=fake_instance,
    ):
        result = measure_per_frame_vmaf_neg(
            ffmpeg_path="ffmpeg",
            reference_path=Path("ref.mp4"),
            encoded_path=Path("enc.mp4"),
        )
    assert result == [100.0]
    assert isinstance(result[0], float)


# ---------------------------------------------------------------------------
# measure_vmaf_neg — composition end-to-end
# ---------------------------------------------------------------------------


def test_measure_vmaf_neg_threads_through_to_summary() -> None:
    """Convenience wrapper composes measure_per_frame + summarize_vmaf.

    The returned summary's mean/p1/frame_count come from the same per-frame
    payload that the underlying library mock emits.
    """
    fake_instance = _make_fake_ffqm([
        {"vmaf": 80.0}, {"vmaf": 85.0}, {"vmaf": 90.0}, {"vmaf": 95.0},
    ])
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
