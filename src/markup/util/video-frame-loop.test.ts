import {
  chooseTiming,
  framesSkipped,
  onVideoFrames,
  orderConsumers,
  PresentedVideoFrame,
  setVideoFrameLoopTiming,
} from './video-frame-loop';

// A video whose frame on screen the test sets, with frame callbacks it runs on demand.
function fakeVideo() {
  let callbacks: VideoFrameRequestCallback[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  let presentedFrames = 0;
  const video = {
    paused: false,
    seeking: false,
    currentTime: 10,
    heldTime: 10,
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => callbacks.push(callback),
    cancelVideoFrameCallback: () => {
      callbacks = [];
    },
    addEventListener: (type: string, listener: () => void) =>
      (listeners[type] ??= []).push(listener),
    removeEventListener: (type: string, listener: () => void) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== listener);
    },
  };
  // The video shows a new frame: its frame callbacks run.
  const present = (time: number) => {
    video.heldTime = time;
    video.currentTime = time;
    presentedFrames++;
    const pending = callbacks;
    callbacks = [];
    for (const callback of pending) {
      callback(0, { mediaTime: time, presentedFrames } as VideoFrameCallbackMetadata);
    }
  };
  // The video shows a new frame with no frame callback for it.
  const presentWithoutCallback = (time: number) => {
    video.heldTime = time;
    video.currentTime = time;
    presentedFrames++;
  };
  const emit = (type: string) => listeners[type]?.forEach((listener) => listener());
  return {
    video,
    element: video as unknown as HTMLVideoElement,
    present,
    presentWithoutCallback,
    emit,
    pendingCallbacks: () => callbacks.length,
  };
}

// requestAnimationFrame that runs when the test refreshes the screen, and a VideoFrame of the frame
// the fake video holds.
let refreshCallbacks: FrameRequestCallback[] = [];
const refresh = () => {
  const pending = refreshCallbacks;
  refreshCallbacks = [];
  pending.forEach((callback) => callback(0));
};
let openFrames = 0;
let framesTaken = 0;
class FakeVideoFrame {
  timestamp: number;
  constructor(video: { heldTime: number }) {
    this.timestamp = Math.round(video.heldTime * 1e6);
    openFrames++;
    framesTaken++;
  }
  close() {
    openFrames--;
  }
}

beforeEach(() => {
  refreshCallbacks = [];
  openFrames = 0;
  framesTaken = 0;
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => refreshCallbacks.push(callback),
    cancelAnimationFrame: () => {
      refreshCallbacks = [];
    },
  });
});

afterEach(() => {
  delete (globalThis as { VideoFrame?: unknown }).VideoFrame;
  setVideoFrameLoopTiming('frameCallback');
});

function withVideoFrame() {
  (globalThis as { VideoFrame?: unknown }).VideoFrame = FakeVideoFrame;
  setVideoFrameLoopTiming('everyRefresh');
}

describe('chooseTiming', () => {
  const base = {
    preferred: 'everyRefresh',
    hasVideoFrame: true,
    hasDrawConsumer: true,
    timestampsDisagree: false,
  } as const;
  it.each([
    ['everything it needs', {}, 'everyRefresh'],
    ['the frame callback preferred', { preferred: 'frameCallback' }, 'frameCallback'],
    ['no VideoFrame', { hasVideoFrame: false }, 'frameCallback'],
    ['nothing that draws', { hasDrawConsumer: false }, 'frameCallback'],
    ['timestamps off the video time', { timestampsDisagree: true }, 'frameCallback'],
  ] as const)('with %s', (_, change, expected) => {
    expect(chooseTiming({ ...base, ...change })).toBe(expected);
  });
});

describe('the loop core', () => {
  it('counts the frames a presentedFrames step skipped', () => {
    expect([framesSkipped(undefined, 5), framesSkipped(5, 6), framesSkipped(6, 9)]).toEqual([
      0, 0, 2,
    ]);
  });

  it('orders the clock first, then update consumers, keeping the subscription order within a phase', () => {
    const ordered = orderConsumers([
      { phase: 'draw', id: 1 },
      { phase: 'update', id: 2 },
      { phase: 'draw', id: 3 },
      { phase: 'update', id: 4 },
      { phase: 'clock', id: 5 },
    ] as const);
    expect(ordered.map((c) => c.id)).toEqual([5, 2, 4, 1, 3]);
  });
});

