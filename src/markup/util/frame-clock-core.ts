/**
 * The frame clock's decisions, as pure functions over one state value: which frame is on screen,
 * which played frames measure the frame rate, and which rate is published. `presented-frame-clock.ts`
 * feeds it the video's events and keeps the state.
 */

// Read once: jest runs modules in a vm context, where each global Math lookup in the per-frame
// measure is slow.
const Math = globalThis.Math;

// Frames played in a row that confirm a rate. With frame times rounded to the millisecond (YouTube,
// WebM) 60 frames tell an NTSC rate from its neighbor: they span a whole number of milliseconds, so
// both ends round alike. With exact frame times (MP4, HLS) 8 frames do.
export const FRAMES_TO_CONFIRM_ROUNDED = 60;
export const FRAMES_TO_CONFIRM_EXACT = 8;
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
// A published rate that snaps to no standard rate changes only for a measurement further off than
// this, so it doesn't drift with each run. Standard rates replace each other on any difference: a
// confirmed run tells them apart.
const PUBLISHED_RATE_HYSTERESIS = 0.002;
// A run's gaps stay this close to its mean frame duration: mediaTime rounded to the millisecond errs
// by up to 1 ms per gap, and the mean by 1 ms over the run, plus a margin. Video captured at a varying
// rate (a phone's) jitters by a few percent. Rates under 1.5x apart (25 and 30) then never share a run.
const RUN_ROUNDING_SECONDS = 0.001;
const RUN_MARGIN_SECONDS = 0.0005;
const RUN_JITTER_SHARE = 0.02;

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
  // Seeks finished (`seeked`), and the frame on screen with how many seeks had started and finished
  // when it was presented or read. A frame presented while a seek is in flight can be the frame of
  // the seek before it (Chrome, YouTube), so it is the playhead's frame only once a seek finishes
  // after it, and no seek has started since.
  settleCount: number;
  // `isRead`: read at `seeked` (new VideoFrame), which a later paused frame can't replace.
  onScreen: { mediaTime: number; seeks: number; settle: number; isRead: boolean } | null;
  // The gaps between the last frames played in a row. A seek, a pause or a dropped frame ends a run.
  // The rate is measured on one run only: within a run the gaps add up to its last time minus its
  // first, so millisecond rounding errs by about 1 ms in total, while each extra run would add
  // another and blur 29.97 into 30.
  currentRun: readonly RunGap[];
  // The rate a run long enough to confirm it measured, or null until one has.
  publishedRate: number | null;
  // The rates announced for the current source, so each is announced once.
  announcedRates: readonly number[];
  // The rate two frames read at seeks agree on, and the last read awaiting a read of another frame,
  // or 'mixed' once two disagreed (a variable rate), until a new source.
  readRate: number | null;
  readCheck: { rate: number; frameTime: number; duration: number } | 'mixed' | null;
}

export type ClockEvent =
  | { type: 'frame'; frame: ClockFrame }
  | { type: 'seeking' }
  // A seek finished. `heldFrameTime` is the frame the video holds then (`new VideoFrame(video)`), or
  // null where the browser can't read it, and `heldFrameDuration` its duration (s) where the browser
  // reports one. `seeking`: another seek already started.
  | {
      type: 'seeked';
      heldFrameTime: number | null;
      heldFrameDuration: number | null;
      currentTime: number;
      seeking: boolean;
    }
  // A new rendition, which can have a new frame rate.
  | { type: 'resize' }
  // A new source.
  | { type: 'emptied' };

export const initialClock: ClockState = {
  lastFrame: null,
  seekCount: 0,
  settleCount: 0,
  onScreen: null,
  currentRun: [],
  publishedRate: null,
  announcedRates: [],
  readRate: null,
  readCheck: null,
};

