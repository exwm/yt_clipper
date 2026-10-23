import json
import math
import re
from fractions import Fraction
from pathlib import Path
from typing import Optional, Union

import pytest

from clipper import ffmpeg_filter
from clipper.clipper_types import CropMap

SMALL_CROP_MAP = [
    {"x": 7.130523, "y": 0, "crop": "109:426:540:960"},
    {"x": 12.827726, "y": 0, "crop": "42:507:540:960"},
]

# Crop maps with a short (~0.9 frame at 29.97 fps) section in the middle: the 23.12 -> 23.15
# pair. The end-time adjustment pulls its adjusted end time before its start time, so it must
# fall back to the real duration instead of being dropped. Dropping it leaves a timeline gap
# that snaps the crop to x=0 (top-left corner) for any frame landing in it. This is a timing
# bug, so it applies whether the short section holds the crop (667 -> 667) or changes it
# (667 -> 600), hence both variants.
SHORT_HOLD_CROP_MAP = [
    {"x": 22.188863, "y": 0, "crop": "840:0:1080:1080"},
    {"x": 22.51, "y": 0, "crop": "840:0:1080:1080"},
    {"x": 23.12, "y": 0, "crop": "667:0:1080:1080"},
    {"x": 23.15, "y": 0, "crop": "667:0:1080:1080"},
    {"x": 23.65, "y": 0, "crop": "603:0:1080:1080"},
    {"x": 23.782178, "y": 0, "crop": "603:0:1080:1080"},
]

SHORT_CHANGE_CROP_MAP = [
    {"x": 22.188863, "y": 0, "crop": "840:0:1080:1080"},
    {"x": 22.51, "y": 0, "crop": "840:0:1080:1080"},
    {"x": 23.12, "y": 0, "crop": "667:0:1080:1080"},
    {"x": 23.15, "y": 0, "crop": "600:0:1080:1080"},
    {"x": 23.65, "y": 0, "crop": "603:0:1080:1080"},
    {"x": 23.782178, "y": 0, "crop": "603:0:1080:1080"},
]

# Short sections placed at the timeline edges and back to back. Each sits in the drop zone at
# 29.97 fps (pre-fix it would be removed, leaving a gap), exercising the fix at the first
# section, the last (inclusive `between`) section, and two consecutive sections.
SHORT_START_CROP_MAP = [
    {"x": 0.0, "y": 0, "crop": "100:0:1080:1080"},
    {"x": 0.02, "y": 0, "crop": "200:0:1080:1080"},
    {"x": 0.6, "y": 0, "crop": "300:0:1080:1080"},
    {"x": 1.0, "y": 0, "crop": "300:0:1080:1080"},
]

SHORT_END_CROP_MAP = [
    {"x": 0.0, "y": 0, "crop": "100:0:1080:1080"},
    {"x": 0.5, "y": 0, "crop": "200:0:1080:1080"},
    {"x": 0.98, "y": 0, "crop": "300:0:1080:1080"},
    {"x": 1.0, "y": 0, "crop": "300:0:1080:1080"},
]

CONSECUTIVE_SHORT_CROP_MAP = [
    {"x": 0.0, "y": 0, "crop": "100:0:1080:1080"},
    {"x": 0.5, "y": 0, "crop": "200:0:1080:1080"},
    {"x": 0.52, "y": 0, "crop": "300:0:1080:1080"},
    {"x": 0.54, "y": 0, "crop": "400:0:1080:1080"},
    {"x": 1.0, "y": 0, "crop": "500:0:1080:1080"},
]

# Zoom/pan variant of the short-hold case: the changing crop size (1080 -> 900 -> 800) routes
# through getZoomPanFilter rather than the pan-only getCropFilter.
SHORT_ZOOM_CROP_MAP = [
    {"x": 22.188863, "y": 0, "crop": "0:0:1080:1080"},
    {"x": 22.51, "y": 0, "crop": "0:0:1080:1080"},
    {"x": 23.12, "y": 0, "crop": "0:0:900:900"},
    {"x": 23.15, "y": 0, "crop": "0:0:900:900"},
    {"x": 23.65, "y": 0, "crop": "0:0:800:800"},
    {"x": 23.782178, "y": 0, "crop": "0:0:800:800"},
]

# Degenerate map: every point shares a time, so all sections are zero-duration. The filter
# builders must fall back to a static crop instead of crashing on an empty expression.
DEGENERATE_CROP_MAP = [
    {"x": 5.0, "y": 0, "crop": "10:20:540:960"},
    {"x": 5.0, "y": 0, "crop": "30:40:540:960"},
]

NTSC_FPS = Fraction(30000, 1001)  # 29.97

MEDIUM_CROP_MAP = [
    {"x": 7.130523, "y": 0, "crop": "109:426:540:960"},
    {"x": 8.08, "y": 0, "crop": "109:502:540:960"},
    {"x": 12.827726, "y": 0, "crop": "42:507:540:960"},
]


