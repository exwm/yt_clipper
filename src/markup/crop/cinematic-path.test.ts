import { readFileSync } from 'fs';
import { join } from 'path';
import { CropPath, CropPoint } from '../@types/yt_clipper';
import {
  bakeCinematicPath,
  buildBandedM,
  CinematicHolds,
  CinematicMargins,
  cinematicCropMap,
  cinematicMarginsFromPercent,
  cinematicRunTarget,
  DEFAULT_CINEMATIC_MARGIN,
  cropPathSignature,
  evalCropPathAtTime,
  factorBanded,
  firmHeldSpans,
  firmHoldAllowance,
  isCropPathFresh,
  solveBanded,
  solveL1Path,
  splitAtInstantCuts,
  weightsForSpacing,
} from './cinematic-path';

const CROP_RES_W = 1920;
const CROP_RES_H = 1080;

// Dense reconstruction of the symmetric banded matrix, for validating the banded solver.
function denseFromBanded(n: number): number[][] {
  const { md } = buildBandedM(n);
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k <= 3 && i + k < n; k++) {
      M[i][i + k] += md[k][i];
      if (k > 0) M[i + k][i] += md[k][i];
    }
  }
  return M;
}

describe('banded Cholesky solve', () => {
  it('solves M x = b matching a dense matrix-vector product', () => {
    const n = 9;
    const M = denseFromBanded(n);
    const L = factorBanded(buildBandedM(n));
    const x = Float64Array.from({ length: n }, (_v, i) => Math.sin(i) + i * 0.3);
    // b = M x (dense), then solve and confirm we recover x.
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += M[i][j] * x[j];
      b[i] = s;
    }
    const solved = solveBanded(L, b);
    for (let i = 0; i < n; i++) expect(solved[i]).toBeCloseTo(x[i], 6);
  });
});

describe('solveL1Path', () => {
  it('returns the target exactly when the margin is zero (box pins it)', () => {
    const target = [10, 14, 9, 20, 18, 13, 30];
    const solved = solveL1Path(target, [...target], [...target]);
    solved.forEach((v, i) => expect(v).toBeCloseTo(target[i], 6));
  });

  it('keeps a straight ramp straight under a wide margin', () => {
    const n = 30;
    const target = Array.from({ length: n }, (_v, i) => 100 + (i * 200) / (n - 1));
    const lower = target.map((t, i) => (i === 0 || i === n - 1 ? t : t - 50));
    const upper = target.map((t, i) => (i === 0 || i === n - 1 ? t : t + 50));
    const solved = solveL1Path(target, lower, upper);
    // The minimal-derivative path between the anchored ends is the straight line itself (to within
    // the solver's sub-pixel convergence; far inside any real margin).
    solved.forEach((v, i) => expect(Math.abs(v - target[i])).toBeLessThan(1));
  });

  it('stays within the box at every sample (margin inclusion)', () => {
    const n = 40;
    const target = Array.from({ length: n }, (_v, i) => 100 + 80 * Math.sin(i / 3));
    const lower = target.map((t, i) => (i === 0 || i === n - 1 ? t : t - 25));
    const upper = target.map((t, i) => (i === 0 || i === n - 1 ? t : t + 25));
    const solved = solveL1Path(target, lower, upper);
    solved.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(lower[i] - 1e-6);
      expect(v).toBeLessThanOrEqual(upper[i] + 1e-6);
    });
  });

  it('holds steady through a noisy plateau within margin', () => {
    // A jittery signal around a constant: the L1 path should flatten it toward the mean, well inside
    // the margin, instead of tracking every wiggle.
    const n = 40;
    const base = 200;
    const target = Array.from({ length: n }, (_v, i) => base + 8 * Math.sin(i * 1.7));
    const lower = target.map((t, i) => (i === 0 || i === n - 1 ? t : base - 20));
    const upper = target.map((t, i) => (i === 0 || i === n - 1 ? t : base + 20));
    const solved = solveL1Path(target, lower, upper);
    // The interior is far flatter than the input (much smaller total variation).
    const tv = (a: number[]) => a.slice(1).reduce((s, v, i) => s + Math.abs(v - a[i]), 0);
    expect(tv(solved)).toBeLessThan(tv(target) * 0.5);
  });

  it('anchors both ends to the target', () => {
    const target = [50, 60, 70, 65, 80, 90];
    const lower = target.map((t, i) => (i === 0 || i === target.length - 1 ? t : t - 30));
    const upper = target.map((t, i) => (i === 0 || i === target.length - 1 ? t : t + 30));
    const solved = solveL1Path(target, lower, upper);
    expect(solved[0]).toBeCloseTo(target[0], 4);
    expect(solved[solved.length - 1]).toBeCloseTo(target[target.length - 1], 4);
  });
});

// A pan-only crop map: x ramps, size constant. Times in seconds (absolute), crops "x:y:w:h".
const panCropMap: CropPoint[] = [
  { x: 0, y: 0, crop: '100:0:960:540' },
  { x: 1, y: 0, crop: '300:0:960:540' },
  { x: 2, y: 0, crop: '320:0:960:540' },
  { x: 3, y: 0, crop: '900:0:960:540' },
];

