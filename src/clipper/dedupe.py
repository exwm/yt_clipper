"""Removing repeated frames before motion interpolation.

Low fps video often repeats frames, as lower fps content stored at a higher rate (e.g. 24 in 30) or
as near duplicates that differ only by encoder noise. Interpolating between a frame and its repeat
stutters, so repeats are dropped first. The kept frames then play back to back at the source frame
rate, as in 5.48, which speeds the clip up by every dropped frame. Keeping their timestamps instead
keeps the length but leaves a cadence (e.g. 24 in 30) moving at uneven speed. Retiming kept frames
to the content's own rate is future work.

A repeat is judged against the changes around it, not a fixed threshold, since encoder noise and
real motion vary by source. It runs in the encode's own filter graph, so it needs no extra pass and
sees only the frames before each one. tools/encoding/dedupe_eval.py tunes and scores it.
"""

from fractions import Fraction

from clipper.clipper_types import DictStrAny

# Sources this fast are rarely low fps content stored at a higher rate (24 * 2 - 1).
MAX_FPS_FOR_AUTO_DEDUPE = 47

MAX_DROPS_IN_A_ROW = 2
# A frame changing by less than RATIO times the recent peak change is a repeat. The peak shrinks by
# DECAY each frame, and is measured as siti's temporal information (the deviation of the frame's
# difference from the frame before), which a small moving object raises more than noise does.
RATIO = 0.3
DECAY = 0.7
# For 8-bit frames: changes above CEILING are always real, below STILL always repeats (e.g. at the
# start of a clip, before the peak has seen any change).
CEILING = 4.0
STILL = 0.1
# A keyframe can repaint a still picture with fresh encoder noise, which reads as a change. Such a
# frame's mean difference jumps above SPIKE times the recent peak of kept frames, after WARMUP
# frames and above FLOOR (scdet's percent of the value range).
SPIKE = 5.0
WARMUP = 10
FLOOR = 0.02


def shouldRemoveDuplicateFrames(mps: DictStrAny) -> bool:
    """With --remove-duplicate-frames, or with motion interpolation of a low fps source."""
    if mps["noDedupe"]:
        return False
    interpolating = mps["minterpFPS"] is not None
    return mps["dedupe"] or (
        interpolating and Fraction(mps["r_frame_rate"]) < MAX_FPS_FOR_AUTO_DEDUPE
    )


def getRemoveDuplicateFramesFilter(bitDepth: int = 8) -> str:
    """Two metadata selects, each keeping its state in its expression's registers: ld(0) the peak,
    ld(1) the drops in a row, ld(2) this frame's decision, ld(3) the frames seen."""
    # siti measures in the frame's own bit depth.
    scale = 2 ** (bitDepth - 8)
    # The first frame has nothing before it to repeat, so it is always kept.
    repeats = ";".join(
        (
            "st(3,ld(3)+1)",
            f"st(2,gt(ld(3),1)*lt(VALUE1,min({CEILING * scale},max({RATIO}*ld(0),{STILL * scale})))*lt(ld(1),{MAX_DROPS_IN_A_ROW}))",
            f"st(0,max(VALUE1,ld(0)*{DECAY}))",
            "st(1,if(ld(2),ld(1)+1,0))",
            "not(ld(2))",
        ),
    )
    repaints = ";".join(
        (
            "st(3,ld(3)+1)",
            f"st(2,gt(ld(3),{WARMUP})*gt(ld(0),{FLOOR})*gt(VALUE1,{SPIKE}*ld(0))*not(ld(1)))",
            f"st(0,if(ld(2),ld(0)*{DECAY},max(VALUE1,ld(0)*{DECAY})))",
            "st(1,ld(2))",
            "not(ld(2))",
        ),
    )
    select = "metadata=mode=select:value=0:function=expr"
    return (
        f"siti,scdet=threshold=100,{select}:key=lavfi.siti.ti:expr='{repeats}',"
        f"{select}:key=lavfi.scd.mafd:expr='{repaints}'"
    )
