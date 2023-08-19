import pytest

from clipper import ffmpeg_filter

SMALL_CROP_MAP = [
    {"x": 7.130523, "y": 0, "crop": "109:426:540:960"},
    {"x": 12.827726, "y": 0, "crop": "42:507:540:960"},
]

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


def test_getCropFilter(snapshot):
    cropFilter = ffmpeg_filter.getCropFilter(
        "109:426:540:960", LARGE_REDUNDANT_CROP_MAP, 60, easeType="easeOutCubic"
    )
    assert cropFilter == snapshot


def test_getZoomPanFilter(snapshot):
    cropFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(
        LARGE_REDUNDANT_CROP_MAP, 60, easeType="easeOutCubic"
    )
    assert cropFilter == snapshot


@pytest.mark.parametrize(
    "cropMap",
    [SMALL_CROP_MAP, MEDIUM_CROP_MAP],
)
def test_small_getCropFilter(cropMap):
    cropFilterOld = ffmpeg_filter.getCropFilterOld(
        "109:426:540:960", cropMap, 60, easeType="linear"
    )
    cropFilter = ffmpeg_filter.getCropFilter("109:426:540:960", cropMap, 60, easeType="linear")

    cropFilterOld = cropFilterOld.split(":")
    cropFilter = cropFilter.split(":")

    assert len(cropFilterOld) == len(cropFilter)
    for exprOld, expr in zip(cropFilterOld, cropFilter):
        assert exprOld == expr


@pytest.mark.parametrize(
    "cropMap",
    [SMALL_CROP_MAP, MEDIUM_CROP_MAP],
)
def test_small_getZoomPanFilter(cropMap):
    cropFilterOld, _maxSize = ffmpeg_filter.getZoomPanFilterOld(cropMap, 60, easeType="linear")
    cropFilterOld = cropFilterOld.split(":")
    cropFilter, _maxSize = ffmpeg_filter.getZoomPanFilter(cropMap, 60, easeType="linear")
    cropFilter = cropFilter.split(":")
    assert len(cropFilterOld) == len(cropFilter)
    for exprOld, expr in zip(cropFilterOld, cropFilter):
        assert exprOld == expr
