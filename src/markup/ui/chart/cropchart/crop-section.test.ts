import { cropSectionColor, cropZoomWidth, getCropSectionInfo } from './crop-section';

const CROP_RES_W = 1920;
const CROP_RES_H = 1080;

const info = (left: string, right: string, lt = 0, rt = 1) =>
  getCropSectionInfo(left, right, lt, rt, CROP_RES_W, CROP_RES_H);

describe('getCropSectionInfo', () => {
  it('classifies an unchanged crop as static with zero velocity', () => {
    const { type, velocity } = info('100:100:960:540', '100:100:960:540');
    expect(type).toBe('static');
    expect(velocity).toBe(0);
  });

  it('resolves the literal iw/ih tokens of a fresh default crop instead of producing NaN', () => {
    const { type, velocity, leftSize, rightSize } = info('0:0:iw:ih', '0:0:iw:ih');
    expect(type).toBe('static');
    expect(velocity).toBe(0);
    expect(leftSize).toBeCloseTo(1, 6);
    expect(rightSize).toBeCloseTo(1, 6);
  });

  it('classifies a position-only change as pan', () => {
    const { type, velocity } = info('100:100:960:540', '300:100:960:540');
    expect(type).toBe('pan');
    expect(velocity).toBeGreaterThan(0);
  });

  it('classifies a centered size change as zoom (corner-anchored is panzoom)', () => {
    expect(info('0:0:1920:1080', '480:270:960:540').type).toBe('zoom'); // center fixed
    expect(info('0:0:1920:1080', '0:0:960:540').type).toBe('panzoom'); // corner fixed, center moves
  });

  it('classifies a combined center and size change as panzoom', () => {
    expect(info('100:100:960:540', '500:300:640:360').type).toBe('panzoom');
  });

  it('absorbs a few percent of center drift so a near-centered zoom counts as zoom', () => {
    expect(info('0:0:1000:1000', '251:251:500:500').type).toBe('zoom');
  });

  it('scales velocity with magnitude and inversely with duration', () => {
    const small = info('100:100:960:540', '200:100:960:540', 0, 1).velocity;
    const large = info('100:100:960:540', '400:100:960:540', 0, 1).velocity;
    expect(large).toBeGreaterThan(small);

    const slow = info('100:100:960:540', '400:100:960:540', 0, 2).velocity;
    const fast = info('100:100:960:540', '400:100:960:540', 0, 1).velocity;
    expect(fast).toBeCloseTo(slow * 2, 6);
  });

  it('treats a zero-duration section as zero velocity (no divide-by-zero)', () => {
    const { velocity } = info('100:100:960:540', '400:200:640:360', 5, 5);
    expect(velocity).toBe(0);
    expect(Number.isFinite(velocity)).toBe(true);
  });

  it('reports endpoint sizes as sqrt of the area fraction', () => {
    const { leftSize, rightSize } = info('0:0:1920:1080', '480:270:960:540');
    expect(leftSize).toBeCloseTo(1, 6); // full frame
    expect(rightSize).toBeCloseTo(0.5, 6); // half in each dimension
  });
});

describe('cropSectionColor', () => {
  const rgba = (c: string) => c.match(/[\d.]+/g)!.map(Number);

  it('uses a distinct hue per type at speed', () => {
    const colors = [
      cropSectionColor('static', 0),
      cropSectionColor('pan', 1),
      cropSectionColor('zoom', 1),
      cropSectionColor('panzoom', 1),
    ];
    expect(new Set(colors).size).toBe(4);
  });

  it('fades toward grey and transparent for a slow section', () => {
    const slow = rgba(cropSectionColor('pan', 0.05));
    const fast = rgba(cropSectionColor('pan', 1));
    expect(Math.abs(slow[0] - 120)).toBeLessThan(Math.abs(fast[0] - 120)); // closer to grey
    expect(slow[3]).toBeLessThan(fast[3]); // and more transparent
  });
});

describe('cropZoomWidth', () => {
  it('is wider when zoomed out and narrower when zoomed in, within bounds', () => {
    expect(cropZoomWidth(1)).toBeGreaterThan(cropZoomWidth(0.5));
    expect(cropZoomWidth(0.5)).toBeGreaterThan(cropZoomWidth(0.1));
    expect(cropZoomWidth(0)).toBeGreaterThanOrEqual(2);
    expect(cropZoomWidth(5)).toBeLessThanOrEqual(12); // clamped
  });

  it('gives a continuous band: a shared point has one width across both adjacent sections', () => {
    // Section A ends at the crop S; section B starts at S. The shared point has a single size, so A's
    // right width equals B's left width and the band has no kink at the join.
    const a = info('0:0:1920:1080', '480:270:960:540');
    const b = info('480:270:960:540', '720:405:480:270', 1, 2);
    expect(cropZoomWidth(a.rightSize)).toBeCloseTo(cropZoomWidth(b.leftSize), 9);
    // And the taper points the right way: the more zoomed-in (smaller) crop is narrower.
    expect(cropZoomWidth(a.rightSize)).toBeLessThan(cropZoomWidth(a.leftSize));
  });
});
