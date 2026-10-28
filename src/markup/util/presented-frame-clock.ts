import type { VideoElement } from '../appState';
import {
  announceRate,
  ClockEvent,
  ClockState,
  initialClock,
  isFrameCurrent,
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
    if (clockVideo === video) clock = stepClock(clock, event);
  };
  video.addEventListener('emptied', () => step({ type: 'emptied' }));
  video.addEventListener('resize', () => step({ type: 'resize' }));
  video.addEventListener('seeking', () => step({ type: 'seeking' }));
  video.addEventListener('seeked', () =>
    step({
      type: 'seeked',
      heldFrameTime: heldFrameTime(video),
      // The held frame's timeline (a part's, on afreecatv), not the platform's.
      currentTime: video.currentTime,
      seeking: video.seeking,
    })
  );
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

/** The time of the frame on screen on the platform's timeline, or the playhead until the video
 *  presents a frame. */
export function getPresentedFrameTime(video: VideoElement): number {
  if (clockVideo !== video) startClock(video);
  const { onScreen } = clock;
  // eslint-disable-next-line no-restricted-syntax -- the frame clock owns the frame on screen
  if (onScreen == null) return video.getCurrentTime();
  // A platform that plays a video in parts (afreecatv) times its timeline from the first part's start,
  // and each part's media time from its own.
  // eslint-disable-next-line no-restricted-syntax -- the frame clock owns the frame on screen
  return onScreen.mediaTime + (video.getCurrentTime() - video.currentTime);
}

/** What the clock knows of the frame on screen, its time on the platform's timeline. */
export function getFrameOnScreen(video: VideoElement): FrameOnScreen {
  if (clockVideo !== video) startClock(video);
  const { onScreen } = clock;
  return {
    // eslint-disable-next-line no-restricted-syntax -- the frame clock owns the frame on screen
    mediaTime: onScreen == null ? null : getPresentedFrameTime(video),
    isRead: onScreen?.isRead ?? false,
    isCurrent: isFrameCurrent(clock),
  };
}

/** Whether the frame on screen is the playhead's frame: presented, or read, after the last seek finished. */
export function isPresentedSinceSeek(video: VideoElement): boolean {
  if (clockVideo !== video) startClock(video);
  return isFrameCurrent(clock);
}

// The time of the frame the video holds, or null where it can't be read: no WebCodecs, or a
// cross-origin video that isn't CORS-clean (the constructor throws). Firefox reads it as time 0,
// which the clock rejects.
function heldFrameTime(video: VideoElement): number | null {
  if (typeof VideoFrame !== 'function') return null;
  try {
    const frame = new VideoFrame(video);
    const time = frame.timestamp / 1e6;
    frame.close();
    return time;
  } catch {
    return null;
  }
}

/** The frame rate measured from presented frames once a run of them confirms it (snapped to the
 *  nearest standard rate when close to one), else null. */
export function getMeasuredFrameRate(video: VideoElement): number | null {
  if (clockVideo !== video) startClock(video);
  return clock.publishedRate;
}

/** Whether to announce `rate`: the first time it is the rate in use for the video's current source. */
export function isNewMeasuredFrameRate(video: VideoElement, rate: number): boolean {
  if (clockVideo !== video) startClock(video);
  const announced = announceRate(clock, rate);
  clock = announced.state;
  return announced.isNew;
}
