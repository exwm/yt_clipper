import { readFileSync } from 'fs';
import { join } from 'path';
import {
  announceRate,
  ClockFrame,
  ClockState,
  FRAMES_TO_CONFIRM_EXACT,
  FRAMES_TO_CONFIRM_ROUNDED,
  initialClock,
  measuredRate,
  stepClock,
} from './frame-clock-core';

// A small seeded generator, so a failing scenario replays exactly from its seed.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
const FRAMES = 200;

interface Scenario {
  seed: number;
  fps: number;
  countsFrames: boolean;
  missChance: number;
  // A busy moment misses refreshes close together, such as two refreshes apart.
  burstChance: number;
  burst: number[];
  dropChance: number;
  seekChance: number;
  // A jump no seek event announces, such as a segment swap.
  gapChance: number;
  pauseChance: number;
  // Playback at 2x, which measures nothing.
  fastChance: number;
  // A quality switch, and a new source.
  resizeChance: number;
  emptiedChance: number;
  askChance: number;
}

// A grid over what decides the measurement (the rate, whether frames are counted, how refreshes
// are missed, how often the rate is asked for), with the start phase and other noise from the seed.
// Half the cells have no other noise, so a miss pattern's own effect shows.
function scenarios(seedsPerCell: number): Scenario[] {
  const cells = RATES.flatMap((fps) =>
    // The frame callback loop counts presented frames; the every-refresh loop does not.
    [true, false].flatMap((countsFrames) =>
      [[], [0], [0, 2], [0, 3], [0, 2, 4]].flatMap((burst) =>
        [1, 0.05].map((askChance) => ({ fps, countsFrames, burst, askChance }))
      )
    )
  );
  return cells.flatMap((cell, c) =>
    Array.from({ length: seedsPerCell }, (_, i) => {
      const seed = c * seedsPerCell + i + 1;
      const random = mulberry32(seed);
      const noisy = random() < 0.5;
      const pick = <T>(values: T[]) =>
        noisy ? values[Math.floor(random() * values.length)] : values[0];
      return {
        ...cell,
        seed,
        burstChance: cell.burst.length > 0 ? 0.01 : 0,
        missChance: pick([0, 0.002, 0.01]),
        dropChance: pick([0, 0.002, 0.02]),
        seekChance: pick([0, 0.003]),
        gapChance: pick([0, 0.01]),
        pauseChance: pick([0, 0.005]),
        fastChance: pick([0, 0.005]),
        resizeChance: pick([0, 0.003]),
        emptiedChance: pick([0, 0.002]),
      };
    })
  );
}

// Plays the scenario through the clock, asking for the rate as YouTube's caller does, and returns
// every rate the clock reported and its state at the end. `rateAt` gives the frame rate at frame k.
function play(
  s: Scenario,
  frames = FRAMES,
  rateAt: (k: number) => number = () => s.fps
): { reported: (number | null)[]; clock: ClockState } {
  const random = mulberry32(s.seed * 7919 + 1);
  let clock = initialClock;
  let time = 5 + random() * 20;
  let presented = 0;
  let decoded = 0;
  let dropped = 0;
  let fastFramesLeft = 0;
  const reported: (number | null)[] = [];
  const burstMisses = new Set<number>();
  for (let k = 0; k < frames; k++) {
    if (random() < s.burstChance) s.burst.forEach((offset) => burstMisses.add(k + offset));
    if (random() < s.resizeChance) clock = stepClock(clock, { type: 'resize' });
    if (random() < s.emptiedChance) clock = stepClock(clock, { type: 'emptied' });
    let duringSeek = false;
    if (random() < s.seekChance) {
      clock = stepClock(clock, { type: 'seeking' });
      time += 1 + random() * 5;
      duringSeek = true;
    }
    if (random() < s.gapChance) time += 0.2 + random() * 0.5;
    if (random() < s.fastChance) fastFramesLeft = 20;
    const playbackRate = fastFramesLeft-- > 0 ? 2 : 1;
    // A dropped frame is decoded but never presented: the next one comes a frame later.
    if (random() < s.dropChance) {
      dropped++;
      decoded++;
      time += playbackRate / rateAt(k);
    }
    time += playbackRate / rateAt(k);
    presented++;
    decoded++;
    if (random() < s.missChance || burstMisses.has(k)) continue;
    const frame: ClockFrame = {
      // YouTube rounds mediaTime to the millisecond.
      mediaTime: Math.round(time * 1000) / 1000,
      duringSeek,
      droppedFrames: dropped,
      presentedFrames: s.countsFrames ? presented : undefined,
      // Every frame is decoded, including those dropped or presented while a callback was missed.
      decodedFrames: decoded,
      paused: random() < s.pauseChance,
      playbackRate,
    };
    clock = stepClock(clock, { type: 'frame', frame });
    if (random() < s.askChance) reported.push(clock.publishedRate);
  }
  return { reported, clock };
}

