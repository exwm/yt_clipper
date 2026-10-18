import shutil
from pathlib import Path

import numpy as np
import pytest

from clipper.phase_correlation import phaseShift
from clipper.tests import shaky_media
from clipper.tests.stabilization_metrics import grayFrames


@pytest.fixture(scope="session")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    return path


@pytest.mark.parametrize("name", ["plain", "flash", "dim", "darkdim"])
def test_phase_correlation_finds_each_frames_true_shift(
    ffmpeg: str,
    tmp_path: Path,
    name: str,
) -> None:
    # The window moves over the scene, so the content moves the other way
    video = grayFrames(
        ffmpeg,
        shaky_media.makeShakyClip(ffmpeg, name, tmp_path),
        (shaky_media.WIDTH, shaky_media.HEIGHT),
    )
    window = np.array(shaky_media.windowPath(steady=False), dtype=np.float64)
    truth = -(window[1:] - window[:-1])
    shifts = [phaseShift(video[i - 1], video[i]) for i in range(1, len(video))]
    assert np.abs(np.array([(s.dx, s.dy) for s in shifts]) - truth).max() < 0.2
    assert min(s.peak for s in shifts) > 0.1


def test_frames_with_nothing_in_common_have_a_low_peak() -> None:
    rng = np.random.default_rng(1)
    assert phaseShift(rng.random((216, 384)), rng.random((216, 384))).peak < 0.05
