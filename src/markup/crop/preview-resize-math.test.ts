import { computeARChange, computeARLockedResize, ResizeParams } from './preview-resize-math';

// ─── helpers ────────────────────────────────────────────────────────────────

const AR_16_9 = 16 / 9;
const AR_WIDE = 3; // wider than 16:9
const AR_TALL = 0.5; // taller than 16:9

/** Base state used by most tests. */
const BASE: Omit<ResizeParams, 'edges' | 'dx' | 'dy'> = {
  startX: 100,
  startY: 100,
  startW: 400,
  startH: 225, // 400 / (16/9) = 225
  minW: 160,
  minH: 90,
  ar: AR_16_9,
};

function edges(l = false, r = false, t = false, b = false) {
  return { left: l, right: r, top: t, bottom: b };
}

/** Assert AR is maintained within rounding tolerance.
 * Math.round is applied to both w and h independently, so the combined
 * rounding error in the ratio can reach ~2 / min(w, h). */
function expectAR(w: number, h: number, ar: number) {
  const tol = 2 / Math.min(w, h) + 0.001;
  expect(Math.abs(w / h - ar)).toBeLessThan(tol);
}

/** Compute the right/bottom edge positions (useful for anchor assertions). */
function right(r: { x: number; w: number }) {
  return r.x + r.w;
}
function bottom(r: { y: number; h: number }) {
  return r.y + r.h;
}

// ─── right handle ───────────────────────────────────────────────────────────

describe('right handle', () => {
  it('grows width and height proportionally', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: 100, dy: 0 });
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX); // left edge fixed
    expect(r.y).toBe(BASE.startY); // top edge fixed
  });

  it('shrinks width and height proportionally', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: -100, dy: 0 });
    expect(r.w).toBe(300);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });

  it('clamps to minW and maintains AR', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: -300, dy: 0 });
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('handles zero dx (no movement)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: 0, dy: 0 });
    expect(r.w).toBe(BASE.startW);
    expect(r.h).toBe(BASE.startH);
  });
});

// ─── left handle ────────────────────────────────────────────────────────────

describe('left handle', () => {
  it('grows width leftward (right edge fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false), dx: -100, dy: 0 });
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW); // right edge fixed
    expect(r.y).toBe(BASE.startY);
  });

  it('shrinks width rightward (right edge fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false), dx: 100, dy: 0 });
    expect(r.w).toBe(300);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
  });

  it('clamps to minW with right-edge anchor', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false), dx: 500, dy: 0 });
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
  });
});

// ─── bottom handle ──────────────────────────────────────────────────────────

describe('bottom handle', () => {
  it('grows height and width proportionally', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: 100 });
    expect(r.h).toBe(325);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX); // left edge fixed
    expect(r.y).toBe(BASE.startY); // top edge fixed
  });

  it('shrinks height and width proportionally', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: -100 });
    expect(r.h).toBe(125);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });

  it('clamps to minH and maintains AR', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: -300 });
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('top and left edges stay fixed', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: 80 });
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });
});

// ─── top handle ─────────────────────────────────────────────────────────────

describe('top handle', () => {
  it('grows height upward (bottom+right edges fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, true, false), dx: 0, dy: -100 });
    expect(r.h).toBe(325);
    expectAR(r.w, r.h, AR_16_9);
    expect(bottom(r)).toBe(BASE.startY + BASE.startH); // bottom fixed
    expect(right(r)).toBe(BASE.startX + BASE.startW);  // right fixed
  });

  it('shrinks height downward (bottom+right edges fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, true, false), dx: 0, dy: 100 });
    expect(r.h).toBe(125);
    expectAR(r.w, r.h, AR_16_9);
    expect(bottom(r)).toBe(BASE.startY + BASE.startH);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
  });

  it('clamps to minH with bottom+right anchor', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, true, false), dx: 0, dy: 300 });
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expectAR(r.w, r.h, AR_16_9);
    expect(bottom(r)).toBe(BASE.startY + BASE.startH);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
  });

  it('can grow past the top of the viewport (y may go negative)', () => {
    const nearTop = { ...BASE, startY: 10 };
    const r = computeARLockedResize({ ...nearTop, edges: edges(false, false, true, false), dx: 0, dy: -200 });
    expect(r.y).toBeLessThan(0);
    expectAR(r.w, r.h, AR_16_9);
  });
});

// ─── corners ────────────────────────────────────────────────────────────────

