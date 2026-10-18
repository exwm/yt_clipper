"""The shift between two frames by phase correlation.

Normalizing the cross-power spectrum keeps only phase, so the result ignores brightness and contrast
changes between the frames: it measures the shift across a flash, where vid.stab's block matching,
which compares brightness, fails.

A frame's spectrum can be computed once (spectrum) and paired with the next frame's (spectrumShift),
so a sequence of frames costs one transform per frame instead of two.
"""

import functools
from collections.abc import Iterable, Iterator
from typing import NamedTuple

import numpy as np


class FrameShift(NamedTuple):
    # How far the second frame's content is shifted from the first's, px
    dx: float
    dy: float
    # The correlation peak: near 1 for a clean match, near 0 when the frames share nothing
    peak: float


@functools.cache
def hannWindow(height: int, width: int) -> np.ndarray:
    return np.outer(np.hanning(height), np.hanning(width)).astype(np.float32)


def spectrum(frame: np.ndarray) -> np.ndarray:
    """The windowed frame's real Fourier transform, for spectrumShift."""
    frame = frame.astype(np.float32, copy=False)
    return np.fft.rfft2((frame - frame.mean()) * hannWindow(*frame.shape))


def spectrumShift(a: np.ndarray, b: np.ndarray, shape: tuple[int, int]) -> FrameShift:
    """The shift of b's content from a's, from their spectra and the frames' shape."""
    cross = a.conj() * b
    corr = np.fft.irfft2(cross / (np.abs(cross) + 1e-9), s=shape)
    peakY, peakX = np.unravel_index(np.argmax(corr), corr.shape)
    height, width = corr.shape

    def subpixel(line: np.ndarray, peak: int) -> float:
        left, mid, right = line[(peak - 1) % len(line)], line[peak], line[(peak + 1) % len(line)]
        denom = left - 2 * mid + right
        return peak + (0.5 * (left - right) / denom if abs(denom) > 1e-12 else 0.0)

    dx, dy = subpixel(corr[peakY, :], int(peakX)), subpixel(corr[:, peakX], int(peakY))
    return FrameShift(
        float(dx - width if dx > width / 2 else dx),
        float(dy - height if dy > height / 2 else dy),
        float(corr[peakY, peakX]),
    )


def phaseShift(a: np.ndarray, b: np.ndarray) -> FrameShift:
    """The shift of b's content from a's, to about a tenth of a pixel, for gray frames of one size."""
    return spectrumShift(spectrum(a), spectrum(b), a.shape)


def consecutiveShifts(frames: Iterable[np.ndarray]) -> Iterator[FrameShift]:
    """Each frame's shift from the frame before, one transform per frame."""
    previous = None
    for frame in frames:
        current = spectrum(frame)
        if previous is not None:
            yield spectrumShift(previous, current, frame.shape)
        previous = current
