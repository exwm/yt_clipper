"""The output duration table that the markup's getOutputDuration is checked against holds what the
clipper renders. Regenerate it with `uv run python tools/test/write_output_duration_cases.py`."""

import json
from fractions import Fraction
from pathlib import Path

from clipper.ffmpeg_filter import getSpeedFilterAndDuration
from clipper.frame_grid import FrameGrid, frameSpan

TABLE = Path(__file__).parent / "fixtures" / "output_duration_cases.json"


def clipperOutputDuration(speedMap: list[dict], rate: str) -> float:
    """The output duration clip_maker gives a marker pair with this speed map, on a grid from 0."""
    span = frameSpan(FrameGrid(origin=0, rate=Fraction(rate)), speedMap[0]["x"], speedMap[-1]["x"])
    points = [dict(point) for point in speedMap]
    points[0]["x"], points[-1]["x"] = span.start, span.end
    mp = {
        "isVariableSpeed": any(a["y"] != b["y"] for a, b in zip(points, points[1:])),
        "duration": span.end - span.start,
        "speed": points[0]["y"],
    }
    return float(getSpeedFilterAndDuration(points, mp, Fraction(rate))[1])


def test_the_output_duration_table_holds_what_the_clipper_renders() -> None:
    wrong = [
        {**case, "clipper": got}
        for case in json.loads(TABLE.read_text(encoding="utf-8"))
        if (got := clipperOutputDuration(case["speedMap"], case["rate"])) != case["outputDuration"]
    ]
    assert wrong == []
