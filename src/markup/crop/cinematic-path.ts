// The L1 optimal camera path for the cinematic crop mode. It approximates the user's crop points
// within a margin while minimizing the L1 norm of the path's velocity, acceleration, and jerk, so
// the result is a few deliberate segments (steady holds, constant-velocity pans, constant-
// acceleration transitions) instead of an everywhere-curving weave. This is the Grundmann/Kwatra/
// Essa 2011 idea, solved here per component (x, y, w) with a banded ADMM (box-constrained L1 trend
// filtering), then fitted with piecewise-quadratic segments. The clipper solves the same path
// (src/clipper/cinematic_path.py) and renders the segments with getCropPathFilter; both are checked
// against cinematic_path_parity.json so the preview matches the render. DOM-free and
// dependency-free so it unit-tests in node like crop-keyframe-math.ts.

import { CropPath, CropPathCenterBounds, CropPathSegment, CropPoint } from '../@types/yt_clipper';

// Bump here and in the clipper when the solved path changes. Saved markers JSON records it, so the
// clipper can warn when the crop may move differently than in the preview.
export const CINEMATIC_SOLVER_VERSION = 1;

// Grid the path is sampled on. The grid only quantizes where holds/pans start (the rendered output
// is a continuous polynomial), so a moderate rate is plenty; cap the sample count so a long clip
// still solves quickly.
const GRID_RATE_HZ = 10;
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 400;

// Objective weights on velocity / acceleration / jerk. Jerk is penalized hardest so transitions are
// smooth constant-acceleration ramps; velocity moderately so the path prefers to hold.
const WEIGHTS: [number, number, number] = [10, 1, 100];
// A gentle pull of the crop toward the crop points inside the margins, at the 10 Hz grid: smooths as
// a wide margin does while keeping the crop closer to where the points frame the subject. On the size
// it also lets the solve converge within MAX_ITERS, which a wide zoom margin otherwise does not.
const CROP_POINT_FIDELITY = 0.01;

// Greedy-fit tolerance: how far a baked segment polynomial may sit from the solved samples (cropRes
// px). Sub-pixel, so the segmentation is invisible.
const SEGMENT_FIT_TOLERANCE_PX = 0.4;

// The smallest crop the markup draws (Crop.minW, Crop.minH), in cropRes px.
const MIN_CROP_WIDTH = 20;
const MIN_CROP_HEIGHT = 20;
// ffmpeg's zoompan clamps its zoom to 10, so the render shows no crop narrower than a tenth of the
// path's widest.
const ZOOMPAN_MAX_ZOOM = 10;

// Nonzero defaults, so the mode changes the path without tuning. Both margins are shares of the crop
// size: the position may drift by a share of the crop's shorter side (in x and y), the size by a share
// of itself. Settings hold them as percentages.
export const DEFAULT_CINEMATIC_MARGIN_PERCENT = 12;
export const DEFAULT_CINEMATIC_ZOOM_MARGIN_PERCENT = 8;
export const DEFAULT_CINEMATIC_MARGIN = DEFAULT_CINEMATIC_MARGIN_PERCENT / 100;
export const DEFAULT_CINEMATIC_ZOOM_MARGIN = DEFAULT_CINEMATIC_ZOOM_MARGIN_PERCENT / 100;

export interface CinematicMargins {
  pos: number;
  zoom: number;
}

// The solver's margins (shares) from the settings' percentages, as the clipper converts them.
export function cinematicMarginsFromPercent(
  marginPercent: number | undefined,
  zoomMarginPercent: number | undefined
): CinematicMargins {
  return {
    pos: (marginPercent ?? DEFAULT_CINEMATIC_MARGIN_PERCENT) / 100,
    zoom: (zoomMarginPercent ?? DEFAULT_CINEMATIC_ZOOM_MARGIN_PERCENT) / 100,
  };
}

// Parse a "x:y:w:h" crop string to cropRes-pixel components, resolving iw/ih. Pure (the caller
// passes the resolution) so this module stays node-testable.
export function parseCropToComponents(
  crop: string,
  cropResWidth: number,
  cropResHeight: number
): [number, number, number, number] {
  const parts = crop.split(':');
  const resolve = (s: string, axisMax: number): number => {
    if (s === 'iw') return cropResWidth;
    if (s === 'ih') return cropResHeight;
    return Math.min(Math.round(parseFloat(s)), axisMax);
  };
  const w = resolve(parts[2], cropResWidth);
  const h = resolve(parts[3], cropResHeight);
  // A hand-edited crop can reach past the frame edge, where ffmpeg's crop clamps the render.
  return [
    Math.max(0, Math.min(resolve(parts[0], cropResWidth), cropResWidth - w)),
    Math.max(0, Math.min(resolve(parts[1], cropResHeight), cropResHeight - h)),
    w,
    h,
  ];
}

// --- Banded symmetric linear algebra (half-bandwidth 3) ---
// M = I + D1^T D1 + D2^T D2 + D3^T D3, where Dk is the k-th finite difference. Stored as 4 diagonals
// md[k][i] = M[i][i+k]. Built by accumulating each difference stencil's outer product (upper part).

export interface BandedMatrix {
  n: number;
  md: Float64Array[]; // md[0..3], md[k] length n-k
}

export function buildBandedM(n: number): BandedMatrix {
  const md = [
    new Float64Array(n),
    new Float64Array(Math.max(0, n - 1)),
    new Float64Array(Math.max(0, n - 2)),
    new Float64Array(Math.max(0, n - 3)),
  ];
  for (let i = 0; i < n; i++) md[0][i] = 1; // the I term

  // D1 stencil [-1, +1] over rows i = 0..n-2
  for (let i = 0; i <= n - 2; i++) {
    md[0][i] += 1;
    md[0][i + 1] += 1;
    md[1][i] += -1;
  }
  // D2 stencil [+1, -2, +1] over rows i = 0..n-3
  for (let i = 0; i <= n - 3; i++) {
    md[0][i] += 1;
    md[0][i + 1] += 4;
    md[0][i + 2] += 1;
    md[1][i] += -2;
    md[1][i + 1] += -2;
    md[2][i] += 1;
  }
  // D3 stencil [-1, +3, -3, +1] over rows i = 0..n-4
  for (let i = 0; i <= n - 4; i++) {
    md[0][i] += 1;
    md[0][i + 1] += 9;
    md[0][i + 2] += 9;
    md[0][i + 3] += 1;
    md[1][i] += -3;
    md[1][i + 1] += -9;
    md[1][i + 2] += -3;
    md[2][i] += 3;
    md[2][i + 1] += 3;
    md[3][i] += -1;
  }
  return { n, md };
}