describe('onVideoFrames with the frame callback', () => {
  it('passes each presented frame to update consumers, then draw consumers', () => {
    const { element, present } = fakeVideo();
    const calls: string[] = [];
    const frames: PresentedVideoFrame[] = [];
    const draw = onVideoFrames(element, (f) => {
      calls.push('draw');
      frames.push(f);
    });
    const update = onVideoFrames(element, () => calls.push('update'), { phase: 'update' });
    present(10.5);
    expect(calls).toEqual(['update', 'draw']);
    expect(frames[0]).toMatchObject({ mediaTime: 10.5, image: element, presentedFrames: 1 });
    draw.stop();
    update.stop();
  });

  it('keeps passing frames to the others when one consumer throws', () => {
    const { element, present } = fakeVideo();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const times: number[] = [];
    const broken = onVideoFrames(element, () => {
      throw new Error('broken');
    });
    const working = onVideoFrames(element, (f) => times.push(f.mediaTime));
    present(1);
    present(2);
    expect(times).toEqual([1, 2]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
    broken.stop();
    working.stop();
  });

  it('stops asking for frames once the last consumer stops', () => {
    const { element, present, pendingCallbacks } = fakeVideo();
    const times: number[] = [];
    const subscription = onVideoFrames(element, (f) => times.push(f.mediaTime));
    subscription.stop();
    present(1);
    expect(times).toEqual([]);
    expect(pendingCallbacks()).toBe(0);
  });

  it('redraws one consumer with the last frame', () => {
    const { element, present } = fakeVideo();
    const a: number[] = [];
    const b: number[] = [];
    const first = onVideoFrames(element, (f) => a.push(f.mediaTime));
    const second = onVideoFrames(element, (f) => b.push(f.mediaTime));
    present(3);
    first.redraw();
    expect([a, b]).toEqual([[3, 3], [3]]);
    first.stop();
    second.stop();
  });
});

describe('onVideoFrames on every refresh', () => {
  it('draws each new frame from a VideoFrame of exactly that frame, closed after the draw', () => {
    withVideoFrame();
    const { element, presentWithoutCallback } = fakeVideo();
    const drawn: { time: number; image: unknown }[] = [];
    const subscription = onVideoFrames(element, (f) => {
      drawn.push({ time: f.mediaTime, image: f.image });
      expect(openFrames).toBe(1);
    });
    presentWithoutCallback(10.5);
    refresh();
    // The same frame on the next refresh is not drawn again.
    refresh();
    presentWithoutCallback(10.6);
    refresh();
    expect(drawn.map((d) => d.time)).toEqual([10.5, 10.6]);
    expect(drawn[0].image).toBeInstanceOf(FakeVideoFrame);
    expect(openFrames).toBe(0);
    subscription.stop();
  });

  it('takes one VideoFrame per refresh while playing, and passes each video frame on once', () => {
    withVideoFrame();
    const { video, element, present } = fakeVideo();
    const times: number[] = [];
    const subscription = onVideoFrames(element, (f) => times.push(f.mediaTime));
    // A 30 fps video on a 60 Hz screen: a new frame every other refresh.
    for (let refreshIndex = 0; refreshIndex < 60; refreshIndex++) {
      const playhead = 10 + refreshIndex / 60;
      if (refreshIndex % 2 === 0) present(playhead);
      video.currentTime = playhead;
      refresh();
    }
    expect(times).toHaveLength(30);
    expect(framesTaken).toBe(60);
    subscription.stop();
  });

  it('draws every frame of even playback after a stretch of skipped frames', () => {
    withVideoFrame();
    const { video, element, present, presentWithoutCallback } = fakeVideo();
    const times: number[] = [];
    const subscription = onVideoFrames(element, (f) => times.push(f.mediaTime));
    // A stall: the video shows every other frame of a 60 fps video for a while.
    let frame = 0;
    for (; frame < 40; frame += 2) {
      present(10 + frame / 60);
      refresh();
    }
    // Then even playback, one frame per refresh, the playhead a little past each frame, with a frame
    // callback missed now and then.
    const evenFrom = times.length;
    for (let k = 0; k < 60; k++, frame++) {
      if (k % 10 === 5) presentWithoutCallback(10 + frame / 60);
      else present(10 + frame / 60);
      video.currentTime = 10 + frame / 60 + 0.001;
      refresh();
    }
    expect(times.length - evenFrom).toBe(60);
    subscription.stop();
  });

  it('draws frames the frame callback missed', () => {
    withVideoFrame();
    const { element, present, presentWithoutCallback } = fakeVideo();
    const times: number[] = [];
    const subscription = onVideoFrames(element, (f) => times.push(f.mediaTime));
    for (const [k, time] of [10, 10.1, 10.2, 10.3].entries()) {
      if (k % 2 === 0) present(time);
      else presentWithoutCallback(time);
      refresh();
    }
    expect(times).toEqual([10, 10.1, 10.2, 10.3]);
    subscription.stop();
  });

  it('while paused, draws only after a seek presents a new frame', () => {
    withVideoFrame();
    const { video, element, present, presentWithoutCallback, emit } = fakeVideo();
    const times: number[] = [];
    const subscription = onVideoFrames(element, (f) => times.push(f.mediaTime));
    presentWithoutCallback(10);
    refresh();
    video.paused = true;
    presentWithoutCallback(11);
    refresh();
    expect(times).toEqual([10]);
    // A frame step presents its frame with a frame callback, a seek with `seeked`.
    present(10.1);
    refresh();
    presentWithoutCallback(12);
    emit('seeked');
    refresh();
    expect(times).toEqual([10, 10.1, 12]);
    subscription.stop();
  });

  it('uses the frame callback while only update consumers follow the video', () => {
    withVideoFrame();
    const { element, present } = fakeVideo();
    const updates: unknown[] = [];
    const update = onVideoFrames(element, (f) => updates.push(f.image), { phase: 'update' });
    present(10);
    expect(updates).toEqual([element]);
    expect(refreshCallbacks).toHaveLength(0);
    const draw = onVideoFrames(element, () => {});
    expect(refreshCallbacks).toHaveLength(1);
    draw.stop();
    expect(refreshCallbacks).toHaveLength(0);
    update.stop();
  });

  it('falls back to the frame callback when frame timestamps are off the video time', () => {
    withVideoFrame();
    const { video, element, present } = fakeVideo();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const images: unknown[] = [];
    const subscription = onVideoFrames(element, (f) => images.push(f.image));
    video.heldTime = 500;
    refresh();
    expect(images).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    present(10.1);
    expect(images).toEqual([element]);
    warn.mockRestore();
    subscription.stop();
  });

  it('redraws one consumer from the frame the video holds', () => {
    withVideoFrame();
    const { element, presentWithoutCallback } = fakeVideo();
    const redrawn: number[] = [];
    const subscription = onVideoFrames(element, (f) => redrawn.push(f.mediaTime));
    presentWithoutCallback(10.2);
    subscription.redraw();
    expect(redrawn).toEqual([10.2]);
    expect(openFrames).toBe(0);
    subscription.stop();
  });
});