const clean = (fps: number, countsFrames: boolean): Scenario => ({
  seed: 1,
  fps,
  countsFrames,
  missChance: 0,
  burstChance: 0,
  burst: [],
  dropChance: 0,
  seekChance: 0,
  gapChance: 0,
  pauseChance: 0,
  fastChance: 0,
  resizeChance: 0,
  emptiedChance: 0,
  askChance: 1,
});

const SCENARIOS = scenarios(4);

describe('the frame clock over seeded playback', () => {
  it('never reports a rate other than the video’s own', () => {
    const wrong = SCENARIOS.flatMap((s) => {
      const bad = play(s).reported.filter((rate) => rate != null && rate !== s.fps);
      return bad.length > 0 ? [{ ...s, reported: [...new Set(bad)] }] : [];
    });
    expect(wrong).toEqual([]);
  });

  it('reports the rate once a clean playback is asked for it', () => {
    const quiet = SCENARIOS.filter((s) => {
      const { seed, fps, countsFrames, askChance, burst, ...chances } = s;
      return Object.values(chances).every((chance) => chance === 0);
    });
    expect(quiet.length).toBeGreaterThan(10);
    const unmeasured = quiet.flatMap((s) => {
      const final = play(s).clock.publishedRate;
      return final === s.fps ? [] : [{ ...s, final }];
    });
    expect(unmeasured).toEqual([]);
  });

  // A screen slower than the video shows every other frame, and the skipped ones count as neither
  // presented nor dropped: each gap is 2 frames long, which would read as half the rate.
  it.each([true, false])(
    'reports nothing when every other frame is decoded but never shown (frames counted: %p)',
    (countsFrames) => {
      let clock = initialClock;
      for (let k = 0; k < 240; k++) {
        const frame: ClockFrame = {
          mediaTime: Math.round((10 + (2 * k) / 60) * 1000) / 1000,
          duringSeek: false,
          droppedFrames: 0,
          presentedFrames: countsFrames ? k : undefined,
          decodedFrames: 2 * k,
          paused: false,
          playbackRate: 1,
        };
        clock = stepClock(clock, { type: 'frame', frame });
      }
      expect(clock.publishedRate).toBeNull();
    }
  );

  it('reports the rate when the only noise is skipped frame callbacks it counts', () => {
    const missesOnly = SCENARIOS.filter((s) => {
      const { seed, fps, countsFrames, askChance, burst, missChance, burstChance, ...others } = s;
      return (
        countsFrames &&
        (missChance > 0 || burstChance > 0) &&
        Object.values(others).every((c) => c === 0)
      );
    });
    expect(missesOnly.length).toBeGreaterThan(10);
    const unmeasured = missesOnly.flatMap((s) => {
      const final = play(s).clock.publishedRate;
      return final === s.fps ? [] : [{ ...s, final }];
    });
    expect(unmeasured).toEqual([]);
  });

  // A machine that drops a frame every 50: 60 frames of millisecond times never play in a row.
  it.each(
    RATES.flatMap((fps) => [true, false].map((countsFrames) => [fps, countsFrames] as const))
  )(
    'measures %p fps from millisecond times with a frame dropped every 50 (frames counted: %p)',
    (fps, countsFrames) => {
      let clock = initialClock;
      for (let k = 0; k < 600; k++) {
        const dropped = Math.floor((k + 25) / 50);
        const videoFrame = 300 + k + dropped;
        const frame: ClockFrame = {
          mediaTime: Math.round((videoFrame / fps) * 1000) / 1000,
          duringSeek: false,
          droppedFrames: dropped,
          presentedFrames: countsFrames ? k : undefined,
          decodedFrames: k + dropped,
          paused: false,
          playbackRate: 1,
        };
        clock = stepClock(clock, { type: 'frame', frame });
      }
      expect(clock.publishedRate).toBe(fps);
    }
  );
  // The worst case a browser could report: every other frame dropped, each drop counted a callback
  // late, and the decoded count leaving dropped frames out, so it can't tell a gap of 2 frames.
  it.each([true, false])(
    'publishes nothing when every other frame drops, counted late and left out of the decoded count (frames counted: %p)',
    (countsFrames) => {
      let clock = initialClock;
      for (let k = 0; k < 600; k++) {
        const frame: ClockFrame = {
          mediaTime: Math.round(((300 + 2 * k) / 60) * 1000) / 1000,
          duringSeek: false,
          droppedFrames: Math.max(0, k - 1),
          presentedFrames: countsFrames ? k : undefined,
          decodedFrames: k,
          paused: false,
          playbackRate: 1,
        };
        clock = stepClock(clock, { type: 'frame', frame });
      }
      expect(clock.publishedRate).toBeNull();
    }
  );
  // With millisecond times 8 frames can't tell NTSC rates from their neighbors: no rate is published
  // until a run of 60 confirms one.
  it('publishes no rate when seeks break every run before 60 frames of millisecond times', () => {
    let clock = initialClock;
    for (let k = 0; k < 400; k++) {
      if (k % 40 === 0) clock = stepClock(clock, { type: 'seeking' });
      clock = stepClock(clock, {
        type: 'frame',
        frame: { ...frameAt(k, 10 + k / 30, true), duringSeek: k % 40 === 0 },
      });
    }
    expect(clock.publishedRate).toBeNull();
  });

  // Exact, steady frame times tell NTSC rates apart in a few frames. 25 and 50 fps have frames of
  // whole milliseconds, which read as rounded times: they wait for 60 frames.
  it.each(RATES)('confirms %p fps from exact frame times', (fps) => {
    const needed = fps === 25 || fps === 50 ? FRAMES_TO_CONFIRM_ROUNDED : FRAMES_TO_CONFIRM_EXACT;
    let clock = initialClock;
    for (let k = 0; k <= needed; k++) {
      if (k === needed) expect(clock.publishedRate).toBeNull();
      clock = stepClock(clock, { type: 'frame', frame: frameAt(k, 10 + k / fps) });
    }
    expect(clock.publishedRate).toBe(fps);
  });

  // A rate change with no resize event, as on a site that splices sources. The new run replaces the
  // measured one once it can tell NTSC rates, not only once it is as long as the old one.
  it.each([
    [60, 30],
    [30, 60],
    [60000 / 1001, 30000 / 1001],
    [24, 60],
    // Rates under 1.5x apart, whose frames once joined one run.
    [30, 25],
    [25, 30],
    [24, 30],
    [50, 60],
  ])('reports a change from %p to %p fps within 70 frames', (before, after) => {
    for (const countsFrames of [true, false]) {
      const { reported } = play(clean(before, countsFrames), 200 + 70, (k) =>
        k < 200 ? before : after
      );
      expect(new Set(reported.filter((rate) => rate != null))).toEqual(new Set([before, after]));
      expect(reported[reported.length - 1]).toBe(after);
    }
  });
});

