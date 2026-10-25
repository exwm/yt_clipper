import type { VideoFrameLoopTiming } from './video-frame-loop';

// What one video frame loop did over a few seconds (featureFlags.videoFrameLoopStats).
export interface FrameLoopWindow {
  startedAt: number;
  timing: VideoFrameLoopTiming;
  consumers: string[];
  // Screen refreshes the loop ran on, the frames it took from the video, and those it had already
  // passed on ('everyRefresh' only).
  refreshes: number;
  framesTaken: number;
  repeats: number;
  // New frames passed to the consumers, and the frames the video showed meanwhile (decoded minus
  // dropped, from the video itself), counted from `videoFramesAtStart`.
  dispatched: number;
  videoFramesAtStart: number | null;
  // requestVideoFrameCallback's calls, and the frames it was not called for.
  frameCallbacks: number;
  frameCallbackMisses: number;
  // The loop's own time per frame taken, without the consumers' (ms), and each consumer's time.
  loopMs: number[];
  consumerMs: Record<string, number[]>;
}

export function newFrameLoopWindow(
  startedAt: number,
  timing: VideoFrameLoopTiming,
  consumers: string[],
  videoFramesAtStart: number | null
): FrameLoopWindow {
  return {
    startedAt,
    timing,
    consumers,
    refreshes: 0,
    framesTaken: 0,
    repeats: 0,
    dispatched: 0,
    videoFramesAtStart,
    frameCallbacks: 0,
    frameCallbackMisses: 0,
    loopMs: [],
    consumerMs: {},
  };
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function timing(values: readonly number[]): string {
  return `${quantile(values, 0.5).toFixed(2)}/${Math.max(0, ...values).toFixed(2)} ms`;
}

export function formatFrameLoopWindow(
  w: FrameLoopWindow,
  endedAt: number,
  videoFramesAtEnd: number | null
): string {
  const seconds = ((endedAt - w.startedAt) / 1000).toFixed(1);
  const videoFrames =
    w.videoFramesAtStart != null && videoFramesAtEnd != null
      ? `, video showed ${videoFramesAtEnd - w.videoFramesAtStart}`
      : '';
  const refresh =
    w.timing === 'everyRefresh'
      ? `${w.refreshes} refreshes, ${w.framesTaken} frames taken, ${w.repeats} repeats, loop ${timing(w.loopMs)} (median/max),`
      : '';
  const consumers = Object.entries(w.consumerMs)
    .map(([label, ms]) => `${label} ${timing(ms)}`)
    .join(', ');
  return [
    `[yt_clipper frame loop] ${w.timing}, ${seconds}s, ${w.consumers.join(' + ')}:`,
    refresh,
    `${w.dispatched} new frames${videoFrames},`,
    `frame callback ${w.frameCallbacks} calls, ${w.frameCallbackMisses} missed |`,
    consumers,
  ]
    .filter(Boolean)
    .join(' ');
}
