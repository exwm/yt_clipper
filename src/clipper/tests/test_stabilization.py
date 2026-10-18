"""Video stabilization on synthetic shaky clips (shaky_media.py), with the clipper's filters and defaults.

One target for every clip. Clips the stabilization misses it on today are strict xfails, so a change
that fixes one has to say so here.
"""

import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

from clipper.argparser import getArgParser, getVidstabPreset
from clipper.ffmpeg_filter import getVideoStabilizationFilters, videoStabilizationGammaFixFilter
from clipper.tests import shaky_media
from clipper.tests.stabilization_metrics import grayFrames, motionAdded, shakeLeft
from clipper.vidstab_motions import analysisFilter, analysisOutputArgs, repairFlashFramesInFiles

# Shake a stabilized clip may keep, px/frame. The shaky clips start with about 9.6.
TARGET_SHAKE = 1.0
# How far stabilization may move the frames of a steady clip, px
TARGET_STEADY = 0.5
STRONG = 4
SIZE = (shaky_media.WIDTH, shaky_media.HEIGHT)
MISSES = {
    "dim": "the low contrast stretch has too few fields even at mincontrast 0.05",
    "grainy": "grain moves the low contrast fields",
    "occluder": "the object's fields pull the frame's motion along",
    "rotate": "with maxangle=0 the rotation stays, and its fields' turning is read as shift",
    "gradient": "compression banding steps are tracked as motion",
    "tiles": "fields match the wrong tile when the shake is larger than a tile",
}


@pytest.fixture(scope="session")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    filters = subprocess.run(
        [path, "-hide_banner", "-filters"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    if "vidstabdetect" not in filters:
        pytest.skip("needs ffmpeg with libvidstab")
    return path


@pytest.fixture(scope="session")
def shakyMedia(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("shaky-media")


def run(ffmpeg: str, video: Path, folder: Path, vf: str, output: str | None = None) -> Path:
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vf", vf]
    command += ["-c:v", "libx264", "-qp", "0", output] if output else ["-f", "null", "-"]
    subprocess.run(command, check=True, cwd=folder)
    return folder / (output or "")


def clipperFilters(transformPath: str) -> tuple[str, str]:
    """The detect and transform filters the clipper runs with the Strong preset and its defaults."""
    parser = getArgParser()
    defaults = (
        "videoStabilizationMaxAngle",
        "videoStabilizationMaxShift",
        "videoStabilizationDynamicZoom",
    )
    mps = {
        "videoStabilization": getVidstabPreset(STRONG),
        **{key: parser.get_default(key) for key in defaults},
    }
    detectFilter, transformFilter = getVideoStabilizationFilters(mps, transformPath)
    return videoStabilizationGammaFixFilter(detectFilter), videoStabilizationGammaFixFilter(
        transformFilter,
    )


def stabilize(ffmpeg: str, video: Path, folder: Path) -> Path:
    """Both passes, with the analysis output and the flash repair between them, as the clipper runs them."""
    detectFilter, transformFilter = clipperFilters("transforms.trf")
    analysis = shlex.split(analysisOutputArgs(f'-vf "{analysisFilter()}"', "analysis.nut"))
    subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video),
            "-vf",
            detectFilter,
            "-f",
            "null",
            "-",
            *analysis,
        ],
        check=True,
        cwd=folder,
    )
    repairFlashFramesInFiles(ffmpeg, str(folder / "transforms.trf"), str(folder / "analysis.nut"))
    return run(ffmpeg, video, folder, transformFilter, "stabilized.mp4")


def zoomedReference(ffmpeg: str, video: Path, folder: Path) -> Path:
    """The clip zoomed as stabilization zooms it, with no motion: the clipper's transform with the
    motion of a still frame. vid.stab's camera path optimization crops a window whose size depends
    only on the zoom settings, so a path without motion gives the same zoom."""
    frames = shaky_media.FPS * shaky_media.SECONDS
    run(
        ffmpeg,
        video,
        folder,
        f"loop=loop=-1:size=1,trim=end_frame={frames},vidstabdetect=result=still.trf",
    )
    return run(ffmpeg, video, folder, clipperFilters("still.trf")[1], "reference.mp4")


def clipCases(steady: bool) -> list:
    return [
        pytest.param(
            name,
            id=name,
            marks=[pytest.mark.xfail(reason=MISSES[name], strict=True)] if name in MISSES else [],
        )
        for name, clip in shaky_media.CLIPS.items()
        if clip.steady == steady
    ]


@pytest.mark.parametrize("name", clipCases(steady=False))
def test_stabilization_removes_the_shake(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    clip = shaky_media.CLIPS[name]
    top, bottom = clip.scoredRows
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    assert (
        shakeLeft(grayFrames(ffmpeg, source, SIZE)[:, top:bottom], clip.cutFrame) > 8 * TARGET_SHAKE
    )
    output = stabilize(ffmpeg, source, tmp_path)
    assert shakeLeft(grayFrames(ffmpeg, output, SIZE)[:, top:bottom], clip.cutFrame) < TARGET_SHAKE


@pytest.mark.parametrize("name", clipCases(steady=True))
def test_stabilization_leaves_a_steady_shot_alone(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    reference = zoomedReference(ffmpeg, source, tmp_path)
    output = stabilize(ffmpeg, source, tmp_path)
    assert (
        motionAdded(grayFrames(ffmpeg, reference, SIZE), grayFrames(ffmpeg, output, SIZE))
        < TARGET_STEADY
    )