describe('bakeCinematicPath', () => {
  const margins = { pos: 0.06, zoom: 0.1 };

  it('returns null for a static (single-value) or too-short map', () => {
    expect(bakeCinematicPath([panCropMap[0]], margins, CROP_RES_W, CROP_RES_H)).toBeNull();
    const zeroDur: CropPoint[] = [
      { x: 5, y: 0, crop: '0:0:960:540' },
      { x: 5, y: 0, crop: '0:0:960:540' },
    ];
    expect(bakeCinematicPath(zeroDur, margins, CROP_RES_W, CROP_RES_H)).toBeNull();
  });

  it('produces contiguous segments tiling [0, duration]', () => {
    const path = bakeCinematicPath(panCropMap, margins, CROP_RES_W, CROP_RES_H);
    expect(path).not.toBeNull();
    const segs = path!.segments;
    expect(segs.length).toBeGreaterThan(0);
    expect(segs[0].startT).toBeCloseTo(0, 6);
    expect(segs[segs.length - 1].endT).toBeCloseTo(3, 6);
    for (let i = 1; i < segs.length; i++) expect(segs[i].startT).toBeCloseTo(segs[i - 1].endT, 6);
  });

  it('is continuous at segment joins and stays within the crop bounds', () => {
    const path = bakeCinematicPath(panCropMap, margins, CROP_RES_W, CROP_RES_H)!;
    for (let i = 1; i < path.segments.length; i++) {
      const t = path.segments[i].startT;
      const left = evalCropPathAtTime({ ...path, segments: path.segments.slice(0, i) }, t);
      const right = evalCropPathAtTime(path, t);
      expect(left[0]).toBeCloseTo(right[0], 3);
    }
    for (let t = 0; t <= 3; t += 0.25) {
      const [x, , w] = evalCropPathAtTime(path, t);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x + w).toBeLessThanOrEqual(CROP_RES_W + 1);
    }
  });

  it('approximates rather than passes through every point (a deliberate, simpler path)', () => {
    // The two close middle points (300 @1s, 320 @2s) sit within the position margin of each other,
    // so the cinematic path should smooth across them instead of tracing both.
    const path = bakeCinematicPath(panCropMap, margins, CROP_RES_W, CROP_RES_H)!;
    // A deliberate, simple path: a handful of segments, not one per grid sample (~30).
    expect(path.segments.length).toBeLessThanOrEqual(8);
    // Endpoints still framed exactly (anchored).
    expect(evalCropPathAtTime(path, 0)[0]).toBeCloseTo(100, 0);
    expect(evalCropPathAtTime(path, 3)[0]).toBeCloseTo(900, 0);
  });

  it('clamps eval outside the path span', () => {
    const path = bakeCinematicPath(panCropMap, margins, CROP_RES_W, CROP_RES_H)!;
    expect(evalCropPathAtTime(path, -5)[0]).toBeCloseTo(evalCropPathAtTime(path, 0)[0], 6);
    expect(evalCropPathAtTime(path, 99)[0]).toBeCloseTo(evalCropPathAtTime(path, 3)[0], 6);
  });

  it('bakes a zoom (size) path that keeps aspect ratio', () => {
    const zoomMap: CropPoint[] = [
      { x: 0, y: 0, crop: '0:0:1920:1080' },
      { x: 1, y: 0, crop: '200:100:1280:720' },
      { x: 2, y: 0, crop: '400:200:960:540' },
    ];
    const path = bakeCinematicPath(zoomMap, margins, CROP_RES_W, CROP_RES_H)!;
    for (let t = 0; t <= 2; t += 0.5) {
      const [, , w, h] = evalCropPathAtTime(path, t);
      expect(w / h).toBeCloseTo(1920 / 1080, 1); // 16:9 maintained
    }
  });
});

describe('solver on a long multi-point clip', () => {
  it('converges to a deliberate (small) segment list, not one per grid sample', () => {
    // 12 points over 20s (~200 grid samples). The adaptive-rho ADMM must converge to a handful of
    // segments (a real wall-clock timing assertion is too flaky under parallel test load; the live
    // bake time is shown in the flash message instead).
    const n = 12;
    const cropMap: CropPoint[] = Array.from({ length: n }, (_v, i) => ({
      x: (i * 20) / (n - 1),
      y: 0 as const,
      crop: `${300 + Math.round(200 * Math.sin(i))}:${200 + Math.round(100 * Math.cos(i))}:960:540`,
    }));
    const path = bakeCinematicPath(cropMap, { pos: 0.04, zoom: 0.08 }, CROP_RES_W, CROP_RES_H);
    expect(path).not.toBeNull();
    // Far fewer than the ~200 grid samples: a compact, deliberate path.
    expect(path!.segments.length).toBeLessThan(40);
    expect(path!.segments[0].startT).toBeCloseTo(0, 6);
    expect(path!.segments[path!.segments.length - 1].endT).toBeCloseTo(20, 6);
  });
});

describe('signature / freshness', () => {
  const margins = { pos: 0.06, zoom: 0.1 };

  it('matches a freshly baked path and goes stale on an edit', () => {
    const path = bakeCinematicPath(panCropMap, margins, CROP_RES_W, CROP_RES_H)!;
    expect(isCropPathFresh(path, panCropMap, margins, CROP_RES_W, CROP_RES_H)).toBe(true);

    const edited = panCropMap.map((p, i) => (i === 1 ? { ...p, crop: '305:0:960:540' } : p));
    expect(isCropPathFresh(path, edited, margins, CROP_RES_W, CROP_RES_H)).toBe(false);

    const widerMargin = { pos: 0.12, zoom: 0.1 };
    expect(isCropPathFresh(path, panCropMap, widerMargin, CROP_RES_W, CROP_RES_H)).toBe(false);
  });

  it('changes the signature when the crop map changes', () => {
    const a = cropPathSignature(panCropMap, margins, CROP_RES_W, CROP_RES_H);
    const b = cropPathSignature(
      [...panCropMap, { x: 4, y: 0, crop: '500:0:960:540' }],
      margins,
      CROP_RES_W,
      CROP_RES_H
    );
    expect(a).not.toBe(b);
  });
});

describe('instant cuts', () => {
  const cutMargins = { pos: 0.1, zoom: 0 };
  const point = (x: number, cropX: number, easeIn?: 'instant'): CropPoint => ({
    x,
    y: 0,
    crop: `${cropX}:0:400:300`,
    easeIn,
  });

  it('splits the run at a cut: holds before it and jumps at it, like the render', () => {
    const cropMap = [point(0, 100), point(2, 100), point(2.5, 1200, 'instant'), point(4, 1200)];
    const runs = splitAtInstantCuts(cropMap);
    expect(runs.map((run) => run.map((p) => p.x))).toEqual([
      [0, 2, 2.5],
      [2.5, 4],
    ]);

    const path = bakeCinematicPath(cropMap, cutMargins, CROP_RES_W, CROP_RES_H)!;
    // Just before the cut the crop still holds the first scene; at the cut it is the second.
    expect(evalCropPathAtTime(path, 2.49)[0]).toBeCloseTo(100, 0);
    expect(evalCropPathAtTime(path, 2.5)[0]).toBeCloseTo(1200, 0);
  });

  it('solves a cut-free map as one run', () => {
    const cropMap = [point(0, 100), point(1, 300), point(2, 500)];
    expect(splitAtInstantCuts(cropMap)).toEqual([cropMap]);
  });

  it.each([
    ['raw cut time', undefined, 100],
    ['cut on the frame boundary', 30, 1200],
  ])('with %s, the frame a cut point falls in shows the cut', (_case, fps, cropX) => {
    // At 30 fps the cut point at 1.0167 s falls in the frame at 1.0, as the other easings cut.
    // The clipper's test_cinematic_path.py checks the same case.
    const cropMap = [point(0, 100), point(1.0167, 1200, 'instant'), point(2, 1200)];
    const path = bakeCinematicPath(cropMap, cutMargins, CROP_RES_W, CROP_RES_H, fps)!;
    expect(evalCropPathAtTime(path, 1.0)[0]).toBeCloseTo(cropX, 0);
  });

  it.each([
    ['on a frame', 0],
    ['between frames', 10.52],
  ])('with the pair start %s, a cut snaps on the video frame grid', (_case, pairStart) => {
    // The preview's crop point times are video times, as in the clipper's test_cinematic_path.py.
    const fps = 30;
    const pointTime = 1.0033;
    const cropMap = [
      point(pairStart, 0),
      point(pairStart + pointTime, 1200, 'instant'),
      point(pairStart + 2, 1200),
    ];
    const path = bakeCinematicPath(cropMap, cutMargins, CROP_RES_W, CROP_RES_H, fps)!;
    const pointFrameTime = Math.floor((pairStart + pointTime) * fps) / fps - pairStart;
    expect(evalCropPathAtTime(path, pointFrameTime - 1 / fps)[0]).toBeCloseTo(0, 0);
    expect(evalCropPathAtTime(path, pointFrameTime)[0]).toBeCloseTo(1200, 0);
  });

  it.each([
    ['raw cut time', undefined, 2],
    ['cut on the frame boundary', 30, 1.99],
  ])('with %s, a cut on the last point still shows', (_case, fps, time) => {
    // The clipper's test_cinematic_path.py checks the same case.
    const cropMap = [point(0, 100), point(1, 100), point(2, 1200, 'instant')];
    const path = bakeCinematicPath(cropMap, cutMargins, CROP_RES_W, CROP_RES_H, fps)!;
    expect(evalCropPathAtTime(path, time)[0]).toBeCloseTo(1200, 0);
  });

  it('goes stale when the frame rate changes', () => {
    const cropMap = [point(0, 100), point(1.0167, 1200, 'instant'), point(2, 1200)];
    const path = bakeCinematicPath(cropMap, cutMargins, CROP_RES_W, CROP_RES_H, 30)!;
    expect(isCropPathFresh(path, cropMap, cutMargins, CROP_RES_W, CROP_RES_H, 30)).toBe(true);
    expect(isCropPathFresh(path, cropMap, cutMargins, CROP_RES_W, CROP_RES_H, 60)).toBe(false);
  });
});

