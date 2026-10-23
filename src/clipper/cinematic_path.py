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
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple, Optional

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


# The fewest grid steps the braking into or out of a hold takes, so the solve has samples to show it
# on. The ease's window is four times that.
MIN_HOLD_EASE_STEPS = 6
# How fast the crop slows into a hold point or speeds up out of one, in crop widths per second².
HOLD_EASE_ACCELERATION = 1


# How Cinematic crop easing treats hold points: "loose" leaves them to the solve like any crop point,
# "firm" holds the crop still over them within the margin, and "exact" holds the crop still over them
# and eases into and out of them.
DEFAULT_CINEMATIC_HOLDS = "firm"

# A Firm hold pins the crop over its span, and the grid samples just outside it, within the margin.
# Accelerations are in crop widths per second². A crop that cannot stop within the margin at
# FIRM_HOLD_BRAKING keeps the distance it still needs.
FIRM_HOLD_BRAKING = 4
# The crop settles into and out of each hold over this many seconds, at FIRM_HOLD_SETTLE_ACCELERATION.
FIRM_HOLD_SETTLE_SECONDS = 0.1
FIRM_HOLD_SETTLE_ACCELERATION = 2
# A move between two holds that is too quick to start and stop at FIRM_HOLD_SETTLE_ACCELERATION borrows
# the missing time from both holds, up to this share of each.
FIRM_HOLD_MAX_BORROW_SHARE = 0.4
# A section that moves at most this share of the held crop's width counts as still next to a hold: a
# crop point nudged a few pixels off the hold's crop does not stop the pan before it.
FIRM_HOLD_STILL_SHARE = 0.01


def cinematicCropMap(cropMap: Sequence[CropPoint], holds: str = DEFAULT_CINEMATIC_HOLDS) -> list[CropPoint]:
    """The crop points the Cinematic solve reads: hold points become firm hold points under Firm, and
    ordinary crop points under Loose."""
    if holds == "exact":
        return list(cropMap)
    converted: list[CropPoint] = []
    for point in cropMap:
        if not point.get("hold"):
            converted.append(point)
            continue
        released = {key: value for key, value in point.items() if key != "hold"}
        if holds == "firm":
            released["firmHold"] = True
        converted.append(released)
    return converted


def _lineAt(times: Sequence[float], values: Sequence[float], t: float) -> float:
    """The line between crop points, one component, at time t (clamped to the points)."""
    k = 0
    while k < len(times) - 2 and times[k + 1] < t:
        k += 1
    duration = times[k + 1] - times[k]
    linear = min(max((t - times[k]) / duration, 0.0), 1.0) if duration > 0 else 0.0
    return values[k] + (values[k + 1] - values[k]) * linear


@dataclass
class _HoldEase:
    """An ease into or out of a held span: over [start, end] the target leaves the line at origin and
    reaches the held crop at rest at the held edge (end for an arrival, start for a departure)."""

    start: float
    end: float
    arrival: bool
    brake: float
    origin: tuple[float, float, float]
    held: tuple[float, float, float]


def _holdEase(
    times: Sequence[float],
    lines: Sequence[Sequence[float]],
    edge: float,
    direction: int,
    cap: float,
    held: tuple[float, float, float],
    minBrake: float,
) -> Optional[_HoldEase]:
    """The ease into (direction -1) or out of (+1) a held span at edge. The target cruises, then brakes
    at a constant rate to rest, as a camera stops on a subject (Gleicher and Liu, Re-cinematography,
    2007). The window reaches back across crop points as far as the acceleration needs, so the pacing
    stays even; crop points inside it no longer bound the crop by the margin. It is four brake
    times long, with the brake time from the line's average speed over it, so it solves
    (A/4) W² = D(W) for the distance D from the line to the held crop, piece by piece of the line.
    Capped at cap. The brake time is at least minBrake unless the window is shorter than twice that,
    and at most half the window."""
    if not cap > 0:
        return None
    acceleration = HOLD_EASE_ACCELERATION * held[2]

    def gap(component: int, window: float) -> float:
        return held[component] - _lineAt(times, lines[component], edge + direction * window)

    # The component that moves most over the longest window sets the ease for all three.
    main = 0
    for component in (1, 2):
        if abs(gap(component, cap)) > abs(gap(main, cap)):
            main = component
    # The line's pieces as window lengths: breaks at crop points between the edge and the cap.
    breaks = sorted(w for w in (direction * (time - edge) for time in times) if 0 < w < cap)
    # The first root comes before the line reaches the held crop, where (A/4) W² - D(W) turns positive,
    # so D = |gap| is linear on every piece the walk reaches.
    window: Optional[float] = None
    w0 = 0.0
    for w1 in [*breaks, cap]:
        g0 = gap(main, w0)
        g1 = gap(main, w1)
        slope = (g1 - g0) / (w1 - w0)
        sign = -1 if (g0 if g0 != 0 else g1) < 0 else 1
        b = sign * slope
        a = sign * (g0 - slope * w0)
        discriminant = b * b + acceleration * a
        root = (b + math.sqrt(discriminant)) / (acceleration / 2) if discriminant >= 0 else -1.0
        if w0 <= root <= w1:
            window = root
            break
        w0 = w1
    if window is None:
        window = cap
        brake = abs(gap(main, cap)) / (acceleration * cap)
    else:
        brake = window / 4
    if brake < minBrake:
        brake = minBrake
        window = min(cap, 4 * minBrake)
    brake = min(brake, window / 2)
    outer = edge + direction * window
    origin = (_lineAt(times, lines[0], outer), _lineAt(times, lines[1], outer), _lineAt(times, lines[2], outer))
    if direction < 0:
        return _HoldEase(outer, edge, True, brake, origin, held)
    return _HoldEase(edge, outer, False, brake, origin, held)


