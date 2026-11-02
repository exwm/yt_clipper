import type { FeatureFlags } from '../feature-flags';
import { frameTimingFlags } from './decisions/keys';

type Loaded = {
  frameTiming: typeof import('./frame-timing');
  frameTiming548: typeof import('./frame-timing-548').frameTiming548;
  frameTiming549: typeof import('./frame-timing-549').frameTiming549;
  featureFlags: FeatureFlags;
};

/** frame-timing.ts as it loads with the flags' defaults and `overrides`, in a fresh module registry. */
function loadWithFlags(overrides: Partial<FeatureFlags>): Loaded {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    jest.doMock('../feature-flags', () => {
      const actual = jest.requireActual<typeof import('../feature-flags')>('../feature-flags');
      return { ...actual, featureFlags: { ...actual.featureFlags, ...overrides } };
    });
    loaded = {
      frameTiming: require('./frame-timing'),
      frameTiming548: require('./frame-timing-548').frameTiming548,
      frameTiming549: require('./frame-timing-549').frameTiming549,
      featureFlags: require('../feature-flags').featureFlags,
    };
  });
  return loaded!;
}

/** The decisions of `timing` that are not the same function as `whole`'s. */
function differing(timing: object, whole: object): string[] {
  const names = new Set([...Object.keys(timing), ...Object.keys(whole)]);
  return [...names].filter(
    (name) => timing[name as keyof typeof timing] !== whole[name as keyof typeof whole]
  );
}

const flagNames = Object.keys(frameTimingFlags('next')) as (keyof FeatureFlags)[];

describe('the frame timing flags', () => {
  it("default to 'next' for every group and frameTiming549 off, which is 5.48's decisions, as the 5.49.0 default build (legacyFrameTiming on) had them", () => {
    const { frameTiming, frameTiming548, featureFlags } = loadWithFlags({});
    expect(flagNames.map((name) => [name, featureFlags[name]])).toEqual(
      flagNames.map((name) => [name, 'next'])
    );
    expect(featureFlags.frameTiming549).toBe(false);
    expect(differing(frameTiming.frameTiming, frameTiming548)).toEqual([]);
  });

  it.each([
    ['every group on 5.48', frameTimingFlags('5.48'), '5.48'],
    ['every group on next', frameTimingFlags('next'), '5.48'],
    ['frameTiming549 on', { frameTiming549: true }, '5.49'],
    [
      'frameTiming549 on, every group on 5.48',
      { ...frameTimingFlags('5.48'), frameTiming549: true },
      '5.49',
    ],
  ] as const)('%s makes the decisions of %s', (_case, flags, decisionsOf) => {
    const loaded = loadWithFlags(flags);
    const whole = decisionsOf === '5.48' ? loaded.frameTiming548 : loaded.frameTiming549;
    expect(differing(loaded.frameTiming.frameTiming, whole)).toEqual([]);
  });

  // Stated here, not read from the code: a flag wired to another group's name must fail this.
  const FLAG_GROUPS = {
    placementTiming: 'placement',
    seekTiming: 'seek',
    loopTiming: 'loop',
    stepsTiming: 'steps',
    compareTiming: 'compare',
    rateTiming: 'rate',
    cropEaseTiming: 'cropEase',
    cinematicTiming: 'cinematic',
  } as const;

  it('cover every group, one flag each', () => {
    expect(Object.keys(FLAG_GROUPS).sort()).toEqual([...flagNames].sort());
    expect(new Set(Object.values(FLAG_GROUPS)).size).toBe(flagNames.length);
  });

  it.each(Object.entries(FLAG_GROUPS))('%s on next moves only the %s group', (flag, group) => {
    const { choiceFromFlags } = loadWithFlags({}).frameTiming;
    const choice = choiceFromFlags({
      ...loadWithFlags({}).featureFlags,
      ...frameTimingFlags('5.48'),
      [flag]: 'next',
    });
    const groups = 'groups' in choice ? choice.groups : {};
    expect(Object.entries(groups).filter(([, release]) => release !== '5.48')).toEqual([
      [group, 'next'],
    ]);
  });
});
