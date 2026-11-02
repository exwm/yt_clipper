from pathlib import Path

import numpy as np
import pytest

from clipper.phase_correlation import FrameShift
from clipper.vidstab_motions import (
    MAX_ZOOM_BUDGET,
    MIN_ZOOM_BUDGET,
    FrameAnalysis,
    LocalMotion,
    TransformsFile,
    TransformsFileError,
    analysisScale,
    cells,
    fastFftLength,
    findBrightnessChanges,
    findDisagreeingFrames,
    findSparseFrames,
    formatTransforms,
    frameShift,
    frameSize,
    gridShift,
    keepFieldsMovingWithTheCamera,
    measuredMotions,
    parseTransforms,
    repairMotions,
    shake,
    zoomBudget,
    zoomBudgetFromFile,
)


# 213 = 3 x 71 and 211 is prime: both step down to 210 = 2 x 3 x 5 x 7
@pytest.mark.parametrize(
    ("length", "fast"), [(213, 210), (211, 210), (210, 210), (120, 120), (1, 1)]
)
def test_fastFftLength(length: int, fast: int) -> None:
    assert fastFftLength(length) == fast


def test_cells_are_trimmed_around_their_centres_to_a_fast_size() -> None:
    frame = np.arange(360 * 640, dtype=np.float32).reshape(360, 640)
    grid = cells(frame)
    assert grid.shape == (9, 120, 210)
    # The first cell is frame[0:120, 0:213], trimmed by one column on its left and two on its right
    assert grid[0, 0, 0] == frame[0, 1]


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


def test_the_shift_most_cells_agree_on_wins_over_a_subject_moving_on_its_own() -> None:
    rng = np.random.default_rng(1)
    scene = rng.uniform(0, 255, (400, 700))
    width, height = 576, 324
    previous, frame = (
        scene[50 : 50 + height, 50 : 50 + width],
        scene[48 : 48 + height, 53 : 53 + width].copy(),
    )
    # The middle cell shows a subject moving apart from the scene
    frame[108:216, 192:384] = rng.uniform(0, 255, (108, 192))
    shift = gridShift(previous, frame)
    assert (shift.dx, shift.dy) == (pytest.approx(-3, abs=0.2), pytest.approx(2, abs=0.2))
    assert shift.peak > 0.5
    assert gridShift(previous, rng.uniform(0, 255, previous.shape)).peak == 0


def test_shake_is_how_far_each_frames_shift_strays_from_its_neighbours() -> None:
    def clip(shifts: list[tuple[float, float, float]]) -> list[FrameAnalysis]:
        return [FrameAnalysis(100, None), *(FrameAnalysis(100, FrameShift(*s)) for s in shifts)]

    # A steady pan does not shake; shifts alternating 2 px either side of it shake about 2 px
    assert shake(clip([(3, 0, 0.9)] * 60)) == pytest.approx(0)
    assert shake(clip([(3 + 2 * (-1) ** i, 0, 0.9) for i in range(60)])) == pytest.approx(
        2, abs=0.2
    )
    # Unmeasured frames are left out, and too few measured frames tell nothing
    assert shake(clip([(3, 0, 0.9), (40, 40, 0)] * 30)) == pytest.approx(0)
    assert shake(clip([(3, 0, 0.9)] * 10)) is None


def test_a_measured_frame_where_no_field_agrees_is_untrusted() -> None:
    # On a tile wall every field can match the tile above: the cells measured almost no motion
    transforms = frames((1, 0), (0, 17), (2, 1), (-3, -9))
    # Frame 5's fields agree with a large measured motion; frames past the last are ignored
    measured = {2: (1.2, 0.3), 3: (0.4, -0.2), 4: (2, 1), 5: (-3.5, -9.5), 6: (0, 0)}
    assert findDisagreeingFrames(transforms, measured) == {3}
    # The last frame counts too
    assert findDisagreeingFrames(transforms, {**measured, 5: (10, 10)}) == {3, 5}
    assert findDisagreeingFrames(transforms, {}) == set()


def test_frames_with_far_fewer_fields_than_usual_are_untrusted() -> None:
    field = LocalMotion(1, 0, 80, 80, 48, 0.5, 0.0)
    # The median is 100 fields: 14 is under 15% of it, 15 is not
    counts = [0, 100, 100, 14, 100, 0, 100, 15, 100, 100]
    transforms = TransformsFile(["VID.STAB 1"], [[field] * count for count in counts])
    assert findSparseFrames(transforms) == {4, 6}
    assert findSparseFrames(TransformsFile(["VID.STAB 1"], [[]])) == set()


def test_fields_moving_apart_from_the_measured_motion_are_dropped() -> None:
    camera, subject = (
        LocalMotion(4, 2, 80, 80, 48, 0.5, 0.0),
        LocalMotion(-9, 6, 300, 150, 48, 0.5, 0.0),
    )
    transforms = TransformsFile(
        ["VID.STAB 1"], [[], [camera, subject, subject], [subject, subject], [camera, subject]]
    )
    changed = keepFieldsMovingWithTheCamera(
        transforms, {2: (4.6, 1.2), 3: (4, 2), 4: (4, 2)}, skipped={4}
    )
    assert changed == [2]
    assert transforms.frames[1] == [camera]
    # No field agrees: the frame is kept. A skipped frame is kept.
    assert transforms.frames[2] == [subject, subject]
    assert transforms.frames[3] == [camera, subject]


@pytest.mark.parametrize(
    ("analysisSize", "scale"),
    [
        pytest.param((480, 280), 1, id="not shrunk"),
        # The fields' frame size (480, 280) is only near the real one
        pytest.param((158, 94), 3, id="shrunk by 3"),
        pytest.param((0, 0), None, id="no analysis frames"),
    ],
)
def test_the_analysis_scale_is_the_whole_number_the_frames_were_shrunk_by(
    analysisSize: tuple[int, int],
    scale: int | None,
) -> None:
    assert analysisScale(frames((1, 1)), analysisSize) == scale


def test_measured_motion_is_in_the_clips_pixels_and_opposite_the_contents_shift() -> None:
    analysis = [
        FrameAnalysis(100, None),
        FrameAnalysis(100, FrameShift(1.5, -2, 0.9)),
        FrameAnalysis(100, FrameShift(9, 9, 0.01)),
    ]
    assert measuredMotions(analysis, 3) == {2: (-4.5, 6)}


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


@pytest.mark.parametrize("speed", [10, 20])
def test_zoom_budget_of_a_steady_pan_is_the_least(speed: int) -> None:
    # A pan has no shake: its path is a straight line, which its moving average follows to the ends
    assert zoomBudget(frames(*[(speed, 0)] * 60), smoothing=10) == MIN_ZOOM_BUDGET


def test_zoom_budget_is_the_most_zoom_when_the_transforms_cannot_be_read(tmp_path: Path) -> None:
    unreadable = tmp_path / "binary.trf"
    unreadable.write_bytes(b"TRF1\x00\x00")
    assert zoomBudgetFromFile(str(unreadable), 10) == MAX_ZOOM_BUDGET
    assert zoomBudgetFromFile(str(tmp_path / "missing.trf"), 10) == MAX_ZOOM_BUDGET
    assert zoomBudget(TransformsFile(["VID.STAB 1"], [[], []]), 10) == MAX_ZOOM_BUDGET
