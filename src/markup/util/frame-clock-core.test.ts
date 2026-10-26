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
      };
    })
  );
}

// Plays the scenario through the clock, asking for the rate as YouTube's caller does, and returns
// every rate the clock reported and its state at the end.
function play(s: Scenario): { reported: (number | null)[]; clock: ClockState } {
  const random = mulberry32(s.seed * 7919 + 1);
  let clock = initialClock;
  let time = 5 + random() * 20;
  let presented = 0;
  let dropped = 0;
  const reported: (number | null)[] = [];
  const burstMisses = new Set<number>();
  for (let k = 0; k < FRAMES; k++) {
    if (random() < s.burstChance) s.burst.forEach((offset) => burstMisses.add(k + offset));
    let duringSeek = false;
    if (random() < s.seekChance) {
      clock = stepClock(clock, { type: 'seeking' });
      time += 1 + random() * 5;
      duringSeek = true;
    }
    if (random() < s.dropChance) dropped++;
    time += 1 / s.fps;
    presented++;
    if (random() < s.missChance || burstMisses.has(k)) continue;
    const frame: ClockFrame = {
      // YouTube rounds mediaTime to the millisecond.
      mediaTime: Math.round(time * 1000) / 1000,
      duringSeek,
      droppedFrames: dropped,
      presentedFrames: s.countsFrames ? presented : undefined,
      paused: false,
      playbackRate: 1,
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
    const clean = SCENARIOS.filter(
      (s) => s.missChance === 0 && s.burstChance === 0 && s.dropChance === 0 && s.seekChance === 0
    );
    expect(clean.length).toBeGreaterThan(10);
    const unmeasured = clean.flatMap((s) => {
      const final = publishRate(play(s).clock, FRAMES_TO_TELL_NTSC_RATES).rate;
      return final === s.fps ? [] : [{ ...s, final }];
    });
    expect(unmeasured).toEqual([]);
  });
});
