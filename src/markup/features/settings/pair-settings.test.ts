import { MarkerPairOverrides, Settings } from '../../@types/yt_clipper';
import { pairSettings } from './pair-settings';

const resolve = (overrides: MarkerPairOverrides, globals: Partial<Settings>) =>
  pairSettings({ overrides }, globals as Settings);

describe('pairSettings', () => {
  it('reads the pair override first', () => {
    expect(resolve({ gamma: 2 }, { gamma: 1.5 }).gamma).toBe(2);
  });

  it('keeps an override of 0, which still overrides', () => {
    expect(resolve({ fadeDuration: 0 }, { fadeDuration: 1 }).fadeDuration).toBe(0);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('skips a cleared override, saved as %s', (_name, cleared) => {
    expect(resolve({ gamma: cleared as unknown as number }, { gamma: 1.5 }).gamma).toBe(1.5);
  });

  it('falls back to the global setting, then the default', () => {
    expect(resolve({}, { gamma: 1.5 }).gamma).toBe(1.5);
    expect(resolve({}, {}).gamma).toBe(1);
  });

  it('leaves a setting without a default undefined', () => {
    expect(resolve({}, {}).cropPointEasingCinematicMargin).toBeUndefined();
  });

  it('keeps a __proto__ key from a loaded file an ordinary key, not the prototype', () => {
    // A setting with no default and no global value would read through a swapped prototype.
    const overrides = JSON.parse('{"__proto__": {"cropPointEasingCinematicMargin": 99}}');
    expect(resolve(overrides, {}).cropPointEasingCinematicMargin).toBeUndefined();
  });

  it('reads the global settings alone with no pair', () => {
    expect(pairSettings(undefined, { gamma: 1.5 } as Settings).gamma).toBe(1.5);
  });
});
