"""LAPACK's banded Cholesky (dpbtrf, dpbtrs), from the BLAS that numpy already loads.

numpy does not expose banded solvers, but its wheels ship a full LAPACK: OpenBLAS in numpy.libs (Windows,
Linux) or numpy/.dylibs (macOS before 14), or Apple's Accelerate on macOS 14 and later. Calling it
through ctypes solves a banded system in linear time without adding scipy to the release. The OpenBLAS
symbol names are numpy's packaging detail, so a numpy upgrade can rename them: callers fall back to a
dense solve when this returns None, and test_banded_lapack.py fails if the fast path is lost.
"""

import ctypes
import functools
import sys
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple, Optional

import numpy as np

ACCELERATE = "/System/Library/Frameworks/Accelerate.framework/Accelerate"
_COL_MAJOR = 102

_double_p = ctypes.POINTER(ctypes.c_double)
_int64 = ctypes.c_int64
_int64_p = ctypes.POINTER(ctypes.c_int64)


class _Lapack(NamedTuple):
    name: str
    factor: Callable[[np.ndarray, int, int], int]
    solve: Callable[[np.ndarray, int, int, np.ndarray], int]


def _openBlasPaths() -> list[Path]:
    numpyDir = Path(np.__file__).parent
    folders = [numpyDir.parent / "numpy.libs", numpyDir / ".dylibs"]
    # A frozen clipper unpacks numpy's libraries under its own folder.
    frozenRoot = getattr(sys, "_MEIPASS", None)
    if frozenRoot:
        folders += [Path(frozenRoot) / "numpy.libs", Path(frozenRoot) / "numpy" / ".dylibs", Path(frozenRoot)]
    return [path for folder in folders for path in sorted(folder.glob("libscipy_openblas64_*"))]


def _openBlas(path: Path) -> Optional[_Lapack]:
    try:
        lib = ctypes.CDLL(str(path))
        dpbtrf = lib.scipy_LAPACKE_dpbtrf64_
        dpbtrs = lib.scipy_LAPACKE_dpbtrs64_
    except (OSError, AttributeError):
        return None
    dpbtrf.argtypes = [ctypes.c_int, ctypes.c_char, _int64, _int64, _double_p, _int64]
    dpbtrf.restype = _int64
    dpbtrs.argtypes = [ctypes.c_int, ctypes.c_char, _int64, _int64, _int64, _double_p, _int64, _double_p, _int64]
    dpbtrs.restype = _int64

    def factor(band: np.ndarray, n: int, kd: int) -> int:
        return dpbtrf(_COL_MAJOR, b"U", n, kd, band.ctypes.data_as(_double_p), kd + 1)

    def solve(band: np.ndarray, n: int, kd: int, rhs: np.ndarray) -> int:
        return dpbtrs(_COL_MAJOR, b"U", n, kd, 1, band.ctypes.data_as(_double_p), kd + 1, rhs.ctypes.data_as(_double_p), n)

    return _Lapack(f"OpenBLAS ({path.name})", factor, solve)


def _accelerate() -> Optional[_Lapack]:
    # The ILP64 interface numpy itself uses: Fortran calling convention, every argument by pointer.
    try:
        lib = ctypes.CDLL(ACCELERATE)
        dpbtrf = getattr(lib, "dpbtrf$NEWLAPACK$ILP64")
        dpbtrs = getattr(lib, "dpbtrs$NEWLAPACK$ILP64")
    except (OSError, AttributeError):
        return None
    dpbtrf.argtypes = [ctypes.c_char_p, _int64_p, _int64_p, _double_p, _int64_p, _int64_p]
    dpbtrf.restype = None
    dpbtrs.argtypes = [ctypes.c_char_p, _int64_p, _int64_p, _int64_p, _double_p, _int64_p, _double_p, _int64_p, _int64_p]
    dpbtrs.restype = None

    def factor(band: np.ndarray, n: int, kd: int) -> int:
        info = _int64(0)
        dpbtrf(b"U", _int64(n), _int64(kd), band.ctypes.data_as(_double_p), _int64(kd + 1), ctypes.byref(info))
        return info.value

    def solve(band: np.ndarray, n: int, kd: int, rhs: np.ndarray) -> int:
        info = _int64(0)
        dpbtrs(
            b"U", _int64(n), _int64(kd), _int64(1), band.ctypes.data_as(_double_p), _int64(kd + 1),
            rhs.ctypes.data_as(_double_p), _int64(n), ctypes.byref(info),
        )
        return info.value

    return _Lapack("Accelerate", factor, solve)


def _solvesCorrectly(found: _Lapack) -> bool:
    """Whether the routines solve a small system with a known answer. A wrong calling convention
    usually gives a wrong answer, not an error, so this catches it before any path is solved."""
    n, kd = 12, 2
    band = np.zeros((kd + 1, n), order="F")
    band[kd] = 6.0
    band[kd - 1, 1:] = -2.0
    band[kd - 2, 2:] = 1.0
    expected = np.arange(1.0, n + 1)
    dense = np.diag(band[kd]) + np.diag(band[kd - 1, 1:], 1) + np.diag(band[kd - 1, 1:], -1)
    dense += np.diag(band[kd - 2, 2:], 2) + np.diag(band[kd - 2, 2:], -2)
    rhs = dense @ expected
    if found.factor(band, n, kd) != 0 or found.solve(band, n, kd, rhs) != 0:
        return False
    return bool(np.allclose(rhs, expected, rtol=0, atol=1e-9))


@functools.cache
def lapack() -> Optional[_Lapack]:
    """The first banded Cholesky that loads and solves correctly, or None."""
    candidates = [_openBlas(path) for path in _openBlasPaths()]
    if sys.platform == "darwin":
        candidates.append(_accelerate())
    return next((found for found in candidates if found and _solvesCorrectly(found)), None)


def description() -> str:
    """Which solve the Cinematic path uses, for --print-versions."""
    found = lapack()
    return f"banded LAPACK, {found.name}" if found else "dense (no banded LAPACK found)"


def bandedCholeskySolver(upperBand: np.ndarray) -> Optional[Callable[[np.ndarray], np.ndarray]]:
    """A solver for the symmetric positive definite banded matrix whose upper band is given in LAPACK's
    column-major layout (upperBand[kd + i - j, j] = M[i, j]), factored once. None when no LAPACK loads
    or the factorization fails."""
    found = lapack()
    if found is None:
        return None
    kd = upperBand.shape[0] - 1
    n = upperBand.shape[1]
    band = np.array(upperBand, dtype=np.float64, order="F")
    if found.factor(band, n, kd) != 0:
        return None

    def solve(rhs: np.ndarray) -> np.ndarray:
        x = np.array(rhs, dtype=np.float64)
        if found.solve(band, n, kd, x) != 0:
            raise ArithmeticError("banded Cholesky solve failed")
        return x

    return solve
