import { PLACEMENT_TOLERANCE } from './frame-grid';

/** A seek the markup made to show a frame: where it seeks, and the time of the frame it shows (a
 *  placed time such as a marker's, or a step's frame start). */
export interface FrameSeek {
  target: number;
  frameTime: number;
}

/**
 * The time of the frame the user is on: while the playhead is still on the target of the markup's
 * last frame seek, that seek's frame time, else `fallbackTime` (the frame on screen for a decision
 * such as which crop point is next, the playhead for a placement). Until a seek presents its frame the frame on screen is the one before it,
 * and browsers present that frame before or after their seek events in no fixed order; the markup's
 * own seek doesn't depend on them.
 */
export function frameDecisionTime(at: {
  fallbackTime: number;
  playhead: number;
  lastFrameSeek: FrameSeek | null;
  fps: number;
}): number {
  const { fallbackTime, playhead, lastFrameSeek, fps } = at;
  const isOnLastSeek =
    lastFrameSeek != null && Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4;
  return isOnLastSeek ? lastFrameSeek.frameTime : fallbackTime;
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away. A seek shows the
 * frame that covers its target, so a target on a frame boundary can show either neighbor; the middle
 * is half a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't
 * change the frame shown.
 *
 * A step starts from the frame on screen once it holds the playhead. Until then (a seek in flight, or
 * its frame not presented yet) the frame on screen is an earlier one, which can't hold the playhead:
 * a step then continues from the last step's target, or from the playhead's frame after another seek. So no
 * order of seek events and frame presentation matters, and a rate slightly off never builds up.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  // Where the playhead is or is going: the seek held back, else the current time.
  playhead: number;
  lastTarget: number | null;
  fps: number;
  // The video's duration: NaN before its metadata loads, Infinity while live.
  duration: number;
  frames: number;
}): number {
  const { presentedFrameTime, playhead, lastTarget, fps, duration, frames } = step;
  const frameDuration = 1 / fps;
  const holdsPlayhead =
    presentedFrameTime <= playhead + PLACEMENT_TOLERANCE &&
    playhead < presentedFrameTime + frameDuration;
  const frameStart = holdsPlayhead
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
