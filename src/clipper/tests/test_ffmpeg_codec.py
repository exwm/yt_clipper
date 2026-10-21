import shutil
from fractions import Fraction

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


# Scenarios chosen to exercise each rate-control branch plus the HDR axis.
# Snapshots capture the full codec/input/output arg triple so any drift in
# the encoder flags shows up in review.
AV1_SCENARIOS: dict[str, tuple[dict[str, object], int | None]] = {
    "crf_sdr_default": ({}, None),
    "crf_hdr": ({"enableHDR": True}, None),
    "crf_with_mbr_cap": ({"targetMaxBitrate": 2000}, None),
    "target_size_vbr": ({}, 12),  # cbr set -> VBR rc=1 with -b:v in MB
    "two_pass_vbr": ({"twoPass": True}, None),
}


@pytest.mark.parametrize(
    ("mps_overrides", "cbr"),
    AV1_SCENARIOS.values(),
    ids=AV1_SCENARIOS.keys(),
)
def test_av1_codec_args_snapshot(
    mps_overrides: dict[str, object],
    cbr: int | None,
    snapshot: str,
) -> None:
    mp, mps = _make_mp_mps(**mps_overrides)
    result = ffmpeg_codec.getFfmpegVideoCodecArgs(
        videoCodec="av1",
        cbr=cbr,
        mp=mp,
        mps=mps,
    )
    assert result == snapshot


def test_av1_preset_hardcoded_ignores_encode_speed() -> None:
    """Preset is fixed at 6; --encode-speed (libvpx 0-5 scale) is not mapped
    onto SVT-AV1's 0-13 preset, so changing it must not change the command."""
    mp_slow, mps_slow = _make_mp_mps(encodeSpeed=0)
    mp_fast, mps_fast = _make_mp_mps(encodeSpeed=5)
    slow, _, _ = ffmpeg_codec.getFfmpegVideoCodecArgs(
        videoCodec="av1",
        cbr=None,
        mp=mp_slow,
        mps=mps_slow,
    )
    fast, _, _ = ffmpeg_codec.getFfmpegVideoCodecArgs(
        videoCodec="av1",
        cbr=None,
        mp=mp_fast,
        mps=mps_fast,
    )
    assert "-preset 6" in slow
    assert slow == fast


FPS_ARG_CASES = {
    "constant speed": ({"speed": 0.5}, {}, "-r (30*0.5)"),
    "variable speed": ({"isVariableSpeed": True}, {}, "-fps_mode vfr"),
    "ffmpeg interpolation": ({}, {"minterpFPS": 60}, "-r 60"),
    "ffmpeg interpolation, variable speed": (
        {"isVariableSpeed": True},
        {"minterpFPS": 60},
        "-r 60",
    ),
}


@pytest.mark.parametrize(
    ("mp_overrides", "mps_overrides", "expected"),
    FPS_ARG_CASES.values(),
    ids=FPS_ARG_CASES.keys(),
)
def test_fps_arg(mp_overrides: dict, mps_overrides: dict, expected: str) -> None:
    mp, mps = _make_mp_mps(**mps_overrides)
    mp.update(mp_overrides)
    assert ffmpeg_codec.getFpsArg(mp, mps) == expected


def test_av1_container_and_hwaccel() -> None:
    assert ffmpeg_codec.getContainerForCodec("av1") == "mp4"
    assert ffmpeg_codec.isHardwareAcceleratedVideoCodec("av1") is False


@pytest.mark.parametrize(
    ("ffmpeg", "encoder", "missing"),
    [
        ("ffmpeg", "libvpx-vp9", None),
        ("ffmpeg", "libnotreal", "libnotreal"),
        # An ffmpeg that cannot list its encoders leaves the error to the encode
        ("no-such-ffmpeg", "libnotreal", None),
    ],
    ids=["has it", "lacks it", "no listing"],
)
def test_a_codec_whose_encoder_ffmpeg_lacks_is_reported(
    monkeypatch: pytest.MonkeyPatch,
    ffmpeg: str,
    encoder: str,
    missing: str | None,
) -> None:
    if ffmpeg == "ffmpeg" and shutil.which("ffmpeg") is None:
        pytest.skip("needs ffmpeg")
    monkeypatch.setitem(ffmpeg_codec.VIDEO_ENCODERS, "vp9", encoder)
    assert ffmpeg_codec.missingVideoEncoder(ffmpeg, "vp9") == missing