def _holdEaseAt(ease: _HoldEase, t: float) -> list[float]:
    """The target in an ease's window: from the line's value at its outer end to the held crop."""
    window = ease.end - ease.start
    fromOuter = t - ease.start if ease.arrival else ease.end - t
    cruise = 1 / (window - ease.brake / 2)
    if fromOuter < window - ease.brake:
        progress = cruise * fromOuter
    else:
        progress = 1 - cruise * (window - fromOuter) * (window - fromOuter) / (2 * ease.brake)
    return [ease.origin[c] + (ease.held[c] - ease.origin[c]) * progress for c in range(3)]


def _mergedHeldSpans(
    times: Sequence[float], lines: Sequence[Sequence[float]], heldSections: Sequence[bool]
) -> list[tuple[float, float, tuple[float, float, float]]]:
    """The spans the eases go into and out of: consecutive held sections merged into one, as (start,
    end, held crop). heldSpans gives each hold point's own span, for the pins."""
    spans: list[tuple[float, float, tuple[float, float, float]]] = []
    for k, held in enumerate(heldSections):
        if not held:
            continue
        if spans and spans[-1][1] == times[k]:
            spans[-1] = (spans[-1][0], times[k + 1], spans[-1][2])
        else:
            spans.append((times[k], times[k + 1], (lines[0][k + 1], lines[1][k + 1], lines[2][k + 1])))
    return spans


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


def _holdsAfter(previous: CropPoint, point: CropPoint) -> bool:
    """A hold point holds the crop still from the point before it. A hold point whose crop text differs
    from that point's is not one, as the markup releases it on load."""
    return bool(point.get("hold")) and point["crop"] == previous["crop"]


def heldSpans(
    run: Sequence[CropPoint], cropResWidth: int, cropResHeight: int
) -> list[tuple[float, float, tuple[int, int, int, int]]]:
    """The spans hold points hold still over: (time of the point before a hold point, time of the hold
    point, its crop). A hold before a cut also holds to the cut, as the run's copy of it at the cut is
    a hold point too."""
    spans: list[tuple[float, float, tuple[int, int, int, int]]] = []
    previous: Optional[CropPoint] = None
    for point in run:
        # A coincident-time duplicate is skipped, as the solve skips it.
        if previous is not None and point["x"] <= previous["x"]:
            continue
        if previous is not None and _holdsAfter(previous, point):
            held = parseCropToComponents(point["crop"], cropResWidth, cropResHeight)
            spans.append((previous["x"], point["x"], held))
        previous = point
    return spans


def _firmHoldsAfter(previous: CropPoint, point: CropPoint) -> bool:
    return bool(point.get("firmHold")) and point["crop"] == previous["crop"]


class FirmHeldSpan(NamedTuple):
    start: float
    end: float
    crop: tuple[int, int, int, int]
    # The speeds of the nearest moving sections into and out of the hold, less what the crop sheds
    # braking over still points between, in held crop widths per second.
    speedIn: float
    speedOut: float
    # How long the crop takes to settle into and out of the hold, in seconds.
    settleIn: float
    settleOut: float


