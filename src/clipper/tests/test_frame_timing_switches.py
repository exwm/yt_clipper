"""The build-time frame timing switches (frame_timing.SWITCHES): each group's decisions come from the one
release its switch picks (5.48.0, 5.49 or next) whatever the other groups are, all at 5.48 is the 5.48.0
build, all at 5.49 is 5.49's, and next decides as 5.48.0 until a fix lands in it."""

import copy
import itertools
from dataclasses import fields, replace
from fractions import Fraction
from pathlib import Path
from typing import get_args

import pytest

from clipper import frame_timing, frame_timing_548, frame_timing_549, frame_timing_next
from clipper.frame_timing import FrameTiming, FrameTimingSwitches, Release
from clipper.tests.test_clip_timeline import pairSettings
from clipper.tests.test_frame_timing_548_source import INPUTS, MARKERS, SPEED_MAPS

RELEASES = {
    "5.48": frame_timing_548.FRAME_TIMING,
    "5.49": frame_timing_549.FRAME_TIMING,
    "next": frame_timing_next.FRAME_TIMING,
}
GROUPS = [field.name for field in fields(FrameTimingSwitches)]
DECISIONS = {
    "clipFrames": ("clipSpan", "videoInput", "speedFilter", "varyingRateNote"),
    "cropPoints": ("sectionEaseDuration", "cutTime"),
    "audioStart": ("audioFilter",),
    "localTimestamps": ("fastTrimInput",),
}


def isValid(switches: FrameTimingSwitches) -> bool:
    """5.49's clip frames seek a local video by its own timestamps, and 5.49's audio start reads the
    clip frames' seek."""
    return (switches.clipFrames != "5.49" or switches.localTimestamps == "5.49") and (
        switches.audioStart != "5.49" or switches.clipFrames == "5.49"
    )


ALL_BUILDS = [
    replace(FrameTimingSwitches(), **dict(zip(GROUPS, releases, strict=True)))
    for releases in itertools.product(get_args(Release), repeat=len(GROUPS))
]
VALID_BUILDS = [build for build in ALL_BUILDS if isValid(build)]
BUILDS = [pytest.param(build, id=frame_timing._name(build)) for build in VALID_BUILDS]
INVALID_BUILDS = [
    pytest.param(build, id=frame_timing._name(build)) for build in ALL_BUILDS if not isValid(build)
]
# (a build, the same build with one group at another release, that group), both valid. Switching
# clipFrames changes every frame, so it has no outputs to keep.
TOGGLES = [
    (build, replace(build, **{group: other}), group)
    for build in VALID_BUILDS
    for group in GROUPS
    for other in get_args(Release)
    if group != "clipFrames"
    and getattr(build, group) < other  # each pair of releases once
    and isValid(replace(build, **{group: other}))
]


def test_every_decision_has_one_group() -> None:
    owned = [decision for group in GROUPS for decision in DECISIONS[group]]
    assert sorted(owned) == sorted(
        field.name for field in fields(FrameTiming) if field.name != "name"
    )


def test_all_at_5_48_is_the_5_48_build_and_all_at_5_49_is_5_49s() -> None:
    assert frame_timing.compose(frame_timing.ALL_548) == frame_timing_548.FRAME_TIMING
    assert frame_timing.compose(frame_timing.ALL_549) == frame_timing_549.FRAME_TIMING


def test_the_default_build_is_next_which_makes_5_48s_decisions_until_a_fix_lands() -> None:
    build = frame_timing.compose(FrameTimingSwitches())
    assert build == frame_timing_next.FRAME_TIMING
    assert build.name == "next"
    for decision in (field.name for field in fields(FrameTiming) if field.name != "name"):
        assert getattr(build, decision) is getattr(frame_timing_548.FRAME_TIMING, decision)


@pytest.mark.parametrize(
    ("switches", "name"),
    [
        (FrameTimingSwitches(), "next"),
        (frame_timing.ALL_548, "5.48"),
        (frame_timing.switchesAt("5.49", ["clipFrames", "localTimestamps"]), "next+clipFrames=5.49+localTimestamps=5.49"),
        (replace(frame_timing.ALL_548, cropPoints="next"), "next+clipFrames=5.48+audioStart=5.48+localTimestamps=5.48"),
        (replace(frame_timing.ALL_549, cropPoints="5.48"), "next+clipFrames=5.49+cropPoints=5.48+audioStart=5.49+localTimestamps=5.49"),
    ],
)  # fmt: skip
def test_a_builds_name_lists_the_groups_not_at_next_and_reads_back(
    switches: FrameTimingSwitches, name: str
) -> None:
    timing = frame_timing.compose(switches)
    assert timing.name == name
    assert frame_timing.byName(name) == timing


@pytest.mark.parametrize("build", BUILDS)
def test_each_group_makes_its_decisions_with_its_own_switchs_release(
    build: FrameTimingSwitches,
) -> None:
    timing = frame_timing.compose(build)
    for group in GROUPS:
        release = RELEASES[getattr(build, group)]
        for decision in DECISIONS[group]:
            assert getattr(timing, decision) is getattr(release, decision), (group, decision)
    assert frame_timing.byName(timing.name) == timing


