/**
 * Pure, DOM-free math for the reframe viewport.
 *
 * The viewport is a normalized focal point: `panX`/`panY` (each in [0,1]) are the
 * fraction of the *fitted* (1x) displayed frame that sits at the centre of the
 * visible player area, and `scale` (>=1) is the magnification. Normalized
 * coordinates make the zoom resolution-independent, so the same region stays
 * magnified across theater/cap/resize/rotation re-fits.
 *
 * The viewport lives in displayed (post-rotation) space; `rotateFocalPoint` is
 * the one rotation-aware helper that maps a source-frame focal point into it, so
 * callers rotate source inputs before handing them to the rest of this module.
 */

export interface ZoomViewport {
  /** Magnification, >= 1 (1 = fit, no zoom). */
  scale: number;
  /** Focal point X as a fraction [0,1] of the fitted frame, at viewport centre. */
  panX: number;
  /** Focal point Y as a fraction [0,1] of the fitted frame, at viewport centre. */
  panY: number;
}

export const FIT: ZoomViewport = { scale: 1, panX: 0.5, panY: 0.5 };
export const MAX_SCALE = 8;

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** True once magnified beyond a tiny epsilon (so float drift near 1x reads as fit). */
export function isZoomedViewport(v: ZoomViewport): boolean {
  return v.scale > 1.0001;
}

/**
 * Clamp scale to [1, maxScale] and the focal point so the magnified frame always
 * fully covers the viewport (no panning past the edges). At scale 1 the only
 * valid focal point is the centre, so pan collapses to (0.5, 0.5) — the fit snap.
 */
export function clampViewport(v: ZoomViewport, maxScale = MAX_SCALE): ZoomViewport {
  const scale = clamp(v.scale, 1, Math.max(1, maxScale));
  const half = 0.5 / scale;
  return {
    scale,
    panX: clamp(v.panX, half, 1 - half),
    panY: clamp(v.panY, half, 1 - half),
  };
}

/**
 * Screen-space translate (px) for the outer `translate(x,y) scale(scale) …`
 * transform, which uses **transform-origin: center** (so it composes with the
 * preview rotation, which also rotates about the centre). Places the focal point
 * at the viewport centre. `displayedW/H` are the on-screen (post-rotation) fitted
 * frame dimensions. At fit / centred-pan this is {0,0}.
 */
export function viewportToPixels(
  v: ZoomViewport,
  displayedW: number,
  displayedH: number
): { x: number; y: number } {
  return {
    x: (0.5 - v.panX) * displayedW * v.scale,
    y: (0.5 - v.panY) * displayedH * v.scale,
  };
}

/**
 * Map a focal point from source fractions to the displayed (post-rotation) frame, so a pan meant to
 * centre on a source region still centres once rotated. `rotation` is the CSS preview rotation in
 * degrees (90 clockwise, -90 counter-clockwise, 0 passes through); rotate(90deg) sends the source
 * top-left to the displayed top-right, hence the axis swap.
 */
export function rotateFocalPoint(
  xFrac: number,
  yFrac: number,
  rotation: number
): { x: number; y: number } {
  if (rotation === 90) return { x: 1 - yFrac, y: xFrac };
  if (rotation === -90) return { x: yFrac, y: 1 - xFrac };
  return { x: xFrac, y: yFrac };
}

/** Inverse of rotateFocalPoint: map a displayed (post-rotation) focal point back to source fractions.
 *  The minimap drag works in displayed space, so it recovers the source focal point through this. */
export function unrotateFocalPoint(
  xFrac: number,
  yFrac: number,
  rotation: number
): { x: number; y: number } {
  if (rotation === 90) return { x: yFrac, y: 1 - xFrac };
  if (rotation === -90) return { x: 1 - yFrac, y: xFrac };
  return { x: xFrac, y: yFrac };
}

/**
 * Reframe magnification: the contain-fit scale that fits a crop into a target rect. `wFrac`/`hFrac`
 * are the crop size as source-frame fractions; `boxW`/`boxH` are the fitted video box (including
 * any fullscreen-fit scale); `targetW`/`targetH` are the area to fill (the box unrotated, the whole
 * container rotated, since a rotated crop spills past the landscape box). Rotated ±90° the crop's
 * displayed width/height swap; unrotated into the box this is the plain min(1/w, 1/h).
 */
