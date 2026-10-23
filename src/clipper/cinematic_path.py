"""The L1 optimal camera path of the Cinematic crop easing, solved in the clipper.

It approximates a marker pair's crop points within a margin while minimizing the L1 norm of the
path's velocity, acceleration, and jerk, so the result is a few deliberate segments: steady holds,
constant-velocity pans, constant-acceleration transitions (Grundmann, Kwatra, Essa 2011). Solved per
component (x, y, w) with ADMM (box-constrained L1 trend filtering), then fitted with the fewest
piecewise-quadratic segments, which getCropPathFilter renders.

A port of the markup's src/markup/crop/cinematic-path.ts, which solves the same path for the preview.
Keep the two in step: test_cinematic_path.py checks both against cinematic_path_parity.json. Bump
SOLVER_VERSION in both when the result changes, so files previewed with another version get a warning.
"""

import math
import os
from collections.abc import Sequence
from typing import Any, Optional

# The solve's matrices are a few hundred rows, where OpenBLAS's threads cost more than they save: one
# thread solves 1.6x faster on an idle machine and 3 to 6x under load. Set before numpy loads OpenBLAS.
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

import numpy as np

SOLVER_VERSION = 1

# Grid the path is sampled on. It only quantizes where holds and pans start, so a moderate rate is
# plenty; the sample count is capped so a long clip still solves quickly.
GRID_RATE_HZ = 10
MIN_SAMPLES = 8
MAX_SAMPLES = 400

# Objective weights on velocity, acceleration, and jerk, tuned at the 10 Hz grid. Jerk is penalized
# hardest so transitions are smooth ramps; velocity moderately so the path prefers to hold.
WEIGHTS = (10.0, 1.0, 100.0)
# A gentle pull of the crop toward the crop points inside the margins, at the 10 Hz grid: smooths as
# a wide margin does while keeping the crop closer to where the points frame the subject. On the size
# it also lets the solve converge within MAX_ITERS, which a wide zoom margin otherwise does not.
CROP_POINT_FIDELITY = 0.01

# How far a fitted segment may sit from the solved samples (cropRes px). Sub-pixel, so invisible.
SEGMENT_FIT_TOLERANCE_PX = 0.4

# The smallest crop the markup draws (Crop.minW, Crop.minH), in cropRes px.
MIN_CROP_WIDTH = 20
MIN_CROP_HEIGHT = 20
# ffmpeg's zoompan clamps its zoom to 10, so the render shows no crop narrower than a tenth of the
# path's widest.
ZOOMPAN_MAX_ZOOM = 10

# Both margins are shares of the crop size: the position may drift by a share of the crop's shorter
# side (in x and y), the size by a share of itself. Settings hold them as percentages.
DEFAULT_MARGIN_PERCENT = 12
DEFAULT_ZOOM_MARGIN_PERCENT = 8
DEFAULT_MARGIN = DEFAULT_MARGIN_PERCENT / 100
DEFAULT_ZOOM_MARGIN = DEFAULT_ZOOM_MARGIN_PERCENT / 100

RHO_INIT = 1.0
MAX_ITERS = 1000
# Stop when both residuals are within an absolute plus a relative tolerance (Boyd 2011, 3.3.1).
RESIDUAL_ABS_TOL = 1e-4
RESIDUAL_REL_TOL = 1e-4
# Residual balancing (Boyd 2011): keep the primal and dual residuals within 10x of each other.
BALANCE_RATIO = 10
RHO_STEP = 2
# Balance only this long, then keep rho fixed. ADMM converges only once rho stops changing; on short
# runs (between instant cuts) balancing never settled, so the solve ran to MAX_ITERS and fell short
# of the optimum.
RHO_BALANCE_ITERS = 100

CropPoint = dict[str, Any]
Segment = dict[str, Any]


def _roundHalfUp(value: float) -> int:
    """Rounds like JavaScript's Math.round, which the markup uses (Python rounds halves to even)."""
    # Not floor(value + 0.5): the addition rounds 0.49999999999999994 up to 1.
    whole = math.floor(value)
    return whole + (value - whole >= 0.5)


