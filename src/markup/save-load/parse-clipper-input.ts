// Loose-but-safe parser for clipper input data (share URL payloads, JSON file
// imports, localStorage auto-saved blobs). Addresses attack classes that our
// XSS stack does NOT cover at this boundary:
//   - Prototype pollution via `__proto__` / `constructor` / `prototype` keys.
//   - NaN / Infinity in numeric time fields (silent math errors downstream).
//   - Unbounded `markerPairs` array (DoS — matches share-format's 10K cap).
//   - Stack overflow via deeply nested objects (recursion depth cap).
//   - Unknown attacker-supplied keys flowing into `appState.settings` merge
//     (allowlist filter — only known schema keys pass through).
//
// Design constraints:
//   - Loose: extra/unknown fields are SILENTLY STRIPPED (not rejected) so
//     older versions can load newer-format files. Known fields that happen
//     to be missing are tolerated (downstream uses defaults).
//   - Reject odd: non-object top-level, missing/non-array markerPairs,
//     non-finite or negative start/end, pair count over the cap, nesting
//     past the depth cap.
//
// In addition to the parsed output, the parser returns a list of `issues`
// describing soft-handled events (unknown keys stripped, proto-polluting
// keys stripped, invalid speed/crop points dropped). Callers can surface
// these in a review UI so the user can see what the parser did.

import type {
  CropPoint,
  MarkerPair,
  MarkerPairOverrides,
  Settings,
  SpeedPoint,
} from '../@types/yt_clipper';

/** Subset of MarkerPair keys that round-trip through JSON. Runtime-only fields
 *  (SVG numbering elements, undo/redo stacks, chart loop state) are not
 *  loadable and are excluded from the allowlist. */
type LoadableMarkerPair = Pick<
  MarkerPair,
  'start' | 'end' | 'speed' | 'speedMap' | 'crop' | 'cropMap' | 'enableZoomPan' | 'cropRes'
> & {
  overrides?: Partial<MarkerPairOverrides>;
  /** 1-indexed display number added by save-time serializer. Tolerated but
   *  not load-bearing — we re-number on load. */
  number?: number;
};

/** The shape `parseClipperInput` returns. Strict-allowlisted extension of
 *  `Settings` with marker data and save-time metadata. */
export type ClipperInput = Partial<Settings> & {
  version?: string;
  date?: number;
  markerPairs: Partial<LoadableMarkerPair>[];
};

export class ClipperInputValidationError extends Error {
  constructor(message: string) {
    super(`Clipper input: ${message}`);
    this.name = 'ClipperInputValidationError';
  }
}

/** Soft-handled events the parser wants the caller to know about. None of
 *  these abort the parse — the returned `input` is always the best-effort
 *  normalization. Hard structural errors throw `ClipperInputValidationError`
 *  instead.
 *
 *  Severity split:
 *   - `dangerousKeys` is a security-adjacent signal (prototype pollution
 *     attempt). Callers should surface alongside XSS-style warnings.
 *   - `unexpectedFields` and `invalidPoint` are informational — normal during
 *     version skew or when editing-tool output doesn't quite match our model. */
export type DataFormatIssue =
  | { kind: 'unexpectedFields'; path: string; keys: string[] }
  | { kind: 'dangerousKeys'; path: string; keys: string[] }
  | { kind: 'invalidPoint'; path: string };

export function isDangerousIssue(issue: DataFormatIssue): boolean {
  return issue.kind === 'dangerousKeys';
}

export interface ParseResult {
  input: ClipperInput;
  issues: DataFormatIssue[];
}

// --- Allowlists, compile-time-enforced against the corresponding interfaces.

const settingsAllow = {
  platform: true,
  videoID: true,
  videoTag: true,
  videoTitle: true,
  videoUrl: true,
  newMarkerSpeed: true,
  newMarkerCrop: true,
  titleSuffix: true,
  isVerticalVideo: true,
  cropRes: true,
  cropResWidth: true,
  cropResHeight: true,
  markerPairMergeList: true,
  encodeSpeed: true,
  crf: true,
  targetMaxBitrate: true,
  rotate: true,
  enableHDR: true,
  gamma: true,
  twoPass: true,
  denoise: true,
  audio: true,
  videoStabilization: true,
  videoStabilizationDynamicZoom: true,
  minterpFpsMultiplier: true,
  loop: true,
  fadeDuration: true,
} as const satisfies Record<keyof Settings, true>;

