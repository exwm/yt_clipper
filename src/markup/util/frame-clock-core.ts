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
const MAX_RUN_GAPS = 120;
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
// Rates measured in quick succession, as on a video spliced from parts at different rates, are
// announced at most this often.
const ANNOUNCE_INTERVAL_MS = 5000;

/** A frame the video presented, with the video's state at that moment. */
export interface ClockFrame {
  mediaTime: number;
  duringSeek: boolean;
  droppedFrames: number;
  // Counts every frame presented, so a jump of more than 1 means a frame callback was missed.
  presentedFrames: number | undefined;
  // Counts every frame decoded, shown or not (totalVideoFrames).
  decodedFrames: number | undefined;
  paused: boolean;
  playbackRate: number;
}

interface SeenFrame extends ClockFrame {
  // Seeks started before this frame, so a duration across a seek is never measured.
  seekCount: number;
}

// The time between two frames the clock saw, and how many frames it spans: more than 1 when frame
// callbacks were skipped, which the presented frame count tells. `decoded` is how many frames were
// decoded meanwhile, or null when the browser doesn't count them.
interface RunGap {
  duration: number;
  frames: number;
  decoded: number | null;
}

export interface ClockState {
  lastFrame: SeenFrame | null;
  seekCount: number;
  // The gaps between the last frames played in a row. A seek, a pause or a dropped frame ends a run.
  // The rate is measured on one run only: within a run the gaps add up to its last time minus its
  // first, so millisecond rounding errs by about 1 ms in total, while each extra run would add
  // another and blur 29.97 into 30. A newer run replaces the measured one once it is as long, or long
  // enough to tell NTSC rates, so a rate change mid-stream is measured again.
  currentRun: readonly RunGap[];
  measuredRun: readonly RunGap[];
  // The rate `measuredRun` measures, or null when it is empty.
  measuredFps: number | null;
  publishedRate: number | null;
  // The last rate `announceRate` took and when (ms), so each new one is announced once per source,
  // at most once per ANNOUNCE_INTERVAL_MS.
  announcedRate: number | null;
  announcedAt: number | null;
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
  announcedRate: null,
  announcedAt: null,
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
  const frames = lastFrame ? framesBetween(lastFrame, frame) : 0;
  // A run starts with a one-frame gap, which sets the frame duration the ratio checks the gaps of
  // several frames against. A browser that counted more than one presented frame per video frame
  // then measures nothing instead of a multiple of the rate.
  if (!lastFrame || frames === 0 || (frames > 1 && state.currentRun.length === 0)) {
    return { ...state, lastFrame: frame, currentRun: [] };
  }
  const gap = {
    duration: frame.mediaTime - lastFrame.mediaTime,
    frames,
    decoded:
      frame.decodedFrames != null && lastFrame.decodedFrames != null
        ? frame.decodedFrames - lastFrame.decodedFrames
        : null,
  };
  // A frame duration off the run's by more than the ratio ends the run and stays in none: a refresh
  // the page missed (the every-refresh loop counts no frames), a frame the source lacks, a gap no
  // seek announced, a frame count that doesn't match its gap, or the first frame of a new rate,
  // which the next gap starts a run for. Two rates never mix in one run, and a run's gaps add up to
  // its last time minus its first, which the NTSC span needs.
  const previousGap = state.currentRun[state.currentRun.length - 1];
  if (previousGap) {
    const duration = frameDuration(gap);
    const previousDuration = frameDuration(previousGap);
    if (
      duration > previousDuration * RUN_DURATION_RATIO ||
      duration * RUN_DURATION_RATIO < previousDuration
    ) {
      return { ...state, lastFrame: frame, currentRun: [] };
    }
  }
  const currentRun = [...state.currentRun, gap].slice(-MAX_RUN_GAPS);
  const span = ntscSpan(currentRun);
  const replacesMeasured =
    span != null &&
    allFramesShown(span) &&
    runFrames(currentRun) >= Math.min(runFrames(state.measuredRun), FRAMES_TO_TELL_NTSC_RATES);
  return {
    ...state,
    lastFrame: frame,
    currentRun,
    ...(replacesMeasured && { measuredRun: currentRun, measuredFps: measureFrameRate(span) }),
  };
}

