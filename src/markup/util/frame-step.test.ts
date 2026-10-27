import { frameStepTarget } from './frame-step';

const fps = 30;
const frame = (n: number) => n / fps;
const middleOf = (n: number) => (n + 0.5) / fps;

describe('frameStepTarget', () => {
  it.each([
    ['one forward from a frame start', frame(90), frame(90), null, 1, middleOf(91)],
    ['one back from a frame start', frame(90), frame(90), null, -1, middleOf(89)],
    ['three forward', frame(90), frame(90), null, 3, middleOf(93)],
    // The playhead can sit anywhere in the frame on screen, as after pausing playback.
    ['from late in the frame on screen', frame(90), frame(90) + 0.9 / fps, null, 1, middleOf(91)],
    // A seek to a boundary can land a hair before it while the frame on screen is the later one.
    ['from just before the frame start', frame(90), frame(90) - 1e-6, null, 1, middleOf(91)],
    // A millisecond-rounded frame time, as on YouTube.
    ['from a rounded frame time', 3.003, 3.003, null, 1, 3.003 + 1.5 / fps],
    // The previous step's seek hasn't presented its frame yet: chain from its target.
    ['chained while a step is pending', frame(90), middleOf(91), middleOf(91), 1, middleOf(92)],
    // The playhead moved on since the last step (playback, another seek): use the frame on screen.
    ['after the playhead moved on', frame(120), frame(120) + 0.01, middleOf(91), 1, middleOf(121)],
  ])('%s', (_case, presentedFrameTime, playhead, lastTarget, frames, expected) => {
    expect(frameStepTarget({ presentedFrameTime, playhead, lastTarget, fps, frames })).toBeCloseTo(
      expected,
      9
    );
  });
});
