import { halvingSteps } from './halving-steps';

describe('halvingSteps', () => {
  it.each([
    ['no smaller than the drawn size', 1920, 1080, 1, []],
    ['exactly twice the drawn size', 1920, 1080, 2, []],
    ['just over twice the drawn size, once', 1920, 1080, 2.5, [{ width: 960, height: 540 }]],
    ['four times the drawn size, to twice it', 1920, 1080, 4, [{ width: 960, height: 540 }]],
    [
      'eight times the drawn size, twice',
      1920,
      1080,
      8,
      [
        { width: 960, height: 540 },
        { width: 480, height: 270 },
      ],
    ],
    ['an odd size, rounded', 5, 3, 3, [{ width: 3, height: 2 }]],
    [
      'a sliver, never below one pixel',
      4,
      1,
      16,
      [
        { width: 2, height: 1 },
        { width: 1, height: 1 },
        { width: 1, height: 1 },
      ],
    ],
  ] as [string, number, number, number, { width: number; height: number }[]][])(
    'shrinks a frame %s',
    (_, width, height, scaleDown, expected) => {
      expect(halvingSteps(width, height, scaleDown)).toEqual(expected);
    }
  );
});
