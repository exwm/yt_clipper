/**
 * Which frame a time on the video timeline means. A user places a time (a marker, a crop or speed
 * point) while a frame is shown, and means that frame: the one whose display interval covers the time.
 * Everything that turns a placed time into frames goes through `frameAt`, so the preview and the render
 * agree on every boundary. Mirrors src/clipper/frame_grid.py; both are checked against
 * src/clipper/tests/fixtures/frame_grid_cases.json.
 */

// A time up to this much before a frame's start still means that frame. Times reach the core rounded:
// saved to 6 decimals, or YouTube's frame times rounded to the millisecond, so a frame's start time can
// come back just below it. 1 ms is under half a frame at up to 500 fps.
export const PLACEMENT_TOLERANCE = 0.001;

/** Frame n of a constant frame rate source starts at origin + n / rate. */
export interface FrameGrid {
  origin: number;
  rate: number;
}

/** The frame shown at `time`. */
export function frameAt(grid: FrameGrid, time: number): number {
  return Math.floor((time - grid.origin + PLACEMENT_TOLERANCE) * grid.rate);
}

export function frameStart(grid: FrameGrid, frame: number): number {
  return grid.origin + frame / grid.rate;
}

/** Half a frame from both edges, where a seek or a comparison can't land on a neighbor. */
export function frameMiddle(grid: FrameGrid, frame: number): number {
  return grid.origin + (frame + 0.5) / grid.rate;
}

/** The start of the frame shown at `time`. */
export function snapToFrame(grid: FrameGrid, time: number): number {
  return frameStart(grid, frameAt(grid, time));
}

/** A marker pair's frames: from the frame shown at its start marker through the one at its end
 *  marker, as the clipper's frame_grid.frameSpan clips them. */
export interface FrameSpan {
  firstFrame: number;
  lastFrame: number;
  // The first frame's start, and the last frame's end.
  start: number;
  end: number;
}

/** Where a loop over the frames shown from `start` through `end` seeks when the playhead is at `time`:
 *  the middle of its first frame when `time` shows a frame outside them, else null. The middle keeps
 *  the next check inside the loop, so the loop never seeks again on the frame it landed on. */
export function loopSeekTarget(
  grid: FrameGrid,
  start: number,
  end: number,
  time: number
): number | null {
  const { firstFrame, lastFrame } = frameSpan(grid, start, end);
  const frame = frameAt(grid, time);
  return frame < firstFrame || frame > lastFrame ? frameMiddle(grid, firstFrame) : null;
}

export function frameSpan(grid: FrameGrid, startMarker: number, endMarker: number): FrameSpan {
  const firstFrame = frameAt(grid, startMarker);
  const lastFrame = Math.max(firstFrame, frameAt(grid, endMarker));
  return {
    firstFrame,
    lastFrame,
    start: frameStart(grid, firstFrame),
    end: frameStart(grid, lastFrame + 1),
  };
}