def firmHeldSpans(run: Sequence[CropPoint], cropResWidth: int, cropResHeight: int) -> list[FirmHeldSpan]:
    """The spans Firm hold points hold the crop over, from the point before a Firm hold point to the
    last of the Firm hold points after it, with the speeds and settle times into and out of each."""
    # A coincident-time duplicate is skipped, as the solve skips it.
    points = [point for k, point in enumerate(run) if k == 0 or point["x"] > run[k - 1]["x"]]
    crops = [parseCropToComponents(point["crop"], cropResWidth, cropResHeight) for point in points]

    def firmHeldAt(k: int) -> bool:
        return 1 <= k < len(points) and _firmHoldsAfter(points[k - 1], points[k])

    def distance(i: int, held: float) -> float:
        """How far the section from point i to point i + 1 moves, in held crop widths."""
        if i < 0 or i + 1 >= len(points) or not held > 0:
            return 0
        return max(abs(crops[i + 1][c] - crops[i][c]) for c in range(3)) / held

    def movingSection(start: int, step: int, held: float) -> tuple[int, float]:
        """The nearest section from start outward (step -1 or 1) that moves, past still sections that are
        not Firm holds themselves, and the seconds skipped: a still point next to a hold does not stop
        the pan before it."""
        i = start
        skipped = 0.0
        while i >= 0 and i + 1 < len(points) and distance(i, held) <= FIRM_HOLD_STILL_SHARE and not firmHeldAt(i + 1):
            skipped += points[i + 1]["x"] - points[i]["x"]
            i += step
        return i, skipped

    def speed(i: int, held: float, skipped: float) -> float:
        """The speed the crop still has after braking over the skipped seconds."""
        moved = distance(i, held)
        if moved == 0:
            return 0
        return max(0, moved / (points[i + 1]["x"] - points[i]["x"]) - FIRM_HOLD_BRAKING * skipped)

    def settle(i: int, step: int, held: float, length: float, skipped: float) -> float:
        """The settle into or out of a hold spanning length seconds over the moving section i, skipped
        seconds away. A move between two Firm holds too quick to start and stop evenly borrows half the
        missing time, counting still time on both sides of the move as time it can use."""
        moved = distance(i, held)
        if moved == 0:
            return 0
        far, farSkipped = movingSection(i + step, step, held)
        otherEndHeld = far + 1 < len(points) and firmHeldAt(far + 1)
        between = points[i + 1]["x"] - points[i]["x"] + skipped + farSkipped
        evenMove = 2 * math.sqrt(moved / FIRM_HOLD_SETTLE_ACCELERATION)
        borrowed = max(0, (evenMove - between) / 2) if otherEndHeld else 0
        most = FIRM_HOLD_MAX_BORROW_SHARE * length
        return min(most, max(0, FIRM_HOLD_SETTLE_SECONDS - skipped, borrowed))

    spans: list[FirmHeldSpan] = []
    k = 1
    while k < len(points):
        if not _firmHoldsAfter(points[k - 1], points[k]):
            k += 1
            continue
        # Consecutive Firm hold points hold one crop, as one span.
        last = k
        while firmHeldAt(last + 1):
            last += 1
        held = crops[last][2]
        length = points[last]["x"] - points[k - 1]["x"]
        into, skippedIn = movingSection(k - 2, -1, held)
        outOf, skippedOut = movingSection(last, 1, held)
        spans.append(
            FirmHeldSpan(
                start=points[k - 1]["x"],
                end=points[last]["x"],
                crop=crops[last],
                speedIn=speed(into, held, skippedIn),
                speedOut=speed(outOf, held, skippedOut),
                settleIn=settle(into, -1, held, length, skippedIn),
                settleOut=settle(outOf, 1, held, length, skippedOut),
            )
        )
        k = last + 1
    return spans


def firmHoldAllowance(span: FirmHeldSpan, time: np.ndarray, margin: np.ndarray) -> np.ndarray:
    """How far the crop may leave a Firm hold's crop at each time, in px, before the margin (px) caps it:
    the distance it cannot brake within the margin, and its settle into and out of the hold."""
    width = span.crop[2]
    room = margin / width
    sinceStart = time - span.start
    untilEnd = span.end - time

    def braking(speed: float, since: np.ndarray) -> np.ndarray:
        if not speed > 0:
            return np.zeros_like(since)
        needed = speed * speed / (2 * FIRM_HOLD_BRAKING) - room
        return np.where(needed > 0, needed * np.clip(1 - since * FIRM_HOLD_BRAKING / speed, 0, 1), 0.0)

    def settling(settle: float, since: np.ndarray) -> np.ndarray:
        return np.where(since < settle, FIRM_HOLD_SETTLE_ACCELERATION * (settle - since) ** 2 / 2, 0.0)

    return width * np.maximum.reduce(
        [
            braking(span.speedIn, sinceStart),
            braking(span.speedOut, untilEnd),
            settling(span.settleIn, sinceStart),
            settling(span.settleOut, untilEnd),
        ]
    )


