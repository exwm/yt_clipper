export type ResizeEdges = {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
};

export type ResizeParams = {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  minW: number;
  minH: number;
  /** Maximum allowed width (e.g. viewport bound). Defaults to Infinity. */
  maxW?: number;
  /** Maximum allowed height (e.g. viewport bound). Defaults to Infinity. */
  maxH?: number;
  ar: number;
  edges: ResizeEdges;
  dx: number;
  dy: number;
};

export type ResizeResult = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ARChangeParams = {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  newAR: number;
  viewportW: number;
  viewportH: number;
  /** Which dimension to keep fixed. Defaults to 'width' for backward compatibility. */
  lockDimension?: 'width' | 'height';
  /** Anchor preference for x-axis. If 'right', keeps right edge fixed instead of left. */
  anchorX?: 'left' | 'right';
  /** Anchor preference for y-axis. If 'bottom', keeps bottom edge fixed instead of top. */
  anchorY?: 'top' | 'bottom';
  /** Starting x position when modification began. Used to determine when overflow is "undone". */
  startModX?: number;
  /** Starting y position when modification began. Used to determine when overflow is "undone". */
  startModY?: number;
};

export type ARChangeResult = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Which x anchor was used for this computation. */
  anchorX: 'left' | 'right';
  /** Which y anchor was used for this computation. */
  anchorY: 'top' | 'bottom';
};

/**
 * Computes new position and size when the source crop aspect ratio changes.
 *
 * By default, keeps the current preview **width** fixed and derives the new
 * height from it: `newH = width / newAR`. This mirrors the most natural user
 * interaction when dragging the top or bottom edge of the source crop:
 *
 *   Source bottom dragged down (AR narrows / becomes taller):
 *     → preview height grows   (width unchanged)
 *   Source bottom dragged up   (AR widens / becomes shorter):
 *     → preview height shrinks (width unchanged)
 *
 * When `lockDimension: 'height'` is passed, keeps height fixed and derives
 * width: `newW = height * newAR`. This mirrors dragging the left or right
 * edge of the source crop:
 *
 *   Source right dragged right (AR widens):
 *     → preview width grows    (height unchanged)
 *   Source right dragged left  (AR narrows):
 *     → preview width shrinks  (height unchanged)
 *
 * Viewport clamping and minimum-size enforcement are applied after the ideal
 * dimensions are computed, maintaining AR throughout.
 *
 * Anchor preference: top-left corner stays fixed and the preview grows /
 * shrinks toward bottom-right. Falls back to the bottom-right anchor per axis
 * only if the new size would overflow the viewport on that axis.
 */
export function computeARChange(p: ARChangeParams): ARChangeResult {
  const { x, y, width, height, minWidth, minHeight, newAR, viewportW, viewportH, lockDimension = 'width' } = p;
  // Use provided anchor preferences, defaulting to left/top
  const preferredAnchorX = p.anchorX ?? 'left';
  const preferredAnchorY = p.anchorY ?? 'top';

  const oldRight = x + width;
  const oldBottom = y + height;

  // Determine which dimension to keep fixed based on lockDimension
  let newW: number;
  let newH: number;

  if (lockDimension === 'height') {
    // Keep height fixed; derive width from the new AR.
    newH = height;
    newW = height * newAR;
  } else {
    // Keep width fixed; derive height from the new AR.
    newW = width;
    newH = width / newAR;
  }

  // Scale down to fit viewport while maintaining AR
  if (newW > viewportW) { newW = viewportW; newH = newW / newAR; }
  if (newH > viewportH) { newH = viewportH; newW = newH * newAR; }

  // Enforce minimums while maintaining AR
  if (newW < minWidth) { newW = minWidth; newH = newW / newAR; }
  if (newH < minHeight) { newH = minHeight; newW = newH * newAR; }

  const finalW = Math.round(newW);
  const finalH = Math.round(newH);

  // Apply anchor preferences:
  // - 'left' anchor: keep left edge fixed, grow/shrink from right
  // - 'right' anchor: keep right edge fixed, grow/shrink from left
  // - 'top' anchor: keep top edge fixed, grow/shrink from bottom
  // - 'bottom' anchor: keep bottom edge fixed, grow/shrink from top
  let newX: number;
  let newY: number;
  let usedAnchorX: 'left' | 'right';
  let usedAnchorY: 'top' | 'bottom';

  // Get the starting modification position (if provided)
  // This is used to determine when the user has "undone" the overflow
  const startModX = p.startModX;
  const startModY = p.startModY;

  // First, try the default (left/top) anchor to see if it works without overflow.
  const leftAnchoredX = x;
  const leftAnchoredOverflows = leftAnchoredX + finalW > viewportW;

  const topAnchoredY = y;
  const topAnchoredOverflows = topAnchoredY + finalH > viewportH;

  if (preferredAnchorX === 'right') {
    // User previously had right anchor (from overflow).
    // Keep using right anchor for the rest of the modification session.
    // The anchor will be reset to 'left' when the user releases Ctrl (via resetAnchor).
    newX = oldRight - finalW;
    usedAnchorX = 'right';
  } else {
    // Keep left edge fixed
    newX = x;
    // Check if we need to fall back to right anchor due to overflow
    if (newX + finalW > viewportW) {
      newX = oldRight - finalW;
      usedAnchorX = 'right';
    } else {
      usedAnchorX = 'left';
    }
  }

  if (preferredAnchorY === 'bottom') {
    // User previously had bottom anchor (from overflow).
    // Keep using bottom anchor for the rest of the modification session.
    // The anchor will be reset to 'top' when the user releases Ctrl (via resetAnchor).
    newY = oldBottom - finalH;
    usedAnchorY = 'bottom';
  } else {
    // Keep top edge fixed
    newY = y;
    // Check if we need to fall back to bottom anchor due to overflow
    if (newY + finalH > viewportH) {
      newY = oldBottom - finalH;
      usedAnchorY = 'bottom';
    } else {
      usedAnchorY = 'top';
    }
  }

  return {
    x: Math.max(0, Math.min(newX, viewportW - finalW)),
    y: Math.max(0, Math.min(newY, viewportH - finalH)),
    width: finalW,
    height: finalH,
    anchorX: usedAnchorX,
    anchorY: usedAnchorY,
  };
}

