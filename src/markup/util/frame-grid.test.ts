import { readFileSync } from 'fs';
import { join } from 'path';
import { FrameGrid, frameAt, frameMiddle, frameSpan, frameStart, snapToFrame } from './frame-grid';

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
const cases: { timeToFrame: Case[]; frameStart: StartCase[] } = JSON.parse(
  readFileSync(join(__dirname, '../../clipper/tests/fixtures/frame_grid_cases.json'), 'utf8')
);

const grid = ({ rate, origin }: { rate: string; origin: number }): FrameGrid => {
  const [num, den = '1'] = rate.split('/');
  return { origin, rate: Number(num) / Number(den) };
};

describe('frameSpan', () => {
  // The rows of the clipper's test_frame_grid span test.
  it.each([
    ['on frame starts', 30 / 30, 50 / 30, [30, 50]],
    ['mid-frame', 30.5 / 30, 50.5 / 30, [30, 50]],
    ['saved to 6 decimals', Number((31 / 30).toFixed(6)), Number((52 / 30).toFixed(6)), [31, 52]],
    ['both in one frame', 30.5 / 30, 30.6 / 30, [30, 30]],
  ] as const)('%s', (_case, startMarker, endMarker, [first, last]) => {
    const span = frameSpan({ origin: 0, rate: 30 }, startMarker, endMarker);
    expect([span.firstFrame, span.lastFrame]).toEqual([first, last]);
    expect(span.start).toBeCloseTo(first / 30, 9);
    expect(span.end).toBeCloseTo((last + 1) / 30, 9);
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
