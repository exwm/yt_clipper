"""The next release's frame decisions, where frame timing fixes land one decision at a time. It starts as
5.48.0's own functions. frame_timing_548.py and frame_timing_549.py stay frozen as the oracles and
fallbacks: a fix replaces one function here and lists it in `NEXT_REPLACED`, and its group's switch can
still pick 5.48."""

from clipper import frame_timing_548
from clipper.frame_timing import FrameTiming, cropOriginOnMarkersTimeline

FRAME_TIMING = FrameTiming(
    name="next",
    clipSpan=frame_timing_548.clipSpan,
    videoInput=frame_timing_548.videoInput,
    fastTrimInput=frame_timing_548.fastTrimInput,
    audioFilter=frame_timing_548.audioFilter,
    speedFilter=frame_timing_548.getSpeedFilterAndDuration,
    sectionEaseDuration=frame_timing_548.sectionEaseDuration,
    cutTime=frame_timing_548.cutTime,
    varyingRateNote=frame_timing_548.varyingRateNote,
    cropPointOrigin=cropOriginOnMarkersTimeline,
)

# The decisions next makes with a function of its own instead of the 5.48 group's.
# test_frame_timing_next.py fails when any other decision's outputs differ from 5.48's.
NEXT_REPLACED: frozenset[str] = frozenset()
