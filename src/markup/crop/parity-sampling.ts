// How the parity tables sample the preview's crop, shared by the tests that check them and the script
// that rewrites them (tools/test/write-parity-fixtures.ts), so both read the preview the same way.
import { CropPoint } from '../@types/yt_clipper';
import {
  bakeCinematicPath,
  cinematicCropMap,
  CinematicHolds,
  CinematicMargins,
  evalCropPathAtTime,
} from './cinematic-path';
import { CropPointEasing, sectionCropAt } from './crop-keyframe-math';

/** The eased crop at `t` in the section that holds it. */
export function easedCropAtTime(
  easing: CropPointEasing,
  cropMap: CropPoint[],
  t: number,
  fps = 30,
  frame?: { width: number; height: number }
): number[] {
  const i = cropMap.findIndex((p, k) => k < cropMap.length - 1 && t >= p.x && t < cropMap[k + 1].x);
  if (i < 0) throw new Error(`no crop section holds t = ${t}`);
  const section = { prev: cropMap[i - 1], start: cropMap[i], end: cropMap[i + 1], next: cropMap[i + 2] };
  return sectionCropAt(easing, section, t, fps, frame, (crop) => crop.split(':').map(Number));
}

export interface CinematicParityCase {
  cropMap: CropPoint[];
  margins: CinematicMargins;
  cropRes: [number, number];
  fps?: number;
  holds?: CinematicHolds;
}

/** The Cinematic crop path baked from the case's crop points, as the preview bakes it. */
export function cinematicCropAt(c: CinematicParityCase): (t: number) => number[] {
  const cropMap = cinematicCropMap(c.cropMap, c.holds ?? 'exact');
  const path = bakeCinematicPath(cropMap, c.margins, c.cropRes[0], c.cropRes[1], c.fps);
  if (!path) throw new Error('the case has too few crop points to bake a Cinematic path');
  return (t) => evalCropPathAtTime(path, t);
}