describe('bottom-right corner', () => {
  it('grows from bottom-right (top+left fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true, false, true), dx: 100, dy: 50 });
    // width-primary, uses dx
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });

  it('shrinks from bottom-right', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true, false, true), dx: -80, dy: -45 });
    expect(r.w).toBe(320);
    expectAR(r.w, r.h, AR_16_9);
  });
});

describe('bottom-left corner', () => {
  it('grows from bottom-left (right edge fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false, false, true), dx: -100, dy: 50 });
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
    expect(r.y).toBe(BASE.startY);
  });
});

describe('top-right corner', () => {
  it('grows from top-right (left+bottom fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true, true, false), dx: 100, dy: -50 });
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX);                     // left fixed
    expect(bottom(r)).toBe(BASE.startY + BASE.startH);  // bottom fixed
  });
});

describe('top-left corner', () => {
  it('grows from top-left (right+bottom fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false, true, false), dx: -100, dy: -50 });
    expect(r.w).toBe(500);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW);   // right fixed
    expect(bottom(r)).toBe(BASE.startY + BASE.startH);  // bottom fixed
  });

  it('shrinks from top-left (right+bottom fixed)', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false, true, false), dx: 100, dy: 50 });
    expect(r.w).toBe(300);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW);
    expect(bottom(r)).toBe(BASE.startY + BASE.startH);
  });
});

// ─── minimum size clamping propagation ──────────────────────────────────────

describe('min-size clamping', () => {
  it('right: minW clamps width and AR is maintained', () => {
    const r = computeARLockedResize({ ...BASE, startW: 170, startH: 96, edges: edges(false, true), dx: -20, dy: 0 });
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('bottom: minH clamps height and AR is maintained', () => {
    const r = computeARLockedResize({ ...BASE, startW: 180, startH: 100, edges: edges(false, false, false, true), dx: 0, dy: -20 });
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('at exactly min size, further shrinking is blocked', () => {
    const r = computeARLockedResize({ ...BASE, startW: 160, startH: 90, edges: edges(false, true), dx: -50, dy: 0 });
    expect(r.w).toBe(160);
    expect(r.h).toBe(90);
  });

  it('at exactly min size, growing still works', () => {
    const r = computeARLockedResize({ ...BASE, startW: 160, startH: 90, edges: edges(false, true), dx: 40, dy: 0 });
    expect(r.w).toBe(200);
    expectAR(r.w, r.h, AR_16_9);
  });
});

// ─── viewport max-size clamping ─────────────────────────────────────────────

describe('max-size clamping (viewport bounds)', () => {
  it('right: maxW blocks growth and AR is maintained', () => {
    // drag would grow to 600, but maxW=450 caps it
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: 200, dy: 0, maxW: 450 });
    expect(r.w).toBeLessThanOrEqual(450);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX); // left edge fixed
  });

  it('right: maxH caps the derived height and propagates back to width', () => {
    // drag grows width, but derived height would exceed maxH=270
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true), dx: 200, dy: 0, maxH: 270 });
    expect(r.h).toBeLessThanOrEqual(270);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('bottom: maxH blocks growth and AR is maintained', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: 200, maxH: 350 });
    expect(r.h).toBeLessThanOrEqual(350);
    expectAR(r.w, r.h, AR_16_9);
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });

  it('bottom: maxW caps the derived width and propagates back to height', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: 200, maxW: 500 });
    expect(r.w).toBeLessThanOrEqual(500);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('left: maxW (= startX+startW) blocks leftward growth and AR is maintained', () => {
    // left handle anchors right edge; maxW = startX+startW = 500 (can grow from x=100 all the way to x=0)
    const r = computeARLockedResize({ ...BASE, edges: edges(true, false), dx: -300, dy: 0, maxW: BASE.startX + BASE.startW });
    expect(r.w).toBeLessThanOrEqual(BASE.startX + BASE.startW);
    expectAR(r.w, r.h, AR_16_9);
    expect(right(r)).toBe(BASE.startX + BASE.startW); // right edge fixed
  });

  it('top: maxH (= startY+startH) blocks upward growth and AR is maintained', () => {
    // top handle anchors bottom edge; maxH = startY+startH = 325
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, true, false), dx: 0, dy: -300, maxH: BASE.startY + BASE.startH });
    expect(r.h).toBeLessThanOrEqual(BASE.startY + BASE.startH);
    expectAR(r.w, r.h, AR_16_9);
    expect(bottom(r)).toBe(BASE.startY + BASE.startH); // bottom edge fixed
  });

  it('at exactly max size, further growing is blocked', () => {
    const r = computeARLockedResize({ ...BASE, startW: 400, startH: 225, edges: edges(false, true), dx: 100, dy: 0, maxW: 400 });
    expect(r.w).toBe(400);
    expect(r.h).toBe(225);
  });

  it('at max size, shrinking still works', () => {
    const r = computeARLockedResize({ ...BASE, startW: 400, startH: 225, edges: edges(false, true), dx: -100, dy: 0, maxW: 400 });
    expect(r.w).toBe(300);
    expectAR(r.w, r.h, AR_16_9);
  });

  it('bottom-right corner: both maxW and maxH constrain correctly', () => {
    // width-primary, so maxW is the binding constraint
    const r = computeARLockedResize({ ...BASE, edges: edges(false, true, false, true), dx: 200, dy: 200, maxW: 500, maxH: 400 });
    expect(r.w).toBeLessThanOrEqual(500);
    expect(r.h).toBeLessThanOrEqual(400);
    expectAR(r.w, r.h, AR_16_9);
  });
});

