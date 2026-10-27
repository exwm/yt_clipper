import { frameStepTarget } from './frame-step';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;

describe('frameStepTarget', () => {
  const pendingStep = { target: middleOf(91), presentedFrameTime: frame(90) };
  it.each([
    ['one forward from a frame start', frame(90), frame(90), null, 1, middleOf(91)],
    ['one back from a frame start', frame(90), frame(90), null, -1, middleOf(89)],
    ['three forward', frame(90), frame(90), null, 3, middleOf(93)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, 3.003, null, 1, 3.003 + 1.5 / fps],
    // The last step's seek hasn't presented its frame yet: chain from its target.
    ['chained while a step is pending', frame(90), middleOf(91), pendingStep, 1, middleOf(92)],
    // Back on the frame the last step started from, by another seek: that step is over.
    ['after a seek back to where the last step started', frame(90), middleOf(90), pendingStep, 1, middleOf(91)],
    ['after the playhead moved on', frame(120), frame(120) + 0.01, pendingStep, 1, middleOf(121)],
  ] as const)('%s', (_case, presentedFrameTime, playhead, lastStep, frames, expected) => {
    expect(frameStepTarget({ presentedFrameTime, playhead, lastStep, fps, frames })).toBeCloseTo(
      expected,
      9
    );
  });

  // A seek shows the frame that covers its target. `videoFps` is the video's rate, `fps` the rate in
  // use; each step from a pause, its frame shown before the next.
  function stepsFromAPause(videoFps: number, stepFps: number, steps: number): number[] {
    const shownAt = (time: number) => Math.floor(time * videoFps + 1e-9);
    let presentedFrameTime = 90 / videoFps;
    let lastStep: { target: number; presentedFrameTime: number } | null = null;
    const shown: number[] = [];
    for (let i = 0; i < steps; i++) {
      const playhead = lastStep?.target ?? presentedFrameTime;
      const target = frameStepTarget({ presentedFrameTime, playhead, lastStep, fps: stepFps, frames: 1 });
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
});
