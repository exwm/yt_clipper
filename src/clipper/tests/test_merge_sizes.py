import pytest

from clipper.merge_sizes import (
    MergeClip,
    describeMerge,
    fittedSize,
    markerPairsText,
    planMergeSizes,
    planPairSizes,
    rescaleFilter,
)

BIG, SMALL, OTHER = (1366, 2426), (1290, 2290), (1216, 2160)
WIDE = (1920, 1080)
FULL_HD, NHD = (1920, 1080), (640, 360)


def clips(*specs: tuple[int, tuple[int, int]]) -> dict[int, MergeClip]:
    return {pair: MergeClip(pair, size) for pair, size in specs}


def new(pair: int, size: tuple[int, int]) -> tuple[int, MergeClip]:
    return pair, MergeClip(pair, size, scalable=True)


def earlier(pair: int, size: tuple[int, int]) -> tuple[int, MergeClip]:
    return pair, MergeClip(pair, size)


@pytest.mark.parametrize(
    ("merges", "clipsByPair", "targets"),
    [
        pytest.param([[1, 2]], clips((1, BIG), (2, BIG)), [BIG], id="one size needs nothing"),
        pytest.param(
            [[1, 2, 3]], clips((1, SMALL), (2, BIG), (3, SMALL)), [BIG], id="the largest clip wins"
        ),
        pytest.param(
            [[1, 2]],
            dict([new(1, FULL_HD), earlier(2, NHD)]),
            [FULL_HD],
            id="a new clip keeps its size over a smaller clip made earlier",
        ),
        pytest.param(
            [[1, 2]],
            dict([earlier(1, BIG), new(2, SMALL)]),
            [BIG],
            id="a new clip grows to a larger clip made earlier",
        ),
        pytest.param(
            [[1, 2], [1, 3]],
            clips((1, SMALL), (2, BIG), (3, OTHER)),
            [BIG, BIG],
            id="merges sharing a pair take one size",
        ),
        pytest.param(
            [[1, 2], [2, 3], [4, 5]],
            clips((1, SMALL), (2, OTHER), (3, BIG), (4, OTHER), (5, SMALL)),
            [BIG, BIG, SMALL],
            id="a chain of shared pairs is one component, other merges keep their own size",
        ),
        pytest.param(
            [[1, 2]],
            clips((1, (1000, 1000)), (2, (1250, 800))),
            [(1250, 800)],
            id="equal areas go to the wider size",
        ),
        pytest.param(
            [[1, 2, 3]],
            clips((1, (720, 1280)), (2, (720, 1280)), (3, WIDE)),
            [WIDE],
            id="a clip of another shape can set the size",
        ),
    ],
)
def test_plan_merge_sizes(
    merges: list[list[int]], clipsByPair: dict[int, MergeClip], targets: list
) -> None:
    assert planMergeSizes(merges, clipsByPair) == targets


def test_every_pair_gets_one_size_and_shared_pairs_need_no_copies() -> None:
    merges = [[1, 2], [2, 3], [4, 5]]
    byPair = dict([new(1, SMALL), earlier(2, OTHER), new(3, BIG), earlier(4, NHD), new(5, FULL_HD)])
    sizes = planPairSizes(merges, byPair)
    assert sizes == {1: BIG, 2: BIG, 3: BIG, 4: FULL_HD, 5: FULL_HD}
    # Each merge's clips are all at its size, so a pair in two merges serves both from one size
    for pairs, target in zip(merges, planMergeSizes(merges, byPair), strict=True):
        assert {sizes[pair] for pair in pairs} == {target}


@pytest.mark.parametrize(
    ("size", "box", "fitted"),
    [
        pytest.param(SMALL, BIG, BIG, id="a rounding difference in aspect fills the box"),
        pytest.param(OTHER, BIG, BIG, id="crops of one shape fill the box"),
        pytest.param(WIDE, BIG, (1366, 768), id="landscape in portrait keeps its aspect"),
        pytest.param(
            (1000, 1000), (1200, 1000), (1000, 1000), id="square in landscape keeps its aspect"
        ),
        pytest.param((640, 360), (320, 180), (320, 180), id="downscale"),
    ],
)
def test_fitted_size(size: tuple, box: tuple, fitted: tuple) -> None:
    assert fittedSize(size, box) == fitted
    assert fitted[0] % 2 == fitted[1] % 2 == 0


@pytest.mark.parametrize(
    ("size", "target", "expected"),
    [
        (SMALL, BIG, "scale=1366:2426:flags=lanczos,setsar=1"),
        (
            WIDE,
            BIG,
            "scale=1366:2426:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=1366:2426:-1:-1,setsar=1",
        ),
    ],
)
def test_rescale_filter(size: tuple, target: tuple, expected: str) -> None:
    assert rescaleFilter(size, target) == expected


@pytest.mark.parametrize(
    ("byPair", "target", "line"),
    [
        (clips((1, BIG), (2, BIG)), BIG, "Merge 1-2 at 1366x2426: no rescale."),
        (
            clips((1, BIG), (2, SMALL), (3, OTHER), (4, SMALL), (5, SMALL)),
            BIG,
            "Merge 1-5 at 1366x2426: marker pairs 2, 4 and 5 from 1290x2290, marker pair 3 from 1216x2160.",
        ),
        (
            clips((1, BIG), (2, WIDE)),
            BIG,
            "Merge 1-2 at 1366x2426: marker pair 2 from 1920x1080 with black bars.",
        ),
    ],
)
def test_describe_merge(byPair: dict[int, MergeClip], target: tuple, line: str) -> None:
    assert describeMerge(f"1-{len(byPair)}", sorted(byPair), byPair, target) == line


@pytest.mark.parametrize(
    ("pairs", "text"),
    [
        ([4], "marker pair 4"),
        ([3, 5], "marker pairs 3 and 5"),
        ([1, 2, 6], "marker pairs 1, 2 and 6"),
        ([2, 2], "marker pair 2"),
    ],
)
def test_marker_pairs_text(pairs: list[int], text: str) -> None:
    assert markerPairsText(pairs) == text