// ─── non-standard aspect ratios ─────────────────────────────────────────────

describe('wide AR (3:1)', () => {
  const WIDE = { ...BASE, ar: AR_WIDE, startH: Math.round(BASE.startW / AR_WIDE) }; // 400x133

  it('right: maintains wide AR', () => {
    const r = computeARLockedResize({ ...WIDE, edges: edges(false, true), dx: 60, dy: 0 });
    expectAR(r.w, r.h, AR_WIDE);
  });

  it('bottom: maintains wide AR', () => {
    const r = computeARLockedResize({ ...WIDE, edges: edges(false, false, false, true), dx: 0, dy: 30 });
    expectAR(r.w, r.h, AR_WIDE);
  });

  it('top: bottom+right fixed, maintains wide AR', () => {
    const r = computeARLockedResize({ ...WIDE, edges: edges(false, false, true, false), dx: 0, dy: -30 });
    expectAR(r.w, r.h, AR_WIDE);
    expect(bottom(r)).toBe(WIDE.startY + WIDE.startH);
  });

  it('clamps to minW, derives height from AR', () => {
    const r = computeARLockedResize({ ...WIDE, startW: 170, startH: 57, edges: edges(false, true), dx: -20, dy: 0 });
    expect(r.w).toBeGreaterThanOrEqual(BASE.minW);
    expectAR(r.w, r.h, AR_WIDE);
  });
});

describe('tall AR (0.5:1)', () => {
  const TALL = { ...BASE, ar: AR_TALL, startW: Math.round(BASE.startH * AR_TALL) }; // 112x225

  it('bottom: maintains tall AR', () => {
    const r = computeARLockedResize({ ...TALL, edges: edges(false, false, false, true), dx: 0, dy: 50 });
    expectAR(r.w, r.h, AR_TALL);
  });

  it('right: maintains tall AR', () => {
    const r = computeARLockedResize({ ...TALL, edges: edges(false, true), dx: 20, dy: 0 });
    expectAR(r.w, r.h, AR_TALL);
  });

  it('clamps to minH, derives width from AR', () => {
    const r = computeARLockedResize({ ...TALL, startH: 100, startW: 50, edges: edges(false, false, false, true), dx: 0, dy: -20 });
    expect(r.h).toBeGreaterThanOrEqual(BASE.minH);
    expectAR(r.w, r.h, AR_TALL);
  });
});

// ─── anchor correctness at various positions ─────────────────────────────────

