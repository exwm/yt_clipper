import type { VideoElement } from '../appState';
import {
  FRAMES_TO_TELL_NTSC_RATES,
  getMeasuredFrameRate,
  getPresentedFrameTime,
} from './presented-frame-clock';

// A video that presents frames on demand: present(t) runs the pending frame callbacks with mediaTime t.
function fakeVideo(currentTime = 0) {
  let callbacks: VideoFrameRequestCallback[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const video = {
    paused: false,
    currentTime,
    getCurrentTime: () => video.currentTime,
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => callbacks.push(callback),
    addEventListener: (type: string, listener: () => void) =>
      (listeners[type] ??= []).push(listener),
  };
  const present = (mediaTime: number) => {
    const pending = callbacks;
    callbacks = [];
    for (const callback of pending) {
      callback(0, { mediaTime } as VideoFrameCallbackMetadata);
    }
  };
  const emit = (type: string) => listeners[type]?.forEach((listener) => listener());
  return { video, element: video as unknown as VideoElement, present, emit };
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

  it('falls back to the playhead after the video source empties', () => {
    const { video, element, present, emit } = fakeVideo();
    getPresentedFrameTime(element);
    present(1.0);
    emit('emptied');
    video.currentTime = 7;
    expect(getPresentedFrameTime(element)).toBe(7);
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
    ['30 fps with a dropped frame', frames(30, 10).filter((_, k) => k !== 5), 30],
    ['60 fps with a dropped frame, rounded', frames(60, 10, toMilliseconds).filter((_, k) => k !== 3), 60],
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
  ])('tells %s fps from its NTSC neighbor over 2 s of frames rounded to the millisecond', (_case, fps) => {
    const { element, present } = fakeVideo();
    getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES);
    frames(fps, FRAMES_TO_TELL_NTSC_RATES, toMilliseconds).forEach(present);
    expect(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES)).toBeNull();
    present(toMilliseconds(10 + FRAMES_TO_TELL_NTSC_RATES / fps));
    expect(getMeasuredFrameRate(element, FRAMES_TO_TELL_NTSC_RATES)).toBeCloseTo(fps, 6);
  });

  it('needs enough played frames, and ignores frames presented while paused', () => {
    const { video, element, present } = fakeVideo();
    getMeasuredFrameRate(element);
    frames(30, 5).forEach(present);
    expect(getMeasuredFrameRate(element)).toBeNull();
    video.paused = true;
    frames(60, 20).map((t) => t + 1).forEach(present);
    expect(getMeasuredFrameRate(element)).toBeNull();
  });
});
