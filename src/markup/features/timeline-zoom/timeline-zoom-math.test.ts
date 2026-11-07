import {
  clampRange,
  defaultRange,
  easeRangeToward,
  followPlayhead,
  formatTimelineTime,
  fractionToTime,
  rangeFittingSpan,
  panRange,
  resizeRangeEdge,
  ZoomRange,
  timeToFraction,
  visibleLabelIndices,
  wheelNotches,
  zoomRangeAround,
} from './timeline-zoom-math';

const DURATION = 1000;
const MIN_SPAN = 2;

function range(start: number, end: number): ZoomRange {
  return { start, end };
}

describe('clampRange', () => {
  it.each([
    ['keeps a range already inside the video', range(100, 200), range(100, 200)],
    ['shifts a range that starts before 0, keeping its span', range(-50, 50), range(0, 100)],
    [
      'shifts a range that ends after the video, keeping its span',
      range(950, 1050),
      range(900, 1000),
    ],
    ['widens a range narrower than the minimum span', range(100, 100.5), range(100, 102)],
    ['shrinks a range wider than the video to the whole video', range(-10, 2000), range(0, 1000)],
    ['orders a reversed range', range(200, 100), range(100, 200)],
  ])('%s', (_name, input, expected) => {
    expect(clampRange(input, DURATION, MIN_SPAN)).toEqual(expected);
  });

  it('caps the minimum span at a video shorter than it', () => {
    expect(clampRange(range(0, 0.5), 1, MIN_SPAN)).toEqual(range(0, 1));
  });
});

describe('defaultRange', () => {
  it.each([
    ['centres a tenth of the video on the playhead', 500, 1000, range(450, 550)],
    ['caps the span at two minutes on long videos', 5000, 36000, range(4940, 5060)],
    ['uses at least ten seconds on short videos', 30, 60, range(25, 35)],
    ['stays inside the video near its start', 1, 3600, range(0, 120)],
    ['covers the whole of a video shorter than the minimum', 2, 5, range(0, 5)],
  ])('%s', (_name, playhead, duration, expected) => {
    expect(defaultRange(playhead, duration)).toEqual(expected);
  });
});

describe('panRange', () => {
  it.each([
    ['moves by the delta', range(100, 200), 50, range(150, 250)],
    ['stops at the start of the video', range(100, 200), -500, range(0, 100)],
    ['stops at the end of the video', range(100, 200), 5000, range(900, 1000)],
  ])('%s', (_name, input, delta, expected) => {
    expect(panRange(input, delta, DURATION, MIN_SPAN)).toEqual(expected);
  });
});

describe('resizeRangeEdge', () => {
  it.each([
    ['moves the start edge', range(100, 200), 'start', 150, range(150, 200)],
    ['moves the end edge', range(100, 200), 'end', 300, range(100, 300)],
    [
      'keeps the minimum span when the start edge crosses the end',
      range(100, 200),
      'start',
      250,
      range(198, 200),
    ],
    [
      'keeps the minimum span when the end edge crosses the start',
      range(100, 200),
      'end',
      50,
      range(100, 102),
    ],
    ['clamps the start edge to the video start', range(100, 200), 'start', -30, range(0, 200)],
    ['clamps the end edge to the video end', range(100, 200), 'end', 1200, range(100, 1000)],
  ] as const)('%s', (_name, input, edge, time, expected) => {
    expect(resizeRangeEdge(input, edge, time, DURATION, MIN_SPAN)).toEqual(expected);
  });
});

describe('zoomRangeAround', () => {
  it.each([
    [
      'zooms in around the anchor, keeping it at the same fraction',
      range(100, 200),
      125,
      0.5,
      range(112.5, 162.5),
    ],
    ['zooms out around the anchor', range(100, 200), 150, 2, range(50, 250)],
    ['stops zooming in at the minimum span', range(100, 200), 150, 0.001, range(149, 151)],
    ['stops zooming out at the whole video', range(100, 200), 150, 100, range(0, 1000)],
    [
      'shifts back inside the video when zooming out near an edge',
      range(0, 100),
      10,
      4,
      range(0, 400),
    ],
  ])('%s', (_name, input, anchor, factor, expected) => {
    expect(zoomRangeAround(input, anchor, factor, DURATION, MIN_SPAN)).toEqual(expected);
  });
});

describe('followPlayhead', () => {
  it.each([
    [
      'leaves the range alone while the playhead is inside it',
      range(100, 200),
      150,
      range(100, 200),
    ],
    ['pages forward when the playhead passes the end', range(100, 200), 201, range(191, 291)],
    ['pages back when the playhead is before the start', range(100, 200), 40, range(30, 130)],
    ['stays inside the video when paging near its end', range(800, 900), 995, range(900, 1000)],
  ])('%s', (_name, input, playhead, expected) => {
    expect(followPlayhead(input, playhead, DURATION, MIN_SPAN)).toEqual(expected);
  });
});