export function stepClock(state: ClockState, event: ClockEvent): ClockState {
  switch (event.type) {
    case 'seeking':
      return { ...state, seekCount: state.seekCount + 1 };
    case 'seeked': {
      const settleCount = state.settleCount + 1;
      const held = heldFrameRead(event);
      if (held == null) return { ...state, settleCount };
      const onScreen = {
        mediaTime: held,
        seeks: state.seekCount,
        settle: settleCount,
        isRead: true,
      };
      const duration = event.heldFrameDuration ?? NaN;
      const rate = rateOfDuration(duration);
      const read = rate == null ? null : checkRead(state, { rate, frameTime: held, duration });
      return { ...state, settleCount, onScreen, ...read };
    }
    case 'emptied':
      return { ...initialClock, seekCount: state.seekCount, settleCount: state.settleCount };
    case 'resize':
      // The rate stays published until a run confirms a new one, so a quality switch doesn't flip
      // 29.97 back to the platform's 30.
      return {
        ...state,
        currentRun: [],
        readCheck: state.readCheck === 'mixed' ? 'mixed' : null,
      };
    case 'frame':
      return {
        ...stepFrame(state, { ...event.frame, seekCount: state.seekCount }),
        onScreen: keepsReadFrame(state, event.frame)
          ? state.onScreen
          : {
              mediaTime: event.frame.mediaTime,
              seeks: state.seekCount,
              settle: state.settleCount,
              isRead: false,
            },
      };
  }
}

/** Whether the frame on screen is the playhead's: presented, or read, after the last seek finished,
 *  with no seek started since. */
export function isFrameCurrent(state: ClockState): boolean {
  const { onScreen } = state;
  return onScreen?.seeks === state.seekCount && onScreen.settle === state.settleCount;
}

// A paused video shows a new frame only after a seek, so while paused the frame read at the last
// `seeked` stands until the next seek: a frame presented after it is the same frame, or a late frame
// of an earlier seek. Recorded seeks show late frames after the next `seeking`; this keeps one that
// comes after the next `seeked` from replacing the read.
function keepsReadFrame(state: ClockState, frame: ClockFrame): boolean {
  return frame.paused && state.onScreen?.isRead === true && isFrameCurrent(state);
}

// The frame read at `seeked`, when it can be the frame there: a frame after the playhead is on
// another timeline; a seek already in flight moves on.
function heldFrameRead(event: {
  heldFrameTime: number | null;
  currentTime: number;
  seeking: boolean;
}): number | null {
  const { heldFrameTime: held, currentTime, seeking } = event;
  const isFrameThere =
    !seeking && held != null && isHeldFrameNear(held, currentTime) && held <= currentTime + 0.001;
  return isFrameThere ? held : null;
}

// The standard rate whose frame lasts `duration` (s) within 2 µs, as exact or truncated microseconds
// do. Durations rounded to the millisecond (webm, some YouTube videos) match only 25 and 50 fps.
const READ_DURATION_TOLERANCE = 0.000002;
const rateOfDuration = (duration: number): number | null =>
  STANDARD_FRAME_RATES.find((rate) => Math.abs(1 / rate - duration) <= READ_DURATION_TOLERANCE) ??
  null;

// Two reads of other frames that agree set the rate; a read of the same frame waits for another.
function checkRead(
  state: ClockState,
  read: { rate: number; frameTime: number; duration: number }
): Pick<ClockState, 'readRate' | 'readCheck'> {
  const { readRate, readCheck } = state;
  if (readCheck === 'mixed') return { readRate, readCheck };
  if (readCheck == null) return { readRate, readCheck: read };
  if (readCheck.rate !== read.rate) return { readRate: null, readCheck: 'mixed' };
  if (Math.abs(read.frameTime - readCheck.frameTime) < 0.5 / read.rate)
    return { readRate, readCheck };
  return { readRate: read.rate, readCheck: read };
}

/** Whether a frame read at `held` (s) can be the frame at `currentTime`. Firefox reads every frame as
 *  about 0 (5 µs). Playing, the frame on screen can be a refresh or more ahead of the playhead. */
export function isHeldFrameNear(held: number, currentTime: number): boolean {
  return (held >= 0.001 || currentTime <= 0.001) && Math.abs(currentTime - held) < 0.5;
}

