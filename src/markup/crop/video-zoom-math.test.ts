import {
  clampViewport,
  cropToTargetRect,
  isZoomedViewport,
  lockPanAxis,
  minimapRect,
  reframeFillScale,
  rotateFocalPoint,
  transformedVideoBox,
  unrotateFocalPoint,
  videoBoxToCanvasPoint,
  viewportToPixels,
  ZoomViewport,
} from './video-zoom-math';

const vp = (scale: number, panX = 0.5, panY = 0.5): ZoomViewport => ({ scale, panX, panY });

describe('clampViewport', () => {
  it('forces fit (centre) at scale 1', () => {
    expect(clampViewport(vp(1, 0.2, 0.9))).toEqual({ scale: 1, panX: 0.5, panY: 0.5 });
  });

  it('clamps scale to [1, max]', () => {
    expect(clampViewport(vp(0.3)).scale).toBe(1);
    expect(clampViewport(vp(99), 8).scale).toBe(8);
  });

  it.each([
    [2, 0.25, 0.75],
    [4, 0.125, 0.875],
    [8, 0.0625, 0.9375],
  ])(
    'keeps the viewport inside the frame at scale %p (pan in [%p,%p])',
    (s: number, lo: number, hi: number) => {
      expect(clampViewport(vp(s, -1, 2)).panX).toBeCloseTo(lo, 6);
      expect(clampViewport(vp(s, 2, -1)).panY).toBeCloseTo(lo, 6);
      expect(clampViewport(vp(s, 5, 5)).panX).toBeCloseTo(hi, 6);
    }
  );

  it('falls back to the low bound on non-finite input', () => {
    expect(clampViewport(vp(NaN)).scale).toBe(1);
    expect(clampViewport({ scale: 2, panX: NaN, panY: 0.5 }).panX).toBeCloseTo(0.25, 6);
  });
});

describe('viewportToPixels', () => {
  it('is {0,0} at fit', () => {
    expect(viewportToPixels(vp(1), 100, 100)).toEqual({ x: 0, y: 0 });
  });

  it('needs no translate when panned to centre (scale is about centre)', () => {
    expect(viewportToPixels(vp(2), 100, 100)).toEqual({ x: 0, y: 0 });
  });

  it('shifts the video to reveal a corner focal point', () => {
    // focal at top-left-most valid point for scale 2 is 0.25 -> move video down-right
    expect(viewportToPixels(vp(2, 0.25, 0.25), 100, 100)).toEqual({ x: 50, y: 50 });
  });
});

describe('minimapRect', () => {
  it('covers the whole minimap at fit', () => {
    expect(minimapRect(vp(1), 180, 100)).toEqual({ left: 0, top: 0, w: 180, h: 100 });
  });

  it('is a centred half-size rect at scale 2', () => {
    expect(minimapRect(vp(2), 180, 100)).toEqual({ left: 45, top: 25, w: 90, h: 50 });
  });
});

describe('isZoomedViewport', () => {
  it.each([
    [1, false],
    [1.00005, false],
    [1.2, true],
  ])('scale %p -> %p', (s: number, expected: boolean) => {
    expect(isZoomedViewport(vp(s))).toBe(expected);
  });
});

