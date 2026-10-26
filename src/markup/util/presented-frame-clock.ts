import type { VideoElement } from '../appState';
import { onVideoFrames, PresentedVideoFrame, VideoFrameSubscription } from './video-frame-loop';

/**
 * The time of the video frame on screen, from the video frame loop's frames. The playhead
 * (getCurrentTime) moves on seeks and scrubs smaller than a frame, and between presented frames,
 * while the same frame stays on screen, so a crop drawn at the playhead drifts from the picture.
 * The clock also measures the frame duration during playback, for sites that report no frame rate.
 */

// Played frames needed before trusting the measured frame rate. YouTube rounds mediaTime to the
// millisecond: 8 frames separate 24, 25, 30, 50 and 60 fps. 60 frames separate an NTSC rate from its
// neighbor: they span a whole number of milliseconds, so both ends round alike.
export const FRAMES_TO_TELL_STANDARD_RATES = 8;
export const FRAMES_TO_TELL_NTSC_RATES = 60;
const MAX_FRAME_DURATIONS = 120;
const STANDARD_FRAME_RATES = [
  10,
  12000 / 1001,
  12,
  12.5,
  15000 / 1001,
  15,
  20,
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
// A published rate changes only for a measurement further off than this, so the rate (and the
// Cinematic path solved on its frame grid) settles once, even where early frames can't yet tell a
// rate from its NTSC neighbor 0.1% away. YouTube's caller waits until they can.
const PUBLISHED_RATE_HYSTERESIS = 0.002;
// A duration this many medians long spans a gap no seek event announced, such as a segment swap.
const OUTLIER_DURATION_MEDIANS = 3;
// A run keeps durations within this ratio of each other. Between the 1 ms rounding of mediaTime
// (17 ms after 16 ms at 60 fps) and the 2x of a missed frame.
const RUN_DURATION_RATIO = 1.5;

interface PresentedFrame {
  mediaTime: number;
  // Seeks started before this frame, so a duration across a seek is never measured.
  seekCount: number;
  duringSeek: boolean;
  droppedFrames: number;
  // Counts every frame presented, so a jump of more than 1 means a frame callback was missed.
  presentedFrames: number | undefined;
}

let clockVideo: VideoElement | null = null;
let clockSubscription: VideoFrameSubscription | null = null;
let lastFrame: PresentedFrame | null = null;
let seekCount = 0;
// Durations of the last frames played in a row. A seek, a pause or a dropped frame ends a run. The
// rate is measured on one run only: within a run the durations add up to its last time minus its
// first, so millisecond rounding errs by about 1 ms in total, while each extra run would add another
// and blur 29.97 into 30. A newer run replaces the measured one once it is as long, or long enough to
// tell NTSC rates, so a rate change mid-stream is measured again.
let currentRun: number[] = [];
let measuredRun: number[] = [];
let measuredRunChanges = 0;
let measuredRate: { measuredRunChanges: number; fps: number } | null = null;
let publishedRate: number | null = null;

function resetRuns(): void {
  currentRun = [];
  measuredRun = [];
}

function resetClock(): void {
  lastFrame = null;
  resetRuns();
  publishedRate = null;
}

function droppedFrames(video: VideoElement): number {
  return video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
}

// Only a duration between two frames played in a row at normal speed or slower measures the frame
// rate: not across a seek, not while paused, and not with frames dropped in between.
function isFrameDuration(
  previous: PresentedFrame,
  frame: PresentedFrame,
  video: VideoElement
): boolean {
  return (
    !video.paused &&
    video.playbackRate <= 1 &&
    previous.seekCount === frame.seekCount &&
    !previous.duringSeek &&
    !frame.duringSeek &&
    previous.droppedFrames === frame.droppedFrames &&
    (previous.presentedFrames == null ||
      frame.presentedFrames == null ||
      frame.presentedFrames === previous.presentedFrames + 1) &&
    frame.mediaTime > previous.mediaTime
  );
}

function startClock(video: VideoElement): void {
  clockVideo = video;
  resetClock();
  video.addEventListener('emptied', () => {
    if (clockVideo === video) resetClock();
  });
  // A new rendition (a resize) can have a new frame rate. The last rate stays published until a
  // new run measures one, so a quality switch doesn't flip 29.97 back to the platform's 30.
  video.addEventListener('resize', () => {
    if (clockVideo !== video) return;
    // The rate is published when asked for, which may not have happened since these frames played.
    getMeasuredFrameRate(video, FRAMES_TO_TELL_NTSC_RATES);
    resetRuns();
  });
  video.addEventListener('seeking', () => {
    if (clockVideo === video) seekCount++;
  });
  const onFrame = (presented: PresentedVideoFrame): void => {
    const frame: PresentedFrame = {
      mediaTime: presented.mediaTime,
      seekCount,
      duringSeek: video.seeking,
      droppedFrames: droppedFrames(video),
      presentedFrames: presented.presentedFrames,
    };
    const duration = lastFrame ? frame.mediaTime - lastFrame.mediaTime : 0;
    // Without a presented frame count (the every-refresh loop), a refresh the page missed shows only
    // as a duration spanning two frames. It starts a new run, and the next normal duration starts
    // another, so the miss stays in no run. A new frame rate keeps its run going.
    const previousDuration = currentRun[currentRun.length - 1];
    const offRun =
      frame.presentedFrames == null &&
      previousDuration != null &&
      (duration > previousDuration * RUN_DURATION_RATIO ||
        duration * RUN_DURATION_RATIO < previousDuration);
    if (lastFrame && isFrameDuration(lastFrame, frame, video)) {
      if (offRun) currentRun = [];
      currentRun.push(duration);
      if (currentRun.length > MAX_FRAME_DURATIONS) currentRun.shift();
      if (currentRun.length >= Math.min(measuredRun.length, FRAMES_TO_TELL_NTSC_RATES)) {
        measuredRun = currentRun;
      }
      if (measuredRun === currentRun) measuredRunChanges++;
    } else {
      currentRun = [];
    }
    lastFrame = frame;
  };
  clockSubscription?.stop();
  clockSubscription = onVideoFrames(video, onFrame, { phase: 'update', label: 'frame clock' });
}

/** The media time of the frame on screen, or the playhead until the video presents a frame. */
export function getPresentedFrameTime(video: VideoElement): number {
  if (clockVideo !== video) startClock(video);
  return lastFrame?.mediaTime ?? video.getCurrentTime();
}

/** The frame rate measured from presented frames, snapped to the nearest standard rate when close to
 *  one. Before `minFrames` frames have played in a row it is the last measured rate, or null.
 *  Averaging over the run evens out mediaTime rounded to the millisecond. */
export function getMeasuredFrameRate(
  video: VideoElement,
  minFrames = FRAMES_TO_TELL_STANDARD_RATES
): number | null {
  if (clockVideo !== video) startClock(video);
  if (measuredRun.length < minFrames) return publishedRate;
  // The frame loops ask many times per frame, and the durations only change when a frame is added.
  if (measuredRate?.measuredRunChanges !== measuredRunChanges) {
    measuredRate = { measuredRunChanges, fps: measureFrameRate(measuredRun) };
  }
  const fps = measuredRate.fps;
  if (
    publishedRate == null ||
    Math.abs(fps - publishedRate) > publishedRate * PUBLISHED_RATE_HYSTERESIS
  ) {
    publishedRate = fps;
  }
  return publishedRate;
}

function measureFrameRate(allDurations: number[]): number {
  const median = (durations: number[]) =>
    [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
  const typical = median(allDurations);
  const durations = allDurations.filter((d) => d <= typical * OUTLIER_DURATION_MEDIANS);
  const frameDuration = median(durations);
  const frameCount = durations.reduce(
    (sum, d) => sum + Math.max(1, Math.round(d / frameDuration)),
    0
  );
  const fps = frameCount / durations.reduce((sum, d) => sum + d, 0);
  const nearest = STANDARD_FRAME_RATES.reduce((best, rate) =>
    Math.abs(fps - rate) < Math.abs(fps - best) ? rate : best
  );
  if (Math.abs(fps - nearest) <= nearest * STANDARD_FRAME_RATE_TOLERANCE) return nearest;
  // A rate no standard one matches is rounded, so it doesn't drift with each new duration.
  return Math.round(fps * 10) / 10;
}
