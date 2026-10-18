"""How much shake a stabilized clip has left, measured by phase correlation.

Phase correlation normalizes the cross-power spectrum, so it ignores brightness and contrast changes
and finds a frame's shift exactly on the clips in shaky_media.py.
"""

import subprocess
from pathlib import Path

import numpy as np


def grayFrames(ffmpeg: str, video: Path, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    raw = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout  # fmt: skip
    return np.frombuffer(raw, np.uint8).reshape(-1, height, width).astype(np.float64)


def phaseShift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """How far b's content is shifted from a's, to a tenth of a pixel."""
    window = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    cross = np.fft.fft2((a - a.mean()) * window).conj() * np.fft.fft2((b - b.mean()) * window)
    corr = np.fft.ifft2(cross / (np.abs(cross) + 1e-9)).real
    peakY, peakX = np.unravel_index(np.argmax(corr), corr.shape)
    height, width = corr.shape

    def subpixel(line: np.ndarray, peak: int) -> float:
        left, mid, right = line[(peak - 1) % len(line)], line[peak], line[(peak + 1) % len(line)]
        denom = left - 2 * mid + right
        return peak + (0.5 * (left - right) / denom if abs(denom) > 1e-12 else 0.0)

    dx, dy = subpixel(corr[peakY, :], peakX), subpixel(corr[:, peakX], peakY)
    return (dx - width if dx > width / 2 else dx, dy - height if dy > height / 2 else dy)


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
