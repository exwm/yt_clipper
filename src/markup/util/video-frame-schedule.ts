/**
 * When the video frame loop takes a video frame and passes it on: a pure function from the loop's
 * state and an event to its next state and the actions the shell carries out
 * (`video-frame-loop.ts`).
 *
 * Under 'everyRefresh' a playing video's frame is taken on every screen refresh, and passed on when
 * it is new: a fixed cost of one VideoFrame per refresh, with nothing to estimate. A paused video's
 * frame changes only with a seek or frame step, which the frame callback or `seeked` reports, so a
 * paused loop takes nothing until one of those wakes it. Under 'frameCallback' the frame callback
 * passes on each frame it reports.
 */

export type VideoFrameLoopTiming = 'everyRefresh' | 'frameCallback';

export interface FrameScheduleState {
  timing: VideoFrameLoopTiming;
  // The last frame passed on (media time, s).
  lastDispatchedTime: number | null;
  // A seek started since the last frame callback.
  isSeekUnpresented: boolean;
  // The first frame the frame callback reported after a seek started, to pass on even when it is the
  // last one passed on: a seek within one frame presents it again, and the frame clock must see it
  // after the seek. Armed by the callback, not 'seeked', which can come before the seek's frame.
  redispatchTime: number | null;
  // The next refresh should take a frame even while paused: a seek or new frame was reported, a
  // frame could not be taken yet, or the loop (re)started.
  woken: boolean;
  // Whether the first VideoFrame's timestamp was checked against the video's time, and found on
  // another timeline. Once it is, the loop stays on the frame callback until the source changes.
  timestampsChecked: boolean;
  timestampsDisagree: boolean;
}

export type FrameScheduleEvent =
  | { type: 'refresh'; paused: boolean; seeking: boolean }
  // A VideoFrame taken for a 'takeFrame' action, and the video's time then.
  | { type: 'frameTaken'; frameTime: number; videoTime: number }
  // A 'takeFrame' action found no decoded frame to take.
  | { type: 'frameUnavailable' }
  | { type: 'frameCallback'; mediaTime: number; presentedFrames: number }
  | { type: 'seeking' }
  | { type: 'seeked' }
  // The video loaded a new source (`emptied`): its frames and timeline start over.
  | { type: 'sourceChanged' };

export type FrameScheduleAction =
  | { type: 'takeFrame' }
  // Pass the frame at `mediaTime` to the consumers: the VideoFrame just taken, or the video itself.
  | { type: 'dispatch'; mediaTime: number; image: 'videoFrame' | 'video'; presentedFrames?: number }
  // The VideoFrame timestamps are on another timeline than the video's time.
  | { type: 'fallBackToFrameCallback'; offsetSeconds: number };

export interface FrameScheduleStep {
  state: FrameScheduleState;
  actions: FrameScheduleAction[];
}

// A VideoFrame timestamp this far from the video's time is on another timeline (a site that offsets
// its timestamps), so the crop would be computed for the wrong time.
export const MAX_TIMESTAMP_DISAGREEMENT_S = 1;

export function initialFrameSchedule(timing: VideoFrameLoopTiming): FrameScheduleState {
  return {
    timing,
    lastDispatchedTime: null,
    isSeekUnpresented: false,
    redispatchTime: null,
    woken: true,
    timestampsChecked: false,
    timestampsDisagree: false,
  };
}

/** The same loop under another timing. It keeps the last frame passed on, and takes the frame on
 *  screen at the next refresh, so a loop restarted while paused still draws it. */
export function retimeFrameSchedule(
  state: FrameScheduleState,
  timing: VideoFrameLoopTiming
): FrameScheduleState {
  return { ...state, timing, woken: true };
}

export function stepFrameSchedule(
  state: FrameScheduleState,
  event: FrameScheduleEvent
): FrameScheduleStep {
  switch (event.type) {
    case 'refresh': {
      if (state.timing !== 'everyRefresh') return { state, actions: [] };
      const take = !event.paused || event.seeking || state.woken;
      return {
        state: { ...state, woken: false },
        actions: take ? [{ type: 'takeFrame' }] : [],
      };
    }
    case 'frameTaken': {
      if (state.timing !== 'everyRefresh') return { state, actions: [] };
      const isRepeat = event.frameTime === state.lastDispatchedTime;
      if (isRepeat && event.frameTime !== state.redispatchTime) return { state, actions: [] };
      if (!state.timestampsChecked) {
        const offsetSeconds = event.frameTime - event.videoTime;
        if (Math.abs(offsetSeconds) > MAX_TIMESTAMP_DISAGREEMENT_S) {
          return {
            state: {
              ...state,
              timing: 'frameCallback',
              timestampsChecked: true,
              timestampsDisagree: true,
            },
            actions: [{ type: 'fallBackToFrameCallback', offsetSeconds }],
          };
        }
      }
      return {
        state: {
          ...state,
          lastDispatchedTime: event.frameTime,
          redispatchTime: null,
          timestampsChecked: true,
        },
        actions: [{ type: 'dispatch', mediaTime: event.frameTime, image: 'videoFrame' }],
      };
    }
    case 'frameUnavailable':
      // Try again at the next refresh, so a paused seek's frame is not lost.
      return { state: { ...state, woken: true }, actions: [] };
    case 'frameCallback': {
      if (state.timing !== 'frameCallback')
        return {
          state: {
            ...state,
            woken: true,
            isSeekUnpresented: false,
            redispatchTime: state.isSeekUnpresented ? event.mediaTime : state.redispatchTime,
          },
          actions: [],
        };
      return {
        state: { ...state, lastDispatchedTime: event.mediaTime },
        actions: [
          {
            type: 'dispatch',
            mediaTime: event.mediaTime,
            image: 'video',
            presentedFrames: event.presentedFrames,
          },
        ],
      };
    }
    case 'seeking':
      return { state: { ...state, isSeekUnpresented: true }, actions: [] };
    case 'seeked':
      return { state: { ...state, woken: true }, actions: [] };
    case 'sourceChanged':
      return { state: { ...initialFrameSchedule(state.timing) }, actions: [] };
  }
}
