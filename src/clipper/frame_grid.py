"""Which frame a time on the video timeline means.

A user places a time (a marker, a crop or speed point) while a frame is shown, and means that frame:
the one whose display interval covers the time. `frameAt` maps a time to that frame on the source's
frame grid; everything that turns a placed time into frames goes through it, so the markup preview and
the render agree on every boundary. Mirrors src/markup/util/frame-grid.ts; both are checked against
tests/fixtures/frame_grid_cases.json.
"""

import math
from dataclasses import dataclass
from fractions import Fraction
from typing import Union

# A time up to this much before a frame's start still means that frame. Times reach the core rounded:
# saved to 6 decimals, or YouTube's frame times rounded to the millisecond, so a frame's start time can
# come back just below it. 1 ms is under half a frame at up to 500 fps.
PLACEMENT_TOLERANCE = 0.001


@dataclass(frozen=True)
class FrameGrid:
    """Frame n of a constant frame rate source starts at origin + n / rate."""

    origin: float
    rate: Union[Fraction, float]


def frameAt(grid: FrameGrid, time: float) -> int:
    """The frame shown at `time`."""
    return math.floor((time - grid.origin + PLACEMENT_TOLERANCE) * float(grid.rate))


def frameStart(grid: FrameGrid, frame: int) -> float:
    return grid.origin + float(frame / Fraction(grid.rate))


def frameMiddle(grid: FrameGrid, frame: int) -> float:
    """Half a frame from both edges, where a seek or a comparison can't land on a neighbor."""
    return grid.origin + float((frame + Fraction(1, 2)) / Fraction(grid.rate))


def snapToFrame(grid: FrameGrid, time: float) -> float:
    """The start of the frame shown at `time`."""
    return frameStart(grid, frameAt(grid, time))


@dataclass(frozen=True)
class FrameSpan:
    """A clip's frames: from the frame shown at its start marker through the one at its end marker."""

    firstFrame: int
    lastFrame: int
    # The first frame's start, the clip's time 0.
    start: float
    # The last frame's end.
    end: float
    # Half a frame before `start`: an accurate seek there keeps the first frame and drops the one before,
    # whatever the rounding of either.
    seekTo: float
    # The middle of the last frame, past the clip's start: a trim ending there keeps the last frame and
    # drops the next.
    trimEnd: float


def frameSpan(grid: FrameGrid, startMarker: float, endMarker: float) -> FrameSpan:
    firstFrame = frameAt(grid, startMarker)
    lastFrame = max(firstFrame, frameAt(grid, endMarker))
    start = frameStart(grid, firstFrame)
    return FrameSpan(
        firstFrame=firstFrame,
        lastFrame=lastFrame,
        start=start,
        end=frameStart(grid, lastFrame + 1),
        seekTo=frameMiddle(grid, firstFrame - 1),
        trimEnd=frameMiddle(grid, lastFrame) - start,
    )
