import { Crop } from './crop';

describe('Crop.setCropStringSafe', () => {
  it.each([
    [884, 497],
    [887, 499],
    [1755, 987],
    [1758, 989],
    [1774, 998],
    [212, 119],
  ])(
    'keeps a %ix%i crop that already has its aspect ratio when the ratio is locked',
    (w, h) => {
      // w / (w / h) can land a hair under h, and the locked ratio used to floor it a pixel short.
      const crop = new Crop(300, 0, w, h, 1920, 1080);
      crop.setCropStringSafe(`100:20:${w}:${h}`, true);
      expect(crop.cropString).toBe(`100:20:${w}:${h}`);
    }
  );

  it('moves a minimum-size locked-ratio crop at the right edge back into the frame', () => {
    // Its height rounds under the minimum, and the width that height asks for passes the edge.
    const crop = new Crop(1884, 0, 36, 20, 1920, 1080);
    crop.setCropStringSafe('1887:0:33:18', true);
    const [x, y, w, h] = crop.cropString.split(':').map(Number);
    expect(x + w).toBeLessThanOrEqual(1920);
    expect(y + h).toBeLessThanOrEqual(1080);
    expect(Math.abs(w / h - 36 / 20)).toBeLessThan(0.1);
  });

  it('keeps a locked-ratio crop at the bottom edge inside the frame', () => {
    // A 9:16 crop near the bottom right, where the height its width asks for has no room left.
    const crop = new Crop(1695, 680, 225, 400, 1920, 1080);
    crop.setCropStringSafe('1736:754:184:326', true);
    const [x, y, w, h] = crop.cropString.split(':').map(Number);
    expect(x + w).toBeLessThanOrEqual(1920);
    expect(y + h).toBeLessThanOrEqual(1080);
    expect(Math.abs(w / h - 225 / 400)).toBeLessThan(0.01);
  });
});