// Lower banded Cholesky factor: L[i] holds [L(i,i), L(i,i-1), L(i,i-2), L(i,i-3)].
export function factorBanded(m: BandedMatrix): Float64Array[] {
  const { n, md } = m;
  const L: Float64Array[] = Array.from({ length: n }, () => new Float64Array(4));
  const Lget = (a: number, b: number): number => {
    const k = a - b;
    return k >= 0 && k <= 3 ? L[a][k] : 0;
  };
  const Msym = (i: number, j: number): number => md[i - j][j]; // i >= j, within band
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      let s = Msym(i, j);
      for (let k = Math.max(0, i - 3); k < j; k++) s -= Lget(i, k) * Lget(j, k);
      if (i === j) L[i][0] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][i - j] = s / L[j][0];
    }
  }
  return L;
}

export function solveBanded(L: Float64Array[], b: Float64Array): Float64Array {
  const n = L.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 1; k <= 3 && i - k >= 0; k++) s -= L[i][k] * y[i - k];
    y[i] = s / L[i][0];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = 1; k <= 3 && i + k < n; k++) s -= L[i + k][k] * x[i + k];
    x[i] = s / L[i][0];
  }
  return x;
}

// --- Finite differences (matrix-free) ---
// Write the order-th finite difference of p into out (length n - order). In-place to avoid
// allocating inside the ADMM loop.
function applyDiffInto(p: Float64Array, order: number, out: Float64Array): void {
  const n = p.length;
  if (order === 1) for (let i = 0; i < n - 1; i++) out[i] = p[i + 1] - p[i];
  else if (order === 2) for (let i = 0; i < n - 2; i++) out[i] = p[i + 2] - 2 * p[i + 1] + p[i];
  else for (let i = 0; i < n - 3; i++) out[i] = p[i + 3] - 3 * p[i + 2] + 3 * p[i + 1] - p[i];
}

// Accumulate Dk^T v into out (length n).
function diffT(v: Float64Array, order: number, n: number, out: Float64Array): void {
  if (order === 1) {
    for (let i = 0; i < n - 1; i++) {
      out[i] -= v[i];
      out[i + 1] += v[i];
    }
  } else if (order === 2) {
    for (let i = 0; i < n - 2; i++) {
      out[i] += v[i];
      out[i + 1] -= 2 * v[i];
      out[i + 2] += v[i];
    }
  } else {
    for (let i = 0; i < n - 3; i++) {
      out[i] -= v[i];
      out[i + 1] += 3 * v[i];
      out[i + 2] -= 3 * v[i];
      out[i + 3] += v[i];
    }
  }
}

function softThreshold(a: number, kappa: number): number {
  if (a > kappa) return a - kappa;
  if (a < -kappa) return a + kappa;
  return 0;
}

const RHO_INIT = 1.0;
const MAX_ITERS = 1000;
// Stop when both residuals are within an absolute plus a relative tolerance (Boyd 2011, 3.3.1).
const RESIDUAL_ABS_TOL = 1e-4;
const RESIDUAL_REL_TOL = 1e-4;
// Residual balancing (Boyd 2011): nudge rho so the primal and dual residuals stay within 10x.
// rho is rescaled by 2 at a time.
const BALANCE_RATIO = 10;
const RHO_STEP = 2;
// Balance only this long, then keep rho fixed. ADMM converges only once rho stops changing; on short
// runs (between instant cuts) balancing never settled, so the solve ran to MAX_ITERS and fell short
// of the optimum.
const RHO_BALANCE_ITERS = 100;

// Solve min w1|D1 p| + w2|D2 p| + w3|D3 p| s.t. lower <= p <= upper, via banded ADMM with rho
// balanced early, then fixed (box-constrained L1 trend filtering). M = I + sum Dk^T Dk is factored
// once; the weights live in the soft-threshold so rho can change (the scaled duals are rescaled).
// Returns the box-feasible consensus, so the path always respects the margin and validity bounds.
// With `fidelity`, also adds (fidelity / 2) |p - target|^2: a pull toward the target inside the box.
export function solveL1Path(
  target: number[],
  lower: number[],
  upper: number[],
  weights: [number, number, number] = WEIGHTS,
  fidelity = 0
): number[] {
  const n = target.length;
  const clampToBox = (arr: ArrayLike<number>): number[] =>
    Array.from(arr, (v, i) => Math.min(Math.max(v, lower[i]), upper[i]));
  if (n <= 3) return clampToBox(target);

  const L = factorBanded(buildBandedM(n));
  const p = Float64Array.from(target);
  const q = Float64Array.from(clampToBox(target));
  const uq = new Float64Array(n);
  const sizes = [n - 1, n - 2, n - 3];
  const z = sizes.map((s) => new Float64Array(s));
  const uz = sizes.map((s) => new Float64Array(s));
  const scratch = sizes.map((s) => new Float64Array(s)); // reused for (z - uz) then for Dk p
  const rhs = new Float64Array(n);
  const dualStack = new Float64Array(n);
  const totalVars = sizes[0] + sizes[1] + sizes[2] + n;

  let rho = RHO_INIT;
  const kappa = [weights[0] / rho, weights[1] / rho, weights[2] / rho];

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    // p-update: M p = sum_k Dk^T(z_k - uz_k) + (q - uq)
    rhs.fill(0);
    for (let k = 0; k < 3; k++) {
      const buf = scratch[k];
      for (let i = 0; i < buf.length; i++) buf[i] = z[k][i] - uz[k][i];
      diffT(buf, k + 1, n, rhs);
    }
    for (let i = 0; i < n; i++) rhs[i] += q[i] - uq[i];
    p.set(solveBanded(L, rhs));

    // z-update (soft threshold) and dual update; track the primal residual and the consensus change
    // (the dual residual surrogate for residual balancing).
    let primalSq = 0;
    let dualChangeSq = 0;
    // The sizes the residuals are relative to: of the iterates, and of the duals (y = rho * u).
    let primalScaleSq = 0;
    for (let k = 0; k < 3; k++) {
      const dp = scratch[k];
      applyDiffInto(p, k + 1, dp);
      const zk = z[k];
      const uzk = uz[k];
      let dpSq = 0;
      let zSq = 0;
      for (let i = 0; i < dp.length; i++) {
        const zOld = zk[i];
        const zNew = softThreshold(dp[i] + uzk[i], kappa[k]);
        uzk[i] += dp[i] - zNew;
        const r = dp[i] - zNew;
        primalSq += r * r;
        dualChangeSq += (zNew - zOld) * (zNew - zOld);
        dpSq += dp[i] * dp[i];
        zSq += zNew * zNew;
        zk[i] = zNew;
      }
      primalScaleSq += Math.max(dpSq, zSq);
    }
    let pSq = 0;
    let qSq = 0;
    for (let i = 0; i < n; i++) {
      const qOld = q[i];
      // The box projection of the fidelity term's proximal step.
      const pulled = (fidelity * target[i] + rho * (p[i] + uq[i])) / (fidelity + rho);
      const qNew = Math.min(Math.max(pulled, lower[i]), upper[i]);
      uq[i] += p[i] - qNew;
      const r = p[i] - qNew;
      primalSq += r * r;
      dualChangeSq += (qNew - qOld) * (qNew - qOld);
      pSq += p[i] * p[i];
      qSq += qNew * qNew;
      q[i] = qNew;
    }
    primalScaleSq += Math.max(pSq, qSq);

    const primalRes = Math.sqrt(primalSq / totalVars);
    const dualRes = rho * Math.sqrt(dualChangeSq / totalVars);
    dualStack.fill(0);
    for (let k = 0; k < 3; k++) diffT(uz[k], k + 1, n, dualStack);
    let dualStackSq = 0;
    for (let i = 0; i < n; i++) {
      const v = dualStack[i] + uq[i];
      dualStackSq += v * v;
    }
    const dualScale = rho * Math.sqrt(dualStackSq / totalVars);
    if (
      iter > 3 &&
      primalRes < RESIDUAL_ABS_TOL + RESIDUAL_REL_TOL * Math.sqrt(primalScaleSq / totalVars) &&
      dualRes < RESIDUAL_ABS_TOL + RESIDUAL_REL_TOL * dualScale
    ) {
      break;
    }

    // Rebalance rho a few iterations apart, rescaling the scaled duals (u = y/rho) to match.
    if (iter < RHO_BALANCE_ITERS && iter % 4 === 0) {
      let factor = 0;
      if (primalRes > BALANCE_RATIO * dualRes) factor = RHO_STEP;
      else if (dualRes > BALANCE_RATIO * primalRes) factor = 1 / RHO_STEP;
      if (factor !== 0) {
        rho *= factor;
        const inv = 1 / factor;
        for (const u of uz) for (let i = 0; i < u.length; i++) u[i] *= inv;
        for (let i = 0; i < n; i++) uq[i] *= inv;
        kappa[0] = weights[0] / rho;
        kappa[1] = weights[1] / rho;
        kappa[2] = weights[2] / rho;
      }
    }
  }
  return Array.from(q);
}

