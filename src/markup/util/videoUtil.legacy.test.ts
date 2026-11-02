// The shell with every frame decision group on 5.48's release: it reads, seeks and steps as 5.48
// did, and never measures the frame rate.
import { useFrameTiming } from './frame-timing-mode.fixtures';
useFrameTiming('5.48');

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
    currentTime: 0,
    paused: true,
    playbackRate: 1,
    getCurrentTime: () => mockSeeks.current,
    get seeking() {
      return mockSeeks.inFlight;
    },
    requestVideoFrameCallback: jest.fn(),
  }),
  player: {},
  videoInfo: {},
  settings: { videoID: 'markup-video' },
};
const mockMeasuredFps = { current: 30 as number | null };

jest.mock('../appState', () => ({ appState: mockAppState }));
jest.mock('../platforms/platforms', () => ({
  getPlatform: () => 'yt_clipper',
  VideoPlatforms: { youtube: 'youtube', yt_clipper: 'yt_clipper' },
}));
jest.mock('./presented-frame-clock', () => ({
  getMeasuredFrameRate: () => mockMeasuredFps.current,
  // A frame on screen 20 ms before the playhead, read at `seeked`: 5.49 would place there.
  getFrameOnScreen: () => ({ mediaTime: mockSeeks.current - 0.02, isRead: true, isCurrent: true }),
  getHeldFrame: () => null,
  isNewMeasuredFrameRate: () => false,
}));
jest.mock('../platforms/navigation', () => ({
  isStaleVideo: false,
  getCurrentPageVideoID: () => 'markup-video',
}));
jest.mock('./video-frame-loop', () => ({ onVideoFrames: () => ({ stop: jest.fn() }) }));
jest.mock('../charts', () => ({ chartState: {} }));
jest.mock('../crop-overlay', () => ({ isDrawingCrop: false, isMouseManipulatingCrop: false }));
jest.mock('./util', () => ({
  // The pure helpers, for the crop easing.
  ...jest.requireActual('./util'),
  blockEvent: jest.fn(),
  flashMessage: jest.fn(),
  seekBySafe: jest.fn(),
  getPendingSeekTime: () => mockSeeks.pending,
  seekToSafe: (_video: unknown, time: number) => {
    mockSeeks.requested.push(time);
  },
}));
jest.mock('./drag-recovery', () => ({ registerActiveDragCleanup: jest.fn() }));

// Measure saved as on, from a session without the flag.
Object.assign(globalThis, {
  localStorage: { getItem: () => 'true', setItem: jest.fn() },
});

import { splitAtInstantCuts } from '../crop/cinematic-path';
import { easedCropAtTime } from '../crop/parity-sampling';
import { createShortcutDefinitions, ShortcutDeps } from '../shortcut-definitions';
import { frameTiming } from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { seekBySafe } from './util';
import {
  frameStartOf,
  getFPS,
  getFrameRate,
  getFrameTime,
  getScreenFrame,
  isFrameRateMeasured,
  loopPlaybackOver,
  seekByFrames,
  seekToFrameAt,
} from './videoUtil';

function givenThePlayheadAt(seconds: number, pending: number | null = null) {
  Object.assign(mockSeeks, { current: seconds, inFlight: false, pending, requested: [] });
  mockAppState.video.currentTime = seconds;
}

describe("the shell under 5.48's frame timing", () => {
  it('uses the 5.48 frame timing', () => {
    expect(Object.keys(frameTiming).sort()).toEqual(Object.keys(frameTiming548).sort());
    for (const [name, decision] of Object.entries(frameTiming548)) {
      expect(frameTiming[name as keyof typeof frameTiming]).toBe(decision);
    }
  });

  it('ignores a saved Measure setting and a measured rate', () => {
    expect(isFrameRateMeasured()).toBe(false);
    expect(getFPS()).toBe(60);
    expect(getFrameRate()).toEqual({ rate: 60, source: 'default' });
    expect(getFrameRate(30)).toEqual({ rate: 30, source: 'default' });
  });

  it('places at the playhead, not the frame on screen or the seek held back', () => {
    givenThePlayheadAt(3.0123, 4);
    expect(getFrameTime()).toBe(3.0123);
    expect(getScreenFrame().start).toBe(3.0123);
  });

  it('seeks to a placed time itself', () => {
    givenThePlayheadAt(1);
    seekToFrameAt(3.0123);
    expect(mockSeeks.requested).toEqual([3.0123]);
  });

  it('steps by a frame of the rate in use from the playhead, with frame callbacks too', () => {
    givenThePlayheadAt(3);
    seekByFrames(-2);
    expect(seekBySafe).toHaveBeenLastCalledWith(mockAppState.video, -2 / 60);
    expect(mockSeeks.requested).toEqual([]);
  });

  it('times a frame callback on a later part of a video on the platform timeline', () => {
    givenThePlayheadAt(100.52);
    mockAppState.video.currentTime = 0.52;
    expect(frameStartOf(0.5)).toBeCloseTo(100.5, 9);
  });

  it.each([
    ['past the end', 5.2, [1]],
    ['before the start, within half a frame', 1 - 0.008, []],
    ['before the start, more than half a frame', 1 - 0.009, [1]],
    ['inside', 3, []],
  ])('a loop over 1 s to 5 s with the playhead %s seeks to %j', (_case, playhead, seeks) => {
    givenThePlayheadAt(playhead);
    loopPlaybackOver(1, 5);
    expect(mockSeeks.requested).toEqual(seeks);
  });

  // 5.48's ease ends half a frame before the frame floor(end * fps), where 5.49 allows for a time
  // rounded just below a frame's start: at 1 s - 0.5 ms, frame 29 against 5.49's frame 30.
  it('eases a crop section as 5.48 did, in the preview and in the parity tables the clipper checks', () => {
    const end = 1 - 0.0005;
    expect(frameTiming.easeSectionDuration(0, end, 30)).toBeCloseTo(28.5 / 30, 9);
    const cropMap = [
      { x: 0, y: 0, crop: '0:0:100:100' },
      { x: end, y: 0, crop: '100:0:100:100' },
    ];
    // Past the 5.48 ease's end the crop is at the end point; 5.49 eases on until 29.5 / 30.
    expect(easedCropAtTime('smoothInOut', cropMap, 29 / 30)[0]).toBe(100);
  });

  it("snaps a Cinematic cut to the frame 5.48's ease ends on", () => {
    const cropMap = [
      { x: 0, y: 0, crop: '0:0:100:100' },
      { x: 1 - 0.0005, y: 0, crop: '100:0:100:100', easeIn: 'instant' as const },
    ];
    const [beforeCut] = splitAtInstantCuts(cropMap, 30);
    expect(beforeCut.at(-1)?.x).toBeCloseTo(28.5 / 30, 9);
  });

  it('offers no command to toggle frame rate measurement', () => {
    const deps = new Proxy({}, { get: () => () => false }) as ShortcutDeps;
    const ids = createShortcutDefinitions(deps).map((definition) => definition.id);
    expect(ids).toContain('showShortcutsReference');
    expect(ids).not.toContain('toggleFrameRateMeasurement');
  });
});