function stepFrame(state: ClockState, frame: SeenFrame): ClockState {
  const { lastFrame } = state;
  const presented = lastFrame ? framesBetween(lastFrame, frame) : 0;
  const frames =
    lastFrame && presented > 0 && frame.droppedFrames > lastFrame.droppedFrames
      ? framesWithDrops(
          state.currentRun,
          frame.mediaTime - lastFrame.mediaTime,
          presented,
          frame.droppedFrames - lastFrame.droppedFrames
        )
      : presented;
  const endRun = (): ClockState => ({ ...state, lastFrame: frame, currentRun: [] });
  // A run can start on a gap of several frames, as the presented count tells them: Firefox calls back
  // about 25 times a second, so at 50 or 60 fps every gap spans 2 or 3 frames. A browser that counts
  // more than one presented frame per video frame measures nothing: its decoded count disagrees.
  if (!lastFrame || frames === 0) {
    return endRun();
  }
  const gap = {
    duration: frame.mediaTime - lastFrame.mediaTime,
    frames,
    decoded:
      frame.decodedFrames != null && lastFrame.decodedFrames != null
        ? frame.decodedFrames - lastFrame.decodedFrames
        : null,
  };
  // A gap off the run's mean frame duration ends the run and stays in none: a refresh the page missed
  // (the every-refresh loop counts no frames), a frame the source lacks, a gap no seek announced, a
  // frame count that doesn't match its gap, or the first frame of a new rate, which the next gap
  // starts a run for. Two standard rates 1.5x apart or less (25 and 30) never mix in one run, and a
  // run's gaps add up to its last time minus its first, which the NTSC span needs.
  if (state.currentRun.length > 0 && !continuesRun(state.currentRun, gap)) return endRun();
  const currentRun = [...state.currentRun, gap].slice(-MAX_RUN_GAPS);
  const measurement = confirmingSpan(currentRun);
  let { publishedRate } = state;
  if (measurement != null && allFramesShown(measurement.span)) {
    const rate = measureFrameRate(measurement.span);
    if (replacesPublished(publishedRate, rate, measurement.isPrecise)) publishedRate = rate;
  }
  return { ...state, lastFrame: frame, currentRun, publishedRate };
}

// The part of the run that confirms a rate, if any, and whether it tells NTSC rates apart. Exact,
// steady frame times (MP4, HLS) do in 8 frames. Millisecond times (YouTube, WebM) do over a whole
// multiple of 60 frames. Exact times that jitter (a phone's capture) need 60 frames and still can't.
function confirmingSpan(
  run: readonly RunGap[]
): { span: readonly RunGap[]; isPrecise: boolean } | null {
  if (!run.some(isExactGap)) {
    const span = ntscSpan(run);
    return span && { span, isPrecise: true };
  }
  const isSteady = isSteadyRun(run);
  const needed = isSteady ? FRAMES_TO_CONFIRM_EXACT : FRAMES_TO_CONFIRM_ROUNDED;
  return runFrames(run) >= needed ? { span: run, isPrecise: isSteady } : null;
}

const isExactGap = (gap: RunGap) =>
  Math.abs(gap.duration * 1000 - Math.round(gap.duration * 1000)) > 0.001;

// Steady enough to tell an NTSC rate from its neighbor (0.1% apart, 33 µs a frame at 30 fps).
const STEADY_GAP_SECONDS = 0.00005;
function isSteadyRun(run: readonly RunGap[]): boolean {
  const mean = run.reduce((sum, gap) => sum + gap.duration, 0) / runFrames(run);
  return run.every((gap) => Math.abs(gap.duration - gap.frames * mean) <= STEADY_GAP_SECONDS);
}

// A precise measurement replaces a published standard rate on any difference, so a splice between
// NTSC neighbors is taken. Otherwise the rate changes only past the hysteresis, so it doesn't drift.
function replacesPublished(published: number | null, rate: number, isPrecise: boolean): boolean {
  if (published == null) return true;
  const isStandard =
    STANDARD_FRAME_RATES.includes(published) || STANDARD_FRAME_RATES.includes(rate);
  if (isPrecise && isStandard) return rate !== published;
  return Math.abs(rate - published) > published * PUBLISHED_RATE_HYSTERESIS;
}

