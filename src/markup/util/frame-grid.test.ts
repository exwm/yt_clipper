import { readFileSync } from 'fs';
import { join } from 'path';
import {
  FrameGrid,
  frameAt,
  frameMiddle,
  frameSpan,
  frameSeekTarget,
  frameStart,
  loopSeekTarget,
  snapToFrame,
} from './frame-grid';

interface Case {
  rate: string;
  origin: number;
  time: number;
  frame: number;
  kind: string;
}
interface StartCase {
  rate: string;
  origin: number;
  frame: number;
  start: number;
}
interface SpanCase {
  rate: string;
  origin: number;
  startMarker: number;
  endMarker: number;
  firstFrame: number;
  lastFrame: number;
  kind: string;
}
const cases: { timeToFrame: Case[]; frameStart: StartCase[]; frameSpan: SpanCase[] } = JSON.parse(
  readFileSync(join(__dirname, '../../clipper/tests/fixtures/frame_grid_cases.json'), 'utf8')
);

const grid = ({ rate, origin }: { rate: string; origin: number }): FrameGrid => {
  const [num, den = '1'] = rate.split('/');
  return { origin, rate: Number(num) / Number(den) };
};

describe('frameSpan, against the clipper’s case table', () => {
  it.each(cases.frameSpan.map((c) => [c.kind, c] as const))('%s', (_kind, c) => {
    const span = frameSpan(grid(c), c.startMarker, c.endMarker);
    expect([span.firstFrame, span.lastFrame]).toEqual([c.firstFrame, c.lastFrame]);
    expect(span.start).toBeCloseTo(frameStart(grid(c), c.firstFrame), 9);
    expect(span.end).toBeCloseTo(frameStart(grid(c), c.lastFrame + 1), 9);
  });
});

describe('frameSeekTarget', () => {
  const at30: FrameGrid = { origin: 0, rate: 30 };
  it.each([
    ['a frame start', 31 / 30, 31],
    ['a frame start rounded to the millisecond', 1.033, 31],
    ['a chart point late in its frame', 6.03, 180],
  ] as const)('stays in the frame of %s', (_case, time, frame) => {
    const target = frameSeekTarget(at30, time);
    expect(frameAt(at30, target)).toBe(frame);
    expect(target).toBeGreaterThan(time);
  });

  // The grid in use can be a rate off until the rate is measured. A seek still shows the frame a time
  // means on the video's own grid: for markers, the video's frame starts rounded to the millisecond, and
  // for chart points, times on the chart's 0.01 s grid.
  const frameStartsRounded = (video: FrameGrid) =>
    Array.from({ length: 3000 }, (_, frame) => Math.round(frameStart(video, frame) * 1000) / 1000);
  const chartTimes = Array.from({ length: 6000 }, (_, i) => i / 100);
  it.each([
    ['29.97 fps on a 30 fps grid', 30000 / 1001, 30],
    ['25 fps on the 60 fps default', 25, 60],
    ['59.94 fps on a 60 fps grid', 60000 / 1001, 60],
    ['23.976 fps on the 60 fps default', 24000 / 1001, 60],
    ['120 fps on the 60 fps default', 120, 60],
    ['30 fps on the 60 fps default', 30, 60],
    ['30 fps on a 30 fps grid', 30, 30],
    ['29.97 fps on a 29.97 fps grid', 30000 / 1001, 30000 / 1001],
  ] as const)('shows the frame a time means for %s', (_case, videoRate, gridRate) => {
    const video: FrameGrid = { origin: 0, rate: videoRate };
    const grid: FrameGrid = { origin: 0, rate: gridRate };
    // The browser shows the frame whose start is at or before the playhead.
    const frameShown = (time: number) => Math.floor(time * videoRate);
    const wrong = [...frameStartsRounded(video), ...chartTimes].filter(
      (time) => frameShown(frameSeekTarget(grid, time)) !== frameAt(video, time)
    );
    expect(wrong).toEqual([]);
  });
});

describe('loopSeekTarget', () => {
  // A loop from frame 30 (1 s) through frame 60 (2 s) at 30 fps.
  it.each([
    ['inside', 1.5, null],
    ['on the frame shown at the end', 2.02, null],
    ['a hair before the start, saved rounded', 0.9995, null],
    ['past the frame shown at the end', 2.034, 1.001],
    ['before the start', 0.99, 1.001],
  ] as const)('%s', (_case, playhead, target) => {
    const seekTo = loopSeekTarget({ origin: 0, rate: 30 }, 1, 2, playhead);
    if (target == null) expect(seekTo).toBeNull();
    else expect(seekTo).toBeCloseTo(target, 9);
  });

  // Playing, the time is the frame on screen: the loop turns back on its last frame, while that frame
  // shows, so the frame after it never does. The playhead runs ahead of the picture.
  it.each([
    ['the picture inside', 1.5, null],
    ['the picture on the frame at the end', 2.0, 1.001],
    ['the picture past the end', 2.034, 1.001],
  ] as const)('playing, %s', (_case, frameTime, target) => {
    const seekTo = loopSeekTarget({ origin: 0, rate: 30 }, 1, 2, frameTime, true);
    if (target == null) expect(seekTo).toBeNull();
    else expect(seekTo).toBeCloseTo(target, 9);
  });
});

describe('frame grid, against the clipper’s case table', () => {
  it('maps a time to the frame shown there', () => {
    const wrong = cases.timeToFrame.flatMap((c) => {
      const got = frameAt(grid(c), c.time);
      return got === c.frame ? [] : [{ ...c, got }];
    });
    expect(wrong).toEqual([]);
  });

  it('starts a frame where its times map to it', () => {
    for (const c of cases.frameStart) {
      const g = grid(c);
      expect(frameStart(g, c.frame)).toBeCloseTo(c.start, 9);
      expect(snapToFrame(g, c.start)).toBeCloseTo(c.start, 9);
      expect(frameAt(g, frameMiddle(g, c.frame))).toBe(c.frame);
    }
  });
});
