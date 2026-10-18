// The L1 optimal camera path for the cinematic crop mode. It approximates the user's crop points
// within a margin while minimizing the L1 norm of the path's velocity, acceleration, and jerk, so
// the result is a few deliberate segments (steady holds, constant-velocity pans, constant-
// acceleration transitions) instead of an everywhere-curving weave. This is the Grundmann/Kwatra/
// Essa 2011 idea, solved here per component (x, y, w) with a banded ADMM (box-constrained L1 trend
// filtering), then fitted with piecewise-quadratic segments. The clipper solves the same path
// (src/clipper/cinematic_path.py) and renders the segments with getCropPathFilter; both are checked
// against cinematic_path_parity.json so the preview matches the render. DOM-free and
// dependency-free so it unit-tests in node like crop-keyframe-math.ts.

import { CropPath, CropPathSegment, CropPoint } from '../@types/yt_clipper';

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

// Greedy-fit tolerance: how far a baked segment polynomial may sit from the solved samples (cropRes
// px). Sub-pixel, so the segmentation is invisible.
const SEGMENT_FIT_TOLERANCE_PX = 0.4;

// The smallest crop the markup draws (Crop.minW, Crop.minH), in cropRes px.
const MIN_CROP_WIDTH = 20;
const MIN_CROP_HEIGHT = 20;
// ffmpeg's zoompan clamps its zoom to 10, so the render shows no crop narrower than a tenth of the
// path's widest.
const ZOOMPAN_MAX_ZOOM = 10;

// Nonzero defaults, so the mode changes the path without tuning. Position margin in cropRes
// px, zoom margin as a fraction of the keyframed size.
export const DEFAULT_CINEMATIC_MARGIN = 40;
export const DEFAULT_CINEMATIC_ZOOM_MARGIN = 0.08;

export interface CinematicMargins {
  pos: number;
  zoom: number;
}

