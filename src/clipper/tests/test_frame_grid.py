import json
from fractions import Fraction
from pathlib import Path

import pytest

from clipper.frame_grid import (
    FrameGrid,
    frameAt,
    frameMiddle,
    frameSpan,
    frameStart,
    legacyFrameSpan,
    snapToFrame,
)

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


# 5.48's clips at 30 fps, which the markup's frame grid has no twin of: (origin, markers, frames).
LEGACY_SPANS = [
    pytest.param(0, (30 / 30, 50 / 30), (30, 49), id="on frame starts: the end marker's frame left out"),
    pytest.param(0, (30.5 / 30, 50.5 / 30), (31, 50), id="mid-frame: the start marker's frame dropped"),
    pytest.param(0, (round(31 / 30, 6), round(52 / 30, 6)), (31, 51), id="saved to 6 decimals, below the frame starts"),
    pytest.param(0, (31 / 30 + 1e-12, 52 / 30 + 1e-12), (31, 51), id="float noise above the frame starts"),
    pytest.param(0, (30.5 / 30, 30.6 / 30), (31, 31), id="both in one frame: still one frame"),
    pytest.param(2 / 30, (0, 1), (0, 27), id="a start marker before the video's first frame"),
    pytest.param(0.021, (0.021 + 30.5 / 30, 0.021 + 50 / 30), (31, 49), id="a video starting 21 ms in"),
]  # fmt: skip


@pytest.mark.parametrize(("origin", "markers", "frames"), LEGACY_SPANS)
def test_a_legacy_span_takes_the_frames_starting_from_the_start_marker_to_before_the_end_marker(
    origin: float, markers: tuple[float, float], frames: tuple[int, int]
) -> None:
    g = FrameGrid(origin=origin, rate=Fraction(30))
    span = legacyFrameSpan(g, *markers)
    first, last = frames
    assert (span.firstFrame, span.lastFrame) == frames
    assert span.start == pytest.approx(frameStart(g, first))
    assert span.end == pytest.approx(frameStart(g, last + 1))
    assert span.seekTo == pytest.approx(frameStart(g, first) - 0.5 / 30)
    assert span.trimEnd == pytest.approx(frameStart(g, last) + 0.5 / 30 - span.start)
