import { readFileSync } from 'fs';
import { join } from 'path';
import { initialClock, isFrameCurrent, stepClock } from './frame-clock-core';
import { frameStepTarget, frameTime } from './frame-step';
import { onExternalSeek, onSeekRequest, onSeekSettled, SeekDecision } from './seek-coalescer';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;
const duration = 3600;

describe('frameTime', () => {
  // A jump to a marker 1.5 ms before its frame's end: the seek lands 1 ms past it.
  const markerTime = frame(181) - 0.0015;
  const jump = { target: markerTime + 0.001, frameTime: markerTime };
  const at = (overrides: Partial<Parameters<typeof frameTime>[0]>) =>
    frameTime({
      presentedFrameTime: frame(90),
      playhead: middleOf(90),
      isSeekInFlight: false,
      isFrameCurrent: true,
      lastFrameSeek: null,
      fps,
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
      { isSeekInFlight: true, playhead: jump.target, lastFrameSeek: jump },
      markerTime,
    ],
    [
      'a jump landed',
      { presentedFrameTime: frame(180), playhead: jump.target, lastFrameSeek: jump },
      markerTime,
    ],
    [
      'the playhead moved on from the jump',
      { presentedFrameTime: frame(183), playhead: frame(183) + 0.01, lastFrameSeek: jump },
      frame(183),
    ],
    // Just before a marker jumped to earlier, in the frame before it.
    [
      'the playhead back before the jump',
      { presentedFrameTime: frame(180), playhead: markerTime - 0.005, lastFrameSeek: jump },
      frame(180),
    ],
    [
      'the playhead back before the jump, its frame not presented',
      {
        isFrameCurrent: false,
        presentedFrameTime: frame(150),
        playhead: markerTime - 0.005,
        lastFrameSeek: jump,
      },
      markerTime - 0.006,
    ],
  ] as const)('%s', (_case, overrides, expected) => {
    expect(at(overrides)).toBeCloseTo(expected, 9);
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

describe('frameStepTarget', () => {
  it.each([
    ['one forward from a frame start', frame(90), frame(90), null, 1, middleOf(91)],
    ['one back from a frame start', frame(90), frame(90), null, -1, middleOf(89)],
    ['three forward', frame(90), frame(90), null, 3, middleOf(93)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, 3.003, null, 1, 3.003 + 1.5 / fps],
    // The frame on screen holds the playhead: step from it.
    [
      'from the frame holding the last target',
      frame(91),
      middleOf(91),
      middleOf(91),
      1,
      middleOf(92),
    ],
    // The last step's seek hasn't presented its frame: the frame on screen can't hold its target.
    ['chained while a step is pending', frame(90), middleOf(91), middleOf(91), 1, middleOf(92)],
    [
      "chained while an earlier step's frame shows",
      frame(92),
      middleOf(94),
      middleOf(94),
      1,
      middleOf(95),
    ],
    [
      "chained back while an earlier step's frame shows",
      frame(92),
      middleOf(90),
      middleOf(90),
      -1,
      middleOf(89),
    ],
    // Nothing near the playhead (a seek elsewhere whose frame hasn't shown): step from the playhead.
    [
      'from the playhead after a seek elsewhere',
      frame(90),
      frame(150) + 0.01,
      middleOf(91),
      1,
      middleOf(151),
    ],
    // In the last millisecond of a frame the playhead is still in it.
    ['from the playhead late in its frame', frame(90), frame(151) - 0.0005, null, 1, middleOf(151)],
    ['back from the first frame', frame(0), frame(0), null, -1, middleOf(0)],
  ] as const)('%s', (_case, presentedFrameTime, playhead, lastTarget, frames, expected) => {
    // The frame on screen was presented after the last seek, as when paused after a step.
    const isFrameCurrent = true;
    expect(
      frameStepTarget({
        presentedFrameTime,
        playhead,
        isFrameCurrent,
        lastTarget,
        fps,
        duration,
        frames,
      })
    ).toBeCloseTo(expected, 9);
  });

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
    };
    expect(frameStepTarget(at)).toBeCloseTo(lastMiddle - 1 / fpsInUse, 9);
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
    };
    expect(frameStepTarget({ ...at, isFrameCurrent: false })).toBeCloseTo(middleOf(151), 9);
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
      const target = frameStepTarget({
        presentedFrameTime,
        playhead,
        isFrameCurrent: true,
        lastTarget,
        fps: stepFps,
        duration,
        frames: 1,
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
      let step = 0;
      let frameTimeMisses = 0;
      for (; step < burst.moves.length || isBusy(); now++) {
        tick();
        // An edit now (P1): the time read means the playhead's own frame.
        if (!video.seeking && pending == null) {
          const time = frameTime({
            presentedFrameTime: frameOnScreen(),
            playhead: video.currentTime,
            isSeekInFlight: false,
            isFrameCurrent: isFrameCurrent(video.clock),
            lastFrameSeek: null,
            fps: stepFps,
          });
          if (frameShownAt(time + 0.001) !== frameShownAt(video.currentTime)) frameTimeMisses++;
        }
        while (step < burst.moves.length && now >= burstStart + step * burst.gap) {
          const target = frameStepTarget({
            presentedFrameTime: frameOnScreen(),
            isFrameCurrent: isFrameCurrent(video.clock),
            playhead: pending ?? video.currentTime,
            lastTarget,
            fps: burst.fpsAt?.(step) ?? stepFps,
            duration,
            frames: burst.moves[step],
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

describe('frameTime over recorded seeks', () => {
  it.each(Object.keys(SEEK_TRACES).flatMap((name) => [30, 60].map((fps) => [name, fps] as const)))(
    'reads the playhead frame of %s whenever no seek is in flight, at %p fps in use',
    (name, fps) => {
      const events = SEEK_TRACES[name];
      const lastFrame = Math.max(
        ...events
          .filter((e) => e[0] === 'frame')
          .map((e) => Math.floor((e[1] as number) * 30 + 0.02))
      );
      let clock = initialClock;
      let inFlight = false;
      let currentTime = 0;
      // The clips play before the first seek; during playback the time read is the picture's (P4).
      let seeked = false;
      let playing = false;
      const misses: string[] = [];
      for (const [type, a, b, c, d] of events) {
        if (type === 'fire' || type === 'userSeek') inFlight = seeked = true;
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
        const time = frameTime({
          presentedFrameTime: clock.onScreen?.mediaTime ?? currentTime,
          playhead: currentTime,
          isSeekInFlight: false,
          isFrameCurrent: isFrameCurrent(clock),
          lastFrameSeek: null,
          fps,
        });
        const want = Math.min(Math.floor(currentTime * 30 + 1e-6), lastFrame);
        const got = Math.floor((time + 0.001) * 30 + 1e-6);
        if (got !== want) misses.push(`${type} at frame ${want} read ${got}`);
      }
      expect(misses).toEqual([]);
    }
  );
});
