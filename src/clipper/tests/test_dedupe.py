import re
import shutil
import subprocess
from fractions import Fraction

import pytest

from clipper import dedupe


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
def test_filter_keeps_one_frame_per_picture(
    source: str, kept: int, pixelFormat: str, bitDepth: int
) -> None:
    graph = f"{source},format={pixelFormat}"
    assert keptFrames(graph, dedupe.getRemoveDuplicateFramesFilter(bitDepth)) == kept
