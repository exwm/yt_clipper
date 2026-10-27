import { PLACEMENT_TOLERANCE } from './frame-grid';

/** A seek the markup made to show a frame: where it seeks, and the time of the frame it shows (a
 *  placed time such as a marker's, or a step's frame start). */
export interface FrameSeek {
  target: number;
  frameTime: number;
}

// Millisecond-rounded frame times sit up to half a millisecond off the frame's start.
const FRAME_TIME_ROUNDING = 0.0005;

/** Whether the frame on screen, which starts at `presentedFrameTime`, holds the playhead. A frame from
 *  before a seek never does: the markup's seeks land 1 ms or more into a frame. */
function holdsPlayhead(presentedFrameTime: number, playhead: number, fps: number): boolean {
  return (
    presentedFrameTime <= playhead + PLACEMENT_TOLERANCE &&
    playhead < presentedFrameTime + 1 / fps + FRAME_TIME_ROUNDING
  );
}

// A frame from before the last seek can look like it holds the playhead only through the tolerances,
// when a user seek lands just before its start: such a frame must contain the playhead exactly. A
// frame presented before `seeking` (YouTube) is never current, and a step's middle target is well
// inside it.
// Firefox rounds currentTime to the microsecond, so a playhead on the next frame's start can read a
// hair before it.
const TIME_ROUNDING = 0.00001;
function containsPlayhead(presentedFrameTime: number, playhead: number, fps: number): boolean {
  return presentedFrameTime <= playhead && playhead + TIME_ROUNDING < presentedFrameTime + 1 / fps;
}

// Where seeks retime their frame (Firefox), a frame on screen that starts at the playhead, off the
// grid, may start earlier. Millisecond-rounded frame starts sit on the grid.
function mayBeRetimed(
  presentedFrameTime: number,
  playhead: number,
  fps: number,
  seekRetimesFrame: boolean
): boolean {
  const gridOffset = Math.abs(presentedFrameTime * fps - Math.round(presentedFrameTime * fps));
  return (
    seekRetimesFrame &&
    Math.abs(presentedFrameTime - playhead) < TIME_ROUNDING &&
    gridOffset > FRAME_TIME_ROUNDING * fps
  );
}

/** The start of the playhead's frame on the grid of the rate in use. A plain floor: the playhead is
 *  exact, unlike placed times. */
function gridFrameStart(playhead: number, fps: number): number {
  return Math.floor(playhead * fps + 1e-9) / fps;
}

/** The start of a presented frame timed `mediaTime`: its grid frame's start where its time is a
 *  seek's target (see `mayBeRetimed`), else that time. */
export function presentedFrameStart(
  mediaTime: number,
  playhead: number,
  fps: number,
  seekRetimesFrame: boolean
): number {
  return mayBeRetimed(mediaTime, playhead, fps, seekRetimesFrame)
    ? gridFrameStart(playhead, fps)
    : mediaTime;
}

/** Whether the frame on screen is the playhead's frame: the one rule frame times and frame steps share.
 *  A frame presented or read after the last seek finished (`isFrameCurrent`) is, whatever the rate in
 *  use; `mustHold` also asks it to hold the playhead within a frame of the rate in use, so steps keep
 *  moving at an assumed rate above the video's. Any other frame must contain the playhead exactly. */
function isPlayheadsFrame(at: {
  presentedFrameTime: number;
  playhead: number;
  isFrameCurrent: boolean;
  fps: number;
  mustHold: boolean;
}): boolean {
  const { presentedFrameTime, playhead, isFrameCurrent, fps, mustHold } = at;
  const isCurrentFrame =
    isFrameCurrent && (!mustHold || holdsPlayhead(presentedFrameTime, playhead, fps));
  return isCurrentFrame || containsPlayhead(presentedFrameTime, playhead, fps);
}