// Frames played in a row at `fps`, from `start`, with `jitter(k)` seconds added to frame k's time.
function frameAt(k: number, time: number, roundToMs = false): ClockFrame {
  return {
    mediaTime: roundToMs ? Math.round(time * 1000) / 1000 : time,
    duringSeek: false,
    droppedFrames: 0,
    presentedFrames: k,
    decodedFrames: k,
    paused: false,
    playbackRate: 1,
  };
}

// A phone's 30 fps video: exact times, each frame up to `jitter` early or late. Within the run rule's
// bound (about 0.5 ms a frame) it is measured, though its jitter can't tell 30 from 29.97, and the rate never flips between
// them; well beyond it (2 ms) nothing is measured and the default stays.
it.each([
  [0.0005, 1],
  [0.0005, 2],
  [0.0005, 3],
  [0.0005, 4],
])('measures video captured with %p s of jitter (seed %p)', (jitter, seed) => {
  const rates = jitteringRates(jitter, seed);
  expect(rates.size).toBe(1);
  expect([30, 30000 / 1001]).toContain([...rates][0]);
});

it('measures nothing from video captured with 2 ms of jitter', () => {
  expect(jitteringRates(0.002, 7).size).toBe(0);
});

function jitteringRates(jitter: number, seed: number): Set<number> {
  const random = mulberry32(seed);
  let clock = initialClock;
  const rates = new Set<number>();
  for (let k = 0; k < 600; k++) {
    const time = 10 + k / 30 + (random() - 0.5) * 2 * jitter;
    clock = stepClock(clock, { type: 'frame', frame: frameAt(k, time) });
    if (clock.publishedRate != null) rates.add(clock.publishedRate);
  }
  return rates;
}

