import re
from fractions import Fraction
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


def test_getZoomPanFilter(snapshot: str) -> None:
    ffmpegFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        LARGE_REDUNDANT_CROP_MAP,
        60,
        easeType="easeOutCubic",
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
        # Genuinely zero-duration section: skipped.
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