# crop map with redundant 0 duration points at the beginning, middle, and end
LARGE_REDUNDANT_CROP_MAP = [
    {"x": 7.130523, "y": 0, "crop": "109:426:540:960"},
    {"x": 7.130523, "y": 0, "crop": "109:426:540:960"},
    {"x": 8.08, "y": 0, "crop": "109:502:540:960"},
    {"x": 9.59, "y": 0, "crop": "163:635:450:800"},
    {"x": 9.59, "y": 0, "crop": "163:635:450:800"},
    {"x": 9.59, "y": 0, "crop": "80:600:470:860"},
    {"x": 11.22, "y": 0, "crop": "42:559:513:912"},
    {"x": 12.827726, "y": 0, "crop": "42:507:540:960"},
    {"x": 12.827726, "y": 0, "crop": "42:507:540:960"},
]


def test_getCropFilter(snapshot: str) -> None:
    cropFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960",
        LARGE_REDUNDANT_CROP_MAP,
        60,
        easeType="easeOutCubic",
    )
    assert cropFilter == snapshot


def test_getCropFilter_smooth_track_handles_redundant_coincident_points() -> None:
    # A redundant zero-duration point (a neighbor sharing a point's time) must not divide by zero in
    # the tangent. Real exported maps contain these, so the default smoothTrack must survive them.
    cropFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960",
        LARGE_REDUNDANT_CROP_MAP,
        60,
        easeType="smoothTrack",
    )
    assert cropFilter  # no ZeroDivisionError


@pytest.mark.parametrize(
    ("cropPointEasing", "easeType"),
    [
        # A clip without the field, or the smoothInOut alias, renders as the original sine ease.
        (None, "easeInOutSine"),
        ("smoothInOut", "easeInOutSine"),
        ("somethingUnknown", "easeInOutSine"),
        ("smoothTrack", "smoothTrack"),
        ("cinematic", "smoothTrack"),  # when there is no path to solve, matching the preview's fallback
    ],
)
def test_resolveCropEaseType(cropPointEasing: Optional[str], easeType: str) -> None:
    assert ffmpeg_filter.resolveCropEaseType(cropPointEasing) == easeType


def _cropMapWithInstantInto(instantIndex: Optional[int]) -> CropMap:
    points = [{"x": float(t), "y": 0, "crop": f"{100 * t}:0:100:100"} for t in range(4)]
    if instantIndex is not None:
        points[instantIndex]["easeIn"] = "instant"
    return points


@pytest.mark.parametrize(
    ("instantIndex", "hasPrev", "hasNext"),
    [
        pytest.param(None, True, True, id="no instant transitions"),
        pytest.param(1, False, True, id="instant into the section start breaks the previous"),
        pytest.param(0, True, True, id="instant into the previous point does not"),
        pytest.param(3, True, False, id="instant into the next point breaks it"),
        pytest.param(2, True, True, id="the section's own instant end is not a neighbor break"),
    ],
)
def test_smoothTrackNeighbor_breaks_only_at_the_neighbor_boundary(
    instantIndex: Optional[int],
    hasPrev: bool,
    hasNext: bool,
) -> None:
    # Section 1 runs from point 1 to point 2; its neighbors are points 0 and 3.
    section = 1
    cropMap = _cropMapWithInstantInto(instantIndex)
    prev = ffmpeg_filter._smoothTrackNeighbor(cropMap, section - 1, section, 0.0)
    nxt = ffmpeg_filter._smoothTrackNeighbor(cropMap, section + 2, section + 2, 0.0)
    assert (prev is not None, nxt is not None) == (hasPrev, hasNext)


@pytest.mark.parametrize("monotone", [False, True])
def test_getCropSectionTangent_central_slope_on_collinear_ramp(monotone: bool) -> None:
    # prev 0@0, point 100@1, after 200@2: the central slope (100/s) is monotonic, so unclamped.
    tangent = ffmpeg_filter.getCropSectionTangent(0.0, 100.0, 200.0, 0.0, 1.0, 2.0, monotone)
    assert tangent == pytest.approx(100.0)


def test_getCropSectionTangent_is_zero_at_a_map_end() -> None:
    assert ffmpeg_filter.getCropSectionTangent(None, 100.0, 200.0, None, 1.0, 2.0, False) == 0.0


def test_getCropSectionTangent_monotone_zeroes_tangent_at_a_reversal() -> None:
    # before 0, point 100 (a peak), after 50: slopes +100 then -50 reverse sign.
    assert ffmpeg_filter.getCropSectionTangent(0.0, 100.0, 50.0, 0.0, 1.0, 2.0, True) == 0.0
    # Plain Catmull-Rom keeps the central slope (which is what overshoots the peak).
    catmull = ffmpeg_filter.getCropSectionTangent(0.0, 100.0, 50.0, 0.0, 1.0, 2.0, False)
    assert catmull == pytest.approx(25.0)


