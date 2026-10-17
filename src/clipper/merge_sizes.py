"""One frame size per merge.

A merge copies its clips' streams, so clips of different sizes change size at each join, which
FFmpeg's AV1 hardware decoding gets wrong (FFmpeg issue 24132). Clips keep their own size; a merge
that needs another size uses a rescaled copy. Every merge's size is chosen together, since a copy
of a pair shared by several merges serves them all.
"""

import itertools
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

Size = tuple[int, int]

# Above this many combinations of merge sizes, improve a merge-by-merge plan instead of trying all.
MAX_ASSIGNMENTS = 100_000
ASPECT_TOLERANCE = 0.01


@dataclass(frozen=True)
class MergeClip:
    """A marker pair's clip as merges see it."""

    pair: int
    size: Size
    seconds: float
    # Sizes of the clip's rescaled copies already on disk
    copySizes: frozenset[Size] = field(default_factory=frozenset)
    # Not made yet, so it can be encoded at its first merge's size at no extra cost. size is the
    # size it would have on its own.
    scalable: bool = False


@dataclass(frozen=True)
class MergeScale:
    """A clip encoded at its merge's size rather than the size it would have on its own."""

    fromSize: Size
    size: Size


def fittedSize(size: Size, box: Size) -> Size:
    """The size a clip scales to inside box. Aspect ratios within ASPECT_TOLERANCE, which crops of
    one shape differ by after rounding, fill the box: the stretch is invisible and leaves no thin
    black bars. Others keep their aspect ratio and leave black bars."""
    if abs(size[0] / size[1] - box[0] / box[1]) <= ASPECT_TOLERANCE * box[0] / box[1]:
        return box
    scale = min(box[0] / size[0], box[1] / size[1])
    return (
        min(box[0], 2 * round(size[0] * scale / 2)),
        min(box[1], 2 * round(size[1] * scale / 2)),
    )


def rescaleFilter(size: Size, target: Size) -> str:
    """Scales a clip of size to target, centered, with black bars where the aspect ratio differs."""
    width, height = target
    if fittedSize(size, target) == target:
        return f"scale={width}:{height}:flags=lanczos,setsar=1"
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,"
        f"pad={width}:{height}:-1:-1,setsar=1"
    )


def candidateSizes(pairs: Sequence[int], clips: Mapping[int, MergeClip]) -> list[Size]:
    """Sizes the merge's clips already exist at. Any other size would re-encode every clip.
    Larger first, so ties go to the larger size."""
    sizes = {size for pair in pairs for size in (clips[pair].size, *clips[pair].copySizes)}
    return sorted(sizes, key=lambda size: (-size[0] * size[1], -size[0], -size[1]))


def scaledEncodeSizes(
    merges: Sequence[Sequence[int]],
    clips: Mapping[int, MergeClip],
    targets: Sequence[Size],
) -> dict[int, Size]:
    """The size each scalable clip is encoded at: its first merge's size. Its other merges, if they
    differ, use rescaled copies."""
    sizes: dict[int, Size] = {}
    for pairs, target in zip(merges, targets, strict=True):
        for pair in pairs:
            if clips[pair].scalable:
                sizes.setdefault(pair, target)
    return sizes


def planCost(
    merges: Sequence[Sequence[int]],
    clips: Mapping[int, MergeClip],
    targets: Sequence[Size],
) -> tuple[float, int, float]:
    """Re-encode work (seconds of each copy still to make, once per pair and size), then black bar
    area, then how far clips are scaled. Work counts seconds, not pixels, so a tie keeps the larger
    size rather than shrinking clips to encode them faster."""
    encodeSizes = scaledEncodeSizes(merges, clips, targets)
    toMake = {
        (pair, target)
        for pairs, target in zip(merges, targets, strict=True)
        for pair in pairs
        # A clip not made yet will exist only at its encode size
        if target != encodeSizes.get(pair, clips[pair].size) and target not in clips[pair].copySizes
    }
    work = sum(clips[pair].seconds for pair, _ in toMake)
    padding = 0
    scaling = 0.0
    for pairs, target in zip(merges, targets, strict=True):
        for pair in pairs:
            size = clips[pair].size
            if size == target:
                continue
            fitted = fittedSize(size, target)
            padding += target[0] * target[1] - fitted[0] * fitted[1]
            scaling += abs(math.log(fitted[0] / size[0]))
    # Rounded so scaling up and down by the same factor tie exactly, and the larger size wins
    return (work, padding, round(scaling, 9))


def planMergeSizes(merges: Sequence[Sequence[int]], clips: Mapping[int, MergeClip]) -> list[Size]:
    """The size of each merge, choosing the sizes of all merges together."""
    candidates = [candidateSizes(pairs, clips) for pairs in merges]
    if math.prod(len(sizes) for sizes in candidates) <= MAX_ASSIGNMENTS:
        return list(
            min(
                itertools.product(*candidates), key=lambda targets: planCost(merges, clips, targets)
            )
        )

    # Plan one merge at a time, then retry each merge's size while the whole plan improves
    targets: list[Size] = []
    for index, sizes in enumerate(candidates):
        targets.append(
            min(sizes, key=lambda size: planCost(merges[: index + 1], clips, [*targets, size]))
        )
    improved = True
    while improved:
        improved = False
        for index, sizes in enumerate(candidates):
            for size in sizes:
                trial = [*targets[:index], size, *targets[index + 1 :]]
                if planCost(merges, clips, trial) < planCost(merges, clips, targets):
                    targets, improved = trial, True
    return targets


def sizeText(size: Size) -> str:
    return f"{size[0]}x{size[1]}"


def markerPairsText(pairs: Sequence[int]) -> str:
    """`marker pair 4`, `marker pairs 3 and 5`, `marker pairs 1, 2 and 6`."""
    numbers = [str(pair) for pair in dict.fromkeys(pairs)]
    if len(numbers) == 1:
        return f"marker pair {numbers[0]}"
    return f"marker pairs {', '.join(numbers[:-1])} and {numbers[-1]}"


def describeMerge(
    name: str, pairs: Sequence[int], clips: Mapping[int, MergeClip], target: Size
) -> str:
    """One line of the merge plan, e.g. `Merge 1-6 at 1366x2426: marker pairs 3 and 5 from 1290x2290.`"""
    rescaled: dict[Size, list[int]] = {}
    for pair in pairs:
        if clips[pair].size != target:
            rescaled.setdefault(clips[pair].size, []).append(pair)
    parts = [
        f"{markerPairsText(sources)} from {sizeText(size)}{'' if fittedSize(size, target) == target else ' with black bars'}"
        for size, sources in rescaled.items()
    ]
    return f"Merge {name} at {sizeText(target)}: {', '.join(parts) or 'no rescale'}."