describe('timeToFraction and fractionToTime', () => {
  it('map between time and position in the range, inverting each other', () => {
    const w = range(100, 300);
    expect(timeToFraction(w, 150)).toBe(0.25);
    expect(fractionToTime(w, 0.25)).toBe(150);
    expect(timeToFraction(w, 50)).toBe(-0.25); // outside the range: not clamped
  });
});

describe('rangeFittingSpan', () => {
  it.each([
    // A 2s pair with the playhead inside: margin of the pair's length each side.
    ['fits a pair with its minimum margin', 100, 102, 2, 0, range(98, 104)],
    ['widens to the minimum span around the middle', 100, 102, 2, 10, range(96, 106)],
    // A pair at 100-102 and a playhead at 300: the spread's own margin (10% of 202s) wins.
    ['keeps a far-apart pair and playhead off the edges', 100, 302, 2, 10, range(79.8, 322.2)],
    ['shifts away from the start of the video', 0, 2, 2, 10, range(0, 10)],
    ['shifts away from the end of the video', 998, 1000, 2, 10, range(990, 1000)],
  ])('%s', (_name, from, to, minMargin, minSpan, expected) => {
    const fitted = rangeFittingSpan(from, to, minMargin, minSpan, DURATION);
    expect(fitted.start).toBeCloseTo(expected.start);
    expect(fitted.end).toBeCloseTo(expected.end);
  });
});

describe('formatTimelineTime', () => {
  it.each([
    // Seconds per pixel for a 1200px bar: 5s -> 0.004, 120s -> 0.1, 600s -> 0.5.
    // Truncated like the time readout's milliseconds, never rounded up.
    ['shows milliseconds when zoomed in to the frame', 12.4567, 0.0005, '0:12.456'],
    ['reads 1.001 s as .001 despite float error', 1.001, 0.0005, '0:01.001'],
    ['shows hundredths when zoomed into a few seconds', 154.756, 0.004, '2:34.75'],
    ['shows tenths at a couple of minutes', 154.756, 0.1, '2:34.7'],
    ['shows whole seconds when zoomed out', 154.756, 0.5, '2:34'],
    ['keeps tenths hours into a long video', 3725.4, 0.1, '1:02:05.4'],
    ['pads seconds below ten', 61, 0.5, '1:01'],
    ['does not carry into the minutes', 59.96, 0.1, '0:59.9'],
    ['falls back to full precision without a resolution', 1.234, 0, '0:01.234'],
  ])('%s', (_name, seconds, secondsPerPixel, expected) => {
    expect(formatTimelineTime(seconds, secondsPerPixel)).toBe(expected);
  });
});

describe('easeRangeToward', () => {
  it.each([
    [
      'moves each edge part of the way to the target',
      range(0, 100),
      range(100, 300),
      0.5,
      range(50, 200),
    ],
    [
      'snaps when already within a hair of the target',
      range(100, 200.00001),
      range(100, 200),
      0.5,
      range(100, 200),
    ],
    ['jumps straight there with a factor of 1', range(0, 100), range(100, 300), 1, range(100, 300)],
  ])('%s', (_name, shown, target, factor, expected) => {
    expect(easeRangeToward(shown, target, factor)).toEqual(expected);
  });
});

describe('visibleLabelIndices', () => {
  const MIN_GAP = 10;
  it.each([
    ['shows labels that are far enough apart', [0, 20, 40], [], [0, 1, 2]],
    ['hides a label that would overlap the one before it', [0, 5, 20], [], [0, 2]],
    ['measures each gap against the last shown label', [0, 6, 12], [], [0, 2]],
    ['always shows a priority label, hiding its neighbours instead', [0, 5, 20], [1], [1, 2]],
    ['shows several priority labels even if they overlap', [0, 5], [0, 1], [0, 1]],
    ['handles labels given out of order', [40, 0, 20], [], [0, 1, 2]],
    ['handles no labels', [], [], []],
  ])('%s', (_name, xs, priority, expected) => {
    const labels = xs.map((x, i) => ({ x, priority: priority.includes(i) }));
    expect(visibleLabelIndices(labels, MIN_GAP)).toEqual(expected);
  });
});

describe('resizeRangeEdge on a video shorter than the minimum span', () => {
  it.each([
    ['start', -5, range(0, 1.5)],
    ['start', 1, range(0, 1.5)],
    ['end', 0.2, range(0, 1.5)],
  ] as const)('pins the %s edge inside the video', (edge, time, expected) => {
    expect(resizeRangeEdge(range(0, 1.5), edge, time, 1.5, MIN_SPAN)).toEqual(expected);
  });
});

describe('wheelNotches', () => {
  it.each([
    ['a mouse notch in pixels', 100, 0, 1],
    ['a mouse notch the other way', -100, 0, -1],
    ['a small trackpad delta', 4, 0, 0.04],
    ['a large delta is capped at one notch', 400, 0, 1],
    ['three lines (Firefox) is about one notch', 3, 1, 0.99],
  ])('%s', (_name, delta, deltaMode, expected) => {
    expect(wheelNotches(delta, deltaMode)).toBeCloseTo(expected, 6);
  });
});
