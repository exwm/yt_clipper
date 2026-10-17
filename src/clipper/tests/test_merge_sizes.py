import random

import pytest

from clipper import merge_sizes
from clipper.merge_sizes import (
    MergeClip,
    describeMerge,
    fittedSize,
    markerPairsText,
    planCost,
    planMergeSizes,
    rescaleFilter,
)

BIG, SMALL, OTHER = (1366, 2426), (1290, 2290), (1216, 2160)
WIDE = (1920, 1080)


def clips(*specs: tuple[int, tuple[int, int], float]) -> dict[int, MergeClip]:
    return {pair: MergeClip(pair, size, seconds) for pair, size, seconds in specs}


@pytest.mark.parametrize(
    ("merges", "clipsByPair", "expected"),
    [
        pytest.param([[1, 2]], clips((1, BIG, 5), (2, BIG, 5)), [BIG], id="one size needs nothing"),
        pytest.param(
            [[1, 2, 3]],
            clips((1, BIG, 5), (2, BIG, 5), (3, SMALL, 5)),
            [BIG],
            id="the odd clip is rescaled",
        ),
        pytest.param(
            [[1, 2]],
            clips((1, BIG, 2), (2, SMALL, 9)),
            [SMALL],
            id="the longer clip keeps its size",
        ),
        pytest.param(
            [[1, 2]],
            clips((1, BIG, 5), (2, SMALL, 5)),
            [BIG],
            id="equal lengths keep the larger size",
        ),
        pytest.param(
            [[1, 2]],
            {1: MergeClip(1, BIG, 2, frozenset({SMALL})), 2: MergeClip(2, SMALL, 9)},
            [SMALL],
            id="a copy on disk is free",
        ),
        pytest.param(
            [[1, 2]],
            {1: MergeClip(1, BIG, 9, frozenset()), 2: MergeClip(2, SMALL, 2, frozenset({BIG}))},
            [BIG],
            id="an earlier copy is reused",
        ),
        # Merge by merge: A picks X (copy 2), then B picks X (copy 3), 185 s re-encoded.
        # Together: both pick Y and share one copy of pair 1, 100 s.
        pytest.param(
            [[1, 2], [1, 3]],
            clips((1, BIG, 100), (2, SMALL, 90), (3, SMALL, 95)),
            [SMALL, SMALL],
            id="a shared pair's copy serves both merges",
        ),
        pytest.param(
            [[1, 2], [3, 4]],
            clips((1, BIG, 5), (2, BIG, 5), (3, SMALL, 5), (4, SMALL, 5)),
            [BIG, SMALL],
            id="merges may differ",
        ),
    ],
)
def test_plan_merge_sizes(
    merges: list[list[int]], clipsByPair: dict[int, MergeClip], expected: list
) -> None:
    assert planMergeSizes(merges, clipsByPair) == expected


def test_different_aspect_ratios_choose_the_least_black_bars() -> None:
    # Two portrait clips and one landscape clip of equal length: fitting the landscape one into the
    # portrait size leaves less black than the other way round
    byPair = clips((1, BIG, 5), (2, (1366, 2426), 5), (3, WIDE, 5))
    assert planMergeSizes([[1, 2, 3]], byPair) == [BIG]
    assert planCost([[1, 2, 3]], byPair, [BIG])[1] > 0


def test_fallback_plan_is_never_worse_than_merge_by_merge_and_matches_on_small_cases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rng = random.Random(7)
    sizes = [BIG, SMALL, OTHER]
    for _ in range(40):
        byPair = clips(*((pair, rng.choice(sizes), rng.randint(1, 20)) for pair in range(1, 7)))
        merges = [rng.sample(range(1, 7), rng.randint(2, 4)) for _ in range(rng.randint(1, 4))]
        exhaustive = planMergeSizes(merges, byPair)
        monkeypatch.setattr(merge_sizes, "MAX_ASSIGNMENTS", 0)
        fallback = planMergeSizes(merges, byPair)
        monkeypatch.undo()
        assert planCost(merges, byPair, fallback) >= planCost(merges, byPair, exhaustive)
        oneByOne = [
            min(
                merge_sizes.candidateSizes(pairs, byPair),
                key=lambda size, pairs=pairs: planCost([pairs], byPair, [size]),
            )
            for pairs in merges
        ]
        assert planCost(merges, byPair, fallback) <= planCost(merges, byPair, oneByOne)
        # Every merge's target is a size its clips already exist at
        for pairs, target in zip(merges, fallback, strict=True):
            assert any(byPair[pair].size == target for pair in pairs)


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
        (clips((1, BIG, 5), (2, BIG, 5)), BIG, "Merge 1-2 at 1366x2426: no rescale."),
        (
            clips((1, BIG, 5), (2, SMALL, 5), (3, OTHER, 5), (4, SMALL, 5), (5, SMALL, 5)),
            BIG,
            "Merge 1-5 at 1366x2426: marker pairs 2, 4 and 5 from 1290x2290, marker pair 3 from 1216x2160.",
        ),
        (
            clips((1, BIG, 5), (2, WIDE, 5)),
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
