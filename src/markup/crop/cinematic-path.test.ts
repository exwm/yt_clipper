import { readFileSync } from 'fs';
import { join } from 'path';
import { CropPoint } from '../@types/yt_clipper';
import {
  bakeCinematicPath,
  buildBandedM,
  cinematicMarginsFromPercent,
  DEFAULT_CINEMATIC_MARGIN,
  cropPathSignature,
  evalCropPathAtTime,
  factorBanded,
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

describe('render parity', () => {
  // Shared with the clipper's test_cinematic_path.py, whose solver must match these samples.
  const parityCases = JSON.parse(
    readFileSync(join(__dirname, '../../clipper/tests/fixtures/cinematic_path_parity.json'), 'utf8')
  ) as {
    name: string;
    cropMap: CropPoint[];
    margins: { pos: number; zoom: number };
    cropRes: [number, number];
    samples: { t: number; x: number; y: number; w: number; h: number }[];
  }[];

  it.each(parityCases.map((c) => [c.name, c] as const))(
    'matches the parity table: %s',
    (_name, c) => {
      const path = bakeCinematicPath(c.cropMap, c.margins, c.cropRes[0], c.cropRes[1])!;
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
