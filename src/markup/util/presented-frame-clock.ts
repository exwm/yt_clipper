import type { VideoElement } from '../appState';
import {
  announceRate,
  ClockEvent,
  ClockState,
  initialClock,
  isHeldFrameNear,
  isFrameCurrent,
  measuredRate,
  stepClock,
} from './frame-clock-core';
import type { FrameOnScreen } from './frame-step';
import { onVideoFrames, PresentedVideoFrame, VideoFrameSubscription } from './video-frame-loop';

/**
 * The time of the video frame on screen, from the video frame loop's frames. The playhead
 * (getCurrentTime) moves on seeks and scrubs smaller than a frame, and between presented frames,
 * while the same frame stays on screen, so a crop drawn at the playhead drifts from the picture.
 * The clock also measures the frame duration during playback, for sites that report no frame rate.
 * The decisions are in `frame-clock-core.ts`; this module feeds it the video's events.
 */

let clockVideo: VideoElement | null = null;
let clockSubscription: VideoFrameSubscription | null = null;
let clock: ClockState = initialClock;

function startClock(video: VideoElement): void {
  clockVideo = video;
  clock = initialClock;
  const step = (event: ClockEvent) => {
    if (clockVideo !== video) return;
    const before = clock;
    clock = stepClock(clock, event);
    logNewRate(before, clock);
  };
  video.addEventListener('emptied', () => step({ type: 'emptied' }));
  video.addEventListener('resize', () => step({ type: 'resize' }));
  video.addEventListener('seeking', () => step({ type: 'seeking' }));
  video.addEventListener('seeked', () => {
    const held = readHeldFrame(video);
    step({
      type: 'seeked',
      heldFrameTime: held?.time ?? null,
      heldFrameDuration: held?.duration ?? null,
      // The held frame's timeline (a part's, on afreecatv), not the platform's.
      currentTime: video.currentTime,
      seeking: video.seeking,
    });
  });
  const onFrame = (presented: PresentedVideoFrame): void => {
    const quality = video.getVideoPlaybackQuality?.();
    step({
      type: 'frame',
      frame: {
        mediaTime: presented.mediaTime,
        duringSeek: video.seeking,
        droppedFrames: quality?.droppedVideoFrames ?? 0,
        presentedFrames: presented.presentedFrames,
        decodedFrames: quality?.totalVideoFrames,
        paused: video.paused,
        playbackRate: video.playbackRate,
      },
    });
  };
  clockSubscription?.stop();
  clockSubscription = onVideoFrames(video, onFrame, { phase: 'clock', label: 'frame clock' });
}

function logNewRate(before: ClockState, after: ClockState): void {
  const rate = measuredRate(after);
  if (rate == null || rate === measuredRate(before)) return;
  const reads = [before.readCheck, after.readCheck].flatMap((read) =>
    typeof read === 'object' && read != null ? [Math.round(read.duration * 1e6)] : []
  );
  const origin =
    after.publishedRate != null ? 'playback' : `frames read at seeks (${reads.join(', ')} µs)`;
  console.log(`[yt_clipper] Frame rate ${rate} fps, measured from ${origin}.`);
}

/** What the clock knows of the frame on screen. Its time is on the platform's timeline, as the
 *  playhead (getCurrentTime) is, and null until the video presents a frame. */
export function getFrameOnScreen(video: VideoElement): FrameOnScreen {
  if (clockVideo !== video) startClock(video);
  const { onScreen } = clock;
  return {
    // A platform that plays a video in parts (afreecatv) times its timeline from the first part's
    // start, and each part's media time from its own.
    // eslint-disable-next-line no-restricted-syntax -- the frame clock owns the frame on screen
    mediaTime: onScreen && onScreen.mediaTime + (video.getCurrentTime() - video.currentTime),
    isRead: onScreen?.isRead ?? false,
    isCurrent: isFrameCurrent(clock),
  };
}

/** The frame the video holds now, or null where it can't be read or the read is implausible: its
 *  time on the platform's timeline, and its duration (s) where the browser reports it. Frame
 *  callbacks can report a frame a refresh after it shows. */
export function getHeldFrame(
  video: VideoElement
): { time: number; duration: number | null } | null {
  const frame = readHeldFrame(video);
  if (frame == null || !isHeldFrameNear(frame.time, video.currentTime)) return null;
  return {
    // eslint-disable-next-line no-restricted-syntax -- the offset between the two timelines
    time: frame.time + (video.getCurrentTime() - video.currentTime),
    duration: frame.duration,
  };
}

/** The frame the video holds, on its own timeline, or null where it can't be read: no WebCodecs, or
 *  a cross-origin video that isn't CORS-clean (the constructor throws). Firefox reads it as time 0
 *  with no duration, which the clock rejects. */
export function readHeldFrame(
  video: VideoElement
): { time: number; duration: number | null } | null {
  if (typeof VideoFrame !== 'function') return null;
  try {
    const frame = new VideoFrame(video);
    const time = frame.timestamp / 1e6;
    const duration = frame.duration == null ? null : frame.duration / 1e6;
    frame.close();
    return { time, duration };
  } catch {
    return null;
  }
}

/** The frame rate measured from presented frames once a run of them confirms it (snapped to the
 *  nearest standard rate when close to one), else from the frames read at seeks, else null. */
export function getMeasuredFrameRate(video: VideoElement): number | null {
  if (clockVideo !== video) startClock(video);
  return measuredRate(clock);
}

/** Whether to announce `rate`: the first time it is the rate in use for the video's current source. */
export function isNewMeasuredFrameRate(video: VideoElement, rate: number): boolean {
  if (clockVideo !== video) startClock(video);
  const announced = announceRate(clock, rate);
  clock = announced.state;
  return announced.isNew;
}
