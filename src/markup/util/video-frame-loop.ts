import { featureFlags, onFeatureFlagChange } from '../feature-flags';
import {
  formatFrameLoopWindow,
  FrameLoopWindow,
  newFrameLoopWindow,
} from './video-frame-loop-stats';
import {
  FrameScheduleAction,
  FrameScheduleEvent,
  FrameScheduleState,
  initialFrameSchedule,
  retimeFrameSchedule,
  stepFrameSchedule,
  VideoFrameLoopTiming,
} from './video-frame-schedule';

/**
 * One loop per video that hands each new video frame to everything drawn or updated per frame:
 * reframe, the crop previews, the minimap, the crop chart preview and the presented-frame clock.
 * Consumers say what to do with a frame; the loop decides when frames arrive.
 *
 * Timing 'everyRefresh' passes a VideoFrame of exactly the frame the video holds, with that frame's
 * own timestamp, so a crop computed at `mediaTime` always matches the picture drawn from `image`.
 * requestVideoFrameCallback alone misses frames (Blink skips a rendering step when it reschedules)
 * and can run a vsync late, when drawImage(video) already draws the next frame. Timing
 * 'frameCallback' is that older loop. It is used while nothing draws (only the clock and crop state
 * follow the video, where a missed frame costs little), and as the fallback.
 *
 * The decisions are in `video-frame-schedule.ts`. This shell turns browser events into its events
 * and carries out its actions.
 */

export type { VideoFrameLoopTiming } from './video-frame-schedule';

export interface PresentedVideoFrame {
  // The frame's own media time (s).
  mediaTime: number;
  // Exactly that frame: a VideoFrame, closed once every consumer has run, so draw from it within the
  // call and keep only values from it. Under 'frameCallback' it is the video.
  image: CanvasImageSource;
  // When the loop ran (ms, performance.now's clock).
  now: number;
  // Under 'frameCallback' only: the video's count of frames shown (a jump of more than 1 is a missed
  // callback), and when the browser expects to show the frame.
  presentedFrames?: number;
  expectedDisplayTime?: number;
}

export type VideoFrameConsumer = (frame: PresentedVideoFrame) => void;

export interface VideoFrameConsumerOptions {
  // 'update' consumers (the clock, crop state) run before 'draw' consumers on each frame, so a draw
  // reads state already updated for that frame. A 'draw' consumer also asks for 'everyRefresh'.
  phase?: 'update' | 'draw';
  // Names the consumer in the debug stats.
  label?: string;
}

export interface VideoFrameSubscription {
  // Calls this consumer alone with the frame the video holds now: after an edit while paused, when no
  // new frame comes.
  redraw(): void;
  stop(): void;
}

// The debug stats log every this many ms of playback.
const STATS_WINDOW_MS = 2000;

// ─── functional core ─────────────────────────────────────────────────────────

export function chooseTiming(options: {
  preferred: VideoFrameLoopTiming;
  hasVideoFrame: boolean;
  hasDrawConsumer: boolean;
  timestampsDisagree: boolean;
}): VideoFrameLoopTiming {
  const { preferred, hasVideoFrame, hasDrawConsumer, timestampsDisagree } = options;
  return preferred === 'everyRefresh' && hasVideoFrame && hasDrawConsumer && !timestampsDisagree
    ? 'everyRefresh'
    : 'frameCallback';
}

/** The frames a presentedFrames step skipped: 0 for consecutive frames. */
export function framesSkipped(previous: number | undefined, current: number): number {
  return previous == null ? 0 : Math.max(0, current - previous - 1);
}

/** Update consumers first, keeping the order they subscribed in within each phase. */
export function orderConsumers<T extends { phase: 'update' | 'draw' }>(
  consumers: readonly T[]
): T[] {
  return [...consumers].sort((a, b) => Number(a.phase === 'draw') - Number(b.phase === 'draw'));
}

// ─── shell ───────────────────────────────────────────────────────────────────

interface Consumer {
  onFrame: VideoFrameConsumer;
  phase: 'update' | 'draw';
  label: string;
}

interface Loop {
  video: HTMLVideoElement;
  consumers: Consumer[];
  schedule: FrameScheduleState;
  // The timing the browser callbacks below run under, or null while stopped.
  runningTiming: VideoFrameLoopTiming | null;
  animationFrameId: number;
  frameCallbackId: number;
  removeListeners: () => void;
  // For the debug stats only.
  lastPresentedFrames: number | undefined;
  stats: FrameLoopWindow | null;
}

const loops = new Map<HTMLVideoElement, Loop>();
let preferredTiming: VideoFrameLoopTiming = featureFlags.videoFrameLoopTiming;

/** The timing loops prefer; running loops switch to it. */
export function setVideoFrameLoopTiming(timing: VideoFrameLoopTiming): void {
  preferredTiming = timing;
  for (const loop of loops.values()) retime(loop);
}

