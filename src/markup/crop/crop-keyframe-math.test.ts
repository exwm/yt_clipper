import { CropPoint } from '../@types/yt_clipper';
import {
  cropInterpolationSectionAtTime,
  findCropKeyframeAtTime,
  nextKeyframeIndex,
} from './crop-keyframe-math';

// Keyframes at t = 0, 1, 2 (crop strings are irrelevant to the time math).
const cropMap: CropPoint[] = [
  { x: 0, y: 0, crop: '0:0:100:100' },
  { x: 1, y: 0, crop: '0:0:100:100' },
  { x: 2, y: 0, crop: '0:0:100:100' },
];

const FPS_60 = 60; // one-frame tolerance ≈ 0.0167s
const FPS_30 = 30; // one-frame tolerance ≈ 0.0333s

describe('findCropKeyframeAtTime', () => {
  describe('on a keyframe', () => {
    it.each([
      ['first', 0, 0],
      ['middle', 1, 1],
      ['last', 2, 2],
    ])('exact hit on the %s keyframe', (_label, time, index) => {
      const match = findCropKeyframeAtTime(cropMap, time, FPS_60);
      expect(match.onKeyframe).toBe(true);
      expect(match.index).toBe(index);
    });

    it('within a frame counts as on the keyframe', () => {
      const match = findCropKeyframeAtTime(cropMap, 1 + 0.005, FPS_60);
      expect(match.onKeyframe).toBe(true);
      expect(match.index).toBe(1);
    });

    it('snaps to the nearer endpoint of a section', () => {
      const match = findCropKeyframeAtTime(cropMap, 2 - 0.005, FPS_60);
      expect(match.onKeyframe).toBe(true);
      expect(match.index).toBe(2);
    });
  });

  describe('between keyframes', () => {
    it('just past the tolerance is not on a keyframe', () => {
      const match = findCropKeyframeAtTime(cropMap, 1 + 0.02, FPS_60);
      expect(match.onKeyframe).toBe(false);
      expect(match.index).toBe(1);
      expect(match.section).toEqual([1, 2]);
    });

    it('mid-section brackets the surrounding points', () => {
      const match = findCropKeyframeAtTime(cropMap, 0.5, FPS_60);
      expect(match.onKeyframe).toBe(false);
      expect(match.section).toEqual([0, 1]);
    });

    it('selects the nearer point (index), not the section left point', () => {
      // 1.6 is closer to point 2 than point 1, so a click/seek there selects point 2.
      const match = findCropKeyframeAtTime(cropMap, 1.6, FPS_60);
      expect(match.onKeyframe).toBe(false);
      expect(match.index).toBe(2);
      expect(match.section).toEqual([1, 2]);
    });
  });

  describe('tolerance scales with fps', () => {
    it('0.025s off is on-keyframe at 30fps but not at 60fps', () => {
      // Between the two one-frame tolerances: 0.0167s (60fps) < 0.025s < 0.0333s (30fps).
      const time = 1 + 0.025;
      expect(findCropKeyframeAtTime(cropMap, time, FPS_30).onKeyframe).toBe(true);
      expect(findCropKeyframeAtTime(cropMap, time, FPS_60).onKeyframe).toBe(false);
    });

    it.each([
      ['zero', 0],
      ['NaN', NaN],
      ['negative', -60],
    ])('invalid fps (%s) falls back to the 30fps tolerance, not 1/fps', (_label, fps) => {
      // 0.01s off is within the 30fps one-frame tolerance, so it reads as on-keyframe...
      expect(findCropKeyframeAtTime(cropMap, 1 + 0.01, fps as number).onKeyframe).toBe(true);
      // ...but a mid-section time does not (1/0 = Infinity would mark everything on-keyframe).
      expect(findCropKeyframeAtTime(cropMap, 0.5, fps as number).onKeyframe).toBe(false);
    });
  });

  describe('edges clamp to valid indices', () => {
    it('time before the first keyframe clamps to index 0', () => {
      const match = findCropKeyframeAtTime(cropMap, -0.5, FPS_60);
      expect(match.index).toBe(0);
      expect(match.section).toEqual([0, 0]);
    });

    it('time past the last keyframe clamps to the last index', () => {
      const match = findCropKeyframeAtTime(cropMap, 2.5, FPS_60);
      expect(match.index).toBe(2);
      expect(match.section).toEqual([2, 2]);
    });
  });
});

describe('cropInterpolationSectionAtTime', () => {
  it.each([
    ['mid first section', 0.5, [0, 1]],
    ['mid second section', 1.5, [1, 2]],
  ])('brackets the surrounding points (%s)', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });

  // The bug fix: never collapse to [i, i] (which would divide-by-zero when easing) — an
  // exact keyframe hit eases across the forward section, so time == keyframe time gives
  // 0% and returns that keyframe's crop without a jump.
  it.each([
    ['first keyframe', 0, [0, 1]],
    ['middle keyframe', 1, [1, 2]],
    ['last keyframe', 2, [1, 2]],
  ])('returns a real interval on an exact %s hit', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });

  it.each([
    ['before the first keyframe', -0.5, [0, 1]],
    ['past the last keyframe', 2.5, [1, 2]],
  ])('clamps to a real edge section %s', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });
});

describe('nextKeyframeIndex', () => {
  it.each([
    ['on a keyframe, forward steps to the next', 1, 1, 2],
    ['on a keyframe, back steps to the previous', 1, -1, 0],
    ['between keyframes, forward goes to the right bracket', 0.5, 1, 1],
    ['between keyframes, back goes to the left bracket', 0.5, -1, 0],
  ])('%s', (_label, time: number, dir: number, expected: number) => {
    expect(nextKeyframeIndex(cropMap, time, FPS_60, dir as 1 | -1)).toBe(expected);
  });

  it('clamps at the ends instead of stepping past', () => {
    expect(nextKeyframeIndex(cropMap, 2, FPS_60, 1)).toBe(2); // forward off the last point
    expect(nextKeyframeIndex(cropMap, 0, FPS_60, -1)).toBe(0); // back off the first point
  });

  it('a seek landing up to a frame short still steps off the current keyframe', () => {
    // Within the one-frame on-keyframe tolerance of keyframe 1, so forward must reach 2 (not re-pick
    // 1) — the half-frame-threshold bug this replaced re-selected the current point for one tick.
    const justShort = 1 - 0.9 / FPS_60;
    expect(nextKeyframeIndex(cropMap, justShort, FPS_60, 1)).toBe(2);
  });
});
