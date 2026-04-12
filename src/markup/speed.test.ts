import {
  getShortestActiveMarkerPair,
  getSpeedMapping,
  getInterpolatedSpeed,
  getMinterpFpsMulSuffix,
  cycleForceSetSpeedValueDown,
  toggleForceSetSpeed,
  toggleMarkerPairLoop,
  getIsMarkerLoopPreviewOn,
  toggleMarkerPairSpeedPreview,
  getIsSpeedPreviewOn,
  updateMarkerPairSpeed,
} from './speed';
import { appState } from './appState';

jest.mock('./save-load', () => ({
  isVariableSpeed: jest.fn((speedMap) => {
    if (speedMap.length < 2) return false;
    return speedMap.some((sp, i) => i < speedMap.length - 1 && sp.y !== speedMap[i + 1].y);
  }),
}));

jest.mock('./util/util', () => ({
  flashMessage: jest.fn(),
  roundValue: jest.fn((val, multiple, precision) => {
    return Number((Math.round(val / multiple) * multiple).toFixed(precision));
  }),
}));

jest.mock('./util/undoredo', () => ({
  getMarkerPairHistory: jest.fn((mp) => ({ ...mp })),
  saveMarkerPairHistory: jest.fn((draft, mp) => {
    Object.assign(mp, draft);
  }),
}));

jest.mock('immer', () => ({
  createDraft: jest.fn((obj) => ({ ...obj, speedMap: [...obj.speedMap] })),
}));

jest.mock('d3-ease', () => ({
  easeCubicInOut: jest.fn((t) => t * t * (3 - 2 * t)),
}));

// Node test environment lacks requestAnimationFrame
globalThis.requestAnimationFrame = jest.fn() as any;

beforeEach(() => {
  appState.video = {
    getCurrentTime: () => 5,
    playbackRate: 1,
    paused: false,
    seeking: false,
  } as any;
  appState.markerPairs = [];
  appState.isSettingsEditorOpen = false;
  appState.wasGlobalSettingsEditorOpen = false;
  appState.prevSelectedMarkerPairIndex = null as any;
  appState.settings = { cropResWidth: 1920, cropResHeight: 1080 } as any;
  appState.easingMode = 'linear';
  appState.forceSetSpeedValue = 1;
  appState.isForceSetSpeedOn = false;
  appState.speedInputLabel = null;
  appState.minterpFpsMulLabelSpan = null;
  appState.speedInput = null;
});

describe('getShortestActiveMarkerPair', () => {
  test.each([
    { desc: 'no marker pairs', pairs: [], time: 5, expected: null },
    {
      desc: 'one containing pair',
      pairs: [{ start: 0, end: 10 }],
      time: 5,
      expected: { start: 0, end: 10 },
    },
    {
      desc: 'multiple pairs, returns shortest',
      pairs: [
        { start: 0, end: 20 },
        { start: 3, end: 8 },
        { start: 1, end: 15 },
      ],
      time: 5,
      expected: { start: 3, end: 8 },
    },
    {
      desc: 'time outside all pairs',
      pairs: [{ start: 10, end: 20 }],
      time: 5,
      expected: null,
    },
  ])('$desc', ({ pairs, time, expected }) => {
    appState.markerPairs = pairs as any;
    appState.video = { getCurrentTime: () => time } as any;
    const result = getShortestActiveMarkerPair();
    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toMatchObject(expected);
    }
  });

  it('prefers selected marker pair when editor is open', () => {
    appState.isSettingsEditorOpen = true;
    appState.wasGlobalSettingsEditorOpen = false;
    appState.prevSelectedMarkerPairIndex = 1;
    appState.markerPairs = [
      { start: 0, end: 20 },
      { start: 3, end: 8 },
      { start: 1, end: 15 },
    ] as any;
    appState.video = { getCurrentTime: () => 5 } as any;
    const result = getShortestActiveMarkerPair();
    expect(result).toMatchObject({ start: 3, end: 8 });
  });
});

