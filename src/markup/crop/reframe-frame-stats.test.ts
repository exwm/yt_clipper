import { ReframeFrameSample, recordReframeFrame, summarizeReframeFrames } from './reframe-frame-stats';

const FPS = 30;

// An even pan at 300 px/s, one redraw per frame on a 60 Hz screen, each drawing its own frame.
function evenPan(count: number, start = 0): ReframeFrameSample[] {
  return Array.from({ length: count }, (_, i) => {
    const mediaTime = start + i / FPS;
    return {
      now: 1000 * mediaTime,
      expectedDisplayTime: 1000 * mediaTime + 8,
      mediaTime,
      presentedFrames: i,
      playbackRate: 1,
      drawMs: 0.5,
      drawnTime: mediaTime,
      cropCenterX: 300 * mediaTime,
      cropCenterY: 200,
      cropWidth: 640,
    };
  });
}

describe('summarizeReframeFrames', () => {
  it('finds nothing wrong with an even pan drawn on time', () => {
    const s = summarizeReframeFrames(evenPan(20), FPS);
    expect(s.videoSeconds).toBeCloseTo(19 / FPS);
    expect(s).toMatchObject({
      redraws: 20,
      skippedFrames: 0,
      lateRedraws: 0,
      pictureOffsetFrames: 0,
      pictureMismatches: 0,
    });
    expect(s.cropOffLinePxMax).toBeCloseTo(0);
  });

  it.each([
    [
      'a skipped redraw',
      (samples: ReframeFrameSample[]) => samples.filter((s) => s.presentedFrames !== 10),
      { skippedFrames: 1, lateRedraws: 0, pictureMismatches: 0 },
    ],
    [
      'a late redraw',
      (samples: ReframeFrameSample[]) =>
        samples.map((s, i) => (i === 10 ? { ...s, now: s.expectedDisplayTime + 5 } : s)),
      { skippedFrames: 0, lateRedraws: 1, pictureMismatches: 0 },
    ],
    [
      "a picture from the next frame",
      (samples: ReframeFrameSample[]) =>
        samples.map((s, i) => (i === 10 ? { ...s, drawnTime: s.mediaTime + 1 / FPS } : s)),
      { skippedFrames: 0, lateRedraws: 0, pictureMismatches: 1 },
    ],
  ])('counts %s', (_, change, expected) => {
    expect(summarizeReframeFrames(change(evenPan(20)), FPS)).toMatchObject(expected);
  });

  it('reads a constant picture offset as the usual one, not as mismatches', () => {
    const shifted = evenPan(20).map((s) => ({ ...s, drawnTime: s.mediaTime + 0.5 / FPS }));
    const s = summarizeReframeFrames(shifted, FPS);
    expect(s.pictureOffsetFrames).toBeCloseTo(0.5);
    expect(s.pictureMismatches).toBe(0);
  });

  it('measures a crop jump off the line through its neighbors', () => {
    const jump = evenPan(20).map((s, i) => (i === 10 ? { ...s, cropCenterX: s.cropCenterX + 7 } : s));
    expect(summarizeReframeFrames(jump, FPS).cropOffLinePxMax).toBeCloseTo(7);
  });

  it('leaves the picture offset out when the browser cannot tell the drawn frame', () => {
    const unknown = evenPan(20).map((s) => ({ ...s, drawnTime: null }));
    expect(summarizeReframeFrames(unknown, FPS)).toMatchObject({
      pictureOffsetFrames: null,
      pictureMismatches: null,
    });
  });
});

describe('recordReframeFrame', () => {
  it('reports each 2 s window of playback, and starts over at a seek', () => {
    const reports: number[] = [];
    const report = (s: { redraws: number }) => reports.push(s.redraws);
    // 1 s, then a seek back, then 2.5 s: only the window after the seek fills.
    for (const s of [...evenPan(30, 10), ...evenPan(75, 2)]) recordReframeFrame(s, FPS, report);
    expect(reports).toEqual([61]);
  });
});