export function reframeFillScale(
  wFrac: number,
  hFrac: number,
  boxW: number,
  boxH: number,
  targetW: number,
  targetH: number,
  rotated: boolean
): number {
  const w = Math.max(wFrac, 1e-4);
  const h = Math.max(hFrac, 1e-4);
  const dispW = rotated ? h * boxH : w * boxW; // the crop's screen size at viewport scale 1
  const dispH = rotated ? w * boxW : h * boxH;
  return Math.min(targetW / Math.max(dispW, 1e-6), targetH / Math.max(dispH, 1e-6));
}

/**
 * Apply the crop-pan axis locks to a drag delta, shared by the video pan and the
 * minimap. Shift locks the X axis (vertical-only pan), Alt locks the Y axis
 * (horizontal-only pan) — independently, so holding both locks both axes. With
 * the init+delta pan model that zeroes the whole delta, which snaps back to the
 * drag start, letting the user cancel a pan by engaging both then releasing.
 */
export function lockPanAxis(
  dx: number,
  dy: number,
  mods: { shift: boolean; alt: boolean }
): { dx: number; dy: number } {
  return { dx: mods.shift ? 0 : dx, dy: mods.alt ? 0 : dy };
}

/** The visible viewport rectangle drawn on a minimap of size `mmW`x`mmH`. */
export function minimapRect(
  v: ZoomViewport,
  mmW: number,
  mmH: number
): { left: number; top: number; w: number; h: number } {
  const w = mmW / v.scale;
  const h = mmH / v.scale;
  return { left: v.panX * mmW - w / 2, top: v.panY * mmH - h / 2, w, h };
}

/** Scale a crop rect (cropRes coords) into a target box. Maps the crop to display pixels (the
 *  reframe canvas, target = video box) or to source pixels (the minimap marker, target = frame). */
export function cropToTargetRect(
  crop: [number, number, number, number],
  cropResW: number,
  cropResH: number,
  targetW: number,
  targetH: number
): { x: number; y: number; w: number; h: number } {
  const [cx, cy, cw, ch] = crop;
  return {
    x: (cx / cropResW) * targetW,
    y: (cy / cropResH) * targetH,
    w: (cw / cropResW) * targetW,
    h: (ch / cropResH) * targetH,
  };
}

export interface VideoBoxTransform {
  rotated: boolean;
  /** Zoom magnification (>= 1). */
  scale: number;
  /** Fullscreen-rotated fit scale. */
  fsScale: number;
  /** Fitted (pre-transform) video box. */
  boxW: number;
  boxH: number;
  /** Screen-space pan translate (px). */
  tx: number;
  ty: number;
}

/** On-screen bounding box of the transformed video, in offset-parent (container) coords. Pure form
 *  of getTransformedVideoBox: rotation swaps the displayed dims, zoom + fullscreen-fit scale apply
 *  uniformly, the translate offsets the centre. Used instead of getBoundingClientRect, which the
 *  browser snaps to device pixels (overlay shimmer). */
export function transformedVideoBox(
  t: VideoBoxTransform,
  offsetLeft: number,
  offsetTop: number
): { left: number; top: number; width: number; height: number } {
  const width = (t.rotated ? t.boxH : t.boxW) * t.scale * t.fsScale;
  const height = (t.rotated ? t.boxW : t.boxH) * t.scale * t.fsScale;
  const centerX = offsetLeft + t.boxW / 2 + t.tx;
  const centerY = offsetTop + t.boxH / 2 + t.ty;
  return { left: centerX - width / 2, top: centerY - height / 2, width, height };
}

/** Map a point in the video's local box (CSS px, pre-transform) to canvas CSS px through the same
 *  rotate+zoom transform the reframe canvas draws content with, so the crop border/crosshair line up
 *  with the clipped video. transform-origin is the box centre. */
export function videoBoxToCanvasPoint(
  px: number,
  py: number,
  t: VideoBoxTransform & { rotation: number; boxCenterX: number; boxCenterY: number }
): [number, number] {
  const rad = (t.rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  let x = (px - t.boxW / 2) * t.fsScale;
  let y = (py - t.boxH / 2) * t.fsScale;
  [x, y] = [x * cosR - y * sinR, x * sinR + y * cosR];
  return [t.boxCenterX + t.tx + x * t.scale, t.boxCenterY + t.ty + y * t.scale];
}
