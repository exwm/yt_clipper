const mockStats = { resolution: '1920x1080@30', fails: false };
// A seek coalescer with one seek in flight and the latest request held back, as seekToSafe is.
const mockSeeks = { current: 0, inFlight: false, pending: null as number | null, requested: [] as number[] };
const mockAppState = {
  video: Object.assign(new EventTarget(), { videoWidth: 1920, getCurrentTime: () => mockSeeks.current }),
  player: {
    getStatsForNerds: () => {
      if (mockStats.fails) throw new Error('player not ready');
      return { resolution: mockStats.resolution };
    },
  },
  videoInfo: {},
};
const mockPlatform = { current: 'youtube' };
const mockMeasured = { fps: null as number | null, isNew: false };
const mockNavigation = { isStaleVideo: false };
const mockFlashMessage = jest.fn();

jest.mock('../appState', () => ({ appState: mockAppState }));
jest.mock('../platforms/platforms', () => ({
  getPlatform: () => mockPlatform.current,
  VideoPlatforms: { youtube: 'youtube', yt_clipper: 'yt_clipper' },
}));
jest.mock('./presented-frame-clock', () => ({
  FRAMES_TO_TELL_NTSC_RATES: 60,
  getMeasuredFrameRate: () => mockMeasured.fps,
  getPresentedFrameTime: () => 90 / 30,
  isNewMeasuredFrameRate: () => mockMeasured.isNew,
}));
jest.mock('../platforms/navigation', () => ({
  get isStaleVideo() {
    return mockNavigation.isStaleVideo;
  },
}));
jest.mock('./video-frame-loop', () => ({ onVideoFrames: () => ({ stop: jest.fn() }) }));
jest.mock('../charts', () => ({ chartState: {} }));
jest.mock('../crop-overlay', () => ({ isDrawingCrop: false, isMouseManipulatingCrop: false }));
jest.mock('./util', () => ({
  blockEvent: jest.fn(),
  flashMessage: mockFlashMessage,
  seekBySafe: jest.fn(),
  getPendingSeekTime: () => mockSeeks.pending,
  seekToSafe: (_video: unknown, time: number) => {
    mockSeeks.requested.push(time);
    if (mockSeeks.inFlight) mockSeeks.pending = time;
    else Object.assign(mockSeeks, { inFlight: true, current: time });
  },
}));
jest.mock('./drag-recovery', () => ({ registerActiveDragCleanup: jest.fn() }));

const mockStorage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockStorage.set(key, value),
  },
});

import { followFrameRate, getFPS, seekByFrames, toggleFrameRateMeasurement } from './videoUtil';

describe('getFPS', () => {
  beforeEach(() => {
    // A new source each test, so the stats rate is read again.
    followFrameRate(mockAppState.video as never);
    mockAppState.video.dispatchEvent(new Event('emptied'));
    mockAppState.video.videoWidth = 1920;
    mockStats.resolution = '1920x1080@30';
    mockStats.fails = false;
    mockMeasured.isNew = false;
    mockNavigation.isStaleVideo = false;
    mockFlashMessage.mockClear();
  });

  it.each([
    [
      'a new measured rate it uses',
      'youtube',
      30000 / 1001,
      true,
      ['Measured the frame rate: 29.97 fps.'],
    ],
    ['a rate already announced', 'youtube', 30000 / 1001, false, []],
    ['a measured rate it ignores', 'youtube', 25, true, []],
    [
      'a new rate on another site',
      'yt_clipper',
      24000 / 1001,
      true,
      ['Measured the frame rate: 23.976 fps.'],
    ],
  ])('flashes %s', (_case, platform, measured, isNew, messages) => {
    mockPlatform.current = platform;
    mockMeasured.fps = measured;
    mockMeasured.isNew = isNew;
    getFPS();
    expect(mockFlashMessage.mock.calls.map(([message]) => message)).toEqual(messages);
  });

  it('uses but does not flash a rate while the page shows another video', () => {
    mockPlatform.current = 'yt_clipper';
    Object.assign(mockMeasured, { fps: 30, isNew: true });
    mockNavigation.isStaleVideo = true;
    expect(getFPS()).toBe(30);
    expect(mockFlashMessage).not.toHaveBeenCalled();
  });

  it('does not keep the default it falls back to while the player has no stats', () => {
    mockPlatform.current = 'youtube';
    mockMeasured.fps = 30000 / 1001;
    mockStats.fails = true;
    expect(getFPS()).toBe(60);
    mockStats.fails = false;
    expect(getFPS()).toBeCloseTo(30000 / 1001, 6);
  });

  it("reads YouTube's stats rate again for a new source", () => {
    mockPlatform.current = 'youtube';
    mockMeasured.fps = null;
    expect(getFPS()).toBe(30);
    mockStats.resolution = '1920x1080@60';
    expect(getFPS()).toBe(30);
    mockAppState.video.dispatchEvent(new Event('emptied'));
    expect(getFPS()).toBe(60);
  });

  it.each([
    ['YouTube, before any frame played', 'youtube', null, 30],
    ['YouTube, refined to 29.97 by played frames', 'youtube', 30000 / 1001, 30000 / 1001],
    ['YouTube, a measured rate far from its stats is ignored', 'youtube', 25, 30],
    ['another site, before any frame played', 'yt_clipper', null, 60],
    ['another site, measured', 'yt_clipper', 30, 30],
  ])('%s', (_case, platform, measured, expected) => {
    mockPlatform.current = platform;
    mockMeasured.fps = measured;
    expect(getFPS()).toBeCloseTo(expected, 6);
  });

  it.each([
    ['YouTube', 'youtube', 30000 / 1001, 30],
    ['another site', 'yt_clipper', 24, 60],
  ])(
    'on %s, turning measurement off uses the platform rate, saved, until turned back on',
    (_case, platform, measured, unmeasured) => {
      mockPlatform.current = platform;
      mockMeasured.fps = measured;
      expect(getFPS()).toBeCloseTo(measured, 6);

      toggleFrameRateMeasurement();
      expect(mockStorage.get('ytc-measure-frame-rate')).toBe('false');
      expect(getFPS()).toBe(unmeasured);
      expect(mockFlashMessage.mock.calls.at(-1)?.[0]).toBe(
        `Frame rate measurement off. Using ${unmeasured} fps.`
      );

      toggleFrameRateMeasurement();
      expect(mockStorage.get('ytc-measure-frame-rate')).toBe('true');
      expect(getFPS()).toBeCloseTo(measured, 6);
    }
  );

  it.each([
    ['YouTube', 'youtube', 30000 / 1001],
    ['another site', 'yt_clipper', 30],
  ])('on %s keeps the measured rate through a video size change', (_case, platform, measured) => {
    mockPlatform.current = platform;
    mockMeasured.fps = measured;
    getFPS();
    // A quality change resizes the video, which re-reads the platform's rate.
    mockAppState.video.videoWidth = 1280;
    expect(getFPS()).toBeCloseTo(measured, 6);
  });
});

describe('seekByFrames', () => {
  // Three quick wheel ticks while the first step's seek is in flight: the second and third are held
  // back, the latest replacing the one before. The third must chain from the second, not repeat it.
  it('steps three frames on three quick steps', () => {
    mockPlatform.current = 'yt_clipper';
    mockMeasured.fps = 30;
    Object.assign(mockSeeks, { current: 90 / 30, inFlight: false, pending: null, requested: [] });
    for (let i = 0; i < 3; i++) seekByFrames(1);
    expect(mockSeeks.requested.map((time) => Math.floor(time * 30))).toEqual([91, 92, 93]);
  });
});