// --- Segmentation: fit the solved samples with the fewest endpoint-interpolating quadratics ---

// One component's quadratic over [i0, i1] that interpolates the endpoints and least-squares-fits the
// interior curvature. Endpoint interpolation makes consecutive segments continuous by construction.
function fitQuadratic(
  times: number[],
  vals: number[],
  i0: number,
  i1: number
): { coeffs: [number, number, number]; err: number } {
  const span = times[i1] - times[i0];
  const p0 = vals[i0];
  const p1 = vals[i1];
  if (span <= 0) return { coeffs: [p0, 0, 0], err: 0 };
  const slope = (p1 - p0) / span;
  let num = 0;
  let den = 0;
  for (let k = i0 + 1; k < i1; k++) {
    const u = times[k] - times[i0];
    const phi = u * u - span * u; // vanishes at both endpoints
    num += phi * (vals[k] - (p0 + slope * u));
    den += phi * phi;
  }
  const c2 = den > 1e-9 ? num / den : 0;
  const c1 = slope - c2 * span;
  const coeffs: [number, number, number] = [p0, c1, c2];
  let err = 0;
  for (let k = i0; k <= i1; k++) {
    const u = times[k] - times[i0];
    err = Math.max(err, Math.abs(p0 + c1 * u + c2 * u * u - vals[k]));
  }
  // A fit through a kink (a hold, then a pan) matches every sample and still swings past the
  // samples at its turning point between them, past the margin or out of the frame.
  if (c2 !== 0) {
    const turn = -c1 / (2 * c2);
    for (let k = i0 + 1; k <= i1; k++) {
      if (times[k - 1] - times[i0] < turn && turn <= times[k] - times[i0]) {
        const extreme = p0 + c1 * turn + c2 * turn * turn;
        const low = Math.min(vals[k - 1], vals[k]);
        const high = Math.max(vals[k - 1], vals[k]);
        err = Math.max(err, low - extreme, extreme - high);
        break;
      }
    }
  }
  return { coeffs, err };
}

interface SolvedComponents {
  x: number[];
  y: number[];
  w: number[];
  h: number[];
}

function segmentPath(
  times: number[],
  comps: SolvedComponents,
  tol = SEGMENT_FIT_TOLERANCE_PX
): CropPathSegment[] {
  const n = times.length;
  const segments: CropPathSegment[] = [];
  // x and w each fit within tol, so their sum, the right edge, could be off by twice that and leave
  // the frame. The fit is linear, so the edge's own fit is the sum of the two.
  const right = comps.x.map((x, i) => x + comps.w[i]);
  const bottom = comps.y.map((y, i) => y + comps.h[i]);
  let i0 = 0;
  while (i0 < n - 1) {
    let end = i0 + 1;
    let endFits = fitAll(times, comps, i0, end);
    // Extend the segment while a single quadratic still fits every component.
    for (let i1 = i0 + 2; i1 < n; i1++) {
      const fits = fitAll(times, comps, i0, i1);
      if (fits.x.err > tol || fits.y.err > tol || fits.w.err > tol || fits.h.err > tol) break;
      if (fitQuadratic(times, right, i0, i1).err > tol) break;
      if (fitQuadratic(times, bottom, i0, i1).err > tol) break;
      end = i1;
      endFits = fits;
    }
    segments.push({
      startT: times[i0],
      endT: times[end],
      x: endFits.x.coeffs,
      y: endFits.y.coeffs,
      w: endFits.w.coeffs,
      h: endFits.h.coeffs,
    });
    i0 = end;
  }
  return segments;
}

function fitAll(times: number[], comps: SolvedComponents, i0: number, i1: number) {
  return {
    x: fitQuadratic(times, comps.x, i0, i1),
    y: fitQuadratic(times, comps.y, i0, i1),
    w: fitQuadratic(times, comps.w, i0, i1),
    h: fitQuadratic(times, comps.h, i0, i1),
  };
}

// --- Public API: bake, evaluate, freshness ---

