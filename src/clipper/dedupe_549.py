"""5.49.0's duplicate frame removal, frozen: its own lines from clip_maker.makeClip at v5.49.0. The
build runs it while dedupe.FIND_REPEATS_AGAINST_NEARBY_CHANGES is off.
"""

from fractions import Fraction

from clipper.clipper_types import DictStrAny


def shouldRemoveDuplicateFrames(mps: DictStrAny) -> bool:
    # We consider videos with less than 47 fps (24*2 - 1) to be of low fps as
    # the lowest common video fps is ~24 fps and with frame doubling is ~48 fps.
    return not mps["noDedupe"] and (
        mps["dedupe"] or (mps["minterpFPS"] is not None and Fraction(mps["r_frame_rate"]) < 47)
    )


def removeDuplicateFramesFilter() -> str:
    return "mpdecimate=hi=64*8:lo=64*5:frac=0.1,setpts=N/FR/TB"