@pytest.mark.parametrize("build", INVALID_BUILDS)
def test_a_group_whose_5_49_needs_another_is_not_built_without_it(
    build: FrameTimingSwitches,
) -> None:
    with pytest.raises(ValueError, match=r"at 5\.49 too"):
        frame_timing.compose(build)


# Each decision run over the 5.48 source check's case tables, with the inputs clip_maker gives it: the
# build's own clip span. A group off gives 5.48.0's outputs, on gives 5.49's.

CROP_POINTS = [(0.2, 31 / 30), (1.0, 1.0 + 31.5 / 30), (2.0, 2.0 + 0.01), (10.52, 12.0)]


def groupOutputs(
    decide: FrameTiming, group: str, span: frame_timing.ClipSpan, mp: dict, mps: dict, pair: dict
) -> dict[str, object]:
    """The group's decisions made with `decide`'s functions on the same inputs."""
    firstTime = pair["start"]
    calls = {
        "clipSpan": lambda: decide.clipSpan(pair, mps, 0),
        "videoInput": lambda: decide.videoInput(mp, mps, {"preview": False}),
        "fastTrimInput": lambda: decide.fastTrimInput(mp, mps),
        "audioFilter": lambda: decide.audioFilter(mp, mps, mp["duration"]),
        "speedFilter": lambda: decide.speedFilter(
            [{"x": mp["start"], "y": mp["speed"]}, {"x": mp["end"], "y": mp["speed"]}],
            mp,
            mps["r_frame_rate"],
        ),
        "sectionEaseDuration": lambda: [
            decide.sectionEaseDuration(
                ease, firstTime + left, firstTime + right, firstTime, span.cropFrameOrigin, 30.0
            )
            for ease in ("instant", "easeInOutSine", "smoothTrack")
            for left, right in CROP_POINTS
        ],
        "cutTime": lambda: [
            decide.cutTime(
                firstTime + right, firstTime + left, fps, firstTime, span.cropFrameOrigin
            )
            for fps in (30.0, None)
            for left, right in CROP_POINTS
        ],
        "varyingRateNote": lambda: (decide.varyingRateNote(30.0), decide.varyingRateNote(None)),
    }
    return {decision: calls[decision]() for decision in DECISIONS[group]}


@pytest.mark.parametrize("markers", MARKERS)
@pytest.mark.parametrize(("inputMps", "mpFields"), INPUTS)
@pytest.mark.parametrize("speed", [1, 0.5])
def test_each_decision_gives_its_switchs_release_outputs_over_the_case_tables(
    markers: tuple[float, float], inputMps: dict, mpFields: dict, speed: float
) -> None:
    mps = {
        **inputMps,
        "delay": 0.0105,
        "r_frame_rate": "30/1",
        "start_time": 0.023,
        "preview": False,
    }
    pair = {"start": markers[0], "end": markers[1], "speed": speed, **mpFields}
    # Every valid build per case, rather than a test each, keeps the run to a few hundred tests.
    for build in VALID_BUILDS:
        timing = frame_timing.compose(build)
        # clip_maker.getMarkerPairSettings
        span = timing.clipSpan(pair, mps, 0)
        mp = {
            **pair,
            "start": span.start,
            "end": span.end,
            "duration": span.end - span.start,
            "isVariableSpeed": False,
        }
        if span.seekTo is not None:
            mp |= {"seekTo": span.seekTo, "trimEnd": span.trimEnd}
        for group in GROUPS:
            release = RELEASES[getattr(build, group)]
            assert groupOutputs(timing, group, span, mp, mps, pair) == groupOutputs(
                release, group, span, mp, mps, pair
            ), (timing.name, group)


@pytest.mark.parametrize(("speedMap", "isVariableSpeed"), SPEED_MAPS)
def test_the_speed_filter_is_the_clip_frames_release_over_the_speed_maps(
    speedMap: list[dict], isVariableSpeed: bool
) -> None:
    mp = {
        "start": speedMap[0]["x"],
        "end": speedMap[-1]["x"],
        "duration": speedMap[-1]["x"] - speedMap[0]["x"],
        "speed": speedMap[0]["y"],
        "isVariableSpeed": isVariableSpeed,
    }
    rate = Fraction(30000, 1001)
    for build in VALID_BUILDS:
        expected = RELEASES[build.clipFrames].speedFilter(speedMap, mp, rate)
        assert frame_timing.compose(build).speedFilter(speedMap, mp, rate) == expected, build


# Through clip_maker: switching a group changes only what that group decides.