def parseCropToComponents(
    crop: str,
    cropResWidth: int,
    cropResHeight: int,
) -> tuple[int, int, int, int]:
    """A "x:y:w:h" crop string as cropRes pixels, resolving iw and ih."""

    def resolve(part: str, axisMax: int) -> int:
        if part == "iw":
            return cropResWidth
        if part == "ih":
            return cropResHeight
        return min(_roundHalfUp(float(part)), axisMax)

    x, y, w, h = crop.split(":")
    width = resolve(w, cropResWidth)
    height = resolve(h, cropResHeight)
    # A hand-edited crop can reach past the frame edge, where ffmpeg's crop clamps the render.
    return (
        max(0, min(resolve(x, cropResWidth), cropResWidth - width)),
        max(0, min(resolve(y, cropResHeight), cropResHeight - height)),
        width,
        height,
    )


def _interpolateAtGrid(
    times: list[float],
    values: list[float],
    gridTimes: np.ndarray,
) -> np.ndarray:
    """Piecewise-linear interpolation of the points at each grid time (times sorted)."""
    out = np.empty(len(gridTimes))
    j = 0
    for i, t in enumerate(gridTimes):
        while j < len(times) - 2 and times[j + 1] < t:
            j += 1
        span = times[j + 1] - times[j]
        frac = (t - times[j]) / span if span > 0 else 0.0
        out[i] = values[j] + (values[j + 1] - values[j]) * min(max(frac, 0.0), 1.0)
    return out


def _softThreshold(values: np.ndarray, kappa: float) -> np.ndarray:
    return np.sign(values) * np.maximum(np.abs(values) - kappa, 0.0)


def solveL1Path(
    target: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
    weights: Sequence[float] = WEIGHTS,
    fidelity: float = 0.0,
) -> np.ndarray:
    """Minimizes w1|D1 p| + w2|D2 p| + w3|D3 p| subject to lower <= p <= upper, by ADMM with rho
    balanced early, then fixed. Returns the box-feasible consensus, so the path always respects the
    margin and the frame. With fidelity, also adds (fidelity / 2) |p - target|^2: a pull toward the
    target inside the box."""
    n = len(target)
    if n <= 3:
        return np.clip(target, lower, upper)

    differences = [np.diff(np.eye(n), n=order, axis=0) for order in (1, 2, 3)]
    system = np.eye(n) + sum(d.T @ d for d in differences)
    systemInverse = np.linalg.inv(system)

    q = np.clip(target, lower, upper)
    uq = np.zeros(n)
    z = [np.zeros(n - order) for order in (1, 2, 3)]
    uz = [np.zeros(n - order) for order in (1, 2, 3)]
    totalVars = (n - 1) + (n - 2) + (n - 3) + n
    rho = RHO_INIT
    kappa = [weight / rho for weight in weights]

    for iteration in range(MAX_ITERS):
        rhs = sum(d.T @ (zk - uzk) for d, zk, uzk in zip(differences, z, uz)) + (q - uq)
        p = systemInverse @ rhs

        primalSq = 0.0
        dualChangeSq = 0.0
        # The sizes the residuals are relative to: of the iterates, and of the duals (y = rho * u).
        primalScaleSq = 0.0
        for k, d in enumerate(differences):
            dp = d @ p
            zNew = _softThreshold(dp + uz[k], kappa[k])
            uz[k] += dp - zNew
            primalSq += float((dp - zNew) @ (dp - zNew))
            dualChangeSq += float((zNew - z[k]) @ (zNew - z[k]))
            primalScaleSq += max(float(dp @ dp), float(zNew @ zNew))
            z[k] = zNew
        # The box projection of the fidelity term's proximal step.
        qNew = np.clip((fidelity * target + rho * (p + uq)) / (fidelity + rho), lower, upper)
        uq += p - qNew
        primalSq += float((p - qNew) @ (p - qNew))
        dualChangeSq += float((qNew - q) @ (qNew - q))
        primalScaleSq += max(float(p @ p), float(qNew @ qNew))
        q = qNew

        primalRes = math.sqrt(primalSq / totalVars)
        dualRes = rho * math.sqrt(dualChangeSq / totalVars)
        dualStack = sum(d.T @ u for d, u in zip(differences, uz)) + uq
        dualScale = rho * math.sqrt(float(dualStack @ dualStack) / totalVars)
        if (
            iteration > 3
            and primalRes < RESIDUAL_ABS_TOL + RESIDUAL_REL_TOL * math.sqrt(primalScaleSq / totalVars)
            and dualRes < RESIDUAL_ABS_TOL + RESIDUAL_REL_TOL * dualScale
        ):
            break

        # Rebalance rho a few iterations apart, rescaling the scaled duals (u = y / rho) to match.
        if iteration < RHO_BALANCE_ITERS and iteration % 4 == 0:
            factor = 0.0
            if primalRes > BALANCE_RATIO * dualRes:
                factor = RHO_STEP
            elif dualRes > BALANCE_RATIO * primalRes:
                factor = 1 / RHO_STEP
            if factor:
                rho *= factor
                uz = [u / factor for u in uz]
                uq /= factor
                kappa = [weight / rho for weight in weights]
    return q


