import { CropPoint } from '../@types/yt_clipper';
import { findCropKeyframeAtTime, nextKeyframeIndex } from '../crop/crop-keyframe-math';
import { FrameGrid, isInFrameSpan, loopSeekTarget } from './frame-grid';

// Every decision about the timeline means a frame, so it gives one answer anywhere in a frame: at
// its start (exact or rounded to the millisecond, as YouTube and WebM report it), a quarter, half
// and nearly all the way through. A time test against a marker or point time breaks this on the
// frame that holds the marker (the gamma preview dropped on the end marker's frame).
const RATES = [24, 25, 30000 / 1001, 30, 60];

const frameStartTime = (rate: number, n: number, roundToMs: boolean) =>
  roundToMs ? Math.round((n / rate) * 1000) / 1000 : n / rate;

function timesInFrame(rate: number, n: number, roundToMs: boolean): number[] {
  const start = frameStartTime(rate, n, roundToMs);
  // The last sample stops short of the next frame's start by more than the 1 ms a rounded time can sit
  // below it (frameAt's placement tolerance), which getFrameTime covers for the playhead.
  return [start, ...[0.25, 0.5].map((into) => (n + into) / rate), (n + 1) / rate - 0.0015];
}

const onPointOrSection = ({
  onKeyframe,
  index,
  section,
}: ReturnType<typeof findCropKeyframeAtTime>) =>
  onKeyframe ? { onKeyframe, index } : { onKeyframe, index, section };

describe('frame decisions', () => {
  it.each(RATES.flatMap((rate) => [true, false].map((roundToMs) => [rate, roundToMs] as const)))(
    'give one answer anywhere in a frame at %p fps (millisecond times: %p)',
    (rate, roundToMs) => {
      const grid: FrameGrid = { origin: 0, rate };
      const at = (n: number) => frameStartTime(rate, n, roundToMs);
      // Markers and points at frame starts, as placed, and one mid-frame, as older files store them.
      const start = at(90);
      const end = at(180);
      const cropMap: CropPoint[] = [at(90), at(120), 150.4 / rate, at(180)].map((x) => ({
        x,
        y: 0,
        crop: '0:0:iw:ih',
      }));
      const decisions = (time: number) =>
        JSON.stringify([
          isInFrameSpan(grid, start, end, time),
          loopSeekTarget(grid, start, end, time),
          // What callers read: the point on the frame, else the points around it and the nearest.
          onPointOrSection(findCropKeyframeAtTime(cropMap, time, grid)),
          nextKeyframeIndex(cropMap, time, grid, 1),
          nextKeyframeIndex(cropMap, time, grid, -1),
        ]);
      const split: number[] = [];
      for (let n = 85; n <= 185; n++) {
        const answers = new Set(timesInFrame(rate, n, roundToMs).map(decisions));
        if (answers.size > 1) split.push(n);
      }
      expect(split).toEqual([]);
    }
  );

  // Before a rate is measured the grid is 60 fps whatever the video's. Decisions read the frame time
  // (getFrameTime: the start of the frame on screen), so on that grid they must match the video's own.
  it.each([24, 25, 30000 / 1001, 30, 50])(
    'decide on the assumed 60 fps grid as on the measured grid of a %p fps video',
    (rate) => {
      const measured: FrameGrid = { origin: 0, rate };
      const assumed: FrameGrid = { origin: 0, rate: 60 };
      const at = (n: number) => Math.round((n / rate) * 1000) / 1000;
      const start = at(90);
      const end = at(180);
      const cropMap: CropPoint[] = [at(90), at(120), at(150), at(180)].map((x) => ({
        x,
        y: 0,
        crop: '0:0:iw:ih',
      }));
      const decisions = (grid: FrameGrid, time: number) =>
        JSON.stringify([
          isInFrameSpan(grid, start, end, time),
          loopSeekTarget(grid, start, end, time) == null,
          onPointOrSection(findCropKeyframeAtTime(cropMap, time, grid)),
          nextKeyframeIndex(cropMap, time, grid, 1),
          nextKeyframeIndex(cropMap, time, grid, -1),
        ]);
      const differ: number[] = [];
      for (let n = 85; n <= 185; n++) {
        if (decisions(assumed, at(n)) !== decisions(measured, at(n))) differ.push(n);
      }
      expect(differ).toEqual([]);
    }
  );
});