describe('anchor invariants', () => {
  it('right handle: fixed edges stay fixed regardless of starting position', () => {
    const r = computeARLockedResize({ ...BASE, startX: 50, startY: 200, edges: edges(false, true), dx: 120, dy: 0 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(200);
  });

  it('left handle: right edge stays fixed regardless of starting position', () => {
    const startX = 300, startW = 400;
    const r = computeARLockedResize({ ...BASE, startX, startW, edges: edges(true, false), dx: -80, dy: 0 });
    expect(right(r)).toBe(startX + startW);
  });

  it('top handle: bottom edge stays fixed after large upward drag', () => {
    const startY = 50;
    const r = computeARLockedResize({ ...BASE, startY, edges: edges(false, false, true, false), dx: 0, dy: -200 });
    expect(bottom(r)).toBe(startY + BASE.startH);
  });

  it('bottom handle: top and left edges stay fixed after large downward drag', () => {
    const r = computeARLockedResize({ ...BASE, edges: edges(false, false, false, true), dx: 0, dy: 300 });
    expect(r.x).toBe(BASE.startX);
    expect(r.y).toBe(BASE.startY);
  });
});

// ─── computeARChange ─────────────────────────────────────────────────────────

/** Base state for AR-change tests: 400×225 preview in a 1280×720 viewport */
const AC_BASE = { x: 100, y: 100, width: 400, height: 225, minWidth: 160, minHeight: 90, viewportW: 1280, viewportH: 720 };

describe('computeARChange — AR maintained', () => {
  it('switching to a wider AR keeps result within AR tolerance', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 3 });
    expectAR(r.width, r.height, 3);
  });

  it('switching to a taller AR keeps result within AR tolerance', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 0.5 });
    expectAR(r.width, r.height, 0.5);
  });

  it('same AR produces same dimensions', () => {
    const r = computeARChange({ ...AC_BASE, newAR: AR_16_9 });
    expect(r.width).toBe(AC_BASE.width);
    expect(r.height).toBe(AC_BASE.height);
  });
});

describe('computeARChange — top-left anchor', () => {
  it('top-left corner stays fixed when there is room', () => {
    // Preview at (100,100) in a 1280×720 viewport — plenty of space bottom-right
    const r = computeARChange({ ...AC_BASE, newAR: 3 });
    expect(r.x).toBe(AC_BASE.x);
    expect(r.y).toBe(AC_BASE.y);
  });

  it('top-left stays fixed when switching to a taller AR with room below', () => {
    // AR=1 (square): newH = 400/1 = 400; at y=100 → bottom = 500 < 720, fits without overflow
    const r = computeARChange({ ...AC_BASE, newAR: 1 });
    expect(r.x).toBe(AC_BASE.x);
    expect(r.y).toBe(AC_BASE.y);
  });
});

describe('computeARChange — fallback to bottom-right anchor on overflow', () => {
  it('x falls back to bottom-right anchor when minH expansion pushes width past the right edge', () => {
    // x=1100, width=100 → minH=90 bumps newW from 100 to 270 at AR=3 → 1100+270 overflows right
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };
    const r = computeARChange({ ...nearRight, newAR: 3 });
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
    expectAR(r.width, r.height, 3);
    // x should have moved left of original to accommodate the wider result
    expect(r.x).toBeLessThan(nearRight.x);
  });

  it('y falls back to bottom-right anchor when growing tall would overflow bottom edge', () => {
    // Width stays 200; newH = 200/0.5 = 400; at y=600 → bottom = 1000 > 720
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };
    const r = computeARChange({ ...nearBottom, newAR: 0.5 });
    expect(r.y + r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
    expectAR(r.width, r.height, 0.5);
    // y should have moved up from original to accommodate the taller result
    expect(r.y).toBeLessThan(nearBottom.y);
  });

  it('result never overflows viewport on either axis', () => {
    // Extreme case: very tall AR forces clamp, then position folds back
    const large = { ...AC_BASE, x: 0, y: 0, width: 1200, height: 675 };
    const r = computeARChange({ ...large, newAR: 4 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
    expect(r.y + r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
    expectAR(r.width, r.height, 4);
  });
});

describe('computeARChange — width-fixed, height tracks source AR change', () => {
  it('width is unchanged when switching to a taller (narrower) AR', () => {
    // Source bottom dragged down (AR narrows): keep width=400, newH = 400/0.75 ≈ 533 (grows)
    const r = computeARChange({ ...AC_BASE, newAR: 0.75 });
    expect(r.width).toBe(AC_BASE.width);
    expect(r.height).toBeGreaterThan(AC_BASE.height);
  });

  it('width is unchanged and height shrinks when switching to a wider AR', () => {
    // Source bottom dragged up (AR widens): keep width=400, newH = 400/3 ≈ 133 (shrinks)
    const r = computeARChange({ ...AC_BASE, newAR: 3 });
    expect(r.width).toBe(AC_BASE.width);
    expect(r.height).toBeLessThan(AC_BASE.height);
  });

  it('same AR leaves both dimensions unchanged', () => {
    const r = computeARChange({ ...AC_BASE, newAR: AR_16_9 });
    expect(r.width).toBe(AC_BASE.width);
    expect(r.height).toBe(AC_BASE.height);
  });

  it('width is always the fixed dimension regardless of AR direction', () => {
    // Going taller — width must not change
    const rTaller = computeARChange({ ...AC_BASE, newAR: 0.75 });
    expect(rTaller.width).toBe(AC_BASE.width);

    // Going wider — width must not change either
    const rWider = computeARChange({ ...AC_BASE, newAR: 3 });
    expect(rWider.width).toBe(AC_BASE.width);
  });

  it('height grows proportionally: newH ≈ width / newAR', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 1 });
    // width=400, newAR=1 → ideal newH=400; round → 400
    expect(r.width).toBe(400);
    expect(r.height).toBe(400);
  });

  it('height shrinks proportionally: newH ≈ width / newAR', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 4 });
    // width=400, newAR=4 → ideal newH=100 ≥ minH=90
    expect(r.width).toBe(400);
    expect(r.height).toBe(100);
  });
});

