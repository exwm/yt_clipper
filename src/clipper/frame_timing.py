"""The clipper's frame decisions, behind one interface: which frames a clip takes, where its speed and
crop maps start, and where crop points take effect. Build-time switches (`SWITCHES`), one per group of
decisions, pick each group's implementation: the next release's (frame_timing_next.py, where fixes land)
or the frozen 5.48.0 one (frame_timing_548.py, v5.48.0's own code). The frozen 5.49 (frame_timing_549.py)
is only a whole build (`WHOLE_549`). The twin of the markup's `FrameTiming` (src/markup/util/frame-timing.ts).
"""

from collections.abc import Callable
from dataclasses import dataclass, fields, replace
from fractions import Fraction
from typing import Any, Literal

DictStrAny = dict[str, Any]
Release = Literal["5.48", "next"]


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
# (span, mps) -> where crop points count their frames from, on the video's timeline: the videoPartStart
# given to SectionEaseDuration and CutTime.
CropPointOrigin = Callable[[ClipSpan, DictStrAny], float]


def cropOriginFromClipSpan(span: ClipSpan, mps: DictStrAny) -> float:
    """5.49's: its clip span's, the video part's first frame."""
    return span.cropFrameOrigin


def cropOriginOnMarkersTimeline(span: ClipSpan, mps: DictStrAny) -> float:
    """Time 0 on the markers' timeline, where the 5.48 preview counts crop point frames from. Crop point
    times are the markers' plus the delay, so that is the delay. Read from mps alone, so crop points
    decide the same whatever clipFrames picks. 5.48's crop functions time from the start marker and
    don't read it."""
    return mps["delay"]


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
    # 5.49's by default, so the frozen timings keep their constructors. The 5.48 group and next use
    # cropOriginOnMarkersTimeline (compose).
    cropPointOrigin: CropPointOrigin = cropOriginFromClipSpan

    def sameDecisions(self, other: "FrameTiming") -> bool:
        """Whether both make every decision with the same functions, whatever their names."""
        return replace(self, name="") == replace(other, name="")


@dataclass(frozen=True)
class FrameTimingSwitches:
    """One build-time switch per group of decisions that must change together, each picking 5.48.0's
    implementation or next's, so fixes can land one at a time. The twin of the markup's per-group flags.
    No command-line option: the build picks them."""

    # The clip's frames and the clock that places them: clipSpan, videoInput, fastTrimInput,
    # speedFilter, audioFilter, varyingRateNote. One group, so a clip's frames, its encode and fast trim
    # seeks, and its audio offset follow one clock; ffprobe's varying rate note describes that clock.
    clipFrames: Release = "next"
    # Where crop points take effect: sectionEaseDuration, cutTime, cropPointOrigin.
    cropPoints: Release = "next"


# 5.49 as a whole: its decisions depend on each other (its videoInput and audioFilter read its clipSpan's
# seek), so it is one build choice, for the oracle tests and opt-in runs, never a group's.
WHOLE_549: Literal["5.49"] = "5.49"
Build = FrameTimingSwitches | Literal["5.49"]

ALL_548 = FrameTimingSwitches(clipFrames="5.48", cropPoints="5.48")

# The build: every group at next. Read at each clip, so the tests can set it.
SWITCHES: Build = FrameTimingSwitches()


def compose(build: Build) -> FrameTiming:
    from clipper import frame_timing_548, frame_timing_549, frame_timing_next

    if build == WHOLE_549:
        return frame_timing_549.FRAME_TIMING
    release = {
        # The origin 5.48's crop functions ignore comes from the markers, not 5.48's clip span, so the
        # cropPoints group reads nothing clipFrames decides.
        "5.48": replace(frame_timing_548.FRAME_TIMING, cropPointOrigin=cropOriginOnMarkersTimeline),
        "next": frame_timing_next.FRAME_TIMING,
    }
    clip = release[build.clipFrames]
    crop = release[build.cropPoints]
    return FrameTiming(
        name=buildName(build),
        clipSpan=clip.clipSpan,
        videoInput=clip.videoInput,
        fastTrimInput=clip.fastTrimInput,
        audioFilter=clip.audioFilter,
        speedFilter=clip.speedFilter,
        sectionEaseDuration=crop.sectionEaseDuration,
        cutTime=crop.cutTime,
        varyingRateNote=clip.varyingRateNote,
        cropPointOrigin=crop.cropPointOrigin,
    )


def buildName(build: Build) -> str:
    """The release when every group agrees, else "next" and each other group as "+group=release"."""
    if build == WHOLE_549:
        return WHOLE_549
    releases = {field.name: getattr(build, field.name) for field in fields(build)}
    if len(set(releases.values())) == 1:
        return next(iter(releases.values()))
    others = [f"{group}={release}" for group, release in releases.items() if release != "next"]
    return "+".join(["next", *others])


def current() -> FrameTiming:
    """The frame timing the build uses."""
    return compose(SWITCHES)
