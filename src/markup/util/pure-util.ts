import type { SpeedPoint } from '../@types/yt_clipper';
// eslint-disable-next-line no-restricted-imports -- getOutputDuration, the clipper's twin, one implementation
import { frameSpan } from './frame-grid';

/**
 * Helpers with no page, player or app state, which the frame decisions and the crop math import.
 * A leaf: it must not import util.ts, which imports frame-timing.ts, or the frame timing releases
 * would load in a cycle. util.ts re-exports these for its other callers.
 */

export function clampNumber(number: number, min: number, max: number) {
  return Math.max(min, Math.min(number, max));
}
export function toHHMMSS(seconds: number) {
  return new Date(seconds * 1000).toISOString().substring(11, 23);
}

export function toHHMMSSTrimmed(seconds: number) {
  return toHHMMSS(seconds).replace(/(00:)+(.*)/, '$2');
}

export function bsearch<A, B>(
  haystack: ArrayLike<A>,
  needle: B,
  comparator: (a: A, b: B, index?: number, haystack?: ArrayLike<A>) => any,
  lowParam?: number,
  highParam?: number
): [number, number] {
  let mid, cmp;

  let low: number = lowParam ?? 0;
  low = low | 0;
  if (low < 0 || low >= haystack.length) throw new RangeError('invalid lower bound');

  let high: number = highParam ?? haystack.length - 1;
  high = high | 0;
  if (high < low || high >= haystack.length) throw new RangeError('invalid upper bound');

  while (low <= high) {
    // The naive `low + high >>> 1` could fail for array lengths > 2**31
    // because `>>>` converts its operands to int32. `low + (high - low >>> 1)`
    // works for array lengths <= 2**32-1 which is also Javascript's max array
    // length.
    mid = low + ((high - low) >>> 1);
    cmp = +comparator(haystack[mid], needle, mid, haystack);

    // Too low.
    if (cmp < 0.0) low = mid + 1;
    // Too high.
    else if (cmp > 0.0) high = mid - 1;
    // Key found.
    else return [mid, mid];
  }

  // Key not found.
  return [high, low];
}

export function getEasedValue(
  easingFunc: (t: number) => number,
  startValue: number,
  endValue: number,
  startTime: number,
  endTime: number,
  currentTime: number
) {
  const elapsed = currentTime - startTime;
  const duration = endTime - startTime;
  const valueDelta = endValue - startValue;

  // Clamp the time percentage to [0,1] before easing, mirroring the clipper's clip(...,0,1). The
  // section's end is pulled back toward the last frame, so the playhead can sit past it; without
  // this clamp an unbounded ease (e.g. d3 sine) dips back below the target there.
  const easedValuePercentage = easingFunc(clampNumber(elapsed / duration, 0, 1));

  const easedValue = startValue + valueDelta * easedValuePercentage;
  return easedValue;
}

/** A marker pair's output duration as the clipper renders it: the frames from the one shown at its
 *  start marker through the one at its end marker, at its speed map's speeds. Mirrors
 *  getSpeedFilterAndDuration in the clipper's ffmpeg_filter.py; both are checked against
 *  src/clipper/tests/fixtures/output_duration_cases.json. */
export function getOutputDuration(speedMap: SpeedPoint[], fps = 30) {
  const last = speedMap.length - 1;
  const span = frameSpan({ origin: 0, rate: fps }, speedMap[0].x, speedMap[last].x);
  // The map's ends are the pair's: the last speed runs to the last frame's end.
  const points = speedMap.map((point, i) => ({
    ...point,
    x: i === 0 ? span.start : i === last ? span.end : point.x,
  }));
  if (points.every((point) => point.y === points[0].y)) {
    return (span.end - span.start) / points[0].y;
  }

  let outputDuration = 0;
  const frameDur = 1 / fps;
  const nSects = points.length - 1;
  const speedMapStartTime = span.start;

  for (let sect = 0; sect < nSects; ++sect) {
    const left = points[sect];
    const right = points[sect + 1];

    const startSpeed = left.y;
    const endSpeed = right.y;
    const speedChange = endSpeed - startSpeed;

    const sectStart = left.x - speedMapStartTime;
    let sectEnd = right.x - speedMapStartTime;
    // The map ends at the last frame's end. Its last section runs to that frame's start, the frame
    // then held for a frame below; a speed point inside the last frame leaves that section empty.
    if (sect === nSects - 1) {
      sectEnd = Math.max(sectStart, right.x - frameDur - speedMapStartTime);
    }

    const sectDuration = sectEnd - sectStart;
    if (sectDuration === 0) continue;

    const m = speedChange / sectDuration;
    const b = startSpeed - m * sectStart;

    if (speedChange === 0) {
      outputDuration += sectDuration / endSpeed;
    } else {
      // Integrate the reciprocal of the linear time vs speed function for the current section
      outputDuration +=
        (1 / m) * (Math.log(Math.abs(m * sectEnd + b)) - Math.log(Math.abs(m * sectStart + b)));
    }
  }
  // The last frame's output time rounds to a whole frame, half up as the clipper rounds, and the
  // frame is held for one frame.
  const lastFrame = Math.floor(outputDuration * fps + 0.5);
  return (lastFrame + 1) / fps;
}
