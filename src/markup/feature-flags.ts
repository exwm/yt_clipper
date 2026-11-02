/**
 * Runtime feature flags for the markup userscript.
 *
 * Flip a flag to enable / disable a feature without removing its code
 * from the bundle. Each flag is read at runtime by its consumer (a
 * shortcut's `guard` callback, a conditional call site, etc.), so
 * toggling means a one-line source edit and a rebundle: the script's
 * surface area changes but no code disappears.
 *
 * Add a flag when a feature is wired up end-to-end but not yet ready to
 * expose by default: typically because its data format is still in
 * flux, the UX needs more iteration, or the implementation is gated on
 * an external dependency that isn't deployed.
 *
 * Local builds can also flip flags without a rebundle, from the feature flags popup in the markers
 * toolbar, which keeps them in local storage. Builds made by CI (the releases) never read or show
 * those: there the flags are always what this file says.
 */

import { GROUP_RELEASES, GroupRelease } from './util/decisions/keys';

// Parcel inlines the variable at build time, and GitHub Actions sets it on every CI build.
const IS_CI_BUILD = process.env.GITHUB_ACTIONS === 'true';
export const FEATURE_FLAG_OVERRIDES_ENABLED = !IS_CI_BUILD;

interface FeatureFlagDefinition<T> {
  default: T;
  // Shown in the feature flags popup.
  description: string;
  // The values to choose from, for a flag that is not on/off.
  options?: readonly T[];
  // Read once when the script starts, so a change applies after a reload.
  appliesOnReload?: boolean;
  // Not offered in the popup.
  hidden?: boolean;
}

function frameTimingFlag(
  release: GroupRelease,
  description: string
): FeatureFlagDefinition<GroupRelease> {
  return {
    default: release,
    description: `${description} 'next' is 5.48's until a fix lands there. Ignored while frameTiming549 is on.`,
    options: GROUP_RELEASES,
    appliesOnReload: true,
  };
}

const featureFlagDefinitions = {
  /** Shareable-URL save / load.
   *  - Anchors the Shift+S "Share" chip in the Data group of the hints
   *    bar (`copyShareableUrl` shortcut).
   *  - Auto-loads markers from a `?share=...` URL fragment on init
   *    via `tryLoadSharedMarkers()`.
   *  Off by default: the embedded-markers URL format is still
   *  iterating and shared links from one bundle version may not parse
   *  cleanly in another. */
  shareLink: {
    default: false,
    description: 'Shift+S copies a link with the markers, and a ?share= link loads them.',
    appliesOnReload: true,
  } as FeatureFlagDefinition<boolean>,
  cinematicSolveStats: {
    default: true,
    description: 'Flash the segment count and solve time of each Cinematic crop path solve.',
  } as FeatureFlagDefinition<boolean>,
  reframeFrameStats: {
    default: false,
    description:
      "Log reframe's redraws every 2 s of playback: frames skipped, late redraws, draw time, the drawn picture against the crop's frame, and how evenly the crop moves.",
  } as FeatureFlagDefinition<boolean>,
  /** See `util/video-frame-loop.ts`. */
  videoFrameLoopTiming: {
    default: 'everyRefresh',
    description:
      "How reframe, the crop previews and the minimap get video frames: every screen refresh, from the frame the video holds, or the video's frame callback.",
    options: ['everyRefresh', 'frameCallback'],
  } as FeatureFlagDefinition<'everyRefresh' | 'frameCallback'>,
  videoFrameLoopStats: {
    default: false,
    description:
      'Log each video frame loop every 2 s of playback. It shows the timing and consumers, refreshes, frames taken and repeated, new frames, and frame callback calls and misses. It also shows the time each part took.',
  } as FeatureFlagDefinition<boolean>,
  /** The whole build on 5.49's frame decisions, for its oracle tests and opt-in runs: 5.49's frame
   *  timing does not yet handle every video. Only `util/frame-timing.ts` reads it. */
  frameTiming549: {
    default: false,
    description:
      "Every frame decision as 5.49 made it, whatever each group's flag picks: markers and points on the frame on screen, steps by whole frames, and the Measure button.",
    appliesOnReload: true,
  } as FeatureFlagDefinition<boolean>,
  /** One flag per group of frame decisions (`util/decisions/`), each choosing the release whose
   *  decisions the group uses. Only `util/frame-timing.ts` reads them. */
  placementTiming: frameTimingFlag(
    'next',
    'Where markers, crop and speed points are placed: at the playhead (5.48), or on the frame on screen (5.49).'
  ),
  seekTiming: frameTimingFlag(
    'next',
    "Where a seek to a marker or point goes: to its time (5.48), or inside its frame, keeping a slow seek's target (5.49)."
  ),
  loopTiming: frameTimingFlag(
    'next',
    'When the marker pair and crop loops turn back: past the end (5.48), or on the end frame, shown its full time (5.49).'
  ),
  stepsTiming: frameTimingFlag(
    'next',
    'How frame steps and marker nudges move, and how durations count: by 1/fps of time (5.48), or by whole frames from the frame on screen, counting the end frame (5.49).'
  ),
  compareTiming: frameTimingFlag(
    'next',
    'How markers, points and the playhead compare: by time (5.48), or by frame (5.49).'
  ),
  frameRateTiming: frameTimingFlag(
    'next',
    "The frame rate: YouTube's or 60 fps (5.48), or measured from played frames with the Measure button (5.49)."
  ),
  cropEaseTiming: frameTimingFlag(
    'next',
    "Where a crop section's ease ends: 5.48's frame, or 5.49's, which allows for a time rounded below a frame's start."
  ),
  cinematicTiming: frameTimingFlag(
    'next',
    "The frame a Cinematic cut takes effect on: 5.48's ease frame, or 5.49's, which allows for a time rounded below a frame's start."
  ),
  featureFlagsPanel: {
    default: FEATURE_FLAG_OVERRIDES_ENABLED,
    description: 'The feature flags popup in the markers toolbar.',
    hidden: true,
  } as FeatureFlagDefinition<boolean>,
};

