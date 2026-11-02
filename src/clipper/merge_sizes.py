"""One frame size per merge.

A merge copies its clips' streams, so clips of different sizes change size at each join, which
FFmpeg's AV1 hardware decoding gets wrong (FFmpeg issue 24132). A merge takes its largest clip's
size, since merged clips are often zoomed in and should stay about that large. Merges that share a
marker pair take one size, so each pair has one size: a clip made this run is encoded at it, and a
clip made earlier needs at most one rescaled copy.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

Size = tuple[int, int]

ASPECT_TOLERANCE = 0.01


@dataclass(frozen=True)
class MergeClip:
    """A marker pair's clip as merges see it."""

    pair: int
    size: Size
    # Not made yet, so it is encoded at its merge's size. size is the size it would have on its own.
    scalable: bool = False


@dataclass(frozen=True)
class MergeScale:
    """A clip encoded at its merge's size rather than the size it would have on its own."""

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


def largestSize(sizes: Iterable[Size]) -> Size:
    """The size with the largest area, the wider one on a tie."""
    return max(sizes, key=lambda size: (size[0] * size[1], size[0]))


def planPairSizes(
    merges: Sequence[Sequence[int]], clips: Mapping[int, MergeClip]
) -> dict[int, Size]:
    """The one size of each merged pair: the largest clip's size among the merges linked to it
    through shared pairs."""
    parent = {pair: pair for pairs in merges for pair in pairs}

    def root(pair: int) -> int:
        while parent[pair] != pair:
            parent[pair] = parent[parent[pair]]
            pair = parent[pair]
        return pair

    for first, *rest in merges:
        for pair in rest:
            parent[root(pair)] = root(first)
    members: dict[int, list[int]] = {}
    for pair in parent:
        members.setdefault(root(pair), []).append(pair)
    return {
        pair: largestSize(clips[member].size for member in group)
        for group in members.values()
        for pair in group
    }


def planMergeSizes(merges: Sequence[Sequence[int]], clips: Mapping[int, MergeClip]) -> list[Size]:
    """The size of each merge, the size of all its pairs."""
    sizes = planPairSizes(merges, clips)
    return [sizes[pairs[0]] for pairs in merges]


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
