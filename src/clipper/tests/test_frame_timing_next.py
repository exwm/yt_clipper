"""next against 5.48: every decision next hasn't replaced (`NEXT_REPLACED`) gives the 5.48 group's outputs,
each on identical inputs and over whole clips through clip_maker to the assembled ffmpeg command."""

import copy
import itertools
import sys
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any

import pytest

from clipper import (
    argparser,
    clip_maker,
    frame_timing,
    frame_timing_549,
    ytc_settings,
)
from clipper.clipper_types import ClipperPaths, ClipperState
from clipper.frame_timing import FrameTiming, FrameTimingSwitches
from clipper.frame_timing_next import FRAME_TIMING as NEXT
from clipper.frame_timing_next import NEXT_REPLACED

OLD = frame_timing.compose(frame_timing.ALL_548)
DECISION_NAMES = [field.name for field in fields(FrameTiming) if field.name != "name"]
PART_START = 100.02
URL = "https://example.com/v"


@dataclass(frozen=True)
class Source:
    mps: dict[str, Any]
    mpFields: dict[str, Any]
    videoPartDelay: float


SOURCES = {
    "local video starting at 0.023 s": Source(
        {"inputVideo": "C:/example/in.mkv", "videoType": "video", "start_time": 0.023}, {}, 0
    ),
    "url": Source({"inputVideo": "", "videoType": "video", "videoDownloadURL": URL}, {}, 0),
    "later video part": Source(
        {"inputVideo": "", "videoType": "multi_video"},
        {"videoPart": {"url": URL, "start": PART_START}},
        PART_START,
    ),
}


@dataclass(frozen=True)
class Case:
    source: str
    preview: bool
    delay: float
    window: bool
    speed: float
    # The crop map's instant point is a cut, which Cinematic places with the build's cutTime.
    cropPointEasing: str = "smoothInOut"

    def pair(self) -> dict[str, Any]:
        offset = SOURCES[self.source].videoPartDelay
        start, end = offset + 1.033334, offset + 2.633334
        pair: dict[str, Any] = {"start": start, "end": end, "speed": self.speed}
        if self.window:
            pair |= {"start": offset + 1.5, "end": offset + 2.2, "pairStart": start, "pairEnd": end}
        return pair


CASES = [
    pytest.param(Case(*values), id="-".join(map(str, values)))
    for values in itertools.product(SOURCES, [False, True], [0.0, 0.0105], [False, True], [1, 0.5])
] + [
    pytest.param(Case(source, False, 0.0105, False, 1, "cinematic"), id=f"{source}-cinematic")
    for source in SOURCES
]
CROP_SECTIONS = [(0.2, 31 / 30), (1.0, 1.0 + 31.5 / 30), (0.0, 0.01), (0.5, 1.6)]
CROP_ORIGIN = 7.3


def decisionOutputs(decide: FrameTiming, case: Case) -> dict[str, object]:
    """Each decision made with `decide`'s function, on inputs from the 5.48 group's clip span."""
    source = SOURCES[case.source]
    mps = {**source.mps, "delay": case.delay, "r_frame_rate": "30/1", "preview": case.preview}
    pair = {**case.pair(), **source.mpFields}
    span = OLD.clipSpan(pair, mps, source.videoPartDelay)
    mp = {**pair, "start": span.start, "end": span.end, "duration": span.end - span.start}
    start, end = mp["start"], mp["end"]
    constant = {**mp, "isVariableSpeed": False}
    variable = {**mp, "isVariableSpeed": True}
    speedMap = [{"x": start, "y": case.speed}, {"x": start + 0.5, "y": 0.3}, {"x": end, "y": 0.3}]
    first = pair["start"]
    return {
        "clipSpan": decide.clipSpan(pair, mps, source.videoPartDelay),
        "videoInput": decide.videoInput(mp, mps, {"preview": case.preview, "inputStartTime": 0.023}),
        "fastTrimInput": decide.fastTrimInput(mp, mps),
        "audioFilter": decide.audioFilter(mp, mps, mp["duration"]),
        "speedFilter": (
            decide.speedFilter([{"x": start, "y": case.speed}, {"x": end, "y": case.speed}], constant, 30),
            decide.speedFilter(speedMap, variable, 30),
        ),
        "varyingRateNote": (decide.varyingRateNote(30.0), decide.varyingRateNote(None)),
        "sectionEaseDuration": [
            decide.sectionEaseDuration(ease, first + left, first + right, first, CROP_ORIGIN, 30.0)
            for ease in ("instant", "easeInOutSine", "smoothTrack")
            for left, right in CROP_SECTIONS
        ],
        "cutTime": [
            decide.cutTime(first + right, first + left, fps, first, CROP_ORIGIN)
            for fps in (30.0, None)
            for left, right in CROP_SECTIONS
        ],
        "cropPointOrigin": decide.cropPointOrigin(span, mps, source.videoPartDelay),
    }  # fmt: skip