type Definitions = typeof featureFlagDefinitions;
export type FeatureFlagName = keyof Definitions;
export type FeatureFlags = {
  [K in FeatureFlagName]: Definitions[K] extends FeatureFlagDefinition<infer T> ? T : never;
};

export function getFeatureFlagDefinition<K extends FeatureFlagName>(
  name: K
): FeatureFlagDefinition<FeatureFlags[K]> {
  return featureFlagDefinitions[name] as FeatureFlagDefinition<FeatureFlags[K]>;
}

export const FEATURE_FLAG_NAMES = Object.keys(featureFlagDefinitions) as FeatureFlagName[];

function defaultFeatureFlags(): FeatureFlags {
  return Object.fromEntries(
    FEATURE_FLAG_NAMES.map((name) => [name, featureFlagDefinitions[name].default])
  ) as FeatureFlags;
}

/** The stored overrides a flag can take: known, not hidden, and a value of the flag's kind. */
export function validFeatureFlagOverrides(stored: unknown): Partial<FeatureFlags> {
  if (stored == null || typeof stored !== 'object') return {};
  const valid: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(stored)) {
    const definition = (featureFlagDefinitions as Record<string, FeatureFlagDefinition<unknown>>)[
      name
    ];
    if (!definition || definition.hidden) continue;
    const ok = definition.options
      ? definition.options.includes(value)
      : typeof value === typeof definition.default;
    if (ok) valid[name] = value;
  }
  return valid as Partial<FeatureFlags>;
}

const STORAGE_KEY = 'yt_clipper_feature_flags';

function readStoredOverrides(): Partial<FeatureFlags> {
  if (!FEATURE_FLAG_OVERRIDES_ENABLED) return {};
  try {
    return validFeatureFlagOverrides(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

let overrides: Partial<FeatureFlags> = readStoredOverrides();

export const featureFlags: FeatureFlags = { ...defaultFeatureFlags(), ...overrides };

export function isFeatureFlagOverridden(name: FeatureFlagName): boolean {
  return name in overrides;
}

const listeners = new Set<(name: FeatureFlagName) => void>();

/** Calls `listener` with a flag's name after the popup changes it. Returns a function to stop. */
export function onFeatureFlagChange(listener: (name: FeatureFlagName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function store(): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Storage blocked: the override still applies until a reload.
  }
}

function apply(name: FeatureFlagName, value: unknown): void {
  (featureFlags as Record<FeatureFlagName, unknown>)[name] = value;
  for (const listener of listeners) listener(name);
}

/** Overrides a flag in a local build, and keeps it across reloads. A flag set to its default is no
 *  longer overridden. */
export function setFeatureFlag<K extends FeatureFlagName>(name: K, value: FeatureFlags[K]): void {
  if (!FEATURE_FLAG_OVERRIDES_ENABLED) return;
  const rest: Partial<FeatureFlags> = { ...overrides };
  delete rest[name];
  overrides = value === featureFlagDefinitions[name].default ? rest : { ...rest, [name]: value };
  store();
  apply(name, value);
}

export function resetFeatureFlags(): void {
  const changed = Object.keys(overrides) as FeatureFlagName[];
  overrides = {};
  store();
  for (const name of changed) apply(name, featureFlagDefinitions[name].default);
}
