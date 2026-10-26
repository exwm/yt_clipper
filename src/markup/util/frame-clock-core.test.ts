import {
  ClockFrame,
  ClockState,
  FRAMES_TO_TELL_NTSC_RATES,
  initialClock,
  publishRate,
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
      const pick = <T>(values: T[]) => (noisy ? values[Math.floor(random() * values.length)] : values[0]);
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
      paused: random() < s.pauseChance,
      playbackRate,
    };
    clock = stepClock(clock, { type: 'frame', frame });
    if (random() < s.askChance) {
      const published = publishRate(clock, FRAMES_TO_TELL_NTSC_RATES);
      clock = published.state;
      reported.push(published.rate);
    }
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
      const final = publishRate(play(s).clock, FRAMES_TO_TELL_NTSC_RATES).rate;
      return final === s.fps ? [] : [{ ...s, final }];
    });
    expect(unmeasured).toEqual([]);
  });

  // A rate change with no resize event, as on a site that splices sources. The new run replaces the
  // measured one once it can tell NTSC rates, not only once it is as long as the old one.
  it.each([
    [60, 30],
    [30, 60],
    [60000 / 1001, 30000 / 1001],
    [24, 60],
  ])('reports a change from %p to %p fps within 70 frames', (before, after) => {
    for (const countsFrames of [true, false]) {
      const { reported } = play(clean(before, countsFrames), 200 + 70, (k) => (k < 200 ? before : after));
      expect(new Set(reported.filter((rate) => rate != null))).toEqual(new Set([before, after]));
      expect(reported[reported.length - 1]).toBe(after);
    }
  });
});