function continuesRun(run: readonly RunGap[], gap: RunGap): boolean {
  const frames = runFrames(run);
  const meanDuration = run.reduce((sum, previous) => sum + previous.duration, 0) / frames;
  const expected = gap.frames * meanDuration;
  const tolerance = Math.max(
    RUN_ROUNDING_SECONDS + (gap.frames * RUN_ROUNDING_SECONDS) / frames + RUN_MARGIN_SECONDS,
    RUN_JITTER_SHARE * expected
  );
  return Math.abs(gap.duration - expected) <= tolerance;
}

// How many frames were presented from `previous` to `frame` (more than 1 when frame callbacks were
// skipped), or 0 when the gap doesn't measure the frame rate: across a seek, while paused, or faster
// than normal speed. Dropped frames are left out of the count (framesWithDrops).
function framesBetween(previous: SeenFrame, frame: SeenFrame): number {
  const measures =
    !frame.paused &&
    frame.playbackRate <= 1 &&
    previous.seekCount === frame.seekCount &&
    !previous.duringSeek &&
    !frame.duringSeek &&
    frame.mediaTime > previous.mediaTime;
  if (!measures) return 0;
  if (previous.presentedFrames == null || frame.presentedFrames == null) return 1;
  return Math.max(0, frame.presentedFrames - previous.presentedFrames);
}

// How many frames a gap with dropped frames spans: its duration in the run's frames, when the
// browser's dropped count explains the frames the presented count left out. Else 0, which ends the
// run: a run shorter than 8 frames has no frame duration to count by yet, and a dropped count the
// browser reports a gap late doesn't match. A machine that drops a frame every second or two then still
// completes the 60 frames millisecond times need; `allFramesShown` still checks the span, whose
// decoded count includes the dropped frames.
function framesWithDrops(
  run: readonly RunGap[],
  duration: number,
  presented: number,
  dropped: number
): number {
  // A run must first set its frame duration on frames with no drops: a browser that leaves dropped
  // frames out of its decoded count and reports them a callback late would otherwise keep a run going
  // whose first gap spans two frames, at half the rate.
  if (runFrames(run) < FRAMES_TO_CONFIRM_EXACT) return 0;
  const frames = Math.round(
    duration / (run.reduce((sum, gap) => sum + gap.duration, 0) / runFrames(run))
  );
  return frames >= presented && frames <= presented + dropped ? frames : 0;
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

const runFrames = (run: readonly RunGap[]) => run.reduce((sum, gap) => sum + gap.frames, 0);

// Only a whole multiple of 60 frames spans a whole number of milliseconds at an NTSC rate, so that
// its rounded ends err alike: the run's newest gaps that span the most such frames. Null when the run
// is shorter, or a gap of several frames straddles every multiple; the next frame shifts where the
// multiples fall.
function ntscSpan(run: readonly RunGap[]): readonly RunGap[] | null {
  let frames = 0;
  let longest: number | null = null;
  for (let i = run.length - 1; i >= 0; i--) {
    frames += run[i].frames;
    if (frames % FRAMES_TO_CONFIRM_ROUNDED === 0) longest = i;
  }
  return longest == null ? null : run.slice(longest);
}

/** The rate a played run confirmed, else the one frames read at seeks agree on. */
export const measuredRate = (state: ClockState): number | null =>
  state.publishedRate ?? state.readRate;

/** Whether to announce `rate`: the first time it is the rate in use for the current source. */
export function announceRate(
  state: ClockState,
  rate: number
): { state: ClockState; isNew: boolean } {
  if (state.announcedRates.includes(rate)) return { state, isNew: false };
  return { state: { ...state, announcedRates: [...state.announcedRates, rate] }, isNew: true };
}

// A run holds no outlier to filter: each gap is close to the run's mean frame duration, and knows how
// many frames it spans.
function measureFrameRate(run: readonly RunGap[]): number {
  const fps = runFrames(run) / run.reduce((sum, gap) => sum + gap.duration, 0);
  const nearest = STANDARD_FRAME_RATES.reduce((best, rate) =>
    Math.abs(fps - rate) < Math.abs(fps - best) ? rate : best
  );
  if (Math.abs(fps - nearest) <= nearest * STANDARD_FRAME_RATE_TOLERANCE) return nearest;
  // A rate no standard one matches is rounded, so it doesn't drift with each new duration.
  return Math.round(fps * 10) / 10;
}
