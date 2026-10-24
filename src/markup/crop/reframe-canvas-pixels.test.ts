import { bandsAround, PixelRect, wholePixelsInside } from './reframe-canvas-pixels';

describe('wholePixelsInside', () => {
  it.each([
    ['a fractional rect, to the pixels it covers wholly', [10.4, 20.6, 100.2, 50.9], { x: 11, y: 21, width: 89, height: 29 }],
    // An edge within the slack of a whole pixel, on either side, leaves that pixel unclaimed: float
    // error must never claim a partly covered pixel.
    ['edges a hair past whole pixels', [9.9999, 19.9999, 100.0001, 50.0001], { x: 11, y: 21, width: 88, height: 28 }],
    ['edges a hair short of whole pixels', [10.0001, 20.0001, 99.9999, 49.9999], { x: 11, y: 21, width: 88, height: 28 }],
    ['a rect past the canvas, clipped to it', [-5, -5, 300, 300], { x: 0, y: 0, width: 200, height: 100 }],
    ['a rect thinner than a pixel', [10.2, 10, 10.8, 50], null],
    ['a rect outside the canvas', [250, 10, 260, 50], null],
  ] as [string, [number, number, number, number], PixelRect | null][])(
    'gives %s',
    (_, [left, top, right, bottom], expected) => {
      expect(wholePixelsInside(left, top, right, bottom, 200, 100)).toEqual(expected);
    }
  );
});

// Each pixel of the canvas counted by how many of the rects cover it.
function coverage(rects: PixelRect[], width: number, height: number): number[] {
  const counts = new Array(width * height).fill(0);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) counts[y * width + x]++;
    }
  }
  return counts;
}

describe('bandsAround', () => {
  const [width, height] = [40, 30];

  it.each([
    ['in the middle', { x: 10, y: 5, width: 20, height: 10 }, 4],
    ['against the top left corner', { x: 0, y: 0, width: 20, height: 10 }, 2],
    ['a pixel from the left and bottom edges', { x: 1, y: 5, width: 20, height: 24 }, 4],
    ['across the full width', { x: 0, y: 5, width: 40, height: 10 }, 2],
    ['over the whole canvas', { x: 0, y: 0, width: 40, height: 30 }, 0],
  ] as [string, PixelRect, number][])(
    'covers the canvas once with the hole %s, in %d bands',
    (_, hole, bandCount) => {
      const bands = bandsAround(hole, width, height);
      expect(bands).toHaveLength(bandCount);
      expect(new Set(coverage([...bands, hole], width, height))).toEqual(new Set([1]));
    }
  );

  it('fills the whole canvas when there is no hole', () => {
    expect(bandsAround(null, width, height)).toEqual([{ x: 0, y: 0, width, height }]);
  });
});
