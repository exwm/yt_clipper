import { PLACEMENT_TOLERANCE } from './frame-grid';

/** A seek the markup made to show a frame: where it seeks, and the time of the frame it shows (a
 *  placed time such as a marker's, or a step's frame start). */
export interface FrameSeek {
  target: number;
  frameTime: number;
}

/**
 * The time of the frame the user is on, for a decision such as which crop point or marker is next:
 * while the playhead is still on the target of the markup's last frame seek, that seek's frame time,
 * else the frame on screen. Until a seek presents its frame the frame on screen is the one before it,
 * and browsers present that frame before or after their seek events in no fixed order; the markup's
 * own seek doesn't depend on them.
 */
export function frameDecisionTime(at: {
  presentedFrameTime: number;
  playhead: number;
  lastFrameSeek: FrameSeek | null;
  fps: number;
}): number {
  const { presentedFrameTime, playhead, lastFrameSeek, fps } = at;
  const isOnLastSeek =
    lastFrameSeek != null && Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4;
  return isOnLastSeek ? lastFrameSeek.frameTime : presentedFrameTime;
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away from the frame on
 * screen. A seek shows the frame that covers its target, so a target on a frame boundary can show
 * either neighbor, and a step of one frame duration from a boundary stays on one. The middle is half
 * a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't change
 * the frame shown.
 *
 * Steps chain from the last target while the playhead is on it, until no seek is in flight and a new
 * frame on screen holds that target. Until then the frame on screen can be an earlier step's, whose
 * frame comes before or after its seek ends, and a rate too high for the video can land a step on
 * the frame it started from. Steps then start from the frame shown, so a rate slightly off never
 * builds up.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  isSeekInFlight: boolean;
  playhead: number;
  // The last step's target, the frame on screen when it was taken, and its direction (1 or -1).
  lastStep: { target: number; presentedFrameTime: number; direction: number } | null;
  fps: number;
  frames: number;
}): number {
  const { presentedFrameTime, isSeekInFlight, playhead, lastStep, fps, frames } = step;
  const frameDuration = 1 / fps;
  // An earlier step's frame is behind the target in the step's direction: forward, it ends before
  // the target (a quarter frame of slack, so a rate somewhat higher than the video's still finds the
  // target in its frame; an earlier step's frame is 1.5 frames or more back); back, it starts after.
  const showsEarlierFrame =
    lastStep != null &&
    (lastStep.direction > 0
      ? presentedFrameTime + 1.25 * frameDuration <= lastStep.target
      : presentedFrameTime > lastStep.target + PLACEMENT_TOLERANCE);
  const showsLastTarget =
    lastStep != null &&
    !isSeekInFlight &&
    presentedFrameTime !== lastStep.presentedFrameTime &&
    !showsEarlierFrame;
  const isPending =
    lastStep != null &&
    Math.abs(playhead - lastStep.target) < frameDuration / 4 &&
    !showsLastTarget;
  const frameStart = isPending ? lastStep.target - frameDuration / 2 : presentedFrameTime;
  return frameStart + (frames + 0.5) * frameDuration;
}
