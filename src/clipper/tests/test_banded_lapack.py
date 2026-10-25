import sys

import numpy as np
import pytest

from clipper import banded_lapack, cinematic_path


def _denseOf(upperBand: np.ndarray) -> np.ndarray:
    kd = upperBand.shape[0] - 1
    dense = np.diag(upperBand[kd])
    for offset in range(1, kd + 1):
        diagonal = upperBand[kd - offset, offset:]
        dense += np.diag(diagonal, offset) + np.diag(diagonal, -offset)
    return dense


@pytest.mark.skipif(sys.platform not in ("win32", "darwin"), reason="the release platforms")
def test_the_release_platforms_load_numpys_banded_lapack() -> None:
    # A numpy upgrade that renames numpy's bundled OpenBLAS symbols lands here, not in a slow release.
    assert banded_lapack.lapack() is not None


def test_banded_cholesky_solves_like_a_dense_solve() -> None:
    if banded_lapack.lapack() is None:
        pytest.skip("no banded LAPACK in this numpy")
    n = 300
    band = cinematic_path._systemUpperBand(n)
    rhs = np.random.default_rng(0).normal(size=n)
    solve = banded_lapack.bandedCholeskySolver(band)
    assert solve is not None
    assert solve(rhs) == pytest.approx(np.linalg.solve(_denseOf(band), rhs), abs=1e-9)


def test_a_banded_lapack_that_solves_wrongly_is_not_used() -> None:
    # A wrong calling convention gives a wrong answer, not an error.
    found = banded_lapack.lapack()
    if found is None:
        pytest.skip("no banded LAPACK in this numpy")
    assert banded_lapack._solvesCorrectly(found)
    assert not banded_lapack._solvesCorrectly(found._replace(solve=lambda _band, _n, _kd, _rhs: 0))


def test_banded_cholesky_declines_a_matrix_that_is_not_positive_definite() -> None:
    if banded_lapack.lapack() is None:
        pytest.skip("no banded LAPACK in this numpy")
    band = np.zeros((4, 10))
    band[3] = -1.0
    assert banded_lapack.bandedCholeskySolver(band) is None


def test_the_system_band_is_the_dense_system() -> None:
    n = 40
    differences = [np.diff(np.eye(n), n=order, axis=0) for order in (1, 2, 3)]
    dense = np.eye(n) + sum(d.T @ d for d in differences)
    assert np.array_equal(_denseOf(cinematic_path._systemUpperBand(n)), dense)


def test_without_banded_lapack_a_run_too_long_to_solve_densely_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    # Fails at once, so the clipper renders the pair with Smooth Track instead of hanging.
    monkeypatch.setattr(banded_lapack, "bandedCholeskySolver", lambda _band: None)
    assert cinematic_path._systemSolver(cinematic_path.DENSE_SOLVE_MAX_SAMPLES) is not None
    with pytest.raises(RuntimeError, match="banded solve is unavailable"):
        cinematic_path._systemSolver(cinematic_path.DENSE_SOLVE_MAX_SAMPLES + 1)


def test_without_banded_lapack_a_pair_with_a_run_too_long_fails_before_solving(monkeypatch: pytest.MonkeyPatch) -> None:
    # A cut splits it into a run the dense fallback solves (2001 samples), then one it cannot.
    monkeypatch.setattr(banded_lapack, "lapack", lambda: None)
    solved: list[int] = []
    monkeypatch.setattr(cinematic_path, "_systemSolver", solved.append)
    cropMap = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": 199.9, "y": 0, "crop": "600:300:640:360"},
        {"x": 200.0, "y": 0, "crop": "900:300:640:360", "easeIn": "instant"},
        {"x": 400.1, "y": 0, "crop": "700:300:640:360"},
    ]
    assert [cinematic_path.gridSampleCount(run[-1]["x"] - run[0]["x"]) for run in cinematic_path.splitAtInstantCuts(cropMap, 30)] == [
        2001,
        2002,
    ]
    with pytest.raises(RuntimeError, match="banded solve is unavailable"):
        cinematic_path.bakeCinematicPath(cropMap, {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps=30)
    assert solved == []


def test_the_clipper_warns_once_when_it_solves_without_banded_lapack(monkeypatch: pytest.MonkeyPatch) -> None:
    from clipper import clip_maker

    warnings: list[str] = []
    monkeypatch.setattr(banded_lapack, "lapack", lambda: None)
    monkeypatch.setattr(clip_maker.logger, "warning", warnings.append)
    clip_maker._warnOfDenseCinematicSolve.cache_clear()
    clip_maker._bakeCinematicPathFromKey.cache_clear()
    cropMap = [{"x": 0, "y": 0, "crop": "100:300:640:360"}, {"x": 2, "y": 0, "crop": "600:300:640:360"}]
    for fps in (30, 60):
        clip_maker._bakeCinematicPath(cropMap, {"pos": 0.12, "zoom": 0.08}, 1920, 1080, fps, 0.0)
    clip_maker._warnOfDenseCinematicSolve.cache_clear()
    clip_maker._bakeCinematicPathFromKey.cache_clear()
    assert len(warnings) == 1
    assert "Smooth Track" in warnings[0]


def test_the_cinematic_path_is_the_same_without_banded_lapack(monkeypatch: pytest.MonkeyPatch) -> None:
    cropMap = [
        {"x": 0, "y": 0, "crop": "100:300:640:360"},
        {"x": 2.03, "y": 0, "crop": "600:300:640:360"},
        {"x": 3.07, "y": 0, "crop": "600:300:640:360", "firmHold": True},
        {"x": 5.07, "y": 0, "crop": "1200:200:800:450"},
    ]
    margins = {"pos": 0.12, "zoom": 0.08}
    fast = cinematic_path.bakeCinematicPath(cropMap, margins, 1920, 1080, fps=30)
    monkeypatch.setattr(banded_lapack, "bandedCholeskySolver", lambda _band: None)
    dense = cinematic_path.bakeCinematicPath(cropMap, margins, 1920, 1080, fps=30)
    assert fast is not None
    assert dense is not None
    for step in range(102):
        t = step * 0.05
        assert cinematic_path.evalCropPathAtTime(fast, t) == pytest.approx(cinematic_path.evalCropPathAtTime(dense, t), abs=1e-6)
