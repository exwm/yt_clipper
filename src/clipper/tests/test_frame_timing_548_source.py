"""frame_timing_548 against v5.48.0's own code: the functions and statements it ports, loaded from the tag
with `git show` and run on the same cases. Skipped where the tag is missing (CI's shallow clone)."""

import ast
import subprocess
from fractions import Fraction
from functools import cache
from math import floor, log
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import pytest

from clipper import frame_timing_548
from clipper.clipper_types import DictStrAny, ExtendedRealNumber, SpeedMap

REPO = Path(__file__).resolve().parents[3]
TAG = "v5.48.0"


@cache
def taggedText(path: str) -> Optional[str]:
    try:
        return subprocess.run(
            ["git", "show", f"{TAG}:{path}"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def taggedSource(path: str) -> ast.Module:
    text = taggedText(path)
    if text is None:
        pytest.skip(f"{TAG} is not in this checkout")
    return ast.parse(text)


def function(module: ast.Module, name: str) -> ast.FunctionDef:
    return next(
        node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == name
    )


NAMESPACE: dict[str, Any] = {
    "Fraction": Fraction, "floor": floor, "log": log, "Any": Any, "Dict": Dict, "List": List, "Optional": Optional,
    "Tuple": Tuple, "Union": Union, "DictStrAny": DictStrAny, "ExtendedRealNumber": ExtendedRealNumber,
    "SpeedMap": SpeedMap,
}  # fmt: skip


def taggedFunctions(path: str, *names: str) -> dict[str, Callable[..., Any]]:
    module = taggedSource(path)
    namespace = dict(NAMESPACE)
    code = ast.Module(body=[function(module, name) for name in names], type_ignores=[])
    exec(compile(code, f"{TAG}:{path}", "exec"), namespace)  # the tag's own code
    return {name: namespace[name] for name in names}


def taggedStatements(
    path: str, functionName: str, picks: Callable[[str], bool], params: list[str], returns: str
) -> Callable[..., Any]:
    """A function of `params` running the statements of v5.48.0's `functionName` whose source `picks`
    selects, in order, and returning `returns`."""
    module = taggedSource(path)
    source = taggedText(path) or ""
    body = [
        node
        for node in function(module, functionName).body
        if picks(ast.get_source_segment(source, node) or "")
    ]
    assert body, f"no statements picked from {functionName}"
    wrapper = ast.parse(
        f"def picked({', '.join(params)}):\n    inputs = ''\n    video_filter = ''\n    audio_filter = ''\n    return {returns}"
    )
    func = wrapper.body[0]
    assert isinstance(func, ast.FunctionDef)
    func.body[3:3] = body
    namespace: dict[str, Any] = {"logger": None, "LogPath": str}
    exec(compile(ast.fix_missing_locations(wrapper), f"{TAG}:{path}", "exec"), namespace)
    return namespace["picked"]


CLIP_MAKER = "src/clipper/clip_maker.py"
FFMPEG_FILTER = "src/clipper/ffmpeg_filter.py"

MARKERS = [
    (1.033333, 1.633333),
    (1.033334, 1.633334),
    (0.5 / 30, 10.0),
    (0, 1),
    (1234.567123, 1234.967123),
    (31 / 30, 52 / 30),
]
INPUTS = [
    pytest.param({"inputVideo": "C:/example/in.mkv", "videoType": "video"}, {}, id="local"),
    pytest.param({"inputVideo": "", "videoType": "video", "videoDownloadURL": "https://example.com/v"}, {}, id="url"),
    pytest.param({"inputVideo": "", "videoType": "multi_video"}, {"videoPart": {"url": "https://example.com/p2"}}, id="video part"),
]  # fmt: skip


def pairOf(start: float, end: float, speed: float = 1, **fields: object) -> DictStrAny:
    return {"start": start, "end": end, "duration": end - start, "speed": speed, **fields}


@pytest.mark.parametrize("markers", MARKERS)
@pytest.mark.parametrize("delay", [0, 0.0105])
def test_the_clip_runs_from_the_markers_as_5_48_0_took_them(
    markers: tuple[float, float], delay: float
) -> None:
    oracle = taggedStatements(CLIP_MAKER, "getMarkerPairSettings", lambda s: s.startswith(('mp["start"] =', 'mp["end"] =')),
                              ["mp", "mps", "videoPartDelay"], '(mp["start"], mp["end"])')  # fmt: skip
    start, end = markers
    for videoPartDelay in (0, 100):
        span = frame_timing_548.clipSpan(
            {"start": start, "end": end}, {"delay": delay}, videoPartDelay
        )
        assert (span.start, span.end) == oracle(
            {"start": start, "end": end}, {"delay": delay}, videoPartDelay
        )


@pytest.mark.parametrize("markers", MARKERS)
@pytest.mark.parametrize(("mps", "mpFields"), INPUTS)
@pytest.mark.parametrize("preview", [False, True])
def test_the_video_input_and_trim_are_5_48_0s(
    markers: tuple[float, float], mps: DictStrAny, mpFields: DictStrAny, preview: bool
) -> None:
    oracle = taggedStatements(CLIP_MAKER, "makeClip", lambda s: ' -ss {mp["start"]} -i' in s or "trim=0:{mp['duration']}" in s,
                              ["mp", "mps", "settings"], "(inputs, video_filter)")  # fmt: skip
    mp, mpsAll = pairOf(*markers, **mpFields), {**mps, "preview": preview}
    videoInput = frame_timing_548.videoInput(mp, mpsAll, {"preview": preview})
    assert videoInput is not None
    assert (videoInput.inputs, videoInput.trim) == oracle(mp, mpsAll, {"preview": preview})


@pytest.mark.parametrize("markers", MARKERS)
@pytest.mark.parametrize(("mps", "mpFields"), INPUTS)
def test_the_fast_trim_input_is_5_48_0s(
    markers: tuple[float, float], mps: DictStrAny, mpFields: DictStrAny
) -> None:
    oracle = taggedStatements(CLIP_MAKER, "fastTrimClip", lambda s: s.startswith(("videoStart =", "videoEnd =")) or "-to {videoEnd}" in s,
                              ["mp", "mps"], "inputs")  # fmt: skip
    mp = pairOf(*markers, **mpFields)
    assert frame_timing_548.fastTrimInput(mp, mps) == oracle(mp, mps)


@pytest.mark.parametrize("speed", [1, 0.5, 2])
def test_the_audio_filter_is_5_48_0s(speed: float) -> None:
    taggedSource(CLIP_MAKER)
    # The statement sits deep in the audio branch, so it is read as a line.
    source = taggedText(CLIP_MAKER) or ""
    statement = next(
        line.strip() for line in source.splitlines() if "atrim=0:{aDuration},atempo=" in line
    )
    assert statement == "audio_filter += f\"atrim=0:{aDuration},atempo={mp['speed']}\""
    namespace = {"mp": {"speed": speed}, "aDuration": 0.6, "audio_filter": ""}
    exec(statement, namespace)
    assert frame_timing_548.audioFilter({"speed": speed}, {}, 0.6) == namespace["audio_filter"]


SPEED_MAPS = [
    pytest.param([{"x": 1.0, "y": 1}, {"x": 2.0, "y": 1}], False, id="constant"),
    pytest.param([{"x": 1.016667, "y": 1}, {"x": 1.3, "y": 0.5}, {"x": 1.6, "y": 0.5}, {"x": 1.616667, "y": 1}], True, id="variable, ends mid-frame"),
    pytest.param([{"x": 1.0, "y": 0.3}, {"x": 1.5, "y": 1.1}, {"x": 2.0, "y": 1.1}], True, id="ramp, end on a frame start"),
    pytest.param([{"x": 75.199153, "y": 0.3}, {"x": 75.49, "y": 0.3}, {"x": 75.75, "y": 1.1}, {"x": 76.960404, "y": 1}], True, id="the test markers' map"),
]  # fmt: skip


@pytest.mark.parametrize(("speedMap", "isVariableSpeed"), SPEED_MAPS)
@pytest.mark.parametrize("fps", [30, "30000/1001", 24, 60])
def test_the_speed_filter_is_5_48_0s(
    speedMap: list[DictStrAny], isVariableSpeed: bool, fps: Union[int, str]
) -> None:
    oracle = taggedFunctions(FFMPEG_FILTER, "getSpeedFilterAndDuration")[
        "getSpeedFilterAndDuration"
    ]
    mp = pairOf(
        speedMap[0]["x"], speedMap[-1]["x"], speed=speedMap[0]["y"], isVariableSpeed=isVariableSpeed
    )
    rate = Fraction(fps) if isinstance(fps, str) else fps
    assert frame_timing_548.getSpeedFilterAndDuration(speedMap, mp, rate) == oracle(
        speedMap, mp, rate
    )


@pytest.mark.parametrize("firstTime", [0, 1.033333, 2.0, 10.52])
@pytest.mark.parametrize(
    "pointTime", [31 / 30, round(31 / 30, 6), 31 / 30 - 0.0005, 31.5 / 30, 0.01, 1.5]
)
@pytest.mark.parametrize("fps", [30.0, 30000 / 1001, 24.0])
def test_a_crop_section_eases_over_5_48_0s_span(
    firstTime: float, pointTime: float, fps: float
) -> None:
    oracle = taggedFunctions(
        FFMPEG_FILTER, "getFrameTimeBetweenLeftFrames", "getEaseSectionDuration"
    )
    left, right = firstTime + 0.2, firstTime + pointTime
    # v5.48.0 getCropFilter and getZoomPanFilter pass times from the crop map's first point.
    expected = oracle["getEaseSectionDuration"](left - firstTime, right - firstTime, fps)
    assert (
        frame_timing_548.sectionEaseDuration("instant", left, right, firstTime, 0.0, fps)
        == expected
    )
    assert (
        frame_timing_548.sectionEaseDuration("easeInOutSine", left, right, firstTime, 5.0, fps)
        == expected
    )
