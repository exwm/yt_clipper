import { PLACEMENT_TOLERANCE } from './frame-grid';

/** A seek the markup made to show a frame: where it seeks, and the time of the frame it shows (a
 *  placed time such as a marker's, or a step's frame start). */
export interface FrameSeek {
  target: number;
  frameTime: number;
}

/** What the frame clock knows of the frame on screen. */
export interface FrameOnScreen {
  // Null before the video presents a frame.
  mediaTime: number | null;
  // Read at the last `seeked` (new VideoFrame), which times it at its start.
  isRead: boolean;
  // Presented or read after the last seek finished, with no seek started since.
  isCurrent: boolean;
}

/** The frame on screen as frame decisions read it. */
export interface ScreenFrame {
  // Its start, or where that is unknown, a stand-in in the playhead's frame.
  start: number;
  isStartKnown: boolean;
  // It is the playhead's frame: current, or it contains the playhead exactly.
  isPlayheads: boolean;
}

// Millisecond-rounded frame times sit up to half a millisecond off the frame's start.
const FRAME_TIME_ROUNDING = 0.0005;
// Firefox rounds currentTime to the microsecond, so a playhead on the next frame's start can read a
// hair before it.
const TIME_ROUNDING = 0.00001;

/** Whether the frame starting at `start` holds the playhead within a frame of the rate in use. A
 *  frame from before a seek never does: the markup's seeks land 1 ms or more into a frame. */
function holdsPlayhead(start: number, playhead: number, fps: number): boolean {
  return (
    start <= playhead + PLACEMENT_TOLERANCE && playhead < start + 1 / fps + FRAME_TIME_ROUNDING
  );
}

// A frame from before the last seek can look like it holds the playhead only through the tolerances,
// when a user seek lands just before its start: such a frame must contain the playhead exactly. A
// frame presented before `seeking` (YouTube) is never current, and a step's middle target is well
// inside it.
function containsPlayhead(start: number, playhead: number, fps: number): boolean {
  return start <= playhead && playhead + TIME_ROUNDING < start + 1 / fps;
}

/** The start of the playhead's frame on the grid of the rate in use. A plain floor: the playhead is
 *  exact, unlike placed times. */
function gridFrameStart(playhead: number, fps: number): number {
  return Math.floor(playhead * fps + 1e-9) / fps;
}

/**
 * The frame on screen at `playhead`. Firefox times the first frame after a seek at the seek target
 * (Gecko's DropVideoUpToSeekTarget), so a frame timed at the playhead may start earlier, unless the
 * read at `seeked` timed it, or it sits on the grid of a measured rate (millisecond-rounded frame
 * starts do). Its start is then unknown. The stand-in is its grid frame's start on a measured rate;
 * else the playhead less the placement tolerance, as in 5.48, since a grid frame of an assumed rate
 * can start in the video frame before.
 */
export function screenFrame(
  on: FrameOnScreen,
  playhead: number,
  fps: number,
  isRateExact: boolean
): ScreenFrame {
  const mediaTime = on.mediaTime ?? playhead;
  const gridOffset = Math.abs(mediaTime * fps - Math.round(mediaTime * fps));
  const isStartKnown =
    Math.abs(mediaTime - playhead) >= TIME_ROUNDING ||
    on.isRead ||
    (isRateExact && gridOffset <= FRAME_TIME_ROUNDING * fps);
  const standIn = isRateExact
    ? gridFrameStart(playhead, fps)
    : Math.max(0, playhead - PLACEMENT_TOLERANCE);
  return {
    start: isStartKnown ? mediaTime : standIn,
    isStartKnown,
    isPlayheads: on.isCurrent || containsPlayhead(mediaTime, playhead, fps),
  };
}

/** The start of a presented frame timed `mediaTime` (see `screenFrame`). */
export function presentedFrameStart(
  mediaTime: number,
  playhead: number,
  fps: number,
  isRead: boolean,
  isRateExact: boolean
): number {
  return screenFrame({ mediaTime, isRead, isCurrent: true }, playhead, fps, isRateExact).start;
}

/**
 * The time of the frame the user is on, which placements store and decisions read: the frame of the
 * playhead, presented yet or not. Right after one of the markup's frame seeks, that seek's placed
 * time. Else the start of the frame on screen, once it is the playhead's frame. Else the playhead
 * less the placement tolerance, which `frameAt` reads as the playhead's own frame on any grid. A
 * point placed on a frame and the time read there later are then the same frame start, so finding a
 * point on the frame shown needs no grid guess.
 */
export function frameTime(
  screen: ScreenFrame,
  at: {
    // Where the playhead is or is going: the seek held back, else the current time.
    playhead: number;
    isSeekInFlight: boolean;
    lastFrameSeek: FrameSeek | null;
    fps: number;
  }
): number {
  const { playhead, isSeekInFlight, lastFrameSeek, fps } = at;
  if (
    lastFrameSeek != null &&
    Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4 &&
    playhead >= lastFrameSeek.frameTime - PLACEMENT_TOLERANCE
  ) {
    return lastFrameSeek.frameTime;
  }
  if (!isSeekInFlight && screen.isPlayheads) return screen.start;
  return Math.max(0, playhead - PLACEMENT_TOLERANCE);
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away. A seek shows the
 * frame that covers its target, so a target on a frame boundary can show either neighbor; the middle
 * is half a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't
 * change the frame shown.
 *
 * A step starts from the frame on screen once it is the playhead's, its start known, and it holds
 * the playhead within a frame of the rate in use, so steps keep moving at an assumed rate above the
 * video's. Until then (a seek in flight, or its frame not presented yet) the frame on screen is an
 * earlier one: a step then continues from the last step's target, or from the playhead's frame after
 * another seek. So no order of seek events and frame presentation matters, and a rate slightly off
 * never builds up.
 */
export function frameStepTarget(
  screen: ScreenFrame,
  step: {
    // Where the playhead is or is going: the seek held back, else the current time.
    playhead: number;
    lastTarget: number | null;
    fps: number;
    // The video's duration: NaN before its metadata loads, Infinity while live.
    duration: number;
    frames: number;
  }
): number {
  const { playhead, lastTarget, fps, duration, frames } = step;
  const frameDuration = 1 / fps;
  // At the video's ends, the middle of its first or last frame, so the next step back or forward
  // starts from a frame middle too.
  const lastMiddle = Number.isFinite(duration) ? duration - frameDuration / 2 : Infinity;
  // Past the last frame's middle (at the end the video snaps to its duration), the playhead is on
  // the last frame.
  const playheadInVideo = Math.min(playhead, lastMiddle);
  const frameStart =
    screen.isPlayheads && screen.isStartKnown && holdsPlayhead(screen.start, playheadInVideo, fps)
      ? screen.start
      : lastTarget != null && Math.abs(playheadInVideo - lastTarget) < frameDuration / 4
        ? lastTarget - frameDuration / 2
        : // The playhead's grid frame, so every target is a frame middle.
          gridFrameStart(playheadInVideo, fps);
  const target = frameStart + (frames + 0.5) * frameDuration;
  return Math.min(Math.max(target, frameDuration / 2), lastMiddle);
}