def test_getCropSectionTangent_monotone_clamps_to_three_times_smaller_slope() -> None:
    # central slope is 500/s but the smaller adjacent slope is 10, so it caps at 3*10 = 30.
    clamped = ffmpeg_filter.getCropSectionTangent(0.0, 10.0, 1000.0, 0.0, 1.0, 2.0, True)
    assert clamped == pytest.approx(30.0)


def test_getCropFilter_smooth_track_handles_crop_points_out_of_time_order() -> None:
    # A hand-edited markers JSON can list crop points out of order. The middle section's neighbors
    # then share a time, which has no slope to follow.
    cropMap = [
        {"x": 2, "crop": "0:0:100:100"},
        {"x": 1, "crop": "10:0:100:100"},
        {"x": 2, "crop": "20:0:100:100"},
        {"x": 3, "crop": "30:0:100:100"},
    ]
    assert ffmpeg_filter.getCropFilter("0:0:100:100", cropMap, 30, easeType="smoothTrack")


def test_getCropFilter_default_matches_easeInOutSine_for_backwards_compat() -> None:
    default = ffmpeg_filter.getCropFilter("109:426:540:960", MEDIUM_CROP_MAP, 60)
    explicit = ffmpeg_filter.getCropFilter(
        "109:426:540:960",
        MEDIUM_CROP_MAP,
        60,
        easeType="easeInOutSine",
    )
    assert default == explicit
    assert "cos(" in default
    assert "^3" not in default


def test_getCropFilter_smooth_track_uses_cubic_hermite() -> None:
    cropFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960", MEDIUM_CROP_MAP, 60, easeType="smoothTrack",
    )
    # A cubic Hermite (clipped section progress raised to the third power), not the sine ease.
    assert "^3" in cropFilter
    assert "cos(" not in cropFilter


@pytest.mark.parametrize("easeType", ["smoothTrack"])
def test_getCropFilter_spline_snapshot(easeType: str, snapshot: str) -> None:
    cropFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960",
        MEDIUM_CROP_MAP,
        60,
        easeType=easeType,
    )
    assert cropFilter == snapshot


def test_getZoomPanFilter(snapshot: str) -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        LARGE_REDUNDANT_CROP_MAP,
        60,
        easeType="easeOutCubic",
    )
    assert ffmpegFilter == snapshot


def test_getZoomPanFilter_derives_zoom_from_eased_width() -> None:
    # The zoom factor is maxWidth / eased(w) (1080 is the largest crop width here), matching the
    # preview which interpolates the width, rather than easing the zoom factor maxWidth/w directly.
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(SHORT_ZOOM_CROP_MAP, 60)
    assert "z='" in ffmpegFilter
    assert "1080/(" in ffmpegFilter


def test_getZoomPanFilter_smooth_track_uses_cubic_hermite() -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        SHORT_ZOOM_CROP_MAP,
        60,
        easeType="smoothTrack",
    )
    # The zoom derives from a spline-eased width, so the zoom factor is maxWidth / (cubic Hermite).
    assert "^3" in ffmpegFilter
    assert "cos(" not in ffmpegFilter
    assert "1080/(" in ffmpegFilter


@pytest.mark.parametrize("easeType", ["smoothTrack"])
def test_getZoomPanFilter_spline_snapshot(easeType: str, snapshot: str) -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        SHORT_ZOOM_CROP_MAP,
        60,
        easeType=easeType,
    )
    assert ffmpegFilter == snapshot


def test_short_section_is_not_dropped_getZoomPanFilter(snapshot: str) -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        SHORT_ZOOM_CROP_MAP,
        NTSC_FPS,
        easeType="easeInOutSine",
    )
    # The short section stays gated in both the pan (t) and zoom (it) timelines, so neither the
    # pan crop nor the zoom collapses into a gap.
    assert "gte(t, 0.9311369999999997)*lt(t, 0.9611369999999972)" in ffmpegFilter
    assert "gte(it, 0.9311369999999997)*lt(it, 0.9611369999999972)" in ffmpegFilter
    assert ffmpegFilter == snapshot


def test_degenerate_cropmap_falls_back_to_static_getCropFilter() -> None:
    # All sections are zero-duration, so there is nothing to ease: a static crop from the first
    # point is emitted instead of crashing on an empty expression.
    cropFilter = ffmpeg_filter.getCropFilter("10:20:540:960", DEGENERATE_CROP_MAP, 60)
    assert cropFilter == "crop='x=10:y=20:w=540:h=960:exact=1'"


def test_degenerate_cropmap_falls_back_to_static_getZoomPanFilter() -> None:
    ffmpegFilter, maxSize = ffmpeg_filter.getZoomPanFilter(DEGENERATE_CROP_MAP, 60)
    assert ffmpegFilter == "crop='x=10:y=20:w=540:h=960:exact=1'"
    assert maxSize == 540 * 960