describe('announceRate', () => {
  const confirmed30 = () => {
    let clock = initialClock;
    for (let k = 0; k <= FRAMES_TO_CONFIRM_ROUNDED; k++) {
      clock = stepClock(clock, { type: 'frame', frame: frameAt(k, 10 + k / 30, true) });
    }
    return clock;
  };

  it('announces a rate the first time it is in use for a source, and not again', () => {
    const first = announceRate(confirmed30(), 30);
    expect(first.isNew).toBe(true);
    expect(announceRate(first.state, 30).isNew).toBe(false);
  });

  it('announces each new rate once, as on a video spliced from two rates', () => {
    const at30 = announceRate(confirmed30(), 30).state;
    const at25 = announceRate(at30, 25);
    expect(at25.isNew).toBe(true);
    expect(announceRate(at25.state, 30).isNew).toBe(false);
  });

  it('announces the rate again for a new source', () => {
    const announced = announceRate(confirmed30(), 30).state;
    expect(announceRate(stepClock(announced, { type: 'emptied' }), 30).isNew).toBe(true);
  });
});

// Frames recorded in Chrome and Firefox playing synthetic clips (testsrc2, 7 s), clean and with a
// busy main thread: [mediaTime, presentedFrames, totalVideoFrames, droppedVideoFrames] per frame
// callback. Chrome reported a burst of drops a callback late; Firefox raised its dropped count by 30
// with every frame still presented. A 61 fps clip on a 59.95 Hz display drops a frame about every 43
// (the renderer drops one each time the video gains a refresh).
const TRACES: Record<string, { fps: number; frames: [number, number, number, number][] }> =
  JSON.parse(readFileSync(join(__dirname, 'frame-clock-traces.json'), 'utf8'));

// Plays a trace through the clock, calling `onFrame` with the clock after each frame.
function replay(
  trace: { frames: [number, number, number, number][] },
  onFrame?: (clock: ClockState) => void
): ClockState {
  let clock = initialClock;
  for (const [mediaTime, presentedFrames, decodedFrames, droppedFrames] of trace.frames) {
    clock = stepClock(clock, {
      type: 'frame',
      frame: {
        mediaTime,
        presentedFrames,
        decodedFrames,
        droppedFrames,
        duringSeek: false,
        paused: false,
        playbackRate: 1,
      },
    });
    onFrame?.(clock);
  }
  return clock;
}
describe('the frame clock over recorded browser frames', () => {
  it.each(Object.entries(TRACES))('reports %s at its own rate or not at all', (_name, trace) => {
    const reported = new Set<number>();
    const clock = replay(trace, ({ publishedRate }) => {
      if (publishedRate != null) reported.add(publishedRate);
    });
    expect([...reported].filter((rate) => rate !== trace.fps)).toEqual([]);
    if (process.env.TRACE_REPORT) console.log(_name, clock.publishedRate);
  });

  // Firefox calls back about 25 times a second: at 60 fps each gap spans 2 or 3 frames, all counted as
  // presented, so a run starts on a gap of several frames.
  it('measures 60 fps from Firefox, which calls back on every second or third frame', () => {
    expect(replay(TRACES['firefox h264-2160p60-mp4 busy0']).publishedRate).toBe(60);
  });
  // A 61 fps video on a 59.95 Hz display: Chrome drops a frame about every 43, so 60 frames never
  // play in a row. Counting the dropped frames' gaps keeps the run going.
  it('measures the rate when a frame drops more often than every 60', () => {
    expect(replay(TRACES['chromium vp9-61-webm cadence']).publishedRate).toBe(61);
  });
});

