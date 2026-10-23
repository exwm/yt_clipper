import type { VideoElement } from '../appState';

/**
 * The time of the video frame on screen, from requestVideoFrameCallback's mediaTime. The playhead
 * (getCurrentTime) moves on seeks and scrubs smaller than a frame, and between presented frames,
 * while the same frame stays on screen, so a crop drawn at the playhead drifts from the picture.
 * The clock also measures the frame duration during playback, for sites that report no frame rate.
 */

// Played frames needed before trusting the measured frame rate. YouTube rounds mediaTime to the
// millisecond: 8 frames separate 24, 25, 30, 50 and 60 fps, and about 2 s separate 29.97 from 30.
export const FRAMES_TO_TELL_STANDARD_RATES = 8;
export const FRAMES_TO_TELL_NTSC_RATES = 60;
const MAX_FRAME_DURATIONS = 120;
const STANDARD_FRAME_RATES = [
  24000 / 1001,
  24,
  25,
  30000 / 1001,
  30,
  48,
  50,
  60000 / 1001,
  60,
  120,
];
// A measured rate within this fraction of its nearest standard rate snaps to it.
const STANDARD_FRAME_RATE_TOLERANCE = 0.015;

let clockVideo: VideoElement | null = null;
let lastPresentedFrameTime: number | null = null;
let frameDurations: number[] = [];

function resetClock(): void {
  lastPresentedFrameTime = null;
  frameDurations = [];
}

function startClock(video: VideoElement): void {
  clockVideo = video;
  resetClock();
  video.addEventListener('emptied', () => {
    if (clockVideo === video) resetClock();
  });
  const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
    if (clockVideo !== video) return;
    if (lastPresentedFrameTime != null && !video.paused) {
      const duration = metadata.mediaTime - lastPresentedFrameTime;
      if (duration > 0 && frameDurations.length < MAX_FRAME_DURATIONS) {
        frameDurations.push(duration);
      }
    }
    lastPresentedFrameTime = metadata.mediaTime;
    video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

/** The media time of the frame on screen, or the playhead until the video presents a frame. */
export function getPresentedFrameTime(video: VideoElement): number {
  if (clockVideo !== video) startClock(video);
  return lastPresentedFrameTime ?? video.getCurrentTime();
}

/** The frame rate measured from presented frames, snapped to the nearest standard rate when close to
 *  one, or null before `minFrames` frames have played. A dropped frame spans two frame durations, so
 *  each duration counts as a whole number of median durations. Averaging over all of them evens out
 *  mediaTime rounded to the millisecond. */
export function getMeasuredFrameRate(
  video: VideoElement,
  minFrames = FRAMES_TO_TELL_STANDARD_RATES
): number | null {
  if (clockVideo !== video) startClock(video);
  if (frameDurations.length < minFrames) return null;
  const sorted = [...frameDurations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const frameCount = frameDurations.reduce((sum, d) => sum + Math.max(1, Math.round(d / median)), 0);
  const fps = frameCount / frameDurations.reduce((sum, d) => sum + d, 0);
  const nearest = STANDARD_FRAME_RATES.reduce((best, rate) =>
    Math.abs(fps - rate) < Math.abs(fps - best) ? rate : best
  );
  return Math.abs(fps - nearest) <= nearest * STANDARD_FRAME_RATE_TOLERANCE ? nearest : fps;
}