def unlistedDifferences(new: dict[str, object], old: dict[str, object]) -> list[str]:
    return sorted(name for name in new if new[name] != old[name] and name not in NEXT_REPLACED)


def test_the_tables_cover_every_decision_and_next_replaces_only_decisions() -> None:
    assert sorted(decisionOutputs(NEXT, Case("url", False, 0.0, False, 1))) == sorted(
        DECISION_NAMES
    )
    assert set(DECISION_NAMES) >= NEXT_REPLACED


@pytest.mark.parametrize("case", CASES)
def test_each_decision_next_keeps_gives_5_48s_outputs(case: Case) -> None:
    differing = unlistedDifferences(decisionOutputs(NEXT, case), decisionOutputs(OLD, case))
    assert not differing, f"{differing} differ from 5.48 but are not in NEXT_REPLACED"


# Whole clips: getMarkerPairSettings and the command clip_maker assembles for ffmpeg or ffplay.

CROP_MAP = [
    {"x": 0.0, "y": 0, "crop": "0:0:960:540"},
    {"x": 0.8, "y": 0, "crop": "960:0:960:540", "easeIn": "instant"},
    {"x": 1.6, "y": 0, "crop": "960:540:960:540"},
]
CLIP_OUTPUTS = ("start", "end", "duration", "speedMap", "cropMap", "speedFilter", "outputDuration", "outputDurations", "cropFilter")  # fmt: skip


