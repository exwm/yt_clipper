/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away from the frame on
 * screen. A seek shows the frame that covers its target, so a target on a frame boundary can show
 * either neighbor, and a step of one frame duration from a boundary stays on one. The middle is half
 * a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't change
 * the frame shown.
 *
 * Steps chain from the last target while that step's seek is pending: the playhead is still on its
 * target and the frame on screen is still the one shown when the step was taken. Fast steps before
 * the seek presents a frame would otherwise repeat a target, and a rate too high for the video can
 * land a step on the same frame. Otherwise (the step's frame is shown, or the playhead moved on)
 * steps start from the frame shown, so a rate slightly off never builds up over many steps.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  playhead: number;
  lastStep: { target: number; presentedFrameTime: number } | null;
  fps: number;
  frames: number;
}): number {
  const { presentedFrameTime, playhead, lastStep, fps, frames } = step;
  const frameDuration = 1 / fps;
  const isPending =
    lastStep?.presentedFrameTime === presentedFrameTime &&
    Math.abs(playhead - lastStep.target) < frameDuration / 4;
  const frameStart = isPending ? lastStep.target - frameDuration / 2 : presentedFrameTime;
  return frameStart + (frames + 0.5) * frameDuration;
}