@pytest.mark.parametrize(
    ("cropMap", "rightX"),
    [
        pytest.param(SHORT_HOLD_CROP_MAP, "667", id="hold"),
        pytest.param(SHORT_CHANGE_CROP_MAP, "600", id="change"),
    ],
)
def test_short_section_is_not_dropped_getCropFilter(
    cropMap: CropMap,
    rightX: str,
    snapshot: str,
) -> None:
    # A too-close pair must stay in the timeline so the crop never drops to x=0, whether the
    # section holds (667 -> 667) or changes (667 -> 600) the crop.
    cropFilter = ffmpeg_filter.getCropFilter(
        "840:0:1080:1080",
        cropMap,
        NTSC_FPS,
        easeType="easeInOutSine",
    )
    # The short section is gated (no gap) and eases from 667 to its real right value over its
    # real duration (the fallback), rather than being dropped.
    assert_crop_filter_has_no_gaps(cropFilter, cropMap)
    assert (
        f"(gte(t, 0.9311369999999997)*lt(t, 0.9611369999999972)*"
        f"((667)+(({rightX})-(667))*0.5*(1-cos((clip(((t-0.9311369999999997)"
        f"/0.029999999999997584),0,1))*PI))))"
    ) in cropFilter
    assert cropFilter == snapshot


@pytest.mark.parametrize(
    ("cropMap", "fps", "easeType"),
    [
        pytest.param(LARGE_REDUNDANT_CROP_MAP, 60, "easeOutCubic", id="large-redundant"),
        pytest.param(SMALL_CROP_MAP, 60, "linear", id="small"),
        pytest.param(MEDIUM_CROP_MAP, 60, "linear", id="medium"),
        pytest.param(SHORT_HOLD_CROP_MAP, NTSC_FPS, "easeInOutSine", id="short-hold"),
        pytest.param(SHORT_CHANGE_CROP_MAP, NTSC_FPS, "easeInOutSine", id="short-change"),
        pytest.param(SHORT_START_CROP_MAP, NTSC_FPS, "easeInOutSine", id="short-start"),
        pytest.param(SHORT_END_CROP_MAP, NTSC_FPS, "easeInOutSine", id="short-end"),
        pytest.param(CONSECUTIVE_SHORT_CROP_MAP, NTSC_FPS, "easeInOutSine", id="consecutive"),
    ],
)
def test_crop_filter_sections_tile_timeline(
    cropMap: CropMap,
    fps: Union[int, Fraction],
    easeType: str,
) -> None:
    # The invariant the gap bug violated: section gates must tile [0, total] with no gaps or
    # overlaps, one section per positive-duration pair, with every divisor usable.
    cropFilter = ffmpeg_filter.getCropFilter(cropMap[0]["crop"], cropMap, fps, easeType=easeType)
    assert_crop_filter_has_no_gaps(cropFilter, cropMap)

    axes = _parse_crop_filter_sections(cropFilter)
    positivePairs = sum(1 for left, right in zip(cropMap, cropMap[1:]) if right["x"] > left["x"])

    # x and y share one timeline; one section per positive-duration pair; divisors usable.
    assert axes["x"] == axes["y"]
    assert len(axes["x"]) == positivePairs
    for start, end, divisor in axes["x"]:
        assert end > start
        assert divisor > 0


def test_assert_crop_filter_has_no_gaps_detects_a_gap() -> None:
    # Self-check that the helper is not vacuous: a filter leaving [0.5, 0.8) uncovered (which
    # would snap the crop to (0, 0) there) must be rejected.
    axis = (
        "(gte(t, 0.0)*lt(t, 0.5)*(clip(((t-0.0)/0.5),0,1)))"
        "+(between(t, 0.8, 1.0)*(clip(((t-0.8)/0.2),0,1)))"
    )
    gappyFilter = f"crop='x={axis}:y={axis}:w=1080:h=1080:exact=1'"
    gapMap = [
        {"x": 0.0, "y": 0, "crop": "0:0:1080:1080"},
        {"x": 1.0, "y": 0, "crop": "0:0:1080:1080"},
    ]
    with pytest.raises(AssertionError, match="gap or overlap"):
        assert_crop_filter_has_no_gaps(gappyFilter, gapMap)


@pytest.mark.parametrize(
    ("startTime", "endTime", "fps", "expected"),
    [
        # A zero-duration section: skipped.
        (1.0, 1.0, 30.0, None),
        # Section shorter than the adjustment window: falls back to the real duration
        # instead of dropping out (would otherwise leave a crop-snapping gap).
        (0.931137, 0.961137, float(NTSC_FPS), 0.961137 - 0.931137),
        # Normal-length section: uses the frame-adjusted (slightly shorter) duration.
        (0.0, 0.321137, float(NTSC_FPS), 8.5 / float(NTSC_FPS)),
        # Whether a short section drops depends on the right point's frame alignment, not just
        # its duration. With the end on a frame boundary (fractional frame 0), the drop
        # threshold is the minimum half a frame, so even sub-frame sections keep the adjusted
        # duration rather than dropping.
        (0.97, 1.0, 30.0, 29.5 / 30 - 0.97),  # ~0.9 frame, end on grid -> adjusted (kept)
        (0.95, 1.0, 30.0, 29.5 / 30 - 0.95),  # 1.5 frames, always safe -> adjusted
        # ~1 frame, but the right point sits late in its frame (fractional frame ~0.9): the
        # adjustment inverts, so it falls back to the real duration.
        (0.963667, 0.997, 30.0, 0.997 - 0.963667),
    ],
)
def test_getEaseSectionDuration(
    startTime: float,
    endTime: float,
    fps: float,
    expected: Optional[float],
) -> None:
    result = ffmpeg_filter.getEaseSectionDuration(startTime, endTime, fps)
    if expected is None:
        assert result is None
    else:
        assert result == pytest.approx(expected)