onFeatureFlagChange((name) => {
  if (name === 'videoFrameLoopTiming') setVideoFrameLoopTiming(featureFlags.videoFrameLoopTiming);
});

export function onVideoFrames(
  video: HTMLVideoElement,
  onFrame: VideoFrameConsumer,
  options: VideoFrameConsumerOptions = {}
): VideoFrameSubscription {
  const phase = options.phase ?? 'draw';
  const consumer: Consumer = { onFrame, phase, label: options.label ?? phase };
  let loop = loops.get(video);
  if (!loop) {
    loop = newLoop(video);
    loops.set(video, loop);
  }
  loop.consumers = orderConsumers([...loop.consumers, consumer]);
  retime(loop);
  const owner = loop;
  return {
    redraw: () => {
      if (owner.consumers.includes(consumer)) redrawConsumer(owner, consumer);
    },
    stop: () => {
      owner.consumers = owner.consumers.filter((c) => c !== consumer);
      if (owner.consumers.length > 0) {
        retime(owner);
        return;
      }
      stopLoop(owner);
      if (loops.get(video) === owner) loops.delete(video);
    },
  };
}

function newLoop(video: HTMLVideoElement): Loop {
  return {
    video,
    consumers: [],
    schedule: initialFrameSchedule('frameCallback'),
    runningTiming: null,
    animationFrameId: 0,
    frameCallbackId: 0,
    removeListeners: () => {},
    lastPresentedFrames: undefined,
    stats: null,
  };
}

function timingFor(loop: Loop): VideoFrameLoopTiming {
  return chooseTiming({
    preferred: preferredTiming,
    hasVideoFrame: typeof VideoFrame !== 'undefined',
    hasDrawConsumer: loop.consumers.some((c) => c.phase === 'draw'),
    timestampsDisagree: loop.schedule.timestampsDisagree,
  });
}

// Starts the loop, or restarts it when its timing should change.
function retime(loop: Loop): void {
  const timing = timingFor(loop);
  if (timing === loop.runningTiming) return;
  stopLoop(loop);
  loop.schedule = retimeFrameSchedule(loop.schedule, timing);
  startLoop(loop);
}

function startLoop(loop: Loop): void {
  loop.runningTiming = loop.schedule.timing;
  // The frame callback runs under both timings: the schedule passes its frames on under
  // 'frameCallback', and under 'everyRefresh' it wakes a paused loop for a seek's frame.
  const onFrameCallback = (now: number, metadata: VideoFrameCallbackMetadata): void => {
    loop.frameCallbackId = loop.video.requestVideoFrameCallback(onFrameCallback);
    const stats = statsWindow(loop, now);
    if (stats) {
      stats.frameCallbacks++;
      stats.frameCallbackMisses += framesSkipped(
        loop.lastPresentedFrames,
        metadata.presentedFrames
      );
    }
    loop.lastPresentedFrames = metadata.presentedFrames;
    const event: FrameScheduleEvent = {
      type: 'frameCallback',
      mediaTime: metadata.mediaTime,
      presentedFrames: metadata.presentedFrames,
    };
    step(loop, event, now, null, metadata.expectedDisplayTime);
  };
  loop.frameCallbackId = loop.video.requestVideoFrameCallback(onFrameCallback);
  const onSeeked = (): void => {
    step(loop, { type: 'seeked' }, performance.now(), null);
  };
  // A new source starts its frames and timeline over, and may be checked into another timing.
  const onEmptied = (): void => {
    step(loop, { type: 'sourceChanged' }, performance.now(), null);
    retime(loop);
  };
  loop.video.addEventListener('seeked', onSeeked);
  loop.video.addEventListener('emptied', onEmptied);
  loop.removeListeners = () => {
    loop.video.removeEventListener('seeked', onSeeked);
    loop.video.removeEventListener('emptied', onEmptied);
  };
  if (loop.schedule.timing !== 'everyRefresh') return;
  const tick = (now: number): void => {
    loop.animationFrameId = requestAnimationFrame(tick);
    const stats = statsWindow(loop, now);
    if (stats) stats.refreshes++;
    const v = loop.video;
    step(loop, { type: 'refresh', paused: v.paused, seeking: v.seeking }, now, null);
  };
  loop.animationFrameId = requestAnimationFrame(tick);
}

// Feeds an event to the schedule and carries out its actions. `frame` is the VideoFrame a
// 'frameTaken' event reports. Returns the time the consumers took (ms).
function step(
  loop: Loop,
  event: FrameScheduleEvent,
  now: number,
  frame: VideoFrame | null,
  expectedDisplayTime?: number
): number {
  const result = stepFrameSchedule(loop.schedule, event);
  loop.schedule = result.state;
  let consumersMs = 0;
  for (const action of result.actions) {
    consumersMs += act(loop, action, now, frame, expectedDisplayTime);
  }
  return consumersMs;
}