def _fitQuadratic(
    times: np.ndarray,
    values: np.ndarray,
    i0: int,
    i1: int,
) -> tuple[list[float], float]:
    """The quadratic over [i0, i1] that passes through both end samples and least-squares fits the
    ones between, and its largest distance from the samples or beyond them between samples."""
    span = times[i1] - times[i0]
    p0 = float(values[i0])
    p1 = float(values[i1])
    if span <= 0:
        return [p0, 0.0, 0.0], 0.0
    slope = (p1 - p0) / span
    u = times[i0 + 1 : i1] - times[i0]
    phi = u * u - span * u
    num = float(phi @ (values[i0 + 1 : i1] - (p0 + slope * u)))
    den = float(phi @ phi)
    c2 = num / den if den > 1e-9 else 0.0
    c1 = slope - c2 * span
    uAll = times[i0 : i1 + 1] - times[i0]
    err = float(np.max(np.abs(p0 + c1 * uAll + c2 * uAll * uAll - values[i0 : i1 + 1])))
    # A fit through a kink (a hold, then a pan) matches every sample and still swings past the
    # samples at its turning point between them, past the margin or out of the frame.
    if c2 != 0:
        turn = -c1 / (2 * c2)
        k = int(np.searchsorted(uAll, turn))
        if 0 < k < len(uAll) and uAll[k - 1] < turn:
            extreme = p0 + c1 * turn + c2 * turn * turn
            low, high = sorted((float(values[i0 + k - 1]), float(values[i0 + k])))
            err = max(err, low - extreme, extreme - high)
    return [p0, c1, c2], err


def _segmentPath(
    times: np.ndarray,
    components: dict[str, np.ndarray],
    tol: float = SEGMENT_FIT_TOLERANCE_PX,
) -> list[Segment]:
    """The fewest quadratic segments that stay within tol of the solved samples of every component."""
    n = len(times)
    segments = []
    # x and w each fit within tol, so their sum, the right edge, could be off by twice that and leave
    # the frame. The fit is linear, so the edge's own fit is the sum of the two.
    edges = [components["x"] + components["w"], components["y"] + components["h"]]
    i0 = 0
    while i0 < n - 1:
        end = i0 + 1
        fits = {name: _fitQuadratic(times, values, i0, end) for name, values in components.items()}
        for i1 in range(i0 + 2, n):
            trial = {
                name: _fitQuadratic(times, values, i0, i1) for name, values in components.items()
            }
            if any(err > tol for _, err in trial.values()):
                break
            if any(_fitQuadratic(times, edge, i0, i1)[1] > tol for edge in edges):
                break
            end, fits = i1, trial
        segments.append(
            {
                "startT": float(times[i0]),
                "endT": float(times[end]),
                **{name: fit[0] for name, fit in fits.items()},
            },
        )
        i0 = end
    return segments


def _cutTime(cutX: float, previousX: float, fps: Optional[float], videoPartStart: float) -> float:
    """When a cut takes effect: half a frame before the frame the cut point falls in, as the other
    crop easings end a section (ffmpeg_filter.getEaseSectionDuration). A user-placed point usually
    overshoots its frame, so at the raw time the first frame of the new scene would keep the old crop.
    Frames lie on the input video's 1/fps grid, which starts at videoPartStart in crop point time.
    """
    if not fps:
        return cutX
    snapped = videoPartStart + (math.floor((cutX - videoPartStart) * fps) - 0.5) / fps
    return snapped if snapped > previousX else cutX


