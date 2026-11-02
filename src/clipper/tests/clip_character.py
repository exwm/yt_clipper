"""Measured traits of a clip that matter to video stabilization, shared by the synthetic clips'
specs (shaky_media.py) and the survey of real clips that the specs are drawn from.

Each trait is one number per clip. A synthetic clip's spec gives the range its trait must fall in,
taken from the real clips it stands for, and keeps every other trait at the plain clip's level, so
each clip tests one thing.
"""

import itertools
import statistics
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from clipper.phase_correlation import phaseShift
from clipper.vidstab_motions import findBrightnessChanges

# A frame pair with a lower peak shares nothing: a cut, or a frame too blurred or plain to match
NO_MATCH_PEAK = 0.05
# Mean absolute difference below which a frame repeats the one before (8-bit levels)
REPEAT_DIFFERENCE = 0.3


@dataclass(frozen=True)
class Character:
    # Median of the frames' mean brightness (of 255)
    brightness: float
    # Share of frame pairs whose brightness changes sharply (vid_stab_motions' threshold)
    brightness_changes: float
    # Largest change in brightness from one frame to the next, relative to the darker of the two
    brightness_jump: float
    # Median of the frames' brightness standard deviation
    contrast: float
    # Share of frames that repeat the frame before
    repeats: float
    # Share of frame pairs that match nothing
    no_match: float
    # 90th percentile of the shift between frames, px at the clip's own size
    motion: float
    # Median of what is left between frames once their shift is undone: grain and compression noise,
    # and also changing light, objects moving on their own, and rotation
    grain: float
    # Median of how far the middle of the frame moves apart from its edges, px: a subject moving on
    # its own (dancers in a fan cam), over frames whose edges agree on the camera's motion
    subject_motion: float


def residual(previous: np.ndarray, frame: np.ndarray, dx: float, dy: float) -> float:
    """Mean difference between the frame and the one before moved by the shift, away from the edges."""
    moved = np.roll(previous, (round(dy), round(dx)), axis=(0, 1))
    margin = int(max(abs(dx), abs(dy))) + 2
    inner = (slice(margin, -margin), slice(margin, -margin))
    return float(np.abs(frame[inner] - moved[inner]).mean())


def cells(frame: np.ndarray) -> list[np.ndarray]:
    """The frame's 3x3 grid of cells, row by row."""
    height, width = frame.shape[0] // 3, frame.shape[1] // 3
    return [
        frame[r * height : (r + 1) * height, c * width : (c + 1) * width]
        for r in range(3)
        for c in range(3)
    ]


def subjectMotion(previous: np.ndarray, frame: np.ndarray) -> float | None:
    """How far the middle cell moved apart from the edge cells' median shift, when 5 of the 8 edge
    cells agree on it within 1 px."""
    shifts = [phaseShift(a, b) for a, b in zip(cells(previous), cells(frame), strict=True)]
    edges = [s for i, s in enumerate(shifts) if i != 4 and s.peak >= NO_MATCH_PEAK]
    if len(edges) < 5:
        return None
    dx, dy = statistics.median(s.dx for s in edges), statistics.median(s.dy for s in edges)
    if sum(np.hypot(s.dx - dx, s.dy - dy) <= 1 for s in edges) < 5:
        return None
    return float(np.hypot(shifts[4].dx - dx, shifts[4].dy - dy))


def measure(frames: np.ndarray) -> Character:
    """The traits of gray frames (frames x height x width)."""
    brightness = [float(f.mean()) for f in frames]
    shifts = [phaseShift(frames[i - 1], frames[i]) for i in range(1, len(frames))]
    differences = [float(np.abs(frames[i] - frames[i - 1]).mean()) for i in range(1, len(frames))]
    jumps = [abs(b - a) / max(1.0, min(a, b)) for a, b in itertools.pairwise(brightness)]
    matched = [i for i, s in enumerate(shifts, start=1) if s.peak >= NO_MATCH_PEAK]
    subject = [
        m
        for i in range(1, len(frames))
        if (m := subjectMotion(frames[i - 1], frames[i])) is not None
    ]
    return Character(
        brightness=statistics.median(brightness),
        brightness_changes=len(findBrightnessChanges(brightness)) / max(1, len(frames) - 1),
        brightness_jump=max(jumps, default=0.0),
        contrast=float(np.median([f.std() for f in frames])),
        repeats=float(np.mean([d < REPEAT_DIFFERENCE for d in differences])),
        no_match=float(np.mean([s.peak < NO_MATCH_PEAK for s in shifts])),
        motion=float(np.percentile([np.hypot(s.dx, s.dy) for s in shifts], 90)),
        grain=statistics.median(
            residual(frames[i - 1], frames[i], shifts[i - 1].dx, shifts[i - 1].dy) for i in matched
        )
        if matched
        else float("nan"),
        subject_motion=statistics.median(subject) if subject else float("nan"),
    )


def asDict(character: Character) -> dict[str, float]:
    return asdict(character)


def fieldConsensus(ffmpeg: str, video: Path, seconds: float | None = None) -> float:
    """Median over frames of the share of vid.stab's fields within 2 px of the frame's median motion,
    with the clipper's detect filter at the clip's own size. Clean footage agrees (near 1); blur,
    compression and moving subjects scatter the fields (real fan cams: 0.01 to 0.34)."""
    # Imported here: argparser pulls in the clipper's settings, which the frame-only traits do not need
    from clipper.argparser import getArgParser, getVidstabPreset
    from clipper.ffmpeg_filter import getVideoStabilizationFilters, videoStabilizationGammaFixFilter
    from clipper.vidstab_motions import frameShift, parseTransforms

    parser = getArgParser()
    keys = (
        "videoStabilizationMaxAngle",
        "videoStabilizationMaxShift",
        "videoStabilizationDynamicZoom",
    )
    mps = {"videoStabilization": getVidstabPreset(3), **{k: parser.get_default(k) for k in keys}}
    detect, _ = getVideoStabilizationFilters(mps, "consensus.trf", textTransforms=True)
    with tempfile.TemporaryDirectory() as folder:
        limit = ["-t", str(seconds)] if seconds else []
        subprocess.run(
            [ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *limit, "-i", str(video),
             "-vf", videoStabilizationGammaFixFilter(detect), "-f", "null", "-"],
            check=True, cwd=folder,
        )  # fmt: skip
        frames = parseTransforms(
            (Path(folder) / "consensus.trf").read_text(encoding="utf-8")
        ).frames
    shares = []
    for motions in frames[1:]:
        if motions:
            dx, dy = frameShift(motions)
            shares.append(float(np.mean([np.hypot(m.dx - dx, m.dy - dy) <= 2 for m in motions])))
    return statistics.median(shares) if shares else float("nan")