# A span end computed in grid steps can land a rounding error off a whole sample.
GRID_INDEX_TOLERANCE = 1e-9


def _samplesHeldBy(spans: Sequence[tuple[float, float]], sampleCount: int) -> np.ndarray:
    """Per grid sample, the index of the span that holds it, or -1: each span holds the samples it covers
    (a to b, in grid steps), then the samples just outside it that no span holds, except the run's two
    ends. The first span to reach a sample keeps it; spans that share a covered sample hold the same
    crop."""
    held = np.full(sampleCount, -1)
    for k, (a, b) in enumerate(spans):
        first = max(0, math.ceil(a - GRID_INDEX_TOLERANCE))
        last = min(sampleCount - 1, math.floor(b + GRID_INDEX_TOLERANCE))
        covered = held[first : last + 1]
        covered[covered < 0] = k
    for k, (a, b) in enumerate(spans):
        for i in (math.floor(a + GRID_INDEX_TOLERANCE), math.ceil(b - GRID_INDEX_TOLERANCE)):
            if 0 < i < sampleCount - 1 and held[i] < 0:
                held[i] = k
    return held


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
            # The copy holds only if its point does, so a hold flag the markup releases on load stays
            # released.
            holds = len(run) > 1 and _holdsAfter(run[-2], run[-1])
            firmHolds = len(run) > 1 and _firmHoldsAfter(run[-2], run[-1])
            run.append(
                {
                    **run[-1],
                    "x": cutTime,
                    "easeIn": None,
                    "hold": True if holds else None,
                    "firmHold": True if firmHolds else None,
                }
            )
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
    # Whether the section from point k to point k + 1 is held still.
    heldSections: list[bool] = []
    previous: Optional[CropPoint] = None
    for point in run:
        rel = point["x"] - firstTime
        # A coincident-time duplicate (a redundant zero-duration point) is skipped.
        if times and rel <= times[-1]:
            continue
        if previous is not None:
            heldSections.append(_holdsAfter(previous, point))
        times.append(rel)
        columns.append(parseCropToComponents(point["crop"], cropResWidth, cropResHeight))
        previous = point
    if len(times) < 2:
        return None
    x, y, w, h = (list(values) for values in zip(*columns))

    start = times[0]
    duration = times[-1] - start
    sampleCount = min(MAX_SAMPLES, max(MIN_SAMPLES, _roundHalfUp(duration * GRID_RATE_HZ) + 1))
    dt = duration / (sampleCount - 1)
    gridTimes = start + dt * np.arange(sampleCount)
    weights = weightsForSpacing(dt)

    # Zoom keeps the crop aspect ratio, so solve the width and derive the height.
    ratio = h[0] / w[0] if w[0] > 0 else cropResHeight / cropResWidth
    minBrake = MIN_HOLD_EASE_STEPS * dt
    lines = (x, y, w)
    # Two held spans split the gap between them at its midpoint, so their eases never overlap.
    spans = _mergedHeldSpans(times, lines, heldSections)
    eases: list[_HoldEase] = []
    for i, (spanStart, spanEnd, held) in enumerate(spans):
        before = (spanStart - spans[i - 1][1]) / 2 if i > 0 else spanStart - start
        after = (spans[i + 1][0] - spanEnd) / 2 if i + 1 < len(spans) else times[-1] - spanEnd
        eases.extend(
            ease
            for ease in (
                _holdEase(times, lines, spanStart, -1, before, held, minBrake),
                _holdEase(times, lines, spanEnd, 1, after, held, minBrake),
            )
            if ease is not None
        )

    def targetAt(t: float) -> list[float]:
        """The line between crop points, and in each ease's window, the ease into or out of the hold."""
        for ease in eases:
            if ease.start <= t <= ease.end:
                return _holdEaseAt(ease, t)
        return [_lineAt(times, values, t) for values in lines]

    targets = np.array([targetAt(t) for t in gridTimes])
    targetX, targetY, targetW = targets[:, 0], targets[:, 1], targets[:, 2]

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

    # The width bounds how far x can pan with the crop still on screen, so it is solved first.
    # The height follows the width at the ratio, so the frame's height bounds the width too: a 9:16
    # crop at full height would otherwise widen past its ratio while its height stops at the frame.
    def gridIndex(time: float) -> float:
        return (time - firstTime - start) / dt

    # Firm hold points pin the box to the held crop over their spans and at the grid samples just
    # outside them, widened by what the crop needs to brake and settle.
    firmSpans = firmHeldSpans(run, cropResWidth, cropResHeight)
    firmSpanAt = _samplesHeldBy([(gridIndex(span.start), gridIndex(span.end)) for span in firmSpans], sampleCount)
    firmSamples = [np.flatnonzero(firmSpanAt == k) for k in range(len(firmSpans))]
    for span, indices in zip(firmSpans, firmSamples, strict=True):
        targetX[indices], targetY[indices], targetW[indices] = span.crop[:3]
    # The position margin is a share of the crop points' shorter side, in both directions, so the crop
    # never drifts more than that share of its width or its height, and a zoom changes it with the crop.
    margin = margins["pos"] * np.minimum(targetW, targetW * ratio)
    # Per sample, how far a Firm hold lets the crop move: infinite where none applies.
    firmAllowance = np.full(sampleCount, math.inf)
    for span, indices in zip(firmSpans, firmSamples, strict=True):
        firmAllowance[indices] = firmHoldAllowance(span, firstTime + gridTimes[indices], margin[indices])
    maxW = min(cropResWidth, cropResHeight / ratio)
    # The allowance is the position's: the crop brakes and settles in size as it does in place.
    halfW = np.minimum(margins["zoom"] * targetW, firmAllowance)
    hiW = np.minimum(maxW, targetW + halfW)
    # At a zoom margin near 1 a quick zoom would let the crop overshoot to nothing: keep it as large as
    # the markup's smallest crop and within the render's zoom of the path's widest crop, or the crop
    # point's own size when smaller (a hand-edited file).
    smallestW = max(MIN_CROP_WIDTH, MIN_CROP_HEIGHT / ratio, widestW / ZOOMPAN_MAX_ZOOM)
    loWide = np.maximum(1.0, targetW - halfW)
    loW, hiW = box(targetW, np.maximum(loWide, np.minimum(targetW, smallestW)), hiW)
    # Hold points hold still: each held span's samples are pinned to its crop, and the grid samples just
    # outside it, so nothing moves inside it (it may hold up to one grid step longer at each end).
    held = heldSpans(run, cropResWidth, cropResHeight)
    pinnedTo = _samplesHeldBy([(gridIndex(spanStart), gridIndex(spanEnd)) for spanStart, spanEnd, _ in held], sampleCount)

    def pin(
        lower: np.ndarray,
        upper: np.ndarray,
        value: Callable[[tuple[int, int, int, int], int], float],
    ) -> None:
        for i, k in enumerate(pinnedTo):
            if k >= 0:
                lower[i] = upper[i] = value(held[k][2], i)

    pin(loW, hiW, lambda crop, _i: crop[2])
    # Per sample, so the pull's total strength does not depend on the grid spacing.
    fidelity = CROP_POINT_FIDELITY * dt * GRID_RATE_HZ
    solvedW = solveL1Path(np.clip(targetW, loW, hiW), loW, hiW, weights, fidelity)
    solvedH = np.minimum(cropResHeight, solvedW * ratio)
    # The derived height keeps the first crop's aspect ratio, so a later crop of another one (only a
    # hand-edited file has it) can sit past the frame edge for that height. The ends are pinned to
    # the targets, so keep the targets in the frame.
    targetX = np.minimum(targetX, cropResWidth - solvedW)
    targetY = np.minimum(targetY, cropResHeight - solvedH)

    margin = np.minimum(margin, firmAllowance)
    loX, hiX = box(
        targetX,
        np.maximum(0.0, targetX - margin),
        np.minimum(cropResWidth - solvedW, targetX + margin),
    )
    pin(loX, hiX, lambda crop, i: min(crop[0], cropResWidth - solvedW[i]))
    solvedX = solveL1Path(np.clip(targetX, loX, hiX), loX, hiX, weights, fidelity)
    loY, hiY = box(
        targetY,
        np.maximum(0.0, targetY - margin),
        np.minimum(cropResHeight - solvedH, targetY + margin),
    )
    pin(loY, hiY, lambda crop, i: min(crop[1], cropResHeight - solvedH[i]))
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
