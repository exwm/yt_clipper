"""Repairs the motion vid.stab measured across flashes, and drops the fields that follow a subject
moving on its own, before it stabilizes a clip.

vid.stab matches small fields of each frame against the frame before by their brightness, so a
flash, which brightens the whole frame, makes every field match the wrong place and the clip jerks
there. vidstabdetect writes the motion it measured to a transforms file (fileformat=1 for text).
The detect command also writes each frame, shrunk and in gray, to a small analysis file. Before
vidstabtransform reads the transforms, the motion into and out of each flash frame (found from the
frames' brightness) is measured again from a grid of cells of the analysis frames with phase
correlation, which ignores brightness, or else interpolated from the motion around it. On every
other frame the cells measure, fields whose motion disagrees with the cells' are dropped.
"""

import contextlib
import re
import statistics
import subprocess
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import IO

import numpy as np

from clipper.phase_correlation import FrameShift, spectrum, spectrumShift
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)

# The analysis output shrinks each whole frame by a whole number to at most this many pixels.
# Real footage matches better shrunk: blur and compression leave little to match at full size.
ANALYSIS_AREA = 640 * 360
# Each analysis frame is measured in a grid of cells, so a subject moving on its own in the middle
# of the frame spoils only a few of them
ANALYSIS_GRID = 3
# A frame's shift needs this many cells that agree on it
MIN_AGREEING_CELLS = 3
# How far a cell's shift may be from the median of the cells to agree with it, analysis px
CELL_AGREEMENT = 1.5
# A clip's shake is measured over frames SHAKE_RADIUS either side, given MIN_SHAKE_FRAMES measured frames.
# A stabilized clip may shake SHAKE_TOLERANCE more than its input (share, at least SHAKE_TOLERANCE_PX).
SHAKE_RADIUS = 7
MIN_SHAKE_FRAMES = 30
SHAKE_TOLERANCE = 0.05
SHAKE_TOLERANCE_PX = 0.05
# Shifts into or out of a frame darker than this mean brightness (of 255) are left out of the shake: a
# black frame shows no motion, yet faint seams in it can match far off (black frames measure 2 to 4,
# the darkest real footage seen 6.6)
DARK_FRAME = 5
# vid.stab's motion into a frame with fewer fields than this share of the clip's median is not trusted
SPARSE_FIELDS = 0.15
# How far a vid.stab field's motion may be from the measured motion to be kept, px
FIELD_AGREEMENT = 2.0
# Shifts with a lower correlation peak are not trusted (random frames peak near 0.04 at 384x216)
MIN_PEAK = 0.08

# vid.stab's motion into a frame is not trusted when the frame's mean brightness changed this much
# from the frame before: at least BRIGHTNESS_MIN_CHANGE levels (of 255) and BRIGHTNESS_RELATIVE_CHANGE
# of the darker frame. A flash changes it twice (on, off); a light coming on once, or for several frames.
BRIGHTNESS_MIN_CHANGE = 4
BRIGHTNESS_RELATIVE_CHANGE = 0.05
# With more frames than this unmeasured, the motion around them is too sparse to stand in for them
MAX_UNMEASURED_SHARE = 0.3
# The zoom budget's range and padding, in percent. The maximum is vid.stab's own default.
MIN_ZOOM_BUDGET = 2.0
MAX_ZOOM_BUDGET = 15.0
ZOOM_BUDGET_PADDING = 1.0
# The zoom budget measures the shake over this many times the preset's smoothing window
ZOOM_BUDGET_WINDOW = 3
# vid.stab's L1 camera path can fail to solve. vid.stab then falls back to its gaussian path and adds
# that path's own zoom to the budget, which cropped 12-22% for budgets of 7-15%. A zoom a nudge away
# solves most such paths; the rest get the gaussian path with only its own zoom, as a 5.49 stall did.
# The fallback is text for the transform filter's zoom option, which ends the filter.
STALL_NUDGES = (-0.25, 0.25)
GAUSSIAN_PATH = "0:optalgo=gauss:optzoom=1"
# "nudge" tries STALL_NUDGES before the gaussian path, "gauss" goes straight to it
STALL_FALLBACK = "nudge"
# vid.stab's error when the L1 path fails to solve (lpsolver_ipm.c), logged at ffmpeg's default level
STALL_LINE = "interior point method stalled"
FINAL_ZOOM_PATTERN = re.compile(r"Final zoom: ([-\d.]+)")