function act(
  loop: Loop,
  action: FrameScheduleAction,
  now: number,
  frame: VideoFrame | null,
  expectedDisplayTime: number | undefined
): number {
  switch (action.type) {
    case 'takeFrame':
      takeFrame(loop, now);
      return 0;
    case 'dispatch': {
      const image = action.image === 'videoFrame' ? frame : loop.video;
      if (!image) return 0;
      const { mediaTime, presentedFrames } = action;
      return dispatch(loop, { mediaTime, image, now, presentedFrames, expectedDisplayTime });
    }
    case 'fallBackToFrameCallback':
      console.warn(
        `yt_clipper: video frame timestamps are ${action.offsetSeconds.toFixed(1)}s off the video's time, so previews use requestVideoFrameCallback`
      );
      retime(loop);
      return 0;
  }
}

function takeFrame(loop: Loop, now: number): void {
  const start = performance.now();
  let frame: VideoFrame;
  try {
    frame = new VideoFrame(loop.video);
  } catch {
    step(loop, { type: 'frameUnavailable' }, now, null);
    return;
  }
  let consumersMs = 0;
  try {
    const dispatchedBefore = loop.stats?.dispatched;
    const event: FrameScheduleEvent = {
      type: 'frameTaken',
      frameTime: frame.timestamp / 1e6,
      videoTime: loop.video.currentTime,
    };
    consumersMs = step(loop, event, now, frame);
    if (loop.stats) {
      loop.stats.framesTaken++;
      if (loop.stats.dispatched === dispatchedBefore) loop.stats.repeats++;
    }
  } finally {
    frame.close();
    loop.stats?.loopMs.push(performance.now() - start - consumersMs);
  }
}

// Calls every consumer with the frame, and returns how long they took (ms).
function dispatch(loop: Loop, frame: PresentedVideoFrame): number {
  const stats = loop.stats;
  if (stats) stats.dispatched++;
  let total = 0;
  // A consumer may stop itself or another during the dispatch.
  for (const consumer of [...loop.consumers]) {
    const start = performance.now();
    callConsumer(consumer, frame);
    const ms = performance.now() - start;
    total += ms;
    if (stats) (stats.consumerMs[consumer.label] ??= []).push(ms);
  }
  return total;
}

function callConsumer(consumer: Consumer, frame: PresentedVideoFrame): void {
  try {
    consumer.onFrame(frame);
  } catch (e) {
    // One broken consumer must not stop the others or the loop.
    console.error(e);
  }
}

function redrawConsumer(loop: Loop, consumer: Consumer): void {
  const now = performance.now();
  if (loop.schedule.timing === 'everyRefresh') {
    let frame: VideoFrame | null = null;
    try {
      frame = new VideoFrame(loop.video);
    } catch {
      // no frame decoded yet: fall through to the video itself
    }
    if (frame) {
      try {
        callConsumer(consumer, { mediaTime: frame.timestamp / 1e6, image: frame, now });
      } finally {
        frame.close();
      }
      return;
    }
  }
  const mediaTime = loop.schedule.lastDispatchedTime ?? loop.video.currentTime;
  callConsumer(consumer, { mediaTime, image: loop.video, now });
}

function stopLoop(loop: Loop): void {
  if (loop.animationFrameId) cancelAnimationFrame(loop.animationFrameId);
  if (loop.frameCallbackId) loop.video.cancelVideoFrameCallback?.(loop.frameCallbackId);
  loop.runningTiming = null;
  loop.animationFrameId = 0;
  loop.frameCallbackId = 0;
  loop.lastPresentedFrames = undefined;
  loop.removeListeners();
  loop.removeListeners = () => {};
  loop.stats = null;
}

// The stats window for this moment, logging and replacing the last one once it spans
// STATS_WINDOW_MS, or null with the stats off. Only windows with playback are logged.
function statsWindow(loop: Loop, now: number): FrameLoopWindow | null {
  if (!featureFlags.videoFrameLoopStats) return null;
  const window = loop.stats;
  if (window && now - window.startedAt < STATS_WINDOW_MS) return window;
  const videoFrames = videoFramesShown(loop.video);
  if (window && window.dispatched > 0) {
    console.log(formatFrameLoopWindow(window, now, videoFrames));
  }
  loop.stats = newFrameLoopWindow(
    now,
    loop.schedule.timing,
    loop.consumers.map((c) => c.label),
    videoFrames
  );
  return loop.stats;
}

// The frames the video has shown so far: decoded minus dropped, or null where the browser can't tell.
function videoFramesShown(video: HTMLVideoElement): number | null {
  const quality = video.getVideoPlaybackQuality?.();
  return quality ? quality.totalVideoFrames - quality.droppedVideoFrames : null;
}
