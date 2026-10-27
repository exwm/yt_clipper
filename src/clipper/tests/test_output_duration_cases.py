"""The output duration table that the markup's getOutputDuration is checked against holds what the
clipper renders. Regenerate it with `uv run python tools/test/write_output_duration_cases.py`."""

import json
from fractions import Fraction
from pathlib import Path

from clipper.clip_maker import pairSpeedMap
from clipper.ffmpeg_filter import getSpeedFilterAndDuration
from clipper.frame_grid import FrameGrid, frameSpan

TABLE = Path(__file__).parent / "fixtures" / "output_duration_cases.json"


def clipperOutputDuration(speedMap: list[dict], rate: str, origin: float = 0, partStart: float = 0) -> float:
    """The output duration clip_maker gives a marker pair with this speed map: its frames on a grid
    from `origin` (a local video's start time) in a video part starting at `partStart`."""
    span = frameSpan(
        FrameGrid(origin=origin, rate=Fraction(rate)),
        speedMap[0]["x"] - partStart,
        speedMap[-1]["x"] - partStart,
    )
    points, isVariableSpeed = pairSpeedMap(speedMap, span.start + partStart, span.end + partStart)
    mp = {"isVariableSpeed": isVariableSpeed, "duration": span.end - span.start, "speed": points[0]["y"]}
    return float(getSpeedFilterAndDuration(points, mp, Fraction(rate))[1])


def test_the_output_duration_table_holds_what_the_clipper_renders() -> None:
    wrong = [
        {**case, "clipper": got}
        for case in json.loads(TABLE.read_text(encoding="utf-8"))
        if (got := clipperOutputDuration(case["speedMap"], case["rate"], case["origin"], case["partStart"]))
        != case["outputDuration"]
    ]
    assert wrong == []


def test_a_pair_lasts_as_long_wherever_the_videos_frames_start() -> None:
    # The same pair, on a grid from 0, from a start offset, and in a part that starts off the grid.
    ramp = [{"x": 1.0, "y": 1}, {"x": 2.0, "y": 0.25}]
    shifted = [{"x": point["x"] + 100.01, "y": point["y"]} for point in ramp]
    plain = clipperOutputDuration(ramp, "30")
    assert clipperOutputDuration([{**p, "x": p["x"] + 0.021} for p in ramp], "30", origin=0.021) == plain
    assert clipperOutputDuration(shifted, "30", partStart=100.01) == plain
