"""The next release's frame decisions, where frame timing fixes land one decision at a time. It starts as
5.48.0's own functions. frame_timing_548.py and frame_timing_549.py stay frozen as the oracles and
fallbacks: a fix replaces one function here and lists it in `NEXT_REPLACED`, and its group's switch can
still pick 5.48."""

from clipper import frame_timing_548
from clipper.frame_timing import FrameTiming, cropOriginOfVideoPart


def sectionEaseDuration(
    easeType: str, leftX: float, rightX: float, firstTime: float, videoPartStart: float, fps: float
) -> float | None:
    """5.48's section, with frames counted from the video's frames (`videoPartStart`) instead of from the
    start marker, as the preview counts them. An instant point then switches on its own frame."""
    if easeType == "smoothTrack":
        return frame_timing_548.sectionEaseDuration(
            easeType, leftX, rightX, firstTime, videoPartStart, fps
        )
    return frame_timing_548.getEaseSectionDuration(
        leftX - videoPartStart, rightX - videoPartStart, fps
    )


def cutTime(
    cutX: float, previousX: float, fps: float | None, firstTime: float, videoPartStart: float
) -> float:
    """5.48's cut time, with frames counted from the video's frames, as the preview's `cutFrameMiddle`."""
    if not fps:
        return cutX
    snapped = videoPartStart + frame_timing_548.getFrameTimeBetweenLeftFrames(
        cutX - videoPartStart, fps
    )
    return snapped if snapped > previousX else cutX


FRAME_TIMING = FrameTiming(
    name="next",
    clipSpan=frame_timing_548.clipSpan,
    videoInput=frame_timing_548.videoInput,
    fastTrimInput=frame_timing_548.fastTrimInput,
    audioFilter=frame_timing_548.audioFilter,
    speedFilter=frame_timing_548.getSpeedFilterAndDuration,
    sectionEaseDuration=sectionEaseDuration,
    cutTime=cutTime,
    varyingRateNote=frame_timing_548.varyingRateNote,
    cropPointOrigin=cropOriginOfVideoPart,
)

# The decisions next makes with a function of its own instead of the 5.48 group's.
# test_frame_timing_next.py fails when any other decision's outputs differ from 5.48's.
NEXT_REPLACED: frozenset[str] = frozenset({"sectionEaseDuration", "cutTime"})
