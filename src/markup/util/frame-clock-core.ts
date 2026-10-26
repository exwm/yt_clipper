/**
 * The frame clock's decisions, as pure functions over one state value: which frame is on screen,
 * which played frames measure the frame rate, and which rate is published. `presented-frame-clock.ts`
 * feeds it the video's events and keeps the state.
 */

// Read once: jest runs modules in a vm context, where each global Math lookup in the per-frame
// measure is slow.
const Math = globalThis.Math;

// Played frames needed before trusting the measured frame rate. YouTube rounds mediaTime to the
// millisecond: 8 frames separate 24, 25, 30, 50 and 60 fps. 60 frames separate an NTSC rate from its
// neighbor: they span a whole number of milliseconds, so both ends round alike.
export const FRAMES_TO_TELL_STANDARD_RATES = 8;
export const FRAMES_TO_TELL_NTSC_RATES = 60;
const MAX_FRAME_DURATIONS = 120;
export const STANDARD_FRAME_RATES = [
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
// A run keeps durations within this ratio of each other. Between the 1 ms rounding of mediaTime
// (17 ms after 16 ms at 60 fps) and the 2x of a missed frame.
const RUN_DURATION_RATIO = 1.5;

/** A frame the video presented, with the video's state at that moment. */
export interface ClockFrame {
  mediaTime: number;
  duringSeek: boolean;
  droppedFrames: number;
  // Counts every frame presented, so a jump of more than 1 means a frame callback was missed.
  presentedFrames: number | undefined;
  paused: boolean;
  playbackRate: number;
}

interface SeenFrame extends ClockFrame {
  // Seeks started before this frame, so a duration across a seek is never measured.
  seekCount: number;
}

export interface ClockState {
  lastFrame: SeenFrame | null;
  seekCount: number;
  // Durations of the last frames played in a row. A seek, a pause or a dropped frame ends a run. The
  // rate is measured on one run only: within a run the durations add up to its last time minus its
  // first, so millisecond rounding errs by about 1 ms in total, while each extra run would add
  // another and blur 29.97 into 30. A newer run replaces the measured one once it is as long, or long
  // enough to tell NTSC rates, so a rate change mid-stream is measured again.
  currentRun: readonly number[];
  measuredRun: readonly number[];
  // The rate `measuredRun` measures, or null when it is empty.
  measuredFps: number | null;
  publishedRate: number | null;
}

export type ClockEvent =
  | { type: 'frame'; frame: ClockFrame }
  | { type: 'seeking' }
  // A new rendition, which can have a new frame rate.
  | { type: 'resize' }
  // A new source.
  | { type: 'emptied' };

export const initialClock: ClockState = {
  lastFrame: null,
  seekCount: 0,
  currentRun: [],
  measuredRun: [],
  measuredFps: null,
  publishedRate: null,
};

export function stepClock(state: ClockState, event: ClockEvent): ClockState {
  switch (event.type) {
    case 'seeking':
      return { ...state, seekCount: state.seekCount + 1 };
    case 'emptied':
      return { ...initialClock, seekCount: state.seekCount };
    case 'resize':
      // The last rate stays published until a new run measures one, so a quality switch doesn't flip
      // 29.97 back to the platform's 30. It is published when asked for, which may not have
      // happened since these frames played.
      return {
        ...publishRate(state, FRAMES_TO_TELL_NTSC_RATES).state,
        currentRun: [],
        measuredRun: [],
        measuredFps: null,
      };
    case 'frame':
      return stepFrame(state, { ...event.frame, seekCount: state.seekCount });
  }
}

function stepFrame(state: ClockState, frame: SeenFrame): ClockState {
  const { lastFrame } = state;
  if (!lastFrame || !isFrameDuration(lastFrame, frame)) {
    return { ...state, lastFrame: frame, currentRun: [] };
  }
  const duration = frame.mediaTime - lastFrame.mediaTime;
  // A duration off the run's by more than the ratio ends the run and stays in none: a refresh the
  // page missed (the every-refresh loop counts no frames), a frame the source lacks, a gap no seek
  // announced, or the first frame of a new rate, which the next duration starts a run for. Two rates
  // never mix in one run, and a run's durations add up to its last time minus its first, which the
  // NTSC span needs.
  const previousDuration = state.currentRun[state.currentRun.length - 1];
  if (
    previousDuration != null &&
    (duration > previousDuration * RUN_DURATION_RATIO ||
      duration * RUN_DURATION_RATIO < previousDuration)
  ) {
    return { ...state, lastFrame: frame, currentRun: [] };
  }
  const currentRun = [...state.currentRun, duration].slice(-MAX_FRAME_DURATIONS);
  const replacesMeasured =
    currentRun.length >= Math.min(state.measuredRun.length, FRAMES_TO_TELL_NTSC_RATES);
  return {
    ...state,
    lastFrame: frame,
    currentRun,
    ...(replacesMeasured && {
      measuredRun: currentRun,
      measuredFps: measureFrameRate(ntscSpan(currentRun)),
    }),
  };
}

// Only a duration between two frames played in a row at normal speed or slower measures the frame
// rate: not across a seek, not while paused, and not with frames dropped in between.
function isFrameDuration(previous: SeenFrame, frame: SeenFrame): boolean {
  return (
    !frame.paused &&
    frame.playbackRate <= 1 &&
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

// Only a whole multiple of 60 durations spans a whole number of milliseconds at an NTSC rate, so
// that its rounded ends err alike.
function ntscSpan(run: readonly number[]): readonly number[] {
  const span = run.length - (run.length % FRAMES_TO_TELL_NTSC_RATES) || run.length;
  return run.slice(-span);
}

/** The rate to report once `minFrames` frames have played in a row, else the last published one.
 *  A published rate changes only past the hysteresis. */
export function publishRate(
  state: ClockState,
  minFrames: number
): { state: ClockState; rate: number | null } {
  const { measuredFps, publishedRate } = state;
  if (state.measuredRun.length < minFrames || measuredFps == null) {
    return { state, rate: publishedRate };
  }
  if (
    publishedRate != null &&
    Math.abs(measuredFps - publishedRate) <= publishedRate * PUBLISHED_RATE_HYSTERESIS
  ) {
    return { state, rate: publishedRate };
  }
  return { state: { ...state, publishedRate: measuredFps }, rate: measuredFps };
}

// A run holds no outlier to filter: each duration is within RUN_DURATION_RATIO of the one before.
function measureFrameRate(durations: readonly number[]): number {
  const frameDuration = [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)];
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
