import type { VideoElement } from '../appState';
import {
  FRAMES_TO_TELL_NTSC_RATES,
  getMeasuredFrameRate,
  getPresentedFrameTime,
  isNewMeasuredFrameRate,
} from './presented-frame-clock';

// A video that presents frames on demand: present(t) runs the pending frame callbacks with mediaTime t.
function fakeVideo(currentTime = 0) {
  let callbacks: VideoFrameRequestCallback[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const video = {
    paused: false,
    seeking: false,
    playbackRate: 1,
    droppedVideoFrames: 0,
    totalVideoFrames: 0,
    currentTime,
    getCurrentTime: () => video.currentTime,
    getVideoPlaybackQuality: () => ({
      droppedVideoFrames: video.droppedVideoFrames,
      totalVideoFrames: video.totalVideoFrames,
    }),
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => callbacks.push(callback),
    addEventListener: (type: string, listener: () => void) =>
      (listeners[type] ??= []).push(listener),
    removeEventListener: (type: string, listener: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
  };
  let presentedFrames = 0;
  const present = (mediaTime: number) => {
    presentedFrames++;
    video.totalVideoFrames++;
    const pending = callbacks;
    callbacks = [];
    for (const callback of pending) {
      callback(0, { mediaTime, presentedFrames } as VideoFrameCallbackMetadata);
    }
  };
  // A frame presented while the page was too busy to run its callbacks.
  const miss = () => {
    presentedFrames++;
    video.totalVideoFrames++;
  };
  // A frame decoded but never shown, and not counted as dropped, as on a screen slower than the video.
  const unshown = () => video.totalVideoFrames++;
  const emit = (type: string) => listeners[type]?.forEach((listener) => listener());
  return { video, element: video as unknown as VideoElement, present, miss, unshown, emit };
}

describe('getPresentedFrameTime', () => {
  it('uses the playhead until a frame is presented', () => {
    const { element } = fakeVideo(4.2);
    expect(getPresentedFrameTime(element)).toBe(4.2);
  });

  it('keeps the frame on screen while a seek smaller than a frame moves the playhead', () => {
    const { video, element, present } = fakeVideo();
    getPresentedFrameTime(element);
    present(1.0);
    video.currentTime = 1.01;
    expect(getPresentedFrameTime(element)).toBe(1.0);
    present(1 + 1 / 30);
    expect(getPresentedFrameTime(element)).toBe(1 + 1 / 30);
  });

  it("gives the frame's time on the platform's timeline when the video plays in parts", () => {
    // The second part of a video whose first part is 100 s long, as on afreecatv.
    const { video, element, present } = fakeVideo(1.0);
    video.getCurrentTime = () => 100 + video.currentTime;
    getPresentedFrameTime(element);
    present(1.0);
    video.currentTime = 1.01;
    expect(getPresentedFrameTime(element)).toBe(101);
  });

  it('falls back to the playhead after the video source empties', () => {
    const { video, element, present, emit } = fakeVideo();
    getPresentedFrameTime(element);
    present(1.0);
    emit('emptied');
    video.currentTime = 7;
    expect(getPresentedFrameTime(element)).toBe(7);
  });
});

describe('isNewMeasuredFrameRate', () => {
  it('announces the first rate, a changed rate, and the same rate again for a new source', () => {
    const { element, emit } = fakeVideo();
    const asked = (
      [
        [30, 0],
        [30, 1000],
        [30000 / 1001, 6000],
        [30000 / 1001, 7000],
      ] as const
    ).map(([rate, now]) => isNewMeasuredFrameRate(element, rate, now));
    emit('resize');
    asked.push(isNewMeasuredFrameRate(element, 30000 / 1001, 8000));
    // A new source announces at once.
    emit('emptied');
    asked.push(isNewMeasuredFrameRate(element, 30000 / 1001, 9000));
    expect(asked).toEqual([true, false, true, false, false, true]);
  });

  it('announces at most once every 5 s, then the rate that holds', () => {
    const { element } = fakeVideo();
    const asked = (
      [
        [30, 0],
        [24, 1000],
        [30, 2000],
        [24, 3000],
        [24, 5500],
        [24, 6000],
      ] as const
    ).map(([rate, now]) => isNewMeasuredFrameRate(element, rate, now));
    expect(asked).toEqual([true, false, false, false, true, false]);
  });
});

describe('getMeasuredFrameRate', () => {
  const frames = (fps: number, count: number, round = (t: number) => t) =>
    Array.from({ length: count }, (_, k) => round(10 + k / fps));
  const toMilliseconds = (t: number) => Math.round(t * 1000) / 1000;

  it.each([
    ['30 fps', frames(30, 9), 30],
    ['29.97 fps', frames(30000 / 1001, 9), 30000 / 1001],
    ['60 fps rounded to the millisecond, as on YouTube', frames(60, 9, toMilliseconds), 60],
    ['24 fps rounded to the millisecond', frames(24, 9, toMilliseconds), 24],
    // A skipped frame ends the run, and the frames after it measure again.
    ['30 fps after a frame the decoder skipped', frames(30, 16).filter((_, k) => k !== 5), 30],
    [
      '60 fps after a frame the decoder skipped, rounded',
      frames(60, 16, toMilliseconds).filter((_, k) => k !== 3),
      60,
    ],
    ['a non-standard rate', frames(17, 9), 17],
  ])('measures %s', (_case, times, expected) => {
    const { element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    times.forEach(present);
    expect(getMeasuredFrameRate(element)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['29.97', 30000 / 1001],
    ['30', 30],
    ['59.94', 60000 / 1001],
    ['23.976', 24000 / 1001],
  ])(
    'tells %s fps from its NTSC neighbor over 2 s of frames rounded to the millisecond',
    (_case, fps) => {
      const { element, present } = fakeVideo();
      getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES);
      frames(fps, FRAMES_TO_TELL_NTSC_RATES, toMilliseconds).forEach(present);
      expect(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES)).toBeNull();
      present(toMilliseconds(10 + FRAMES_TO_TELL_NTSC_RATES / fps));
      expect(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES)).toBeCloseTo(fps, 6);
    }
  );

  it.each([
    [60, 30, 90],
    [60, 20, 150],
    [24, 10, 120],
  ])(
    'keeps %d fps across a forward seek after %d played frames, by %d frames',
    (fps, before, by) => {
      const { video, element, present, emit } = fakeVideo();
      const at = (k: number) => toMilliseconds(10 + k / fps);
      getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES);
      for (let k = 0; k < before; k++) present(at(k));
      // The seek starts, a frame decoded before it still presents, then the seeked frame presents
      // while seeking is still true.
      video.seeking = true;
      emit('seeking');
      present(at(before));
      present(at(before + by));
      video.seeking = false;
      for (let k = before + by + 1; k < before + by + 1 + FRAMES_TO_TELL_NTSC_RATES + 1; k++)
        present(at(k));
      expect(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES)).toBeCloseTo(fps, 6);
    }
  );

  // Each extra run of frames adds about 1 ms of rounding error, which picks the wrong one of an NTSC
  // pair for some start times, so try several.
  const startTimes = Array.from({ length: 12 }, (_, i) => 10 + i * 0.0137);
  it.each([
    ['59.94', 60000 / 1001, [20]],
    ['59.94', 60000 / 1001, [15, 40]],
    ['30', 30, [25]],
    ['30', 30, [10, 35]],
  ])(
    'measures %s fps only once 2 s play in a row, after drops at frames %j',
    (_label, fps, drops) => {
      for (const start of startTimes) {
        const { video, element, present } = fakeVideo();
        getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES);
        const rates = new Set<number | null>();
        for (let k = 0; k < 60 + 62; k++) {
          if (drops.includes(k)) video.droppedVideoFrames++;
          present(toMilliseconds(start + k / fps));
          rates.add(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES));
        }
        rates.delete(null);
        expect({ start, rates: [...rates] }).toEqual({ start, rates: [fps] });
      }
    }
  );

  it.each([
    ['59.94', 60000 / 1001, [20]],
    ['60', 60, [20, 45]],
  ])('measures %s fps when frame callbacks are missed now and then', (_label, fps, misses) => {
    for (const start of startTimes) {
      const { element, present, miss } = fakeVideo();
      const rates = new Set<number | null>();
      for (let k = 0; k < 200; k++) {
        if (misses.includes(k)) miss();
        else present(toMilliseconds(start + k / fps));
        rates.add(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES));
      }
      rates.delete(null);
      expect({ start, rates: [...rates] }).toEqual({ start, rates: [fps] });
    }
  });

  // The frame count tells how many frames a gap spans, so a skipped callback keeps the run going.
  it.each([
    ['29.97', 30000 / 1001, 30],
    ['59.94', 60000 / 1001, 20],
    ['30', 30, 7],
  ])('measures %s fps when a frame callback is skipped every %d frames', (_label, fps, every) => {
    for (const start of startTimes) {
      const { element, present, miss } = fakeVideo();
      const rates = new Set<number | null>();
      for (let k = 0; k < 200; k++) {
        if (k % every === every - 1) miss();
        else present(toMilliseconds(start + k / fps));
        rates.add(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES));
      }
      rates.delete(null);
      expect({ start, rates: [...rates] }).toEqual({ start, rates: [fps] });
    }
  });

  // A browser that counted each screen refresh showing a frame would report 2 frames per gap at 30
  // fps on a 60 Hz screen, which would read as 60 fps.
  it('measures nothing when every gap counts more than one presented frame', () => {
    const { element, present, miss } = fakeVideo();
    getMeasuredFrameRate(element);
    for (let k = 0; k < 120; k++) {
      miss();
      present(toMilliseconds(10 + k / 30));
    }
    expect(getMeasuredFrameRate(element)).toBeNull();
  });

  // 60 fps on a 30 Hz screen: every other frame is decoded but not shown, which would read as 30 fps.
  it('measures nothing when every other frame is decoded but never shown', () => {
    const { element, present, unshown } = fakeVideo();
    getMeasuredFrameRate(element);
    for (let k = 0; k < 240; k += 2) {
      unshown();
      present(toMilliseconds(10 + k / 60));
    }
    expect(getMeasuredFrameRate(element)).toBeNull();
  });

  it('measures the rate while the decoder runs a few frames ahead', () => {
    const { video, element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    for (let k = 0; k < 9; k++) {
      // The decoder gets three frames ahead mid-run.
      if (k === 3) video.totalVideoFrames += 3;
      present(10 + k / 30);
    }
    expect(getMeasuredFrameRate(element)).toBe(30);
  });

  // A rate taken after 8 frames can be an NTSC neighbor (11.988 for 12); the rate over 60 frames
  // corrects it, once.
  it.each([12, 15, 17])('settles on %d fps from 8 to 120 frames, changing at most once', (fps) => {
    const { element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    const rates: (number | null)[] = [];
    for (let k = 0; k <= 120; k++) {
      present(toMilliseconds(10 + k / fps));
      if (k >= 8) rates.push(getMeasuredFrameRate(element));
    }
    expect(rates.filter((rate, i) => i > 0 && rate !== rates[i - 1]).length).toBeLessThanOrEqual(1);
    expect(Math.abs((rates[rates.length - 1] ?? 0) - fps)).toBeLessThanOrEqual(fps * 0.002);
  });

  it.each([
    ['29.97', 30000 / 1001],
    ['59.94', 60000 / 1001],
    ['23.976', 24000 / 1001],
  ])('keeps %s fps over a long playback rounded to the millisecond', (_label, fps) => {
    for (const start of startTimes) {
      const { element, present } = fakeVideo();
      const rates = new Set<number | null>();
      for (let k = 0; k < 600; k++) {
        present(toMilliseconds(start + k / fps));
        rates.add(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES));
      }
      rates.delete(null);
      expect({ start, rates: [...rates] }).toEqual({ start, rates: [fps] });
    }
  });

  describe('when the frame rate changes mid-stream', () => {
    // 30 fps for 4 s, then 60 fps from the next frame on, rounded as on YouTube.
    const switchAt = 10 + 120 / 30;
    const before = Array.from({ length: 121 }, (_, k) => toMilliseconds(10 + k / 30));
    const after = (count: number) =>
      Array.from({ length: count }, (_, k) => toMilliseconds(switchAt + (k + 1) / 60));

    it('measures the new rate once it fills the measured frames', () => {
      const { element, present } = fakeVideo();
      getMeasuredFrameRate(element);
      before.forEach(present);
      expect(getMeasuredFrameRate(element)).toBe(30);
      after(121).forEach(present);
      expect(getMeasuredFrameRate(element)).toBe(60);
    });

    it('measures the new rate soon after a new rendition, keeping the old one until then', () => {
      const { element, present, emit } = fakeVideo();
      getMeasuredFrameRate(element);
      before.forEach(present);
      emit('resize');
      const frames = after(9);
      frames.slice(0, 5).forEach(present);
      expect(getMeasuredFrameRate(element)).toBe(30);
      frames.slice(5).forEach(present);
      expect(getMeasuredFrameRate(element)).toBe(60);
    });
  });

  it.each([
    ['a new rendition at the same rate', 'resize'],
    ['a seek', 'seeking'],
  ])('keeps 29.97 fps after %s and a short run of frames', (_case, event) => {
    const fps = 30000 / 1001;
    const { element, present, emit } = fakeVideo();
    getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES);
    for (let k = 0; k <= 120; k++) present(toMilliseconds(10 + k / fps));
    emit(event);
    const rates = new Set<number | null>();
    for (let k = 0; k < 30; k++) {
      present(toMilliseconds(20 + k / fps));
      rates.add(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES));
    }
    expect([...rates]).toEqual([fps]);
  });

  it.each([
    ['played faster than normal', (video: { playbackRate: number }) => (video.playbackRate = 2)],
    ['with frames dropped', (video: { droppedVideoFrames: number }) => video.droppedVideoFrames++],
  ])('ignores frames %s', (_case, change) => {
    const { video, element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    // Every other frame of 60 fps content goes unpresented, which would read as 30 fps.
    for (let k = 0; k < 20; k++) {
      change(video);
      present(10 + (2 * k) / 60);
    }
    expect(getMeasuredFrameRate(element)).toBeNull();
  });

  it('needs enough played frames, and ignores frames presented while paused', () => {
    const { video, element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    frames(30, 5).forEach(present);
    expect(getMeasuredFrameRate(element)).toBeNull();
    video.paused = true;
    frames(60, 20)
      .map((t) => t + 1)
      .forEach(present);
    expect(getMeasuredFrameRate(element)).toBeNull();
  });
});
