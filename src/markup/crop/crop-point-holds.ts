import { Draft } from 'immer';
import { CropPoint } from '../@types/yt_clipper';
import { parseCropToComponents } from './cinematic-path';
import { Crop } from './crop';

// While it holds, a hold point shows the crop of the crop point before it, not its own. Crops are
// resolved on write, so every reader (preview, easing, save, the clipper) sees plain crops.

type CropMap = CropPoint[] | Draft<CropPoint[]>;
type CropsEqual = (a: string, b: string) => boolean;

const sameCropText: CropsEqual = (a, b) => a === b;

/** Give each hold point the crop of the point before it, left to right, so a run of hold points
 *  follows the nearest normal point. Writes only what differs, so immer keeps an unchanged map. */
export function resolveHeldCrops(cropMap: CropMap): void {
  cropMap.forEach((point, index) => {
    if (!point.hold) return;
    if (index === 0) {
      delete point.hold;
      return;
    }
    const heldCrop = cropMap[index - 1].crop;
    if (point.crop !== heldCrop) point.crop = heldCrop;
  });
}

/** Make the point at `index` a normal point if it no longer shows the crop of the point before
 *  it. The first point has nothing to hold, so it never stays a hold point. */
export function releaseHoldIfChanged(
  cropMap: CropMap,
  index: number,
  cropsEqual: CropsEqual = sameCropText
): void {
  const point = cropMap[index];
  if (!point?.hold) return;
  if (index === 0 || !cropsEqual(point.crop, cropMap[index - 1].crop)) delete point.hold;
}

interface PairCropState {
  cropMap: CropPoint[];
  cropRes: string;
  enableZoomPan: boolean;
}

/** The crop a point had before it became a hold point, from the undo history, fitted to the pair
 *  now: at its crop resolution, in pan-only mode at the size all its points share (`heldCrop`'s), and
 *  within the frame. Undefined when the point was a hold point from the start, or when an earlier
 *  state has no point at its time (a point deleted there, or this one moved since). */
export function cropBeforeHold(
  undoredo: { history: PairCropState[]; index: number },
  time: number,
  now: PairCropState,
  heldCrop: string
): string | undefined {
  for (let i = undoredo.index; i >= 0; i--) {
    const state = undoredo.history[i];
    const point = state?.cropMap.find((p) => p.x === time);
    if (!point) return undefined;
    if (!point.hold) return fitCropToPair(point.crop, state.cropRes, now, heldCrop);
  }
  return undefined;
}

function fitCropToPair(
  crop: string,
  cropRes: string,
  now: PairCropState,
  heldCrop: string
): string {
  const [oldW, oldH] = cropRes.split('x').map(Number);
  const [resW, resH] = now.cropRes.split('x').map(Number);
  let [x, y, w, h] = parseCropToComponents(crop, oldW, oldH);
  [x, w] = [(x * resW) / oldW, (w * resW) / oldW];
  [y, h] = [(y * resH) / oldH, (h * resH) / oldH];
  const [, , heldW, heldH] = parseCropToComponents(heldCrop, resW, resH);
  if (!now.enableZoomPan) {
    [w, h] = [heldW, heldH];
  } else if (heldW > 0 && heldH > 0) {
    // Zoompan points share one aspect ratio (the held crop's): keep the width and center.
    const ratio = heldW / heldH;
    const [cx, cy] = [x + w / 2, y + h / 2];
    // Narrowed so the height fits the frame, and the height from the whole-pixel width.
    w = Math.min(Math.round(w), Math.floor(resH * ratio));
    h = Math.round(w / ratio);
    [x, y] = [cx - w / 2, cy - h / 2];
  }
  // Snapped as the chart's edits are: whole pixels, in the frame.
  [x, y, w, h] = [x, y, w, h].map(Math.round);
  const fitted = new Crop(x, y, w, h, resW, resH);
  fitted.setCropStringSafe(`${x}:${y}:${w}:${h}`, now.enableZoomPan);
  return fitted.cropString;
}

function releaseHold(point: CropPoint | Draft<CropPoint>, ownCrop: string | undefined): void {
  delete point.hold;
  if (ownCrop != null) point.crop = ownCrop;
}

/** Toggle a point between hold and normal. A hold point drops instant easing, and a released one
 *  gets back `ownCrop`. Returns false for the first point, which can't be a hold point. */
export function toggleHold(cropMap: CropMap, index: number, ownCrop?: string): boolean {
  if (index === 0) return false;
  const point = cropMap[index];
  if (point.hold) {
    releaseHold(point, ownCrop);
  } else {
    point.hold = true;
    delete point.easeIn;
  }
  return true;
}

/** Toggle a point's easing between auto and instant. A hold point is released first, getting back
 *  `ownCrop`, since an instant point needs a crop of its own. */
export function toggleInstant(cropMap: CropMap, index: number, ownCrop?: string): void {
  const point = cropMap[index];
  if (point.hold) releaseHold(point, ownCrop);
  if (point.easeIn === 'instant') delete point.easeIn;
  else point.easeIn = 'instant';
}

/** Release every hold point whose saved crop differs from the point before it, so a hand-edited
 *  file previews the crop the clipper renders. */
export function releaseMismatchedHolds(cropMap: CropMap): void {
  cropMap.forEach((_point, index) => releaseHoldIfChanged(cropMap, index));
}
