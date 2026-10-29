import { readFileSync } from 'fs';
import { join } from 'path';
import { ClockState, initialClock, isFrameCurrent, stepClock } from './frame-clock-core';
import { PLACEMENT_TOLERANCE } from './frame-grid';
import {
  frameStepTarget,
  frameTime,
  LoopRefresh,
  loopTurnBack,
  OwnSeek,
  screenFrame,
  shouldHoldEndFrame,
} from './frame-step';
import { onExternalSeek, onSeekRequest, onSeekSettled, SeekDecision } from './seek-coalescer';

// The frame-step functions over the frame on screen and the playhead, as the tables state them.
interface OnScreen {
  presentedFrameTime: number;
  playhead: number;
  isFrameCurrent: boolean;
  fps: number;
  isRead: boolean;
  // The rate in use was measured. Unless a row says otherwise, it was.
  isRateExact?: boolean;
}
const screenOf = (at: OnScreen) =>
  screenFrame(
    { mediaTime: at.presentedFrameTime, isRead: at.isRead, isCurrent: at.isFrameCurrent },
    at.playhead,
    at.fps,
    at.isRateExact ?? true
  );
function frameTimeOf(at: OnScreen & { isSeekInFlight: boolean; ownSeek: OwnSeek | null }) {
  return frameTime(screenOf(at), at);
}
// `lastTarget`: the last step's target.
function stepTargetOf(
  step: OnScreen & {
    lastTarget: number | null;
    duration: number;
    frames: number;
    isSeekInFlight?: boolean;
  }
) {
  const { lastTarget: target, fps } = step;
  const ownSeek =
    target == null ? null : { target, frameStart: target - 0.5 / fps, kind: 'step' as const };
  return frameStepTarget(screenOf(step), {
    ...step,
    isSeekInFlight: step.isSeekInFlight ?? false,
    ownSeek,
  });
}

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;
const duration = 3600;

describe('frameTime', () => {
  // A jump to a marker 1.5 ms before its frame's end: the seek lands 1 ms past it.
  const markerTime = frame(181) - 0.0015;
  const jump: OwnSeek = { target: markerTime + 0.001, frameStart: markerTime, kind: 'place' };
  const midJump: OwnSeek = {
    target: frame(90) + 0.011,
    frameStart: frame(90) + 0.01,
    kind: 'place',
  };
  const at = (overrides: Partial<Parameters<typeof frameTimeOf>[0]>) =>
    frameTimeOf({
      presentedFrameTime: frame(90),
      playhead: middleOf(90),
      isSeekInFlight: false,
      isFrameCurrent: true,
      ownSeek: null,
      fps,
      isRead: true,
      ...overrides,
    });
  it.each([
    ['paused, the frame on screen current: its start', {}, frame(90)],
    ['playing: the picture', { playhead: frame(91) + 0.01 }, frame(90)],
    // On a rate in use above the video's, a current frame still means the playhead's frame.
    [
      'current, past the grid frame of the rate in use',
      { playhead: frame(90) + 0.03, fps: 60 },
      frame(90),
    ],
    // A seek elsewhere: the frame on screen is from before it.
    [
      "a seek in flight: the playhead's frame",
      { isSeekInFlight: true, playhead: middleOf(150) },
      middleOf(150) - 0.001,
    ],
    [
      'its frame not presented yet',
      { isFrameCurrent: false, playhead: middleOf(150) },
      middleOf(150) - 0.001,
    ],
    // Presented before 'seeking' (YouTube): not current, but it holds the playhead.
    ['not current, holding the playhead', { isFrameCurrent: false }, frame(90)],
    // Right after the markup's own seek, its placed time, whatever the frame on screen shows.
    [
      'a jump in flight',
      { isSeekInFlight: true, playhead: jump.target, ownSeek: jump },
      markerTime,
    ],
    [
      'a jump landed',
      { presentedFrameTime: frame(180), playhead: jump.target, ownSeek: jump },
      markerTime,
    ],
    [
      'the playhead moved on from the jump',
      { presentedFrameTime: frame(183), playhead: frame(183) + 0.01, ownSeek: jump },
      frame(183),
    ],
    // Just before a marker jumped to earlier, in the frame before it.
    [
      'the playhead back before the jump',
      { presentedFrameTime: frame(180), playhead: markerTime - 0.005, ownSeek: jump },
      frame(180),
    ],
    [
      'the playhead back before the jump, its frame not presented',
      {
        isFrameCurrent: false,
        presentedFrameTime: frame(150),
        playhead: markerTime - 0.005,
        ownSeek: jump,
      },
      markerTime - 0.006,
    ],
    // A jump into the middle of a frame: its placed time while the playhead stays within a quarter
    // frame of the target, then the frame on screen.
    [
      'a sixth of a frame past a jump mid-frame',
      { playhead: midJump.target + 1 / fps / 6, ownSeek: midJump },
      midJump.frameStart,
    ],
    [
      'a third of a frame past a jump mid-frame',
      { playhead: midJump.target + 1 / fps / 3, ownSeek: midJump },
      frame(90),
    ],
    // Firefox times the first frame after a seek at the seek target, so it reads as the playhead.
    [
      'Firefox, after a seek into a frame: its start',
      { presentedFrameTime: frame(90) + 0.02, playhead: frame(90) + 0.02, isRead: false },
      frame(90),
    ],
    [
      'Firefox, after a seek into a frame, at an assumed rate above the video: the playhead less 1 ms',
      {
        presentedFrameTime: frame(90) + 0.02,
        playhead: frame(90) + 0.02,
        fps: 60,
        isRead: false,
        isRateExact: false,
      },
      frame(90) + 0.019,
    ],
  ] as const)('%s', (_case, overrides, expected) => {
    expect(at(overrides)).toBeCloseTo(expected, 9);
  });

  // Unmeasured, the 60 fps grid frame of a retimed frame can start in the video frame before.
  it('reads frame 1 of a 24 fps video after a seek into it on Firefox, unmeasured', () => {
    const time = at({
      presentedFrameTime: 0.045,
      playhead: 0.045,
      fps: 60,
      isRead: false,
      isRateExact: false,
    });
    expect(Math.floor((time + 0.001) * 24)).toBe(1);
  });

  it('reads one time for a whole video frame on Firefox, after seeks to any point in it', () => {
    const times = new Set(
      [0.1, 0.3, 0.5, 0.7, 0.95].map((into) =>
        at({
          presentedFrameTime: (90 + into) / fps,
          playhead: (90 + into) / fps,
          isRead: false,
        })
      )
    );
    expect([...times]).toEqual([frame(90)]);
  });

  // Any two playhead positions in one paused video frame read the same time once the frame is
  // presented, on any rate in use, so two placements or edits on that frame never make two points.
  it.each([
    [30, 30],
    [30, 60],
    [24, 60],
    [25, 60],
    [50, 60],
    [30000 / 1001, 30],
    [30, 25],
  ])('reads one time for a whole presented %p fps video frame at %p fps', (videoFps, fpsInUse) => {
    for (const n of [90, 1234, 54321]) {
      const start = Math.round((n / videoFps) * 1000) / 1000;
      const times = new Set(
        [0, 0.2, 0.5, 0.8, 0.99].map((into) =>
          at({ presentedFrameTime: start, playhead: (n + into) / videoFps, fps: fpsInUse })
        )
      );
      expect([...times]).toEqual([start]);
    }
  });

  // Before its frame is presented, the time still means the playhead's frame, never a neighbor's.
  it.each([
    [30, 60],
    [24, 60],
    [30000 / 1001, 30],
    [30, 25],
  ])(
    'reads the playhead frame of a %p fps video at %p fps before it is presented',
    (videoFps, fpsInUse) => {
      for (const n of [90, 1234, 54321]) {
        for (const into of [0.05, 0.2, 0.5, 0.8, 0.99]) {
          const time = at({
            presentedFrameTime: 0,
            playhead: (n + into) / videoFps,
            isFrameCurrent: false,
            fps: fpsInUse,
          });
          expect(Math.floor((time + 0.001) * videoFps)).toBe(n);
        }
      }
    }
  );
});
// A small seeded generator, so a failing scenario replays exactly from its seed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe('screenFrame', () => {
  it.each([
    ['a frame start', frame(90), frame(90) + 0.02, false, frame(90)],
    ['a seek target, not read at seeked', frame(90) + 0.02, frame(90) + 0.02, false, frame(90)],
    ['a seek target read at seeked', frame(90) + 0.02, frame(90) + 0.02, true, frame(90) + 0.02],
    ['a rounded NTSC frame start at the playhead', 3.036, 3.036, false, 3.036],
    ['no frame presented yet: the playhead', null, frame(90), false, frame(90)],
  ] as const)('starts %s', (_case, mediaTime, playhead, isRead, expected) => {
    const rate = mediaTime === 3.036 ? 30000 / 1001 : fps;
    // A measured rate.
    const { start } = screenFrame({ mediaTime, isRead, isCurrent: true }, playhead, rate, true);
    expect(start).toBeCloseTo(expected, 9);
  });
});