FRAME_PATTERN = re.compile(r"^Frame (\d+) \(List \d+ \[(.*)\]\)$")
MOTION_PATTERN = re.compile(r"\(LM (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)\)")


class TransformsFileError(ValueError):
    """A transforms file that is not vid.stab's text format."""


@dataclass(frozen=True)
class LocalMotion:
    """How far one field of the frame moved since the frame before: vid.stab's LM entries."""

    dx: int
    dy: int
    x: int
    y: int
    size: int
    contrast: float
    match: float

    def text(self) -> str:
        return f"(LM {self.dx} {self.dy} {self.x} {self.y} {self.size} {self.contrast:f} {self.match:f})"


@dataclass(frozen=True)
class TransformsFile:
    # The version and comment lines before the frames
    header: list[str]
    # Each frame's field motions, in frame order (vid.stab numbers frames from 1)
    frames: list[list[LocalMotion]]


def parseTransforms(text: str) -> TransformsFile:
    header: list[str] = []
    frames: list[list[LocalMotion]] = []
    # As vid.stab reads it (docs/trf-format.md): comment and blank lines anywhere, any line endings
    for line in text.splitlines():
        match = FRAME_PATTERN.match(line.strip())
        if not match:
            if frames and line.strip() and not line.lstrip().startswith("#"):
                raise TransformsFileError(f"unexpected line after the first frame: {line[:80]!r}")
            if not frames:
                header.append(line)
            continue
        if int(match.group(1)) != len(frames) + 1:
            raise TransformsFileError(f"frame {match.group(1)} out of order")
        frames.append(
            [
                LocalMotion(
                    int(dx),
                    int(dy),
                    int(x),
                    int(y),
                    int(size),
                    float(contrast),
                    float(quality),
                )
                for dx, dy, x, y, size, contrast, quality in MOTION_PATTERN.findall(match.group(2))
            ],
        )
    if not header or not header[0].startswith("VID.STAB"):
        raise TransformsFileError("not a vid.stab text transforms file")
    return TransformsFile(header, frames)


def formatTransforms(transforms: TransformsFile) -> str:
    lines = list(transforms.header)
    for number, motions in enumerate(transforms.frames, start=1):
        lines.append(
            f"Frame {number} (List {len(motions)} [{','.join(m.text() for m in motions)}])",
        )
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class FrameAnalysis:
    """One frame of the detect pass's analysis output: the whole frame, shrunk, in gray."""

    brightness: float
    # The shift of its content from the frame before's, in the analysis frame's pixels. None for the first.
    shift: FrameShift | None
    # The analysis frame's width and height
    size: tuple[int, int] = (0, 0)


def analysisFilter() -> str:
    """Filters after the clip's own, for the analysis output: the whole frame, in gray, shrunk by the
    smallest whole number that fits it in ANALYSIS_AREA. A whole number can be found again from the
    frame size that vid.stab's fields give (analysisScale)."""
    divisor = f"ceil(sqrt(iw*ih/{ANALYSIS_AREA}))"
    return f"scale=w='trunc(iw/{divisor}/2)*2':h='trunc(ih/{divisor}/2)*2':flags=area,format=gray"


