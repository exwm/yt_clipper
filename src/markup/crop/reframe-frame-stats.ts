/**
 * Debug stats for the reframe canvas's redraws (featureFlags.reframeFrameStats), to tell apart what
 * makes a reframed pan shake: redraws the browser skipped, redraws that ran after their frame was due,
 * a drawn picture from another frame than the crop, or a crop that moves unevenly.
 */

export interface ReframeFrameSample {
  // When the frame callback ran, and when the browser expects to show the frame (ms).
  now: number;
  expectedDisplayTime: number;
  // The frame the crop is computed for (s), and the browser's count of frames shown so far.
  mediaTime: number;
  presentedFrames: number;
  playbackRate: number;
  drawMs: number;
  // The media time of the frame the canvas drew (s), or null when the browser can't tell.
  drawnTime: number | null;
  // The drawn crop's center and width, in crop resolution px.
  cropCenterX: number;
  cropCenterY: number;
  cropWidth: number;
}

export interface ReframeFrameSummary {
  playbackRate: number;
  seconds: number;
  // The video's own time that passed: about seconds × playbackRate, less where the video stalled.
  videoSeconds: number;
  redraws: number;
  // Frames the browser showed with no redraw for them.
  skippedFrames: number;
  // Redraws that ran after the browser expected to show their frame.
  lateRedraws: number;
  drawMsMedian: number;
  drawMsP95: number;
  drawMsMax: number;
  // How far the drawn picture is from the crop's frame, in frames: the usual offset (a constant one is
  // the browser's timestamps, not a mismatch), and the redraws off from it by half a frame or more.
  pictureOffsetFrames: number | null;
  pictureMismatches: number | null;
  // How far the crop is from the line through its neighbors (crop resolution px): near zero for an
  // even pan, large where it jumps.
  cropOffLinePxP95: number;
  cropOffLinePxMax: number;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// The crop's distance from where a straight move between its neighbors would put it, at its frame.
function offLine(before: ReframeFrameSample, at: ReframeFrameSample, after: ReframeFrameSample): number {
  const span = after.mediaTime - before.mediaTime;
  if (!(span > 0)) return 0;
  const s = (at.mediaTime - before.mediaTime) / span;
  const off = (key: 'cropCenterX' | 'cropCenterY' | 'cropWidth') =>
    Math.abs(at[key] - (before[key] + (after[key] - before[key]) * s));
  return Math.max(off('cropCenterX'), off('cropCenterY'), off('cropWidth'));
}

export function summarizeReframeFrames(
  samples: readonly ReframeFrameSample[],
  fps: number
): ReframeFrameSummary {
  const pairs = samples.slice(1).map((sample, i) => [samples[i], sample] as const);
  const draws = samples.map((s) => s.drawMs);
  const offsets = samples.flatMap((s) =>
    s.drawnTime == null ? [] : [(s.drawnTime - s.mediaTime) * fps]
  );
  const usualOffset = offsets.length > 0 ? quantile(offsets, 0.5) : null;
  const offLines = samples
    .slice(1, -1)
    .map((sample, i) => offLine(samples[i], sample, samples[i + 2]));
  return {
    playbackRate: samples[0]?.playbackRate ?? 1,
    seconds: samples.length > 1 ? (samples[samples.length - 1].now - samples[0].now) / 1000 : 0,
    videoSeconds:
      samples.length > 1 ? samples[samples.length - 1].mediaTime - samples[0].mediaTime : 0,
    redraws: samples.length,
    skippedFrames: pairs.reduce(
      (sum, [a, b]) => sum + Math.max(0, b.presentedFrames - a.presentedFrames - 1),
      0
    ),
    lateRedraws: samples.filter((s) => s.now > s.expectedDisplayTime).length,
    drawMsMedian: quantile(draws, 0.5),
    drawMsP95: quantile(draws, 0.95),
    drawMsMax: Math.max(0, ...draws),
    pictureOffsetFrames: usualOffset,
    pictureMismatches:
      usualOffset == null ? null : offsets.filter((o) => Math.abs(o - usualOffset) >= 0.5).length,
    cropOffLinePxP95: quantile(offLines, 0.95),
    cropOffLinePxMax: Math.max(0, ...offLines),
  };
}

export function formatReframeFrameSummary(s: ReframeFrameSummary): string {
  const ms = (v: number) => v.toFixed(1);
  const picture =
    s.pictureOffsetFrames == null
      ? 'picture frame n/a'
      : `picture ${s.pictureMismatches} off the crop's frame (usual offset ${s.pictureOffsetFrames.toFixed(2)} frames)`;
  return [
    `[yt_clipper reframe] ${s.playbackRate}x, ${s.seconds.toFixed(1)}s (${s.videoSeconds.toFixed(1)}s of video):`,
    `${s.redraws} redraws, ${s.skippedFrames} frames skipped, ${s.lateRedraws} late,`,
    `draw ${ms(s.drawMsMedian)}/${ms(s.drawMsP95)}/${ms(s.drawMsMax)} ms (median/p95/max),`,
    `${picture},`,
    `crop off its line ${ms(s.cropOffLinePxP95)}/${ms(s.cropOffLinePxMax)} px (p95/max)`,
  ].join(' ');
}

// Samples are summarized every this many seconds of playback, and at a seek or a speed change.
const WINDOW_MS = 2000;
// Fewer redraws than this (a seek, a pause) are not summarized.
const MIN_REDRAWS = 10;

let samples: ReframeFrameSample[] = [];

/** Adds a redraw, and passes the summary of the last window to `report` when one ends. */
export function recordReframeFrame(
  sample: ReframeFrameSample,
  fps: number,
  report: (summary: ReframeFrameSummary) => void
): void {
  const last = samples[samples.length - 1];
  const jumped =
    last != null &&
    (sample.mediaTime <= last.mediaTime ||
      sample.mediaTime - last.mediaTime > 0.5 ||
      sample.playbackRate !== last.playbackRate);
  if (jumped) samples = [];
  samples.push(sample);
  if (sample.now - samples[0].now >= WINDOW_MS) {
    if (samples.length >= MIN_REDRAWS) report(summarizeReframeFrames(samples, fps));
    samples = [];
  }
}
