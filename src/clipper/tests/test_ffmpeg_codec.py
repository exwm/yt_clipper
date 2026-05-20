from fractions import Fraction
from typing import Optional

import pytest

from clipper import ffmpeg_codec


def _make_mp_mps(**mps_overrides: object) -> tuple[dict, dict]:
    mp = {
        "speed": 1,
        "averageSpeed": Fraction(1),
        "isVariableSpeed": False,
    }
    mps = {
        "crf": 23,
        "encodeSpeed": 4,
        "enableHDR": False,
        "targetSize": 0,
        "targetMaxBitrate": 4000,
        "twoPass": False,
        "minterpFPS": None,
        "minterpTool": "ffmpeg",
        "r_frame_rate": Fraction(30),
        "width": 1920,
        "height": 1080,
        "h264DisableReduceStutter": False,
    }
    mps.update(mps_overrides)
    return mp, mps


# Scenarios chosen to exercise each rate-control branch and a couple of
# orthogonal axes (HDR, preset extremes). Snapshots capture the full
# codec/input/output arg triple so any drift surfaces in review.
AV1_SCENARIOS: dict[str, tuple[dict[str, object], Optional[int]]] = {
    "crf_sdr_default": ({}, None),
    "crf_hdr": ({"enableHDR": True}, None),
    "crf_with_mbr_cap": ({"targetMaxBitrate": 2000}, None),
    "target_size_vbr": ({}, 12),  # cbr set -> VBR rc=1 with -b:v in MB
    "two_pass_vbr": ({"twoPass": True}, None),
    "preset_slow": ({"encodeSpeed": 0}, None),
    "preset_fast": ({"encodeSpeed": 5}, None),
}


@pytest.mark.parametrize(
    ("mps_overrides", "cbr"),
    AV1_SCENARIOS.values(),
    ids=AV1_SCENARIOS.keys(),
)
def test_av1_codec_args_snapshot(
    mps_overrides: dict[str, object],
    cbr: Optional[int],
    snapshot: str,
) -> None:
    mp, mps = _make_mp_mps(**mps_overrides)
    result = ffmpeg_codec.getFfmpegVideoCodecArgs(
        videoCodec="av1", cbr=cbr, mp=mp, mps=mps,
    )
    assert result == snapshot


def test_av1_container_and_hwaccel() -> None:
    assert ffmpeg_codec.getContainerForCodec("av1") == "mp4"
    assert ffmpeg_codec.isHardwareAcceleratedVideoCodec("av1") is False