describe('computeARChange — height-fixed (lockDimension: height)', () => {
  it('height is unchanged when switching to a wider AR', () => {
    // Source right dragged right (AR widens): keep height=225, newW = 225*3 = 675 (grows)
    const r = computeARChange({ ...AC_BASE, newAR: 3, lockDimension: 'height' });
    expect(r.height).toBe(AC_BASE.height);
    expect(r.width).toBeGreaterThan(AC_BASE.width);
  });

  it('height is unchanged and width shrinks when switching to a taller AR', () => {
    // Source right dragged left (AR narrows): keep height=225, newW = 225*0.75 ≈ 169 (shrinks)
    const r = computeARChange({ ...AC_BASE, newAR: 0.75, lockDimension: 'height' });
    expect(r.height).toBe(AC_BASE.height);
    expect(r.width).toBeLessThan(AC_BASE.width);
  });

  it('same AR leaves both dimensions unchanged with height lock', () => {
    const r = computeARChange({ ...AC_BASE, newAR: AR_16_9, lockDimension: 'height' });
    expect(r.width).toBe(AC_BASE.width);
    expect(r.height).toBe(AC_BASE.height);
  });

  it('height is always the fixed dimension regardless of AR direction', () => {
    // Going wider — height must not change
    const rWider = computeARChange({ ...AC_BASE, newAR: 3, lockDimension: 'height' });
    expect(rWider.height).toBe(AC_BASE.height);

    // Going taller — height must not change either
    const rTaller = computeARChange({ ...AC_BASE, newAR: 0.75, lockDimension: 'height' });
    expect(rTaller.height).toBe(AC_BASE.height);
  });

  it('width grows proportionally: newW ≈ height * newAR', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 2, lockDimension: 'height' });
    // height=225, newAR=2 → ideal newW=450
    expect(r.height).toBe(225);
    expect(r.width).toBe(450);
  });

  it('width shrinks proportionally: newW ≈ height * newAR', () => {
    // Use a case where minWidth doesn't interfere
    // height=90, newAR=0.5 → ideal newW=45 → round → 45, but minWidth=160 kicks in
    // So use a larger starting height where derived width >= minWidth
    const r = computeARChange({ ...AC_BASE, height: 320, newAR: 0.5, lockDimension: 'height' });
    // height=320, newAR=0.5 → ideal newW=160 → round → 160 (exactly minWidth)
    expect(r.height).toBe(320);
    expect(r.width).toBe(160);
  });

  it('AR is maintained when locking height', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 2.5, lockDimension: 'height' });
    expectAR(r.width, r.height, 2.5);
  });

  it('clamps to minWidth while maintaining AR when locking height', () => {
    // Very tall AR would make width tiny, but minWidth prevents it
    const r = computeARChange({ ...AC_BASE, newAR: 0.1, lockDimension: 'height' });
    expect(r.width).toBeGreaterThanOrEqual(AC_BASE.minWidth);
    expectAR(r.width, r.height, 0.1);
  });

  it('clamps to viewport width while maintaining AR when locking height', () => {
    // Wide AR + locked height could overflow viewport
    const r = computeARChange({ ...AC_BASE, x: 1000, newAR: 10, lockDimension: 'height' });
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
    expectAR(r.width, r.height, 10);
  });
});

