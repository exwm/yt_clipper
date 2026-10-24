import { cropPreviewSize } from './crop-preview-size';

describe('cropPreviewSize', () => {
  it.each([
    [
      'a whole-pixel crop as it is',
      640,
      360,
      0,
      { drawW: 640, drawH: 360, canvasW: 640, canvasH: 360 },
    ],
    [
      'a fractional crop rounded',
      640.6,
      359.4,
      0,
      { drawW: 641, drawH: 359, canvasW: 641, canvasH: 359 },
    ],
    [
      'turned a quarter clockwise',
      640,
      360,
      90,
      { drawW: 640, drawH: 360, canvasW: 360, canvasH: 640 },
    ],
    [
      'turned a quarter anticlockwise',
      640,
      360,
      -90,
      { drawW: 640, drawH: 360, canvasW: 360, canvasH: 640 },
    ],
    [
      'upside down, not turned',
      640,
      360,
      180,
      { drawW: 640, drawH: 360, canvasW: 640, canvasH: 360 },
    ],
    [
      'a sliver, never below one pixel',
      0.2,
      0.4,
      0,
      { drawW: 1, drawH: 1, canvasW: 1, canvasH: 1 },
    ],
  ])('sizes %s', (_name, w, h, rotation, expected) => {
    expect(cropPreviewSize(w, h, rotation)).toEqual(expected);
  });
});