const markerPairAllow = {
  start: true,
  end: true,
  speed: true,
  speedMap: true,
  crop: true,
  cropMap: true,
  enableZoomPan: true,
  cropRes: true,
  overrides: true,
  number: true,
} as const satisfies Record<keyof LoadableMarkerPair, true>;

const overridesAllow = {
  titlePrefix: true,
  enableHDR: true,
  gamma: true,
  encodeSpeed: true,
  crf: true,
  targetMaxBitrate: true,
  twoPass: true,
  denoise: true,
  audio: true,
  videoStabilization: true,
  videoStabilizationDynamicZoom: true,
  minterpFpsMultiplier: true,
  loop: true,
  fadeDuration: true,
} as const satisfies Record<keyof MarkerPairOverrides, true>;

const speedPointAllow = {
  x: true,
  y: true,
} as const satisfies Record<keyof SpeedPoint, true>;

const cropPointAllow = {
  x: true,
  y: true,
  crop: true,
  easeIn: true,
} as const satisfies Record<keyof CropPoint, true>;

const topLevelAllow = {
  ...settingsAllow,
  version: true,
  date: true,
  markerPairs: true,
} as const satisfies Record<keyof ClipperInput, true>;

const MAX_MARKER_PAIRS = 10_000;
const MAX_STRIP_DEPTH = 64;
const PROTO_KEYS = ['__proto__', 'constructor', 'prototype'] as const;

// --- Implementation

/** Picks keys from `source` that are in `allow`. Records any unknown keys as
 *  an `unknownKeys` issue on `issues` attributed to `path`. */
function pickKnown<K extends string>(
  source: Record<string, unknown>,
  allow: Readonly<Record<string, true>>,
  path: string,
  issues: DataFormatIssue[]
): Partial<Record<K, unknown>> {
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const key of Object.keys(source)) {
    if (Object.prototype.hasOwnProperty.call(allow, key)) {
      out[key] = source[key];
    } else {
      unknown.push(key);
    }
  }
  if (unknown.length > 0) issues.push({ kind: 'unexpectedFields', path, keys: unknown });
  return out as Partial<Record<K, unknown>>;
}

/** Recursively drop prototype-polluting keys. Records any finds as a
 *  `prototypeKeys` issue — these are a security signal worth surfacing. */