describe('computeARChange — viewport and minimum constraints', () => {
  it('result is clamped to viewport when new AR is very wide', () => {
    const r = computeARChange({ ...AC_BASE, x: 0, y: 0, width: 1280, height: 720, newAR: 10 });
    expect(r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
    expect(r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
    expectAR(r.width, r.height, 10);
  });

  it('result respects minWidth when new AR produces a very narrow width', () => {
    // tiny preview switching to very tall AR — width must not go below minWidth
    const r = computeARChange({ ...AC_BASE, width: 200, height: 113, newAR: 0.1 });
    expect(r.width).toBeGreaterThanOrEqual(AC_BASE.minWidth);
  });

  it('result respects minHeight when new AR produces a very short height', () => {
    const r = computeARChange({ ...AC_BASE, width: 200, height: 113, newAR: 10 });
    expect(r.height).toBeGreaterThanOrEqual(AC_BASE.minHeight);
  });
});

describe('computeARChange — anchor preference tracking', () => {
  it('returns anchorX: left and anchorY: top by default when no overflow', () => {
    const r = computeARChange({ ...AC_BASE, newAR: 2 });
    expect(r.anchorX).toBe('left');
    expect(r.anchorY).toBe('top');
    expect(r.x).toBe(AC_BASE.x);
    expect(r.y).toBe(AC_BASE.y);
  });

  it('returns anchorX: right when overflow forces right anchor', () => {
    // Position near right edge, growing wider will overflow
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };
    const r = computeARChange({ ...nearRight, newAR: 3 });
    expect(r.anchorX).toBe('right');
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
  });

  it('returns anchorY: bottom when overflow forces bottom anchor', () => {
    // Position near bottom edge, growing taller will overflow
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };
    const r = computeARChange({ ...nearBottom, newAR: 0.5 });
    expect(r.anchorY).toBe('bottom');
    expect(r.y + r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
  });

  it('respects anchorX: right preference and keeps right edge fixed when overflow exists', () => {
    // Position near right edge where overflow would occur
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };
    // Start with right anchor preference - right edge should stay fixed
    const r = computeARChange({ ...nearRight, newAR: 3, anchorX: 'right' });
    expect(r.anchorX).toBe('right');
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
  });

  it('respects anchorY: bottom preference and keeps bottom edge fixed when overflow exists', () => {
    // Position near bottom edge where overflow would occur
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };
    // Start with bottom anchor preference - bottom edge should stay fixed
    const r = computeARChange({ ...nearBottom, newAR: 0.5, anchorY: 'bottom' });
    expect(r.anchorY).toBe('bottom');
    expect(r.y + r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
  });

  it('shrinking with right anchor keeps right edge fixed when overflow exists', () => {
    // Position near right edge where overflow would occur
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };
    const startModX = nearRight.x; // Track starting position

    // First grow to trigger overflow
    const r1 = computeARChange({ ...nearRight, newAR: 3, startModX });
    expect(r1.anchorX).toBe('right');
    const rightEdge = r1.x + r1.width;

    // Now shrink back toward original AR - still overflowing, right edge stays fixed
    // Pass startModX so anchor only switches back when user has undone the overflow
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 2,
      anchorX: 'right',
      startModX,
    });
    expect(r2.anchorX).toBe('right');
    expect(r2.x + r2.width).toBe(rightEdge); // right edge still fixed
  });

  it('shrinking with bottom anchor keeps bottom edge fixed when overflow exists', () => {
    // Position near bottom edge where overflow would occur
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };
    const startModY = nearBottom.y; // Track starting position

    // First grow to trigger overflow
    const r1 = computeARChange({ ...nearBottom, newAR: 0.5, startModY });
    expect(r1.anchorY).toBe('bottom');
    const bottomEdge = r1.y + r1.height;

    // Now shrink back toward original AR - still overflowing, bottom edge stays fixed
    // Pass startModY so anchor only switches back when user has undone the overflow
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 0.7,
      anchorY: 'bottom',
      startModY,
    });
    expect(r2.anchorY).toBe('bottom');
    expect(r2.y + r2.height).toBe(bottomEdge); // bottom edge still fixed
  });

  it('growing then shrinking with right anchor maintains consistent position when overflow exists', () => {
    // Position near right edge where overflow would occur
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };
    const rightAnchor: 'right' = 'right';
    const startModX = nearRight.x; // Track starting position

    // Start at original size
    let x = nearRight.x;
    let y = nearRight.y;
    let width = nearRight.width;
    let height = nearRight.height;

    // Grow wider (AR increases) - triggers overflow
    let r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 3, anchorX: rightAnchor, startModX });
    expect(r.anchorX).toBe('right');
    x = r.x; y = r.y; width = r.width; height = r.height;
    const rightEdge = x + width;

    // Grow even wider - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 4, anchorX: rightAnchor, startModX });
    expect(r.anchorX).toBe('right');
    x = r.x; y = r.y; width = r.width; height = r.height;
    expect(x + width).toBe(rightEdge); // right edge still fixed

    // Shrink back - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 3, anchorX: rightAnchor, startModX });
    expect(r.anchorX).toBe('right');
    x = r.x; y = r.y; width = r.width; height = r.height;
    expect(x + width).toBe(rightEdge); // right edge still fixed

    // Shrink to original - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 16/9, anchorX: rightAnchor, startModX });
    expect(r.anchorX).toBe('right');
    expect(r.x + r.width).toBe(rightEdge); // right edge still fixed
  });

  it('growing then shrinking with bottom anchor maintains consistent position when overflow exists', () => {
    // Position near bottom edge where overflow would occur
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };
    const bottomAnchor: 'bottom' = 'bottom';
    const startModY = nearBottom.y; // Track starting position

    // Start at original size
    let x = nearBottom.x;
    let y = nearBottom.y;
    let width = nearBottom.width;
    let height = nearBottom.height;

    // Grow taller (AR decreases) - triggers overflow
    let r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 0.5, anchorY: bottomAnchor, startModY });
    expect(r.anchorY).toBe('bottom');
    x = r.x; y = r.y; width = r.width; height = r.height;
    const bottomEdge = y + height;

    // Grow even taller - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 0.3, anchorY: bottomAnchor, startModY });
    expect(r.anchorY).toBe('bottom');
    x = r.x; y = r.y; width = r.width; height = r.height;
    expect(y + height).toBe(bottomEdge); // bottom edge still fixed

    // Shrink back - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 0.5, anchorY: bottomAnchor, startModY });
    expect(r.anchorY).toBe('bottom');
    x = r.x; y = r.y; width = r.width; height = r.height;
    expect(y + height).toBe(bottomEdge); // bottom edge still fixed

    // Shrink to original - still overflowing
    r = computeARChange({ ...AC_BASE, x, y, width, height, newAR: 16/9, anchorY: bottomAnchor, startModY });
    expect(r.anchorY).toBe('bottom');
    expect(r.y + r.height).toBe(bottomEdge); // bottom edge still fixed
  });

  it('combined right and bottom anchors work together when overflow exists', () => {
    // Position near bottom-right corner where overflow would occur on both axes
    // Need to use a position and AR that will actually overflow
    const nearCorner = { ...AC_BASE, x: 1150, y: 650, width: 100, height: 100 };
    const startModX = nearCorner.x; // Track starting position
    const startModY = nearCorner.y; // Track starting position
    // Use AR=0.5 which gives newH=200 (overflows bottom) and newW=100 (overflows right at x=1150)
    const r = computeARChange({
      ...nearCorner,
      newAR: 0.5,
      anchorX: 'right',
      anchorY: 'bottom',
      startModX,
      startModY,
    });
    expect(r.anchorX).toBe('right');
    expect(r.anchorY).toBe('bottom');
    expect(r.x + r.width).toBeLessThanOrEqual(AC_BASE.viewportW);
    expect(r.y + r.height).toBeLessThanOrEqual(AC_BASE.viewportH);
  });
});

