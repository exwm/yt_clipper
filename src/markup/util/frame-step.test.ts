import { frameStepTarget } from './frame-step';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;

describe('frameStepTarget', () => {
  // A step from frame 90 to 91, and one taken on 91 to 93.
  const stepFrom90 = { target: middleOf(91), presentedFrameTime: frame(90) };
  const stepTo93 = { target: middleOf(93), presentedFrameTime: frame(91) };
  it.each([
    ['one forward from a frame start', frame(90), true, frame(90), null, 1, middleOf(91)],
    ['one back from a frame start', frame(90), true, frame(90), null, -1, middleOf(89)],
    ['three forward', frame(90), true, frame(90), null, 3, middleOf(93)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, true, 3.003, null, 1, 3.003 + 1.5 / fps],
    // The last step's seek hasn't presented its frame yet: chain from its target.
    [
      'chained while a step is pending',
      frame(90),
      false,
      middleOf(91),
      stepFrom90,
      1,
      middleOf(92),
    ],
    // A slow seek presents an earlier step's frame while the latest step's seek is in flight.
    [
      "chained while an earlier step's frame shows",
      frame(92),
      false,
      middleOf(93),
      stepTo93,
      1,
      middleOf(94),
    ],
    // The last step's seek ended on the frame it started from (a rate too high): chain on.
    [
      'chained when the last step showed no new frame',
      frame(90),
      true,
      middleOf(91),
      stepFrom90,
      1,
      middleOf(92),
    ],
    // The last step's seek ended on a new frame: start from it, so a rate slightly off can't build up.
    [
      'from the frame the last step showed',
      frame(92),
      true,
      middleOf(91),
      stepFrom90,
      1,
      middleOf(93),
    ],
    [
      'after the playhead moved on',
      frame(120),
      false,
      frame(120) + 0.01,
      stepFrom90,
      1,
      middleOf(121),
    ],
  ] as const)(
    '%s',
    (_case, presentedFrameTime, isFrameSettled, playhead, lastStep, frames, expected) => {
      expect(
        frameStepTarget({ presentedFrameTime, isFrameSettled, playhead, lastStep, fps, frames })
      ).toBeCloseTo(expected, 9);
    }
  );

  // A seek shows the frame that covers its target. `videoFps` is the video's rate, `fps` the rate in
  // use; each step from a pause, its frame shown before the next.
  function stepsFromAPause(videoFps: number, stepFps: number, steps: number): number[] {
    const shownAt = (time: number) => Math.floor(time * videoFps + 1e-9);
    let presentedFrameTime = 90 / videoFps;
    let lastStep: { target: number; presentedFrameTime: number } | null = null;
    const shown: number[] = [];
    for (let i = 0; i < steps; i++) {
      const playhead = lastStep?.target ?? presentedFrameTime;
      const target = frameStepTarget({
        presentedFrameTime,
        isFrameSettled: true,
        playhead,
        lastStep,
        fps: stepFps,
        frames: 1,
      });
      lastStep = { target, presentedFrameTime };
      presentedFrameTime = shownAt(target) / videoFps;
      shown.push(shownAt(target));
    }
    return shown;
  }

  it('steps every frame of a 29.97 fps video at 30 fps, over 1500 steps', () => {
    const shown = stepsFromAPause(30000 / 1001, 30, 1500);
    expect(shown.filter((n, i) => n !== 91 + i)).toEqual([]);
  });

  // At twice the rate a step can land on the same frame; the next one still moves forward.
  it('moves forward at a rate too high for the video', () => {
    const shown = stepsFromAPause(30, 60, 20);
    expect(shown.every((n, i) => i === 0 || n >= shown[i - 1])).toBe(true);
    expect(shown[shown.length - 1]).toBe(100);
  });

  // Steps faster than the seeks, which run one at a time with the latest request held back, as
  // seekToSafe runs them. A seek unsettles the frame on screen when it starts and presents its own
  // when it ends. Times are in ms.
  function stepsDuringSlowSeeks(stepGap: number, seekTime: number, steps: number, frames: number) {
    let shownFrame = 600;
    let isFrameSettled = true;
    let inFlight: { target: number; endsAt: number } | null = null;
    let pending: number | null = null;
    let playhead = middleOf(600);
    let lastStep: { target: number; presentedFrameTime: number } | null = null;
    const shown: number[] = [];
    const seek = (target: number, now: number) => {
      if (inFlight) {
        pending = target;
        return;
      }
      inFlight = { target, endsAt: now + seekTime };
      isFrameSettled = false;
    };
    for (let now = 0, step = 0; step < steps || inFlight || pending != null; now++) {
      const ended: { target: number; endsAt: number } | null = inFlight;
      if (ended && now >= ended.endsAt) {
        shownFrame = Math.floor(ended.target * fps);
        playhead = ended.target;
        shown.push(shownFrame);
        inFlight = null;
        isFrameSettled = true;
        if (pending != null) seek(pending, now);
        pending = null;
      }
      while (step < steps && now >= step * stepGap) {
        const current: { target: number } | null = inFlight;
        const target = frameStepTarget({
          presentedFrameTime: frame(shownFrame),
          isFrameSettled,
          playhead: pending ?? current?.target ?? playhead,
          lastStep,
          fps,
          frames,
        });
        lastStep = { target, presentedFrameTime: frame(shownFrame) };
        seek(target, now);
        step++;
      }
    }
    return shown;
  }

  it.each([
    [0, 300, -1],
    [10, 300, -1],
    [33, 300, -1],
    [33, 40, -1],
    [10, 300, 1],
    [100, 20, 1],
  ])(
    'lands every step and moves one way, steps %p ms apart, seeks of %p ms, by %p',
    (gap, seek, by) => {
      const shown = stepsDuringSlowSeeks(gap, seek, 30, by);
      expect(shown[shown.length - 1]).toBe(600 + 30 * by);
      expect(shown.every((n, i) => i === 0 || by * (n - shown[i - 1]) >= 0)).toBe(true);
    }
  );
});
