import subprocess
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

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
    args = video2x.buildVideo2xArgs(
        "in.webm", "out.webm", mp, mps, "-c:v libvpx-vp9 -crf 30", tta=False
    )
    assert "--vfr-min-fps 60.0" in args
    assert "--frame-rate-mul" not in args


@pytest.mark.parametrize("tta", [True, False])
def test_video2x_gets_temporal_tta_only_when_on(tta: bool) -> None:
    mp, mps = video2xInput(0.5, False)
    args = video2x.buildVideo2xArgs(
        "in.webm", "out.webm", mp, mps, "-c:v libvpx-vp9 -crf 30", tta=tta
    )
    assert ("--rife-tta-temporal" in args.split()) is tta


VERSION_CASES = {
    "first build with tta": ("Video2X version 6.7.0-exwm\n", True),
    "later build": ("Video2X version 7.0.1-exwm\n", True),
    "older build": ("Video2X version 6.6.1-exwm\n", False),
    "upstream": ("Video2X version 6.7.0\n", False),
    "no output": ("", False),
}


@pytest.mark.parametrize(("output", "supported"), VERSION_CASES.values(), ids=VERSION_CASES.keys())
def test_temporal_tta_needs_the_yt_clipper_build_6_7_0_or_later(
    output: str, supported: bool
) -> None:
    assert video2x.supportsTta(output) is supported


def runWithFakeVideo2x(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, minterpTta: bool, version: str | Exception
) -> tuple[list[str], list[str]]:
    """Runs runVideo2xCommand against a video2x whose `--version` prints `version` (or raises it).
    Returns the interpolation command and the notices logged."""
    video2x.video2xSupportsTta.cache_clear()
    commands: list[list[str]] = []
    notices: list[str] = []

    def fakeRun(args: list[str], **_kwargs: object) -> subprocess.CompletedProcess:
        commands.append(list(args))
        if "--version" in args and isinstance(version, Exception):
            raise version
        stdout = version if "--version" in args else ""
        return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(video2x.subprocess, "run", fakeRun)
    monkeypatch.setattr(video2x.logger, "notice", notices.append)
    mp, mps = video2xInput(0.5, False)
    mp |= {
        "filePath": str(tmp_path / "in.webm"),
        "v2xFinalFilePath": str(tmp_path / "out.webm"),
        "fileName": "out.webm",
    }
    # A stand-in ClipperState: runVideo2xCommand reads only the video2x path from it.
    cs = SimpleNamespace(clipper_paths=SimpleNamespace(video2xPath="video2x"))
    video2x.runVideo2xCommand(cs, mp, {**mps, "minterpTta": minterpTta}, "-c:v libvpx-vp9 -crf 30")  # type: ignore[arg-type]
    video2x.video2xSupportsTta.cache_clear()
    return commands[-1], notices


RUN_CASES = {
    "on by default with 6.7.0": (True, "Video2X version 6.7.0-exwm\n", True, 0),
    "off with --no-minterp-tta": (False, "Video2X version 6.7.0-exwm\n", False, 0),
    "an older yt_clipper build": (True, "Video2X version 6.6.0-exwm\n", False, 1),
    "upstream video2x": (True, "Video2X version 6.7.0\n", False, 0),
    "video2x missing": (True, FileNotFoundError("video2x"), False, 0),
    "video2x hangs": (True, subprocess.TimeoutExpired("video2x", 30), False, 0),
}


@pytest.mark.parametrize(
    ("minterpTta", "version", "tta", "notices"), RUN_CASES.values(), ids=RUN_CASES.keys()
)
def test_the_interpolation_command_gets_temporal_tta_when_on_and_supported(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    minterpTta: bool,
    version: str | Exception,
    tta: bool,
    notices: int,
) -> None:
    command, logged = runWithFakeVideo2x(monkeypatch, tmp_path, minterpTta, version)
    assert ("--rife-tta-temporal" in command) is tta
    # Only an older yt_clipper build gets the notice: upstream or missing video2x fails on its own.
    assert len(logged) == notices