describe('rotateFocalPoint', () => {
  it('passes through unrotated', () => {
    expect(rotateFocalPoint(0.2, 0.7, 0)).toEqual({ x: 0.2, y: 0.7 });
  });

  it.each([
    // a source top-left region (0.2,0.2) lands where after rotation?
    ['90 (CW) sends source top-left to displayed top-right', 90, 0.2, 0.2, 0.8, 0.2],
    ['-90 (CCW) sends source top-left to displayed bottom-left', -90, 0.2, 0.2, 0.2, 0.8],
  ])('%s', (_label: string, rot: number, cx: number, cy: number, x: number, y: number) => {
    expect(rotateFocalPoint(cx, cy, rot)).toEqual({ x, y });
  });

  it('centre is invariant under any rotation', () => {
    expect(rotateFocalPoint(0.5, 0.5, 90)).toEqual({ x: 0.5, y: 0.5 });
    expect(rotateFocalPoint(0.5, 0.5, -90)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('reframeFillScale', () => {
  it('unrotated into the box is min(1/w, 1/h), independent of box size', () => {
    expect(reframeFillScale(0.5, 0.25, 1000, 500, 1000, 500, false)).toBeCloseTo(2, 6); // min(2,4)
    expect(reframeFillScale(0.5, 0.25, 800, 450, 800, 450, false)).toBeCloseTo(2, 6);
  });

  it('rotated fits the crop into the target by the limiting dimension', () => {
    // box 1047x589 (16:9), container 1529x1049; tall narrow source crop -> wide rotated output
    const s = reframeFillScale(0.3, 0.9, 1047, 589, 1529, 1049, true);
    expect(s).toBeCloseTo(Math.min(1529 / (0.9 * 589), 1049 / (0.3 * 1047)), 6);
  });

  it('rotated into the container exceeds the rotated fit into the shorter box', () => {
    const intoContainer = reframeFillScale(0.3, 0.9, 1047, 589, 1529, 1049, true);
    const intoBox = reframeFillScale(0.3, 0.9, 1047, 589, 1047, 589, true);
    expect(intoContainer).toBeGreaterThan(intoBox);
  });
});

describe('lockPanAxis', () => {
  it.each([
    ['no lock passes through', false, false, { dx: 7, dy: -3 }],
    ['shift locks X (vertical-only)', true, false, { dx: 0, dy: -3 }],
    ['alt locks Y (horizontal-only)', false, true, { dx: 7, dy: 0 }],
    ['both lock all (cancel)', true, true, { dx: 0, dy: 0 }],
  ])('%s', (_label: string, shift: boolean, alt: boolean, expected: { dx: number; dy: number }) => {
    expect(lockPanAxis(7, -3, { shift, alt })).toEqual(expected);
  });
});

describe('cropToTargetRect', () => {
  it('scales crop fractions into the target box', () => {
    // crop (100,50,400,300) in a 800x600 cropRes -> half size at quarter offset, into a 1000x500 box
    expect(cropToTargetRect([100, 50, 400, 300], 800, 600, 1000, 500)).toEqual({
      x: 125,
      y: 41.666666666666664,
      w: 500,
      h: 250,
    });
  });

  it('a full-frame crop fills the target exactly', () => {
    expect(cropToTargetRect([0, 0, 800, 600], 800, 600, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    });
  });
});

describe('transformedVideoBox', () => {
  const t = { rotated: false, scale: 1, fsScale: 1, boxW: 1000, boxH: 500, tx: 0, ty: 0 };

  it('at fit, the box is the plain video box at its offset', () => {
    expect(transformedVideoBox(t, 200, 100)).toEqual({
      left: 200,
      top: 100,
      width: 1000,
      height: 500,
    });
  });

  it('zoom scales about the centre', () => {
    // 2x zoom grows the box around centre (200+500, 100+250) = (700,350): left = 700 - 2000/2
    expect(transformedVideoBox({ ...t, scale: 2 }, 200, 100)).toEqual({
      left: -300,
      top: -150,
      width: 2000,
      height: 1000,
    });
  });

  it('rotation swaps the displayed dimensions', () => {
    const b = transformedVideoBox({ ...t, rotated: true }, 200, 100);
    expect(b.width).toBe(500); // swapped boxH
    expect(b.height).toBe(1000); // swapped boxW
  });

  it('the pan translate offsets the box centre', () => {
    expect(transformedVideoBox({ ...t, tx: 30, ty: -10 }, 0, 0)).toMatchObject({
      left: 30,
      top: -10,
    });
  });
});

describe('videoBoxToCanvasPoint', () => {
  const base = {
    rotated: false,
    scale: 1,
    fsScale: 1,
    boxW: 1000,
    boxH: 500,
    tx: 0,
    ty: 0,
    boxCenterX: 500,
    boxCenterY: 250,
  };

  it('is identity at rotation 0 / fit (box centre maps to its centre)', () => {
    expect(videoBoxToCanvasPoint(250, 125, { ...base, rotation: 0 })).toEqual([250, 125]);
    expect(videoBoxToCanvasPoint(500, 250, { ...base, rotation: 0 })).toEqual([500, 250]);
  });

  it('rotates 90° about the box centre', () => {
    // box top-left (0,0) under +90° about centre (500,250) -> (750, -250)
    const [x, y] = videoBoxToCanvasPoint(0, 0, { ...base, rotation: 90 });
    expect(x).toBeCloseTo(750, 6);
    expect(y).toBeCloseTo(-250, 6);
  });

  it('applies zoom and pan after rotation', () => {
    const [x, y] = videoBoxToCanvasPoint(0, 0, { ...base, rotation: 0, scale: 2, tx: 10, ty: 20 });
    expect(x).toBeCloseTo(500 + 10 + -500 * 2, 6); // centerX + tx + (px-boxW/2)*scale
    expect(y).toBeCloseTo(250 + 20 + -250 * 2, 6);
  });
});

describe('unrotateFocalPoint', () => {
  it('passes through unrotated', () => {
    expect(unrotateFocalPoint(0.2, 0.7, 0)).toEqual({ x: 0.2, y: 0.7 });
  });

  it.each([0, 90, -90])('round-trips rotateFocalPoint at %p°', (rot: number) => {
    const f = rotateFocalPoint(0.3, 0.8, rot);
    const back = unrotateFocalPoint(f.x, f.y, rot);
    expect(back.x).toBeCloseTo(0.3, 9);
    expect(back.y).toBeCloseTo(0.8, 9);
  });
});