interface CropMapComponents {
  times: number[];
  x: number[];
  y: number[];
  w: number[];
  h: number[];
  // Whether the section from point k to point k + 1 is held still.
  heldSections: boolean[];
}

function cropMapComponents(
  cropMap: readonly CropPoint[],
  firstTime: number,
  cropResWidth: number,
  cropResHeight: number
): CropMapComponents | null {
  const times: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const w: number[] = [];
  const h: number[] = [];
  const heldSections: boolean[] = [];
  let previous: CropPoint | null = null;
  for (const point of cropMap) {
    const rel = point.x - firstTime;
    // Skip a coincident-time duplicate (redundant zero-duration point) to keep interpolation sane.
    if (times.length > 0 && rel <= times[times.length - 1]) continue;
    const [cx, cy, cw, ch] = parseCropToComponents(point.crop, cropResWidth, cropResHeight);
    if (previous) heldSections.push(holdsAfter(previous, point));
    times.push(rel);
    x.push(cx);
    y.push(cy);
    w.push(cw);
    h.push(ch);
    previous = point;
  }
  if (times.length < 2) return null;
  return { times, x, y, w, h, heldSections };
}

// A hold point holds the crop still from the point before it. A hold point whose crop text differs
// from that point's is not one, as the markup releases it on load.
function holdsAfter(previous: CropPoint, point: CropPoint): boolean {
  return point.hold === true && point.crop === previous.crop;
}

function firmHoldsAfter(previous: CropPoint, point: CropPoint): boolean {
  return point.firmHold === true && point.crop === previous.crop;
}

// How Cinematic crop easing treats hold points: 'loose' leaves them to the solve like any crop point,
// 'firm' holds the crop still over them within the margin, and 'exact' holds the crop still over them
// and eases into and out of them.
export type CinematicHolds = 'loose' | 'firm' | 'exact';
export const DEFAULT_CINEMATIC_HOLDS: CinematicHolds = 'firm';

// The crop points the Cinematic solve reads: hold points become firm hold points under Firm, and
// ordinary crop points under Loose.
export function cinematicCropMap(
  cropMap: readonly CropPoint[],
  holds: CinematicHolds = DEFAULT_CINEMATIC_HOLDS
): readonly CropPoint[] {
  if (holds === 'exact') return cropMap;
  const firmHold = holds === 'firm' ? true : undefined;
  return cropMap.map((point) => (point.hold ? { ...point, hold: undefined, firmHold } : point));
}

// A Firm hold pins the crop over its span, and the grid samples just outside it, within the margin.
// Accelerations are in crop widths per second². A crop that cannot stop within the margin at
// FIRM_HOLD_BRAKING keeps the distance it still needs.
const FIRM_HOLD_BRAKING = 4;
// The crop settles into and out of each hold over this many seconds, at FIRM_HOLD_SETTLE_ACCELERATION.
const FIRM_HOLD_SETTLE_SECONDS = 0.1;
const FIRM_HOLD_SETTLE_ACCELERATION = 2;
// A move between two holds that is too quick to start and stop at FIRM_HOLD_SETTLE_ACCELERATION
// borrows the missing time from both holds, up to this share of each.
const FIRM_HOLD_MAX_BORROW_SHARE = 0.4;
// A section that moves at most this share of the held crop's width counts as still next to a hold:
// a crop point nudged a few pixels off the hold's crop does not stop the pan before it.
const FIRM_HOLD_STILL_SHARE = 0.01;

export interface FirmHeldSpan {
  start: number;
  end: number;
  crop: [number, number, number, number];
  // The speeds of the nearest moving sections into and out of the hold, less what the crop sheds
  // braking over still points between, in held crop widths per second.
  speedIn: number;
  speedOut: number;
  // How long the crop takes to settle into and out of the hold, in seconds.
  settleIn: number;
  settleOut: number;
}

/** The spans Firm hold points hold the crop over, from the point before a Firm hold point to the
 *  last of the Firm hold points after it, with the speeds and settle times into and out of each. */
export function firmHeldSpans(
  run: readonly CropPoint[],
  cropResWidth: number,
  cropResHeight: number
): FirmHeldSpan[] {
  // A coincident-time duplicate is skipped, as the solve skips it.
  const points = run.filter((point, k) => k === 0 || point.x > run[k - 1].x);
  const crops = points.map((p) => parseCropToComponents(p.crop, cropResWidth, cropResHeight));
  const firmHeldAt = (k: number) =>
    k >= 1 && k < points.length && firmHoldsAfter(points[k - 1], points[k]);
  // How far the section from point i to point i + 1 moves, in held crop widths.
  const distance = (i: number, held: number) => {
    if (i < 0 || i + 1 >= points.length || !(held > 0)) return 0;
    return Math.max(...[0, 1, 2].map((c) => Math.abs(crops[i + 1][c] - crops[i][c]))) / held;
  };
  // The nearest section from `from` outward (step -1 or 1) that moves, past still sections that are
  // not Firm holds themselves, and the seconds skipped: a still point next to a hold does not stop
  // the pan before it.
  const movingSection = (from: number, step: number, held: number) => {
    let i = from;
    let skipped = 0;
    while (
      i >= 0 &&
      i + 1 < points.length &&
      distance(i, held) <= FIRM_HOLD_STILL_SHARE &&
      !firmHeldAt(i + 1)
    ) {
      skipped += points[i + 1].x - points[i].x;
      i += step;
    }
    return { i, skipped };
  };
  // The speed the crop still has after braking over the skipped seconds.
  const speed = (i: number, held: number, skipped: number) => {
    const moved = distance(i, held);
    if (moved === 0) return 0;
    return Math.max(0, moved / (points[i + 1].x - points[i].x) - FIRM_HOLD_BRAKING * skipped);
  };
  // The settle into or out of a hold spanning `length` seconds over the moving section i, `skipped`
  // seconds away. A move between two Firm holds too quick to start and stop evenly borrows half the
  // missing time, counting still time on both sides of the move as time it can use.
  const settle = (i: number, step: number, held: number, length: number, skipped: number) => {
    const moved = distance(i, held);
    if (moved === 0) return 0;
    const far = movingSection(i + step, step, held);
    const otherEndHeld = far.i + 1 < points.length && firmHeldAt(far.i + 1);
    const between = points[i + 1].x - points[i].x + skipped + far.skipped;
    const evenMove = 2 * Math.sqrt(moved / FIRM_HOLD_SETTLE_ACCELERATION);
    const borrowed = otherEndHeld ? Math.max(0, (evenMove - between) / 2) : 0;
    const most = FIRM_HOLD_MAX_BORROW_SHARE * length;
    return Math.min(most, Math.max(0, FIRM_HOLD_SETTLE_SECONDS - skipped, borrowed));
  };
  const spans: FirmHeldSpan[] = [];
  for (let k = 1; k < points.length; k++) {
    if (!firmHoldsAfter(points[k - 1], points[k])) continue;
    // Consecutive Firm hold points hold one crop, as one span.
    let last = k;
    while (firmHeldAt(last + 1)) last++;
    const held = crops[last][2];
    const length = points[last].x - points[k - 1].x;
    const into = movingSection(k - 2, -1, held);
    const outOf = movingSection(last, 1, held);
    spans.push({
      start: points[k - 1].x,
      end: points[last].x,
      crop: crops[last],
      speedIn: speed(into.i, held, into.skipped),
      speedOut: speed(outOf.i, held, outOf.skipped),
      settleIn: settle(into.i, -1, held, length, into.skipped),
      settleOut: settle(outOf.i, 1, held, length, outOf.skipped),
    });
    k = last;
  }
  return spans;
}

