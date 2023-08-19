from clipper import ffmpeg_filter

# crop map with redundant 0 duration points at the beginning, middle, and end
CROP_MAP = cropMap = [
    {
        "x": 7.130523,
        "y": 0,
        "crop": "109:426:540:960"
    },
    {
        "x": 7.130523,
        "y": 0,
        "crop": "109:426:540:960"
    },
    {
        "x": 8.08,
        "y": 0,
        "crop": "109:502:540:960"
    },
    {
        "x": 9.59,
        "y": 0,
        "crop": "163:635:450:800"
    },
    {
        "x": 9.59,
        "y": 0,
        "crop": "163:635:450:800"
    },
    {
        "x": 9.59,
        "y": 0,
        "crop": "80:600:470:860"
    },
    {
        "x": 11.22,
        "y": 0,
        "crop": "42:559:513:912"
    },
    {
        "x": 12.827726,
        "y": 0,
        "crop": "42:507:540:960"
    },
    {
        "x": 12.827726,
        "y": 0,
        "crop": "42:507:540:960"
    }
]


def test_getCropFilter(snapshot):
    cropFilter = ffmpeg_filter.getCropFilter("109:426:540:960", CROP_MAP, 60, easeType="easeOutCubic")
    assert cropFilter == snapshot


def test_getZoomPanFilter(snapshot):
    cropFilter, _scale = ffmpeg_filter.getZoomPanFilter(CROP_MAP, 60, easeType="easeOutCubic")
    assert cropFilter == snapshot
