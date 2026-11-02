import type { FrameTimingRelease } from './decisions/keys';

/**
 * For tests: runs a test file with every frame decision group on one release, whatever the flags'
 * defaults are. Call it once at the top of the file, before anything that imports
 * `frame-timing.ts`, which reads the flags when it loads.
 */
export function useFrameTiming(release: FrameTimingRelease): void {
  jest.doMock('../feature-flags', () => {
    const actual = jest.requireActual<typeof import('../feature-flags')>('../feature-flags');
    return {
      ...actual,
      featureFlags: { ...actual.featureFlags, ...frameTimingFlags(release) },
    };
  });
}

/** Every frame decision group's flag set to `release`. */
export function frameTimingFlags(release: FrameTimingRelease) {
  return {
    placementTiming: release,
    seekTiming: release,
    loopTiming: release,
    stepsTiming: release,
    compareTiming: release,
    frameRateTiming: release,
    cropEaseTiming: release,
    cinematicTiming: release,
  };
}
