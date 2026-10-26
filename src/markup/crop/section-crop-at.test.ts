import { CropPoint } from '../@types/yt_clipper';
import { cropSectionAt, sectionCropAt } from './crop-keyframe-math';

const point = (x: number, crop: string, easeIn?: CropPoint['easeIn']): CropPoint => ({
  x,
  y: 0,
  crop,
  ...(easeIn && { easeIn }),
});
const components = (crop: string) => crop.split(':').map(Number);
const frame = { width: 1920, height: 1080 };

// A pan from the left half of the frame to the right half, with points before and after.
const prev = point(0, '0:0:960:1080');
const start = point(1, '0:0:960:1080');
const end = point(2, '960:0:960:1080');
const next = point(3, '960:0:960:1080');

describe('cropSectionAt', () => {
  const cropMap = [prev, start, end, next];
  it.each([
    ['the first section has no point before it', 0, { start: prev, end: start, next: end }],
    ['a middle section has both neighbors', 1, { prev, start, end, next }],
    ['the last section has no point after it', 2, { prev: start, start: end, end: next }],
  ])('%s', (_case, index, expected) => {
    const section = cropSectionAt(cropMap, index);
    expect(Object.fromEntries(Object.entries(section).filter(([, p]) => p))).toEqual(expected);
  });
});

describe('sectionCropAt', () => {
  it.each([
    ['EaseInOut at the start', 'smoothInOut', { start, end }, 1, [0, 0, 960, 1080]],
    ['EaseInOut at the end', 'smoothInOut', { start, end }, 2, [960, 0, 960, 1080]],
    ['an instant end point holds the start crop', 'smoothInOut', { start, end: point(2, end.crop, 'instant') }, 1.5, [0, 0, 960, 1080]],
  ] as const)('%s', (_case, easing, section, time, expected) => {
    const crop = sectionCropAt(easing, section, time, 30, frame, components);
    expect(crop.map((c) => Math.round(c * 1000) / 1000)).toEqual(expected);
  });

  it.each(['smoothInOut', 'smoothTrack'] as const)('%s moves between the two crops', (easing) => {
    const [x, y, w, h] = sectionCropAt(easing, { prev, start, end, next }, 1.5, 30, frame, components);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(960);
    expect([y, w, h]).toEqual([0, 960, 1080]);
  });

  it('Smooth Track leaves a point moving when the next section goes on', () => {
    const onwards = point(3, '1440:0:480:1080');
    const held = sectionCropAt('smoothTrack', { start, end, next }, 1.9, 30, frame, components);
    const moving = sectionCropAt('smoothTrack', { start, end, next: onwards }, 1.9, 30, frame, components);
    expect(moving[0]).not.toBeCloseTo(held[0], 3);
  });

  it('reads crops with the given reader', () => {
    const doubled = (crop: string) => components(crop).map((c) => c * 2);
    expect(sectionCropAt('smoothInOut', { start, end }, 2, 30, undefined, doubled)).toEqual([1920, 0, 1920, 2160]);
  });
});
