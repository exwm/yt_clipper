import { getMeasuredFrameRate } from './presented-frame-clock';
import { onVideoFrames, setVideoFrameLoopTiming } from './video-frame-loop';

let refreshCallbacks: FrameRequestCallback[] = [];
const refresh = () => {
  const pending = refreshCallbacks;
  refreshCallbacks = [];
  pending.forEach((callback) => callback(0));
};
class FakeVideoFrame {
  timestamp: number;
  constructor(video: { heldTime: number }) {
    this.timestamp = Math.round(video.heldTime * 1e6);
  }
  close() {}
}

beforeEach(() => {
  refreshCallbacks = [];
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => refreshCallbacks.push(callback),
    cancelAnimationFrame: () => {
      refreshCallbacks = [];
    },
    VideoFrame: FakeVideoFrame,
  });
  setVideoFrameLoopTiming('everyRefresh');
});

function fakeVideo() {
  const listeners: Record<string, (() => void)[]> = {};
  let heldTime = 0;
  let decodedFrames = 0;
  const video = {
    paused: false,
    seeking: false,
    playbackRate: 1,
    currentTime: 0,
    // Each new frame held was decoded, whether or not a refresh shows it.
    get heldTime() {
      return heldTime;
    },
    set heldTime(time: number) {
      if (time !== heldTime) decodedFrames++;
      heldTime = time;
    },
    getCurrentTime: () => video.currentTime,
    getVideoPlaybackQuality: () => ({ droppedVideoFrames: 0, totalVideoFrames: decodedFrames }),
    requestVideoFrameCallback: () => 0,
    cancelVideoFrameCallback: () => {},
    addEventListener: (type: string, l: () => void) => (listeners[type] ??= []).push(l),
    removeEventListener: () => {},
  };
  return video;
}

const toMs = (t: number) => Math.round(t * 1000) / 1000;
const startTimes = Array.from({ length: 12 }, (_, i) => 10 + i * 0.0137);

// Under 'everyRefresh' (the default) the clock gets no presented frame count, so a refresh the page
// misses shows only as a duration spanning two frames. Checked over a range of start phases, since
// the millisecond rounding of the frame times decides which runs it skews.
it.each([
  ['59.94', 60000 / 1001, [20]],
  ['60', 60, [20, 45]],
  ['59.94, two misses two refreshes apart', 60000 / 1001, [20, 22]],
  ['59.94, two misses three refreshes apart', 60000 / 1001, [20, 23]],
  ['59.94, many misses', 60000 / 1001, [20, 22, 90, 92, 150]],
  ['59.94 control', 60000 / 1001, []],
  ['60 control', 60, []],
])('measures %s fps when the page misses a refresh now and then', (_l, fps, misses) => {
  const wrong: unknown[] = [];
  for (const start of startTimes) {
    const video = fakeVideo();
    const element = video as unknown as HTMLVideoElement;
    const draw = onVideoFrames(element, () => {});
    getMeasuredFrameRate(element as never);
    const rates = new Set<number | null>();
    for (let k = 0; k < 200; k++) {
      video.heldTime = toMs(start + k / fps);
      video.currentTime = video.heldTime;
      if (!misses.includes(k)) refresh();
      rates.add(getMeasuredFrameRate(element as never));
    }
    rates.delete(null);
    // The rate is measured, and never another one.
    if (rates.size !== 1 || !rates.has(fps)) wrong.push({ start, rates: [...rates] });
    draw.stop();
  }
  expect(wrong).toEqual([]);
});

// The rate is first asked for when a preview needs it, which can be any number of frames into a run.
it.each([
  ['59.94', 60000 / 1001],
  ['60', 60],
])('measures %s fps when first asked after 60 to 125 frames', (_l, fps) => {
  const wrong: unknown[] = [];
  for (let frames = 60; frames <= 125; frames++) {
    for (const start of startTimes) {
      const video = fakeVideo();
      const element = video as unknown as HTMLVideoElement;
      const draw = onVideoFrames(element, () => {});
      getMeasuredFrameRate(element as never);
      for (let k = 0; k <= frames; k++) {
        video.heldTime = toMs(start + k / fps);
        video.currentTime = video.heldTime;
        refresh();
      }
      const rate = getMeasuredFrameRate(element as never);
      if (rate !== fps) wrong.push({ frames, start, rate });
      draw.stop();
    }
  }
  expect(wrong).toEqual([]);
});

it('measures a rate drop with no resize event, from 60 to 30 fps', () => {
  const video = fakeVideo();
  const element = video as unknown as HTMLVideoElement;
  const draw = onVideoFrames(element, () => {});
  const frameTimes = [
    ...Array.from({ length: 100 }, (_, k) => 10 + k / 60),
    ...Array.from({ length: 100 }, (_, k) => 10 + 100 / 60 + k / 30),
  ];
  const rates: (number | null)[] = [];
  for (const time of frameTimes) {
    video.heldTime = toMs(time);
    video.currentTime = video.heldTime;
    refresh();
    rates.push(getMeasuredFrameRate(element as never));
  }
  draw.stop();
  expect([rates[99], rates[199]]).toEqual([60, 30]);
});