/**
 * The time of the frame the user is on, which placements store and decisions read: the frame of the
 * playhead, presented yet or not. Right after one of the markup's frame seeks, that seek's placed
 * time. Else the start of the frame on screen, once it was presented or read after the last seek
 * finished (playing, the picture) or it contains the playhead; on Firefox, its grid frame's start.
 * Else the playhead less the placement tolerance, which `frameAt` reads as the playhead's own frame
 * on any grid. A point placed on a frame and the
 * time read there later are then the same frame start, so finding a point on the frame shown needs
 * no grid guess.
 */
export function frameTime(at: {
  presentedFrameTime: number;
  // Where the playhead is or is going: the seek held back, else the current time.
  playhead: number;
  isSeekInFlight: boolean;
  // The frame on screen was presented or read after the last seek finished: it is the playhead's frame,
  // whatever the rate in use, which the frame length `holdsPlayhead` needs can't be before measuring.
  isFrameCurrent: boolean;
  lastFrameSeek: FrameSeek | null;
  fps: number;
  // The browser times the first frame after a seek at the seek target, not its start (Firefox,
  // Gecko's DropVideoUpToSeekTarget).
  seekRetimesFrame: boolean;
}): number {
  const { presentedFrameTime, playhead, isSeekInFlight, isFrameCurrent, lastFrameSeek, fps } = at;
  if (
    lastFrameSeek != null &&
    Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4 &&
    playhead >= lastFrameSeek.frameTime - PLACEMENT_TOLERANCE
  ) {
    return lastFrameSeek.frameTime;
  }
  const onScreen = { presentedFrameTime, playhead, isFrameCurrent, fps, mustHold: false };
  if (!isSeekInFlight && isPlayheadsFrame(onScreen)) {
    return presentedFrameStart(presentedFrameTime, playhead, fps, at.seekRetimesFrame);
  }
  return Math.max(0, playhead - PLACEMENT_TOLERANCE);
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away. A seek shows the
 * frame that covers its target, so a target on a frame boundary can show either neighbor; the middle
 * is half a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't
 * change the frame shown.
 *
 * A step starts from the frame on screen once it was presented after the last seek finished and
 * holds the playhead. Until then (a seek in flight, or its frame not presented yet) the frame on screen is an
 * earlier one:
 * a step then continues from the last step's target, or from the playhead's frame after another seek.
 * So no order of seek events and frame presentation matters, and a rate slightly off never builds up.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  // Where the playhead is or is going: the seek held back, else the current time.
  playhead: number;
  // The frame on screen was presented or read after the last seek finished (see `frameTime`).
  isFrameCurrent: boolean;
  lastTarget: number | null;
  fps: number;
  // The video's duration: NaN before its metadata loads, Infinity while live.
  duration: number;
  frames: number;
  // See `frameTime`.
  seekRetimesFrame: boolean;
}): number {
  const { presentedFrameTime, playhead, isFrameCurrent, lastTarget, fps, duration, frames } = step;
  const frameDuration = 1 / fps;
  // At the video's ends, the middle of its first or last frame, so the next step back or forward
  // starts from a frame middle too.
  const lastMiddle = Number.isFinite(duration) ? duration - frameDuration / 2 : Infinity;
  // Past the last frame's middle (at the end the video snaps to its duration), the playhead is on
  // the last frame.
  const playheadInVideo = Math.min(playhead, lastMiddle);
  const onScreen = {
    presentedFrameTime,
    playhead: playheadInVideo,
    isFrameCurrent,
    fps,
    mustHold: true,
  };
  const frameStart =
    isPlayheadsFrame(onScreen) &&
    !mayBeRetimed(presentedFrameTime, playheadInVideo, fps, step.seekRetimesFrame)
      ? presentedFrameTime
      : lastTarget != null && Math.abs(playheadInVideo - lastTarget) < frameDuration / 4
        ? lastTarget - frameDuration / 2
        : // The playhead's grid frame, so every target is a frame middle.
          gridFrameStart(playheadInVideo, fps);
  const target = frameStart + (frames + 0.5) * frameDuration;
  return Math.min(Math.max(target, frameDuration / 2), lastMiddle);
}
