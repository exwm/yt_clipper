/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away from the frame on
 * screen. A seek shows the frame that covers its target, so a target on a frame boundary can show
 * either neighbor, and a step of one frame duration from a boundary stays on one. The middle is half
 * a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't change
 * the frame shown.
 *
 * Steps chain from the last target while the playhead is on it, until a frame other than the one
 * the last step started from is presented after the latest seek ended. Fast steps would otherwise
 * repeat a target; a slow seek that presents an earlier step's frame while a later one is in flight
 * would restart behind it; and a rate too high for the video would land every step on the same
 * frame. Steps then start from the frame shown, so a rate slightly off never builds up.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start), and whether it was presented after the
  // latest seek ended.
  presentedFrameTime: number;
  isFrameSettled: boolean;
  playhead: number;
  lastStep: { target: number; presentedFrameTime: number } | null;
  fps: number;
  frames: number;
}): number {
  const { presentedFrameTime, isFrameSettled, playhead, lastStep, fps, frames } = step;
  const frameDuration = 1 / fps;
  const showsNewFrame = isFrameSettled && presentedFrameTime !== lastStep?.presentedFrameTime;
  const isPending =
    lastStep != null && !showsNewFrame && Math.abs(playhead - lastStep.target) < frameDuration / 4;
  const frameStart = isPending ? lastStep.target - frameDuration / 2 : presentedFrameTime;
  return frameStart + (frames + 0.5) * frameDuration;
}
