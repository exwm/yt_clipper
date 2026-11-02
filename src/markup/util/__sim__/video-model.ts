/**
 * A constant frame rate video in a browser, for the differential tests of the frame decisions
 * (frame-decisions.diff.test.ts). Ported from the 5.49 "Measure off against 5.48" simulations: the
 * container's timestamps exact or rounded to the millisecond, the frame a paused seek shows, what
 * each browser's frame clock reports after a seek, and the frame each clipper takes a time to mean.
 * Not modelled: variable frame rate, dropped frames, the seek coalescer's timing, refresh jitter.
 */
import type { FrameOnScreen } from '../frame-step';
import { FrameGrid, frameAt } from '../frame-grid';

// chrome: frame callbacks and a VideoFrame read at `seeked`. chromeNoRead: callbacks only. firefox:
// the first frame after a seek is timed at the seek target, currentTime rounded to the microsecond.
// noRvfc: no frame callbacks.
export type Browser = 'chrome' | 'chromeNoRead' | 'firefox' | 'noRvfc';
export const BROWSERS: readonly Browser[] = ['chrome', 'chromeNoRead', 'firefox', 'noRvfc'];

export type Site = 'youtube' | 'other';

export interface Video {
  rate: number;
  origin: number;
  // Container timestamps rounded to the millisecond (webm, YouTube) or exact.
  msTimestamps: boolean;
  duration: number;
}

/** The start of frame k as the container times it. */
export function frameTimestamp(v: Video, k: number): number {
  const t = v.origin + k / v.rate;
  return v.msTimestamps ? Math.round(t * 1000) / 1000 : t;
}

/** The frame a paused seek to `p` shows: the last one whose timestamp is at or before p. */
export function shownAt(v: Video, p: number): number {
  let k = Math.floor((p - v.origin) * v.rate);
  while (frameTimestamp(v, k + 1) <= p) k++;
  while (k > 0 && frameTimestamp(v, k) > p) k--;
  return Math.max(0, k);
}

/** The frame 5.49's clipper takes a stored time to mean (frame_grid.frameAt on the source's grid). */
export const clipper549Frame = (v: Video, t: number) =>
  frameAt({ origin: v.origin, rate: v.rate }, t);

/** 5.48's clipper: `-ss start` keeps frames from the first at or after the start marker. */
export function clipper548StartFrame(v: Video, t: number): number {
  const k = shownAt(v, t);
  return frameTimestamp(v, k) < t ? k + 1 : k;
}

/** 5.48's clipper: the trim keeps frames before the end marker. */
export function clipper548EndFrame(v: Video, t: number): number {
  const k = shownAt(v, t);
  return frameTimestamp(v, k) >= t ? k - 1 : k;
}

/** The playhead as the browser reports it. */
export const playheadAs = (b: Browser, p: number) =>
  b === 'firefox' ? Math.round(p * 1e6) / 1e6 : p;

/** What the frame clock holds, paused, after a seek that left the playhead at `p`. */
export function pausedOnScreen(b: Browser, v: Video, p: number): FrameOnScreen {
  const k = shownAt(v, p);
  switch (b) {
    case 'chrome':
      return { mediaTime: frameTimestamp(v, k), isRead: true, isCurrent: true };
    case 'chromeNoRead':
      return { mediaTime: frameTimestamp(v, k), isRead: false, isCurrent: true };
    case 'firefox':
      return { mediaTime: p, isRead: false, isCurrent: true };
    case 'noRvfc':
      return { mediaTime: null, isRead: false, isCurrent: false };
  }
}

/** The rate in use with Measure off: YouTube's stats rate (29.97 shows as 30), else the assumed 60. */
export function legacyRate(site: Site, rate: number): number {
  return site === 'youtube' ? Math.round(rate) : 60;
}

export const gridOf = (rate: number): FrameGrid => ({ origin: 0, rate });

const ntsc = (n: number) => (n * 1000) / 1001;
export const SIM_RATES = [
  12,
  15,
  ntsc(24),
  24,
  25,
  ntsc(30),
  30,
  48,
  50,
  ntsc(60),
  60,
  90,
  120,
  144,
];

/** How a frame rate in use compares with the video's. */
export const rateRelation = (inUse: number, rate: number) =>
  inUse > rate + 1e-9 ? 'above' : inUse < rate - 1e-9 ? 'below' : 'at';
