import { formatFrameLoopWindow, newFrameLoopWindow } from './video-frame-loop-stats';

function filledWindow(timing: 'everyRefresh' | 'frameCallback', videoFramesAtStart: number | null) {
  const w = newFrameLoopWindow(1000, timing, ['reframe', 'minimap'], videoFramesAtStart);
  Object.assign(w, {
    refreshes: 300,
    framesTaken: 150,
    repeats: 3,
    dispatched: 147,
    frameCallbacks: 140,
    frameCallbackMisses: 7,
    loopMs: [0.1, 0.4, 0.2],
    consumerMs: { reframe: [1, 3, 2] },
  });
  return w;
}

describe('formatFrameLoopWindow', () => {
  it('reports what an every-refresh loop did over the window', () => {
    const line = formatFrameLoopWindow(filledWindow('everyRefresh', 10), 6000, 160);
    expect(line).toContain('everyRefresh, 5.0s, reframe + minimap');
    expect(line).toContain('300 refreshes, 150 frames taken, 3 repeats');
    expect(line).toContain('147 new frames, video showed 150');
    expect(line).toContain('7 missed');
    // Median and max of the loop's own time, and of each consumer's.
    expect(line).toContain('loop 0.20/0.40 ms');
    expect(line).toContain('reframe 2.00/3.00 ms');
  });

  it('leaves out the refresh counts under the frame callback', () => {
    const line = formatFrameLoopWindow(filledWindow('frameCallback', 10), 6000, 160);
    expect(line).not.toContain('refreshes');
    expect(line).toContain('147 new frames');
  });

  it("leaves out the video's frame count when either end of it is unknown", () => {
    expect(formatFrameLoopWindow(filledWindow('everyRefresh', null), 6000, 160)).not.toContain(
      'video showed'
    );
    expect(formatFrameLoopWindow(filledWindow('everyRefresh', 10), 6000, null)).not.toContain(
      'video showed'
    );
  });

  it('reads an empty window as zeros', () => {
    const line = formatFrameLoopWindow(newFrameLoopWindow(0, 'everyRefresh', [], null), 0, null);
    expect(line).toContain('loop 0.00/0.00 ms');
  });
});