def analysisScale(transforms: TransformsFile, analysisSize: tuple[int, int]) -> int | None:
    """The whole number analysisFilter shrank the frames by. The frame size from vid.stab's fields is
    only near the real one, so it is rounded to a whole number of analysis frames."""
    size = frameSize(transforms)
    if size is None or min(analysisSize) <= 0:
        return None
    return max(1, round((size[0] / analysisSize[0] + size[1] / analysisSize[1]) / 2))


def fastFftLength(length: int) -> int:
    """The largest length up to `length` with no prime factor above 7. An FFT of a length with a large
    prime factor is slow: a 640 px wide frame's cells are 213 px, 3 x 71, and 210 transforms 2.4x faster."""
    for candidate in range(length, 0, -1):
        rest = candidate
        for prime in (2, 3, 5, 7):
            while rest % prime == 0:
                rest //= prime
        if rest == 1:
            return candidate
    return length


def cells(frame: np.ndarray) -> np.ndarray:
    """The frame's ANALYSIS_GRID grid of cells (cell x height x width), each trimmed around its centre
    to a fast FFT size. The Hann window gives the trimmed edge pixels almost no weight anyway."""
    grid = ANALYSIS_GRID
    height, width = frame.shape[0] // grid, frame.shape[1] // grid
    cropped = frame[: grid * height, : grid * width]
    gridCells = (
        cropped.reshape(grid, height, grid, width)
        .swapaxes(1, 2)
        .reshape(grid * grid, height, width)
    )
    fastHeight, fastWidth = fastFftLength(height), fastFftLength(width)
    top, left = (height - fastHeight) // 2, (width - fastWidth) // 2
    return gridCells[:, top : top + fastHeight, left : left + fastWidth]


def cellSpectra(frame: np.ndarray) -> list[np.ndarray]:
    """Each cell's spectrum, computed once per frame and paired with the next frame's."""
    return [spectrum(cell) for cell in cells(frame)]


def gridShift(previous: np.ndarray, frame: np.ndarray) -> FrameShift:
    """The shift most cells agree on, with their median peak. Peak 0 when too few agree."""
    return spectraShift(cellSpectra(previous), cellSpectra(frame), cells(frame).shape[1:])


def spectraShift(
    previous: Sequence[np.ndarray], current: Sequence[np.ndarray], cellShape: tuple[int, ...]
) -> FrameShift:
    shifts = [
        s
        for s in (spectrumShift(a, b, cellShape) for a, b in zip(previous, current, strict=True))
        if s.peak >= MIN_PEAK
    ]
    if not shifts:
        return FrameShift(0.0, 0.0, 0.0)
    dx, dy = statistics.median(s.dx for s in shifts), statistics.median(s.dy for s in shifts)
    agreeing = [s for s in shifts if np.hypot(s.dx - dx, s.dy - dy) <= CELL_AGREEMENT]
    if len(agreeing) < MIN_AGREEING_CELLS:
        return FrameShift(0.0, 0.0, 0.0)
    return FrameShift(
        float(np.mean([s.dx for s in agreeing])),
        float(np.mean([s.dy for s in agreeing])),
        statistics.median(s.peak for s in agreeing),
    )


def analysisOutputArgs(filterArgs: str, analysisPath: str) -> str:
    """A second output for the detect command: the same frames, decoded once, losslessly to a small
    file. filterArgs gives the clip's filters followed by analysisFilter(), with -vf or filterFileOption.
    -fps_mode passthrough keeps exactly the frames vidstabdetect sees: a speed change otherwise has
    frames repeated or dropped for a constant frame rate, and the frames no longer line up."""
    return f' -an -sn {filterArgs} -fps_mode passthrough -c:v ffv1 -f nut -y "{analysisPath}"'