def splitAtInstantCuts(
    cropMap: Sequence[CropPoint],
    fps: Optional[float] = None,
    videoPartStart: float = 0.0,
) -> list[list[CropPoint]]:
    """The crop points split at each instant transition (a cut). Each run holds its last crop until the
    cut, where the next run starts, so the solve never smooths across a scene change. With fps, the
    cut lands on the frame boundary the other crop easings use."""
    runs: list[list[CropPoint]] = []
    run: list[CropPoint] = []
    for point in cropMap:
        if point.get("easeIn") == "instant" and run:
            cutTime = _cutTime(point["x"], run[-1]["x"], fps, videoPartStart)
            run.append({**run[-1], "x": cutTime, "easeIn": None})
            runs.append(run)
            run = [{**point, "x": cutTime}]
            if cutTime < point["x"]:
                # The cut crop holds until the point's own time, as the other crop easings hold it.
                run.append(point)
        else:
            run.append(point)
    runs.append(run)
    return runs


def weightsForSpacing(dt: float) -> tuple[float, float, float]:
    """The objective weights at a grid spacing of dt seconds. A k-th difference approximates the
    k-th derivative times dt^k, so scaling by dt^(1-k) keeps the same objective at any clip length."""
    r = 1 / GRID_RATE_HZ / dt
    return (WEIGHTS[0], WEIGHTS[1] * r, WEIGHTS[2] * r * r)