describe('bounds and clip length', () => {
  it('keeps a crop near the right edge on-screen when the zoom margin inverts the box', () => {
    const cropMap: CropPoint[] = [
      { x: 0, y: 0, crop: '1500:0:400:225' },
      { x: 2, y: 0, crop: '1510:0:400:225' },
    ];
    const path = bakeCinematicPath(cropMap, { pos: 0.5, zoom: 0.5 }, CROP_RES_W, CROP_RES_H)!;
    for (let t = 0; t <= 2; t += 0.1) {
      const [x, , w] = evalCropPathAtTime(path, t);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x + w).toBeLessThanOrEqual(CROP_RES_W + 1);
    }
  });

  it.each([
    ['hold then pan to the frame edge', [0, 0, 960, 960]],
    ['hold then a quick move', [400, 400, 900, 900]],
    ['hand-edited crop past the frame edge', [0, 0, 1500, 1500]],
    ['hand-edited crop before the frame edge', [-50, -50, 400, 400]],
  ])('stays in the margin and the frame between samples: %s', (_name, xs) => {
    // The clipper's test_cinematic_path.py checks the same cases.
    const times = [0, 1, 1.1, 2];
    const cropMap: CropPoint[] = times.map((t, i) => ({ x: t, y: 0, crop: `${xs[i]}:0:960:540` }));
    const margin = 0.05;
    const path = bakeCinematicPath(cropMap, { pos: margin, zoom: 0 }, CROP_RES_W, CROP_RES_H)!;
    // The margin is a share of the crop's shorter side.
    const marginPx = margin * Math.min(960, 540);
    const low = Math.max(Math.min(...xs) - marginPx, 0);
    const high = Math.min(Math.max(...xs) + marginPx, CROP_RES_W - 960);
    for (let i = 0; i <= 2000; i++) {
      const [x] = evalCropPathAtTime(path, i / 1000);
      expect(x).toBeGreaterThanOrEqual(low - 0.4);
      expect(x).toBeLessThanOrEqual(high + 0.4);
    }
  });

  it('keeps the crop edges in the frame between samples on quick zooms', () => {
    // x and w each fit within tolerance, x + w did not. The clipper's test_cinematic_path.py checks
    // the same case.
    const cropMap: CropPoint[] = [
      { x: 0.172, y: 0, crop: '960:540:960:540' },
      { x: 0.343, y: 0, crop: '0:0:1920:1080' },
      { x: 0.493, y: 0, crop: '480:270:1440:810' },
      { x: 0.841, y: 0, crop: '480:270:1440:810' },
      { x: 0.881, y: 0, crop: '1440:810:480:270' },
      { x: 1.128, y: 0, crop: '0:0:1920:1080' },
    ];
    const path = bakeCinematicPath(cropMap, { pos: 0.3, zoom: 0 }, CROP_RES_W, CROP_RES_H)!;
    for (let i = 0; i <= 1000; i++) {
      const [x, y, w, h] = evalCropPathAtTime(path, i / 1000);
      expect(x + w).toBeLessThanOrEqual(CROP_RES_W + 0.4);
      expect(y + h).toBeLessThanOrEqual(CROP_RES_H + 0.4);
    }
  });

  it('keeps a full-height crop at its aspect ratio', () => {
    // A 9:16 short from a 16:9 video with a quick punch-in. The clipper's test_cinematic_path.py
    // checks the same case.
    const cropMap: CropPoint[] = [
      { x: 0, y: 0, crop: '656:0:607:1080' },
      { x: 1.2, y: 0, crop: '656:0:607:1080' },
      { x: 1.4, y: 0, crop: '807:270:304:540' },
      { x: 1.8, y: 0, crop: '656:0:607:1080' },
      { x: 3, y: 0, crop: '656:0:607:1080' },
    ];
    const path = bakeCinematicPath(cropMap, { pos: 0.07, zoom: 0.08 }, CROP_RES_W, CROP_RES_H)!;
    for (let i = 0; i <= 300; i++) {
      const [, , w, h] = evalCropPathAtTime(path, i / 100);
      expect(Math.abs(w / h / (607 / 1080) - 1)).toBeLessThan(0.01);
    }
  });

  const point = (x: number, crop: string, easeIn?: 'instant'): CropPoint => ({
    x,
    y: 0,
    crop,
    easeIn,
  });
  it.each([
    [
      'quick zoom',
      1,
      [point(0, '110:0:1158:651'), point(1.43, '920:288:207:116'), point(1.51, '270:451:966:543')],
    ],
    [
      'wide strip',
      1,
      [point(0, '0:500:1920:80'), point(1.43, '720:530:480:20'), point(1.51, '0:500:1920:80')],
    ],
    // The render zooms against the widest crop of the whole path, before the cut too.
    [
      'quick zoom after a cut from a wide crop',
      0.5,
      [
        point(0, '0:0:1920:1080'),
        point(1, '0:0:1920:1080'),
        point(1.3, '1571:75:283:159', 'instant'),
        point(1.8, '715:934:197:111'),
        point(1.9, '842:701:600:338'),
      ],
    ],
  ])('keeps an overshoot a crop the render shows: %s', (_name, zoom, cropMap) => {
    // The crop overshot to 1 px wide or 2 px tall, and ffmpeg's zoompan zooms in at most 10x. The
    // clipper's test_cinematic_path.py checks the same cases.
    const path = bakeCinematicPath(
      cropMap,
      { pos: DEFAULT_CINEMATIC_MARGIN, zoom },
      CROP_RES_W,
      CROP_RES_H
    )!;
    const end = Math.round(cropMap[cropMap.length - 1].x * 1000);
    const sizes = Array.from({ length: end + 1 }, (_v, i) =>
      evalCropPathAtTime(path, i / 1000).slice(2)
    );
    const widths = sizes.map(([w]) => w);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(Math.max(...widths) / 10 - 0.4);
    expect(Math.min(...sizes.map(([, h]) => h))).toBeGreaterThanOrEqual(20 - 0.4);
  });

  it.each([
    ['tall crop', 300, 600],
    ['wide crop', 600, 300],
  ])('keeps the position margin a share of the crop shorter side: %s', (_name, width, height) => {
    // Points that jitter 120 px in x and y: a 10% margin of the 300 px shorter side lets the crop
    // drift 30 px either way, in both directions; a share of the longer side would allow 60. The
    // clipper's test_cinematic_path.py checks the same cases.
    const xs = [800, 920, 800, 920, 800, 920, 800];
    const ys = [200, 320, 200, 320, 200, 320, 200];
    const cropMap: CropPoint[] = xs.map((x, i) => ({
      x: i / 2,
      y: 0,
      crop: `${x}:${ys[i]}:${width}:${height}`,
    }));
    const path = bakeCinematicPath(cropMap, { pos: 0.1, zoom: 0 }, CROP_RES_W, CROP_RES_H)!;
    const linear = (values: number[], t: number) => {
      const i = Math.min(Math.floor(t * 2), values.length - 2);
      return values[i] + (values[i + 1] - values[i]) * (t * 2 - i);
    };
    const crops = Array.from({ length: 301 }, (_v, i) => evalCropPathAtTime(path, i / 100));
    for (const [axis, points] of [
      [0, xs],
      [1, ys],
    ] as const) {
      const drift = Math.max(...crops.map((c, i) => Math.abs(c[axis] - linear(points, i / 100))));
      // Uses the whole margin to smooth the jitter, and no more.
      expect(drift).toBeGreaterThanOrEqual(30 - 1);
      expect(drift).toBeLessThanOrEqual(30 + 0.4);
    }
  });

  it('keeps a last crop of another aspect ratio in the frame', () => {
    // Only a hand-edited file has it: the height keeps the first crop's ratio, the end y the last's.
    // The clipper's test_cinematic_path.py checks the same case.
    const cropMap: CropPoint[] = [
      { x: 0, y: 0, crop: '0:0:iw:1105' },
      { x: 2, y: 0, crop: '1035.36:1373:2210:17' },
    ];
    const path = bakeCinematicPath(
      cropMap,
      { pos: DEFAULT_CINEMATIC_MARGIN, zoom: 0.08 },
      CROP_RES_W,
      CROP_RES_H
    )!;
    for (let i = 0; i <= 1000; i++) {
      const [, y, , h] = evalCropPathAtTime(path, i / 500);
      expect(y + h).toBeLessThanOrEqual(CROP_RES_H + 0.4);
    }
  });

  it('pulls the path toward the target inside the box', () => {
    // A slow swing inside a box wide enough to flatten it: the pull keeps the path closer to the
    // target, still within the box, and a very strong pull reproduces it. The clipper's
    // test_cinematic_path.py checks the same case.
    const target = Array.from({ length: 40 }, (_v, i) => 40 * Math.sin((i * 2 * Math.PI) / 20));
    const lower = target.map((t) => t - 50);
    const upper = target.map((t) => t + 50);
    const distance = (fidelity: number) => {
      const path = solveL1Path([...target], lower, upper, undefined, fidelity);
      path.forEach((p, i) => {
        expect(p).toBeGreaterThanOrEqual(lower[i] - 1e-9);
        expect(p).toBeLessThanOrEqual(upper[i] + 1e-9);
      });
      return path.reduce((sum, p, i) => sum + Math.abs(p - target[i]), 0) / target.length;
    };
    expect(distance(0.2)).toBeLessThan(distance(0) - 5);
    expect(distance(1e6)).toBeLessThan(0.01);
  });

  it('scales the objective weights with grid spacing, matching the 10 Hz tuning at 0.1s', () => {
    // A k-th difference scales with dt^k, so weight k scales by dt^(1-k) relative to 0.1s.
    expect(weightsForSpacing(0.1)).toEqual([10, 1, 100]);
    const [w1, w2, w3] = weightsForSpacing(0.3);
    expect(w1).toBe(10);
    expect(w2).toBeCloseTo(1 / 3);
    expect(w3).toBeCloseTo(100 / 9);
  });
});