PAIR = {
    "start": 1.0,
    "end": 3.0,
    "speedMap": [{"x": 1.0, "y": 1}, {"x": 2.0, "y": 0.5}, {"x": 3.0, "y": 0.5}],
    "cropMap": [
        {"x": 1.0, "y": 0, "crop": "0:0:960:540"},
        {"x": 2.0, "y": 0, "crop": "960:0:960:540", "easeIn": "instant"},
        {"x": 3.0, "y": 0, "crop": "960:0:960:540"},
    ],
}
LATER_PART = {
    **PAIR,
    "start": 101.0,
    "end": 103.0,
    "speedMap": [{**point, "x": point["x"] + 100} for point in PAIR["speedMap"]],
    "cropMap": [{**point, "x": point["x"] + 100} for point in PAIR["cropMap"]],
}
PAIRS = [
    pytest.param(PAIR, {}, id="url"),
    pytest.param(PAIR, {"inputVideo": "C:/example/in.mkv", "start_time": 0.023}, id="local"),
    pytest.param(PAIR, {"cropPointEasing": "cinematic"}, id="cinematic"),
    pytest.param(
        LATER_PART,
        {
            "videoType": "multi_video",
            "videoParts": [{"start": 0, "end": 100}, {"start": 100.02, "end": 200}],
        },
        id="a later video part",
    ),
]
CLIP_OUTPUTS = (
    "start",
    "end",
    "duration",
    "speedMap",
    "cropMap",
    "speedFilter",
    "outputDuration",
    "outputDurations",
)


def clipOutputs(tmp_path: Path, pair: dict, settings: dict) -> dict:
    mp = pairSettings(tmp_path, copy.deepcopy(pair), **settings)
    return {key: mp[key] for key in (*CLIP_OUTPUTS, "cropFilter")}


@pytest.mark.parametrize(("pair", "settings"), PAIRS)
def test_switching_a_group_changes_only_its_own_decisions_in_a_clips_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, pair: dict, settings: dict
) -> None:
    outputs = {}
    for build in VALID_BUILDS:
        monkeypatch.setattr(frame_timing, "SWITCHES", build)
        outputs[build] = clipOutputs(tmp_path, pair, settings)
    for build, switched, group in TOGGLES:
        # The video input, fast trim and audio filter are made later, at the encode.
        unchanged = CLIP_OUTPUTS if group == "cropPoints" else (*CLIP_OUTPUTS, "cropFilter")
        assert {key: outputs[build][key] for key in unchanged} == {
            key: outputs[switched][key] for key in unchanged
        }, (frame_timing._name(build), frame_timing._name(switched))


# The dependencies between groups.

LOCAL = {
    "inputVideo": "C:/example/in.mkv",
    "videoType": "video",
    "delay": 0,
    "r_frame_rate": "30/1",
    "start_time": 0.023,
    "preview": False,
}


def test_5_49s_audio_start_reads_the_seek_of_5_49s_clip_frames() -> None:
    pair = {"start": 1.0, "end": 2.0, "speed": 1}
    span = frame_timing_548.clipSpan(pair, LOCAL, 0)
    mp = {**pair, "start": span.start, "end": span.end}
    with pytest.raises(KeyError, match="seekTo"):
        frame_timing_549.audioFilter(mp, LOCAL, 1.0)
    with pytest.raises(ValueError, match="audioStart needs clipFrames"):
        frame_timing.compose(frame_timing.switchesAt("5.49", ["audioStart"]))


def test_5_49s_clip_frames_seek_a_local_video_by_its_own_timestamps_as_its_fast_trim_does() -> None:
    pair = {"start": 1.0, "end": 2.0, "speed": 1}
    span = frame_timing_549.clipSpan(pair, LOCAL, 0)
    mp = {
        **pair,
        "start": span.start,
        "end": span.end,
        "seekTo": span.seekTo,
        "trimEnd": span.trimEnd,
    }
    videoInput = frame_timing_549.videoInput(mp, LOCAL, {"preview": False})
    assert videoInput is not None
    assert "-seek_timestamp 1" in videoInput.inputs
    assert "-seek_timestamp 1" not in (frame_timing_548.fastTrimInput(mp, LOCAL) or "")
    assert "-seek_timestamp 1" in (frame_timing_549.fastTrimInput(mp, LOCAL) or "")
    with pytest.raises(ValueError, match="clipFrames needs localTimestamps"):
        frame_timing.compose(frame_timing.switchesAt("5.49", ["clipFrames"]))


@pytest.mark.xfail(
    strict=True,
    reason="crop points take their frame origin from 5.49's clip span, which 5.48's leaves at 0",
)
@pytest.mark.parametrize(
    ("mps", "videoPartDelay"),
    [
        pytest.param(LOCAL, 0, id="a local video starting at 0.023 s"),
        pytest.param(
            {**LOCAL, "inputVideo": "", "videoType": "multi_video"}, 100.02, id="a later video part"
        ),
    ],
)
def test_5_49s_crop_points_alone_count_from_the_videos_first_frame(
    mps: dict, videoPartDelay: float
) -> None:
    pair = {"start": videoPartDelay + 1.0, "end": videoPartDelay + 2.0}
    alone = frame_timing.compose(frame_timing.switchesAt("5.49", ["cropPoints"]))
    assert (
        alone.clipSpan(pair, mps, videoPartDelay).cropFrameOrigin
        == frame_timing_549.clipSpan(pair, mps, videoPartDelay).cropFrameOrigin
    )
