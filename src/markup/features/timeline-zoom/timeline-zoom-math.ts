// Pure math for the timeline zoom brush. timeline-zoom.ts holds the DOM shell and applies these
// results, so the range behaviour (clamping, panning, edge resizing, wheel zoom, playhead follow)
// and the label thinning are unit-testable without a browser.

/** The visible slice of the video, in seconds. */
export interface ZoomRange {
  start: number;
  end: number;
}

/** Narrowest range the brush can be resized or zoomed to. */
export const MIN_RANGE_SECONDS = 2;

// A fresh range covers a tenth of the video, kept between these bounds so short videos still
// zoom in a little and long videos zoom in enough to separate markers a few seconds apart.
const DEFAULT_WINDOW_FRACTION = 0.1;
const DEFAULT_WINDOW_MIN_SECONDS = 10;
const DEFAULT_WINDOW_MAX_SECONDS = 120;

// When playback leaves the range it pages so the playhead lands this far into the new range,
// leaving a little lead-in visible before it.
const FOLLOW_LEAD_FRACTION = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Order, size, and position a range so it lies within [0, duration] and spans at least the
 *  minimum (or the whole video, if that is shorter). Shifting keeps the span where possible. */
export function clampRange(range: ZoomRange, duration: number, minSpan: number): ZoomRange {
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  const span = clamp(hi - lo, Math.min(minSpan, duration), duration);
  const start = clamp(lo, 0, duration - span);
  return { start, end: start + span };
}

/** The range shown when the timeline opens, centred on the playhead. */
export function defaultRange(playhead: number, duration: number): ZoomRange {
  const span = Math.min(
    duration,
    clamp(
      duration * DEFAULT_WINDOW_FRACTION,
      DEFAULT_WINDOW_MIN_SECONDS,
      DEFAULT_WINDOW_MAX_SECONDS
    )
  );
  return clampRange(
    { start: playhead - span / 2, end: playhead + span / 2 },
    duration,
    MIN_RANGE_SECONDS
  );
}

// A fitted span keeps at least this fraction of its length as margin on each side, so a far-apart
// pair and playhead do not sit right at the edges.
const FRAME_SPREAD_MARGIN_FRACTION = 0.1;

/** A range showing `from`..`to` with a margin on each side (at least `minMargin`), at least
 *  `minSpan` wide, centred on the span unless that would pass a video end. */
export function rangeFittingSpan(
  from: number,
  to: number,
  minMargin: number,
  minSpan: number,
  duration: number
): ZoomRange {
  const margin = Math.max(minMargin, (to - from) * FRAME_SPREAD_MARGIN_FRACTION);
  const span = Math.max(to - from + 2 * margin, minSpan);
  const middle = (from + to) / 2;
  return clampRange(
    { start: middle - span / 2, end: middle + span / 2 },
    duration,
    MIN_RANGE_SECONDS
  );
}

/** Move the whole range by `deltaSeconds`, stopping at the ends of the video. */
export function panRange(
  range: ZoomRange,
  deltaSeconds: number,
  duration: number,
  minSpan: number
): ZoomRange {
  return clampRange(
    { start: range.start + deltaSeconds, end: range.end + deltaSeconds },
    duration,
    minSpan
  );
}

/** Drag one brush edge to `time`. The other edge stays put; the edge stops at the video bounds and
 *  at the minimum span instead of crossing the other edge. */
export function resizeRangeEdge(
  range: ZoomRange,
  edge: 'start' | 'end',
  time: number,
  duration: number,
  minSpan: number
): ZoomRange {
  // A video shorter than the minimum span pins the brush to the whole video.
  const span = Math.min(minSpan, duration);
  if (edge === 'start') {
    return { start: clamp(time, 0, Math.max(range.end - span, 0)), end: range.end };
  }
  return { start: range.start, end: clamp(time, Math.min(range.start + span, duration), duration) };
}

// Pixels per wheel notch: a mouse wheel notch is about 100px in DOM_DELTA_PIXEL mode, and a line
// (DOM_DELTA_LINE, Firefox) is about 33px.
const PIXELS_PER_NOTCH = 100;
const PIXELS_PER_LINE = 33;
const DOM_DELTA_LINE = 1;

/** A wheel delta as a number of mouse-wheel notches, capped at one per event. A trackpad sends many
 *  small deltas per gesture, so counting each event as a whole notch would zoom far too fast. */
