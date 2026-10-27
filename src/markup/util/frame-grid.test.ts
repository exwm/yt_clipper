import { readFileSync } from 'fs';
import { join } from 'path';
import { FrameGrid, frameAt, frameMiddle, frameStart, snapToFrame } from './frame-grid';

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
