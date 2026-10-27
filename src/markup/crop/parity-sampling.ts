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
import { CropPointEasing, cropSectionAt, sectionCropAt } from './crop-keyframe-math';

/** The eased crop at `t` in the section that holds it. */
export function easedCropAtTime(
  easing: CropPointEasing,
  cropMap: CropPoint[],
  t: number,
  fps = 30,
  frame?: { width: number; height: number }
): number[] {
  // eslint-disable-next-line local/no-timeline-time-comparison -- samples the crop curve at a time
  const i = cropMap.findIndex((p, k) => k < cropMap.length - 1 && t >= p.x && t < cropMap[k + 1].x);
  if (i < 0) throw new Error(`no crop section holds t = ${t}`);
  const components = (crop: string) => crop.split(':').map(Number);
  return sectionCropAt(easing, cropSectionAt(cropMap, i), t, fps, frame, components);
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
