/**
 * Pure, DOM-free crop point math: which crop point or section the playhead is on (the reframe
 * auto-key editing model), and the eased crop between crop points for every crop easing except
 * Cinematic, kept in step with the clipper's ffmpeg_filter.py so the preview matches the render.
 *
 * Kept separate from `charts.ts` (which carries the whole browser-side chart and overlay graph) so
 * the logic stays unit-testable in the node test env. The caller supplies `fps`: production passes
 * the detected video fps, tests pass a fixed value.
 */
import { easeSinInOut } from 'd3-ease';
import { CropPoint } from '../@types/yt_clipper';
import { sortX } from '../ui/chart/chartPrimitives';
import { bsearch, clampNumber, frameDuration, getEasedValue } from '../util/util';

export interface CropKeyframeMatch {
  /** True when the playhead is within a frame of a keyframe's time. */
  onKeyframe: boolean;
  /** The NEAREST point to the playhead, so clicking/seeking to a point selects it
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
  // [-1, 0] / [n-1, n] just outside the map: clamp to valid indices (the
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
 * The index of the keyframe to step to from `time` in direction `dir` (+1 forward, -1 back): for
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
 * The `[left, right]` keyframe indices to ease the crop across at `time`: ALWAYS a
 * real interval (`left < right` for a map of ≥2 points), unlike
 * `findCropKeyframeAtTime().section` which collapses to `[i, i]` on an exact hit or at
 * the edges. The reframe preview interpolates across this so it eases smoothly by time,
 * rather than keying off the (nearest-keyframe-snapped) chart selection, which would
 * clamp the time outside its section and make the preview jump at the section midpoint.
 */
export function cropInterpolationSectionAtTime(
  cropMap: readonly CropPoint[],
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
 * Which curve a dynamic crop follows between its points.
 *  - `smoothInOut`: the classic per-section ease (easeSinInOut). Velocity is zero AT each crop
 *    point, so the crop comes to rest there. Smooth, but it fights a moving camera.
 *  - `smoothTrack`: a cubic Hermite spline with monotone (Fritsch-Carlson) tangents. Each point
 *    gets a non-zero tangent from its neighbors, so the crop keeps moving THROUGH points instead of
 *    stopping, tracking a steady camera pan, while never overshooting a point on a reversal.
 *  - `cinematic`: an L1 optimal camera path. Instead of interpolating through the points it
 *    approximates them within a margin with steady holds, constant-velocity pans, and smooth
 *    transitions (see cinematic-path.ts). The path is baked and rendered verbatim, not eased here.
 */
export type CropPointEasing = 'smoothInOut' | 'smoothTrack' | 'cinematic';

// The crop easing a pair uses when neither it nor the global setting has a mode. Save writes the
// global mode, so a saved file always carries one. Only JSONs saved before this feature lack it; the
// clipper renders those with the legacy sine ease for compatibility.
export const DEFAULT_CROP_POINT_EASING: CropPointEasing = 'smoothTrack';

/**
 * A neighbor of the section being eased, used by the splines to derive the section's end
 * tangents. `easeIn` is the transition between the neighbor and the section (the start point's
 * easeIn for the previous neighbor, the neighbor's own for the next one). `'instant'` makes it a
 * hard break: the tangent there drops to zero so the spline does not flow across the cut.
 */
export interface CropSectionNeighbor {
  components: readonly number[];
  time: number;
  easeIn: CropPoint['easeIn'];
}

// The tangent (crop-units per second) at a crop point, from the slopes to its two neighbors.
// Returns 0 at a map end or across an instant break (a missing neighbor), which eases the whole
// move gently in/out and stops the spline flowing over instant points. The Fritsch-Carlson rule
// keeps the section from overshooting the point: a reversal (neighbor slopes of opposite sign) or a
// flat zeroes the tangent, and otherwise the central slope is capped at 3x the smaller adjacent one.
function sectionPointTangent(
  beforeValue: number | null,
  pointValue: number,
  afterValue: number | null,
  beforeTime: number | null,
  pointTime: number,
  afterTime: number | null
): number {
  if (beforeValue == null || beforeTime == null || afterValue == null || afterTime == null) {
    return 0;
  }
  // Only crop points out of time order get here; there is no slope to follow.
  if (afterTime === beforeTime) return 0;
  const central = (afterValue - beforeValue) / (afterTime - beforeTime);

  if (pointTime === beforeTime || afterTime === pointTime) {
    // A coincident-time neighbor (a redundant zero-duration point) has no defined secant; drop the
    // tangent so the section eases gently rather than producing NaN.
    return 0;
  }
  const secantBefore = (pointValue - beforeValue) / (pointTime - beforeTime);
  const secantAfter = (afterValue - pointValue) / (afterTime - pointTime);
  if (
    secantBefore === 0 ||
    secantAfter === 0 ||
    Math.sign(secantBefore) !== Math.sign(secantAfter)
  ) {
    return 0;
  }
  const limit = 3 * Math.min(Math.abs(secantBefore), Math.abs(secantAfter));
  return clampNumber(central, -limit, limit);
}

/**
 * The smoothTrack crop components at `time` for the section [start, end], using the bracketing
 * neighbors to shape the curve. Unlike the other easings it spans the points' real times, not an end
 * pulled back to a frame: sections then meet exactly, so the crop keeps its speed through each point
 * on any frame grid (a pulled-back end held the crop for part of a frame at every point). Mirrors the
 * clipper's getCropFilter. Returns null for a zero-duration section.
 */
export function getSmoothTrackCropComponentsAtTime(
  startComponents: readonly number[],
  endComponents: readonly number[],
  startTime: number,
  endTime: number,
  prev: CropSectionNeighbor | null,
  next: CropSectionNeighbor | null,
  time: number
): [number, number, number, number] | null {
  const sectDuration = endTime - startTime;
  if (!(sectDuration > 0)) return null;

  const clampedTime = clampNumber(time, startTime, endTime);
  const s = clampNumber((clampedTime - startTime) / sectDuration, 0, 1);

  // Cubic Hermite basis on the normalized section parameter s.
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  // An instant transition INTO a point breaks momentum there, so drop that point's tangent.
  const incoming = prev && prev.easeIn !== 'instant' ? prev : null;
  const outgoing = next && next.easeIn !== 'instant' ? next : null;

  const eased = [0, 1, 2, 3].map((i) => {
    const p0 = startComponents[i];
    const p1 = endComponents[i];
    // Tangents are crop-units per second; scale to the section parameter by sectDuration. The
    // start point sits between its incoming neighbor and the end; the end between the start and
    // its outgoing neighbor.
    const m0 = sectionPointTangent(
      incoming?.components[i] ?? null,
      p0,
      p1,
      incoming?.time ?? null,
      startTime,
      endTime
    );
    const m1 = sectionPointTangent(
      p0,
      p1,
      outgoing?.components[i] ?? null,
      startTime,
      endTime,
      outgoing?.time ?? null
    );
    return h00 * p0 + h10 * (m0 * sectDuration) + h01 * p1 + h11 * (m1 * sectDuration);
  });
  return [eased[0], eased[1], eased[2], eased[3]];
}

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

// A crop point resolved to numeric components, for the pure easing dispatch below.
export interface EasingCropPoint {
  time: number;
  components: readonly number[];
  easeIn: CropPoint['easeIn'];
}

/**
 * The eased crop components at `time` for the section [start, end] under `easing`. `prev` and
 * `next` are the points bracketing the section; the splines take their tangents from them, and an
 * instant transition between a neighbor and the section breaks the spline there. An instant
 * section snaps. Cinematic is eased like smoothTrack here: its baked path is the caller's concern.
 * `frame` (the crop resolution) keeps a spline crop inside the frame, as the clipper does.
 */
export function getSectionEasedCropComponents(
  easing: CropPointEasing,
  start: EasingCropPoint,
  end: EasingCropPoint,
  prev: EasingCropPoint | null,
  next: EasingCropPoint | null,
  time: number,
  fps: number,
  frame?: { width: number; height: number }
): [number, number, number, number] {
  const useSpline = easing !== 'smoothInOut' && end.easeIn !== 'instant';
  // Each neighbor carries the transition between it and the section.
  const prevNeighbor: CropSectionNeighbor | null = prev && {
    components: prev.components,
    time: prev.time,
    easeIn: start.easeIn,
  };
  const nextNeighbor: CropSectionNeighbor | null = next && {
    components: next.components,
    time: next.time,
    easeIn: next.easeIn,
  };
  let eased: [number, number, number, number] | null;
  if (useSpline) {
    eased = getSmoothTrackCropComponentsAtTime(
      start.components,
      end.components,
      start.time,
      end.time,
      prevNeighbor,
      nextNeighbor,
      time
    );
  } else {
    eased = getEasedCropComponentsAtTime(
      start.components,
      end.components,
      start.time,
      end.time,
      end.easeIn,
      time,
      fps
    );
  }
  // A zero-duration section has nothing to ease: hold the start crop.
  const s = start.components;
  if (!eased) return [s[0], s[1], s[2], s[3]];
  // The spline eases the position and the size on their own, so on a zoom the crop can pass the
  // frame edge between points. The other easings stay between their end crops, which are inside.
  if (useSpline && frame) {
    eased[0] = clampNumber(eased[0], 0, frame.width - eased[2]);
    eased[1] = clampNumber(eased[1], 0, frame.height - eased[3]);
  }
  return eased;
}

/** The crop the section easing gives at `time`, from the section's crop points and their neighbors
 *  (none past either end). `componentsOf` reads a stored crop string. */
export function sectionCropAt(
  easing: CropPointEasing,
  section: { prev?: CropPoint | null; start: CropPoint; end: CropPoint; next?: CropPoint | null },
  time: number,
  fps: number,
  frame: { width: number; height: number } | undefined,
  componentsOf: (crop: string) => readonly number[]
): [number, number, number, number] {
  const easingPoint = (point: CropPoint): EasingCropPoint => ({
    time: point.x,
    components: componentsOf(point.crop),
    easeIn: point.easeIn,
  });
  return getSectionEasedCropComponents(
    easing,
    easingPoint(section.start),
    easingPoint(section.end),
    section.prev ? easingPoint(section.prev) : null,
    section.next ? easingPoint(section.next) : null,
    time,
    fps,
    frame
  );
}

/** The section from `cropMap[start]` to `cropMap[start + 1]`, with the points beside it. */
export function cropSectionAt(
  cropMap: readonly CropPoint[],
  start: number
): { prev?: CropPoint; start: CropPoint; end: CropPoint; next?: CropPoint } {
  return {
    prev: cropMap[start - 1],
    start: cropMap[start],
    end: cropMap[start + 1],
    next: cropMap[start + 2],
  };
}