def readPgmFrames(stream: IO[bytes]) -> Iterator[np.ndarray]:
    """Gray frames from an ffmpeg `-f image2pipe -c:v pgm` stream: `P5 width height 255` then the pixels."""
    while True:
        header = b""
        while header.count(b"\n") < 3 or not header.endswith(b"\n"):
            chunk = stream.read(1)
            if not chunk:
                return
            header += chunk
        width, height = map(int, header.split()[1:3])
        pixels = stream.read(width * height)
        if len(pixels) < width * height:
            return
        # float32, as phase_correlation.spectrum transforms it
        yield np.frombuffer(pixels, np.uint8).reshape(height, width).astype(np.float32)


def readAnalysis(ffmpegPath: str, analysisPath: str, analyze: bool = False) -> list[FrameAnalysis]:
    """Each frame's brightness and shift from the analysis output, two frames in memory at a time.
    analyze=True reads any video, through analysisFilter."""
    # -nostdin: ffmpeg otherwise reads stdin for key presses, which can block it when stdin is a pipe
    command = [
        ffmpegPath,
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-i",
        analysisPath,
        *(["-vf", analysisFilter()] if analyze else []),
        # The frames as stored: a constant rate would repeat frames spaced out by a slowdown
        "-fps_mode",
        "passthrough",
        "-f",
        "image2pipe",
        "-c:v",
        "pgm",
        "-",
    ]
    analysis: list[FrameAnalysis] = []
    with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE) as process:
        assert process.stdout is not None
        previous = None
        for frame in readPgmFrames(process.stdout):
            frameCells = cells(frame)
            spectra = [spectrum(cell) for cell in frameCells]
            shift = (
                spectraShift(previous, spectra, frameCells.shape[1:])
                if previous is not None
                else None
            )
            analysis.append(
                FrameAnalysis(float(frame.mean()), shift, (frame.shape[1], frame.shape[0]))
            )
            previous = spectra
    if process.returncode:
        raise TransformsFileError(f"could not read {analysisPath}")
    return analysis


def measuredMotions(
    analysis: Sequence[FrameAnalysis], scale: int = 1
) -> dict[int, tuple[float, float]]:
    """vid.stab's motion for each frame (from 1) whose shift the analysis measured with confidence,
    in the clip's pixels (scale: analysisScale). vid.stab's field motion is the opposite of the content's shift."""
    return {
        i + 1: (-scale * a.shift.dx, -scale * a.shift.dy)
        for i, a in enumerate(analysis)
        if a.shift is not None and a.shift.peak >= MIN_PEAK
    }


def shake(analysis: Sequence[FrameAnalysis]) -> float | None:
    """How much the clip shakes, analysis px a frame: the root mean square of each measured frame's
    shift away from its moving average. None with too few measured frames to tell."""
    jitter = frameJitter(analysis)
    measured = ~np.isnan(jitter)
    if measured.sum() < MIN_SHAKE_FRAMES:
        return None
    return float(np.sqrt(np.mean(np.square(jitter[measured]))))


def frameJitter(analysis: Sequence[FrameAnalysis]) -> np.ndarray:
    """Each frame's shift away from its moving average, analysis px: the terms of shake(). NaN for a
    frame it leaves out."""
    xy = np.array(
        [
            (a.shift.dx, a.shift.dy)
            if a.shift is not None
            and a.shift.peak > 0
            and min(a.brightness, analysis[i - 1].brightness) >= DARK_FRAME
            else (np.nan, np.nan)
            for i, a in enumerate(analysis)
        ]
    )
    measured = ~np.isnan(xy[:, 0])
    kernel = np.ones(2 * SHAKE_RADIUS + 1)
    filled = np.where(measured[:, None], xy, 0.0)

    def windowSums(values: np.ndarray) -> np.ndarray:
        # "same" for a clip shorter than the window too, which np.convolve's "same" pads to the window
        return np.convolve(values, kernel, "full")[SHAKE_RADIUS : SHAKE_RADIUS + len(values)]

    counts = windowSums(measured.astype(float))
    sums = np.stack([windowSums(filled[:, k]) for k in range(2)], axis=1)
    # Every measured frame counts itself, so its window is never empty
    trend = np.divide(sums, counts[:, None], out=np.zeros_like(sums), where=counts[:, None] > 0)
    return np.hypot(*(xy - trend).T)


