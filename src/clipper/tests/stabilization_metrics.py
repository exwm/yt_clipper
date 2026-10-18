"""How much shake a stabilized clip has left, measured by phase correlation, which finds a frame's
shift exactly on the clips in shaky_media.py (checked against their truth in test_phase_correlation.py).
"""

import subprocess
from pathlib import Path

import numpy as np

from clipper import phase_correlation


def grayFrames(ffmpeg: str, video: Path, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width).astype(np.float64)


def phaseShift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    shift = phase_correlation.phaseShift(a, b)
    return (shift.dx, shift.dy)


def jitter(shifts: np.ndarray, radius: int = 7, skip: frozenset[int] = frozenset()) -> float:
    """RMS of per-frame shifts minus their moving average: shake, not intended motion like a pan.
    Frames in skip (a cut's) have no real shift: they take their neighbors' and are not counted."""
    shifts = shifts.copy()
    for i in skip:
        shifts[i] = (shifts[i - 1] + shifts[min(i + 1, len(shifts) - 1)]) / 2
    kernel = np.ones(2 * radius + 1) / (2 * radius + 1)
    trend = np.stack(
        [np.convolve(np.pad(shifts[:, k], radius, mode="edge"), kernel, "valid") for k in range(2)],
        1,
    )
    counted = [i for i in range(len(shifts)) if i not in skip]
    return float(np.sqrt(np.mean(np.sum((shifts[counted] - trend[counted]) ** 2, axis=1))))


def shakeLeft(video: np.ndarray, cutFrame: int | None = None) -> float:
    """Shake from one frame to the next, px/frame, leaving out the motion across a cut."""
    shifts = np.array(
        [(0.0, 0.0)] + [phaseShift(video[i - 1], video[i]) for i in range(1, len(video))],
    )
    return jitter(shifts, skip=frozenset({cutFrame}) if cutFrame else frozenset())


def motionAdded(source: np.ndarray, output: np.ndarray) -> float:
    """RMS of how far each output frame was moved from its source frame, px. Both must be zoomed alike."""
    shifts = np.array([phaseShift(a, b) for a, b in zip(source, output, strict=True)])
    return float(np.sqrt(np.mean(np.sum(shifts**2, axis=1))))
