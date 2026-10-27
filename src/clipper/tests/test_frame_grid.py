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


@pytest.mark.parametrize(
    ("startMarker", "endMarker", "frames"),
    [
        pytest.param(30 / 30, 50 / 30, (30, 50), id="on frame starts"),
        pytest.param(30.5 / 30, 50.5 / 30, (30, 50), id="mid-frame"),
        pytest.param(round(31 / 30, 6), round(52 / 30, 6), (31, 52), id="saved to 6 decimals"),
        pytest.param(30.5 / 30, 30.6 / 30, (30, 30), id="both in one frame"),
    ],
)
def test_a_span_runs_from_the_frame_at_the_start_marker_through_the_one_at_the_end_marker(
    startMarker: float, endMarker: float, frames: tuple[int, int]
) -> None:
    g = FrameGrid(origin=0, rate=Fraction(30))
    span = frameSpan(g, startMarker, endMarker)
    first, last = frames
    assert (span.firstFrame, span.lastFrame) == frames
    assert span.start == pytest.approx(first / 30)
    assert span.end == pytest.approx((last + 1) / 30)
    # The seek and the trim end sit half a frame from every frame edge.
    assert span.seekTo == pytest.approx((first - 0.5) / 30)
    assert span.trimEnd == pytest.approx((last + 0.5) / 30 - first / 30)


def test_a_float_rate_works_like_its_fraction() -> None:
    assert frameAt(FrameGrid(origin=0, rate=30000 / 1001), 91 * 1001 / 30000) == 91
