// A marker pair's settings: its overrides, else the global settings, else the defaults. The clipper
// resolves them the same way (`mps = {**settings, **overrides}`).
import { MarkerPair, MarkerPairOverrides, Settings } from '../../@types/yt_clipper';
import { DEFAULT_CINEMATIC_HOLDS } from '../../crop/cinematic-path';
import { DEFAULT_CROP_POINT_EASING } from '../../crop/crop-keyframe-math';

type PairSettingKey = keyof MarkerPairOverrides & keyof Settings;

// The defaults the markup shows for a setting no pair and no global setting gives. Settings left out
// stay undefined, and their readers (or the clipper) decide.
const PAIR_SETTING_DEFAULTS = {
  cropPointEasing: DEFAULT_CROP_POINT_EASING,
  cropPointEasingCinematicHolds: DEFAULT_CINEMATIC_HOLDS,
  gamma: 1,
  fadeDuration: 0.5,
  minterpFpsMultiplier: 0,
} satisfies { [K in PairSettingKey]?: NonNullable<Settings[K]> };

type Defaulted = keyof typeof PAIR_SETTING_DEFAULTS;
export type PairSettings = Settings & { [K in Defaulted]: NonNullable<Settings[K]> };

// Later layers win, but an undefined or null value (an override that was cleared) leaves the earlier
// one, as `??` does.
function layered<T extends object>(...layers: (Partial<T> | undefined)[]): T {
  // No prototype, so a "__proto__" key from a loaded file is an ordinary key, even if the load
  // boundary someday lets one through.
  const merged: Partial<T> = Object.create(null);
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value != null) merged[key as keyof T] = value as T[keyof T];
    }
  }
  return merged as T;
}

export function pairSettings(
  pair: Pick<MarkerPair, 'overrides'> | undefined,
  settings: Settings
): PairSettings {
  return layered<PairSettings>(
    PAIR_SETTING_DEFAULTS,
    settings,
    pair?.overrides as Partial<PairSettings> | undefined
  );
}
