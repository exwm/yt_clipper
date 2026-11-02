import re
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from clipper import dedupe
from clipper.frame_timing import FrameTimingSwitches
from clipper.tests.test_frame_timing_next import Case, clipOf


def markerPairSettings(**overrides: object) -> dict:
    mps = {
        "noDedupe": False,
        "dedupe": False,
        "minterpFPS": None,
        "r_frame_rate": Fraction(30000, 1001),
    }
    mps.update(overrides)
    return mps


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param({}, False, id="no interpolation"),
        pytest.param({"dedupe": True}, True, id="--remove-duplicate-frames"),
        pytest.param({"minterpFPS": 60}, True, id="interpolating a low fps source"),
        pytest.param(
            {"minterpFPS": 120, "r_frame_rate": Fraction(60)},
            False,
            id="interpolating a 60 fps source",
        ),
        pytest.param(
            {"minterpFPS": 60, "noDedupe": True}, False, id="--no-remove-duplicate-frames"
        ),
        pytest.param({"dedupe": True, "noDedupe": True}, False, id="no wins over remove"),
    ],
)
def test_when_duplicate_frames_are_removed(overrides: dict, expected: bool) -> None:
    assert dedupe.shouldRemoveDuplicateFrames(markerPairSettings(**overrides)) is expected


@pytest.fixture
def detectorOn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dedupe, "FIND_REPEATS_AGAINST_NEARBY_CHANGES", True)


# What v5.49.0's clip_maker.makeClip appended, word for word.
FILTER_549 = "mpdecimate=hi=64*8:lo=64*5:frac=0.1,setpts=N/FR/TB"


@pytest.mark.parametrize("bitDepth", [8, 10])
@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param({}, None, id="no interpolation"),
        pytest.param({"dedupe": True}, FILTER_549, id="--remove-duplicate-frames"),
        pytest.param(
            {"dedupe": True, "r_frame_rate": "60/1"},
            FILTER_549,
            id="--remove-duplicate-frames at 60",
        ),
        pytest.param({"minterpFPS": 60}, FILTER_549, id="interpolating 29.97 fps"),
        pytest.param(
            {"minterpFPS": 60, "r_frame_rate": "4699/100"}, FILTER_549, id="interpolating 46.99 fps"
        ),
        pytest.param({"minterpFPS": 94, "r_frame_rate": "47/1"}, None, id="interpolating 47 fps"),
        pytest.param({"minterpFPS": 120, "r_frame_rate": "60/1"}, None, id="interpolating 60 fps"),
        pytest.param({"minterpFPS": 60, "noDedupe": True}, None, id="--no-remove-duplicate-frames"),
        pytest.param({"dedupe": True, "noDedupe": True}, None, id="no wins over remove"),
    ],
)
def test_duplicate_removal_with_the_detector_off_is_5_49s(
    overrides: dict, expected: str | None, bitDepth: int
) -> None:
    mps = markerPairSettings(**overrides)
    assert dedupe.removeDuplicateFramesFilter(mps, bitDepth) == expected


def keptFrames(graph: str, videoFilter: str) -> int:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg")
    log = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-f",
            "lavfi",
            "-i",
            graph,
            "-vf",
            f"{videoFilter},showinfo",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    return len(re.findall(r"Parsed_showinfo.* n: *\d+ ", log))


@pytest.mark.parametrize(("pixelFormat", "bitDepth"), [("yuv420p", 8), ("yuv444p10le", 10)])
@pytest.mark.parametrize(
    ("source", "kept"),
    [
        # 24 drawings at 12 fps stored as 60 frames at 30 fps: only the drawings are kept
        pytest.param("testsrc2=size=320x180:rate=12:duration=2,fps=30", 24, id="12 fps in 30"),
        pytest.param("testsrc2=size=320x180:rate=30:duration=2", 60, id="no repeats"),
    ],
)
@pytest.mark.usefixtures("detectorOn")
def test_detector_keeps_one_frame_per_picture(
    source: str, kept: int, pixelFormat: str, bitDepth: int
) -> None:
    graph = f"{source},format={pixelFormat}"
    videoFilter = dedupe.removeDuplicateFramesFilter(markerPairSettings(dedupe=True), bitDepth)
    assert videoFilter is not None
    assert keptFrames(graph, videoFilter) == kept


@pytest.mark.parametrize(
    ("detector", "removal"),
    [
        pytest.param(False, f",{FILTER_549},", id="detector off: 5.49's mpdecimate"),
        pytest.param(True, ",siti,scdet=threshold=100,", id="detector on"),
    ],
)
@pytest.mark.parametrize(
    "settings",
    [
        pytest.param({"dedupe": True}, id="--remove-duplicate-frames"),
        pytest.param(
            {"minterpFPS": 60, "minterpTool": "ffmpeg", "minterpMode": "Numeric"},
            id="interpolating",
        ),
    ],
)
def test_a_clip_removing_duplicate_frames_runs_the_build_s_filter(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    settings: dict,
    detector: bool,
    removal: str,
) -> None:
    monkeypatch.setattr(dedupe, "FIND_REPEATS_AGAINST_NEARBY_CHANGES", detector)
    case = Case("url", False, 0.0, False, 1)
    commands = str(
        clipOf(tmp_path, monkeypatch, FrameTimingSwitches(), case, **settings)["commands"]
    )
    assert removal in commands
    assert ("mpdecimate" in commands) is not detector
    assert ("siti" in commands) is detector
