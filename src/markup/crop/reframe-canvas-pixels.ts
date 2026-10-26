/** Whole-pixel geometry for the reframe canvas: which device pixels the crop covers, and the bands of
 *  black around it, so no edge is antialiased. */

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Leaves a hair of slack, so float error at an edge on a whole pixel never claims a partly covered
// pixel as covered (one claimed too few only costs a pixel of black that the crop then covers).
const EDGE_SLACK = 1e-3;

/** The whole device pixels inside a rect (device px), clipped to the canvas, or null if none. */
export function wholePixelsInside(
  left: number,
  top: number,
  right: number,
  bottom: number,
  canvasWidth: number,
  canvasHeight: number
): PixelRect | null {
  const x = Math.max(0, Math.ceil(left + EDGE_SLACK));
  const y = Math.max(0, Math.ceil(top + EDGE_SLACK));
  const width = Math.min(canvasWidth, Math.floor(right - EDGE_SLACK)) - x;
  const height = Math.min(canvasHeight, Math.floor(bottom - EDGE_SLACK)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** The device pixels a rect (device px) touches at all, clipped to the canvas, or null if none. */
export function touchedPixels(
  left: number,
  top: number,
  right: number,
  bottom: number,
  canvasWidth: number,
  canvasHeight: number
): PixelRect | null {
  const x = Math.max(0, Math.floor(left - EDGE_SLACK));
  const y = Math.max(0, Math.floor(top - EDGE_SLACK));
  const width = Math.min(canvasWidth, Math.ceil(right + EDGE_SLACK)) - x;
  const height = Math.min(canvasHeight, Math.ceil(bottom + EDGE_SLACK)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** The canvas except `hole`, as up to four whole-pixel bands: above, below, then left and right of
 *  the hole's rows. The whole canvas when there is no hole. */
export function bandsAround(
  hole: PixelRect | null,
  canvasWidth: number,
  canvasHeight: number
): PixelRect[] {
  if (!hole) return [{ x: 0, y: 0, width: canvasWidth, height: canvasHeight }];
  const { x, y, width, height } = hole;
  const bands: PixelRect[] = [];
  if (y > 0) bands.push({ x: 0, y: 0, width: canvasWidth, height: y });
  if (y + height < canvasHeight) {
    bands.push({ x: 0, y: y + height, width: canvasWidth, height: canvasHeight - y - height });
  }
  if (x > 0) bands.push({ x: 0, y, width: x, height });
  if (x + width < canvasWidth)
    bands.push({ x: x + width, y, width: canvasWidth - x - width, height });
  return bands;
}
