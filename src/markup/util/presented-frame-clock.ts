import type { VideoElement } from '../appState';
import {
  ClockEvent,
  ClockState,
  FRAMES_TO_TELL_NTSC_RATES,
  FRAMES_TO_TELL_STANDARD_RATES,
  initialClock,
  publishRate,
  stepClock,
} from './frame-clock-core';
import { onVideoFrames, PresentedVideoFrame, VideoFrameSubscription } from './video-frame-loop';

/**
 * The time of the video frame on screen, from the video frame loop's frames. The playhead
 * (getCurrentTime) moves on seeks and scrubs smaller than a frame, and between presented frames,
 * while the same frame stays on screen, so a crop drawn at the playhead drifts from the picture.
 * The clock also measures the frame duration during playback, for sites that report no frame rate.
 * The decisions are in `frame-clock-core.ts`; this module feeds it the video's events.
 */

export { FRAMES_TO_TELL_NTSC_RATES, FRAMES_TO_TELL_STANDARD_RATES };

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
  const onFrame = (presented: PresentedVideoFrame): void => {
    step({
      type: 'frame',
      frame: {
        mediaTime: presented.mediaTime,
        duringSeek: video.seeking,
        droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
        presentedFrames: presented.presentedFrames,
        paused: video.paused,
        playbackRate: video.playbackRate,
      },
    });
  };
  clockSubscription?.stop();
  clockSubscription = onVideoFrames(video, onFrame, { phase: 'update', label: 'frame clock' });
}

/** The media time of the frame on screen, or the playhead until the video presents a frame. */
export function getPresentedFrameTime(video: VideoElement): number {
  if (clockVideo !== video) startClock(video);
  return clock.lastFrame?.mediaTime ?? video.getCurrentTime();
}

/** The frame rate measured from presented frames, snapped to the nearest standard rate when close to
 *  one. Before `minFrames` frames have played in a row it is the last measured rate, or null.
 *  Averaging over the run evens out mediaTime rounded to the millisecond. */
export function getMeasuredFrameRate(
  video: VideoElement,
  minFrames = FRAMES_TO_TELL_STANDARD_RATES
): number | null {
  if (clockVideo !== video) startClock(video);
  const published = publishRate(clock, minFrames);
  clock = published.state;
  return published.rate;
}