@pytest.mark.parametrize(
    "cropMap",
    [SMALL_CROP_MAP, MEDIUM_CROP_MAP],
)
def test_small_getCropFilter(cropMap: CropMap, snapshot: str) -> None:
    ffmpegFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960",
        cropMap,
        60,
        easeType="linear",
    )
    assert ffmpegFilter == snapshot


@pytest.mark.parametrize(
    "cropMap",
    [SMALL_CROP_MAP, MEDIUM_CROP_MAP],
)
def test_small_getZoomPanFilter(cropMap: CropMap, snapshot: str) -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        cropMap,
        60,
        easeType="linear",
    )
    assert ffmpegFilter == snapshot


# Test helpers


_CROP_GATE_RE = re.compile(r"gte\(t, ([0-9.]+)\)\*lt\(t, ([0-9.]+)\)")
_CROP_BETWEEN_RE = re.compile(r"between\(t, ([0-9.]+), ([0-9.]+)\)")


def _parse_axis_sections(axisExpr: str) -> list[tuple[float, float, float]]:
    """Parse an axis expression into ordered (start, end, divisor) section tuples.

    Ease-type-agnostic: gate bounds and the easeP divisor are emitted the same way for every
    easing function, so this works for sine, cubic, linear, etc.
    """
    gates = _CROP_GATE_RE.findall(axisExpr) + _CROP_BETWEEN_RE.findall(axisExpr)
    sections = []
    for start, end in gates:
        divisor = re.search(rf"\(t-{re.escape(start)}\)/([0-9.eE+-]+)\)", axisExpr)
        assert divisor is not None, f"no divisor found for section starting at {start}"
        sections.append((float(start), float(end), float(divisor.group(1))))
    return sections


def _parse_crop_filter_sections(cropFilter: str) -> dict[str, list[tuple[float, float, float]]]:
    inner = cropFilter[len("crop='") : -len("'")]
    axes = {}
    for part in inner.split(":"):
        if part.startswith(("x=", "y=")):
            axes[part[0]] = _parse_axis_sections(part[2:])
    return axes


def assert_crop_filter_has_no_gaps(cropFilter: str, cropMap: CropMap) -> None:
    """Assert the dynamic crop filter covers its whole timeline, with no gaps or overlaps.

    Each section is gated by time and the gates are summed. A gap (a time matched by no gate)
    makes the whole sum 0, snapping the crop to the (0, 0) top-left corner for those frames; an
    overlap (a time matched by two gates) sums two sections. Gates are emitted half open for
    every section but the last (which is inclusive), so the section intervals tile [0, total]
    only if each section starts exactly where the previous one ended.
    """
    total = cropMap[-1]["x"] - cropMap[0]["x"]
    for axis, sections in _parse_crop_filter_sections(cropFilter).items():
        assert sections, f"{axis} axis has no sections"
        assert sections[0][0] == pytest.approx(0.0), (
            f"{axis} axis starts at {sections[0][0]}, not 0"
        )
        assert sections[-1][1] == pytest.approx(total), (
            f"{axis} axis ends at {sections[-1][1]}, not {total}"
        )
        for prev, nxt in zip(sections, sections[1:]):
            assert nxt[0] == prev[1], (
                f"{axis} axis gap or overlap: a section ends at {prev[1]} "
                f"but the next starts at {nxt[0]}"
            )


# Cinematic crop path (getCropPathFilter) fixtures and tests.

SETTINGS_1X = {"cropMultipleX": 1, "cropMultipleY": 1, "inputIsHDR": False}
SETTINGS_2X = {"cropMultipleX": 2, "cropMultipleY": 2, "inputIsHDR": False}

# A pan: x ramps 100 -> 150 over the first second, then holds; constant 960x540 size.
PAN_CROP_PATH = {
    "version": 1,
    "margin": {"pos": 40, "zoom": 0.1},
    "signature": "pan",
    "segments": [
        {
            "startT": 0.0,
            "endT": 1.0,
            "x": [100.0, 50.0, 0.0],
            "y": [0.0, 0.0, 0.0],
            "w": [960.0, 0.0, 0.0],
            "h": [540.0, 0.0, 0.0],
        },
        {
            "startT": 1.0,
            "endT": 2.0,
            "x": [150.0, 0.0, 0.0],
            "y": [0.0, 0.0, 0.0],
            "w": [960.0, 0.0, 0.0],
            "h": [540.0, 0.0, 0.0],
        },
    ],
}