describe('hold points', () => {
  const MARGINS = { pos: 0.12, zoom: 0.08 };
  const point = (x: number, crop: string, extra: Partial<CropPoint> = {}): CropPoint => ({
    x,
    y: 0,
    crop,
    ...extra,
  });
  // A pan, a hold at 600, and a pan on, with the hold's edges off the 10 Hz grid.
  const panHoldPan = (holdStart: number, holdEnd: number, hold = true): CropPoint[] => [
    point(0, '100:300:640:360'),
    point(holdStart, '600:300:640:360'),
    point(holdEnd, '600:300:640:360', hold ? { hold: true } : {}),
    point(holdEnd + 2, '1200:300:640:360'),
  ];
  // The most the path's x, y or width moves from the held crop over a span, densely sampled.
  const moveOver = (cropMap: CropPoint[], start: number, end: number, fps?: number): number => {
    const path = bakeCinematicPath(cropMap, MARGINS, CROP_RES_W, CROP_RES_H, fps)!;
    const held = evalCropPathAtTime(path, start);
    let most = 0;
    for (let t = start; t <= end + 1e-9; t += 0.005) {
      const crop = evalCropPathAtTime(path, Math.min(t, end));
      for (const i of [0, 1, 2]) most = Math.max(most, Math.abs(crop[i] - held[i]));
    }
    return most;
  };

  it.each([
    ['a hold between two pans', panHoldPan(2.03, 3.07), 2.03, 3.07],
    ['a hold with its edges off the grid the other way', panHoldPan(2.07, 3.03), 2.07, 3.03],
    ['a hold shorter than a grid step', panHoldPan(2.03, 2.09), 2.03, 2.09],
    [
      'a hold in a long pair, with a coarser grid',
      [...panHoldPan(60.03, 61.07), point(120, '0:0:640:360')],
      60.03,
      61.07,
    ],
    [
      'two hold points in a row',
      [
        ...panHoldPan(2.03, 3.07).slice(0, 3),
        point(4.01, '600:300:640:360', { hold: true }),
        point(6, '1200:300:640:360'),
      ],
      2.03,
      4.01,
    ],
    [
      'a hold point as the last point',
      [
        point(0, '100:300:640:360'),
        point(2.03, '600:300:640:360'),
        point(3.07, '600:300:640:360', { hold: true }),
      ],
      2.03,
      3.07,
    ],
    [
      'a zoom held still',
      [
        point(0, '0:0:1920:1080'),
        point(2.03, '480:270:960:540'),
        point(3.07, '480:270:960:540', { hold: true }),
        point(5, '0:0:1920:1080'),
      ],
      2.03,
      3.07,
    ],
  ])('holds the crop still over %s', (_case, cropMap, start, end) => {
    expect(moveOver(cropMap, start, end)).toBeLessThan(0.5);
  });

  it.each([
    [
      "the run's first crop, a hold starting less than a grid step after it",
      [
        point(0, '100:300:640:360'),
        point(0.05, '600:300:640:360'),
        point(2, '600:300:640:360', { hold: true }),
      ],
      0,
      100,
    ],
    [
      "the run's last crop, a hold ending less than a grid step before it",
      [
        point(0, '100:300:640:360'),
        point(2, '600:300:640:360'),
        point(3.95, '600:300:640:360', { hold: true }),
        point(4, '900:300:640:360'),
      ],
      4,
      900,
    ],
    [
      'the end of a hold less than a grid step before the next hold',
      [
        point(0, '100:300:640:360'),
        point(1, '600:300:640:360'),
        point(2.01, '600:300:640:360', { hold: true }),
        point(2.09, '700:300:640:360'),
        point(3, '700:300:640:360', { hold: true }),
        point(5, '1200:300:640:360'),
      ],
      // Its last own grid sample: the move to the next hold fits in the one grid step after it.
      2.0,
      600,
    ],
  ])('keeps %s', (_case, cropMap, time, x) => {
    const path = bakeCinematicPath(cropMap, MARGINS, CROP_RES_W, CROP_RES_H)!;
    expect(evalCropPathAtTime(path, time)[0]).toBeCloseTo(x, 0);
  });

  it('holds a hold point before a cut until the cut', () => {
    const cropMap = [
      point(0, '100:300:640:360'),
      point(2.03, '600:300:640:360'),
      point(3.07, '600:300:640:360', { hold: true }),
      point(4.5, '1200:300:640:360', { easeIn: 'instant' }),
      point(6, '1300:300:640:360'),
    ];
    // The cut lands half a frame before the frame it falls in, at 30 fps: 4.4833 s.
    const justBeforeCut = (135 - 0.5) / 30 - 0.005;
    expect(moveOver(cropMap, 2.03, justBeforeCut, 30)).toBeLessThan(0.5);
    const path = bakeCinematicPath(cropMap, MARGINS, CROP_RES_W, CROP_RES_H, 30)!;
    expect(evalCropPathAtTime(path, justBeforeCut)[0]).toBeCloseTo(600, 0);
  });

  it.each([
    ['without the hold flag', panHoldPan(2.03, 3.07, false)],
    [
      'with a hold flag on a crop that differs from the one before it (a hand-edited file)',
      panHoldPan(2.03, 3.07).map((p, i) => (i === 2 ? { ...p, crop: '620:300:640:360' } : p)),
    ],
    [
      'with a hold flag on the same crop written differently, as the markup releases it on load',
      panHoldPan(2.03, 3.07).map((p, i) => (i === 2 ? { ...p, crop: '600.0:300:640:360' } : p)),
    ],
    ['with Loose holds', cinematicCropMap(panHoldPan(2.03, 3.07), 'loose')],
  ])('lets the crop move within the margin %s', (_case, cropMap) => {
    expect(moveOver(cropMap, 2.03, 3.07)).toBeGreaterThan(5);
  });

  // The most a 30 fps frame's step changes from the frame before, on x over [start, end].
  const largestStepChange = (
    cropMap: CropPoint[],
    margins: typeof MARGINS,
    start: number,
    end: number
  ) => {
    const path = bakeCinematicPath(cropMap, margins, CROP_RES_W, CROP_RES_H, 30)!;
    let largest = 0;
    for (let t = start; t + 2 / 30 <= end + 1e-9; t += 1 / 30) {
      const [x0, x1, x2] = [0, 1, 2].map((f) => evalCropPathAtTime(path, t + f / 30)[0]);
      largest = Math.max(largest, Math.abs(x2 - 2 * x1 + x0));
    }
    return largest;
  };
  const TIGHT = { pos: 0.03, zoom: 0.02 };

  it('eases a fast pan into and out of a hold point at a tight margin', () => {
    // A 250 px/s pan stopping dead at the hold steps about 4.7 px between frames at once.
    const cropMap = [
      point(0, '100:300:640:360'),
      point(2, '600:300:640:360'),
      point(3.5, '600:300:640:360', { hold: true }),
      point(5.5, '1100:300:640:360'),
    ];
    expect(largestStepChange(cropMap, TIGHT, 1.5, 2.5)).toBeLessThan(2.5);
    expect(largestStepChange(cropMap, TIGHT, 3, 4)).toBeLessThan(2.5);
    expect(moveOver(cropMap, 2, 3.5)).toBeLessThan(0.5);
  });

  it.each([TIGHT, MARGINS])(
    'eases a short section into a hold point back across the crop point before it (%o)',
    (margins) => {
      // 0.3 s from the crop point before the hold: confined to it, the ease stopped hard (6.3 px/frame
      // at the tight margin).
      const cropMap = [
        point(0, '100:300:640:360'),
        point(1.7, '500:300:640:360'),
        point(2, '600:300:640:360'),
        point(3.5, '600:300:640:360', { hold: true }),
        point(5.5, '1100:300:640:360'),
      ];
      expect(largestStepChange(cropMap, margins, 1.2, 2.4)).toBeLessThan(1.2);
      expect(moveOver(cropMap, 2, 3.5)).toBeLessThan(0.5);
    }
  );

  it('paces a fast pan evenly into a hold point, reaching back across the crop point before it', () => {
    // 400 px/s. Confined to the last 1.4 s section, the ease would surge to about 1.37x before braking
    // hard; reaching back it cruises at about 1.15x and brakes gently, passing the 1.4 s crop point
    // ahead of the line.
    const cropMap = [
      point(0, '0:300:640:360'),
      point(1.4, '560:300:640:360'),
      point(2.8, '1120:300:640:360'),
      point(4.3, '1120:300:640:360', { hold: true }),
    ];
    const path = bakeCinematicPath(cropMap, TIGHT, CROP_RES_W, CROP_RES_H, 30)!;
    for (let t = 0; t + 1 / 30 <= 2.8; t += 1 / 30) {
      const speed = (evalCropPathAtTime(path, t + 1 / 30)[0] - evalCropPathAtTime(path, t)[0]) * 30;
      expect(speed).toBeLessThan(400 * 1.25);
    }
    // The last step into the hold, about 1.3 px/frame, is the 10 Hz grid's floor for this stop.
    expect(largestStepChange(cropMap, TIGHT, 1.6, 3.4)).toBeLessThan(1.5);
  });

  it('keeps a slow pan at its speed until it slows into a hold point, with no surge before it', () => {
    // 100 px/s for 10 s.
    const cropMap = [
      point(0, '100:300:640:360'),
      point(10, '1100:300:640:360'),
      point(11, '1100:300:640:360', { hold: true }),
    ];
    const path = bakeCinematicPath(cropMap, TIGHT, CROP_RES_W, CROP_RES_H, 30)!;
    const speedAt = (t: number) =>
      (evalCropPathAtTime(path, t + 0.1)[0] - evalCropPathAtTime(path, t)[0]) / 0.1;
    // The ease takes the last 2.5 s, cruising at about 1.14x before it brakes; the solve adds a few
    // percent near the run's end. A cubic ease from the straight line to rest would reach 133.
    for (let t = 1; t <= 9.9; t += 0.1) {
      expect(speedAt(t)).toBeGreaterThan(t < 7 ? 95 : 0);
      expect(speedAt(t)).toBeLessThan(125);
    }
  });

  it.each([
    ['a crop that differs from the one before it', '620:300:640:360'],
    ['the same crop written differently', '600.0:300:640:360'],
  ])('ignores a hold flag the markup releases on load, on %s, also before a cut', (_case, crop) => {
    const flagged = [
      point(0, '100:300:640:360'),
      point(2.03, '600:300:640:360'),
      point(3.07, crop, { hold: true }),
      point(4.5, '1200:300:640:360', { easeIn: 'instant' }),
      point(6, '1300:300:640:360'),
    ];
    const plain = flagged.map((p) => ({ ...p, hold: undefined }));
    const [a, b] = [flagged, plain].map(
      (map) => bakeCinematicPath(map, MARGINS, CROP_RES_W, CROP_RES_H, 30)!
    );
    for (let t = 0; t <= 6; t += 0.05) {
      expect(evalCropPathAtTime(a, t)).toEqual(evalCropPathAtTime(b, t));
    }
  });

  it('keeps a straight move into a hold point straight', () => {
    // A diagonal pan: x moves 5x as far as y, so separate eases would bend it.
    const cropMap = [
      point(0, '100:300:640:360'),
      point(2, '1100:500:640:360'),
      point(3, '1100:500:640:360', { hold: true }),
    ];
    const target = cinematicRunTarget(cropMap, 0, CROP_RES_W, CROP_RES_H)!;
    for (let t = 0.1; t < 2; t += 0.1) {
      const [x, y] = target.at(t);
      expect(y - 300).toBeCloseTo((x - 100) / 5, 6);
    }
  });

  it('solves again when only the hold flag changes', () => {
    const held = panHoldPan(2.03, 3.07);
    const notHeld = panHoldPan(2.03, 3.07, false);
    expect(cropPathSignature(held, MARGINS, CROP_RES_W, CROP_RES_H)).not.toBe(
      cropPathSignature(notHeld, MARGINS, CROP_RES_W, CROP_RES_H)
    );
  });
});

