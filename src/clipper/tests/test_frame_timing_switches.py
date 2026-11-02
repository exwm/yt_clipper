"""The build-time frame timing switches (frame_timing.SWITCHES): each group picks 5.48.0's decisions or
next's, 5.49 is only a whole build, and the default is next."""

from dataclasses import fields, replace

import pytest

from clipper import frame_timing, frame_timing_548, frame_timing_549, frame_timing_next
from clipper.frame_timing import FrameTiming, FrameTimingSwitches
from clipper.tests.conftest import skipsOnBuiltClipper

DECISIONS = {
    "clipFrames": (
        "clipSpan",
        "videoInput",
        "fastTrimInput",
        "speedFilter",
        "audioFilter",
        "varyingRateNote",
        "cropPointOrigin",
    ),
    "cropPoints": ("sectionEaseDuration", "cutTime"),
}
GROUP_BUILDS = [
    FrameTimingSwitches(clipFrames=clipFrames, cropPoints=cropPoints)
    for clipFrames in ("5.48", "next")
    for cropPoints in ("5.48", "next")
]
DECISION_NAMES = [field.name for field in fields(FrameTiming) if field.name != "name"]


def test_every_decision_has_one_group() -> None:
    owned = [decision for group in DECISIONS.values() for decision in group]
    assert sorted(owned) == sorted(DECISION_NAMES)
    assert list(DECISIONS) == [field.name for field in fields(FrameTimingSwitches)]


@pytest.mark.parametrize("build", GROUP_BUILDS, ids=frame_timing.buildName)
def test_each_group_makes_its_decisions_with_its_switchs_release(
    build: FrameTimingSwitches,
) -> None:
    timing = frame_timing.compose(build)
    releases = {"5.48": frame_timing_548.FRAME_TIMING, "next": frame_timing_next.FRAME_TIMING}
    for group, decisions in DECISIONS.items():
        release = releases[getattr(build, group)]
        for decision in decisions:
            if decision == "cropPointOrigin":
                # 5.48.0 had none; both releases seek in the video part's file.
                assert timing.cropPointOrigin is frame_timing.cropOriginOfVideoPart
            else:
                assert getattr(timing, decision) is getattr(release, decision), (group, decision)


def test_the_whole_5_49_build_is_5_49s_own_timing() -> None:
    assert frame_timing.compose(frame_timing.WHOLE_549) is frame_timing_549.FRAME_TIMING


@pytest.mark.parametrize("build", GROUP_BUILDS, ids=frame_timing.buildName)
def test_no_group_build_makes_a_5_49_decision(build: FrameTimingSwitches) -> None:
    only549 = {getattr(frame_timing_549.FRAME_TIMING, name) for name in DECISION_NAMES} - {
        getattr(frame_timing_548.FRAME_TIMING, name) for name in DECISION_NAMES
    }
    timing = frame_timing.compose(build)
    assert not only549 & {getattr(timing, name) for name in DECISION_NAMES}


def test_the_default_build_is_next() -> None:
    assert frame_timing.compose(FrameTimingSwitches()) == frame_timing_next.FRAME_TIMING


@pytest.mark.parametrize(
    ("build", "name"),
    [
        (FrameTimingSwitches(), "next"),
        (frame_timing.ALL_548, "5.48"),
        (frame_timing.WHOLE_549, "5.49"),
        (FrameTimingSwitches(cropPoints="5.48"), "next+cropPoints=5.48"),
        (FrameTimingSwitches(clipFrames="5.48"), "next+clipFrames=5.48"),
    ],
)
def test_a_builds_name_lists_its_groups_not_at_next(build: frame_timing.Build, name: str) -> None:
    assert frame_timing.compose(build).name == name


def test_a_built_clipper_runs_only_the_tests_of_the_decisions_it_makes() -> None:
    nextBuild = frame_timing.compose(FrameTimingSwitches())
    assert not skipsOnBuiltClipper("next", nextBuild)
    assert skipsOnBuiltClipper("5.49", nextBuild)
    # A 5.48 test runs while next decides as 5.48, and is skipped once next replaces a decision.
    assert skipsOnBuiltClipper("5.48", nextBuild)
    as548 = replace(nextBuild, sectionEaseDuration=frame_timing_548.sectionEaseDuration, cutTime=frame_timing_548.cutTime)  # fmt: skip
    assert not skipsOnBuiltClipper("5.48", as548)
