import { frameDecisionTime, frameStepTarget } from './frame-step';
import { onExternalSeek, onSeekRequest, onSeekSettled, SeekDecision } from './seek-coalescer';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;
const duration = 3600;

describe('frameDecisionTime', () => {
  // A jump to a marker 1.5 ms before its frame's end: the seek lands 1 ms past it.
  const markerTime = frame(181) - 0.0015;
  const jump = { target: markerTime + 0.001, frameTime: markerTime };
  it.each([
    ['the frame on screen with no seek of ours', frame(90), frame(90) + 0.01, null, frame(90)],
    // The frame on screen is still the one before the seek, or the seek has landed: either way the
    // decision is about the marker's frame, whose time a grid frame lookup reads right.
    ['the seek target while a seek is in flight', frame(150), jump.target, jump, markerTime],
    ['the seek target once it landed', frame(180), jump.target, jump, markerTime],
    [
      'the frame on screen once the playhead moved on',
      frame(183),
      frame(183) + 0.01,
      jump,
      frame(183),
    ],
  ] as const)('%s', (_case, fallbackTime, playhead, lastFrameSeek, expected) => {
    expect(frameDecisionTime({ fallbackTime, playhead, lastFrameSeek, fps })).toBe(expected);
  });
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
    expect(
      frameStepTarget({ presentedFrameTime, playhead, lastTarget, fps, duration, frames })
    ).toBeCloseTo(expected, 9);
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
      framesDue: [] as { frame: number; at: number; seekEndsAt: number }[],
    };
    let pending: number | null = null;
    let timerAt: number | null = null;
    let lastTarget: number | null = null;
    let now = 0;
    const seekTo = (target: number) => {
      video.framesDue = video.framesDue.filter((due) => due.seekEndsAt <= now);
      Object.assign(video, { currentTime: target, seeking: true, seekEndsAt: now + seekTime });
      const at = Math.max(now, now + seekTime + arrival);
      video.framesDue.push({ frame: frameShownAt(target), at, seekEndsAt: now + seekTime });
      video.framesDue.sort((a, b) => a.at - b.at);
    };
    const apply = (decision: SeekDecision) => {
      pending = decision.pending;
      timerAt = decision.effects.some((e) => e.type === 'armTimer') ? now + 1000 : null;
      for (const effect of decision.effects) if (effect.type === 'fire') seekTo(effect.target);
    };
    const isBusy = () => video.seeking || pending != null || video.framesDue.length > 0;
    const tick = () => {
      while (video.framesDue.length > 0 && now >= video.framesDue[0].at) {
        video.shownFrame = video.framesDue.shift()!.frame;
      }
      if (video.seeking && now >= video.seekEndsAt) {
        video.seeking = false;
        apply(onSeekSettled(pending, video.currentTime, false));
      }
      if (timerAt != null && now >= timerAt) {
        timerAt = null;
        apply(onSeekSettled(pending, video.currentTime, video.seeking));
      }
    };
    const results: {
      afterUserSeek: boolean;
      oneWay: boolean;
      wanted: number;
      moved: number;
      ended: boolean;
      monotonic: boolean;
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
      const shown: number[] = [];
      const burstStart = now;
      let step = 0;
      for (; step < burst.moves.length || isBusy(); now++) {
        const before = video.shownFrame;
        tick();
        if (video.shownFrame !== before) shown.push(video.shownFrame);
        while (step < burst.moves.length && now >= burstStart + step * burst.gap) {
          const target = frameStepTarget({
            presentedFrameTime: frameStart(video.shownFrame),
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
      const wanted = burst.moves.reduce((sum, move) => sum + move, 0);
      const direction = Math.sign(burst.moves[0]);
      const oneWay = burst.moves.every((move) => Math.sign(move) === direction);
      results.push({
        oneWay,
        wanted,
        afterUserSeek: burst.userSeek != null,
        moved: video.shownFrame - from,
        ended: video.shownFrame === Math.min(Math.max(from + wanted, 0), lastFrame),
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
      // A user seek with millisecond-rounded frame times can't tell a frame from its neighbor within
      // half a millisecond of their boundary, until its frame is presented: kept out of these runs.
      let frames = startFrame + random() * 300;
      if (Math.abs(frames - Math.round(frames)) < 0.0005 * videoFps) frames += 0.5;
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
    expect(failures(scenarios, (r) => !r.ended || !r.monotonic)).toEqual([]);
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
