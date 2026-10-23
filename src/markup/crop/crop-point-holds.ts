import { Draft } from 'immer';
import { CropPoint } from '../@types/yt_clipper';

// A hold point stores no crop of its own: it shows the crop of the crop point before it. Crops are
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

/** Release every hold point whose saved crop differs from the point before it, so a hand-edited
 *  file previews the crop the clipper renders. */
export function releaseMismatchedHolds(cropMap: CropMap): void {
  cropMap.forEach((_point, index) => releaseHoldIfChanged(cropMap, index));
}