describe('Firm hold points', () => {
  const MARGINS = { pos: 0.12, zoom: 0.08 };
  const point =(x: number, crop: string, extra: Partial<CropPoint> = {}): CropPoint => ({
    x,
    y: 0,
    crop,
    ...extra,
  });
  const panHoldPan = (left: number): CropPoint[] => [
    point(0, '100:300:640:360'),
    point(2, `${left}:300:640:360`),
    point(3.6, `${left}:300:640:360`, { hold: true }),
    point(5.2, '1200:300:640:360'),
  ];
  const solve = (
    cropMap: readonly CropPoint[],
    holds: CinematicHolds,
    margins: CinematicMargins = MARGINS
  ) => bakeCinematicPath(cinematicCropMap(cropMap, holds), margins, CROP_RES_W, CROP_RES_H, 30)!;
  const drift = (path: CropPath, start: number, end: number) => {
    const xs: number[] = [];
    for (let t = start; t <= end + 1e-9; t += 0.01) xs.push(evalCropPathAtTime(path, t)[0]);
    return Math.max(...xs) - Math.min(...xs);
  };

  it.each([
    [0.03, 2, 3.6],
    [0.12, 2, 3.6],
    [0.2, 2, 3.6],
    [0.12, 2.03, 3.07],
  ])(
    'holds still past its settle, within the margin, at a %s margin from %s to %s s',
    (margin, start, end) => {
      const cropMap = [
        point(0, '100:300:640:360'),
        point(start, '740:300:640:360'),
        point(end, '740:300:640:360', { hold: true }),
        point(end + 1.6, '1200:300:640:360'),
      ];
      const [loose, firm, exact] = (['loose', 'firm', 'exact'] as const).map((holds) =>
        solve(cropMap, holds, { pos: margin, zoom: margin })
      );
      // Hold edges between grid samples once let the crop arrive late and leave early.
      expect(drift(firm, start + 0.3, end - 0.3)).toBeLessThan(0.5);
      expect(drift(firm, start, end)).toBeLessThanOrEqual(2 * margin * 360);
      expect(drift(firm, start, end)).toBeLessThan(drift(loose, start, end));
      expect(drift(exact, start, end)).toBeLessThan(0.5);
    }
  );

  // Two holds with a quick 80 px move between them: a crop still at both ends must start and stop hard.
  const crowded = [
    point(0, '400:300:640:360'),
    point(1, '400:300:640:360'),
    point(2, '400:300:640:360', { hold: true }),
    point(2.2, '480:300:640:360'),
    point(3.2, '480:300:640:360', { hold: true }),
    point(4.5, '480:300:640:360'),
  ];

  it('borrows time from crowded holds for a quick move between them, and jolts far less than Exact', () => {
    const largestSpeedChange = (path: CropPath) => {
      let largest = 0;
      for (let f = 45; f < 114; f++) {
        const [a, b, c] = [f, f + 1, f + 2].map((g) => evalCropPathAtTime(path, g / 30)[0]);
        largest = Math.max(largest, Math.abs(c - 2 * b + a));
      }
      return largest;
    };
    const firm = solve(crowded, 'firm');
    expect(largestSpeedChange(firm)).toBeLessThan(largestSpeedChange(solve(crowded, 'exact')) / 3);
    expect(drift(firm, 1.1, 1.5)).toBeLessThan(0.5);
    expect(drift(firm, 2.6, 3)).toBeLessThan(0.5);
  });

  const at = (x: number) => `${x}:300:640:360`;
  // A pan of 640 px in 0.8 s into a hold to 3.6 s, as one hold point or split by a second one.
  const panIntoHold = (split: boolean) => [
    point(0, at(100)),
    point(0.8, at(740)),
    ...(split ? [point(0.9, at(740), { hold: true })] : []),
    point(3.6, at(740), { hold: true }),
    point(4.4, at(1200)),
  ];
  // An 800 px pan in 1 s, a still point with its crop 0.05 s later, and a hold to 3 s.
  const stillPointBeforeHold = [
    point(0, at(100)),
    point(1, at(900)),
    point(1.05, at(900)),
    point(3, at(900), { hold: true }),
  ];

  it.each([
    // Per hold: start, end, crop widths per second into and out of it, and the settle times: 0.1 s
    // next to a move, none next to a still section, and half of the time the quick move between two
    // holds is missing (0.5 s to start and stop at 2 crop widths/s², in a 0.2 s section).
    ['a lone hold', panHoldPan(740), [[2, 3.6, 0.5, 460 / 1.6 / 640, 0.1, 0.1]]],
    [
      'two crowded holds',
      crowded,
      [
        [1, 2, 0, 80 / 0.2 / 640, 0, 0.15],
        [2.2, 3.2, 80 / 0.2 / 640, 0, 0.15, 0],
      ],
    ],
    // Consecutive hold points are one hold.
    ['a hold split by a second hold point', panIntoHold(true), [[0.8, 3.6, 640 / 0.8 / 640, 460 / 0.8 / 640, 0.1, 0.1]]],
    // The pan braked for 0.05 s at 4 crop widths/s² by the time it reaches the hold.
    ['a hold after a still point', stillPointBeforeHold, [[1.05, 3, 1.25 - 4 * 0.05, 0, 0.05, 0]]],
    // A point nudged 2 px (under 1% of the width) counts as still.
    [
      'a hold after a point nudged off its crop',
      [point(0, at(100)), point(1, at(900)), point(1.05, at(902)), point(3, at(902), { hold: true })],
      [[1.05, 3, 1.25 - 4 * 0.05, 0, 0.05, 0]],
    ],
    // 7 px (over 1% of the width) is a move of its own, so the hold settles from it.
    [
      'a hold after a point moved 7 px',
      [point(0, at(100)), point(1, at(900)), point(1.05, at(907)), point(3, at(907), { hold: true })],
      [[1.05, 3, 7 / 0.05 / 640, 0, 0.1, 0]],
    ],
    [
      'a hold after only still points',
      [point(0, at(740)), point(1, at(740)), point(2, at(740), { hold: true }), point(3, at(1200))],
      [[1, 2, 0, 460 / 640, 0, 0.1]],
    ],
    // A still point between two holds does not join them, and neither hold moves into it.
    [
      'two holds with a still point between',
      [
        point(0, at(100)),
        point(1, at(740)),
        point(2, at(740), { hold: true }),
        point(2.05, at(740)),
        point(3, at(740), { hold: true }),
        point(4, at(1200)),
      ],
      [
        [1, 2, 1, 0, 0.1, 0],
        [2.05, 3, 0, 460 / 640, 0, 0.1],
      ],
    ],
    // An 80 px move takes 0.5 s to start and stop. It has 0.2 s between the holds, its own 0.1 s and
    // a still point's 0.1 s, so each hold lends 0.15 s; the second hold sees the pan braked for 0.1 s.
    [
      'two holds with a quick move and a still point between',
      [
        point(0, at(400)),
        point(1, at(400)),
        point(2, at(400), { hold: true }),
        point(2.1, at(480)),
        point(2.2, at(480)),
        point(3.2, at(480), { hold: true }),
        point(4.5, at(480)),
      ],
      [
        [1, 2, 0, 80 / 0.1 / 640, 0, 0.15],
        [2.2, 3.2, 80 / 0.1 / 640 - 4 * 0.1, 0, 0.15, 0],
      ],
    ],
    // The move between them would borrow 0.35 s (0.79 s to start and stop, in 0.1 s), capped at 40%
    // of each 0.3 s hold.
    [
      'two short holds with a quick move between',
      [
        point(0, at(400)),
        point(0.7, at(400)),
        point(1, at(400), { hold: true }),
        point(1.1, at(600)),
        point(1.4, at(600), { hold: true }),
        point(2, at(600)),
      ],
      [
        [0.7, 1, 0, 200 / 0.1 / 640, 0, 0.12],
        [1.1, 1.4, 200 / 0.1 / 640, 0, 0.12, 0],
      ],
    ],
  ])('times the braking and settle of %s', (_name, cropMap, expected) => {
    const spans = firmHeldSpans(cinematicCropMap(cropMap, 'firm'), CROP_RES_W, CROP_RES_H);
    const fields = spans.map((s) => [s.start, s.end, s.speedIn, s.speedOut, s.settleIn, s.settleOut]);
    expect(fields).toEqual(expected.map((row) => row.map((v) => expect.closeTo(v))));
  });

  it('holds a hold before a cut up to the cut, at rest', () => {
    const [run] = splitAtInstantCuts(
      cinematicCropMap(
        [
          point(0, at(100)),
          point(2, at(600)),
          point(3.5, at(600), { hold: true }),
          point(4.5, at(1200), { easeIn: 'instant' }),
          point(6, at(900)),
        ],
        'firm'
      ),
      30
    );
    const [span] = firmHeldSpans(run, CROP_RES_W, CROP_RES_H);
    expect([span.start, span.end, span.speedOut, span.settleOut]).toEqual([2, run[run.length - 1].x, 0, 0]);
  });

  it('holds a hold split by a second hold point exactly as one hold point', () => {
    const [split, single] = [true, false].map((s) => solve(panIntoHold(s), 'firm', { pos: 0.03, zoom: 0.03 }));
    for (let f = 0; f <= 132; f++) {
      expect(evalCropPathAtTime(split, f / 30)).toEqual(evalCropPathAtTime(single, f / 30));
    }
  });

  it.each([
    ['before', stillPointBeforeHold, [point(0, at(100)), point(1, at(900)), point(3, at(900), { hold: true })], MARGINS],
    [
      'after',
      [point(0, at(100)), point(2, at(100), { hold: true }), point(2.05, at(100)), point(3, at(900))],
      [point(0, at(100)), point(2, at(100), { hold: true }), point(3, at(900))],
      MARGINS,
    ],
    // Nudged 2 px off the hold's crop, at a margin too tight to brake within.
    [
      'nudged 2 px before',
      [point(0, at(100)), point(1, at(900)), point(1.05, at(902)), point(3, at(902), { hold: true })],
      [point(0, at(100)), point(1, at(902)), point(3, at(902), { hold: true })],
      { pos: 0.03, zoom: 0.03 },
    ],
  ])('brakes as smoothly with a still point %s the hold as without', (_case, withPoint, without, margins) => {
    const largestSpeedChange = (path: CropPath) => {
      let largest = 0;
      for (let f = 0; f < 88; f++) {
        const [a, b, c] = [f, f + 1, f + 2].map((g) => evalCropPathAtTime(path, g / 30)[0]);
        largest = Math.max(largest, Math.abs(c - 2 * b + a));
      }
      return largest;
    };
    expect(largestSpeedChange(solve(withPoint, 'firm', margins))).toBeLessThan(
      1.5 * largestSpeedChange(solve(without, 'firm', margins))
    );
  });

  it.each([
    // At 2 crop widths/s the crop needs 0.4325 crop widths past the 0.0675 margin to stop at
    // 4 crop widths/s², shed over 0.5 s.
    [2, 0.1, 1, 276.8],
    [2, 0.1, 1.25, 138.4],
    [2, 0.1, 1.5, 0],
    // A slow crop only settles: 2 crop widths/s² over the 0.1 s settle.
    [0.5, 0.1, 1, 6.4],
    [0.5, 0.1, 1.05, 1.6],
    [0.5, 0.1, 1.1, 0],
    [0.5, 0, 1, 0],
  ])(
    'lets the crop leave the held crop by its braking and settle: %s crop widths/s, %s s settle, at %s s',
    (speedIn, settleIn, time, allowance) => {
      const span = {
        start: 1,
        end: 3,
        crop: [100, 300, 640, 360] as [number, number, number, number],
        speedIn,
        speedOut: 0,
        settleIn,
        settleOut: 0,
      };
      expect(firmHoldAllowance(span, time, 0.12 * 360)).toBeCloseTo(allowance);
    }
  );

  it('ignores a hold flag the markup releases on load, also before a cut', () => {
    const flagged = [
      point(0, '100:300:640:360'),
      point(2.03, '600:300:640:360'),
      point(3.07, '620:300:640:360', { hold: true }),
      point(4.5, '1200:300:640:360', { easeIn: 'instant' }),
      point(6, '1300:300:640:360'),
    ];
    const plain = flagged.map((p) => ({ ...p, hold: undefined }));
    const [a, b] = [cinematicCropMap(flagged, 'firm'), plain].map(
      (map) => bakeCinematicPath(map, MARGINS, CROP_RES_W, CROP_RES_H, 30)!
    );
    for (let t = 0; t <= 6; t += 0.05) {
      expect(evalCropPathAtTime(a, t)).toEqual(evalCropPathAtTime(b, t));
    }
  });

  it('keeps a Firm hold up to a cut, and only on the crop point that holds', () => {
    const cropMap = cinematicCropMap(
      [
        point(0, '100:300:640:360'),
        point(2, '600:300:640:360'),
        point(3.5, '600:300:640:360', { hold: true }),
        point(4.5, '1200:300:640:360', { easeIn: 'instant' }),
        point(6, '900:300:640:360'),
      ],
      'firm'
    );
    const [first, second] = splitAtInstantCuts(cropMap, 30);
    expect(first.map((p) => p.firmHold ?? false)).toEqual([false, false, true, true]);
    expect(second.some((p) => p.firmHold)).toBe(false);
  });

  it('solves again when the Hold Points option changes', () => {
    const cropMap = panHoldPan(600);
    const signatures = (['loose', 'firm', 'exact'] as const).map((holds) =>
      cropPathSignature(cinematicCropMap(cropMap, holds), MARGINS, CROP_RES_W, CROP_RES_H)
    );
    expect(new Set(signatures).size).toBe(3);
  });
});

