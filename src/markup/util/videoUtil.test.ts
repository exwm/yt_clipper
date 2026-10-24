const mockAppState = {
  video: { videoWidth: 1920 },
  player: { getStatsForNerds: () => ({ resolution: '1920x1080@30' }) },
  videoInfo: { fps: undefined as number | undefined },
};
const mockPlatform = { current: 'youtube' };
const mockMeasured = { fps: null as number | null };

jest.mock('../appState', () => ({ appState: mockAppState }));
jest.mock('../platforms/platforms', () => ({
  getPlatform: () => mockPlatform.current,
  VideoPlatforms: { youtube: 'youtube', yt_clipper: 'yt_clipper' },
}));
jest.mock('./presented-frame-clock', () => ({
  FRAMES_TO_TELL_NTSC_RATES: 60,
  getMeasuredFrameRate: () => mockMeasured.fps,
}));
jest.mock('../charts', () => ({ chartState: {} }));
jest.mock('../crop-overlay', () => ({ isDrawingCrop: false, isMouseManipulatingCrop: false }));
jest.mock('./util', () => ({ blockEvent: jest.fn(), seekBySafe: jest.fn() }));
jest.mock('./drag-recovery', () => ({ registerActiveDragCleanup: jest.fn() }));

import { getFPS } from './videoUtil';

describe('getFPS', () => {
  beforeEach(() => {
    mockAppState.video.videoWidth = 1920;
    mockAppState.videoInfo.fps = undefined;
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
