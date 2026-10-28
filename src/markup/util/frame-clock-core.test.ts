import {
  announceRate,
  ClockFrame,
  ClockState,
  FRAMES_TO_CONFIRM_EXACT,
  FRAMES_TO_CONFIRM_ROUNDED,
  initialClock,
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
        dropChance: pick([0, 0.002]),
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
    if (random() < s.dropChance) dropped++;
    time += playbackRate / rateAt(k);
    presented++;
    if (random() < s.missChance || burstMisses.has(k)) continue;
    const frame: ClockFrame = {
      // YouTube rounds mediaTime to the millisecond.
      mediaTime: Math.round(time * 1000) / 1000,
      duringSeek,
      droppedFrames: dropped,
      presentedFrames: s.countsFrames ? presented : undefined,
      // Every frame is decoded, including those presented while a callback was missed.
      decodedFrames: presented,
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