describe('render parity', () => {
  // Shared with the clipper's test_cinematic_path.py, whose solver must match these samples.
  const parityCases = JSON.parse(
    readFileSync(join(__dirname, '../../clipper/tests/fixtures/cinematic_path_parity.json'), 'utf8')
  ) as {
    name: string;
    cropMap: CropPoint[];
    margins: { pos: number; zoom: number };
    cropRes: [number, number];
    fps?: number;
    // How the case treats its hold points; the hold flags are read as they are without it.
    holds?: CinematicHolds;
    samples: { t: number; x: number; y: number; w: number; h: number }[];
  }[];

  it.each(parityCases.map((c) => [c.name, c] as const))(
    'matches the parity table: %s',
    (_name, c) => {
      const cropMap = cinematicCropMap(c.cropMap, c.holds ?? 'exact');
      const path = bakeCinematicPath(cropMap, c.margins, c.cropRes[0], c.cropRes[1], c.fps)!;
      for (const sample of c.samples) {
        const [x, y, w, h] = evalCropPathAtTime(path, sample.t);
        expect(x).toBeCloseTo(sample.x, 2);
        expect(y).toBeCloseTo(sample.y, 2);
        expect(w).toBeCloseTo(sample.w, 2);
        expect(h).toBeCloseTo(sample.h, 2);
      }
    }
  );

  // Shared with the clipper's cinematicMargins, so the preview and the render read the percent
  // settings, and their defaults, the same way.
  const marginCases = JSON.parse(
    readFileSync(
      join(__dirname, '../../clipper/tests/fixtures/cinematic_margin_percent.json'),
      'utf8'
    )
  ) as {
    name: string;
    settings: {
      cropPointEasingCinematicMargin?: number;
      cropPointEasingCinematicZoomMargin?: number;
    };
    pos: number;
    zoom: number;
  }[];

  it.each(marginCases.map((c) => [c.name, c] as const))(
    'converts percent margins like the clipper: %s',
    (_name, c) => {
      const { cropPointEasingCinematicMargin, cropPointEasingCinematicZoomMargin } = c.settings;
      expect(
        cinematicMarginsFromPercent(
          cropPointEasingCinematicMargin,
          cropPointEasingCinematicZoomMargin
        )
      ).toEqual({
        pos: c.pos,
        zoom: c.zoom,
      });
    }
  );
});