def _solveRun(
    run: Sequence[CropPoint],
    firstTime: float,
    margins: dict[str, float],
    cropResWidth: int,
    cropResHeight: int,
    widestW: float,
) -> Optional[list[Segment]]:
    """The path of one run between cuts, or None when the run has no duration. widestW bounds every
    width the path takes, over all its runs."""
    times: list[float] = []
    columns: list[tuple[int, int, int, int]] = []
    for point in run:
        rel = point["x"] - firstTime
        # A coincident-time duplicate (a redundant zero-duration point) is skipped.
        if times and rel <= times[-1]:
            continue
        times.append(rel)
        columns.append(parseCropToComponents(point["crop"], cropResWidth, cropResHeight))
    if len(times) < 2:
        return None
    x, y, w, h = (list(values) for values in zip(*columns))

    start = times[0]
    duration = times[-1] - start
    sampleCount = min(MAX_SAMPLES, max(MIN_SAMPLES, _roundHalfUp(duration * GRID_RATE_HZ) + 1))
    dt = duration / (sampleCount - 1)
    gridTimes = start + dt * np.arange(sampleCount)
    weights = weightsForSpacing(dt)

    targetX = _interpolateAtGrid(times, x, gridTimes)
    targetY = _interpolateAtGrid(times, y, gridTimes)
    targetW = _interpolateAtGrid(times, w, gridTimes)

    def box(
        target: np.ndarray,
        lower: np.ndarray,
        upper: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        # A margin pushed past a validity bound lowers the bound so the box stays valid, and the run's
        # ends are pinned to the crop points.
        lower = np.minimum(lower, upper)
        lower[0] = upper[0] = target[0]
        lower[-1] = upper[-1] = target[-1]
        return lower, upper

    # Zoom keeps the crop aspect ratio, so solve the width and derive the height. The width bounds how
    # far x can pan with the crop still on screen, so it is solved first.
    ratio = h[0] / w[0] if w[0] > 0 else cropResHeight / cropResWidth
    # The height follows the width at the ratio, so the frame's height bounds the width too: a 9:16
    # crop at full height would otherwise widen past its ratio while its height stops at the frame.
    maxW = min(cropResWidth, cropResHeight / ratio)
    hiW = np.minimum(maxW, targetW * (1 + margins["zoom"]))
    # At a zoom margin near 1 a quick zoom would let the crop overshoot to nothing: keep it as large as
    # the markup's smallest crop and within the render's zoom of the path's widest crop, or the crop
    # point's own size when smaller (a hand-edited file).
    smallestW = max(MIN_CROP_WIDTH, MIN_CROP_HEIGHT / ratio, widestW / ZOOMPAN_MAX_ZOOM)
    loW, hiW = box(
        targetW,
        np.maximum(np.maximum(1.0, targetW * (1 - margins["zoom"])), np.minimum(targetW, smallestW)),
        hiW,
    )
    # Per sample, so the pull's total strength does not depend on the grid spacing.
    fidelity = CROP_POINT_FIDELITY * dt * GRID_RATE_HZ
    solvedW = solveL1Path(np.clip(targetW, loW, hiW), loW, hiW, weights, fidelity)
    solvedH = np.minimum(cropResHeight, solvedW * ratio)
    # The derived height keeps the first crop's aspect ratio, so a later crop of another one (only a
    # hand-edited file has it) can sit past the frame edge for that height. The ends are pinned to
    # the targets, so keep the targets in the frame.
    targetX = np.minimum(targetX, cropResWidth - solvedW)
    targetY = np.minimum(targetY, cropResHeight - solvedH)

    # The position margin is a share of the crop points' shorter side, in both directions, so the crop
    # never drifts more than that share of its width or its height, and a zoom changes it with the crop.
    margin = margins["pos"] * np.minimum(targetW, targetW * ratio)
    loX, hiX = box(
        targetX,
        np.maximum(0.0, targetX - margin),
        np.minimum(cropResWidth - solvedW, targetX + margin),
    )
    solvedX = solveL1Path(np.clip(targetX, loX, hiX), loX, hiX, weights, fidelity)
    loY, hiY = box(
        targetY,
        np.maximum(0.0, targetY - margin),
        np.minimum(cropResHeight - solvedH, targetY + margin),
    )
    solvedY = solveL1Path(np.clip(targetY, loY, hiY), loY, hiY, weights, fidelity)

    return _segmentPath(gridTimes, {"x": solvedX, "y": solvedY, "w": solvedW, "h": solvedH})


def cinematicMargins(markerPairSettings: dict[str, Any]) -> dict[str, float]:
    """A marker pair's margins, from its overrides or the global settings, which hold percentages of
    the crop size."""
    return {
        "pos": markerPairSettings.get("cropPointEasingCinematicMargin", DEFAULT_MARGIN_PERCENT) / 100,
        "zoom": markerPairSettings.get("cropPointEasingCinematicZoomMargin", DEFAULT_ZOOM_MARGIN_PERCENT) / 100,
    }


def bakeCinematicPath(
    cropMap: Sequence[CropPoint],
    margins: dict[str, float],
    cropResWidth: int,
    cropResHeight: int,
    fps: Optional[float] = None,
    videoPartStart: float = 0.0,
) -> Optional[dict[str, Any]]:
    """The path for a marker pair's crop points, with times relative to the first point, or None when
    there is nothing to solve (fewer than two points or no duration). fps places instant cuts on
    frame boundaries, as the other crop easings do."""
    if len(cropMap) < 2:
        return None
    firstTime = cropMap[0]["x"]
    runs = splitAtInstantCuts(cropMap, fps, videoPartStart)
    widestW = max(
        min(cropResWidth, parseCropToComponents(point["crop"], cropResWidth, cropResHeight)[2] * (1 + margins["zoom"]))
        for point in cropMap
    )
    solved = [_solveRun(run, firstTime, margins, cropResWidth, cropResHeight, widestW) for run in runs]
    segments = [segment for runSegments in solved for segment in (runSegments or [])]
    if not segments:
        return None
    if solved[-1] is None:
        # A cut on the last point leaves a run of one moment, with nothing to solve. Hold its crop
        # there, so the path ends on the cut, as the other crop easings do.
        cut = runs[-1][-1]
        t = cut["x"] - firstTime
        x, y, w, h = parseCropToComponents(cut["crop"], cropResWidth, cropResHeight)
        segments.append(
            {"startT": t, "endT": t, "x": [x, 0.0, 0.0], "y": [y, 0.0, 0.0], "w": [w, 0.0, 0.0], "h": [h, 0.0, 0.0]},
        )
    return {"version": SOLVER_VERSION, "margin": dict(margins), "segments": segments}


def evalCropPathAtTime(path: dict[str, Any], t: float) -> tuple[float, float, float, float]:
    """The crop [x, y, w, h] in cropRes px at time t (relative to the first point). Clamps to the path's
    span. At a cut two segments share a time and the later one wins."""
    segments = path["segments"]
    clamped = min(max(t, segments[0]["startT"]), segments[-1]["endT"])
    segment = segments[0]
    for candidate in segments:
        if candidate["startT"] <= clamped:
            segment = candidate
    u = clamped - segment["startT"]

    def poly(coeffs: Sequence[float]) -> float:
        return coeffs[0] + coeffs[1] * u + coeffs[2] * u * u

    return (poly(segment["x"]), poly(segment["y"]), poly(segment["w"]), poly(segment["h"]))
