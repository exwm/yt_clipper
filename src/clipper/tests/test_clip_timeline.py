import shutil
import subprocess
from pathlib import Path

import pytest

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
            "videoType": "video",
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


PAIR_MAPS = {
    "speedMap": [{"x": 0.0, "y": 1}, {"x": 5.0, "y": 0.5}, {"x": 10.0, "y": 0.5}],
    "cropMap": [
        {"x": 0.0, "y": 0, "crop": "0:0:960:540"},
        {"x": 5.0, "y": 0, "crop": "960:0:960:540", "easeIn": "instant"},
        {"x": 10.0, "y": 0, "crop": "960:0:960:540"},
    ],
}


RAMP_TO_THE_END = {**PAIR_MAPS, "speedMap": [{"x": 0.0, "y": 1}, {"x": 5.0, "y": 1}, {"x": 10.0, "y": 0.5}]}


@pytest.mark.parametrize(
    ("window", "maps", "speedMap"),
    [
        pytest.param((6.0, 8.0), PAIR_MAPS, [(6.0, 0.5), (8 + 1 / 30, 0.5)], id="a window inside the pair"),
        pytest.param((0.0, 2.0), PAIR_MAPS, [(0.0, 1), (2 + 1 / 30, 0.8)], id="a window at the pair's start"),
        pytest.param((4.0, 6.0), PAIR_MAPS, [(4.0, 0.6), (5.0, 0.5), (6 + 1 / 30, 0.5)], id="a window across a point"),
        pytest.param((5.0, 7.0), PAIR_MAPS, [(5.0, 0.5), (7 + 1 / 30, 0.5)], id="a window starting on a point"),
        # The pair's last section reaches its speed at the last frame's start, 10 s.
        pytest.param((6.0, 8.0), RAMP_TO_THE_END, [(6.0, 0.9), (8 + 1 / 30, 0.7)], id="a window in a last section ramp"),
        # A chart point on the 0.01 s grid can leave a map end a few ms off its marker.
        pytest.param(
            (0.0, 10.0),
            {**PAIR_MAPS, "speedMap": [{"x": 0.0, "y": 1}, {"x": 5.0, "y": 0.5}, {"x": 9.995, "y": 0.5}]},
            [(0.0, 1), (5.0, 0.5), (10 + 1 / 30, 0.5)],
            id="the whole pair, a map end 5 ms off",
        ),
        pytest.param(
            (0.0, 10.0),
            {**PAIR_MAPS, "speedMap": [{"x": 0.0, "y": 1}, {"x": 10.01, "y": 0.5}, {"x": 10.02, "y": 0.5}]},
            [(0.0, 1), (10.01, 0.5), (10 + 1 / 30, 0.5)],
            id="the whole pair, a speed point inside its last frame",
        ),
    ],
)
def test_a_sample_guided_window_plays_its_own_part_of_its_pairs_maps(
    tmp_path: Path, window: tuple, maps: dict, speedMap: list
) -> None:
    start, end = window
    mp = pairSettings(tmp_path, {"start": start, "end": end, "pairStart": 0.0, "pairEnd": 10.0, **maps})
    assert (mp["start"], mp["end"]) == pytest.approx((start, end + 1 / 30))
    assert [(point["x"], point["y"]) for point in mp["speedMap"]] == pytest.approx(speedMap)
    # The crop map stays the pair's, read from the window's start.
    assert [point["x"] for point in mp["cropMap"]] == pytest.approx([0.0, 5.0, 10 + 0.5 / 30])
    assert mp["cropMapTimeOffset"] == pytest.approx(start)


def test_a_sample_guided_window_lasts_as_long_as_its_frames_play(tmp_path: Path) -> None:
    mp = pairSettings(tmp_path, {"start": 6.0, "end": 8.0, "pairStart": 0.0, "pairEnd": 10.0, **PAIR_MAPS})
    # 61 frames at 0.5x, the last one held for a frame as a pair's is.
    assert mp["outputDuration"] == pytest.approx(60 / 30 / 0.5 + 1 / 30)
    # The pair's average speed sets the window's GOP length, as in the pair's own encode.
    assert mp["averageSpeed"] == pytest.approx((5 * 0.75 + (5 + 1 / 30) * 0.5) / (10 + 1 / 30))