def findBrightnessChanges(brightness: Sequence[float]) -> set[int]:
    """vid.stab's frames (from 1) whose motion crosses a sharp change in mean brightness. Frame i
    (from 0) is vid.stab's frame i + 1, whose motion is from frame i - 1 to i."""
    return {
        i + 1
        for i in range(1, len(brightness))
        if abs(brightness[i] - brightness[i - 1])
        > max(
            BRIGHTNESS_MIN_CHANGE,
            BRIGHTNESS_RELATIVE_CHANGE * min(brightness[i], brightness[i - 1]),
        )
    }


def findSparseFrames(transforms: TransformsFile) -> set[int]:
    """vid.stab's frames (from 1) with far fewer fields than the clip usually has: in a dark or flat
    stretch, a few fields decide the motion, and a few can be wrong together."""
    counts = [len(motions) for motions in transforms.frames[1:]]
    if not counts:
        return set()
    usual = statistics.median(counts)
    return {
        n
        for n, motions in enumerate(transforms.frames, start=1)
        if n > 1 and len(motions) < SPARSE_FIELDS * usual
    }


def findDisagreeingFrames(
    transforms: TransformsFile, measured: Mapping[int, tuple[float, float]]
) -> set[int]:
    """Measured frames (from 1) where none of vid.stab's fields agree with the measured motion: on a
    repeating texture (a tile wall), every field can match the wrong tile."""
    return {
        n
        for n, (dx, dy) in measured.items()
        if 1 <= n <= len(transforms.frames)
        and transforms.frames[n - 1]
        and not any(
            np.hypot(m.dx - dx, m.dy - dy) <= FIELD_AGREEMENT for m in transforms.frames[n - 1]
        )
    }


def frameShift(motions: Sequence[LocalMotion]) -> tuple[float, float]:
    """The frame's shift: the median of its fields' motions, which ignores a few mismatched fields."""
    return statistics.median(m.dx for m in motions), statistics.median(m.dy for m in motions)


def repairMotions(
    transforms: TransformsFile,
    untrusted: set[int],
    measured: Mapping[int, tuple[float, float]] | None = None,
) -> list[int]:
    """Replaces the motion of vid.stab's untrusted frames (from 1): with the measured motion where
    there is one, else with the motion interpolated from the nearest good frames. Keeps a good
    frame's fields. Returns the repaired frames."""
    measured = measured or {}
    count = len(transforms.frames)
    broken = sorted(n for n in untrusted if 2 <= n <= count)
    good = [n for n in range(2, count + 1) if n not in untrusted and transforms.frames[n - 1]]
    if not broken or not good:
        return []
    for n in broken:
        if n in measured:
            dx, dy = measured[n]
            source = min(good, key=lambda g: abs(g - n))
            transforms.frames[n - 1] = [
                replace(m, dx=round(dx), dy=round(dy)) for m in transforms.frames[source - 1]
            ]
            continue
        before = max((g for g in good if g < n), default=None)
        after = min((g for g in good if g > n), default=None)
        source = before or after
        assert source is not None
        dx, dy = frameShift(transforms.frames[source - 1])
        if before and after:
            (dx0, dy0), (dx1, dy1) = (
                frameShift(transforms.frames[before - 1]),
                frameShift(transforms.frames[after - 1]),
            )
            share = (n - before) / (after - before)
            dx, dy = dx0 + (dx1 - dx0) * share, dy0 + (dy1 - dy0) * share
        transforms.frames[n - 1] = [
            replace(m, dx=round(dx), dy=round(dy)) for m in transforms.frames[source - 1]
        ]
    return broken


