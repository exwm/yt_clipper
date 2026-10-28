const mockStats = { resolution: '1920x1080@30', fails: false };
// A seek coalescer with one seek in flight and the latest request held back, as seekToSafe is.
const mockSeeks = {
  current: 0,
  inFlight: false,
  pending: null as number | null,
  requested: [] as number[],
};
const mockAppState = {
  video: Object.assign(new EventTarget(), {
    videoWidth: 1920,
    duration: 3600,
    getCurrentTime: () => mockSeeks.current,
    get seeking() {
      return mockSeeks.inFlight;
    },
    requestVideoFrameCallback: jest.fn() as ((callback: unknown) => number) | undefined,
  }),
  player: {
    getStatsForNerds: () => {
      if (mockStats.fails) throw new Error('player not ready');
      return { resolution: mockStats.resolution };
    },
  },
  videoInfo: {},
  settings: { videoID: 'markup-video' },
};
const mockPlatform = { current: 'youtube' };
// `isNew`: whether the clock would announce a rate it hasn't announced yet.
const mockMeasured = { fps: null as number | null, isNew: false, announced: new Set<number>() };
const mockNavigation = { isStaleVideo: false, pageVideoID: 'markup-video' as string | null };
const mockFlashMessage = jest.fn();

jest.mock('../appState', () => ({ appState: mockAppState }));
jest.mock('../platforms/platforms', () => ({
  getPlatform: () => mockPlatform.current,
  VideoPlatforms: { youtube: 'youtube', yt_clipper: 'yt_clipper' },
}));
// The frame on screen. By default frame 90, shown before the steps' seeks, which stay in flight.
const mockScreen = { mediaTime: null as number | null, isCurrent: null as boolean | null };
jest.mock('./presented-frame-clock', () => ({
  getMeasuredFrameRate: () => mockMeasured.fps,
  getPresentedFrameTime: () => mockScreen.mediaTime ?? 90 / 30,
  isPresentedSinceSeek: () => mockScreen.isCurrent ?? mockSeeks.requested.length === 0,
  isNewMeasuredFrameRate: (_video: unknown, rate: number) => {
    const isNew = mockMeasured.isNew && !mockMeasured.announced.has(rate);
    mockMeasured.announced.add(rate);
    return isNew;
  },
}));
jest.mock('../platforms/navigation', () => ({
  get isStaleVideo() {
    return mockNavigation.isStaleVideo;
  },
  getCurrentPageVideoID: () => mockNavigation.pageVideoID,
}));
// The frame rate consumer followFrameRate subscribes, called by `playFrame`.
const mockFrames = { onFrame: null as (() => void) | null };
jest.mock('./video-frame-loop', () => ({
  onVideoFrames: (_video: unknown, onFrame: () => void) => {
    mockFrames.onFrame = onFrame;
    return { stop: jest.fn() };
  },
}));
const playFrame = () => mockFrames.onFrame?.();
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

import {
  describeFrameRate,
  followFrameRate,
  getFPS,
  getFrameTime,
  seekByFrames,
  seekToFrameAt,
  toggleFrameRateMeasurement,
} from './videoUtil';
import { seekBySafe } from './util';