/** How far the crop may leave a Firm hold's crop at `time`, in px, before `margin` (px) caps it:
 *  the distance it cannot brake within the margin, and its settle into and out of the hold. */
export function firmHoldAllowance(span: FirmHeldSpan, time: number, margin: number): number {
  const width = span.crop[2];
  const room = margin / width;
  const braking = (speed: number, since: number) => {
    const needed = (speed * speed) / (2 * FIRM_HOLD_BRAKING) - room;
    if (!(needed > 0)) return 0;
    return needed * Math.min(1, Math.max(0, 1 - (since * FIRM_HOLD_BRAKING) / speed));
  };
  const settling = (settle: number, since: number) =>
    since < settle ? (FIRM_HOLD_SETTLE_ACCELERATION * (settle - since) ** 2) / 2 : 0;
  const sinceStart = time - span.start;
  const untilEnd = span.end - time;
  return (
    width *
    Math.max(
      braking(span.speedIn, sinceStart),
      braking(span.speedOut, untilEnd),
      settling(span.settleIn, sinceStart),
      settling(span.settleOut, untilEnd)
    )
  );
}

// The fewest grid steps the braking into or out of a hold takes, so the solve has samples to show it
// on. The ease's window is four times that.
const MIN_HOLD_EASE_STEPS = 6;
// How fast the crop slows into a hold point or speeds up out of one, in crop widths per second².
const HOLD_EASE_ACCELERATION = 1;

// The line between crop points, one component, at time t (clamped to the points).
function lineAt(times: readonly number[], values: readonly number[], t: number): number {
  let k = 0;
  while (k < times.length - 2 && times[k + 1] < t) k++;
  const duration = times[k + 1] - times[k];
  const linear = duration > 0 ? Math.min(Math.max((t - times[k]) / duration, 0), 1) : 0;
  return values[k] + (values[k + 1] - values[k]) * linear;
}

// An ease into or out of a held span: over [start, end] the target leaves the line at `origin` and
// reaches the held crop at rest at the span's edge (end for an arrival, start for a departure).
interface HoldEase {
  start: number;
  end: number;
  arrival: boolean;
  brake: number;
  origin: [number, number, number];
  held: [number, number, number];
}

/**
 * The ease into (direction -1) or out of (+1) a held span at `edge`. The target cruises, then brakes
 * at a constant rate to rest, as a camera stops on a subject (Gleicher and Liu, Re-cinematography,
 * 2007). The window reaches back across crop points as far as the acceleration needs, so the pacing
 * stays even; crop points inside it no longer bound the crop by the margin. It is four
 * brake times long, with the brake time from the line's average speed over it, so it solves
 * (A/4) W² = D(W) for the distance D from the line to the held crop, piece by piece of the line.
 * Capped at `cap`. The brake time is at least `minBrake` unless the window is shorter than twice
 * that, and at most half the window.
 */
function holdEase(
  times: readonly number[],
  lines: readonly (readonly number[])[],
  edge: number,
  direction: -1 | 1,
  cap: number,
  held: [number, number, number],
  minBrake: number
): HoldEase | null {
  if (!(cap > 0)) return null;
  const acceleration = HOLD_EASE_ACCELERATION * held[2];
  const gap = (component: number, window: number) =>
    held[component] - lineAt(times, lines[component], edge + direction * window);
  // The component that moves most over the longest window sets the ease for all three.
  let main = 0;
  for (const component of [1, 2]) {
    if (Math.abs(gap(component, cap)) > Math.abs(gap(main, cap))) main = component;
  }
  // The line's pieces as window lengths: breaks at crop points between the edge and the cap.
  const breaks = times
    .map((time) => direction * (time - edge))
    .filter((window) => window > 0 && window < cap)
    .sort((a, b) => a - b);
  // The first root comes before the line reaches the held crop, where (A/4) W² - D(W) turns positive,
  // so D = |gap| is linear on every piece the walk reaches.
  let window: number | null = null;
  let w0 = 0;
  for (const w1 of [...breaks, cap]) {
    const g0 = gap(main, w0);
    const g1 = gap(main, w1);
    const slope = (g1 - g0) / (w1 - w0);
    const sign = (g0 !== 0 ? g0 : g1) < 0 ? -1 : 1;
    const b = sign * slope;
    const a = sign * (g0 - slope * w0);
    const discriminant = b * b + acceleration * a;
    const root = discriminant >= 0 ? (b + Math.sqrt(discriminant)) / (acceleration / 2) : -1;
    if (root >= w0 && root <= w1) {
      window = root;
      break;
    }
    w0 = w1;
  }
  let brake: number;
  if (window == null) {
    window = cap;
    brake = Math.abs(gap(main, cap)) / (acceleration * cap);
  } else {
    brake = window / 4;
  }
  if (brake < minBrake) {
    brake = minBrake;
    window = Math.min(cap, 4 * minBrake);
  }
  brake = Math.min(brake, window / 2);
  const outer = edge + direction * window;
  const origin = [0, 1, 2].map((c) => lineAt(times, lines[c], outer)) as [number, number, number];
  return direction < 0
    ? { start: outer, end: edge, arrival: true, brake, origin, held }
    : { start: edge, end: outer, arrival: false, brake, origin, held };
}

// The target in an ease's window: from the line's value at its outer end to the held crop.
function holdEaseAt(ease: HoldEase, t: number): [number, number, number] {
  const window = ease.end - ease.start;
  const fromOuter = ease.arrival ? t - ease.start : ease.end - t;
  const cruise = 1 / (window - ease.brake / 2);
  const progress =
    fromOuter < window - ease.brake
      ? cruise * fromOuter
      : 1 - (cruise * (window - fromOuter) * (window - fromOuter)) / (2 * ease.brake);
  return [0, 1, 2].map((c) => ease.origin[c] + (ease.held[c] - ease.origin[c]) * progress) as [
    number,
    number,
    number,
  ];
}

