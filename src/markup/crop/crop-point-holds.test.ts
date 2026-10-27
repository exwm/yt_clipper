import { produce } from 'immer';
import { CropPoint } from '../@types/yt_clipper';
import {
  ownCropToRelease,
  releaseHoldIfChanged,
  releaseMismatchedHolds,
  resolveHeldCrops,
  toggleHold,
  toggleInstant,
} from './crop-point-holds';

// Rows write a crop map as letters for crops, `(h)` for a hold point and `{X}` for its own crop:
// 'A A(h){B}'. The functions only compare crop text, so a letter stands in for a crop string.
function cropMap(row: string): CropPoint[] {
  return row.split(' ').map((token, i) => {
    const [, crop, hold, ownCrop] = /^(\w+)(\(h\))?(?:\{(\w+)\})?$/.exec(token) ?? [];
    const point: CropPoint = { x: i, y: 0, crop };
    if (hold) point.hold = true;
    if (ownCrop) point.ownCrop = ownCrop;
    return point;
  });
}

function row(map: CropPoint[]): string {
  return map
    .map((p) => p.crop + (p.hold ? '(h)' : '') + (p.ownCrop ? `{${p.ownCrop}}` : ''))
    .join(' ');
}

describe('resolveHeldCrops', () => {
  it.each([
    ['A B(h)', 'A A(h)'],
    ['A B(h) C(h)', 'A A(h) A(h)'],
    ['A B C(h)', 'A B B(h)'],
    ['A B(h) C D(h)', 'A A(h) C C(h)'],
    ['A(h) B', 'A B'],
    ['A A(h)', 'A A(h)'],
  ])('%s resolves to %s', (input, expected) => {
    expect(row(produce(cropMap(input), resolveHeldCrops))).toBe(expected);
  });

  it.each(['A B', 'A A(h) B'])('keeps an already resolved map (%s) as the same object', (input) => {
    const map = cropMap(input);
    expect(produce(map, resolveHeldCrops)).toBe(map);
  });
});

describe('releaseHoldIfChanged', () => {
  it.each([
    ['A A(h)', 1, 'A A(h)'],
    ['A B(h)', 1, 'A B'],
    ['A B', 1, 'A B'],
    ['A(h) B', 0, 'A B'],
    ['A B(h)', 0, 'A B(h)'],
    ['A B(h){C}', 1, 'A B'],
    ['A A(h){C}', 1, 'A A(h){C}'],
  ])('%s at index %d gives %s', (input, index, expected) => {
    expect(row(produce(cropMap(input), (map) => releaseHoldIfChanged(map, index)))).toBe(expected);
  });

  it('compares with the given crop equality', () => {
    const map = [
      { x: 0, y: 0 as const, crop: '0:0:iw:ih' },
      { x: 1, y: 0 as const, crop: '0:0:1920:1080', hold: true as const },
    ];
    const toPixels = (crop: string) => crop.replace('iw:ih', '1920:1080');
    const sameSize = (a: string, b: string) => toPixels(a) === toPixels(b);
    releaseHoldIfChanged(map, 1, sameSize);
    expect(map[1].hold).toBe(true);
    releaseHoldIfChanged(map, 1);
    expect(map[1].hold).toBeUndefined();
  });
});

describe('toggleInstant', () => {
  const type = (point: CropPoint) => (point.hold ? 'hold' : (point.easeIn ?? 'normal'));

  it.each([
    ['A B', 'instant', 'A B'],
    ['A B(h)', 'instant', 'A C'],
    ['A A(h){C}', 'instant', 'A C'],
  ])('%s at index 1 becomes %s and gives %s', (input, expectedType, expected) => {
    const map = cropMap(input);
    toggleInstant(map, 1, 'C');
    expect(type(map[1])).toBe(expectedType);
    expect(row(map)).toBe(expected);
    toggleInstant(map, 1, 'C');
    expect(type(map[1])).toBe('normal');
  });
});

describe('ownCropToRelease', () => {
  const P = '0:0:960:540';
  // [own crop, the crop it holds now, pan-only], at 1920x1080.
  it.each([
    ['the own crop as it was', '480:270:960:540', P, false, '480:270:960:540'],
    [
      'the position at the size every pan-only point now has',
      '640:0:960:1080',
      '0:0:800:900',
      true,
      '640:0:800:900',
    ],
    [
      'a crop moved back into the frame at the new size',
      '960:0:960:1080',
      '0:0:1200:1080',
      true,
      '720:0:1200:1080',
    ],
    ['a crop given in iw and ih', '0:0:iw:ih', P, false, '0:0:1920:1080'],
    [
      'a zoompan crop at the aspect ratio the points now share, keeping its width and center',
      '0:0:960:1080',
      '0:0:1080:1080',
      false,
      '0:60:960:960',
    ],
    [
      'a zoompan crop narrowed to fit the frame at that ratio, and moved back into it',
      '1600:900:320:180',
      '0:0:270:960',
      false,
      '1609:3:303:1077',
    ],
    [
      'a wide zoompan crop narrowed to a tall shared ratio at the frame height',
      '0:0:1920:540',
      '0:0:540:1080',
      false,
      '690:0:540:1080',
    ],
    [
      'a zoompan crop at a ratio that is not a whole number of pixels',
      '0:0:800:100',
      '0:0:400:42',
      false,
      '0:8:800:84',
    ],
  ])('gives %s', (_case, ownCrop, crop, panOnly, expected) => {
    const point: CropPoint = { x: 1, y: 0, crop, hold: true, ownCrop };
    const pair = { cropRes: '1920x1080', enableZoomPan: !panOnly };
    expect(ownCropToRelease(point, pair)).toBe(expected);
  });

  it('gives nothing for a hold point added as one, which keeps the crop it holds', () => {
    const point: CropPoint = { x: 1, y: 0, crop: P, hold: true };
    expect(ownCropToRelease(point, { cropRes: '1920x1080', enableZoomPan: true })).toBeUndefined();
  });
});

describe('toggleHold', () => {
  it.each([
    ['A B', 1, true, 'A B(h){B}'],
    ['A B(h)', 1, true, 'A B'],
    ['A A(h){B}', 1, true, 'A A'],
    ['A B', 0, false, 'A B'],
  ])('%s at index %d returns %s and gives %s', (input, index, toggled, expected) => {
    const map = cropMap(input);
    expect(toggleHold(map, index)).toBe(toggled);
    expect(row(map)).toBe(expected);
  });

  it('gives a released hold point back its own crop', () => {
    const map = cropMap('A A(h){B}');
    toggleHold(map, 1, 'B');
    expect(row(map)).toBe('A B');
  });

  it('makes an instant point a hold point without its instant easing', () => {
    const map = cropMap('A B');
    map[1].easeIn = 'instant';
    toggleHold(map, 1);
    expect(map[1]).toEqual({ x: 1, y: 0, crop: 'B', hold: true, ownCrop: 'B' });
  });
});

describe('releaseMismatchedHolds', () => {
  it.each([
    ['A A(h)', 'A A(h)'],
    ['A B(h)', 'A B'],
    ['A B(h) B(h)', 'A B B(h)'],
    ['A B(h){C}', 'A B'],
    ['A(h) A(h)', 'A A(h)'],
  ])('%s loads as %s', (input, expected) => {
    const map = cropMap(input);
    releaseMismatchedHolds(map);
    expect(row(map)).toBe(expected);
  });
});
