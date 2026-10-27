from pathlib import Path

from clipper import clip_maker
from clipper.argparser import getArgParser
from clipper.clipper_types import ClipperPaths, ClipperState


def pairSettings(tmp_path: Path, pair: dict, **settings: object) -> dict:
    """The marker pair as the clipper prepares it for ffmpeg, from the command line's defaults."""
    defaults = vars(getArgParser().parse_args(["--markers-json", "markers.json"]))
    cs = ClipperState(
        settings={
            **{key: value for key, value in defaults.items() if value is not None},
            "markerPairs": [{"overrides": {}, "speed": 1, "crop": "0:0:1920:1080", **pair}],
            "titleSuffix": "video",
            "inputVideo": "",
            "overwrite": True,
            "delay": 0,
            "audioDelay": 0,
            "enableSpeedMaps": True,
            "enableCropMaps": True,
            "r_frame_rate": "30/1",
            "avg_frame_rate": "30/1",
            "bit_rate": 4000,
            "inputIsHDR": False,
            "inputBitDepth": 8,
            "width": 1920,
            "height": 1080,
            "cropRes": "1920x1080",
            "cropResWidth": 1920,
            "cropResHeight": 1080,
            "cropMultipleX": 1,
            "cropMultipleY": 1,
            **settings,
        },
        clipper_paths=ClipperPaths(clipsPath=str(tmp_path)),
    )
    mp, _ = clip_maker.getMarkerPairSettings(cs, 0, enableLogging=False)
    return mp


def test_a_pair_in_a_later_video_part_keeps_its_maps_on_one_timeline(tmp_path: Path) -> None:
    mp = pairSettings(
        tmp_path,
        {
            "start": 110.0,
            "end": 120.0,
            "speedMap": [{"x": 110.0, "y": 1}, {"x": 115.0, "y": 0.5}, {"x": 120.0, "y": 0.5}],
            "cropMap": [
                {"x": 110.0, "y": 0, "crop": "0:0:960:540"},
                {"x": 115.0, "y": 0, "crop": "960:0:960:540", "easeIn": "instant"},
                {"x": 120.0, "y": 0, "crop": "960:0:960:540"},
            ],
        },
        videoType="multi_video",
        videoParts=[{"start": 0, "end": 100}, {"start": 100, "end": 200}],
    )
    # The clip's own times are the part's (it starts 10 s in); its maps keep the video's.
    assert (mp["start"], mp["end"]) == (10.0, 20 + 1 / 30)
    assert [point["x"] for point in mp["speedMap"]] == [110.0, 115.0, 120 + 1 / 30]
    assert [point["x"] for point in mp["cropMap"]] == [110.0, 115.0, 120 + 0.5 / 30]