def keepFieldsMovingWithTheCamera(
    transforms: TransformsFile,
    measured: Mapping[int, tuple[float, float]],
    skipped: set[int] | None = None,
) -> list[int]:
    """Drops the fields of each measured frame (from 1) whose motion is more than FIELD_AGREEMENT
    from the measured motion: fields on a subject moving on its own, which vid.stab would otherwise
    follow. Keeps a frame as it is when none of its fields agree. Returns the frames it changed."""
    changed = []
    for n, (dx, dy) in sorted(measured.items()):
        if (skipped and n in skipped) or not 1 <= n <= len(transforms.frames):
            continue
        motions = transforms.frames[n - 1]
        agreeing = [m for m in motions if np.hypot(m.dx - dx, m.dy - dy) <= FIELD_AGREEMENT]
        if agreeing and len(agreeing) < len(motions):
            transforms.frames[n - 1] = agreeing
            changed.append(n)
    return changed


def frameSize(transforms: TransformsFile) -> tuple[float, float] | None:
    """The frame's size, from where vid.stab placed its fields: it lays them out symmetrically, so
    the first and last field centres add up to the frame's width (and height)."""
    xs = [m.x for motions in transforms.frames for m in motions]
    ys = [m.y for motions in transforms.frames for m in motions]
    if not xs:
        return None
    return float(min(xs) + max(xs)), float(min(ys) + max(ys))


def extendedPath(path: np.ndarray, radius: int) -> np.ndarray:
    """The camera path continued `radius` frames past each end, along the straight line fitted to
    the 2 * radius + 1 frames nearest that end. A steady pan carries on, where holding the end still
    would make the moving average lag it as if it were shake, and a shaking end frame (which an odd
    reflection would pivot on) counts no more than its neighbors."""

    def continued(nearest: np.ndarray) -> np.ndarray:
        # nearest ends with the frame at the clip's end
        if len(nearest) < 2:
            return np.full(radius, nearest[-1])
        steps = np.arange(len(nearest))
        slope, intercept = np.polyfit(steps, nearest, 1)
        return intercept + slope * (len(nearest) - 1 + np.arange(1, radius + 1))

    window = 2 * radius + 1
    before = continued(path[:window][::-1])[::-1]
    after = continued(path[-window:])
    return np.concatenate([before, path, after])


def zoomBudget(transforms: TransformsFile, smoothing: float) -> float:
    """How far vid.stab's camera path optimization may zoom in, in percent: enough for the clip's
    shake. The camera path (each frame's median field motion, summed) strays from its moving
    average over ZOOM_BUDGET_WINDOW times the smoothing window; the window must cover that on both
    sides, at the 99th percentile. vid.stab's L1 path, made of straight pieces, strays further than
    an average over the smoothing window alone, which left slow sways shakier than 5.49. ffmpeg 9's
    vid.stab otherwise crops a fixed VS_L1_DEFAULT_ZOOM (15%) of every clip."""
    size = frameSize(transforms)
    if size is None or min(size) <= 0:
        return MAX_ZOOM_BUDGET
    shifts = np.array([frameShift(m) if m else (0.0, 0.0) for m in transforms.frames], dtype=float)
    path = np.cumsum(shifts, axis=0)
    # int(): smoothing comes from a markers JSON file, whose schema lets 10.0 through as an integer
    radius = max(1, ZOOM_BUDGET_WINDOW * int(smoothing))
    kernel = np.ones(2 * radius + 1) / (2 * radius + 1)
    padded = [extendedPath(path[:, k], radius) for k in range(2)]
    smooth = np.stack([np.convolve(p, kernel, "valid") for p in padded], axis=1)
    stray = np.percentile(np.abs(path - smooth), 99, axis=0)
    share = max(2 * stray[0] / size[0], 2 * stray[1] / size[1])
    return float(np.clip(100 * share + ZOOM_BUDGET_PADDING, MIN_ZOOM_BUDGET, MAX_ZOOM_BUDGET))