# A zoom: size shrinks 1920x1080 -> 1280x720 (16:9 kept) over the first second, then holds.
ZOOM_CROP_PATH = {
    "version": 1,
    "margin": {"pos": 40, "zoom": 0.1},
    "signature": "zoom",
    "segments": [
        {
            "startT": 0.0,
            "endT": 1.0,
            "x": [0.0, 0.0, 0.0],
            "y": [0.0, 0.0, 0.0],
            "w": [1920.0, -640.0, 0.0],
            "h": [1080.0, -360.0, 0.0],
        },
        {
            "startT": 1.0,
            "endT": 2.0,
            "x": [0.0, 0.0, 0.0],
            "y": [0.0, 0.0, 0.0],
            "w": [1280.0, 0.0, 0.0],
            "h": [720.0, 0.0, 0.0],
        },
    ],
}


def _eval_crop_path(cropPath: dict, t: float) -> list[float]:
    # Direct evaluation of the baked path (the markup's evalCropPathAtTime), in cropRes px.
    segs = cropPath["segments"]
    clamped = min(max(t, segs[0]["startT"]), segs[-1]["endT"])
    seg = next((s for s in segs if clamped <= s["endT"]), segs[-1])
    u = clamped - seg["startT"]
    return [c[0] + c[1] * u + c[2] * u * u for c in (seg["x"], seg["y"], seg["w"], seg["h"])]


def _eval_ffmpeg_axis(expr: str, t: float) -> float:
    # Evaluate a generated crop-axis expression at time t (gated sum of polynomials). Test-only, on
    # our own generated string, so eval is safe here.
    env = {
        "t": t,
        "it": t,
        "gte": lambda x, a: 1.0 if x >= a else 0.0,
        "lt": lambda x, a: 1.0 if x < a else 0.0,
        "between": lambda x, a, b: 1.0 if a <= x <= b else 0.0,
        "max": max,
        "min": min,
        "clip": lambda x, lo, hi: min(max(x, lo), hi),
        "cos": math.cos,
        "sin": math.sin,
        "PI": math.pi,
        "if_": lambda cond, a, b: a if cond else b,
    }
    # ffmpeg's if() is a Python keyword.
    return eval(expr.replace("^", "**").replace("if(", "if_("), {"__builtins__": {}}, env)


def test_zoompan_smooth_track_right_edge_is_eased_x_plus_eased_w() -> None:
    # The preview draws x + w. Easing the right edge as its own spline drifts from that, since the
    # tangent clamp is not linear: here by up to 5.6 px mid section.
    cropMap = [
        {"x": float(t), "crop": f"{x}:0:{w}:{w}"}
        for t, x, w in [(0, 600, 400), (1, 590, 500), (2, 500, 600), (3, 400, 700)]
    ]
    ctx = ffmpeg_filter._SectionEaseContext(
        easeType="smoothTrack",
        prev=ffmpeg_filter._smoothTrackNeighbor(cropMap, 0, 1, 0.0),
        nxt=ffmpeg_filter._smoothTrackNeighbor(cropMap, 3, 3, 0.0),
        startTime=1.0,
        endTime=2.0,
        sectDuration=1.0,
    )
    start = {"x": 590.0, "y": 0.0, "w": 500.0, "h": 500.0}
    end = {"x": 500.0, "y": 0.0, "w": 600.0, "h": 600.0}
    easeP = "((t-1.0)/1.0)"
    right = ffmpeg_filter._zoomPanEdgeEase(ctx, easeP, 4, "right", start, end)
    x, w = (
        ffmpeg_filter._zoomPanSectionEase(ctx, "", "", easeP, 4, kind, start[kind], end[kind])
        for kind in ("x", "w")
    )
    assert right is not None
    assert x is not None
    assert w is not None
    for t in (1.0, 1.25, 1.5, 1.75, 2.0):
        expected = _eval_ffmpeg_axis(x, t) + _eval_ffmpeg_axis(w, t)
        assert _eval_ffmpeg_axis(right, t) == pytest.approx(expected)


def test_zoompan_smooth_track_stays_inside_the_frame() -> None:
    # The markup's zoom case: x and w eased on their own overshoot 1920 between the last two points.
    cropMap = [
        {"x": float(t), "crop": f"{x}:0:{w}:{h}"}
        for t, x, w, h in [(0, 0, 1000, 562), (1, 920, 1000, 562), (2, 1420, 500, 281)]
    ]
    start = {"x": 920.0, "y": 0.0, "w": 1000.0, "h": 562.0}
    end = {"x": 1420.0, "y": 0.0, "w": 500.0, "h": 281.0}

    def rightEdge(frameWidth: float | None) -> str:
        ctx = ffmpeg_filter._SectionEaseContext(
            easeType="smoothTrack",
            prev=ffmpeg_filter._smoothTrackNeighbor(cropMap, 0, 1, 0.0),
            nxt=None,
            startTime=1.0,
            endTime=2.0,
            sectDuration=1.0,
            frameWidth=frameWidth,
            frameHeight=1080,
        )
        right = ffmpeg_filter._zoomPanEdgeEase(ctx, "((t-1.0)/1.0)", 4, "right", start, end)
        assert right is not None
        return right

    times = [1.05 + i * 0.05 for i in range(19)]
    assert max(_eval_ffmpeg_axis(rightEdge(None), t) for t in times) > 4 * 1920
    assert all(_eval_ffmpeg_axis(rightEdge(1920), t) <= 4 * 1920 + 1e-9 for t in times)