function stripPrototypeKeys(
  value: unknown,
  depth: number,
  path: string,
  issues: DataFormatIssue[]
): unknown {
  if (depth > MAX_STRIP_DEPTH) {
    throw new ClipperInputValidationError('nesting too deep');
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item, i) => stripPrototypeKeys(item, depth + 1, `${path}[${i}]`, issues));
  }
  const out: Record<string, unknown> = {};
  const protoHits: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if ((PROTO_KEYS as readonly string[]).includes(k)) {
      protoHits.push(k);
      continue;
    }
    out[k] = stripPrototypeKeys(v, depth + 1, path === '' ? k : `${path}.${k}`, issues);
  }
  if (protoHits.length > 0) {
    issues.push({ kind: 'dangerousKeys', path: path || '(root)', keys: protoHits });
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function remapLegacyKeys(obj: Record<string, unknown>): Record<string, unknown> {
  if (!('markerPairs' in obj) && 'markers' in obj) {
    const { markers, ...rest } = obj;
    return { ...rest, markerPairs: markers };
  }
  return obj;
}

function coerceSpeed(raw: unknown): number | undefined {
  if (isFiniteNumber(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function requireNonNegativeFinite(value: unknown, field: string, index: number): number {
  if (!isFiniteNumber(value) || value < 0) {
    throw new ClipperInputValidationError(
      `markerPairs[${index}].${field} must be a finite >= 0 number`
    );
  }
  return value;
}

/** Per-field value validators for `MarkerPairOverrides`. Compile-time-
 *  exhaustive via the `satisfies` constraint: a new key on
 *  `MarkerPairOverrides` requires a validator entry here or the build
 *  fails. Each validator is a coarse type guard (string / boolean /
 *  finite number / enum) — fine-grained semantic constraints (e.g.
 *  "crf must be 0–63") happen further downstream in the encoding
 *  pipeline; here we only ensure the type matches what the codebase
 *  expects to consume. */
const OVERRIDES_VALIDATORS = {
  titlePrefix: (v: unknown) => typeof v === 'string',
  enableHDR: (v: unknown) => typeof v === 'boolean',
  gamma: (v: unknown) => isFiniteNumber(v),
  encodeSpeed: (v: unknown) => isFiniteNumber(v),
  crf: (v: unknown) => isFiniteNumber(v),
  targetMaxBitrate: (v: unknown) => isFiniteNumber(v),
  twoPass: (v: unknown) => typeof v === 'boolean',
  denoise: (v: unknown) => isPlainObject(v),
  audio: (v: unknown) => typeof v === 'boolean',
  videoStabilization: (v: unknown) => isPlainObject(v),
  videoStabilizationDynamicZoom: (v: unknown) => typeof v === 'boolean',
  minterpFpsMultiplier: (v: unknown) => isFiniteNumber(v),
  loop: (v: unknown) => v === 'none' || v === 'fwrev' || v === 'fade',
  fadeDuration: (v: unknown) => isFiniteNumber(v),
} as const satisfies { [K in keyof MarkerPairOverrides]-?: (v: unknown) => boolean };

function parseOverrides(
  raw: unknown,
  path: string,
  issues: DataFormatIssue[]
): Partial<MarkerPairOverrides> {
  if (!isPlainObject(raw)) return {};
  const picked = pickKnown<keyof MarkerPairOverrides>(raw, overridesAllow, path, issues);
  const out: Partial<MarkerPairOverrides> = {};
  for (const [key, validate] of Object.entries(OVERRIDES_VALIDATORS)) {
    const value = (picked as Record<string, unknown>)[key];
    if (value !== undefined && validate(value)) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function parseSpeedPoint(raw: unknown, path: string, issues: DataFormatIssue[]): SpeedPoint | null {
  if (!isPlainObject(raw)) {
    issues.push({ kind: 'invalidPoint', path });
    return null;
  }
  const picked = pickKnown<keyof SpeedPoint>(raw, speedPointAllow, path, issues);
  if (!isFiniteNumber(picked.x) || !isFiniteNumber(picked.y)) {
    issues.push({ kind: 'invalidPoint', path });
    return null;
  }
  return { x: picked.x, y: picked.y };
}

function parseCropPoint(raw: unknown, path: string, issues: DataFormatIssue[]): CropPoint | null {
  if (!isPlainObject(raw)) {
    issues.push({ kind: 'invalidPoint', path });
    return null;
  }
  const picked = pickKnown<keyof CropPoint>(
    raw,
    cropPointAllow,
    path,
    issues
  ) as Partial<CropPoint>;
  if (!isFiniteNumber(picked.x) || picked.y !== 0 || typeof picked.crop !== 'string') {
    issues.push({ kind: 'invalidPoint', path });
    return null;
  }
  const out: CropPoint = { x: picked.x, y: 0, crop: picked.crop };
  if (picked.easeIn === 'instant') out.easeIn = 'instant';
  return out;
}

function parseMarkerPair(
  raw: unknown,
  index: number,
  issues: DataFormatIssue[]
): Partial<LoadableMarkerPair> {
  if (!isPlainObject(raw)) {
    throw new ClipperInputValidationError(`markerPairs[${index}] is not an object`);
  }
  const path = `markerPairs[${index}]`;
  const picked = pickKnown<keyof LoadableMarkerPair>(raw, markerPairAllow, path, issues);
  const out: Partial<LoadableMarkerPair> = {
    start: requireNonNegativeFinite(picked.start, 'start', index),
    end: requireNonNegativeFinite(picked.end, 'end', index),
    overrides: parseOverrides(picked.overrides, `${path}.overrides`, issues),
  };
  const speed = coerceSpeed(picked.speed);
  if (speed !== undefined) out.speed = speed;
  if (typeof picked.crop === 'string') out.crop = picked.crop;
  if (typeof picked.cropRes === 'string') out.cropRes = picked.cropRes;
  if (typeof picked.enableZoomPan === 'boolean') out.enableZoomPan = picked.enableZoomPan;
  if (typeof picked.number === 'number') out.number = picked.number;
  if (Array.isArray(picked.speedMap)) {
    out.speedMap = picked.speedMap
      .map((p, i) => parseSpeedPoint(p, `${path}.speedMap[${i}]`, issues))
      .filter((p): p is SpeedPoint => p !== null);
  }
  if (Array.isArray(picked.cropMap)) {
    out.cropMap = picked.cropMap
      .map((p, i) => parseCropPoint(p, `${path}.cropMap[${i}]`, issues))
      .filter((p): p is CropPoint => p !== null);
  }
  return out;
}

/** Validate an already-parsed object as clipper input. Records soft-handled
 *  events in `result.issues`; throws on hard structural errors. */
export function parseClipperInput(raw: unknown): ParseResult {
  if (!isPlainObject(raw)) {
    throw new ClipperInputValidationError('expected a JSON object at the top level');
  }
  const issues: DataFormatIssue[] = [];
  const stripped = stripPrototypeKeys(raw, 0, '', issues) as Record<string, unknown>;
  const normalized = remapLegacyKeys(stripped);
  const { markerPairs: markerPairsRaw, ...rest } = pickKnown<keyof ClipperInput>(
    normalized,
    topLevelAllow,
    '(root)',
    issues
  );

  if (!Array.isArray(markerPairsRaw)) {
    throw new ClipperInputValidationError('markerPairs must be an array');
  }
  if (markerPairsRaw.length > MAX_MARKER_PAIRS) {
    throw new ClipperInputValidationError(
      `markerPairs has ${markerPairsRaw.length} entries (max ${MAX_MARKER_PAIRS})`
    );
  }

  const markerPairs = markerPairsRaw.map((pair, i) => parseMarkerPair(pair, i, issues));
  const input = { ...rest, markerPairs } as ClipperInput;
  return { input, issues };
}

/** Parse a JSON string as clipper input. Strips proto-polluting keys via the
 *  `JSON.parse` reviver (single pass, faster than post-parse recursive strip),
 *  then runs `parseClipperInput` on the result. */
export function parseClipperInputJSON(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text, (key, value) =>
      (PROTO_KEYS as readonly string[]).includes(key) ? undefined : value
    );
  } catch (err) {
    throw new ClipperInputValidationError(
      `invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return parseClipperInput(raw);
}

/** Application policy for every `ClipperInput` key. Compile-time-exhaustive
 *  via the `satisfies Record<keyof ClipperInput, ...>` constraint: if a new
 *  field is added to `Settings` (and thereby to `ClipperInput`), TypeScript
 *  rejects the build until the field is explicitly classified here.
 *
 *  - `'apply'`: the field merges into `appState.settings` on load. Used for
 *    user-configurable encoding/preview/marker settings.
 *  - `'skip'`: the field describes the source environment (which video,
 *    which save-time version, etc.) or is handled separately (markerPairs
 *    has its own application path via `addMarkerPairs`). Skipped to keep
 *    user state independent of where the file came from. */
const KEY_POLICY = {
  // === source-environment metadata: never merged from loaded JSON ===
  // These fields describe the file's origin, not user-tunable settings.
  // Letting a loaded file overwrite `platform` or `videoTag` would
  // corrupt the auto-save slot (which keys on `videoTag`) or break
  // platform-specific code paths. They also act as the obvious target
  // for any future modal-chrome interpolation, so keeping attacker-
  // controlled strings out of `appState.settings` here closes the
  // social-engineering surface at the source.
  platform: 'skip',
  videoID: 'skip',
  videoTag: 'skip',
  videoTitle: 'skip',
  videoUrl: 'skip',
  isVerticalVideo: 'skip',
  version: 'skip',
  date: 'skip',
  markerPairs: 'skip',
  // === user-configurable settings: merged into appState.settings ===
  newMarkerSpeed: 'apply',
  newMarkerCrop: 'apply',
  titleSuffix: 'apply',
  cropRes: 'apply',
  cropResWidth: 'apply',
  cropResHeight: 'apply',
  markerPairMergeList: 'apply',
  encodeSpeed: 'apply',
  crf: 'apply',
  targetMaxBitrate: 'apply',
  rotate: 'apply',
  enableHDR: 'apply',
  gamma: 'apply',
  twoPass: 'apply',
  denoise: 'apply',
  audio: 'apply',
  videoStabilization: 'apply',
  videoStabilizationDynamicZoom: 'apply',
  minterpFpsMultiplier: 'apply',
  loop: 'apply',
  fadeDuration: 'apply',
} as const satisfies Record<keyof ClipperInput, 'apply' | 'skip'>;

export function toApplicableSettings(input: ClipperInput): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [key, policy] of Object.entries(KEY_POLICY)) {
    if (policy !== 'apply') continue;
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Formats an issue list as a short multi-line human-readable string for log
 *  output or flash messages. */
export function formatIssues(issues: readonly DataFormatIssue[]): string {
  return issues
    .map((issue) => {
      switch (issue.kind) {
        case 'unexpectedFields':
          return `stripped unknown keys at ${issue.path}: ${issue.keys.join(', ')}`;
        case 'dangerousKeys':
          return `stripped prototype-polluting keys at ${issue.path}: ${issue.keys.join(', ')}`;
        case 'invalidPoint':
          return `dropped invalid point at ${issue.path}`;
      }
    })
    .join('\n');
}
