from pathlib import Path

import pytest

from clipper.vidstab_motions import (
    MAX_ZOOM_BUDGET,
    MIN_ZOOM_BUDGET,
    LocalMotion,
    TransformsFile,
    TransformsFileError,
    findBrightnessChanges,
    formatTransforms,
    frameShift,
    frameSize,
    parseTransforms,
    repairMotions,
    zoomBudget,
    zoomBudgetFromFile,
)

# As vidstabdetect writes it with fileformat=1
TEXT = """VID.STAB 1
#      accuracy = 15
#     shakiness = 8
#      stepsize = 6
#   mincontrast = 0.050000
Frame 1 (List 0 [])
Frame 2 (List 2 [(LM 5 -6 452 81 48 0.594560 3.053385),(LM -2 -8 505 81 48 0.465294 0.000000)])
Frame 3 (List 1 [(LM 1 2 81 213 48 0.351193 0.000000)])
"""


def frames(*shifts: tuple[int, int]) -> TransformsFile:
    """A transforms file whose frames after the first each have two fields moving by the shift."""
    motions = [[]] + [
        [LocalMotion(dx, dy, 80, 80, 48, 0.5, 0.0), LocalMotion(dx, dy, 400, 200, 48, 0.4, 1.0)]
        for dx, dy in shifts
    ]
    return TransformsFile(["VID.STAB 1"], motions)


def test_transforms_text_reads_and_writes_back_unchanged() -> None:
    transforms = parseTransforms(TEXT)
    assert len(transforms.frames) == 3
    assert transforms.frames[0] == []
    assert transforms.frames[1][0] == LocalMotion(5, -6, 452, 81, 48, 0.594560, 3.053385)
    assert formatTransforms(transforms) == TEXT


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("TRF1\x00\x00", id="binary"),
        pytest.param(TEXT.replace("Frame 3", "Frame 4"), id="frame out of order"),
        pytest.param(TEXT + "garbage\n", id="stray line"),
    ],
)
def test_unreadable_transforms_are_rejected(text: str) -> None:
    with pytest.raises(TransformsFileError):
        parseTransforms(text)


def test_comments_blank_lines_and_crlf_are_tolerated_as_vid_stab_does() -> None:
    text = TEXT.replace("Frame 3", "\n# note\nFrame 3").replace("\n", "\r\n")
    assert parseTransforms(text).frames == parseTransforms(TEXT).frames


@pytest.mark.parametrize(
    ("brightness", "untrusted"),
    [
        pytest.param([100] * 20, set(), id="steady"),
        # vid.stab's frame i + 1 holds the motion from frame i - 1 to i
        pytest.param([100] * 9 + [200] + [100] * 10, {10, 11}, id="a flash, on and off"),
        pytest.param([100] * 10 + [180] * 10, {11}, id="a light coming on"),
        pytest.param(
            [54, 91, 114, 123, 127.5, 128.8],
            {2, 3, 4},
            id="a light ramping up over frames",
        ),
        pytest.param([100 + 3 * i for i in range(20)], set(), id="a slow fade"),
        pytest.param([30] * 9 + [40] + [30] * 10, {10, 11}, id="a flash in a dark scene"),
        pytest.param([30] * 9 + [31.5] + [30] * 10, set(), id="noise in a dark scene"),
    ],
)
def test_motion_across_a_sharp_brightness_change_is_untrusted(
    brightness: list[float],
    untrusted: set[int],
) -> None:
    assert findBrightnessChanges(brightness) == untrusted


def test_untrusted_motion_is_interpolated_from_the_frames_around_it() -> None:
    transforms = frames((2, 0), (4, 2), (40, -30), (-25, 18), (10, 6))
    assert repairMotions(transforms, {4, 5}) == [4, 5]
    assert frameShift(transforms.frames[3]) == (6, 3)  # a third of the way from (4, 2) to (10, 6)
    assert frameShift(transforms.frames[4]) == (8, 5)
    # The fields keep their positions
    assert [(m.x, m.y) for m in transforms.frames[3]] == [(80, 80), (400, 200)]
    assert frameShift(transforms.frames[2]) == (4, 2)


def test_measured_motion_is_used_where_there_is_one() -> None:
    transforms = frames((2, 0), (4, 2), (40, -30), (-25, 18), (10, 6))
    assert repairMotions(transforms, {4, 5}, {4: (7.4, -3.2)}) == [4, 5]
    assert frameShift(transforms.frames[3]) == (7, -3)
    assert frameShift(transforms.frames[4]) == (8, 5)


def test_untrusted_motion_at_the_end_takes_the_last_good_motion() -> None:
    transforms = frames((2, 0), (4, 2), (40, -30))
    assert repairMotions(transforms, {4}) == [4]
    assert frameShift(transforms.frames[3]) == (4, 2)


def test_nothing_is_repaired_without_good_motion_around() -> None:
    transforms = frames((40, -30))
    assert repairMotions(transforms, {2}) == []


def test_frame_size_comes_from_the_outermost_fields() -> None:
    assert frameSize(frames((1, 1))) == (480, 280)
    assert frameSize(TransformsFile(["VID.STAB 1"], [[], []])) is None


@pytest.mark.parametrize(
    ("shake", "budget"),
    [
        pytest.param(0, MIN_ZOOM_BUDGET, id="steady"),
        # The path strays 5 to 7 px from its average: twice that over the 480 px width, plus the padding
        pytest.param(10, pytest.approx(3.5, abs=0.5), id="shaky"),
        pytest.param(100, MAX_ZOOM_BUDGET, id="too shaky for the most zoom"),
    ],
)
def test_zoom_budget_covers_the_shake(shake: int, budget: float) -> None:
    transforms = frames(*[(shake if i % 2 else -shake, 0) for i in range(60)])
    assert zoomBudget(transforms, smoothing=10) == budget


def test_zoom_budget_is_the_most_zoom_when_the_transforms_cannot_be_read(tmp_path: Path) -> None:
    unreadable = tmp_path / "binary.trf"
    unreadable.write_bytes(b"TRF1\x00\x00")
    assert zoomBudgetFromFile(str(unreadable), 10) == MAX_ZOOM_BUDGET
    assert zoomBudgetFromFile(str(tmp_path / "missing.trf"), 10) == MAX_ZOOM_BUDGET
    assert zoomBudget(TransformsFile(["VID.STAB 1"], [[], []]), 10) == MAX_ZOOM_BUDGET
