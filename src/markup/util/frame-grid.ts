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
