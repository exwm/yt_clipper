from fractions import Fraction

import pytest

from clipper import ffmpeg_codec, video2x

SPEED_CASES = {
    "constant speed": (1, False),
    "constant slowdown": (0.5, False),
    "variable speed": (1, True),
}


def video2xInput(speed: float, isVariableSpeed: bool) -> tuple[dict, dict]:
    """A marker pair whose clip is made by ffmpeg, then interpolated to 2x the source fps by video2x."""
    mp = {"speed": speed, "isVariableSpeed": isVariableSpeed, "isVideo2xInput": True}
    mps = {
        "minterpFPS": None,
        "minterpTool": "video2x",
        "minterpFpsMultiplier": 2,
        "r_frame_rate": Fraction(30),
        "videoCodec": "vp9",
    }
    return mp, mps


@pytest.mark.parametrize(("speed", "isVariableSpeed"), SPEED_CASES.values(), ids=SPEED_CASES.keys())
def test_video2x_input_keeps_the_frame_timing(speed: float, isVariableSpeed: bool) -> None:
    # Removed duplicate frames and VFR sources leave gaps. A constant frame rate would fill them
    # with copies, and interpolating between copies stutters.
    mp, mps = video2xInput(speed, isVariableSpeed)
    assert ffmpeg_codec.getFpsArg(mp, mps) == "-fps_mode vfr"


@pytest.mark.parametrize(("speed", "isVariableSpeed"), SPEED_CASES.values(), ids=SPEED_CASES.keys())
def test_video2x_fills_every_gap_up_to_the_target_fps(speed: float, isVariableSpeed: bool) -> None:
    mp, mps = video2xInput(speed, isVariableSpeed)
    args = video2x.buildVideo2xArgs("in.webm", "out.webm", mp, mps, "-c:v libvpx-vp9 -crf 30")
    assert "--vfr-min-fps 60.0" in args
    assert "--frame-rate-mul" not in args
