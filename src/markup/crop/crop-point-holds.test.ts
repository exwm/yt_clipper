import { produce } from 'immer';
import { CropPoint } from '../@types/yt_clipper';
import { releaseHoldIfChanged, releaseMismatchedHolds, resolveHeldCrops } from './crop-point-holds';

// Rows write a crop map as letters for crops and `(h)` for a hold point: 'A B(h)'. The functions
// only compare crop text, so a letter stands in for a crop string.
function cropMap(row: string): CropPoint[] {
  return row.split(' ').map((token, i) => {
    const point: CropPoint = { x: i, y: 0, crop: token.replace('(h)', '') };
    if (token.endsWith('(h)')) point.hold = true;
    return point;
  });
}

function row(map: CropPoint[]): string {
  return map.map((point) => point.crop + (point.hold ? '(h)' : '')).join(' ');
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

describe('releaseMismatchedHolds', () => {
  it.each([
    ['A A(h)', 'A A(h)'],
    ['A B(h)', 'A B'],
    ['A B(h) B(h)', 'A B B(h)'],
    ['A(h) A(h)', 'A A(h)'],
  ])('%s loads as %s', (input, expected) => {
    const map = cropMap(input);
    releaseMismatchedHolds(map);
    expect(row(map)).toBe(expected);
  });
});