@pytest.mark.parametrize("widths", [(1000, 600), (600, 1000)], ids=["zoom in", "zoom out"])
def test_getCropPathFilter_zooms_when_one_segment_changes_size(widths: tuple[int, int]) -> None:
    # A single segment's start width alone misses a zoom in, which ends narrower than it starts.
    start, end = widths
    segment = {"startT": 0.0, "endT": 1.0, "x": [0, 0, 0], "y": [0, 0, 0], "w": [start, end - start, 0], "h": [start / 2, (end - start) / 2, 0]}
    cropFilter, _size = ffmpeg_filter.getCropPathFilter(
        {"segments": [segment]}, {"cropMultipleX": 1, "cropMultipleY": 1}, 30
    )
    assert "zoompan" in cropFilter


def test_getCropPathFilter_constant_size_is_even() -> None:
    # 1000 cropRes px at 2/3 scale is 666.67 output px; libx264's yuv420p rejects an odd 667.
    segment = {"startT": 0.0, "endT": 1.0, "x": [0, 0, 0], "y": [0, 0, 0], "w": [1000, 0, 0], "h": [563, 0, 0]}
    cropFilter, size = ffmpeg_filter.getCropPathFilter(
        {"segments": [segment]}, {"cropMultipleX": 2 / 3, "cropMultipleY": 2 / 3}, 30
    )
    assert ":w=666:h=374:" in cropFilter
    assert size == 666 * 374


def test_cropPathPolyExpr_emits_scaled_quadratic() -> None:
    expr = ffmpeg_filter._cropPathPolyExpr([10.0, 2.0, 0.5], "t", 1.0, scale=2.0)
    assert expr == "((1.000000)*(t-1.0)^2+(4.000000)*(t-1.0)+(20.000000))"


@pytest.mark.parametrize("noise", [-1e-9, 0.0, 1e-9])
def test_getCropPathFilter_zoom_size_ignores_float_noise_in_the_solved_path(noise: float) -> None:
    # The solver's result differs in the last bits between machines; the clip size must not.
    first, *rest = ZOOM_CROP_PATH["segments"]
    noisy = {
        **first,
        "w": [first["w"][0] + noise, *first["w"][1:]],
        "h": [first["h"][0] + noise, *first["h"][1:]],
    }
    noisyPath = {**ZOOM_CROP_PATH, "segments": [noisy, *rest]}
    _cropFilter, maxSize = ffmpeg_filter.getCropPathFilter(noisyPath, SETTINGS_1X, 30)
    assert maxSize == 1920 * 1080


def test_getCropPathFilter_pan_snapshot(snapshot: str) -> None:
    cropFilter, maxSize = ffmpeg_filter.getCropPathFilter(PAN_CROP_PATH, SETTINGS_1X, 30)
    assert cropFilter.startswith("crop='x=")
    assert "zoompan" not in cropFilter  # constant size -> no zoom
    assert ":w=960:h=540:" in cropFilter  # constant size carried through
    assert maxSize == 960 * 540
    assert cropFilter == snapshot


def test_getCropPathFilter_pan_matches_the_baked_path() -> None:
    # The render must equal the baked path the markup previewed, scaled by cropMultiple. Evaluate the
    # generated x/y expressions and compare to a direct eval of the path at several times.
    cropFilter, _maxSize = ffmpeg_filter.getCropPathFilter(PAN_CROP_PATH, SETTINGS_2X, 30)
    xMatch = re.search(r"x=(.+?):y=", cropFilter)
    yMatch = re.search(r":y=(.+?):w=", cropFilter)
    assert xMatch is not None
    assert yMatch is not None
    xExpr = xMatch.group(1)
    yExpr = yMatch.group(1)
    for t in [0.0, 0.25, 0.5, 0.9, 1.0, 1.5, 2.0]:
        px, py, _, _ = _eval_crop_path(PAN_CROP_PATH, t)
        assert _eval_ffmpeg_axis(xExpr, t) == pytest.approx(px * 2, abs=0.01)
        assert _eval_ffmpeg_axis(yExpr, t) == pytest.approx(py * 2, abs=0.01)


