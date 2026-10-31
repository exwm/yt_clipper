/**
 * For tests: runs a test file under one frame timing, whatever the `legacyFrameTiming` default is.
 * Call it once at the top of the file, before anything that imports `frame-timing.ts`, which reads
 * the flag when it loads. '5.48' is the flag on, '5.49' off.
 */
export function useFrameTiming(mode: '5.48' | '5.49'): void {
  jest.doMock('../feature-flags', () => {
    const actual = jest.requireActual<typeof import('../feature-flags')>('../feature-flags');
    return {
      ...actual,
      featureFlags: { ...actual.featureFlags, legacyFrameTiming: mode === '5.48' },
    };
  });
}