def zoomBudgetFromFile(transformsPath: str, smoothing: float) -> float:
    try:
        return zoomBudget(
            parseTransforms(Path(transformsPath).read_text(encoding="utf-8")), smoothing
        )
    except (OSError, TransformsFileError):
        return MAX_ZOOM_BUDGET


def zoomCandidates(budget: float, fallback: str = STALL_FALLBACK) -> list[str]:
    """The transform's zoom option texts to try in order: the budget, then for "nudge" the budget a
    nudge either way within the budget's range, and last the gaussian path, which always solves."""
    nudged = [
        budget + nudge
        for nudge in STALL_NUDGES
        if fallback == "nudge" and MIN_ZOOM_BUDGET <= budget + nudge <= MAX_ZOOM_BUDGET
    ]
    return [f"{zoom:.2f}" for zoom in (budget, *nudged)] + [GAUSSIAN_PATH]


def solvedZoom(candidates: Sequence[str], stalls: Callable[[str], bool]) -> str:
    """The first candidate whose camera path solves. Trials run only until one does."""
    return next((zoom for zoom in candidates[:-1] if not stalls(zoom)), candidates[-1])


def transformTrialLog(command: Sequence[str], cwd: str | None = None) -> str:
    """ffmpeg's log of this transform command run for one frame: vid.stab solves the whole camera
    path, and picks its zoom, when the filter starts."""
    return subprocess.run(
        [*command, "-frames:v", "1", "-an", "-f", "null", "-"],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=cwd,
        check=False,
    ).stderr


def transformStalls(command: Sequence[str], cwd: str | None = None) -> bool:
    """Whether vid.stab's L1 camera path fails to solve in this transform command. A command that
    fails otherwise counts as solved, so the transform pass runs as it would have and reports the
    failure."""
    return STALL_LINE in transformTrialLog(command, cwd)


def transformFinalZoom(command: Sequence[str], cwd: str | None = None) -> float | None:
    """The zoom vid.stab's gaussian camera path picks in this transform command."""
    return finalZoom(transformTrialLog(command, cwd))


def finalZoom(stderr: str) -> float | None:
    """The zoom vid.stab logs at the info level when its gaussian camera path runs (transform.c:687)."""
    found = FINAL_ZOOM_PATTERN.findall(stderr)
    return float(found[-1]) if found else None


def magnification(zoom: str, final: float | None = None) -> float:
    """How far a transform pass zoomed in, percent: the zoom option itself for vid.stab's L1 path,
    which crops a window 1 / (1 + zoom/100) of the frame (l1campathoptimization.c:519). vid.stab's
    gaussian path logs a Final zoom instead, a shrink of the sampled frame (1 - final/100), which
    magnifies by 1 / (1 - final/100)."""
    if final is not None:
        return 100 / (1 - final / 100) - 100
    return float(zoom)


def inputShakePath(transformsPath: str) -> str:
    """Where the repair keeps the input's shake, as a share of the frame's width, for checkStabilizedShake."""
    return f"{transformsPath}.shake"


def checkStabilizedShake(
    ffmpegPath: str, transformsPath: str, outputAnalysisPath: str, zoomBudget: float
) -> bool | None:
    """Whether the stabilized clip shakes more than its input, beyond SHAKE_TOLERANCE, measured the
    same way on both: from lossless analysis frames, as a lossy encode smooths grain away. The output
    analysis (the transform pass's, which it deletes) is zoomed in up to zoomBudget percent, which
    magnifies its shifts. None when either cannot be measured. Warns when it does."""
    try:
        inputShake = float(Path(inputShakePath(transformsPath)).read_text(encoding="utf-8"))
        output = readAnalysis(ffmpegPath, outputAnalysisPath)
    except (OSError, ValueError, TransformsFileError):
        return None
    finally:
        for path in (inputShakePath(transformsPath), outputAnalysisPath):
            with contextlib.suppress(OSError):
                Path(path).unlink()
    outputShake = shake(output)
    if outputShake is None:
        return None
    width = output[0].size[0]
    outputShake /= width * (1 + zoomBudget / 100)
    tolerance = max(SHAKE_TOLERANCE * inputShake, SHAKE_TOLERANCE_PX / width)
    logger.verbose(
        f"Video stabilization: shake {100 * inputShake:.2f}% of the frame's width a frame before, {100 * outputShake:.2f}% after."
    )
    if outputShake <= inputShake + tolerance:
        return False
    logger.warning(
        f"Video stabilization made this clip shakier ({100 * outputShake:.2f}% of the frame's width a frame,"
        f" against {100 * inputShake:.2f}% without it). Try this marker pair without video stabilization.",
    )
    return True