// Parse a "x:y:w:h" crop string to cropRes-pixel components, resolving iw/ih. Pure (the caller
// passes the resolution) so this module stays node-testable.
function parseCropToComponents(
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

// Piecewise-linear interpolation of (time, value) samples at each grid time. times must be sorted.
function interpolateAtGrid(times: number[], values: number[], gridTimes: number[]): number[] {
  const out = new Array<number>(gridTimes.length);
  let j = 0;
  for (let i = 0; i < gridTimes.length; i++) {
    const t = gridTimes[i];
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j];
    const t1 = times[j + 1];
    const span = t1 - t0;
    const frac = span > 0 ? (t - t0) / span : 0;
    out[i] = values[j] + (values[j + 1] - values[j]) * Math.min(Math.max(frac, 0), 1);
  }
  return out;
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
export function solveL1Path(
  target: number[],
  lower: number[],
  upper: number[],
  weights: [number, number, number] = WEIGHTS
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
      const qNew = Math.min(Math.max(p[i] + uq[i], lower[i]), upper[i]);
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

function cropMapComponents(
  cropMap: readonly CropPoint[],
  firstTime: number,
  cropResWidth: number,
  cropResHeight: number
): { times: number[]; x: number[]; y: number[]; w: number[]; h: number[] } | null {
  const times: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const w: number[] = [];
  const h: number[] = [];
  for (const point of cropMap) {
    const rel = point.x - firstTime;
    // Skip a coincident-time duplicate (redundant zero-duration point) to keep interpolation sane.
    if (times.length > 0 && rel <= times[times.length - 1]) continue;
    const [cx, cy, cw, ch] = parseCropToComponents(point.crop, cropResWidth, cropResHeight);
    times.push(rel);
    x.push(cx);
    y.push(cy);
    w.push(cw);
    h.push(ch);
  }
  if (times.length < 2) return null;
  return { times, x, y, w, h };
}

// Split the crop points at each instant transition (a cut). Each run holds its last crop until the
// cut, where the next run starts, so the solve never smooths across a scene change.
export function splitAtInstantCuts(cropMap: readonly CropPoint[], fps?: number): CropPoint[][] {
  const runs: CropPoint[][] = [];
  let run: CropPoint[] = [];
  const firstTime = cropMap[0]?.x ?? 0;
  for (const point of cropMap) {
    if (point.easeIn === 'instant' && run.length > 0) {
      const cutX = cutTime(point.x, run[run.length - 1].x, firstTime, fps);
      run.push({ ...run[run.length - 1], x: cutX, easeIn: undefined });
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
// so at the raw time the first frame of the new scene would keep the old crop. Mirrors the clipper.
function cutTime(cutX: number, previousX: number, firstTime: number, fps?: number): number {
  if (!fps) return cutX;
  const snapped = firstTime + (Math.floor((cutX - firstTime) * fps) - 0.5) / fps;
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

// Solve one run between cuts. Returns null when the run has no duration. widestW bounds every width the
// path takes, over all its runs.
function solveRun(
  run: readonly CropPoint[],
  firstTime: number,
  margins: CinematicMargins,
  cropResWidth: number,
  cropResHeight: number,
  widestW: number
): CropPathSegment[] | null {
  const parsed = cropMapComponents(run, firstTime, cropResWidth, cropResHeight);
  if (!parsed) return null;
  const { times, x, y, w, h } = parsed;
  const start = times[0];
  const duration = times[times.length - 1] - start;

  const sampleCount = Math.min(
    MAX_SAMPLES,
    Math.max(MIN_SAMPLES, Math.round(duration * GRID_RATE_HZ) + 1)
  );
  const dt = duration / (sampleCount - 1);
  const gridTimes = Array.from({ length: sampleCount }, (_v, i) => start + i * dt);
  const weights = weightsForSpacing(dt);

  const targetX = interpolateAtGrid(times, x, gridTimes);
  const targetY = interpolateAtGrid(times, y, gridTimes);
  const targetW = interpolateAtGrid(times, w, gridTimes);

  // Zoom keeps the crop aspect ratio, so solve width and derive height from the (constant) ratio.
  const ratio = w[0] > 0 ? h[0] / w[0] : cropResHeight / cropResWidth;
  const anchor = (arr: number[], lo: number[], hi: number[]): void => {
    lo[0] = hi[0] = arr[0];
    lo[arr.length - 1] = hi[arr.length - 1] = arr[arr.length - 1];
  };

  // Width first: its solved value bounds how far x can pan and still keep the crop on-screen.
  // The height follows the width at the ratio, so the frame's height bounds the width too: a 9:16
  // crop at full height would otherwise widen past its ratio while its height stops at the frame.
  const maxW = Math.min(cropResWidth, cropResHeight / ratio);
  const hiW = targetW.map((t) => Math.min(maxW, t * (1 + margins.zoom)));
  // At a zoom margin near 1 a quick zoom would let the crop overshoot to nothing: keep it as large
  // as the markup's smallest crop and within the render's zoom of the path's widest crop, or the crop
  // point's own size when smaller (a hand-edited file).
  const smallestW = Math.max(MIN_CROP_WIDTH, MIN_CROP_HEIGHT / ratio, widestW / ZOOMPAN_MAX_ZOOM);
  const loW = targetW.map((t) => Math.max(1, t * (1 - margins.zoom), Math.min(t, smallestW)));
  orderBox(loW, hiW);
  anchor(targetW, loW, hiW);
  const solvedW = solveL1Path(clampToBox(targetW, loW, hiW), loW, hiW, weights);
  const solvedH = solvedW.map((wv) => Math.min(cropResHeight, wv * ratio));
  // The derived height keeps the first crop's aspect ratio, so a later crop of another one (only a
  // hand-edited file has it) can sit past the frame edge for that height. The ends are pinned to the
  // targets, so keep the targets in the frame.
  const inFrameX = targetX.map((t, i) => Math.min(t, cropResWidth - solvedW[i]));
  const inFrameY = targetY.map((t, i) => Math.min(t, cropResHeight - solvedH[i]));

  const loX = inFrameX.map((t) => Math.max(0, t - margins.pos));
  const hiX = inFrameX.map((t, i) => Math.min(cropResWidth - solvedW[i], t + margins.pos));
  orderBox(loX, hiX);
  anchor(inFrameX, loX, hiX);
  const solvedX = solveL1Path(clampToBox(inFrameX, loX, hiX), loX, hiX, weights);

  const loY = inFrameY.map((t) => Math.max(0, t - margins.pos));
  const hiY = inFrameY.map((t, i) => Math.min(cropResHeight - solvedH[i], t + margins.pos));
  orderBox(loY, hiY);
  anchor(inFrameY, loY, hiY);
  const solvedY = solveL1Path(clampToBox(inFrameY, loY, hiY), loY, hiY, weights);

  return segmentPath(gridTimes, { x: solvedX, y: solvedY, w: solvedW, h: solvedH });
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
      Math.min(cropResWidth, parseCropToComponents(point.crop, cropResWidth, cropResHeight)[2] * (1 + margins.zoom))
    )
  );
  const solved = runs.map((run) =>
    solveRun(run, firstTime, margins, cropResWidth, cropResHeight, widestW)
  );
  const segments = solved.flatMap((runSegments) => runSegments ?? []);
  if (segments.length === 0) return null;
  if (solved[solved.length - 1] === null) {
    // A cut on the last point leaves a run of one moment, with nothing to solve. Hold its crop
    // there, so the path ends on the cut, as the other crop easings do.
    const lastRun = runs[runs.length - 1];
    const cut = lastRun[lastRun.length - 1];
    const t = cut.x - firstTime;
    const [x, y, w, h] = parseCropToComponents(cut.crop, cropResWidth, cropResHeight);
    segments.push({ startT: t, endT: t, x: [x, 0, 0], y: [y, 0, 0], w: [w, 0, 0], h: [h, 0, 0] });
  }

  return {
    version: CINEMATIC_SOLVER_VERSION,
    margin: { pos: margins.pos, zoom: margins.zoom },
    signature: cropPathSignature(cropMap, margins, cropResWidth, cropResHeight, fps),
    segments,
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
  for (const point of cropMap) s += `${point.x}:${point.crop}:${point.easeIn ?? ''};`;
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