def test_a_sample_guided_window_is_clipped_with_its_pairs_own_ends(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from clipper.sample_guided_encode import orchestrator
    from clipper.sample_guided_encode.types import SampleWindow

    clipped: list[dict] = []

    def makeClip(cs: ClipperState, markerPairIndex: int, **_options: object) -> dict:
        clipped.append(dict(cs.settings["markerPairs"][markerPairIndex]))
        filePath = tmp_path / f"window-{len(clipped)}.webm"
        filePath.touch()
        return {"filePath": str(filePath)}

    monkeypatch.setattr(clip_maker, "makeClip", makeClip)
    pair = {"start": 0.0, "end": 10.0, "overrides": {}, **PAIR_MAPS}
    cs = ClipperState(settings={"markerPairs": [dict(pair)]}, clipper_paths=ClipperPaths(clipsPath=str(tmp_path)))
    orchestrator._encode_windows_for_marker_pair(
        cs=cs,
        markerPairIndex=0,
        originalMarkerSnapshot=pair,
        windows=[SampleWindow(start=2.0, end=3.0), SampleWindow(start=6.0, end=8.0)],
        settings_overrides={},
        suffix_template="-w{window_index}",
        label="trial",
        output_dir=tmp_path,
    )
    assert [(mp["start"], mp["end"], mp["pairStart"], mp["pairEnd"]) for mp in clipped] == [
        (2.0, 3.0, 0.0, 10.0),
        (6.0, 8.0, 0.0, 10.0),
    ]


ZOOM_TO_THE_RIGHT = {
    **PAIR_MAPS,
    "cropMap": [
        {"x": 0.0, "y": 0, "crop": "0:0:1920:1080"},
        {"x": 5.0, "y": 0, "crop": "960:0:960:540", "easeIn": "instant"},
        {"x": 10.0, "y": 0, "crop": "960:0:960:540"},
    ],
}


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg on PATH")
@pytest.mark.parametrize(
    ("window", "maps", "firstRightFrame"),
    [
        pytest.param((6.0, 8.0), PAIR_MAPS, 0, id="pan, a window after the cut"),
        pytest.param((4.0, 6.0), PAIR_MAPS, 30, id="pan, a window across the cut"),
        pytest.param((6.0, 8.0), ZOOM_TO_THE_RIGHT, 0, id="zoom, a window after the cut"),
        pytest.param((4.0, 6.0), ZOOM_TO_THE_RIGHT, 30, id="zoom, a window across the cut"),
    ],
)
def test_a_sample_guided_window_crops_its_own_frames(
    tmp_path: Path, window: tuple, maps: dict, firstRightFrame: int
) -> None:
    start, end = window
    pair = {"start": start, "end": end, "pairStart": 0.0, "pairEnd": 10.0, "crop": maps["cropMap"][0]["crop"]}
    mp = pairSettings(tmp_path, {**pair, **maps})
    # The crop before the cut at 5 s shows black (the left half, or the frame's mean); after it, white.
    source = "color=c=black:s=1920x1080:r=30:d=3,drawbox=x=960:y=0:w=960:h=1080:color=white:t=fill"
    chain = f"{source},setpts=PTS-STARTPTS,trim=0:{mp['trimEnd']},{clip_maker.cropFilterOnPairTime(mp)}"
    frames = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"{chain},scale=4:2,format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
        check=True,
    ).stdout
    isRight = [min(frames[i : i + 8]) > 200 for i in range(0, len(frames), 8)]
    assert len(isRight) >= 60
    assert isRight == [frame >= firstRightFrame for frame in range(len(isRight))]


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
