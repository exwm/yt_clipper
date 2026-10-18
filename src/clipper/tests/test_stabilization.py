"""Video stabilization on synthetic shaky clips (shaky_media.py), with the clipper's filters and defaults.

One target for every clip. Clips the stabilization misses it on today are strict xfails, so a change
that fixes one has to say so here.
"""

import atexit
import functools
import itertools
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest

from clipper.argparser import getArgParser, getVidstabPreset
from clipper.clip_maker import prepareVidstabTransformPass
from clipper.ffmpeg_filter import (
    ZOOM_BUDGET_PLACEHOLDER,
    getVideoStabilizationFilters,
    videoStabilizationGammaFixFilter,
)
from clipper.phase_correlation import consecutiveShifts
from clipper.tests import shaky_media
from clipper.tests.stabilization_metrics import grayFrames, motionAdded, shakeLeft
from clipper.vidstab_motions import (
    analysisFilter,
    analysisOutputArgs,
    checkStabilizedShake,
    findBrightnessChanges,
    inputShakePath,
    measuredMotions,
    readAnalysis,
    repairMotionsInFiles,
    shake,
)

# Shake a stabilized clip may keep, px/frame. The shaky clips start with about 9.6, gentle with 3.
TARGET_SHAKE = 1.0
# How far stabilization may move the frames of a steady clip, px
TARGET_STEADY = 0.5
STRONG = 4
SIZE = (shaky_media.WIDTH, shaky_media.HEIGHT)
MISSES = {
    "tilewall": "on a few frames both vid.stab's fields and the cells match a tile off, confidently",
    "gradient": "compression banding steps are tracked as motion",
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
def shakyMedia(ffmpeg: str) -> Path:
    return shaky_media.mediaFolder(ffmpeg)


def run(ffmpeg: str, video: Path, folder: Path, vf: str, output: str | None = None) -> Path:
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vf", vf]
    command += ["-c:v", "libx264", "-qp", "0", output] if output else ["-f", "null", "-"]
    subprocess.run(command, check=True, cwd=folder)
    return folder / (output or "")


def clipperFilters(transformPath: str, level: int = STRONG) -> tuple[str, str]:
    """The detect and transform filters the clipper runs with a preset (Strong by default) and its defaults."""
    parser = getArgParser()
    defaults = (
        "videoStabilizationMaxAngle",
        "videoStabilizationMaxShift",
        "videoStabilizationDynamicZoom",
    )
    mps = {
        "videoStabilization": getVidstabPreset(level),
        **{key: parser.get_default(key) for key in defaults},
    }
    detectFilter, transformFilter = getVideoStabilizationFilters(mps, transformPath)
    return videoStabilizationGammaFixFilter(detectFilter), videoStabilizationGammaFixFilter(
        transformFilter,
    )


def fill(transformFilter: str, replacements: dict[str, str]) -> str:
    for placeholder, value in replacements.items():
        transformFilter = transformFilter.replace(placeholder, value)
    return transformFilter


def detect(ffmpeg: str, video: Path, folder: Path) -> None:
    """The first pass as the clipper runs it: transforms.trf and the analysis output, analysis.nut.
    Copies of one run per clip, as the repair changes them in place."""
    detected = detectOnce(ffmpeg, video)
    for name in ("transforms.trf", "analysis.nut"):
        shutil.copy(detected / name, folder / name)


@functools.cache
def detectRoot() -> Path:
    """Where this test process keeps its detect passes, removed when it exits."""
    root = Path(tempfile.mkdtemp(prefix="detect-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    return root


@functools.cache
def detectOnce(ffmpeg: str, video: Path) -> Path:
    folder = Path(tempfile.mkdtemp(dir=detectRoot()))
    runDetect(ffmpeg, video, folder)
    return folder


def runDetect(ffmpeg: str, video: Path, folder: Path) -> None:
    detectFilter, _ = clipperFilters("transforms.trf")
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


def stabilize(
    ffmpeg: str,
    video: Path,
    folder: Path,
    level: int = STRONG,
) -> tuple[Path, dict[str, str]]:
    """Both passes as the clipper runs them, with the step between them (flash repair, zoom budget).
    Returns the output and what that step filled into the transform. The detect pass is shared by
    every preset: only smoothing differs between them, and only the transform reads it."""
    detect(ffmpeg, video, folder)
    _, transformFilter = clipperFilters("transforms.trf", level)
    replacements = prepareVidstabTransformPass(
        ffmpeg,
        str(folder / "transforms.trf"),
        str(folder / "analysis.nut"),
        getVidstabPreset(level)["smoothing"],
        None,
    )
    return run(
        ffmpeg,
        video,
        folder,
        fill(transformFilter, replacements),
        "stabilized.mp4",
    ), replacements


def zoomedReference(ffmpeg: str, video: Path, folder: Path, replacements: dict[str, str]) -> Path:
    """The clip zoomed as stabilization zooms it, with no motion: the clipper's transform, with the
    zoom budget it got, on the motion of a still frame. vid.stab's camera path optimization crops a
    window whose size depends only on the zoom settings, so a path without motion gives the same zoom."""
    frames = shaky_media.FPS * shaky_media.SECONDS
    run(
        ffmpeg,
        video,
        folder,
        f"loop=loop=-1:size=1,trim=end_frame={frames},vidstabdetect=result=still.trf",
    )
    return run(
        ffmpeg,
        video,
        folder,
        fill(clipperFilters("still.trf")[1], replacements),
        "reference.mp4",
    )


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


@pytest.mark.parametrize(
    ("size", "analysisSize"),
    [
        ("640x360", "640x360"),
        ("1280x720", "640x360"),
        ("1920x1080", "640x360"),
        # Shrunk by 2, the smallest whole number that fits
        ("1000x700", "500x350"),
    ],
)
def test_the_analysis_shrinks_the_whole_frame_by_a_whole_number(
    ffmpeg: str,
    size: str,
    analysisSize: str,
) -> None:
    # The synthetic clips fit the analysis area as they are, so only this checks the shrinking
    info = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=s={size}:d=0.1",
            "-frames:v",
            "1",
            "-vf",
            f"{analysisFilter()},showinfo",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    assert f" s:{analysisSize} " in info


@pytest.mark.parametrize("name", ["flash", "strobe", "stage", "pulse", "dancer"])
def test_the_motion_across_brightness_changes_is_measured_as_the_camera_moved(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    detect(ffmpeg, source, tmp_path)
    analysis = readAnalysis(ffmpeg, str(tmp_path / "analysis.nut"))
    untrusted = findBrightnessChanges([frame.brightness for frame in analysis])
    measured = measuredMotions(analysis)
    path = shaky_media.windowPath(steady=False)
    # vid.stab's frame n holds the motion from video frame n - 2 to n - 1, as the window moved
    truth = {
        n: (path[n - 1][0] - path[n - 2][0], path[n - 1][1] - path[n - 2][1]) for n in untrusted
    }
    assert untrusted
    assert untrusted <= measured.keys()
    for n in untrusted:
        assert measured[n] == pytest.approx(truth[n], abs=0.5), f"frame {n}"


@pytest.mark.parametrize("shakier", [False, True])
def test_a_clip_that_stabilization_makes_shakier_is_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    shakier: bool,
) -> None:
    output, _ = stabilize(ffmpeg, shaky_media.makeShakyClip(ffmpeg, "gentle", shakyMedia), tmp_path)
    # No clip here comes out shakier, so the shakier output stands in: a clip that shakes far more
    if shakier:
        output = shaky_media.makeShakyClip(ffmpeg, "plain", shakyMedia)
    assert checkStabilizedShake(ffmpeg, str(tmp_path / "transforms.trf"), str(output)) is shakier


def test_a_clip_within_the_tolerance_is_not_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    output, _ = stabilize(ffmpeg, shaky_media.makeShakyClip(ffmpeg, "gentle", shakyMedia), tmp_path)
    frames = readAnalysis(ffmpeg, str(output), analyze=True)
    outputShake = shake(frames) / frames[0].size[0]
    transforms = str(tmp_path / "transforms.trf")
    # The input's shake, as the repair keeps it: the output is 3% shakier, inside the 5% tolerance
    Path(inputShakePath(transforms)).write_text(f"{outputShake / 1.03}", encoding="utf-8")
    assert checkStabilizedShake(ffmpeg, transforms, str(output)) is False
    # Far shakier, past the tolerance's 0.05 px floor too (the output shakes under 0.1 px)
    Path(inputShakePath(transforms)).write_text(f"{outputShake / 10}", encoding="utf-8")
    assert checkStabilizedShake(ffmpeg, transforms, str(output)) is True


def test_dropping_fields_alone_rewrites_the_transforms(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    # The occluder has no flashes, so the only repair is dropping the fields on the object
    detect(ffmpeg, shaky_media.makeShakyClip(ffmpeg, "occluder", shakyMedia), tmp_path)
    before = (tmp_path / "transforms.trf").read_text(encoding="utf-8")
    repairMotionsInFiles(ffmpeg, str(tmp_path / "transforms.trf"), str(tmp_path / "analysis.nut"))
    assert (tmp_path / "transforms.trf").read_text(encoding="utf-8") != before


@pytest.mark.parametrize("name", ["plain", "gentle"])
def test_a_stronger_preset_leaves_less_motion_and_zooms_in_further(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    # Very Weak, Medium, Strongest. Most of the motion left is the clip's pan, so the steps are small.
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    motions, zooms = [], []
    for level in (1, 3, 6):
        folder = tmp_path / str(level)
        folder.mkdir()
        output, replacements = stabilize(ffmpeg, source, folder, level)
        frames = grayFrames(ffmpeg, output, (shaky_media.WIDTH, shaky_media.HEIGHT))
        motions.append(float(np.mean([np.hypot(s.dx, s.dy) for s in consecutiveShifts(frames)])))
        zooms.append(float(replacements[ZOOM_BUDGET_PLACEHOLDER]))
    assert all(later <= earlier + 0.01 for earlier, later in itertools.pairwise(motions)), motions
    assert all(later > earlier for earlier, later in itertools.pairwise(zooms)), zooms


@pytest.mark.parametrize("name", clipCases(steady=False))
def test_stabilization_removes_the_shake(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    clip = shaky_media.CLIPS[name]
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    assert clipShake(ffmpeg, source, clip) > 1.3 * clip.shake
    output, _ = stabilize(ffmpeg, source, tmp_path)
    assert clipShake(ffmpeg, output, clip) < TARGET_SHAKE


def clipShake(ffmpeg: str, video: Path, clip: shaky_media.ShakyClip) -> float:
    """The clip's shake left, px/frame: over its scored rows, or by the clipper's own measure."""
    if clip.cellShake:
        measured = shake(readAnalysis(ffmpeg, str(video), analyze=True))
        assert measured is not None
        return measured
    top, bottom = clip.scoredRows
    return shakeLeft(grayFrames(ffmpeg, video, SIZE)[:, top:bottom], clip.cutFrame)


@pytest.mark.parametrize("name", clipCases(steady=True))
def test_stabilization_leaves_a_steady_shot_alone(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    output, replacements = stabilize(ffmpeg, source, tmp_path)
    reference = zoomedReference(ffmpeg, source, tmp_path, replacements)
    assert (
        motionAdded(grayFrames(ffmpeg, reference, SIZE), grayFrames(ffmpeg, output, SIZE))
        < TARGET_STEADY
    )
