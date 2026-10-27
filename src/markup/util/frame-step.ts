/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away from the frame on
 * screen. A seek shows the frame that covers its target, so a target on a frame boundary can show
 * either neighbor, and a step of one frame duration from a boundary stays on one. The middle is half
 * a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't change
 * the frame shown.
 *
 * Steps chain from the last target while the playhead is still on it, since the frame on screen
 * changes only once the seek presents its frame: fast steps before then would repeat a target.
 */
export function frameStepTarget(step: {
  // The media time of the frame on screen (its start).
  presentedFrameTime: number;
  playhead: number;
  lastTarget: number | null;
  fps: number;
  frames: number;
}): number {
  const { presentedFrameTime, playhead, lastTarget, fps, frames } = step;
  const frameDuration = 1 / fps;
  const frameStart =
    lastTarget != null && Math.abs(playhead - lastTarget) < frameDuration / 4
      ? lastTarget - frameDuration / 2
      : presentedFrameTime;
  return frameStart + (frames + 0.5) * frameDuration;
}
