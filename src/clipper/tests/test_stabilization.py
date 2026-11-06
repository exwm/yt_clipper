"""Video stabilization on synthetic shaky clips (shaky_media.py), with the clipper's filters and defaults.

One target for every clip. Clips the stabilization misses it on today are strict xfails, so a change
that fixes one has to say so here.
"""

import atexit
import functools
import itertools
import json
import re
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest

from clipper import clip_maker
from clipper.argparser import getArgParser, getVidstabPreset
from clipper.clip_maker import checkTransformShake, prepareVidstabTransformPass
from clipper.ffmpeg_filter import (
    ZOOM_BUDGET_PLACEHOLDER,
    getVideoStabilizationFilters,
    videoStabilizationGammaFixFilter,
)
from clipper.phase_correlation import consecutiveShifts
from clipper.tests import shaky_media
from clipper.tests.stabilization_metrics import grayFrames, motionAdded, shakeLeft
from clipper.vidstab_motions import (
    GAUSSIAN_PATH,
    analysisFilter,
    analysisOutputArgs,
    checkStabilizedShake,
    findBrightnessChanges,
    inputShakePath,
    measuredMotions,
    readAnalysis,
    repairMotionsInFiles,
    shake,
    transformStalls,
    zoomBudgetFromFile,
)

# Shake a stabilized clip may keep, px/frame. The shaky clips start with about 9.6, gentle with 3.
TARGET_SHAKE = 1.0
# How far stabilization may move the frames of a steady clip, px
TARGET_STEADY = 0.5
STRONG = 4
STRONGEST = 6
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


LOSSLESS = ("-c:v", "libx264", "-qp", "0")


def run(
    ffmpeg: str,
    video: Path,
    folder: Path,
    vf: str,
    output: str | None = None,
    *,
    encode: tuple[str, ...] = LOSSLESS,
    analysis: str | None = None,
) -> Path:
    """Runs vf on the video into output, and with `analysis` also into the clipper's analysis output."""
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video), "-vf", vf]
    command += [*encode, output] if output else ["-f", "null", "-"]
    if analysis:
        command += shlex.split(analysisOutputArgs(f'-vf "{vf},{analysisFilter()}"', analysis))
    subprocess.run(command, check=True, cwd=folder)
    return folder / (output or "")


def clipperFilters(transformPath: str, level: int = STRONG) -> tuple[str, str]:
    """The detect and transform filters the clipper runs with a preset (Strong by default) and its defaults."""
    parser = getArgParser()
    defaults = (
        "videoStabilizationMaxAngle",
        "videoStabilizationMaxShift",
    )
    mps = {
        "videoStabilization": getVidstabPreset(level),
        **{key: parser.get_default(key) for key in defaults},
    }
    detectFilter, transformFilter = getVideoStabilizationFilters(
        mps, transformPath, textTransforms=True
    )
    return videoStabilizationGammaFixFilter(detectFilter), videoStabilizationGammaFixFilter(
        transformFilter,
    )


