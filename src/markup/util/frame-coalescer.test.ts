import { coalescePerAnimationFrame } from './frame-coalescer';

describe('coalescePerAnimationFrame', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  const runFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    globalThis.requestAnimationFrame = (callback) => {
      frames.set(nextFrameId, callback);
      return nextFrameId++;
    };
    globalThis.cancelAnimationFrame = (id) => {
      frames.delete(id);
    };
  });

  test.each([
    ['handles only the latest value once per frame', [1, 2, 3], 'frame', [3]],
    ['flush handles the pending value immediately', [1, 2], 'flush', [2]],
    ['cancel drops the pending value', [1, 2], 'cancel', []],
    ['nothing scheduled handles nothing', [], 'flush', []],
  ] as const)('%s', (_name, scheduled, action, expected) => {
    const handle = jest.fn();
    const coalescer = coalescePerAnimationFrame<number>(handle);
    scheduled.forEach((value) => coalescer.schedule(value));
    if (action === 'flush') coalescer.flush();
    if (action === 'cancel') coalescer.cancel();
    runFrame();
    expect(handle.mock.calls.map(([value]) => value)).toEqual(expected);
  });

  test('a value scheduled after a frame ran is handled on the next frame', () => {
    const handle = jest.fn();
    const coalescer = coalescePerAnimationFrame<number>(handle);
    coalescer.schedule(1);
    runFrame();
    coalescer.schedule(2);
    expect(handle).toHaveBeenCalledTimes(1);
    runFrame();
    expect(handle).toHaveBeenLastCalledWith(2);
  });
});