def test_getCropPathFilter_zoom_snapshot(snapshot: str) -> None:
    cropFilter, maxSize = ffmpeg_filter.getCropPathFilter(ZOOM_CROP_PATH, SETTINGS_1X, 30)
    assert "zoompan=z='" in cropFilter
    assert "1920/(" in cropFilter  # zoom derived from the eased (containing) width
    assert "scale=w=4*iw" in cropFilter  # 4x prescale to reduce zoompan jitter
    assert "^2" in cropFilter  # quadratic terms present (zero coeff here, token still emitted)
    assert "gte(t, " in cropFilter  # the containing pan crop runs on the output timebase t
    assert "gte(it, " in cropFilter  # the zoompan runs on the input timebase it
    assert ":s=1920x1080:" in cropFilter
    assert maxSize == 1920 * 1080
    assert cropFilter == snapshot


# Shared with the markup's crop-keyframe-math.test.ts: crop maps with the preview's eased crop at
# sample times, so the render is checked against the exact numbers the preview shows.
CROP_EASING_PARITY = json.loads(
    (Path(__file__).parent / "fixtures" / "crop_easing_parity.json").read_text(encoding="utf-8"),
)


@pytest.mark.parametrize("case", CROP_EASING_PARITY, ids=lambda case: case["name"])
def test_getCropFilter_matches_the_preview_easing(case: dict) -> None:
    cropFilter = ffmpeg_filter.getCropFilter(
        case["cropMap"][0]["crop"],
        case["cropMap"],
        case["fps"],
        easeType=ffmpeg_filter.resolveCropEaseType(case["easing"]),
    )
    xMatch = re.search(r"x=(.+?):y=", cropFilter)
    yMatch = re.search(r":y=(.+?):w=", cropFilter)
    assert xMatch is not None
    assert yMatch is not None
    for sample in case["samples"]:
        assert _eval_ffmpeg_axis(xMatch.group(1), sample["t"]) == pytest.approx(sample["x"], abs=0.01)
        assert _eval_ffmpeg_axis(yMatch.group(1), sample["t"]) == pytest.approx(sample["y"], abs=0.01)


@pytest.mark.parametrize("pairStart", [0, 10.52], ids=["pair start on a frame", "pair start between frames"])
def test_smooth_track_keeps_a_steady_pan_at_the_same_speed_through_crop_points(pairStart: float) -> None:
    # 300 px/s through points placed between frames, as the render's frames fall: the clip is cut at
    # the pair start, so its frames keep the source's frame phase. The markup's
    # crop-keyframe-math.test.ts checks the preview the same way.
    fps = Fraction(30000, 1001)
    times = [0, 1.01, 2.03, 3.04, 4.05]
    cropMap = [{"x": pairStart + t, "y": 0, "crop": f"{300 * t}:0:640:360"} for t in times]
    cropFilter = ffmpeg_filter.getCropFilter(cropMap[0]["crop"], cropMap, fps, easeType="smoothTrack")
    xMatch = re.search(r"x=(.+?):y=", cropFilter)
    assert xMatch is not None
    phase = (pairStart * fps) % 1 / fps
    # The pair's ends start and stop at rest, so check the frames from the second to the fourth point,
    # through the point at 2.03 s.
    frames = [t for k in range(1, int(4.05 * fps)) if 1.01 <= (t := k / fps - phase) <= 3.04]
    xs = [_eval_ffmpeg_axis(xMatch.group(1), float(t)) for t in frames]
    steps = [b - a for a, b in zip(xs, xs[1:])]
    # 300 px/s is 10.01 px per frame; sections that ended a frame early made 5 px steps at points.
    perFrame = float(300 / fps)
    assert max(abs(step - perFrame) for step in steps) < 0.05 * perFrame


@pytest.mark.parametrize(
    ("pairStart", "videoPartStart"),
    [(0, 0), (10.52, 0), (10.52, 0.02)],
    ids=["pair start on a frame", "pair start between frames", "video part start"],
)
def test_instant_crop_point_cuts_on_the_frame_it_falls_in(pairStart: float, videoPartStart: float) -> None:
    # The clip keeps the input video's frame phase, so the cut must snap on the video's frame grid,
    # not on one that starts at the pair start. cinematic_path's cut test checks the same case.
    fps = 30
    pointTime = 1.0033
    cropMap = [
        {"x": pairStart, "y": 0, "crop": "0:0:640:360"},
        {"x": pairStart + pointTime, "y": 0, "crop": "500:0:640:360", "easeIn": "instant"},
        {"x": pairStart + 2, "y": 0, "crop": "500:0:640:360"},
    ]
    cropFilter = ffmpeg_filter.getCropFilter(cropMap[0]["crop"], cropMap, fps, videoPartStart=videoPartStart)
    xMatch = re.search(r"x=(.+?):y=", cropFilter)
    assert xMatch is not None
    clipStart = pairStart - videoPartStart
    pointFrameTime = math.floor((clipStart + pointTime) * fps) / fps - clipStart
    assert _eval_ffmpeg_axis(xMatch.group(1), pointFrameTime - 1 / fps) == pytest.approx(0)
    assert _eval_ffmpeg_axis(xMatch.group(1), pointFrameTime) == pytest.approx(500)
