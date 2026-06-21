/**
 * Pure, DOM-free math for the reframe auto-key editing model: given the
 * playhead time, is it sitting on a crop keyframe or between two of them?
 *
 * Kept separate from `charts.ts` (which carries the whole browser-side chart and
 * overlay graph) so the logic stays unit-testable in the node test env. The
 * caller supplies `fps` — production passes the detected video fps, tests pass a
 * fixed value.
 */
import { easeSinInOut } from 'd3-ease';
import { CropPoint } from '../@types/yt_clipper';
import { sortX } from '../ui/chart/chartPrimitives';
import { bsearch, clampNumber, frameDuration, getEasedValue } from '../util/util';

export interface CropKeyframeMatch {
  /** True when the playhead is within a frame of a keyframe's time. */
  onKeyframe: boolean;
  /** The NEAREST point to the playhead — so clicking/seeking to a point selects it
   *  even when the seek lands a hair off the point's exact (frame-quantized) time. */
  index: number;
  /** Indices bracketing the playhead: `[left, right]` (equal when exactly on a point). */
  section: [number, number];
}

// A full frame of slop absorbs the grid mismatch between a keyframe's stored time (the 0.01s roundX
// grid) and the video frame the playhead lands on when seeking to it (the 1/fps grid): seeking to a
// keyframe can land up to nearly a frame off, and a tighter half-frame test misses it, so the
// highlight flickers off right after landing on the point.
export function findCropKeyframeAtTime(
  cropMap: CropPoint[],
  time: number,
  fps: number
): CropKeyframeMatch {
  // bsearch returns [i, i] on an exact hit and [i, i+1] between points, but
  // [-1, 0] / [n-1, n] just outside the map — clamp to valid indices (the
  // playhead stays within [start, end] in practice, this only guards the edges).
  const lastIndex = cropMap.length - 1;
  const [rawStart, rawEnd] = bsearch(cropMap, { x: time, y: 0, crop: '' }, sortX);
  const s = Math.max(0, Math.min(rawStart, lastIndex));
  const e = Math.max(0, Math.min(rawEnd, lastIndex));
  const distToStart = Math.abs(cropMap[s].x - time);
  const distToEnd = Math.abs(cropMap[e].x - time);
  // Selection follows the NEAREST point (robust to a seek that lands a frame off).
  const index = distToStart <= distToEnd ? s : e;
  const onKeyframe = Math.min(distToStart, distToEnd) < frameDuration(fps);
  return { onKeyframe, index, section: [s, e] };
}

/**
 * The index of the keyframe to step to from `time` in direction `dir` (+1 forward, -1 back) — for
 * reframe wheel/keyframe navigation. On a keyframe (full-frame tolerance, so a seek that landed a
 * frame off still counts as "on it") step to the adjacent point; between keyframes go to the
 * bracketing point in that direction. Clamped to the map, so stepping past the ends stays put.
 */
export function nextKeyframeIndex(
  cropMap: CropPoint[],
  time: number,
  fps: number,
  dir: 1 | -1
): number {
  const { onKeyframe, index, section } = findCropKeyframeAtTime(cropMap, time, fps);
  const next =
    dir > 0 ? (onKeyframe ? index + 1 : section[1]) : onKeyframe ? index - 1 : section[0];
  return Math.max(0, Math.min(next, cropMap.length - 1));
}

/**
 * The `[left, right]` keyframe indices to ease the crop across at `time` — ALWAYS a
 * real interval (`left < right` for a map of ≥2 points), unlike
 * `findCropKeyframeAtTime().section` which collapses to `[i, i]` on an exact hit or at
 * the edges. The reframe preview interpolates across this so it eases smoothly by time,
 * rather than keying off the (nearest-keyframe-snapped) chart selection — which would
 * clamp the time outside its section and make the preview jump at the section midpoint.
 */
export function cropInterpolationSectionAtTime(
  cropMap: CropPoint[],
  time: number
): [number, number] {
  const maxIndex = cropMap.length - 1;
  const [left, rawRight] = bsearch(cropMap, { x: time, y: 0, crop: '' }, sortX);
  // On an exact keyframe hit bsearch returns [i, i]; ease across the forward section so
  // the interval is real (never collapses to a divide-by-zero in getEasedCropComponents).
  const right = left === rawRight ? left + 1 : rawRight;
  return [Math.max(0, Math.min(left, maxIndex - 1)), Math.max(1, Math.min(right, maxIndex))];
}

/**
 * The duration to ease a crop section over, kept in sync with the clipper's getEaseSectionDuration
 * (ffmpeg_filter.py) so the preview eases over the same span the rendered output does. The end time
 * is pulled back toward the last displayed frame so the ease finishes on it; for a section shorter
 * than that pull-back the adjustment inverts, so fall back to the real duration rather than dropping
 * it (in the clipper a dropped section leaves a gap that snaps the crop to 0,0). Returns null for a
 * zero-duration section, which has no frames to ease.
 */
export function getEaseSectionDuration(
  startTime: number,
  endTime: number,
  fps: number
): number | null {
  const realDuration = endTime - startTime;
  if (realDuration <= 0) return null;

  const leftFrameIndex = Math.floor(endTime * fps);
  const adjustedDuration = (leftFrameIndex - 0.5) / fps - startTime;
  if (adjustedDuration <= 0) return realDuration;

  return adjustedDuration;
}

// Hold the left point and then instantly transition to the right point once we reach it.
export const easeInInstant = (timePercentage: number) => (timePercentage >= 1 ? 1 : 0);

/**
 * The eased crop components ([x, y, w, h]) at `time` for the section between two crop points,
 * the single source of truth every preview surface (default overlay, reframe, modal, pop-out)
 * interpolates through. Pure so it can be unit-tested and checked against the clipper: the caller
 * supplies the parsed start/end components and fps (production passes the detected fps). Returns
 * null for a zero-duration section, which has no frames to ease.
 */
export function getEasedCropComponentsAtTime(
  startComponents: readonly number[],
  endComponents: readonly number[],
  startTime: number,
  endTime: number,
  easeIn: CropPoint['easeIn'],
  time: number,
  fps: number
): [number, number, number, number] | null {
  const sectDuration = getEaseSectionDuration(startTime, endTime, fps);
  if (sectDuration == null) return null;

  const clampedTime = clampNumber(time, startTime, endTime);
  const easingFunc = easeIn === 'instant' ? easeInInstant : easeSinInOut;
  // getEaseSectionDuration pulls the end back toward the last frame, so ease over that adjusted
  // end; getEasedValue clamps the percentage past it.
  const easedEndTime = startTime + sectDuration;

  const eased = [0, 1, 2, 3].map((i) =>
    getEasedValue(
      easingFunc,
      startComponents[i],
      endComponents[i],
      startTime,
      easedEndTime,
      clampedTime
    )
  );
  return [eased[0], eased[1], eased[2], eased[3]];
}