def test_without_text_transforms_the_filters_leave_out_the_text_format_and_zoom_budget() -> None:
    # An older vid.stab has no fileformat, and adds a zoom to its optimal zoom instead of capping it
    mps = {
        "videoStabilization": getVidstabPreset(STRONG),
        "videoStabilizationMaxAngle": -1,
        "videoStabilizationMaxShift": -1,
    }
    detectFilter, transformFilter = getVideoStabilizationFilters(
        mps, "transforms.trf", textTransforms=False
    )
    assert "fileformat" not in detectFilter
    assert "zoom=" not in transformFilter
    detectFilter, transformFilter = getVideoStabilizationFilters(
        mps, "transforms.trf", textTransforms=True
    )
    assert "fileformat=1" in detectFilter
    assert f"zoom={ZOOM_BUDGET_PLACEHOLDER}" in transformFilter


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
    output: str = "stabilized.mp4",
    encode: tuple[str, ...] = LOSSLESS,
) -> tuple[Path, dict[str, str]]:
    """Both passes as the clipper runs them, with the step between them (flash repair, zoom budget),
    and the transform pass's analysis output, stabilized.nut. Returns the output and what that step
    filled into the transform. The detect pass is shared by every preset: only smoothing differs
    between them, and only the transform reads it."""
    detect(ffmpeg, video, folder)
    _, transformFilter = clipperFilters("transforms.trf", level)

    def stalls(zoom: str) -> bool:
        graph = fill(transformFilter, {ZOOM_BUDGET_PLACEHOLDER: zoom})
        return transformStalls(
            [ffmpeg, "-hide_banner", "-i", str(video), "-vf", graph], str(folder)
        )

    replacements = prepareVidstabTransformPass(
        ffmpeg,
        str(folder / "transforms.trf"),
        str(folder / "analysis.nut"),
        getVidstabPreset(level)["smoothing"],
        (),
        stalls,
    )
    return run(
        ffmpeg,
        video,
        folder,
        fill(transformFilter, replacements),
        output,
        encode=encode,
        analysis="stabilized.nut",
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
    _, replacements = stabilize(
        ffmpeg, shaky_media.makeShakyClip(ffmpeg, "gentle", shakyMedia), tmp_path
    )
    # No clip here comes out shakier, so the shakier output stands in: a clip that shakes far more
    if shakier:
        plain = shaky_media.makeShakyClip(ffmpeg, "plain", shakyMedia)
        run(ffmpeg, plain, tmp_path, "null", analysis="stabilized.nut")
    assert checkStabilizedShake(ffmpeg, *checkInputs(tmp_path, replacements)) is shakier


def test_a_black_lead_in_that_moves_is_not_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    # vid.stab's camera path can swing through black frames, where no one sees it, and their faint
    # content still matches confidently: the stabilized clip starts with 6 such frames
    _, replacements = stabilize(
        ffmpeg, shaky_media.makeShakyClip(ffmpeg, "gentle", shakyMedia), tmp_path
    )
    transforms, analysis, budget = checkInputs(tmp_path, replacements)
    width, height = shaky_media.WIDTH, shaky_media.HEIGHT
    leadIn = (
        f"testsrc=s={width + 20}x{height + 20}:r={shaky_media.FPS},trim=end_frame=6,format=gray,"
        f"crop={width}:{height}:x='20*mod(n,2)':y='20*mod(n,2)',lut=c0='val/50',setsar=1[lead];"
        "[0]format=gray,setsar=1[clip];[lead][clip]concat"
    )
    subprocess.run(
        [
            *(ffmpeg, "-hide_banner", "-loglevel", "error", "-i", analysis),
            *("-filter_complex", leadIn, "-fps_mode", "passthrough"),
            *("-c:v", "ffv1", "-f", "nut", "-y", str(tmp_path / "lead.nut")),
        ],
        check=True,
    )
    shutil.move(tmp_path / "lead.nut", analysis)
    assert checkStabilizedShake(ffmpeg, transforms, analysis, budget) is False


def test_a_camera_path_that_fails_to_solve_keeps_the_zoom_near_its_budget(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    # vid.stab's L1 camera path fails to solve this clip at Strongest. vid.stab then falls back to its
    # gaussian path and adds that path's own zoom to the budget, which cropped 13% for a budget of 8.6%.
    source = shaky_media.makeShakyClip(ffmpeg, "flashconcert", shakyMedia)
    _, replacements = stabilize(ffmpeg, source, tmp_path, STRONGEST)
    budget = zoomBudgetFromFile(
        str(tmp_path / "transforms.trf"), getVidstabPreset(STRONGEST)["smoothing"]
    )
    _, transformFilter = clipperFilters("transforms.trf", STRONGEST)
    assert zoomUsed(ffmpeg, source, tmp_path, fill(transformFilter, replacements)) <= budget + 0.25


def zoomUsed(ffmpeg: str, video: Path, folder: Path, transformFilter: str) -> float:
    """The zoom the transform crops to. vid.stab logs a final zoom only when its gaussian camera path
    runs, the fallback for an L1 path that fails to solve. It solves the path before the first frame."""
    stderr = subprocess.run(
        [
            *(ffmpeg, "-hide_banner", "-i", str(video), "-vf", transformFilter),
            *("-frames:v", "1", "-an", "-f", "null", "-"),
        ],
        cwd=folder,
        capture_output=True,
        text=True,
        check=True,
    ).stderr
    final = re.findall(r"Final zoom: ([-\d.]+)", stderr)
    zoom = re.search(r":zoom=([\d.]+)", transformFilter)
    assert final or zoom
    return float(final[-1]) if final else float(zoom.group(1))


@pytest.mark.parametrize(
    ("zoom", "gaussian", "measuredAt"),
    [
        ("8.63", None, 8.63),
        # A nudge after a stall
        ("14.75", None, 14.75),
        # vid.stab's gaussian path, which fpv-alpine fell back to at Strongest: a Final zoom of 4.08
        (GAUSSIAN_PATH, 4.08, 4.25),
    ],
)
def test_the_shakier_clip_check_measures_the_clip_at_the_zoom_it_used(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    zoom: str,
    gaussian: float | None,
    measuredAt: float,
) -> None:
    # The transforms are unreadable, so a zoom budget sized again from them would be the most, 15%
    checked: list[float] = []
    monkeypatch.setattr(
        clip_maker, "checkStabilizedShake", lambda *args: checked.append(args[-1]) or False
    )
    transforms = str(tmp_path / "missing.trf")
    checkTransformShake("ffmpeg", transforms, "out.nut", zoom, lambda: gaussian)
    assert checked == [pytest.approx(measuredAt, abs=0.01)]


def checkInputs(folder: Path, replacements: dict[str, str]) -> tuple[str, str, float]:
    """checkStabilizedShake's transforms, stabilized analysis and zoom budget, after stabilize."""
    budget = float(replacements[ZOOM_BUDGET_PLACEHOLDER])
    return str(folder / "transforms.trf"), str(folder / "stabilized.nut"), budget


def test_a_grainy_nearly_still_clip_encoded_lossy_is_not_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    # The encode smooths the grain the input's lossless frames keep, which once read as more shake
    source = shaky_media.makeShakyClip(ffmpeg, "calmstage", shakyMedia)
    vp9 = ("-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-speed", "8")
    _, replacements = stabilize(ffmpeg, source, tmp_path, output="stabilized.webm", encode=vp9)
    assert checkStabilizedShake(ffmpeg, *checkInputs(tmp_path, replacements)) is False


@pytest.mark.parametrize("level", [1, 3, 6])
def test_a_match_across_a_cut_that_the_input_has_none_for_is_not_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    level: int,
) -> None:
    # Nearly still, then a cut to a negative. The stabilized frames across the cut match faintly at
    # a far shift, which once read as one jerk of 27 px and a clip 8 times shakier than its input.
    source = shaky_media.makeShakyClip(ffmpeg, "brightsubject", shakyMedia)
    _, replacements = stabilize(ffmpeg, source, tmp_path, level)
    assert checkStabilizedShake(ffmpeg, *checkInputs(tmp_path, replacements)) is False


def test_a_clip_within_the_tolerance_is_not_reported(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
) -> None:
    _, replacements = stabilize(
        ffmpeg, shaky_media.makeShakyClip(ffmpeg, "gentle", shakyMedia), tmp_path
    )
    transforms, analysis, budget = checkInputs(tmp_path, replacements)
    frames = readAnalysis(ffmpeg, analysis)
    keptShake = json.loads(Path(inputShakePath(transforms)).read_text(encoding="utf-8"))
    # The output's shake as the input's frame would show it, unzoomed
    outputShake = shake(frames, keptShake["unmeasured"]) / frames[0].size[0] / (1 + budget / 100)
    kept = tmp_path / "kept.nut"
    shutil.copy(analysis, kept)
    # The input's shake, as the repair keeps it: the output is 3% shakier, inside the 5% tolerance
    Path(inputShakePath(transforms)).write_text(
        json.dumps({**keptShake, "shake": outputShake / 1.03}), encoding="utf-8"
    )
    assert checkStabilizedShake(ffmpeg, transforms, analysis, budget) is False
    # Far shakier, past the tolerance's 0.05 px floor too (the output shakes under 0.1 px)
    shutil.copy(kept, analysis)
    Path(inputShakePath(transforms)).write_text(
        json.dumps({**keptShake, "shake": outputShake / 10}), encoding="utf-8"
    )
    assert checkStabilizedShake(ffmpeg, transforms, analysis, budget) is True


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


# The shared shake path of plain and most clips needs as much zoom at Medium as at Strongest: its
# shake is all fast, which a wider window adds nothing to
@pytest.mark.parametrize("name", ["cut", "gentle"])
def test_a_stronger_preset_leaves_less_motion_and_zooms_in_further(
    ffmpeg: str,
    shakyMedia: Path,
    tmp_path: Path,
    name: str,
) -> None:
    # Very Weak, Medium, Strongest. Most of the motion left is the clip's pan, so the steps are small.
    source = shaky_media.makeShakyClip(ffmpeg, name, shakyMedia)
    # The shift into the frame after a cut matches unrelated pictures, so it varies with the zoom alone
    cutFrame = shaky_media.CLIPS[name].cutFrame
    motions, zooms = [], []
    for level in (1, 3, 6):
        folder = tmp_path / str(level)
        folder.mkdir()
        output, replacements = stabilize(ffmpeg, source, folder, level)
        frames = grayFrames(ffmpeg, output, (shaky_media.WIDTH, shaky_media.HEIGHT))
        shifts = consecutiveShifts(frames)
        # shifts[n] is the motion into frame n + 1
        motions.append(
            float(
                np.mean([np.hypot(s.dx, s.dy) for n, s in enumerate(shifts) if n + 1 != cutFrame])
            )
        )
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
