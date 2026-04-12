import {
  getCropComponents,
  getVideoScaledCropComponents,
  getVideoScaledCropComponentsFromCropString,
  rotateCropComponentsClockWise,
  rotateCropComponentsCounterClockWise,
  getRotatedCropComponents,
  getRotatedCropString,
  getNumericCropString,
  isStaticCrop,
  cropStringsEqual,
  getCropMultiples,
  multiplyCropString,
} from './crop-utils';
import { appState } from './appState';

beforeEach(() => {
  appState.settings = {
    cropResWidth: 1920,
    cropResHeight: 1080,
    cropRes: '1920x1080',
    newMarkerCrop: '0:0:iw:ih',
  } as any;
  appState.isSettingsEditorOpen = false;
  appState.wasGlobalSettingsEditorOpen = false;
  appState.prevSelectedMarkerPairIndex = null as any;
  appState.markerPairs = [];
  appState.rotation = 0;
  appState.video = { videoWidth: 1920, videoHeight: 1080 } as any;
});

describe('getCropComponents', () => {
  test.each([
    ['100:200:800:600', [100, 200, 800, 600], 'numeric'],
    ['0:0:iw:ih', [0, 0, 1920, 1080], 'iw/ih resolved'],
    ['2000:1200:2500:1500', [1920, 1080, 1920, 1080], 'clamped to res'],
    ['10.7:20.3:100.5:200.9', [11, 20, 101, 201], 'floats rounded'],
  ])('%s → %j (%s)', (input, expected) => {
    expect(getCropComponents(input)).toEqual(expected);
  });

  it('falls back to 0:0:iw:ih when no cropString and editor not open', () => {
    expect(getCropComponents()).toEqual([0, 0, 1920, 1080]);
  });

  it('uses newMarkerCrop when global settings editor is open', () => {
    appState.isSettingsEditorOpen = true;
    appState.wasGlobalSettingsEditorOpen = true;
    appState.settings.newMarkerCrop = '50:50:960:540';
    expect(getCropComponents()).toEqual([50, 50, 960, 540]);
  });

  it('uses marker pair crop when marker pair editor is open', () => {
    appState.isSettingsEditorOpen = true;
    appState.wasGlobalSettingsEditorOpen = false;
    appState.prevSelectedMarkerPairIndex = 0;
    appState.markerPairs = [{ crop: '100:100:400:300' } as any];
    expect(getCropComponents()).toEqual([100, 100, 400, 300]);
  });
});

describe('getVideoScaledCropComponents', () => {
  test.each([
    {
      videoW: 1920,
      videoH: 1080,
      input: [0, 0, 1920, 1080],
      expected: [0, 0, 1920, 1080],
      desc: '1:1 ratio',
    },
    {
      videoW: 3840,
      videoH: 2160,
      input: [0, 0, 960, 540],
      expected: [0, 0, 1920, 1080],
      desc: '2x upscale',
    },
    {
      videoW: 3840,
      videoH: 2160,
      input: [100, 200, 960, 540],
      expected: [200, 400, 1920, 1080],
      desc: '2x with offset',
    },
  ])('$desc', ({ videoW, videoH, input, expected }) => {
    appState.video = { videoWidth: videoW, videoHeight: videoH } as any;
    expect(getVideoScaledCropComponents(input)).toEqual(expected);
  });
});

describe('getVideoScaledCropComponentsFromCropString', () => {
  it('parses string then scales', () => {
    appState.video = { videoWidth: 3840, videoHeight: 2160 } as any;
    expect(getVideoScaledCropComponentsFromCropString('100:200:960:540')).toEqual([
      200, 400, 1920, 1080,
    ]);
  });
});

