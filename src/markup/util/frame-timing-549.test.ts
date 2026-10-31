import { frameTiming549 as timing } from './frame-timing-549';

// A 30 fps grid: frame n starts at n / 30, and a time up to 1 ms before a frame's start means it.
const grid = { origin: 0, rate: 30 };
const pair = { start: 1, end: 2 };

describe('marker frame decisions', () => {
  it.each([
    ['a time 0.5 ms before its frame start', 1 / 30, 1 / 30 - 0.0005, 0],
    ['two times in one frame', 0.5, 0.52, 0],
    ['a later frame', 1, 0.9, 1],
    ['an earlier frame', 0.9, 1, -1],
  ])('compareFrames orders the frames, not the times: %s', (_case, a, b, sign) => {
    expect(Math.sign(timing.compareFrames(grid, a, b))).toBe(sign);
  });

  it.each([
    [1.02, true],
    [1.034, false],
  ])('isOnMarkerFrame: %p shows the frame of a marker at 1 s: %p', (time, expected) => {
    expect(timing.isOnMarkerFrame(grid, time, 1)).toBe(expected);
  });

  it.each([
    ['start', 0.99, true],
    ['start', 1.02, false],
    ['end', 2.034, true],
    ['end', 2.02, false],
  ] as const)(
    'isStretch: the %s marker moved to %p widens the pair: %p',
    (type, time, expected) => {
      expect(timing.isStretch(grid, type, time, pair)).toBe(expected);
    }
  );

  it.each([
    ['start', 5, 59 / 30],
    ['start', -1, 0],
    ['start', 1.5, 1.5],
    ['end', 0.5, 31 / 30],
    ['end', 20, 10],
    ['end', 1.5, 1.5],
  ] as const)(
    'dragClamp keeps a dragged %s marker at %p off the other frame: %p',
    (type, time, to) => {
      expect(timing.dragClamp(grid, type, time, pair, 10)).toBeCloseTo(to, 9);
    }
  );

  it.each([
    ['back a frame', 1, 1, 29 / 30],
    ['on a frame', 1, -1, 31 / 30],
    ['back from the first frame, to the start', 0, 1, 0],
    ['on from the last frame, to the end', 10, -1, 10],
  ])('nudge moves a marker and seeks %s', (_case, markerTime, deltaY, to) => {
    const { markerTime: moved, seekTime } = timing.nudge(grid, markerTime, deltaY, 10);
    expect(moved).toBeCloseTo(to, 9);
    expect(seekTime).toBe(moved);
  });

  // 2.02 is on the frame of the marker at 2 s.
  const markers = [1, 2, 3, 2.02];
  it.each([
    ['back past the current frame', 2.01, 'ArrowLeft', false, 1],
    ['back with nothing before', 1, 'ArrowLeft', false, null],
    ['back twice with one marker before', 2.01, 'ArrowLeft', true, 1],
    ['back once to the nearest marker', 3.5, 'ArrowLeft', false, 3],
    ['back twice, skipping the nearest marker', 3.5, 'ArrowLeft', true, 2],
    ['on, skipping a marker on the current frame', 2.01, 'ArrowRight', false, 3],
    ['on to the first of two markers on one frame', 1.5, 'ArrowRight', false, 2],
    ['on twice, past that frame', 1.5, 'ArrowRight', true, 3],
    ['on with nothing after', 3, 'ArrowRight', false, null],
  ] as const)('jumpTarget jumps %s', (_case, from, key, isDoubleJump, to) => {
    expect(timing.jumpTarget(grid, markers, from, key, isDoubleJump)).toBe(to);
  });
});

describe('pair and capture frame decisions', () => {
  it.each([
    ['before the start frame', 0.96, false],
    ['on the start frame, 0.5 ms before it', 0.9995, true],
    ['late in the end marker frame', 2.03, true],
    ['on the frame after the end marker', 2.034, false],
  ])('isInPair: a time %s is in the pair: %p', (_case, time, expected) => {
    expect(timing.isInPair(grid, pair, time)).toBe(expected);
  });

  it('pairSpan runs from the start frame through the end marker frame', () => {
    const span = timing.pairSpan(grid, { start: 1.01, end: 2.01 });
    expect(span).toMatchObject({ firstFrame: 30, lastFrame: 60, start: 1 });
    expect(span.end).toBeCloseTo(61 / 30, 9);
  });

  it.each([
    [1, 30],
    [1 - 0.0005, 30],
    [1.032, 30],
    [1.034, 31],
  ])('frameNumber names the frame shown at %p: %p', (time, frame) => {
    expect(timing.frameNumber(grid, time)).toBe(frame);
  });
});

describe('crop point frame decisions', () => {
  const cropMap = [1, 1.5, 2].map((x) => ({ x, y: 0, crop: '0:0:iw:ih' }));

  it.each([
    ['paused on the point frame', 1.5, 1.52, true, 1],
    ['paused, the drawn time a frame past the point', 1.5, 1.534, true, null],
    ['paused between points', 1.2, 1.2, true, null],
    ['playing on the point frame', 1.5, 1.52, false, null],
    // The point is the one at the frame time, never the one under the drawn time.
    ['paused, the frame time and the drawn time on two points', 1.5, 2.01, true, null],
  ])('parkedPointIndex: %s', (_case, frameTime, time, isPaused, index) => {
    expect(timing.parkedPointIndex(grid, cropMap, { frameTime, time, isPaused })).toBe(index);
  });

  it('editFrameTime reads the frame time only while paused', () => {
    const frameTime = jest.fn(() => 1.5);
    expect(timing.editFrameTime({ isPaused: false, presentedTime: 1.52, frameTime })).toBe(1.52);
    expect(frameTime).not.toHaveBeenCalled();
    expect(timing.editFrameTime({ isPaused: true, presentedTime: 1.52, frameTime })).toBe(1.5);
  });

  it.each([
    ['on its frame start', 1, 29.5 / 30],
    ['0.5 ms before its frame start, rounded', 1 - 0.0005, 29.5 / 30],
    ['late in its frame', 1.03, 29.5 / 30],
  ])("cutFrameMiddle: a cut point %s takes effect at the frame before's middle", (_case, x, at) => {
    expect(timing.cutFrameMiddle(grid, x)).toBeCloseTo(at, 9);
  });
});

describe('pairDuration', () => {
  // Frames 30 through 60: 31 frames, 1.033 s.
  it.each([
    [1, '01.033/1 = 01.033 (31)'],
    [2, '01.033/2 = 00.516 (31)'],
  ])('at constant speed %p shows %p', (speed, text) => {
    const speedMap = [
      { x: 1, y: speed },
      { x: 2, y: speed },
    ];
    expect(timing.pairDuration(grid, { ...pair, speed, speedMap }, false).text).toBe(text);
  });

  it('at variable speed shows the output duration in parentheses, then the frames', () => {
    const speedMap = [
      { x: 1, y: 1 },
      { x: 1.5, y: 0.5 },
      { x: 2, y: 1 },
    ];
    const { text, outputDuration } = timing.pairDuration(
      grid,
      { ...pair, speed: 1, speedMap },
      true
    );
    expect(outputDuration).toBeGreaterThan(1);
    expect(text).toMatch(/^01\.033 \(01\.\d{3}\) \(31\)$/);
  });
});