describe('getFPS', () => {
  beforeEach(() => {
    // A new source each test, so the stats rate is read again.
    followFrameRate(mockAppState.video as never);
    mockAppState.video.dispatchEvent(new Event('emptied'));
    mockAppState.video.videoWidth = 1920;
    mockStats.resolution = '1920x1080@30';
    mockStats.fails = false;
    mockMeasured.isNew = false;
    mockMeasured.announced.clear();
    mockNavigation.isStaleVideo = false;
    mockNavigation.pageVideoID = 'markup-video';
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
  ])(
    'flashes %s on the next played frame, never on a read',
    (_case, platform, measured, isNew, messages) => {
      mockPlatform.current = platform;
      mockMeasured.fps = measured;
      mockMeasured.isNew = isNew;
      getFPS();
      expect(mockFlashMessage).not.toHaveBeenCalled();
      playFrame();
      expect(mockFlashMessage.mock.calls.map(([message]) => message)).toEqual(messages);
    }
  );

  // History forward on YouTube: the next video's rate is measured before the navigation finishes.
  it('does not flash a rate measured on another video before the page is marked stale', () => {
    mockPlatform.current = 'youtube';
    Object.assign(mockMeasured, { fps: 30, isNew: true });
    mockNavigation.pageVideoID = 'next-video';
    playFrame();
    expect(mockFlashMessage).not.toHaveBeenCalled();
  });
  it('uses but does not flash a rate while the page shows another video', () => {
    mockPlatform.current = 'yt_clipper';
    Object.assign(mockMeasured, { fps: 30, isNew: true });
    mockNavigation.isStaleVideo = true;
    playFrame();
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

  // Between a new source's `emptied` and its `loadedmetadata` the stats can still be the old video's:
  // a rate read then is used but not kept.
  it("keeps YouTube's stats rate for a new source only once its metadata loads", () => {
    mockPlatform.current = 'youtube';
    mockMeasured.fps = null;
    const video = mockAppState.video;
    mockStats.resolution = '1920x1080@30';
    video.dispatchEvent(new Event('emptied'));
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(getFPS()).toBe(30);
    mockStats.resolution = '1920x1080@60';
    expect(getFPS()).toBe(30);
    // A new video at 24 fps; the stats still show the old one's 60 at first.
    video.dispatchEvent(new Event('emptied'));
    expect(getFPS()).toBe(60);
    mockStats.resolution = '1920x1080@24';
    expect(getFPS()).toBe(24);
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(getFPS()).toBe(24);
    mockStats.resolution = '1920x1080@60';
    expect(getFPS()).toBe(24);
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

  it('flashes a measured rate once when turning measurement on names it', () => {
    mockPlatform.current = 'yt_clipper';
    Object.assign(mockMeasured, { fps: 30, isNew: true });
    toggleFrameRateMeasurement();
    toggleFrameRateMeasurement();
    playFrame();
    expect(mockFlashMessage.mock.calls.map(([message]) => message)).toEqual([
      'Frame rate measurement off. Using 60 fps.',
      'Frame rate measurement on. Using 30 fps.',
    ]);
  });

  describe('the Frame Rate field in the global settings', () => {
    const fields = { open: null as { textContent: string } | null };
    beforeAll(() => {
      Object.assign(globalThis, {
        document: {
          getElementById: (id: string) => (id === 'global-frame-rate' ? fields.open : null),
        },
      });
    });
    afterAll(() => {
      delete (globalThis as { document?: unknown }).document;
    });

    it('shows the rate in use, after the editor closes and opens again and after a toggle', () => {
      mockPlatform.current = 'yt_clipper';
      mockMeasured.fps = null;
      fields.open = { textContent: '' };
      playFrame();
      expect(fields.open.textContent).toBe('60 fps (assumed)');

      fields.open = null;
      mockMeasured.fps = 30;
      playFrame();
      // The editor opens again with the text it last read.
      fields.open = { textContent: '60 fps (assumed)' };
      // Paused: the next refresh comes from an event, not a frame.
      mockAppState.video.dispatchEvent(new Event('resize'));
      expect(fields.open.textContent).toBe('30 fps (measured)');

      toggleFrameRateMeasurement();
      expect(fields.open.textContent).toBe('60 fps (assumed)');
      toggleFrameRateMeasurement();
      expect(fields.open.textContent).toBe('30 fps (measured)');
    });

    it("drops the old video's rate on a new source before its first frame", () => {
      mockPlatform.current = 'yt_clipper';
      mockMeasured.fps = 30;
      fields.open = { textContent: '' };
      playFrame();
      mockMeasured.fps = null;
      mockAppState.video.dispatchEvent(new Event('emptied'));
      expect(fields.open.textContent).toBe('60 fps (assumed)');
    });
  });

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

  describe('between steps and jumps', () => {
    const frame = (n: number) => n / 30;
    // Paused on frame `n` of a 30 fps video, at the rate in use `fps` (60: assumed).
    function pausedOn(n: number, fps: 30 | 60) {
      mockPlatform.current = 'yt_clipper';
      mockMeasured.fps = fps === 30 ? 30 : null;
      Object.assign(mockSeeks, { current: (n + 0.5) / 30, inFlight: false, pending: null });
      mockSeeks.requested = [];
      Object.assign(mockScreen, { mediaTime: frame(n), isCurrent: true });
    }
    // The seek in flight finishes and its frame shows.
    function land() {
      mockSeeks.inFlight = false;
      const shown = Math.floor(mockSeeks.current * 30 + 1e-9);
      Object.assign(mockScreen, { mediaTime: frame(shown), isCurrent: true });
    }
    const lastShown = () => Math.floor(mockSeeks.requested.at(-1)! * 30 + 1e-9);
    afterEach(() => Object.assign(mockScreen, { mediaTime: null, isCurrent: null }));

    it.each([
      ['its frame shown', true],
      ['its frame not shown yet', false],
    ])('steps on from the frame a jump went to, %s', (_case, hasLanded) => {
      pausedOn(90, 30);
      seekByFrames(1);
      land();
      seekToFrameAt(frame(120));
      mockScreen.isCurrent = false;
      if (hasLanded) land();
      seekByFrames(1);
      expect(lastShown()).toBe(121);
    });

    it("reads a jump's placed time after a step, and steps on from its frame", () => {
      pausedOn(90, 30);
      seekByFrames(1);
      land();
      // A marker 1.5 ms before its frame's end.
      const markerTime = frame(181) - 0.0015;
      seekToFrameAt(markerTime);
      mockScreen.isCurrent = false;
      expect(getFrameTime()).toBe(markerTime);
      land();
      expect(getFrameTime()).toBe(markerTime);
      seekByFrames(1);
      land();
      expect(lastShown()).toBe(181);
      expect(getFrameTime()).toBe(frame(181));
    });

    // At the assumed 60 fps a step can stay on the same video frame; the time read is that frame's.
    it('reads the frame on screen after steps at a rate above the video', () => {
      pausedOn(90, 60);
      const shown: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < 2; i++) {
        seekByFrames(1);
        land();
        shown.push(lastShown());
        times.push(getFrameTime());
      }
      expect(shown).toEqual([90, 91]);
      expect(times).toEqual([frame(90), frame(91)]);
    });
  });

  it('steps by frame durations from the playhead in a browser without frame callbacks', () => {
    mockPlatform.current = 'yt_clipper';
    mockMeasured.fps = 30;
    const { requestVideoFrameCallback } = mockAppState.video;
    mockAppState.video.requestVideoFrameCallback = undefined;
    try {
      seekByFrames(-2);
      expect(seekBySafe).toHaveBeenLastCalledWith(mockAppState.video, -2 / 30);
    } finally {
      mockAppState.video.requestVideoFrameCallback = requestVideoFrameCallback;
    }
  });
});

describe('describeFrameRate', () => {
  it.each([
    [{ rate: 30000 / 1001, source: 'measured' }, '29.97 fps (measured)'],
    [{ rate: 30, source: 'platform' }, "30 fps (the platform's)"],
    [{ rate: 60, source: 'default' }, '60 fps (assumed)'],
  ] as const)('%j', (frameRate, text) => {
    expect(describeFrameRate(frameRate)).toBe(text);
  });
});
