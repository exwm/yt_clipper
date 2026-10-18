"""Repairs the motion vid.stab measured across flashes before it stabilizes a clip.

vid.stab matches small fields of each frame against the frame before by their brightness, so a
flash, which brightens the whole frame, makes every field match the wrong place and the clip jerks
there. vidstabdetect writes the motion it measured to a transforms file (fileformat=1 for text).
The detect command also writes the middle of each frame, in gray, to a small analysis file. Before
vidstabtransform reads the transforms, the motion into and out of each flash frame (found from the
frames' brightness) is measured again from the analysis frames with phase correlation, which
ignores brightness, or else interpolated from the motion around it.
"""

import contextlib
import re
import statistics
import subprocess
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import IO

import numpy as np

from clipper.phase_correlation import FrameShift, phaseShift
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)

# The most of each frame the analysis output keeps, from its middle, px
ANALYSIS_SIZE = (384, 216)
# Shifts with a lower correlation peak are not trusted (random frames peak near 0.04 at ANALYSIS_SIZE)
MIN_PEAK = 0.08

# vid.stab's motion into a frame is not trusted when the frame's mean brightness changed this much
# from the frame before: at least BRIGHTNESS_MIN_CHANGE levels (of 255) and BRIGHTNESS_RELATIVE_CHANGE
# of the darker frame. A flash changes it twice (on, off); a light coming on once, or for several frames.
BRIGHTNESS_MIN_CHANGE = 4
BRIGHTNESS_RELATIVE_CHANGE = 0.05
# With more frames than this unmeasured, the motion around them is too sparse to stand in for them
MAX_UNMEASURED_SHARE = 0.3

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
    """One frame of the detect pass's analysis output: the middle of the frame, in gray."""

    brightness: float
    # The shift of its content from the frame before's, in the frame's own pixels. None for the first.
    shift: FrameShift | None


def analysisFilter() -> str:
    """Filters after the clip's own, for the analysis output: the frame's middle, uncropped up to
    ANALYSIS_SIZE, so shifts are in the same pixels as vid.stab's fields."""
    width, height = ANALYSIS_SIZE
    return f"crop=w='min(iw,{width})':h='min(ih,{height})',format=gray"


def analysisOutputArgs(filterArgs: str, analysisPath: str) -> str:
    """A second output for the detect command: the same frames, decoded once, losslessly to a small
    file. filterArgs gives the clip's filters followed by analysisFilter(), with -vf or -filter_script:v."""
    return f' -an -sn {filterArgs} -c:v ffv1 -f nut -y "{analysisPath}"'


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
        yield np.frombuffer(pixels, np.uint8).reshape(height, width).astype(np.float64)


def readAnalysis(ffmpegPath: str, analysisPath: str) -> list[FrameAnalysis]:
    """Each frame's brightness and shift from the analysis output, two frames in memory at a time."""
    command = [
        ffmpegPath,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        analysisPath,
        "-f",
        "image2pipe",
        "-c:v",
        "pgm",
        "-",
    ]
    analysis: list[FrameAnalysis] = []
    with subprocess.Popen(command, stdout=subprocess.PIPE) as process:
        assert process.stdout is not None
        previous = None
        for frame in readPgmFrames(process.stdout):
            shift = phaseShift(previous, frame) if previous is not None else None
            analysis.append(FrameAnalysis(float(frame.mean()), shift))
            previous = frame
    if process.returncode:
        raise TransformsFileError(f"could not read {analysisPath}")
    return analysis


def measuredMotions(analysis: Sequence[FrameAnalysis]) -> dict[int, tuple[float, float]]:
    """vid.stab's motion for each frame (from 1) whose shift the analysis measured with confidence.
    vid.stab's field motion is the opposite of the content's shift."""
    return {
        i + 1: (-a.shift.dx, -a.shift.dy)
        for i, a in enumerate(analysis)
        if a.shift is not None and a.shift.peak >= MIN_PEAK
    }


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


def repairFlashFramesInFiles(
    ffmpegPath: str,
    transformsPath: str,
    analysisPath: str,
    measure: bool = True,
) -> None:
    """Repairs a text transforms file in place from the detect pass's analysis output, which it then
    deletes. Leaves the transforms as they are when a file cannot be read, or when too much of the
    clip changes brightness to fill in the motion it could not measure. measure=False interpolates
    every untrusted frame, for comparison."""
    try:
        transforms = parseTransforms(Path(transformsPath).read_text(encoding="utf-8"))
        analysis = readAnalysis(ffmpegPath, analysisPath)
    except (OSError, TransformsFileError) as error:
        logger.warning(f"Could not check the video stabilization motion for flashes ({error}).")
        return
    finally:
        with contextlib.suppress(OSError):
            Path(analysisPath).unlink()
    untrusted = findBrightnessChanges([a.brightness for a in analysis])
    if not untrusted:
        return
    measured = measuredMotions(analysis) if measure else {}
    unmeasured = untrusted - measured.keys()
    if len(unmeasured) > MAX_UNMEASURED_SHARE * len(analysis):
        logger.notice(
            f"The brightness of {len(untrusted)} of {len(analysis)} frames changes sharply, too many to repair"
            " the video stabilization motion across them.",
        )
        return
    if repaired := repairMotions(transforms, untrusted, measured):
        Path(transformsPath).write_text(
            formatTransforms(transforms),
            encoding="utf-8",
            newline="\n",
        )
        logger.notice(
            f"Video stabilization: measured the motion again across {len(repaired)} frames where the brightness changes sharply.",
        )