// The spans the eases go into and out of: consecutive held sections merged into one, with the held
// crop. heldSpans gives each hold point's own span, for the pins.
function mergedHeldSpans(
  times: readonly number[],
  lines: readonly (readonly number[])[],
  heldSections: readonly boolean[]
): { start: number; end: number; held: [number, number, number] }[] {
  const spans: { start: number; end: number; held: [number, number, number] }[] = [];
  for (let k = 0; k < heldSections.length; k++) {
    if (!heldSections[k]) continue;
    const last = spans[spans.length - 1];
    if (last?.end === times[k]) {
      last.end = times[k + 1];
    } else {
      const held = [0, 1, 2].map((c) => lines[c][k + 1]) as [number, number, number];
      spans.push({ start: times[k], end: times[k + 1], held });
    }
  }
  return spans;
}

export interface CinematicRunTarget {
  times: number[];
  gridTimes: number[];
  dt: number;
  // The crop's width over height, which the solve keeps.
  ratio: number;
  // The target crop [x, y, w] at a time relative to the path's first crop point.
  at: (t: number) => [number, number, number];
}

// The grid one run is solved on and the target it tracks, which the plot's unsolved band shows too.
export function cinematicRunTarget(
  run: readonly CropPoint[],
  firstTime: number,
  cropResWidth: number,
  cropResHeight: number
): CinematicRunTarget | null {
  const parsed = cropMapComponents(run, firstTime, cropResWidth, cropResHeight);
  if (!parsed) return null;
  const { times, x, y, w, h, heldSections } = parsed;
  const start = times[0];
  const duration = times[times.length - 1] - start;
  const sampleCount = Math.min(
    MAX_SAMPLES,
    Math.max(MIN_SAMPLES, Math.round(duration * GRID_RATE_HZ) + 1)
  );
  const dt = duration / (sampleCount - 1);
  const gridTimes = Array.from({ length: sampleCount }, (_v, i) => start + i * dt);
  const ratio = w[0] > 0 ? h[0] / w[0] : cropResHeight / cropResWidth;
  const minBrake = MIN_HOLD_EASE_STEPS * dt;
  const lines = [x, y, w];
  // Two held spans split the gap between them at its midpoint, so their eases never overlap.
  const spans = mergedHeldSpans(times, lines, heldSections);
  const eases = spans.flatMap((span, i) => {
    const before = i > 0 ? (span.start - spans[i - 1].end) / 2 : span.start - start;
    const after =
      i + 1 < spans.length
        ? (spans[i + 1].start - span.end) / 2
        : times[times.length - 1] - span.end;
    return [
      holdEase(times, lines, span.start, -1, before, span.held, minBrake),
      holdEase(times, lines, span.end, 1, after, span.held, minBrake),
    ].filter((ease): ease is HoldEase => ease != null);
  });
  // The line between crop points, and in each ease's window, the ease into or out of the hold.
  const at = (t: number): [number, number, number] => {
    const ease = eases.find((e) => e.start <= t && t <= e.end);
    if (ease) return holdEaseAt(ease, t);
    return [lineAt(times, x, t), lineAt(times, y, t), lineAt(times, w, t)];
  };
  return { times, gridTimes, dt, ratio, at };
}

export interface HeldSpan {
  start: number;
  end: number;
  crop: [number, number, number, number];
}

/** The spans hold points hold still over: from the point before a hold point to the hold point. A
 *  hold before a cut also holds to the cut, as the run's copy of it at the cut is a hold point too. */
export function heldSpans(
  run: readonly CropPoint[],
  cropResWidth: number,
  cropResHeight: number
): HeldSpan[] {
  const spans: HeldSpan[] = [];
  let previous: CropPoint | null = null;
  for (const point of run) {
    // A coincident-time duplicate is skipped, as the solve skips it.
    if (previous && point.x <= previous.x) continue;
    if (previous && holdsAfter(previous, point)) {
      const held = parseCropToComponents(point.crop, cropResWidth, cropResHeight);
      spans.push({ start: previous.x, end: point.x, crop: held });
    }
    previous = point;
  }
  return spans;
}

// Split the crop points at each instant transition (a cut). Each run holds its last crop until the
// cut, where the next run starts, so the solve never smooths across a scene change.
export function splitAtInstantCuts(cropMap: readonly CropPoint[], fps?: number): CropPoint[][] {
  const runs: CropPoint[][] = [];
  let run: CropPoint[] = [];
  for (const point of cropMap) {
    if (point.easeIn === 'instant' && run.length > 0) {
      const cutX = cutTime(point.x, run[run.length - 1].x, fps);
      // The copy holds only if its point does, so a hold flag the markup releases on load stays released.
      const last = run[run.length - 1];
      const before = run.length > 1 ? run[run.length - 2] : null;
      const holds = before != null && holdsAfter(before, last);
      const firmHolds = before != null && firmHoldsAfter(before, last);
      run.push({
        ...last,
        x: cutX,
        easeIn: undefined,
        hold: holds ? true : undefined,
        firmHold: firmHolds ? true : undefined,
      });
      runs.push(run);
      run = [{ ...point, x: cutX }];
      // The cut crop holds until the point's own time, as the other crop easings hold it.
      if (cutX < point.x) run.push(point);
    } else {
      run.push(point);
    }
  }
  runs.push(run);
  return runs;
}

// When a cut takes effect: half a frame before the frame the cut point falls in, as the other crop
// easings end a section (getEaseSectionDuration). A user-placed point usually overshoots its frame,
// so at the raw time the first frame of the new scene would keep the old crop. Snaps on the video's
// frame grid, not the pair start's, since a pair can start between frames. Mirrors the clipper.
function cutTime(cutX: number, previousX: number, fps?: number): number {
  if (!fps) return cutX;
  const snapped = (Math.floor(cutX * fps) - 0.5) / fps;
  return snapped > previousX ? snapped : cutX;
}

// The objective weights at a grid spacing of `dt` seconds. A k-th difference over the grid
// approximates the k-th derivative times dt^k, so scaling by dt^(1-k) keeps the solve close to the
// same continuous objective at any clip length. WEIGHTS are tuned at the 10 Hz grid.
export function weightsForSpacing(dt: number): [number, number, number] {
  const r = 1 / GRID_RATE_HZ / dt;
  return [WEIGHTS[0], WEIGHTS[1] * r, WEIGHTS[2] * r * r];
}