/**
 * Computes a new position and size for an AR-locked resize drag.
 *
 * Uses the delta-propagation approach (mirroring Crop.ts): apply the primary
 * delta, derive the secondary from the aspect ratio, propagate any secondary
 * clamping back to the primary so AR is always maintained.
 *
 * Anchor rules (matching the original preview behaviour):
 *   left handle   → right edge fixed, left moves
 *   right handle  → left edge fixed, right moves
 *   top handle    → bottom+right edges fixed, top+left move
 *   bottom handle → top+left edges fixed, bottom+right move
 *   corners       → use width-primary; top flag still anchors the bottom edge
 */
export function computeARLockedResize(p: ResizeParams): ResizeResult {
  const { startX, startY, startW, startH, minW, minH, ar, edges, dx, dy } = p;
  const maxW = p.maxW ?? Infinity;
  const maxH = p.maxH ?? Infinity;
  const { left, right, top, bottom } = edges;

  const fixedRight = startX + startW;
  const fixedBottom = startY + startH;

  let dw: number;
  let dh: number;

  if (left || right) {
    // ── Width-primary ────────────────────────────────────────────────────────
    const rawDw = right ? dx : -dx;

    // Clamp width within [minW, maxW].
    dw = Math.min(Math.max(rawDw, minW - startW), maxW - startW);

    // Derive height from AR.
    dh = dw / ar;

    // If height would drop below minH, clamp and propagate back.
    if (startH + dh < minH) {
      dh = minH - startH;
      dw = dh * ar;
      dw = Math.min(Math.max(dw, minW - startW), maxW - startW);
      dh = dw / ar;
    }

    // If height would exceed maxH, clamp and propagate back.
    if (startH + dh > maxH) {
      dh = maxH - startH;
      dw = dh * ar;
      dw = Math.min(Math.max(dw, minW - startW), maxW - startW);
      dh = dw / ar;
    }
  } else {
    // ── Height-primary (pure top or bottom) ──────────────────────────────────
    const rawDh = bottom ? dy : -dy;

    // Clamp height within [minH, maxH].
    dh = Math.min(Math.max(rawDh, minH - startH), maxH - startH);

    // Derive width from AR.
    dw = dh * ar;

    // If width would drop below minW, clamp and propagate back.
    if (startW + dw < minW) {
      dw = minW - startW;
      dh = dw / ar;
      dh = Math.min(Math.max(dh, minH - startH), maxH - startH);
      dw = dh * ar;
    }

    // If width would exceed maxW, clamp and propagate back.
    if (startW + dw > maxW) {
      dw = maxW - startW;
      dh = dw / ar;
      dh = Math.min(Math.max(dh, minH - startH), maxH - startH);
      dw = dh * ar;
    }
  }

  const newW = startW + dw;
  const newH = startH + dh;

  // ── Anchor / position ──────────────────────────────────────────────────────
  // Right edge is fixed for: left handle, or pure-top handle (top && !right).
  const anchorRight = left || (top && !right);
  const newX = anchorRight ? fixedRight - newW : startX;
  const newY = top ? fixedBottom - newH : startY;

  return {
    x: Math.round(newX),
    y: Math.round(newY),
    w: Math.round(newW),
    h: Math.round(newH),
  };
}
