import json
from fractions import Fraction
from pathlib import Path

import pytest

from clipper.frame_grid import FrameGrid, frameAt, frameMiddle, frameSpan, frameStart, snapToFrame

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "frame_grid_cases.json").read_text(encoding="utf-8")
)


def grid(case: dict) -> FrameGrid:
    return FrameGrid(origin=case["origin"], rate=Fraction(case["rate"]))


def test_a_time_maps_to_the_frame_shown_there() -> None:
    wrong = [
        {**case, "got": got}
        for case in CASES["timeToFrame"]
        if (got := frameAt(grid(case), case["time"])) != case["frame"]
    ]
    assert wrong == []


def test_a_frame_starts_where_its_times_map_to_it() -> None:
    for case in CASES["frameStart"]:
        g = grid(case)
        assert frameStart(g, case["frame"]) == pytest.approx(case["start"], abs=1e-9)
        assert snapToFrame(g, case["start"]) == pytest.approx(case["start"], abs=1e-9)
        assert frameAt(g, frameMiddle(g, case["frame"])) == case["frame"]


@pytest.mark.parametrize("case", CASES["frameSpan"], ids=lambda case: case["kind"])
def test_a_span_runs_from_the_frame_at_the_start_marker_through_the_one_at_the_end_marker(case: dict) -> None:
    g = grid(case)
    span = frameSpan(g, case["startMarker"], case["endMarker"])
    first, last = case["firstFrame"], case["lastFrame"]
    assert (span.firstFrame, span.lastFrame) == (first, last)
    assert span.start == pytest.approx(frameStart(g, first))
    assert span.end == pytest.approx(frameStart(g, last + 1))
    # The seek and the trim end sit half a frame from every frame edge.
    assert span.seekTo == pytest.approx(frameStart(g, first) - 0.5 / 30)
    assert span.trimEnd == pytest.approx(frameStart(g, last) + 0.5 / 30 - span.start)
