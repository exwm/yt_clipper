import { frameDecisionTime, frameStepTarget } from './frame-step';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;

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
  ] as const)('%s', (_case, presentedFrameTime, playhead, lastFrameSeek, expected) => {
    expect(frameDecisionTime({ presentedFrameTime, playhead, lastFrameSeek, fps })).toBe(expected);
  });
});

describe('frameStepTarget', () => {
  // A step from frame 90 to 91, and one taken on 92 to 93.
  const stepFrom90 = { target: middleOf(91), presentedFrameTime: frame(90), direction: 1 };
  const stepTo93 = { target: middleOf(93), presentedFrameTime: frame(91), direction: 1 };
  it.each([
    ['one forward from a frame start', frame(90), false, frame(90), null, 1, middleOf(91)],
    ['one back from a frame start', frame(90), false, frame(90), null, -1, middleOf(89)],
    ['three forward', frame(90), false, frame(90), null, 3, middleOf(93)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, false, 3.003, null, 1, 3.003 + 1.5 / fps],
    // The last step's seek hasn't presented its frame yet: chain from its target.
    ['chained while a step is pending', frame(90), true, middleOf(91), stepFrom90, 1, middleOf(92)],
    // A slow seek presents an earlier step's frame while the latest step's seek is in flight.
    [
      "chained while an earlier step's frame shows",
      frame(92),
      true,
      middleOf(93),
      stepTo93,
      1,
      middleOf(94),
    ],
    // The last step's seek ended on the frame it started from (a rate too high), or its frame isn't
    // presented yet: chain on.
    [
      'chained when the last step showed no new frame',
      frame(90),
      false,
      middleOf(91),
      stepFrom90,
      1,
      middleOf(92),
    ],
    // No seek in flight and a new frame shows: start from it, so a rate slightly off can't build up.
    [
      'from the frame the last step showed',
      frame(92),
      false,
      middleOf(91),
      stepFrom90,
      1,
      middleOf(93),
    ],
    [
      'after the playhead moved on',
      frame(120),
      true,
      frame(120) + 0.01,
      stepFrom90,
      1,
      middleOf(121),
    ],
  ] as const)(
    '%s',
    (_case, presentedFrameTime, isSeekInFlight, playhead, lastStep, frames, expected) => {
      expect(
        frameStepTarget({ presentedFrameTime, isSeekInFlight, playhead, lastStep, fps, frames })
      ).toBeCloseTo(expected, 9);
    }
  );

  // A seek shows the frame that covers its target. `videoFps` is the video's rate, `fps` the rate in
  // use; each step from a pause, its frame shown before the next.
  function stepsFromAPause(videoFps: number, stepFps: number, steps: number): number[] {
    const shownAt = (time: number) => Math.floor(time * videoFps + 1e-9);
    let presentedFrameTime = 90 / videoFps;
    let lastStep: { target: number; presentedFrameTime: number; direction: number } | null = null;
    const shown: number[] = [];
    for (let i = 0; i < steps; i++) {
      const playhead = lastStep?.target ?? presentedFrameTime;
      const target = frameStepTarget({
        presentedFrameTime,
        isSeekInFlight: false,
        playhead,
        lastStep,
        fps: stepFps,
        frames: 1,
      });
      lastStep = { target, presentedFrameTime, direction: 1 };
      presentedFrameTime = shownAt(target) / videoFps;
      shown.push(shownAt(target));
    }
    return shown;
  }

  it('steps every frame of a 29.97 fps video at 30 fps, over 1500 steps', () => {
    const shown = stepsFromAPause(30000 / 1001, 30, 1500);
    expect(shown.filter((n, i) => n !== 91 + i)).toEqual([]);
  });

  // A rate somewhat off the video's, as before it is measured: each step moves one frame.
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

  // Steps faster than the seeks, which run one at a time with the latest request held back, as
  // seekToSafe runs them. A seek presents its frame `frameDelay` ms after it ends: before (negative)
  // or after, as browsers and sources differ. Times are in ms.
  function stepsDuringSlowSeeks(stepGap: number, seekTime: number, frameDelay: number, moves: number[]) {
    const steps = moves.length;
    const state = {
      shownFrame: 600,
      inFlight: null as { target: number; endsAt: number } | null,
      pending: null as number | null,
      frameDue: [] as { frame: number; at: number }[],
      playhead: middleOf(600),
      lastStep: null as { target: number; presentedFrameTime: number; direction: number } | null,
    };
    const shown: number[] = [];
    const seek = (target: number, now: number) => {
      if (state.inFlight) {
        state.pending = target;
        return;
      }
      state.inFlight = { target, endsAt: now + seekTime };
      state.frameDue.push({ frame: Math.floor(target * fps), at: now + seekTime + frameDelay });
    };
    for (
      let now = 0, step = 0;
      step < steps || state.inFlight || state.frameDue.length > 0;
      now++
    ) {
      while (state.frameDue.length > 0 && now >= state.frameDue[0].at) {
        state.shownFrame = state.frameDue.shift()!.frame;
        shown.push(state.shownFrame);
      }
      const ended = state.inFlight;
      if (ended && now >= ended.endsAt) {
        state.playhead = ended.target;
        state.inFlight = null;
        const pending = state.pending;
        state.pending = null;
        if (pending != null) seek(pending, now);
      }
      while (step < steps && now >= step * stepGap) {
        const target = frameStepTarget({
          presentedFrameTime: frame(state.shownFrame),
          isSeekInFlight: state.inFlight != null || state.pending != null,
          playhead: state.pending ?? state.inFlight?.target ?? state.playhead,
          lastStep: state.lastStep,
          fps,
          frames: moves[step],
        });
        state.lastStep = {
          target,
          presentedFrameTime: frame(state.shownFrame),
          direction: Math.sign(moves[step]),
        };
        seek(target, now);
        step++;
      }
    }
    return shown;
  }

  it.each([
    [0, 300, 15, -1],
    [10, 300, 15, -1],
    [33, 300, 15, -1],
    [33, 40, 15, -1],
    [33, 300, -10, -1],
    [10, 300, -10, 1],
    [100, 20, -5, 1],
    [100, 20, 15, 1],
    // Fast seeks whose frame comes just after the seek ends, steps faster than seek plus frame.
    [33, 20, 15, 1],
    [16, 10, 8, 1],
    [40, 25, 20, 1],
    [33, 20, 15, -1],
  ])(
    'lands every step and moves one way, steps %p ms apart, seeks of %p ms, frame %p ms after, by %p',
    (gap, seek, frameDelay, by) => {
      const shown = stepsDuringSlowSeeks(gap, seek, frameDelay, Array(30).fill(by));
      expect(shown[shown.length - 1]).toBe(600 + 30 * by);
      expect(shown.every((n, i) => i === 0 || by * (n - shown[i - 1]) >= 0)).toBe(true);
    }
  );

  // A burst that turns around before its last frames show: each step still counts.
  it.each([
    ['three forward then three back', [1, 1, 1, -1, -1, -1]],
    ['four of five forward then four back', [5, 5, 5, 5, -5, -5, -5, -5]],
  ])('lands every step of %s', (_case, moves) => {
    const shown = stepsDuringSlowSeeks(8, 5, 8, moves);
    expect(shown[shown.length - 1]).toBe(600);
  });
});
