export interface CropPreviewSize {
  /** The crop drawn upright, in whole canvas pixels. */
  drawW: number;
  drawH: number;
  /** The canvas, turned with the preview's rotation. */
  canvasW: number;
  canvasH: number;
}

/** The crop preview canvas for a crop of `w` x `h` video pixels. The scaled crop is fractional: round
 *  it to whole pixels and stretch the source region over it, since assigning a fractional canvas
 *  width truncates it and cuts off the crop's edge. */
export function cropPreviewSize(w: number, h: number, rotation: number): CropPreviewSize {
  const drawW = Math.max(1, Math.round(w));
  const drawH = Math.max(1, Math.round(h));
  const isRotated = rotation === 90 || rotation === -90;
  return {
    drawW,
    drawH,
    canvasW: isRotated ? drawH : drawW,
    canvasH: isRotated ? drawW : drawH,
  };
}
