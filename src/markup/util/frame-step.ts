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

/**
 * The time of the frame the user is on, which placements store and decisions read: the frame of the
 * playhead, presented yet or not. Right after one of the markup's frame seeks, that seek's placed
 * time. Else the start of the frame on screen, once it was presented after the last seek started
 * (playing, the picture) or it holds the playhead. Else the playhead less the placement tolerance,
 * which `frameAt` reads as the playhead's own frame on any grid. A point placed on a frame and the
 * time read there later are then the same frame start, so finding a point on the frame shown needs
 * no grid guess.
 */
export function frameTime(at: {
  presentedFrameTime: number;
  // Where the playhead is or is going: the seek held back, else the current time.
  playhead: number;
  isSeekInFlight: boolean;
  // The frame on screen was presented after the last seek started: it is the playhead's frame,
  // whatever the rate in use, which the frame length `holdsPlayhead` needs can't be before measuring.
  isFrameCurrent: boolean;
  lastFrameSeek: FrameSeek | null;
  fps: number;
}): number {
  const { presentedFrameTime, playhead, isSeekInFlight, isFrameCurrent, lastFrameSeek, fps } = at;
  if (
    lastFrameSeek != null &&
    Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4 &&
    playhead >= lastFrameSeek.frameTime - PLACEMENT_TOLERANCE
  ) {
    return lastFrameSeek.frameTime;
  }
  if (!isSeekInFlight && (isFrameCurrent || holdsPlayhead(presentedFrameTime, playhead, fps))) {
    return presentedFrameTime;
  }
  return Math.max(0, playhead - PLACEMENT_TOLERANCE);
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away. A seek shows the
 * frame that covers its target, so a target on a frame boundary can show either neighbor; the middle
 * is half a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't
 * change the frame shown.
 *
 * A step starts from the frame on screen once it was presented after the last seek and holds the
 * playhead. Until then (a seek in flight, or its frame not presented yet) the frame on screen is an
 * earlier one:
 * a step then continues from the last step's target, or from the playhead's frame after another seek.
 * So no order of seek events and frame presentation matters, and a rate slightly off never builds up.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  // Where the playhead is or is going: the seek held back, else the current time.
  playhead: number;
  // The frame on screen was presented after the last seek started (see `frameTime`).
  isFrameCurrent: boolean;
  lastTarget: number | null;
  fps: number;
  // The video's duration: NaN before its metadata loads, Infinity while live.
  duration: number;
  frames: number;
}): number {
  const { presentedFrameTime, playhead, isFrameCurrent, lastTarget, fps, duration, frames } = step;
  const frameDuration = 1 / fps;
  // A frame from before the last seek could hold the playhead only through the tolerances, when a
  // user seek lands just before its start: it must contain the playhead exactly. A frame presented
  // before `seeking` (YouTube) never reads current, and a step's middle target is well inside it.
  const holds =
    holdsPlayhead(presentedFrameTime, playhead, fps) &&
    (isFrameCurrent ||
      (presentedFrameTime <= playhead && playhead < presentedFrameTime + frameDuration));
  const frameStart = holds
    ? presentedFrameTime
    : lastTarget != null && Math.abs(playhead - lastTarget) < frameDuration / 4
      ? lastTarget - frameDuration / 2
      : // The playhead's grid frame, so every target is a frame middle. A plain floor: the playhead
        // is exact, unlike placed times.
        Math.floor(playhead * fps + 1e-9) / fps;
  const target = frameStart + (frames + 0.5) * frameDuration;
  // At the video's ends, the middle of its first or last frame, so the next step back or forward
  // starts from a frame middle too.
  const lastMiddle = Number.isFinite(duration) ? duration - frameDuration / 2 : Infinity;
  return Math.min(Math.max(target, frameDuration / 2), lastMiddle);
}
