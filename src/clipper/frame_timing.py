"""The clipper's frame decisions, behind one interface: which frames a clip takes, where its speed and
crop maps start, and where crop points take effect. Build-time switches (`SWITCHES`), one per group of
decisions, pick each group's 5.48.0 implementation (frame_timing_548.py, v5.48.0's own code) or its 5.49
one (frame_timing_549.py). The twin of the markup's `FrameTiming` (src/markup/util/frame-timing.ts).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, fields, replace
from fractions import Fraction
from typing import Any, Literal

DictStrAny = dict[str, Any]
Release = Literal["5.48", "5.49"]


@dataclass(frozen=True)
class ClipSpan:
    """A marker pair's clip, with times on the video part's timeline unless noted."""

    # The clip's time 0 and its end.
    start: float
    end: float
    # Where the video input seeks and where its trim ends, from `start` (5.49 only).
    seekTo: float | None = None
    trimEnd: float | None = None
    # The speed and crop maps' first and last point times on the video's timeline, or None to keep the
    # saved points.
    speedMapEnds: tuple[float, float] | None = None
    cropMapEnds: tuple[float, float] | None = None
    # A sample-guided window of the pair on the video's timeline, which takes its own part of the
    # pair's speed map, or None.
    speedMapWindow: tuple[float, float] | None = None
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
SectionEaseDuration = Callable[[str, float, float, float, float, float], float | None]
# (cutX, previousX, fps, firstTime, videoPartStart) -> when a Cinematic cut at cutX takes effect.
CutTime = Callable[[float, float, float | None, float, float], float]
SpeedFilter = Callable[[list[DictStrAny], DictStrAny, float | Fraction], tuple[str, Any, list[Any]]]


@dataclass(frozen=True)
class FrameTiming:
    name: str
    # The clip's frames and its maps' ends: (mp, mps, videoPartDelay) -> ClipSpan.
    clipSpan: Callable[[DictStrAny, DictStrAny, float], ClipSpan]
    # The video input and trim: (mp, mps, settings) -> VideoInput, or None for a pair spanning video parts.
    videoInput: Callable[[DictStrAny, DictStrAny, DictStrAny], VideoInput | None]
    # The fast trim's video input: (mp, mps) -> its arguments, or None for a pair spanning video parts.
    fastTrimInput: Callable[[DictStrAny, DictStrAny], str | None]
    # The audio filter's trim and tempo when encoding: (mp, mps, aDuration) -> filter.
    audioFilter: Callable[[DictStrAny, DictStrAny, float], str]
    # The speed filter, the output duration and each speed section's output end.
    speedFilter: SpeedFilter
    sectionEaseDuration: SectionEaseDuration
    cutTime: CutTime
    # What a varying frame rate does to clips, for ffprobe's warning: (the clip's rate in fps, or None
    # when unknown) -> its sentences.
    varyingRateNote: Callable[[float | None], list[str]]


@dataclass(frozen=True)
class FrameTimingSwitches:
    """One build-time switch per group of decisions that must change together, so 5.49's fixes can come
    back one at a time. The twin of the markup's per-group flags. No command-line option: the build
    picks them."""

    # The clip's frames on the video's frame grid: clipSpan, videoInput, speedFilter, varyingRateNote.
    # 5.49's videoInput seeks and trims by clipSpan's seekTo and trimEnd, its speedFilter ends the speed
    # map at clipSpan's last frame end, and its note describes that grid.
    clipFrames: Release = "5.48"
    # Crop points counted from the video's first frame: sectionEaseDuration, cutTime.
    cropPoints: Release = "5.48"
    # Audio at normal speed starts with the first frame: audioFilter.
    audioStart: Release = "5.48"
    # A local video seeked by its own timestamps: fastTrimInput. 5.49's clipFrames carries the same rule
    # for encodes.
    localTimestamps: Release = "5.48"


def switchesAt549(groups: Iterable[str]) -> FrameTimingSwitches:
    """These groups at 5.49, the others at 5.48."""
    return replace(FrameTimingSwitches(), **dict.fromkeys(groups, "5.49"))


ALL_549 = switchesAt549(field.name for field in fields(FrameTimingSwitches))

# Groups whose 5.49 implementation needs other groups at 5.49 too.
REQUIRES: dict[str, tuple[str, ...]] = {
    # Without it, a local video's encodes and fast trims would seek by different clocks.
    "clipFrames": ("localTimestamps",),
    # 5.49's audioFilter reads clipSpan's seekTo for a local video.
    "audioStart": ("clipFrames",),
}

# The build: every group as in 5.48.0. Read at each clip, so the tests can set it.
SWITCHES = FrameTimingSwitches()


def compose(switches: FrameTimingSwitches) -> FrameTiming:
    from clipper import frame_timing_548, frame_timing_549

    for group, needed in REQUIRES.items():
        missing = [n for n in needed if getattr(switches, n) != "5.49"]
        if getattr(switches, group) == "5.49" and missing:
            raise ValueError(f"5.49's {group} needs {', '.join(missing)} at 5.49 too")
    release = {"5.48": frame_timing_548.FRAME_TIMING, "5.49": frame_timing_549.FRAME_TIMING}
    clip = release[switches.clipFrames]
    crop = release[switches.cropPoints]
    return FrameTiming(
        name=_name(switches),
        clipSpan=clip.clipSpan,
        videoInput=clip.videoInput,
        fastTrimInput=release[switches.localTimestamps].fastTrimInput,
        audioFilter=release[switches.audioStart].audioFilter,
        speedFilter=clip.speedFilter,
        sectionEaseDuration=crop.sectionEaseDuration,
        cutTime=crop.cutTime,
        varyingRateNote=clip.varyingRateNote,
    )


def _name(switches: FrameTimingSwitches) -> str:
    """The release when every group agrees, else 5.48 and the groups at 5.49 joined by "+", which
    byName reads back."""
    on = [field.name for field in fields(switches) if getattr(switches, field.name) == "5.49"]
    if not on:
        return "5.48"
    if len(on) == len(fields(switches)):
        return "5.49"
    return "+".join(["5.48", *on])


def current() -> FrameTiming:
    """The frame timing the build uses."""
    return compose(SWITCHES)


def byName(name: str) -> FrameTiming:
    if name == "5.49":
        return compose(ALL_549)
    base, *on = name.split("+")
    if base != "5.48":
        raise KeyError(name)
    return compose(switchesAt549(on))
