"""The shift between two frames by phase correlation.

Normalizing the cross-power spectrum keeps only phase, so the result ignores brightness and contrast
changes between the frames: it measures the shift across a flash, where vid.stab's block matching,
which compares brightness, fails.
"""

from typing import NamedTuple

import numpy as np


class FrameShift(NamedTuple):
    # How far the second frame's content is shifted from the first's, px
    dx: float
    dy: float
    # The correlation peak: near 1 for a clean match, near 0 when the frames share nothing
    peak: float


def phaseShift(a: np.ndarray, b: np.ndarray) -> FrameShift:
    """The shift of b's content from a's, to about a tenth of a pixel, for gray frames of one size."""
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
    return FrameShift(
        dx - width if dx > width / 2 else dx,
        dy - height if dy > height / 2 else dy,
        float(corr[peakY, peakX]),
    )