describe('frameStepTarget', () => {
  // Columns: the frame on screen, the playhead, the last step's target, the frames to step, and
  // whether the frame was read at `seeked`. The frame on screen was presented after the last seek,
  // as when paused after a step.
  it.each([
    ['one forward from a frame start', frame(90), frame(90), null, 1, true, middleOf(91)],
    ['one back from a frame start', frame(90), frame(90), null, -1, true, middleOf(89)],
    ['three forward', frame(90), frame(90), null, 3, true, middleOf(93)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, 3.02, null, 1, true, 3.003 + 1.5 / fps],
    // The frame on screen holds the playhead: step from it.
    [
      'from the frame holding the last target',
      frame(91),
      middleOf(91),
      middleOf(91),
      1,
      true,
      middleOf(92),
    ],
    ['back from the first frame', frame(0), frame(0), null, -1, true, middleOf(0)],
    // Firefox times the first frame after a seek at the seek target, unread.
    [
      'after a step, its frame timed at it',
      middleOf(91),
      middleOf(91),
      middleOf(91),
      1,
      false,
      middleOf(92),
    ],
    [
      'back after a step, its frame timed at it',
      middleOf(91),
      middleOf(91),
      middleOf(91),
      -1,
      false,
      middleOf(90),
    ],
    [
      'after a seek mid-frame, its frame timed at it',
      frame(90) + 0.02,
      frame(90) + 0.02,
      null,
      1,
      false,
      middleOf(91),
    ],
  ] as const)('%s', (_case, presentedFrameTime, playhead, lastTarget, frames, isRead, expected) => {
    const at = { presentedFrameTime, playhead, isFrameCurrent: true, lastTarget, fps, isRead };
    expect(stepTargetOf({ ...at, duration, frames })).toBeCloseTo(expected, 9);
  });
  // A seek elsewhere whose frame hasn't shown: step from the playhead. In the last millisecond of a
  // frame the playhead is still in it.
  it.each([
    ['from the playhead after a seek elsewhere', frame(150) + 0.01, middleOf(91)],
    ['from the playhead late in its frame', frame(151) - 0.0005, null],
  ] as const)('%s', (_case, playhead, lastTarget) => {
    const at = { presentedFrameTime: frame(90), playhead, isFrameCurrent: false, lastTarget, fps };
    const step = { ...at, isRead: true, duration, frames: 1 };
    expect(stepTargetOf(step)).toBeCloseTo(middleOf(151), 9);
  });
  // The last step's seek is in flight, its frame not presented: the frame on screen can't hold its
  // target. Columns: the frame on screen, the last step's target, the frames to step.
  it.each([
    ['chained while a step is pending', frame(90), middleOf(91), 1, middleOf(92)],
    ["chained while an earlier step's frame shows", frame(92), middleOf(94), 1, middleOf(95)],
    ["chained back while an earlier step's frame shows", frame(92), middleOf(90), -1, middleOf(89)],
  ] as const)('%s', (_case, presentedFrameTime, lastTarget, frames, expected) => {
    const at = { presentedFrameTime, playhead: lastTarget, isFrameCurrent: true, lastTarget, fps };
    const step = { ...at, isRead: true, isSeekInFlight: true, duration, frames };
    expect(stepTargetOf(step)).toBeCloseTo(expected, 9);
  });
  // Before the rate is measured, the stand-in start of a frame timed at the playhead is not a grid
  // frame's: a step goes on from the last step's frame instead.
  it('steps on from the last step after its frame was timed at it, before the rate is measured', () => {
    const at = { presentedFrameTime: middleOf(91), playhead: middleOf(91), isFrameCurrent: true };
    const step = { ...at, lastTarget: middleOf(91), fps, isRead: false, isRateExact: false };
    expect(stepTargetOf({ ...step, duration, frames: 1 })).toBeCloseTo(middleOf(92), 9);
  });
  // Chrome, paused after play: the frame held can start after the playhead (10.7667 at 10.7293), or
  // end before it (2.6 at 2.6347).
  it.each([
    [1, 'starts after', -0.037, 30, true, middleOf(91)],
    [-1, 'starts after', -0.037, 30, true, middleOf(89)],
    [1, 'starts after', -0.037, 60, false, frame(90) + 1.5 / 60],
    [-1, 'starts after', -0.037, 60, false, frame(90) - 0.5 / 60],
    [1, 'ends before', 1 / fps + 0.0015, 30, true, middleOf(91)],
    [-1, 'ends before', 1 / fps + 0.0015, 30, true, middleOf(89)],
    [1, 'ends before', 1 / fps + 0.0015, 60, false, frame(90) + 1.5 / 60],
    [-1, 'ends before', 1 / fps + 0.0015, 60, false, frame(90) - 0.5 / 60],
  ])(
    'steps %i from a paused frame that %s the playhead (%p s after its start), at %p fps (measured: %p)',
    (frames, _case, playheadAfterStart, fpsInUse, isRateExact, expected) => {
      const at = {
        presentedFrameTime: frame(90),
        playhead: frame(90) + playheadAfterStart,
        isFrameCurrent: true,
        lastTarget: null,
        fps: fpsInUse,
        isRead: false,
        isRateExact,
      };
      expect(stepTargetOf({ ...at, duration, frames })).toBeCloseTo(expected, 9);
    }
  );
  // After a seek to a millisecond-rounded frame start (a marker's time): the frame on screen starts at
  // the playhead and is the playhead's frame, just below its grid start, read at seeked or not.
  it.each([
    [1, 92, true],
    [-1, 90, true],
    [1, 92, false],
    [-1, 90, false],
  ])(
    'steps %i from a rounded NTSC frame start at the playhead (read at seeked: %p)',
    (frames, expectedFrame, isRead) => {
      const ntsc = 30000 / 1001;
      const at = {
        presentedFrameTime: 3.036,
        playhead: 3.036,
        isFrameCurrent: true,
        lastTarget: null,
        fps: ntsc,
        duration,
        frames,
        isRead,
      };
      expect(stepTargetOf(at)).toBeCloseTo((expectedFrame + 0.5) / ntsc, 3);
    }
  );

  // At the end the video snaps its time to the duration ('ended'), past the last frame's middle.
  it('steps back from the end of the video, at a rate in use above the video', () => {
    const fpsInUse = 60;
    const end = 2400;
    const lastMiddle = end - 0.5 / fpsInUse;
    const at = {
      presentedFrameTime: end - 1 / 30,
      playhead: end,
      isFrameCurrent: true,
      lastTarget: lastMiddle,
      fps: fpsInUse,
      duration: end,
      frames: -1,
      isRead: true,
    };
    expect(stepTargetOf(at)).toBeCloseTo(lastMiddle - 1 / fpsInUse, 9);
  });
  it('steps from the playhead, not a frame from before a user seek that lands just before it', () => {
    const playhead = frame(151) - 0.0004;
    const at = {
      presentedFrameTime: frame(151),
      playhead,
      lastTarget: null,
      fps,
      duration,
      frames: 1,
      isRead: true,
    };
    expect(stepTargetOf({ ...at, isFrameCurrent: false })).toBeCloseTo(middleOf(151), 9);
  });

  // A seek shows the frame that covers its target. `videoFps` is the video's rate, `fps` the rate in
  // use; each step from a pause, its frame shown before the next.
  function stepsFromAPause(videoFps: number, stepFps: number, steps: number): number[] {
    const shownAt = (time: number) => Math.floor(time * videoFps + 1e-9);
    let presentedFrameTime = 90 / videoFps;
    let lastTarget: number | null = null;
    const shown: number[] = [];
    for (let i = 0; i < steps; i++) {
      const playhead = lastTarget ?? presentedFrameTime;
      const target = stepTargetOf({
        presentedFrameTime,
        playhead,
        isFrameCurrent: true,
        lastTarget,
        fps: stepFps,
        duration,
        frames: 1,
        isRead: true,
      });
      lastTarget = target;
      presentedFrameTime = shownAt(target) / videoFps;
      shown.push(shownAt(target));
    }
    return shown;
  }

  it('steps every frame of a 29.97 fps video at 30 fps, over 1500 steps', () => {
    const shown = stepsFromAPause(30000 / 1001, 30, 1500);
    expect(shown.filter((n, i) => n !== 91 + i)).toEqual([]);
  });

  it.each([
    [50, 60],
    [30, 25],
    [60, 50],
    [30000 / 1001, 30],
  ])('steps one frame at a time on a %p fps video at %p fps', (videoFps, stepFps) => {
    const shown = stepsFromAPause(videoFps, stepFps, 30);
    expect(shown.filter((n, i) => n !== 91 + i)).toEqual([]);
  });

  // At twice the rate a step can land on the same frame; the next one still moves forward.
  it('moves forward at a rate too high for the video', () => {
    const shown = stepsFromAPause(30, 60, 20);
    expect(shown.every((n, i) => i === 0 || n >= shown[i - 1])).toBe(true);
    expect(shown[shown.length - 1]).toBe(100);
  });

  // Bursts of steps in a model of the browser and seekToSafe's coalescer (`seek-coalescer.ts`, with
  // its 1 s timer). Setting the time moves the playhead and sets `seeking` at once, as on HTML5 video
  // and YouTube. A seek's frame is presented `arrival` ms after the seek ends (negative: before, down
  // to its start, as YouTube presents before 'seeking'), unless another seek replaces it first. With
  // millisecond-rounded frame times the frame shown follows the rounded boundaries. Times are in ms.
  interface Playback {
    videoFps: number;
    stepFps: number;
    seekTime: number;
    arrival: number;
    roundToMs: boolean;
    startFrame: number;
    // The video's last frame, and its duration in frames (longer when its audio is).
    lastFrame?: number;
    durationFrames?: number;
    // YouTube's order: a seek's frame is presented before its `seeking`.
    framesBeforeSeeking?: boolean;
    // Whether `new VideoFrame(video)` reads the frame held at `seeked` (Chrome; Firefox reads 0), and
    // whether the coalescer's `seeked` listener, which starts the next seek, runs before the clock's.
    readsHeldFrame?: boolean;
    coalescerFirst?: boolean;
  }
  interface Burst {
    moves: number[];
    gap: number;
    // A seek of the user's own, `lead` ms before the first step.
    userSeek?: { time: number; lead: number };
    // The rate in use at each step, when it changes mid-burst.
    fpsAt?: (step: number) => number;
  }
  function playBursts(playback: Playback, bursts: Burst[]) {
    const { videoFps, stepFps, seekTime, arrival, roundToMs, startFrame } = playback;
    const frameStart = (n: number) =>
      roundToMs ? Math.round((n / videoFps) * 1000) / 1000 : n / videoFps;
    const lastFrame = playback.lastFrame ?? Infinity;
    const duration = (playback.durationFrames ?? Infinity) / videoFps;
    const frameShownAt = (time: number) => {
      const n = Math.floor(time * videoFps + 1e-9);
      const shown = frameStart(n + 1) <= time ? n + 1 : frameStart(n) > time ? n - 1 : n;
      return Math.min(shown, lastFrame);
    };
    const video = {
      currentTime: frameStart(startFrame) + 0.4 / videoFps,
      seeking: false,
      seekEndsAt: 0,
      shownFrame: startFrame,
      presented: 0,
      // The frame clock, fed the video's events in their order.
      clock: initialClock,
      framesDue: [] as { frame: number; at: number; seekEndsAt: number }[],
    };
    let pending: number | null = null;
    let timerAt: number | null = null;
    let lastTarget: number | null = null;
    let now = 0;
    // Every frame shown, in order, for the bursts' checks.
    const shownLog: number[] = [];
    const present = (frame: number) => {
      if (frame !== video.shownFrame) shownLog.push(frame);
      video.shownFrame = frame;
      video.presented++;
      video.clock = stepClock(video.clock, {
        type: 'frame',
        frame: {
          mediaTime: frameStart(frame),
          duringSeek: video.seeking,
          droppedFrames: 0,
          presentedFrames: video.presented,
          decodedFrames: video.presented,
          paused: true,
          playbackRate: 1,
        },
      });
    };
    const seekTo = (target: number) => {
      video.framesDue = video.framesDue.filter((due) => due.seekEndsAt <= now);
      if (playback.framesBeforeSeeking) present(frameShownAt(target));
      video.clock = stepClock(video.clock, { type: 'seeking' });
      Object.assign(video, { currentTime: target, seeking: true, seekEndsAt: now + seekTime });
      if (playback.framesBeforeSeeking) return;
      const at = Math.max(now, now + seekTime + arrival);
      video.framesDue.push({ frame: frameShownAt(target), at, seekEndsAt: now + seekTime });
      video.framesDue.sort((a, b) => a.at - b.at);
    };
    const apply = (decision: SeekDecision) => {
      pending = decision.pending;
      timerAt = decision.effects.some((e) => e.type === 'armTimer') ? now + 1000 : null;
      for (const effect of decision.effects) if (effect.type === 'fire') seekTo(effect.target);
    };
    const settle = () => {
      const held = frameStart(frameShownAt(video.currentTime));
      video.clock = stepClock(video.clock, {
        type: 'seeked',
        heldFrameTime: playback.readsHeldFrame ? held : null,
        currentTime: video.currentTime,
        seeking: video.seeking,
      });
    };
    const isBusy = () => video.seeking || pending != null || video.framesDue.length > 0;
    const tick = () => {
      // A step's frame can come after the next step's `seeking` (Chrome, YouTube).
      while (video.framesDue.length > 0 && now >= video.framesDue[0].at) {
        present(video.framesDue.shift()!.frame);
      }
      if (video.seeking && now >= video.seekEndsAt) {
        // Where the frame can't be read at `seeked` (Firefox), an earlier seek's frame comes before this
        // seek's `seeked`: in recorded Chrome, YouTube and Firefox seeks (round 6 traces) a late frame
        // came after the next `seeking`, never after the next `seeked`. Where it can (Chrome), the
        // model lets it come later, which the clock's read guards.
        const late = playback.readsHeldFrame
          ? []
          : video.framesDue.filter((due) => due.seekEndsAt < video.seekEndsAt);
        late.forEach((due) => present(due.frame));
        video.framesDue = video.framesDue.filter((due) => !late.includes(due));
        video.seeking = false;
        if (!playback.coalescerFirst) settle();
        apply(onSeekSettled(pending, video.currentTime, false));
        if (playback.coalescerFirst) settle();
      }
      if (timerAt != null && now >= timerAt) {
        timerAt = null;
        apply(onSeekSettled(pending, video.currentTime, video.seeking));
      }
    };
    const frameOnScreen = () => video.clock.onScreen?.mediaTime ?? video.currentTime;
    present(startFrame);
    const results: {
      afterUserSeek: boolean;
      nearRoundedBoundary: boolean;
      oneWay: boolean;
      wanted: number;
      moved: number;
      ended: boolean;
      monotonic: boolean;
      // Every frame shown during the burst, in order.
      shown: number[];
      // Times with no seek in flight when `frameTime` read another frame than the playhead's.
      frameTimeMisses: number;
    }[] = [];
    for (const burst of bursts) {
      for (; isBusy(); now++) tick();
      now += 500;
      let from = video.shownFrame;
      if (burst.userSeek != null) {
        apply(onExternalSeek());
        seekTo(burst.userSeek.time);
        from = frameShownAt(burst.userSeek.time);
        for (const end = now + burst.userSeek.lead; now < end; now++) tick();
      }
      const shownFrom = shownLog.length;
      const burstStart = now;
      const stepFpsAt = (step: number) => burst.fpsAt?.(step) ?? stepFps;
      let step = 0;
      let frameTimeMisses = 0;
      for (; step < burst.moves.length || isBusy(); now++) {
        tick();
        // An edit now (P1): the time read means the playhead's own frame.
        if (!video.seeking && pending == null) {
          const time = frameTimeOf({
            presentedFrameTime: frameOnScreen(),
            playhead: video.currentTime,
            isSeekInFlight: false,
            isFrameCurrent: isFrameCurrent(video.clock),
            ownSeek: null,
            fps: stepFps,
            isRead: video.clock.onScreen?.isRead ?? false,
            isRateExact: stepFps === videoFps,
          });
          if (frameShownAt(time + 0.001) !== frameShownAt(video.currentTime)) frameTimeMisses++;
        }
        while (step < burst.moves.length && now >= burstStart + step * burst.gap) {
          const target = stepTargetOf({
            presentedFrameTime: frameOnScreen(),
            isFrameCurrent: isFrameCurrent(video.clock),
            playhead: pending ?? video.currentTime,
            isSeekInFlight: video.seeking || pending != null,
            lastTarget,
            fps: stepFpsAt(step),
            duration,
            frames: burst.moves[step],
            isRead: video.clock.onScreen?.isRead ?? false,
            isRateExact: stepFpsAt(step) === videoFps,
          });
          lastTarget = target;
          apply(onSeekRequest(target, video.currentTime, video.seeking));
          step++;
        }
      }
      const shown = shownLog.slice(shownFrom);
      const wanted = burst.moves.reduce((sum, move) => sum + move, 0);
      const direction = Math.sign(burst.moves[0]);
      const oneWay = burst.moves.every((move) => Math.sign(move) === direction);
      results.push({
        oneWay,
        wanted,
        afterUserSeek: burst.userSeek != null,
        // With millisecond-rounded frame times a playhead within half a millisecond of a boundary can
        // be in either frame until the seek presents one: a step taken first can be one frame off.
        nearRoundedBoundary:
          roundToMs &&
          burst.userSeek != null &&
          Math.abs(burst.userSeek.time * videoFps - Math.round(burst.userSeek.time * videoFps)) <
            0.0005 * videoFps,
        moved: video.shownFrame - from,
        ended: video.shownFrame === Math.min(Math.max(from + wanted, 0), lastFrame),
        shown,
        frameTimeMisses,
        monotonic:
          !oneWay || shown.every((n, i) => direction * (n - (i === 0 ? from : shown[i - 1])) >= 0),
      });
    }
    return results;
  }

  const MATCHED_RATES = [24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
  const MISMATCHED_RATES = [
    [30000 / 1001, 30],
    [30, 30000 / 1001],
    [30, 25],
    [25, 30],
    [24, 60],
    [25, 60],
    [30, 60],
    [50, 60],
  ];
  function scenario(seed: number, rates: readonly (readonly number[])[]) {
    const random = mulberry32(seed);
    const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const [videoFps, stepFps] = pick(rates);
    // One seek in ten outlasts the coalescer's timer.
    const seekTime =
      random() < 0.1 ? 1000 + Math.floor(random() * 6000) : 5 + Math.floor(random() * 396);
    const arrival = Math.floor(-seekTime + random() * (seekTime + 50));
    // Anywhere in a long video, so a rate slightly off drifts across the video's frame boundaries.
    const startFrame = Math.floor(random() * 100000);
    const bursts = Array.from({ length: 4 }, (): Burst => {
      const length = 1 + Math.floor(random() * 30);
      const size = pick([1, 1, 1, 5]);
      const reverses = random() < 0.25;
      const direction = random() < 0.5 ? 1 : -1;
      const moves = Array.from(
        { length },
        (_, k) => (reverses && k >= length / 2 ? -direction : direction) * size
      );
      // One user seek in five within half a millisecond of a frame boundary, where the floor of the
      // playhead must still read its own frame.
      const frames =
        random() < 0.2
          ? startFrame + Math.floor(random() * 300) + (random() - 0.5) * 0.001 * videoFps
          : startFrame + random() * 300;
      const userSeek =
        random() < 0.3 ? { time: frames / videoFps, lead: Math.floor(random() * 60) } : undefined;
      return { moves, gap: Math.floor(random() * 301), userSeek };
    });
    const playback = {
      videoFps,
      stepFps,
      seekTime,
      arrival,
      roundToMs: random() < 0.5,
      startFrame,
      // Chrome reads the held frame; Firefox doesn't. Either listener order.
      readsHeldFrame: random() < 0.5,
      coalescerFirst: random() < 0.5,
    };
    return { seed, playback, bursts };
  }
  const failures = (
    scenarios: ReturnType<typeof scenario>[],
    isWrong: (r: ReturnType<typeof playBursts>[number], s: Playback) => boolean
  ) =>
    scenarios.flatMap(({ seed, playback, bursts }) =>
      playBursts(playback, bursts)
        .filter((r) => isWrong(r, playback))
        .map((r) => ({ seed, ...r }))
    );

  it('moves every burst by exactly its steps at a matched rate, whatever the timing', () => {
    const scenarios = Array.from({ length: 600 }, (_, i) =>
      scenario(
        i + 1,
        MATCHED_RATES.map((rate) => [rate, rate])
      )
    );
    const isWrong = (r: ReturnType<typeof playBursts>[number]) =>
      !r.monotonic || !(r.ended || (r.nearRoundedBoundary && Math.abs(r.moved - r.wanted) <= 1));
    expect(failures(scenarios, isWrong)).toEqual([]);
  });

  // Before a rate is confirmed (S3): never backward, and at least one frame per as many steps as the
  // rate in use has frames per video frame. Right after a user seek a step starts from the playhead's
  // grid frame, which on another grid can start in the video frame before: one step can be lost.
  it('moves a one-way burst forward, never stuck, at a rate in use other than the video', () => {
    const scenarios = Array.from({ length: 600 }, (_, i) => scenario(i + 1, MISMATCHED_RATES));
    const isWrong = (r: ReturnType<typeof playBursts>[number], s: Playback) =>
      r.oneWay &&
      (!r.monotonic ||
        Math.sign(r.moved) * Math.sign(r.wanted) < 0 ||
        Math.abs(r.moved) <
          Math.floor(Math.abs(r.wanted) / Math.ceil(s.stepFps / s.videoFps)) -
            (r.afterUserSeek ? 1 : 0));
    expect(failures(scenarios, isWrong)).toEqual([]);
  });

  // P1 through the same browser model: an edit at any moment with no seek in flight, during or after
  // a burst, reads a time in the playhead's own frame.
  it("reads the playhead's frame whenever no seek is in flight, at any rate in use", () => {
    const rates = [...MATCHED_RATES.map((rate) => [rate, rate]), ...MISMATCHED_RATES];
    const scenarios = Array.from({ length: 600 }, (_, i) => scenario(i + 1, rates));
    const isWrong = (r: ReturnType<typeof playBursts>[number]) =>
      r.frameTimeMisses > 0 && !r.nearRoundedBoundary;
    expect(
      failures(scenarios, isWrong).map(({ seed, frameTimeMisses }) => ({ seed, frameTimeMisses }))
    ).toEqual([]);
  });
  it.each([
    [30, 60, 30],
    [30, 30, 60],
    [30000 / 1001, 30, 30000 / 1001],
    [25, 60, 25],
  ])(
    'never moves back when the rate in use changes mid-burst on a %p fps video, %p to %p',
    (videoFps, from, to) => {
      const wrong = Array.from({ length: 100 }, (_, i) => {
        const { playback, bursts } = scenario(i + 1, [[videoFps, to]]);
        const change = i % 10;
        const oneWay = bursts.map((b) => ({
          ...b,
          moves: b.moves.map(() => Math.sign(b.moves[0])),
          fpsAt: (step: number) => (step < change ? from : to),
        }));
        return playBursts(playback, oneWay).filter((r) => !r.monotonic || r.moved * r.wanted < 0);
      }).flat();
      expect(wrong).toEqual([]);
    }
  );

  // S2 in YouTube's frame order, at its stats rate before measuring: every paused step starts again
  // from the frame on screen, so 29.97 read as 30 never builds up.
  it('steps every frame of a 29.97 fps video at 30 fps over 1500 paused steps, frames shown before seeking', () => {
    const playback = {
      videoFps: 30000 / 1001,
      stepFps: 30,
      seekTime: 20,
      arrival: -20,
      roundToMs: true,
      startFrame: 90,
      framesBeforeSeeking: true,
    };
    const [result] = playBursts(playback, [{ moves: Array(1500).fill(1), gap: 100 }]);
    expect(result.shown).toEqual(Array.from({ length: 1500 }, (_, i) => 91 + i));
  });
  it('stops on the last and first frames, and steps back from the end', () => {
    const playback = {
      videoFps: 30,
      stepFps: 30,
      seekTime: 20,
      arrival: 5,
      roundToMs: false,
      startFrame: 95,
      lastFrame: 99,
      durationFrames: 100,
    };
    const results = playBursts(playback, [
      { moves: Array(10).fill(1), gap: 100 },
      { moves: [-1], gap: 0 },
      { moves: [-1], gap: 0 },
      { moves: [-1, -1, -1], gap: 50, userSeek: { time: 1 / 30 + 0.01, lead: 30 } },
      { moves: [1], gap: 0 },
    ]);
    expect(results.map((r) => r.ended)).toEqual([true, true, true, true, true]);
  });
});

// Seeks recorded in Chrome (synthetic clips and YouTube) and Firefox: step bursts through a coalescer
// like seekToSafe, jumps, a seek within one frame, a user seek during a seek. Events in order:
// ['fire' | 'userSeek', target], ['seeking'], ['seeked', currentTime, frame read by new VideoFrame],
// ['frame', mediaTime, presentedFrames, currentTime, paused]. The clips are 30 fps.
const SEEK_TRACES: Record<string, (string | number | null)[][]> = JSON.parse(
  readFileSync(join(__dirname, 'frame-seek-traces.json'), 'utf8')
);

// Replays a trace through the frame clock, calling `onSettled` after each event that leaves the video
// paused with no seek in flight, after the first seek. `want` is the playhead's frame of the 30 fps clip.
function replaySettled(
  name: string,
  onSettled: (at: {
    type: string;
    clock: ClockState;
    currentTime: number;
    want: number;
    lastFrame: number;
    lastFire: number | null;
  }) => void
): void {
  const events = SEEK_TRACES[name];
  const lastFrame = Math.max(
    ...events.filter((e) => e[0] === 'frame').map((e) => Math.floor((e[1] as number) * 30 + 0.02))
  );
  let clock = initialClock;
  let inFlight = false;
  let currentTime = 0;
  let lastFire: number | null = null;
  // The clips play before the first seek; during playback the time read is the picture's (P4).
  let seeked = false;
  let playing = false;
  for (const [type, a, b, c, d] of events) {
    if (type === 'fire' || type === 'userSeek') inFlight = seeked = true;
    if (type === 'fire') lastFire = a as number;
    if (type === 'seeking') clock = stepClock(clock, { type: 'seeking' });
    if (type === 'seeked') {
      currentTime = a as number;
      clock = stepClock(clock, {
        type: 'seeked',
        heldFrameTime: b as number | null,
        currentTime,
        seeking: false,
      });
      inFlight = false;
    }
    if (type === 'frame') {
      currentTime = c as number;
      clock = stepClock(clock, {
        type: 'frame',
        frame: {
          mediaTime: a as number,
          duringSeek: inFlight,
          droppedFrames: 0,
          presentedFrames: b as number,
          decodedFrames: b as number,
          paused: d !== false,
          playbackRate: 1,
        },
      });
    }
    if (type === 'frame') playing = d === false;
    if (!seeked || playing || inFlight || type === 'fire' || type === 'userSeek') continue;
    const want = Math.min(Math.floor(currentTime * 30 + 1e-6), lastFrame);
    onSettled({ type: type as string, clock, currentTime, want, lastFrame, lastFire });
  }
}

describe('frameTime over recorded seeks', () => {
  it.each(Object.keys(SEEK_TRACES).flatMap((name) => [30, 60].map((fps) => [name, fps] as const)))(
    'reads the playhead frame of %s whenever no seek is in flight, at %p fps in use',
    (name, fps) => {
      const misses: string[] = [];
      replaySettled(name, ({ type, clock, currentTime, want }) => {
        const time = frameTimeOf({
          presentedFrameTime: clock.onScreen?.mediaTime ?? currentTime,
          playhead: currentTime,
          isSeekInFlight: false,
          isFrameCurrent: isFrameCurrent(clock),
          ownSeek: null,
          fps,
          isRead: clock.onScreen?.isRead ?? false,
          isRateExact: fps === 30,
        });
        const got = Math.floor((time + 0.001) * 30 + 1e-6);
        if (got !== want) misses.push(`${type} at frame ${want} read ${got}`);
      });
      expect(misses).toEqual([]);
    }
  );
});

describe('frameStepTarget over recorded seeks', () => {
  // From every settled moment, one step either way shows the neighbor frame, whether or not the
  // last seek the markup made counts as a step's.
  it.each(Object.keys(SEEK_TRACES))('steps to the neighbor frames of %s at 30 fps', (name) => {
    const misses: string[] = [];
    replaySettled(name, ({ type, clock, currentTime, want, lastFrame, lastFire }) => {
      for (const lastTarget of [null, lastFire]) {
        for (const frames of [1, -1]) {
          const target = stepTargetOf({
            presentedFrameTime: clock.onScreen?.mediaTime ?? currentTime,
            playhead: currentTime,
            isFrameCurrent: isFrameCurrent(clock),
            lastTarget,
            fps: 30,
            duration: (lastFrame + 1) / 30,
            frames,
            isRead: clock.onScreen?.isRead ?? false,
            isRateExact: fps === 30,
          });
          const expected = Math.min(Math.max(want + frames, 0), lastFrame);
          const got = Math.floor(target * 30 + 1e-6);
          if (got !== expected) misses.push(`${type} at ${want} ${frames} went to ${got}`);
        }
      }
    });
    expect(misses).toEqual([]);
  });
});

// Held refreshes per frame that Chromium's frame selection gives each display and video rate, from a
// port of its VideoCadenceEstimator and VideoRendererAlgorithm checked against Chromium's tests:
// after a seek (`afterReset`), and in steady playback (`playing`, some with a drift reset).
const DISPLAY_CADENCES: {
  hz: number;
  fps: number;
  cadence: number[];
  afterReset: number[];
  playing: number[];
}[] = JSON.parse(readFileSync(join(__dirname, 'display-cadences.json'), 'utf8'));

describe('loopTurnBack', () => {
  // A 30 fps loop over frames 30 through 60 (1 s to the end marker on frame 60's start), playing on
  // a 60 Hz display, its end frame on screen since the refresh before.
  const GAP = 1000 / 60;
  const at = (loop: Partial<LoopRefresh>) =>
    loopTurnBack({
      grid: { origin: 0, rate: 30 },
      start: 1,
      end: 2,
      isPlaying: true,
      time: 2,
      playhead: 2.01,
      held: { time: 2, duration: 1 / 30 },
      refresh: { time: 1000, gap: GAP },
      playbackRate: 1,
      lastOtherFrameAt: 1000 - GAP,
      ...loop,
    });
  const backTo = (time: number) => expect.closeTo(time + PLACEMENT_TOLERANCE, 6);
  const frame = (time: number, duration: number | null = 1 / 30) => ({
    time,
    playhead: time + 0.01,
    held: { time, duration },
  });

  it.each<[string, Partial<LoopRefresh>, unknown]>([
    ['holds the end frame its first refresh', {}, null],
    [
      'turns back on the end frame once it has shown its time',
      { lastOtherFrameAt: 1000 - 2 * GAP },
      backTo(1),
    ],
    ['keeps playing inside the loop', frame(1.5), null],
    ['turns back from a frame before the start', frame(0.5), backTo(1)],
    // Firefox reads no held frame: the loop turns back as the end frame shows, with no hold.
    ['Firefox, on the end frame', { held: null }, backTo(1)],
    ['Firefox, on the frame before the end', { held: null, time: 59 / 30, playhead: 1.99 }, null],
    ['paused on the end frame', { isPlaying: false, held: null, time: 2, playhead: 2 }, null],
    [
      'paused past the end',
      { isPlaying: false, held: null, time: 2.04, playhead: 2.04 },
      backTo(1),
    ],
    // The assumed 60 fps on 24 fps video, the end marker inside video frame 48 (2 s to 2.0417 s) but
    // on the grid frame after the one it shows: the playhead past the end turns back, else the
    // frame after it does, as in 5.48.
    [
      'an assumed rate, a mid-frame end, the playhead past it',
      { grid: { origin: 0, rate: 60 }, end: 2.03, ...frame(2, 1 / 24), playhead: 2.035 },
      backTo(1),
    ],
    [
      'an assumed rate, a mid-frame end, the playhead before it',
      { grid: { origin: 0, rate: 60 }, end: 2.03, ...frame(2, 1 / 24), playhead: 2.02 },
      null,
    ],
    // An Afreeca TV part: times on the platform's timeline, an hour on.
    ['an Afreeca TV part, the end frame held', { start: 3601, end: 3602, ...frame(3602) }, null],
    [
      'an Afreeca TV part, the end frame shown its time',
      { start: 3601, end: 3602, ...frame(3602), lastOtherFrameAt: 1000 - 2 * GAP },
      backTo(3601),
    ],
  ])('%s', (_name, loop, expected) => {
    expect(at(loop).seekTo).toEqual(expected);
  });
});

describe('the loop end frame over display cadences', () => {
  interface Display {
    // The gap a refresh reads over the true interval.
    gapError?: number;
    // Refreshes whose animation frame callback doesn't run.
    isMissed?: (refresh: number) => boolean;
    // Each refresh's time off by up to this share of the interval, either way.
    jitter?: number;
    // The duration (s) the browser reports for frame `frame`, else exactly 1 / fps.
    reported?: (fps: number, frame: number) => number | null;
    // The rate in use, else the video's.
    rate?: number;
    playbackRate?: number;
  }
  // The loop checks on each refresh (time clamped to 100 us, as Chrome gives it outside
  // cross-origin isolation) with `counts[i]` the end frame, the loop's frames 0 through i. The
  // refresh of the end frame it seeks on (0 or less on an earlier frame), else null.
  function seekRefresh(hz: number, fps: number, counts: number[], i: number, d: Display) {
    const shown = [-1, -1, ...counts.flatMap((count, frame) => Array(count).fill(frame))];
    const first = shown.indexOf(i);
    const grid = { origin: 0, rate: d.rate ?? fps };
    let previous = NaN;
    let lastOtherFrameAt = -Infinity;
    for (let j = 0; j < first + counts[i]; j++) {
      if (d.isMissed?.(j)) continue;
      // A fixed scatter (sin of a large multiple), so a failure replays.
      const offset = (d.jitter ?? 0) * Math.sin(j * 12.9898);
      const time = Math.floor((1000 + ((j + offset) * 1000) / hz) * 10) / 10;
      const refresh = { time, gap: (time - previous) * (d.gapError ?? 1) };
      previous = time;
      // Frames before the loop's first read as no held frame.
      const frameStart = Math.max(0, shown[j]) / fps;
      const duration = d.reported ? d.reported(fps, shown[j]) : 1 / fps;
      const turn = loopTurnBack({
        grid,
        start: 0,
        end: i / fps,
        isPlaying: true,
        time: frameStart,
        playhead: frameStart,
        held: shown[j] < 0 ? null : { time: frameStart, duration },
        refresh,
        playbackRate: d.playbackRate ?? 1,
        lastOtherFrameAt,
      });
      lastOtherFrameAt = turn.lastOtherFrameAt;
      if (turn.seekTo != null) return j - first + 1;
    }
    return null;
  }
  // Each frame (after the first two) as a loop's end frame, where the loop seeks after its last
  // refresh. A frame held 0 refreshes never shows, and with its last refresh missed the loop has no
  // check left to seek on.
  function overshoots(display: Display = {}): string[] {
    const late: string[] = [];
    for (const { hz, fps, afterReset, playing } of DISPLAY_CADENCES) {
      for (const counts of [afterReset, playing]) {
        for (let i = 2; i < counts.length; i++) {
          const lastRefresh = 2 + counts.slice(0, i + 1).reduce((a, b) => a + b, 0) - 1;
          if (counts[i] === 0 || display.isMissed?.(lastRefresh)) continue;
          const seekOn = seekRefresh(hz, fps, counts, i, display);
          if (seekOn == null || seekOn < 1) late.push(`${hz} Hz ${fps} fps frame ${i}: ${seekOn}`);
        }
      }
    }
    return late;
  }

  it.each<[string, Display]>([
    ['exact', {}],
    ['the gap 3% long', { gapError: 1.03 }],
    ['the gap 3% short', { gapError: 0.97 }],
    ['every 7th refresh missed', { isMissed: (j) => j % 7 === 3 }],
    ['every 3rd refresh missed', { isMissed: (j) => j % 3 === 1 }],
    ['each refresh time off by up to 3%', { jitter: 0.03 }],
    // webm stores times in ms, and Chrome reports the frame duration from them (42000 us at 24 fps).
    ['the frame duration rounded to the ms', { reported: (fps) => Math.round(1000 / fps) / 1000 }],
    [
      'each frame duration between ms-rounded times',
      {
        reported: (fps, frame) =>
          (Math.round(((frame + 1) * 1000) / fps) - Math.round((frame * 1000) / fps)) / 1000,
      },
    ],
  ])('never holds past the end frame, %s', (_name, display) => {
    expect(overshoots(display)).toEqual([]);
  });

  it.each([
    [60, 24, 2],
    [60, 30, 2],
    [60, 60, 1],
    [50, 30, 1],
    [120, 30, 4],
    [144, 25, 5],
    [144, 30, 4],
    [165, 24, 6],
  ])('holds the end frame at %i Hz, %i fps for %i refreshes', (hz, fps, expected) => {
    expect(seekRefresh(hz, fps, [9, 9, 99], 2, {})).toBe(expected);
  });

  // At the assumed 60 fps, on 24 fps video: the frame's reported duration (us) times the end frame,
  // and without one a frame at the rate in use. Chrome reports 41667 on mp4, 42000 on webm.
  it.each([
    [120, 41667, 1, 5],
    [120, 42000, 1, 5],
    [144, 41667, 1, 6],
    [50, 41667, 1, 2],
    [120, 41667, 0.5, 10],
    [120, null, 1, 2],
    [120, 0, 1, 2],
  ])(
    'at %i Hz with a reported duration of %p us at %px, holds the end frame %i refreshes',
    (hz, reported, playbackRate, expected) => {
      const display = {
        reported: () => (reported == null ? null : reported / 1e6),
        rate: 60,
        playbackRate,
      };
      expect(seekRefresh(hz, 24, [9, 9, 99], 2, display)).toBe(expected);
    }
  );

  it('turns back at once before a refresh gap is known', () => {
    expect(shouldHoldEndFrame({ time: 1000, gap: NaN }, 990, 1000 / 30)).toBe(false);
  });
});
