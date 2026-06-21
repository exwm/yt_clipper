import { isWithinSameFrame } from './util';

// The section/marker loops use this to decide they're already at the loop point. Within half a
// frame is the same displayed frame (no re-seek); a full frame apart is a real step.
describe('isWithinSameFrame', () => {
  const fps = 30;
  const frame = 1 / fps;

  it.each([
    ['identical times', 10, 10, true],
    ['tiny float/frame-snap residual', 10, 10 + 1e-6, true],
    ['just under half a frame', 10, 10 + 0.49 * frame, true],
    ['just over half a frame', 10, 10 + 0.51 * frame, false],
    ['one full frame apart (a real step)', 10, 10 + frame, false],
    ['several frames apart', 10, 10 + 3 * frame, false],
  ])('%s', (_label: string, a: number, b: number, expected: boolean) => {
    expect(isWithinSameFrame(a, b, fps)).toBe(expected);
    expect(isWithinSameFrame(b, a, fps)).toBe(expected); // symmetric
  });

  it('falls back to 30fps when fps is missing/invalid', () => {
    const halfFrameAt30 = 0.5 / 30;
    expect(isWithinSameFrame(5, 5 + 0.9 * halfFrameAt30, 0)).toBe(true);
    expect(isWithinSameFrame(5, 5 + 1 / 30, NaN)).toBe(false);
  });
});
