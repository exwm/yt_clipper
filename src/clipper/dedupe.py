"""Removing repeated frames before motion interpolation.

Low fps video often repeats frames, as lower fps content stored at a higher rate (e.g. 24 in 30) or
as near duplicates that differ only by encoder noise. Interpolating between a frame and its repeat
stutters, so repeats are dropped first. The kept frames keep their timestamps, so the clip keeps its
length and interpolation fills the gaps evenly. Resetting them to the nominal frame rate instead
would speed the clip up by every dropped frame, and would also break variable frame rate sources.
"""

from fractions import Fraction

from clipper.clipper_types import DictStrAny

# Sources this fast are rarely low fps content stored at a higher rate (24 * 2 - 1).
MAX_FPS_FOR_AUTO_DEDUPE = 47


def shouldRemoveDuplicateFrames(mps: DictStrAny) -> bool:
    """With --remove-duplicate-frames, or with motion interpolation of a low fps source."""
    if mps["noDedupe"]:
        return False
    interpolating = mps["minterpFPS"] is not None
    return mps["dedupe"] or (
        interpolating and Fraction(mps["r_frame_rate"]) < MAX_FPS_FOR_AUTO_DEDUPE
    )


def getRemoveDuplicateFramesFilter() -> str:
    return "mpdecimate=hi=64*8:lo=64*5:frac=0.1"