// Lower each bound that a margin pushed past its upper (validity) bound, so the box stays valid.
function orderBox(lower: number[], upper: number[]): void {
  for (let i = 0; i < lower.length; i++) lower[i] = Math.min(lower[i], upper[i]);
}

function clampToBox(target: number[], lower: number[], upper: number[]): number[] {
  return target.map((t, i) => Math.min(Math.max(t, lower[i]), upper[i]));
}

// A span end computed in grid steps can land a rounding error off a whole sample.
const GRID_INDEX_TOLERANCE = 1e-9;

/** Per grid sample, the span that holds it: each span holds the samples it covers (`a` to `b`, in grid
 *  steps), then the samples just outside it that no span holds, except the run's two ends. The first
 *  span to reach a sample keeps it; spans that share a covered sample hold the same crop. */
function samplesHeldBy<S extends { a: number; b: number }>(
  spans: readonly S[],
  sampleCount: number
): (S | undefined)[] {
  // Filled, not sparse: callers map over every sample.
  const held: (S | undefined)[] = new Array<S | undefined>(sampleCount).fill(undefined);
  for (const span of spans) {
    const last = Math.min(sampleCount - 1, Math.floor(span.b + GRID_INDEX_TOLERANCE));
    for (let i = Math.max(0, Math.ceil(span.a - GRID_INDEX_TOLERANCE)); i <= last; i++) {
      held[i] ??= span;
    }
  }
  for (const span of spans) {
    const outside = [
      Math.floor(span.a + GRID_INDEX_TOLERANCE),
      Math.ceil(span.b - GRID_INDEX_TOLERANCE),
    ];
    for (const i of outside) if (i > 0 && i < sampleCount - 1) held[i] ??= span;
  }
  return held;
}

// Solve one run between cuts. Returns null when the run has no duration. widestW bounds every width the
// path takes, over all its runs.
function solveRun(
  run: readonly CropPoint[],
  firstTime: number,
  margins: CinematicMargins,
  cropResWidth: number,
  cropResHeight: number,
  widestW: number
): { segments: CropPathSegment[]; centerBounds: CropPathCenterBounds } | null {
  const target = cinematicRunTarget(run, firstTime, cropResWidth, cropResHeight);
  if (!target) return null;
  const { times, gridTimes, dt } = target;
  const start = times[0];
  const sampleCount = gridTimes.length;
  const weights = weightsForSpacing(dt);

  const targets = gridTimes.map(target.at);
  const targetX = targets.map((crop) => crop[0]);
  const targetY = targets.map((crop) => crop[1]);
  const targetW = targets.map((crop) => crop[2]);

  // Zoom keeps the crop aspect ratio, so solve width and derive height from the (constant) ratio.
  const { ratio } = target;
  const anchor = (arr: number[], lo: number[], hi: number[]): void => {
    lo[0] = hi[0] = arr[0];
    lo[arr.length - 1] = hi[arr.length - 1] = arr[arr.length - 1];
  };

  const gridIndex = (time: number) => (time - firstTime - start) / dt;
  // Firm hold points pin the box to the held crop over their spans and at the grid samples just
  // outside them, widened by what the crop needs to brake and settle.
  const firmSpanAt = samplesHeldBy(
    firmHeldSpans(run, cropResWidth, cropResHeight).map((span) => ({
      span,
      a: gridIndex(span.start),
      b: gridIndex(span.end),
    })),
    sampleCount
  );
  firmSpanAt.forEach((held, i) => {
    if (held) [targetX[i], targetY[i], targetW[i]] = held.span.crop;
  });
  // The position margin is a share of the crop points' shorter side, in both directions, so the crop
  // never drifts more than that share of its width or its height, and a zoom changes it with the crop.
  const posMargin = targetW.map((t) => margins.pos * Math.min(t, t * ratio));
  const firmAllowance = firmSpanAt.map((held, i) =>
    held ? firmHoldAllowance(held.span, firstTime + gridTimes[i], posMargin[i]) : Infinity
  );
  // The allowance is the position's: the crop brakes and settles in size as it does in place.
  const zoomMargin = (t: number, i: number) => Math.min(margins.zoom * t, firmAllowance[i]);
  // Width first: its solved value bounds how far x can pan and still keep the crop on-screen.
  // The height follows the width at the ratio, so the frame's height bounds the width too: a 9:16
  // crop at full height would otherwise widen past its ratio while its height stops at the frame.
  const maxW = Math.min(cropResWidth, cropResHeight / ratio);
  const hiW = targetW.map((t, i) => Math.min(maxW, t + zoomMargin(t, i)));
  // At a zoom margin near 1 a quick zoom would let the crop overshoot to nothing: keep it as large
  // as the markup's smallest crop and within the render's zoom of the path's widest crop, or the crop
  // point's own size when smaller (a hand-edited file).
  const smallestW = Math.max(MIN_CROP_WIDTH, MIN_CROP_HEIGHT / ratio, widestW / ZOOMPAN_MAX_ZOOM);
  const loW = targetW.map((t, i) => Math.max(1, t - zoomMargin(t, i), Math.min(t, smallestW)));
  orderBox(loW, hiW);
  anchor(targetW, loW, hiW);
  // Hold points hold still: each held span's samples are pinned to its crop, and the grid samples just
  // outside it, so nothing moves inside it (it may hold up to one grid step longer at each end).
  const pinned = samplesHeldBy(
    heldSpans(run, cropResWidth, cropResHeight).map((span) => ({
      crop: span.crop,
      a: gridIndex(span.start),
      b: gridIndex(span.end),
    })),
    sampleCount
  );
  const pin = (
    lo: number[],
    hi: number[],
    value: (crop: HeldSpan['crop'], i: number) => number
  ) => {
    pinned.forEach((held, i) => {
      if (held) lo[i] = hi[i] = value(held.crop, i);
    });
  };
  pin(loW, hiW, (crop) => crop[2]);
  // Per sample, so the pull's total strength does not depend on the grid spacing.
  const fidelity = CROP_POINT_FIDELITY * dt * GRID_RATE_HZ;
  const solvedW = solveL1Path(clampToBox(targetW, loW, hiW), loW, hiW, weights, fidelity);
  const solvedH = solvedW.map((wv) => Math.min(cropResHeight, wv * ratio));
  // The derived height keeps the first crop's aspect ratio, so a later crop of another one (only a
  // hand-edited file has it) can sit past the frame edge for that height. The ends are pinned to the
  // targets, so keep the targets in the frame.
  const inFrameX = targetX.map((t, i) => Math.min(t, cropResWidth - solvedW[i]));
  const inFrameY = targetY.map((t, i) => Math.min(t, cropResHeight - solvedH[i]));

  const margin = posMargin.map((full, i) => Math.min(full, firmAllowance[i]));
  const loX = inFrameX.map((t, i) => Math.max(0, t - margin[i]));
  const hiX = inFrameX.map((t, i) => Math.min(cropResWidth - solvedW[i], t + margin[i]));
  orderBox(loX, hiX);
  anchor(inFrameX, loX, hiX);
  pin(loX, hiX, (crop, i) => Math.min(crop[0], cropResWidth - solvedW[i]));
  const solvedX = solveL1Path(clampToBox(inFrameX, loX, hiX), loX, hiX, weights, fidelity);

  const loY = inFrameY.map((t, i) => Math.max(0, t - margin[i]));
  const hiY = inFrameY.map((t, i) => Math.min(cropResHeight - solvedH[i], t + margin[i]));
  orderBox(loY, hiY);
  anchor(inFrameY, loY, hiY);
  pin(loY, hiY, (crop, i) => Math.min(crop[1], cropResHeight - solvedH[i]));
  const solvedY = solveL1Path(clampToBox(inFrameY, loY, hiY), loY, hiY, weights, fidelity);

  // The box bounds the crop's corner; the plot shows where that leaves its center.
  const centerBounds = {
    t: gridTimes,
    xLow: loX.map((v, i) => v + solvedW[i] / 2),
    xHigh: hiX.map((v, i) => v + solvedW[i] / 2),
    yLow: loY.map((v, i) => v + solvedH[i] / 2),
    yHigh: hiY.map((v, i) => v + solvedH[i] / 2),
    wLow: loW,
    wHigh: hiW,
  };
  return {
    segments: segmentPath(gridTimes, { x: solvedX, y: solvedY, w: solvedW, h: solvedH }),
    centerBounds,
  };
}

