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

/** Whole seconds and the first `decimals` digits after the point, truncated like the players' own
 *  time readouts. Rounded to the microsecond first, so 1.001 s doesn't read as 1.000 from float
 *  error. */
export function truncatedSeconds(
  seconds: number,
  decimals: number
): { whole: number; fraction: string } {
  const microseconds = Math.round(seconds * 1e6);
  const whole = Math.floor(microseconds / 1e6);
  if (decimals <= 0) return { whole, fraction: '' };
  const digits = Math.floor(microseconds / 10 ** (6 - decimals)) % 10 ** decimals;
  return { whole, fraction: String(digits).padStart(decimals, '0') };
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