describe('rotation', () => {
  test.each([
    { fn: 'clockwise', input: [100, 200, 800, 600], max: 1080, expected: [280, 100, 600, 800] },
    { fn: 'clockwise', input: [0, 0, 1920, 1080], max: undefined, expected: [0, 0, 1080, 1920] },
    {
      fn: 'counter-clockwise',
      input: [100, 200, 800, 600],
      max: 1920,
      expected: [200, 1020, 600, 800],
    },
    {
      fn: 'counter-clockwise',
      input: [0, 0, 1920, 1080],
      max: undefined,
      expected: [0, 0, 1080, 1920],
    },
  ])('$fn $input (max=$max) → $expected', ({ fn, input, max, expected }) => {
    const rotate =
      fn === 'clockwise' ? rotateCropComponentsClockWise : rotateCropComponentsCounterClockWise;
    expect(rotate(input, max)).toEqual(expected);
  });

  it.each([0, 90, -90])('getRotatedCropComponents with rotation=%i', (rotation) => {
    appState.rotation = rotation;
    const result = getRotatedCropComponents([100, 200, 800, 600]);
    if (rotation === 0) expect(result).toEqual([100, 200, 800, 600]);
    else if (rotation === 90)
      expect(result).toEqual(rotateCropComponentsClockWise([100, 200, 800, 600]));
    else expect(result).toEqual(rotateCropComponentsCounterClockWise([100, 200, 800, 600]));
  });

  test.each([
    { rotation: 0, input: '100:200:800:600', expected: '100:200:800:600' },
    { rotation: 90, input: '100:200:800:600', expected: '280:100:600:800' },
  ])('getRotatedCropString with rotation=$rotation', ({ rotation, input, expected }) => {
    appState.rotation = rotation;
    expect(getRotatedCropString(input)).toBe(expected);
  });
});

describe('getNumericCropString', () => {
  test.each([
    ['0:0:iw:ih', '0:0:1920:1080'],
    ['100:200:800:600', '100:200:800:600'],
  ])('%s → %s', (input, expected) => {
    expect(getNumericCropString(input)).toBe(expected);
  });
});

describe('isStaticCrop', () => {
  test.each([
    { crops: ['0:0:1920:1080', '0:0:iw:ih'], expected: true, desc: 'equal 2-point' },
    { crops: ['0:0:1920:1080', '100:100:800:600'], expected: false, desc: 'different 2-point' },
    {
      crops: ['0:0:1920:1080', '0:0:1920:1080', '0:0:1920:1080'],
      expected: false,
      desc: '3-point',
    },
  ])('$desc → $expected', ({ crops, expected }) => {
    const cropMap = crops.map((crop, i) => ({ crop, time: i * 5 })) as any;
    expect(isStaticCrop(cropMap)).toBe(expected);
  });
});

describe('cropStringsEqual', () => {
  test.each([
    ['100:200:800:600', '100:200:800:600', true],
    ['0:0:iw:ih', '0:0:1920:1080', true],
    ['0:0:1920:1080', '100:100:800:600', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(cropStringsEqual(a, b)).toBe(expected);
  });
});

describe('getCropMultiples', () => {
  test.each([
    { from: '960x540', to: '1920x1080', mx: 2, my: 2 },
    { from: '1920x1080', to: '960x540', mx: 0.5, my: 0.5 },
    { from: '1920x1080', to: '1280x1080', mx: 1280 / 1920, my: 1 },
  ])('$from → $to', ({ from, to, mx, my }) => {
    const result = getCropMultiples(from, to);
    expect(result.cropMultipleX).toBeCloseTo(mx);
    expect(result.cropMultipleY).toBeCloseTo(my);
  });
});

describe('multiplyCropString', () => {
  test.each([
    [2, 2, '100:200:400:300', '200:400:800:600'],
    [2, 2, '0:0:iw:600', '0:0:iw:1200'],
    [2, 2, '0:0:400:ih', '0:0:800:ih'],
    [1.5, 1.5, '100:200:300:400', '150:300:450:600'],
  ])('(%sx, %sy) %s → %s', (mx, my, input, expected) => {
    expect(multiplyCropString(mx, my, input)).toBe(expected);
  });
});