// Compute the cinematic path for a marker pair's cropMap. Returns null when there is nothing to
// solve (static or zero-duration crop), in which case the caller falls back to the easing modes.
export function bakeCinematicPath(
  cropMap: readonly CropPoint[],
  margins: CinematicMargins,
  cropResWidth: number,
  cropResHeight: number,
  fps?: number
): CropPath | null {
  if (cropMap.length < 2) return null;
  const firstTime = cropMap[0].x;
  const runs = splitAtInstantCuts(cropMap, fps);
  const widestW = Math.max(
    ...cropMap.map((point) =>
      Math.min(
        cropResWidth,
        parseCropToComponents(point.crop, cropResWidth, cropResHeight)[2] * (1 + margins.zoom)
      )
    )
  );
  const solved = runs.map((run) =>
    solveRun(run, firstTime, margins, cropResWidth, cropResHeight, widestW)
  );
  const segments = solved.flatMap((run) => run?.segments ?? []);
  if (segments.length === 0) return null;
  const centerBounds: CropPathCenterBounds = {
    t: [],
    xLow: [],
    xHigh: [],
    yLow: [],
    yHigh: [],
    wLow: [],
    wHigh: [],
  };
  for (const run of solved) {
    if (!run) continue;
    for (const key of ['t', 'xLow', 'xHigh', 'yLow', 'yHigh', 'wLow', 'wHigh'] as const) {
      centerBounds[key].push(...run.centerBounds[key]);
    }
  }
  if (solved[solved.length - 1] === null) {
    // A cut on the last point leaves a run of one moment, with nothing to solve. Hold its crop
    // there, so the path ends on the cut, as the other crop easings do.
    const lastRun = runs[runs.length - 1];
    const cut = lastRun[lastRun.length - 1];
    const t = cut.x - firstTime;
    const [x, y, w, h] = parseCropToComponents(cut.crop, cropResWidth, cropResHeight);
    segments.push({ startT: t, endT: t, x: [x, 0, 0], y: [y, 0, 0], w: [w, 0, 0], h: [h, 0, 0] });
    centerBounds.t.push(t);
    centerBounds.xLow.push(x + w / 2);
    centerBounds.xHigh.push(x + w / 2);
    centerBounds.yLow.push(y + h / 2);
    centerBounds.yHigh.push(y + h / 2);
    centerBounds.wLow.push(w);
    centerBounds.wHigh.push(w);
  }

  return {
    version: CINEMATIC_SOLVER_VERSION,
    margin: { pos: margins.pos, zoom: margins.zoom },
    signature: cropPathSignature(cropMap, margins, cropResWidth, cropResHeight, fps),
    segments,
    centerBounds,
  };
}

function polyval(c: readonly [number, number, number], u: number): number {
  return c[0] + c[1] * u + c[2] * u * u;
}

// The baked crop ([x, y, w, h] in cropRes px) at clip-relative time t. Clamps to the path span. At a
// cut two segments share a time and the later one wins, like the clipper's [start, end) gating.
export function evalCropPathAtTime(path: CropPath, t: number): [number, number, number, number] {
  const segs = path.segments;
  if (segs.length === 0) return [0, 0, 0, 0];
  const clamped = Math.min(Math.max(t, segs[0].startT), segs[segs.length - 1].endT);
  // The last segment starting at or before the clamped time.
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].startT <= clamped) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  const u = clamped - seg.startT;
  return [polyval(seg.x, u), polyval(seg.y, u), polyval(seg.w, u), polyval(seg.h, u)];
}

// A stable hash of everything the path was solved from, so an edit makes the baked path read stale.
export function cropPathSignature(
  cropMap: readonly CropPoint[],
  margins: CinematicMargins,
  cropResWidth: number,
  cropResHeight: number,
  fps?: number
): string {
  let s = `v${CINEMATIC_SOLVER_VERSION}|${cropResWidth}x${cropResHeight}|m${margins.pos},${margins.zoom}|f${fps ?? ''}|`;
  for (const point of cropMap)
    s += `${point.x}:${point.crop}:${point.easeIn ?? ''}:${point.hold ? 'h' : ''}${point.firmHold ? 'f' : ''};`;
  // FNV-1a, enough to detect any cropMap/margin change.
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function isCropPathFresh(
  path: CropPath | undefined,
  cropMap: readonly CropPoint[],
  margins: CinematicMargins,
  cropResWidth: number,
  cropResHeight: number,
  fps?: number
): boolean {
  if (!path) return false;
  if (path.version !== CINEMATIC_SOLVER_VERSION) return false;
  return path.signature === cropPathSignature(cropMap, margins, cropResWidth, cropResHeight, fps);
}