def clipOf(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    build: frame_timing.Build,
    case: Case,
    **settings: object,
) -> dict[str, object]:
    """The clip's settings and the commands clip_maker hands to ffmpeg or ffplay, with `build`."""
    source = SOURCES[case.source]
    pair = case.pair()
    first = pair.get("pairStart", pair["start"])
    last = pair.get("pairEnd", pair["end"])
    pair["cropMap"] = [{**point, "x": first + point["x"]} for point in CROP_MAP[:-1]] + [
        {**CROP_MAP[-1], "x": last}
    ]
    if case.speed != 1:
        pair["speedMap"] = [
            {"x": first, "y": 1},
            {"x": first + 0.5, "y": case.speed},
            {"x": last, "y": case.speed},
        ]
    sourceSettings = {"videoDownloadURL": URL, "start_time": 0, **source.mps}
    if source.videoPartDelay:
        sourceSettings["videoParts"] = [{"start": 0, "end": PART_START, "url": URL}, {"start": PART_START, "end": 200, "url": URL}]  # fmt: skip
    # The command line's defaults as the clipper reads them, so settings added later come along.
    monkeypatch.setattr(sys, "argv", ["yt_clipper", "--markers-json", "markers.json"])
    monkeypatch.setattr(argparser, "defaultArgFiles", list)
    defaults, *_ = argparser.getArgs()
    cs = ClipperState(
        settings={
            **defaults,
            # What the markers JSON gives.
            "markerPairs": [
                {"overrides": {}, "speed": 1, "crop": "0:0:1920:1080", **copy.deepcopy(pair)}
            ],
            "titleSuffix": "video",
            "videoTitle": "video",
            "videoPageURL": URL,
            "markerPairMergeList": "",
            "platform": "youtube",
            "cropRes": "1920x1080",
            "cropResWidth": 1920,
            "cropResHeight": 1080,
            "enableSpeedMaps": True,
            "cropPointEasing": case.cropPointEasing,
            # What ffprobe and yt-dlp give.
            "audioDownloadURL": URL,
            "r_frame_rate": "30/1",
            "avg_frame_rate": "30/1",
            "bit_rate": 4000,
            "color_space": "bt709",
            "inputIsHDR": False,
            "inputBitDepth": 8,
            "width": 1920,
            "height": 1080,
            "cropMultipleX": 1,
            "cropMultipleY": 1,
            **sourceSettings,
            "overwrite": True,
            "audio": True,
            "preview": case.preview,
            "delay": case.delay,
            **settings,
        },
        clipper_paths=ClipperPaths(clipsPath=str(tmp_path)),
    )
    # The rest of the clipper's own set-up, with the probes above standing in for ffprobe.
    monkeypatch.setattr(ytc_settings, "getVideoInfo", lambda _cs: None)
    monkeypatch.setattr(ytc_settings, "getMoreVideoInfo", lambda _cs, *_info: None)
    ytc_settings.getGlobalSettings(cs)
    commands: list[object] = []
    monkeypatch.setattr(clip_maker, "runffmpegCommand", lambda _settings, ffmpegCommands, *_a, **_k: commands.append(ffmpegCommands) or {})  # fmt: skip
    monkeypatch.setattr(clip_maker, "runffplayCommand", lambda _cs, *args: commands.append(args[:4]))  # fmt: skip
    monkeypatch.setattr(frame_timing, "SWITCHES", build)
    clip_maker.makeClip(cs, 0)
    mp = cs.settings["markerPairs"][0]
    return {**{key: mp.get(key) for key in CLIP_OUTPUTS}, "commands": commands}


@pytest.mark.parametrize("case", CASES)
def test_a_clip_made_with_next_is_5_48s_but_for_its_crop_filter(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, case: Case
) -> None:
    # Next's crop points (sectionEaseDuration, cutTime) change only the crop filter.
    old = clipOf(tmp_path, monkeypatch, frame_timing.ALL_548, case)
    new = clipOf(tmp_path, monkeypatch, FrameTimingSwitches(), case)
    assert new["commands"]
    assert withoutCropFilter(new) == withoutCropFilter(old)
    assert new["commands"] == replaced(
        old["commands"], str(old["cropFilter"]), str(new["cropFilter"])
    )


def withoutCropFilter(clip: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in clip.items() if key not in ("cropFilter", "commands")}


def replaced(value: object, old: str, new: str) -> object:
    """`value` with `old` replaced by `new` in every string it holds."""
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list | tuple):
        return type(value)(replaced(item, old, new) for item in value)
    return value


@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("window", [False, True])
def test_a_fast_trim_made_with_next_is_5_48s(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, source: str, window: bool
) -> None:
    case = Case(source, False, 0.0105, window, 1)
    old = clipOf(tmp_path, monkeypatch, frame_timing.ALL_548, case, fastTrim=True, ext="mp4")
    new = clipOf(tmp_path, monkeypatch, FrameTimingSwitches(), case, fastTrim=True, ext="mp4")
    assert new["commands"]
    # A fast trim copies frames without a crop filter.
    assert withoutCropFilter(new) == withoutCropFilter(old)
    assert new["commands"] == old["commands"]


