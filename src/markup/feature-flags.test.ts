type FeatureFlagsModule = typeof import('./feature-flags');

const STORAGE_KEY = 'yt_clipper_feature_flags';

// A fresh copy of the module as a build with or without GITHUB_ACTIONS loads it, over `stored`.
function loadFeatureFlags(ciBuild: boolean, stored: unknown = null) {
  const storage = new Map<string, string>();
  if (stored != null) storage.set(STORAGE_KEY, JSON.stringify(stored));
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  Object.assign(globalThis, { localStorage });
  const previous = process.env.GITHUB_ACTIONS;
  if (ciBuild) process.env.GITHUB_ACTIONS = 'true';
  else delete process.env.GITHUB_ACTIONS;
  let module!: FeatureFlagsModule;
  jest.isolateModules(() => {
    module = jest.requireActual('./feature-flags');
  });
  if (previous == null) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = previous;
  const storedNow = () => JSON.parse(storage.get(STORAGE_KEY) ?? 'null');
  return { ...module, storedNow };
}

describe('validFeatureFlagOverrides', () => {
  const { validFeatureFlagOverrides } = loadFeatureFlags(false);
  it.each([
    ['a known on/off flag', { reframeFrameStats: true }, { reframeFrameStats: true }],
    [
      'one of its options',
      { videoFrameLoopTiming: 'frameCallback' },
      { videoFrameLoopTiming: 'frameCallback' },
    ],
    ['an unknown flag', { notAFlag: true }, {}],
    ['a hidden flag', { featureFlagsPanel: false }, {}],
    ['a value of another kind', { reframeFrameStats: 'yes' }, {}],
    ['a value outside the options', { videoFrameLoopTiming: 'sometimes' }, {}],
    ['something other than an object', 'true', {}],
  ])('keeps %s', (_, stored, expected) => {
    expect(validFeatureFlagOverrides(stored)).toEqual(expected);
  });
});

describe('feature flags in a local build', () => {
  it('apply stored overrides when the script loads', () => {
    const { featureFlags, isFeatureFlagOverridden } = loadFeatureFlags(false, {
      videoFrameLoopTiming: 'frameCallback',
      notAFlag: 1,
    });
    expect(featureFlags.videoFrameLoopTiming).toBe('frameCallback');
    expect(isFeatureFlagOverridden('videoFrameLoopTiming')).toBe(true);
    expect(featureFlags.featureFlagsPanel).toBe(true);
  });

  it('keep a change, tell listeners, and forget a flag set back to its default', () => {
    const { featureFlags, setFeatureFlag, onFeatureFlagChange, storedNow } =
      loadFeatureFlags(false);
    const changed: string[] = [];
    onFeatureFlagChange((name) => changed.push(name));
    setFeatureFlag('reframeFrameStats', true);
    expect(featureFlags.reframeFrameStats).toBe(true);
    expect(storedNow()).toEqual({ reframeFrameStats: true });
    setFeatureFlag('reframeFrameStats', false);
    expect(storedNow()).toBeNull();
    expect(changed).toEqual(['reframeFrameStats', 'reframeFrameStats']);
  });

  it('reset every changed flag to its default', () => {
    const { featureFlags, resetFeatureFlags, onFeatureFlagChange, storedNow } = loadFeatureFlags(
      false,
      { reframeFrameStats: true, videoFrameLoopTiming: 'frameCallback' }
    );
    const changed: string[] = [];
    onFeatureFlagChange((name) => changed.push(name));
    resetFeatureFlags();
    expect([featureFlags.reframeFrameStats, featureFlags.videoFrameLoopTiming]).toEqual([
      false,
      'everyRefresh',
    ]);
    expect(changed.sort()).toEqual(['reframeFrameStats', 'videoFrameLoopTiming']);
    expect(storedNow()).toBeNull();
  });
});

describe('feature flags in a CI build', () => {
  it('ignore stored overrides, refuse changes, and hide the popup', () => {
    const { featureFlags, setFeatureFlag, storedNow } = loadFeatureFlags(true, {
      reframeFrameStats: true,
    });
    expect(featureFlags.reframeFrameStats).toBe(false);
    expect(featureFlags.featureFlagsPanel).toBe(false);
    setFeatureFlag('videoFrameLoopTiming', 'frameCallback');
    expect(featureFlags.videoFrameLoopTiming).toBe('everyRefresh');
    expect(storedNow()).toEqual({ reframeFrameStats: true });
  });
});
