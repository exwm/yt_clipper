"""The clipper's frame decisions, behind one interface: which frames a clip takes, where its speed and
crop maps start, and where crop points take effect. The build-time switch `frame_grid.LEGACY_FRAME_TIMING`
picks 5.48.0's decisions (frame_timing_548.py, v5.48.0's own code) or 5.49's (frame_timing_549.py).
The twin of the markup's `FrameTiming` (src/markup/util/frame-timing.ts).
"""

from collections.abc import Callable
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Optional, Union

from clipper import frame_grid

DictStrAny = dict[str, Any]


@dataclass(frozen=True)
class ClipSpan:
    """A marker pair's clip, with times on the video part's timeline unless noted."""

    # The clip's time 0 and its end.
    start: float
    end: float
    # Where the video input seeks and where its trim ends, from `start` (5.49 only).
    seekTo: Optional[float] = None
    trimEnd: Optional[float] = None
    # The speed and crop maps' first and last point times on the video's timeline, or None to keep the
    # saved points.
    speedMapEnds: Optional[tuple[float, float]] = None
    cropMapEnds: Optional[tuple[float, float]] = None
    # A sample-guided window of the pair on the video's timeline, which takes its own part of the
    # pair's speed map, or None.
    speedMapWindow: Optional[tuple[float, float]] = None
    # How far into the pair's crop map the clip starts.
    cropMapTimeOffset: float = 0.0
    # Where crop points count their frames from, on the video's timeline.
    cropFrameOrigin: float = 0.0


@dataclass(frozen=True)
class VideoInput:
    """The video input's ffmpeg arguments and the trim that starts the video filter."""

    inputs: str
    trim: str


# (easeType, leftX, rightX, firstTime, videoPartStart, fps) -> the span a crop section eases over, or
# None for a section with no frames. Times are on the video's timeline; firstTime is the crop map's
# first point.
SectionEaseDuration = Callable[[str, float, float, float, float, float], Optional[float]]
# (cutX, previousX, fps, firstTime, videoPartStart) -> when a Cinematic cut at cutX takes effect.
CutTime = Callable[[float, float, Optional[float], float, float], float]
SpeedFilter = Callable[
    [list[DictStrAny], DictStrAny, Union[float, Fraction]], tuple[str, Any, list[Any]]
]


@dataclass(frozen=True)
class FrameTiming:
    name: str
    # The clip's frames and its maps' ends: (mp, mps, videoPartDelay) -> ClipSpan.
    clipSpan: Callable[[DictStrAny, DictStrAny, float], ClipSpan]
    # The video input and trim: (mp, mps, settings) -> VideoInput, or None for a pair spanning video parts.
    videoInput: Callable[[DictStrAny, DictStrAny, DictStrAny], Optional[VideoInput]]
    # The fast trim's video input: (mp, mps) -> its arguments, or None for a pair spanning video parts.
    fastTrimInput: Callable[[DictStrAny, DictStrAny], Optional[str]]
    # The audio filter's trim and tempo when encoding: (mp, mps, aDuration) -> filter.
    audioFilter: Callable[[DictStrAny, DictStrAny, float], str]
    # The speed filter, the output duration and each speed section's output end.
    speedFilter: SpeedFilter
    sectionEaseDuration: SectionEaseDuration
    cutTime: CutTime


def current() -> FrameTiming:
    """The frame timing the build uses. Read at each clip, so the tests can set the switch."""
    from clipper import frame_timing_548, frame_timing_549

    return (
        frame_timing_548.FRAME_TIMING
        if frame_grid.LEGACY_FRAME_TIMING
        else frame_timing_549.FRAME_TIMING
    )


def byName(name: str) -> FrameTiming:
    from clipper import frame_timing_548, frame_timing_549

    return {
        timing.name: timing
        for timing in (frame_timing_548.FRAME_TIMING, frame_timing_549.FRAME_TIMING)
    }[name]