export function wheelNotches(delta: number, deltaMode: number): number {
  const pixels = deltaMode === DOM_DELTA_LINE ? delta * PIXELS_PER_LINE : delta;
  return clamp(pixels / PIXELS_PER_NOTCH, -1, 1);
}

/** Scale the range by `factor` (< 1 zooms in) around `anchor`, which keeps its position within
 *  the range, like zooming around the cursor. */
export function zoomRangeAround(
  range: ZoomRange,
  anchor: number,
  factor: number,
  duration: number,
  minSpan: number
): ZoomRange {
  const span = range.end - range.start;
  const anchorFraction = span > 0 ? (anchor - range.start) / span : 0.5;
  const newSpan = clamp(span * factor, Math.min(minSpan, duration), duration);
  const start = anchor - anchorFraction * newSpan;
  return clampRange({ start, end: start + newSpan }, duration, minSpan);
}

/** Keep the playhead visible during playback: when it leaves the range, page so it lands just
 *  inside the new range. A playhead already inside leaves the range untouched, so a user's
 *  chosen view never drifts while they work in it. */
export function followPlayhead(
  range: ZoomRange,
  playhead: number,
  duration: number,
  minSpan: number
): ZoomRange {
  if (playhead >= range.start && playhead <= range.end) return range;
  const span = range.end - range.start;
  const start = playhead - span * FOLLOW_LEAD_FRACTION;
  return clampRange({ start, end: start + span }, duration, minSpan);
}

/** Position of `time` within the range, 0 at its start and 1 at its end (unclamped). */
export function timeToFraction(range: ZoomRange, time: number): number {
  return (time - range.start) / (range.end - range.start);
}

/** Inverse of timeToFraction. */
export function fractionToTime(range: ZoomRange, fraction: number): number {
  return range.start + fraction * (range.end - range.start);
}

const MAX_DECIMALS = 2;

/** Decimals that match what one pixel of the timeline can pick out, so precision follows the zoom
 *  rather than the video's length. */
function timelineTimeDecimals(secondsPerPixel: number): number {
  if (!(secondsPerPixel > 0)) return MAX_DECIMALS;
  return clamp(Math.round(-Math.log10(secondsPerPixel)), 0, MAX_DECIMALS);
}

/** A timestamp like the player's own (m:ss or h:mm:ss), with as many decimals as a timeline at
 *  `secondsPerPixel` resolves. */
export function formatTimelineTime(seconds: number, secondsPerPixel: number): string {
  const decimals = timelineTimeDecimals(secondsPerPixel);
  const scale = 10 ** decimals;
  const rounded = Math.round(Math.max(seconds, 0) * scale) / scale;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = (rounded % 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

// Once both edges are this close to the target (as a fraction of its span), easing snaps there.
const EASE_SNAP_FRACTION = 1e-4;

/** Move the shown range `factor` of the way to `target` (one animation frame of an exponential
 *  ease), snapping when it is close enough that further frames would be invisible. */
export function easeRangeToward(shown: ZoomRange, target: ZoomRange, factor: number): ZoomRange {
  const snap = (target.end - target.start) * EASE_SNAP_FRACTION;
  if (Math.abs(shown.start - target.start) <= snap && Math.abs(shown.end - target.end) <= snap) {
    return target;
  }
  return {
    start: shown.start + (target.start - shown.start) * factor,
    end: shown.end + (target.end - shown.end) * factor,
  };
}

export interface TimelineLabel {
  /** Horizontal position in px. */
  x: number;
  /** Always shown, e.g. the selected pair. */
  priority: boolean;
}

/** Indices (ascending) of the labels to draw so no two shown labels are closer than `minGap` px.
 *  Priority labels are placed first and always shown; the rest are placed left to right and
 *  skipped when they would crowd a label already placed. */
export function visibleLabelIndices(labels: TimelineLabel[], minGap: number): number[] {
  const placedXs: number[] = [];
  const shown = new Set<number>();
  labels.forEach((label, index) => {
    if (label.priority) {
      placedXs.push(label.x);
      shown.add(index);
    }
  });
  const others = labels
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => !label.priority)
    .sort((a, b) => a.label.x - b.label.x);
  for (const { label, index } of others) {
    if (placedXs.every((x) => Math.abs(x - label.x) >= minGap)) {
      placedXs.push(label.x);
      shown.add(index);
    }
  }
  return [...shown].sort((a, b) => a - b);
}