// How many frames played from `previous` to `frame` (more than 1 when frame callbacks were skipped),
// or 0 when the gap doesn't measure the frame rate: across a seek, while paused, faster than normal
// speed, or with frames dropped in between, which the presented frame count leaves out.
function framesBetween(previous: SeenFrame, frame: SeenFrame): number {
  const measures =
    !frame.paused &&
    frame.playbackRate <= 1 &&
    previous.seekCount === frame.seekCount &&
    !previous.duringSeek &&
    !frame.duringSeek &&
    previous.droppedFrames === frame.droppedFrames &&
    frame.mediaTime > previous.mediaTime;
  if (!measures) return 0;
  if (previous.presentedFrames == null || frame.presentedFrames == null) return 1;
  return Math.max(0, frame.presentedFrames - previous.presentedFrames);
}

// How far a run's decoded frame count may differ from its frame count, for the frames the decoder
// runs ahead (Chrome: about 2 over 40 frames).
const DECODED_AHEAD_FRAMES = 4;
const DECODED_AHEAD_SHARE = 0.1;

// Whether the span's frames are all the frames decoded meanwhile, give or take the few the decoder
// runs ahead. A screen slower than the video skips frames that neither count as presented nor, in
// some browsers, as dropped: a steady pattern of them would read as a fraction of the rate, which the
// duration ratio can't see. Without a decoded count the span measures nothing.
function allFramesShown(span: readonly RunGap[]): boolean {
  let decoded = 0;
  for (const gap of span) {
    if (gap.decoded == null) return false;
    decoded += gap.decoded;
  }
  const frames = runFrames(span);
  return Math.abs(decoded - frames) <= DECODED_AHEAD_FRAMES + frames * DECODED_AHEAD_SHARE;
}

const frameDuration = (gap: RunGap) => gap.duration / gap.frames;
const runFrames = (run: readonly RunGap[]) => run.reduce((sum, gap) => sum + gap.frames, 0);

// Only a whole multiple of 60 frames spans a whole number of milliseconds at an NTSC rate, so that
// its rounded ends err alike: the run's newest gaps that span the most such frames, or the whole run
// while it is shorter. Null when a gap of several frames straddles every multiple; the next frame
// shifts where the multiples fall.
function ntscSpan(run: readonly RunGap[]): readonly RunGap[] | null {
  if (runFrames(run) < FRAMES_TO_TELL_NTSC_RATES) return run;
  let frames = 0;
  let longest: number | null = null;
  for (let i = run.length - 1; i >= 0; i--) {
    frames += run[i].frames;
    if (frames % FRAMES_TO_TELL_NTSC_RATES === 0) longest = i;
  }
  return longest == null ? null : run.slice(longest);
}

/** The rate to report once `minFrames` frames have played in a row, else the last published one.
 *  A published rate changes only past the hysteresis. */
export function publishRate(
  state: ClockState,
  minFrames: number
): { state: ClockState; rate: number | null } {
  const { measuredFps, publishedRate } = state;
  if (runFrames(state.measuredRun) < minFrames || measuredFps == null) {
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

/** Whether to announce `rate` at `now` (ms): it is new since the last one announced for this source,
 *  and that one was at least ANNOUNCE_INTERVAL_MS ago. A rate held back stays new, so it is announced
 *  once the interval is up if it still holds. */
export function announceRate(
  state: ClockState,
  rate: number,
  now: number
): { state: ClockState; isNew: boolean } {
  if (rate === state.announcedRate) return { state, isNew: false };
  if (state.announcedAt != null && now - state.announcedAt < ANNOUNCE_INTERVAL_MS) {
    return { state, isNew: false };
  }
  return { state: { ...state, announcedRate: rate, announcedAt: now }, isNew: true };
}

// A run holds no outlier to filter: each frame duration is within RUN_DURATION_RATIO of the one
// before, and each gap knows how many frames it spans.
function measureFrameRate(run: readonly RunGap[]): number {
  const fps = runFrames(run) / run.reduce((sum, gap) => sum + gap.duration, 0);
  const nearest = STANDARD_FRAME_RATES.reduce((best, rate) =>
    Math.abs(fps - rate) < Math.abs(fps - best) ? rate : best
  );
  if (Math.abs(fps - nearest) <= nearest * STANDARD_FRAME_RATE_TOLERANCE) return nearest;
  // A rate no standard one matches is rounded, so it doesn't drift with each new duration.
  return Math.round(fps * 10) / 10;
}