@pytest.mark.parametrize(
    "build",
    [
        *(FrameTimingSwitches(clipFrames=clip, cropPoints=crop) for clip in ("5.48", "next") for crop in ("5.48", "next")),
        frame_timing.WHOLE_549,
    ],
    ids=frame_timing.buildName,
)  # fmt: skip
@pytest.mark.parametrize("source", SOURCES)
def test_every_build_makes_a_clip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, build: frame_timing.Build, source: str
) -> None:
    clip = clipOf(tmp_path, monkeypatch, build, Case(source, False, 0.0105, True, 0.5))
    assert clip["commands"]
    assert clip["outputDuration"]


# Where crop points take effect in next: on the frame holding the point, as the preview shows it, on
# the frames the clip's seek gives.

FPS = 30.0
INSIDE = [0.05, 0.3, 0.5, 0.7, 0.95]


def firstFrameFrom(time: float, origin: float = 0.0) -> int:
    """The first frame starting at or after `time`, counting frames from `origin`."""
    frame = round((time - origin) * FPS)
    return frame if frame / FPS >= time - origin - 1e-9 else frame + 1


@pytest.mark.parametrize(("startIn", "pointIn"), itertools.product(INSIDE, INSIDE))
def test_an_instant_point_takes_effect_on_its_own_frame_wherever_the_start_marker_is(
    startIn: float, pointIn: float
) -> None:
    start, point = (60 + startIn) / FPS, round((91 + pointIn) / FPS, 6)
    duration = NEXT.sectionEaseDuration("instant", start, point, start, 0.0, FPS)
    assert duration is not None
    assert firstFrameFrom(start + duration) == 91
    assert firstFrameFrom(NEXT.cutTime(point, start, FPS, start, 0.0)) == 91


def test_a_point_just_below_a_frame_start_takes_effect_on_the_earlier_frame_as_in_the_preview() -> (
    None
):
    # The preview floors a point's time to its frame; 5.49 counted the last millisecond as the next frame.
    start, point = 60.4 / FPS, 91 / FPS - 0.0005
    duration = NEXT.sectionEaseDuration("instant", start, point, start, 0.0, FPS)
    old549 = frame_timing_549.sectionEaseDurationFromVideoPart(
        "instant", start, point, start, 0.0, FPS
    )
    assert duration is not None
    assert old549 is not None
    assert (firstFrameFrom(start + duration), firstFrameFrom(start + old549)) == (90, 91)


@pytest.mark.parametrize("pointIn", INSIDE)
def test_a_crop_point_in_a_later_video_part_takes_effect_on_its_own_frame_of_that_part(
    pointIn: float,
) -> None:
    mps = {"inputVideo": "", "videoType": "multi_video", "delay": 0.0, "r_frame_rate": "30/1"}
    span = NEXT.clipSpan({"start": PART_START + 1.0, "end": PART_START + 4.0}, mps, PART_START)
    origin = NEXT.cropPointOrigin(span, mps, PART_START)
    start, point = PART_START + 1.01, PART_START + (91 + pointIn) / FPS
    duration = NEXT.sectionEaseDuration("instant", start, point, start, origin, FPS)
    assert duration is not None
    assert firstFrameFrom(start + duration, PART_START) == 91


@pytest.mark.parametrize(
    "build", [frame_timing.ALL_548, FrameTimingSwitches()], ids=frame_timing.buildName
)
@pytest.mark.parametrize("delay", [0.0, 0.0105])
def test_crop_points_count_frames_from_the_start_of_the_video_part_the_clip_seeks_in(
    build: frame_timing.Build, delay: float
) -> None:
    # The delay moves the clip's seek and its crop points together, so it doesn't move the frames.
    timing = frame_timing.compose(build)
    mps = {"inputVideo": "", "videoType": "multi_video", "delay": delay, "r_frame_rate": "30/1"}
    for partStart in (0.0, PART_START):
        span = timing.clipSpan({"start": partStart + 1.0, "end": partStart + 2.0}, mps, partStart)
        assert timing.cropPointOrigin(span, mps, partStart) == partStart