describe('computeARChange — anchor switches back to default when overflow resolved', () => {
  it('right anchor stays sticky during modification session', () => {
    // Start near right edge where overflow would occur
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };

    // First, grow to trigger overflow and get right anchor
    const r1 = computeARChange({ ...nearRight, newAR: 3 });
    expect(r1.anchorX).toBe('right'); // overflow forced right anchor

    // Now shrink back to a smaller AR - anchor stays at right
    // because we're still in the same modification session
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 1,
      anchorX: 'right', // pass the current anchor preference
    });
    // Anchor stays at right - only resets when Ctrl is released (via resetAnchor)
    expect(r2.anchorX).toBe('right');
  });

  it('bottom anchor stays sticky during modification session', () => {
    // Start near bottom edge where overflow would occur
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };

    // First, grow taller to trigger overflow and get bottom anchor
    const r1 = computeARChange({ ...nearBottom, newAR: 0.5 });
    expect(r1.anchorY).toBe('bottom'); // overflow forced bottom anchor

    // Now shrink back to a wider AR - anchor stays at bottom
    // because we're still in the same modification session
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 2, // wider AR means shorter height
      anchorY: 'bottom', // pass the current anchor preference
    });
    // Anchor stays at bottom - only resets when Ctrl is released (via resetAnchor)
    expect(r2.anchorY).toBe('bottom');
  });

  it('stays with right anchor if overflow is not yet resolved', () => {
    // Start near right edge where overflow would occur
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };

    // First, grow to trigger overflow and get right anchor
    const r1 = computeARChange({ ...nearRight, newAR: 3 });
    expect(r1.anchorX).toBe('right');

    // Try to grow even more - should still overflow and keep right anchor
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 4, // even wider
      anchorX: 'right',
    });
    // Still overflows, should keep right anchor
    expect(r2.anchorX).toBe('right');
  });

  it('stays with bottom anchor if overflow is not yet resolved', () => {
    // Start near bottom edge where overflow would occur
    const nearBottom = { ...AC_BASE, x: 100, y: 600, width: 200, height: 113 };

    // First, grow taller to trigger overflow and get bottom anchor
    const r1 = computeARChange({ ...nearBottom, newAR: 0.5 });
    expect(r1.anchorY).toBe('bottom');

    // Try to grow even taller - should still overflow and keep bottom anchor
    const r2 = computeARChange({
      ...AC_BASE,
      x: r1.x,
      y: r1.y,
      width: r1.width,
      height: r1.height,
      newAR: 0.3, // even taller
      anchorY: 'bottom',
    });
    // Still overflows, should keep bottom anchor
    expect(r2.anchorY).toBe('bottom');
  });

  it('anchor stays sticky during modification session - only resets when Ctrl released', () => {
    // New behavior: Once the anchor switches to right/bottom due to overflow,
    // it stays that way for the entire modification session.
    // The anchor only resets to left/top when the user releases Ctrl (via resetAnchor).

    // Use a position that will actually overflow when growing
    const nearRight = { ...AC_BASE, x: 1100, y: 100, width: 100, height: 100 };

    // Step 1: Grow to trigger overflow (AR=3 gives newW=100, newH=33, but minH=90 forces newH=90, newW=270)
    // At x=1100, width=270 → right edge at 1370 > 1280, so overflow
    const r1 = computeARChange({ ...nearRight, newAR: 3 });
    expect(r1.anchorX).toBe('right'); // overflow, switched to right

    // Step 2: Grow more - anchor stays at right
    const r2 = computeARChange({
      ...AC_BASE, x: r1.x, y: r1.y, width: r1.width, height: r1.height,
      newAR: 4, anchorX: 'right',
    });
    expect(r2.anchorX).toBe('right'); // anchor stays sticky

    // Step 3: Shrink a bit - anchor still stays at right
    const r3 = computeARChange({
      ...AC_BASE, x: r2.x, y: r2.y, width: r2.width, height: r2.height,
      newAR: 3, anchorX: 'right',
    });
    expect(r3.anchorX).toBe('right'); // anchor still sticky

    // Step 4: Shrink enough that it would fit with left anchor
    // But anchor stays at right because we're still in the same modification session
    const r4 = computeARChange({
      ...AC_BASE, x: r3.x, y: r3.y, width: r3.width, height: r3.height,
      newAR: 1, anchorX: 'right',
    });
    // Anchor stays at right - it only resets when Ctrl is released (via resetAnchor)
    expect(r4.anchorX).toBe('right');
  });

  it('bottom anchor stays sticky during modification session', () => {
    // Same scenario but for Y axis - anchor stays sticky

    const nearBottom = { ...AC_BASE, x: 100, y: 500, width: 200, height: 113 };

    // Step 1: Grow taller to trigger overflow
    const r1 = computeARChange({ ...nearBottom, newAR: 0.6 });
    expect(r1.anchorY).toBe('bottom'); // overflow, switched to bottom

    // Step 2: Grow more - anchor stays at bottom
    const r2 = computeARChange({
      ...AC_BASE, x: r1.x, y: r1.y, width: r1.width, height: r1.height,
      newAR: 0.4, anchorY: 'bottom',
    });
    expect(r2.anchorY).toBe('bottom'); // anchor stays sticky

    // Step 3: Shrink - anchor still stays at bottom
    const r3 = computeARChange({
      ...AC_BASE, x: r2.x, y: r2.y, width: r2.width, height: r2.height,
      newAR: 1.5, anchorY: 'bottom',
    });
    // Anchor stays at bottom - only resets when Ctrl is released (via resetAnchor)
    expect(r3.anchorY).toBe('bottom');
  });
});