describe('getSpeedMapping', () => {
  test.each([
    {
      desc: 'constant speed (2 equal points)',
      speedMap: [
        { x: 0, y: 2 },
        { x: 10, y: 2 },
      ],
      time: 5,
      expected: 2,
    },
    {
      desc: 'returns 1 when time outside range',
      speedMap: [
        { x: 0, y: 2 },
        { x: 3, y: 1 },
      ],
      time: 5,
      expected: 1,
    },
  ])('$desc', ({ speedMap, time, expected }) => {
    appState.video = { getCurrentTime: () => time } as any;
    expect(getSpeedMapping(speedMap, time)).toBe(expected);
  });

  it('returns left.y when left and right speeds are equal', () => {
    const speedMap = [
      { x: 0, y: 2 },
      { x: 5, y: 2 },
      { x: 10, y: 3 },
    ];
    appState.video = { getCurrentTime: () => 3 } as any;
    expect(getSpeedMapping(speedMap, 3)).toBe(2);
  });
});

describe('getInterpolatedSpeed', () => {
  it('interpolates linearly', () => {
    appState.easingMode = 'linear';
    const left = { x: 0, y: 1 };
    const right = { x: 10, y: 3 };
    // At time=5, linear: 50% → speed = 1 + 2*0.5 = 2
    const result = getInterpolatedSpeed(left, right, 5, 0, 2);
    expect(result).toBe(2);
  });

  it('interpolates with cubicInOut easing', () => {
    appState.easingMode = 'cubicInOut';
    const left = { x: 0, y: 1 };
    const right = { x: 10, y: 3 };
    const result = getInterpolatedSpeed(left, right, 5, 0, 2);
    // cubicInOut(0.5) ≈ 0.5 for our mock: 0.5*0.5*(3-2*0.5) = 0.5
    expect(result).toBe(2);
  });
});

describe('getMinterpFpsMulSuffix', () => {
  test.each([
    { mul: 2, speed: 1, expected: ' (2x)' },
    { mul: 0, speed: 1, expected: '' },
    { mul: 3, speed: 1.5, expected: ' (2x)' },
    { mul: 1, speed: 3, expected: '' },
  ])('mul=$mul, speed=$speed → "$expected"', ({ mul, speed, expected }) => {
    expect(getMinterpFpsMulSuffix(mul, speed)).toBe(expected);
  });
});

describe('toggles', () => {
  it('toggleMarkerPairLoop toggles state', () => {
    expect(getIsMarkerLoopPreviewOn()).toBe(false);
    toggleMarkerPairLoop();
    expect(getIsMarkerLoopPreviewOn()).toBe(true);
    toggleMarkerPairLoop();
    expect(getIsMarkerLoopPreviewOn()).toBe(false);
  });

  it('toggleMarkerPairSpeedPreview toggles state', () => {
    expect(getIsSpeedPreviewOn()).toBe(false);
    toggleMarkerPairSpeedPreview();
    expect(getIsSpeedPreviewOn()).toBe(true);
    toggleMarkerPairSpeedPreview();
    expect(getIsSpeedPreviewOn()).toBe(false);
  });
});

describe('cycleForceSetSpeedValueDown', () => {
  test.each([
    { initial: 1, expected: 0.75 },
    { initial: 0.5, expected: 0.25 },
    { initial: 0.25, expected: 1 },
  ])('$initial → $expected', ({ initial, expected }) => {
    appState.forceSetSpeedValue = initial;
    cycleForceSetSpeedValueDown();
    expect(appState.forceSetSpeedValue).toBe(expected);
  });
});

describe('toggleForceSetSpeed', () => {
  it('toggles on and off', () => {
    expect(appState.isForceSetSpeedOn).toBe(false);
    toggleForceSetSpeed();
    expect(appState.isForceSetSpeedOn).toBe(true);
    toggleForceSetSpeed();
    expect(appState.isForceSetSpeedOn).toBe(false);
  });
});

describe('updateMarkerPairSpeed', () => {
  it('updates speed and speedMap', () => {
    const mp = {
      speed: 1,
      speedMap: [
        { x: 0, y: 1 },
        { x: 10, y: 1 },
      ],
    } as any;
    updateMarkerPairSpeed(mp, 2);
    expect(mp.speed).toBe(2);
    expect(mp.speedMap[0].y).toBe(2);
    expect(mp.speedMap[1].y).toBe(2);
  });
});