def readInputAnalysis(
    ffmpegPath: str, transformsPath: str, analysisPath: str
) -> list[FrameAnalysis] | None:
    """The detect pass's analysis output, which it then deletes, keeping the input's shake for
    checkStabilizedShake. None when it cannot be read."""
    # One left by an earlier run would pass for this run's input shake
    with contextlib.suppress(OSError):
        Path(inputShakePath(transformsPath)).unlink(missing_ok=True)
    try:
        analysis = readAnalysis(ffmpegPath, analysisPath)
    except (OSError, TransformsFileError) as error:
        logger.warning(f"Could not check the video stabilization motion ({error}).")
        return None
    finally:
        with contextlib.suppress(OSError):
            Path(analysisPath).unlink()
    if analysis and (inputShake := shake(analysis)) is not None:
        Path(inputShakePath(transformsPath)).write_text(
            f"{inputShake / analysis[0].size[0]}", encoding="utf-8"
        )
    return analysis


def repairMotionsInFiles(
    ffmpegPath: str,
    transformsPath: str,
    analysisPath: str,
    measure: bool = True,
) -> None:
    """Repairs a text transforms file in place from the detect pass's analysis output, which it then
    deletes: the motion across flashes, and fields that follow a subject instead of the camera.
    Leaves the transforms as they are when a file cannot be read, and the flashes when too much of
    the clip changes brightness to fill in the motion it could not measure. measure=False
    interpolates every untrusted frame and keeps every field, for comparison."""
    try:
        transforms = parseTransforms(Path(transformsPath).read_text(encoding="utf-8"))
    except (OSError, TransformsFileError) as error:
        logger.warning(f"Could not check the video stabilization motion ({error}).")
        for path in (analysisPath, inputShakePath(transformsPath)):
            with contextlib.suppress(OSError):
                Path(path).unlink()
        return
    analysis = readInputAnalysis(ffmpegPath, transformsPath, analysisPath)
    if analysis is None:
        return
    scale = analysisScale(transforms, analysis[0].size) if analysis else None
    measured = measuredMotions(analysis, scale) if measure and scale is not None else {}
    untrusted = (
        findBrightnessChanges([a.brightness for a in analysis])
        | findSparseFrames(transforms)
        | findDisagreeingFrames(transforms, measured)
    )
    unmeasured = untrusted - measured.keys()
    repaired = []
    if len(unmeasured) > MAX_UNMEASURED_SHARE * len(analysis):
        logger.notice(
            f"The video stabilization motion of {len(untrusted)} of {len(analysis)} frames is not trusted, too many to repair.",
        )
    elif repaired := repairMotions(transforms, untrusted, measured):
        logger.notice(
            f"Video stabilization: repaired the motion of {len(repaired)} frames it could not trust."
        )
    if refocused := keepFieldsMovingWithTheCamera(transforms, measured, skipped=untrusted):
        logger.verbose(
            f"Video stabilization: followed the camera instead of something moving on its own in {len(refocused)} frames.",
        )
    if repaired or refocused:
        Path(transformsPath).write_text(
            formatTransforms(transforms), encoding="utf-8", newline="\n"
        )