describe('the rate read from the frames held at seeks', () => {
  // A seek that reads its held frame at `held` s, `us` µs long, with the playhead at `currentTime`.
  type Read = readonly [held: number, us: number | null, currentTime?: number];
  const r = (...read: Read): Read => read;
  const readAt = (clock: ClockState, [held, us, currentTime = held + 0.01]: Read) =>
    stepClock(stepClock(clock, { type: 'seeking' }), {
      type: 'seeked',
      heldFrameTime: held,
      heldFrameDuration: us == null ? null : us / 1e6,
      currentTime,
      seeking: false,
    });
  const readsOf = (reads: readonly Read[], clock = initialClock) => reads.reduce(readAt, clock);

  it.each<[string, Read[], number | null]>([
    ['30 fps, exact', [r(3, 33333), r(4, 33333)], 30],
    ['29.97 fps, exact', [r(3, 33367), r(4, 33367)], 30000 / 1001],
    ['29.97 fps, as YouTube truncates it', [r(3, 33366), r(4, 33366)], 30000 / 1001],
    ['23.976 fps, as YouTube reads it', [r(3, 41708), r(4, 41708)], 24000 / 1001],
    ['24 fps, rounded either way', [r(3, 41667), r(4, 41666)], 24],
    ['25 fps, whole milliseconds', [r(3, 40000), r(4, 40000)], 25],
    ['60 fps', [r(3, 16667), r(4, 16667)], 60],
    ['one read', [r(3, 33333)], null],
    ['two reads of the same frame', [r(3, 33333), r(3, 33333, 3.02)], null],
    // webm, and some YouTube videos, time frames to the millisecond.
    ['millisecond durations of 24 fps', [r(3, 42000), r(4, 42000)], null],
    ['millisecond durations of 30 fps', [r(3, 33000), r(4, 34000)], null],
    ['a duration of no standard rate', [r(3, 35000), r(4, 35000)], null],
    ['a read with no duration', [r(3, 33333), r(4, null)], null],
    // YouTube can hold the frame from before a seek outside its buffer.
    ['a stale read of a frame from before the seek', [r(3, 33333), r(5, 33333, 10)], null],
    ['reads that disagree, then agree', [r(3, 33333), r(4, 41667), r(5, 41667), r(6, 41667)], null],
  ])('reads %s', (_case, reads, expected) => {
    expect(measuredRate(readsOf(reads))).toBe(expected);
  });

  it('reads nothing when another seek already started', () => {
    const clock = stepClock(stepClock(readsOf([r(3, 33333)]), { type: 'seeking' }), {
      type: 'seeked',
      heldFrameTime: 4,
      heldFrameDuration: 1 / 30,
      currentTime: 4.01,
      seeking: true,
    });
    expect(measuredRate(clock)).toBeNull();
  });

  it('prefers a played run to the read', () => {
    let clock = readsOf([r(3, 33333), r(4, 33333)]);
    for (let k = 0; k <= FRAMES_TO_CONFIRM_EXACT; k++) {
      clock = stepClock(clock, { type: 'frame', frame: frameAt(k, 10 + k / 24) });
    }
    expect(measuredRate(clock)).toBe(24);
  });

  it('keeps the read rate through a new rendition, which clears a pending read', () => {
    const resized = stepClock(readsOf([r(3, 33333), r(4, 33333)]), { type: 'resize' });
    expect(measuredRate(resized)).toBe(30);
    const pending = stepClock(readsOf([r(3, 41667)]), { type: 'resize' });
    expect(measuredRate(readsOf([r(4, 41667)], pending))).toBeNull();
  });

  it('reads the rate again for a new source, after reads that disagreed', () => {
    const mixed = readsOf([r(3, 33333), r(4, 41667)]);
    const emptied = stepClock(mixed, { type: 'emptied' });
    expect(measuredRate(readsOf([r(3, 41667), r(4, 41667)], emptied))).toBe(24);
  });
});

describe('the frame on screen after a seek', () => {
  const seekedAt = (currentTime: number, heldFrameTime: number | null, seeking = false) =>
    stepClock(stepClock(initialClock, { type: 'seeking' }), {
      type: 'seeked',
      heldFrameTime,
      heldFrameDuration: null,
      currentTime,
      seeking,
    });
  it.each([
    ['the frame read where it can be the frame there', 6.05, 6.033333, 6.033333],
    // Firefox reads every frame as about 0 (5 µs).
    ["Firefox's read near the start", 0.3, 0.000005, null],
    ['a read of frame 0 at the start', 0.0005, 0, 0],
    ['a frame after the playhead', 6.05, 6.1, null],
    ['a frame far before the playhead', 6.05, 1, null],
    ['no read', 6.05, null, null],
  ] as const)('keeps %s', (_case, currentTime, held, expected) => {
    expect(seekedAt(currentTime, held).onScreen?.mediaTime ?? null).toBe(expected);
  });

  it('reads nothing when another seek already started', () => {
    expect(seekedAt(6.05, 6.033333, true).onScreen).toBeNull();
  });
});
