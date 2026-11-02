import { frameTimingFlags, GroupRelease } from './decisions/keys';

/**
 * For tests: runs a test file on one frame timing, whatever the flags' defaults are: 5.49's whole
 * build, or every frame decision group on one release. Call it once at the top of the file, before
 * anything that imports `frame-timing.ts`, which reads the flags when it loads.
 */
export function useFrameTiming(release: GroupRelease | '5.49'): void {
  jest.doMock('../feature-flags', () => {
    const actual = jest.requireActual<typeof import('../feature-flags')>('../feature-flags');
    const flags =
      release === '5.49'
        ? { frameTiming549: true }
        : { frameTiming549: false, ...frameTimingFlags(release) };
    return { ...actual, featureFlags: { ...actual.featureFlags, ...flags } };
  });
}
