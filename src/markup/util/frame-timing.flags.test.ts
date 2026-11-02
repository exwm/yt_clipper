import type { FeatureFlags } from '../feature-flags';
import { FRAME_TIMING_RELEASES, FrameTimingRelease } from './decisions/keys';
import { frameTimingFlags } from './frame-timing-mode.fixtures';

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
  it("default to 'next' for every group, which is 5.48's decisions, as the 5.49.0 default build (legacyFrameTiming on) had them", () => {
    const { frameTiming, frameTiming548, featureFlags } = loadWithFlags({});
    expect(flagNames.map((name) => [name, featureFlags[name]])).toEqual(
      flagNames.map((name) => [name, 'next'])
    );
    expect(differing(frameTiming.frameTiming, frameTiming548)).toEqual([]);
  });

  it.each([
    ['5.48', '5.48'],
    ['next', '5.48'],
    ['5.49', '5.49'],
  ] as const)('every group on %s makes the decisions of %s', (release, decisionsOf) => {
    const loaded = loadWithFlags(frameTimingFlags(release));
    const whole = decisionsOf === '5.48' ? loaded.frameTiming548 : loaded.frameTiming549;
    expect(differing(loaded.frameTiming.frameTiming, whole)).toEqual([]);
  });

  it.each(flagNames.flatMap((flag) => FRAME_TIMING_RELEASES.map((release) => [flag, release])))(
    '%s set to %s picks only its own group',
    (flag, release) => {
      const loaded = loadWithFlags({ ...frameTimingFlags('5.48'), [flag]: release });
      const { frameTimingReleases, frameDecisionGroups, frameTiming } = loaded.frameTiming;
      const changed = Object.entries(frameTimingReleases).filter(([, r]) => r !== '5.48');
      expect(changed.length).toBe(release === '5.48' ? 0 : 1);
      const group = (changed[0]?.[0] ?? 'placement') as keyof typeof frameDecisionGroups;
      const decisions = frameDecisionGroups[group].release(release as FrameTimingRelease);
      for (const [name, decision] of Object.entries(decisions)) {
        expect(frameTiming[name as keyof typeof frameTiming]).toBe(decision);
      }
      const expectedDiffering = release === '5.49' ? Object.keys(decisions) : [];
      expect(differing(frameTiming, loaded.frameTiming548).sort()).toEqual(
        expectedDiffering.sort()
      );
    }
  );
});
