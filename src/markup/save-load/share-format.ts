import { presetsMap } from '../features/settings/presets';
import {
  CropPoint,
  Denoise,
  MarkerPair,
  SpeedPoint,
  VideoStabilization,
} from '../@types/yt_clipper';

export const SHARE_FORMAT_VERSION = 0x01;

export const MAX_PAIR_COUNT = 10_000;
export const MAX_MAP_POINT_COUNT = 10_000;

// Starting capacity for ByteWriter's backing buffer. Sized to fit a typical
// small share (≤ ~100 B) in one allocation; grows by doubling on overflow.
const INITIAL_BUFFER_SIZE = 256;

// Upper bound on bytes consumed by a single varuint — enough headroom for any
// value that real fields produce, and tight enough to terminate on corrupted
// input rather than reading forever.
const VARUINT_MAX_BYTES = 9;

// ffmpeg crop filter expects exactly "x:y:w:h" (4 colon-separated parts).
const CROP_PART_COUNT = 4;

export class ShareFormatLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareFormatLimitError';
  }
}

export const DENOISE_PRESET_ORDER = [
  'Disabled',
  'Very Weak',
  'Weak',
  'Medium',
  'Strong',
  'Very Strong',
] as const;

export const VSTAB_PRESET_ORDER = [
  'Disabled',
  'Very Weak',
  'Weak',
  'Medium',
  'Strong',
  'Very Strong',
  'Strongest',
] as const;

export const LOOP_ORDER = ['none', 'fwrev', 'fade'] as const;

export class ByteWriter {
  private buf = new Uint8Array(INITIAL_BUFFER_SIZE);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.byteLength) return;
    let next = this.buf.byteLength * 2;
    while (this.length + n > next) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf, 0);
    this.buf = grown;
  }

  writeByte(b: number) {
    this.ensure(1);
    this.buf[this.length++] = b & 0xff;
  }

  writeBytes(bytes: Uint8Array) {
    this.ensure(bytes.byteLength);
    this.buf.set(bytes, this.length);
    this.length += bytes.byteLength;
  }

  writeVaruint(n: number) {
    if (!Number.isFinite(n) || n < 0) throw new Error(`share-format: invalid varuint ${n}`);
    let v = Math.floor(n);
    while (v >= 0x80) {
      this.writeByte((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.writeByte(v);
  }

  writeVarsint(n: number) {
    if (!Number.isFinite(n)) throw new Error(`share-format: invalid varsint ${n}`);
    const zig = n >= 0 ? n * 2 : -n * 2 - 1;
    this.writeVaruint(zig);
  }

  writeStr(s: string) {
    const bytes = new TextEncoder().encode(s);
    this.writeVaruint(bytes.byteLength);
    this.writeBytes(bytes);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

export class ByteReader {
  private pos = 0;
  constructor(private buf: Uint8Array) {}

  private check(n: number) {
    if (this.pos + n > this.buf.byteLength) {
      throw new RangeError(
        `share-format: read past end at pos=${this.pos} need=${n} size=${this.buf.byteLength}`
      );
    }
  }

  readByte(): number {
    this.check(1);
    return this.buf[this.pos++];
  }

  readVaruint(): number {
    let result = 0;
    let mult = 1;
    for (let i = 0; i < VARUINT_MAX_BYTES; i++) {
      const byte = this.readByte();
      result += (byte & 0x7f) * mult;
      if ((byte & 0x80) === 0) return result;
      mult *= 128;
    }
    throw new Error('share-format: varuint too long');
  }

  readVarsint(): number {
    const z = this.readVaruint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }

  readStr(): string {
    const len = this.readVaruint();
    this.check(len);
    const bytes = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(bytes);
  }

  eof(): boolean {
    return this.pos >= this.buf.byteLength;
  }
}

// Parse a "x:y:w:h" crop string into its parts plus a bitmask indicating which
// slots hold the literal keywords `iw` / `ih`. Slot i uses `iw` when i is even,
// `ih` when odd. Shared by writeCrop and writeCropMap — both need the same
// validation and literal detection before emitting bytes.
function parseCrop(crop: string): { parts: string[]; literalFlags: number } {
  const parts = crop.split(':');
  if (parts.length !== CROP_PART_COUNT) {
    throw new Error(`share-format: crop must have ${CROP_PART_COUNT} parts, got "${crop}"`);
  }
  let literalFlags = 0;
  for (let i = 0; i < CROP_PART_COUNT; i++) {
    if (parts[i] === (i % 2 === 0 ? 'iw' : 'ih')) literalFlags |= 1 << i;
  }
  return { parts, literalFlags };
}

function parseCropNumeric(parts: string[], i: number, crop: string): number {
  const n = parseInt(parts[i], 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`share-format: non-numeric crop part "${parts[i]}" in "${crop}"`);
  }
  return n;
}

function writeCrop(w: ByteWriter, crop: string) {
  const { parts, literalFlags } = parseCrop(crop);
  w.writeByte(literalFlags);
  for (let i = 0; i < CROP_PART_COUNT; i++) {
    if (literalFlags & (1 << i)) continue;
    w.writeVaruint(parseCropNumeric(parts, i, crop));
  }
}

function readCrop(r: ByteReader): string {
  const flags = r.readByte();
  const parts: string[] = [];
  for (let i = 0; i < CROP_PART_COUNT; i++) {
    if (flags & (1 << i)) {
      parts.push(i % 2 === 0 ? 'iw' : 'ih');
    } else {
      parts.push(String(r.readVaruint()));
    }
  }
  return parts.join(':');
}

export function quantizeTime(seconds: number): number {
  return Math.round(seconds * 1000);
}

export function dequantizeTime(ms: number): number {
  return ms / 1000;
}

export function quantizeCentipoint(v: number): number {
  return Math.round(v * 100);
}

export function dequantizeCentipoint(n: number): number {
  return n / 100;
}

const SETTINGS_BIT_CROP_RES = 1 << 0;
const SETTINGS_BIT_TITLE_SUFFIX = 1 << 1;
const SETTINGS_BIT_NEW_MARKER_SPEED = 1 << 2;
const SETTINGS_BIT_NEW_MARKER_CROP = 1 << 3;
const SETTINGS_BIT_MERGE_LIST = 1 << 4;

const PAIR_BIT_SPEED_MAP = 1 << 0;
const PAIR_BIT_CROP_MAP = 1 << 1;
const PAIR_BIT_ZOOM_PAN = 1 << 2;
const PAIR_BIT_OVERRIDES = 1 << 3;
const PAIR_BIT_DEFAULT_SPEED = 1 << 4;

const SPEED_DEFAULT_CENTIPOINT = 100;

// cropMap point flag byte: bits 0-3 mark iw/ih literals per slot (x,y,w,h),
// bit 4 marks easeIn='instant'. Kept in one byte vs. flags + separate easeIn byte.
const CROP_MAP_FLAG_EASE_IN = 1 << 4;

const OV_BIT_TITLE_PREFIX = 1 << 0;
const OV_BIT_ENABLE_HDR = 1 << 1;
const OV_BIT_GAMMA = 1 << 2;
const OV_BIT_ENCODE_SPEED = 1 << 3;
const OV_BIT_CRF = 1 << 4;
const OV_BIT_TARGET_MAX_BITRATE = 1 << 5;
const OV_BIT_TWO_PASS = 1 << 6;
const OV_BIT_DENOISE = 1 << 7;
const OV_BIT_AUDIO = 1 << 8;
const OV_BIT_VSTAB = 1 << 9;
const OV_BIT_VSTAB_DZ = 1 << 10;
const OV_BIT_MINTERP_FPS_MUL = 1 << 11;
const OV_BIT_LOOP = 1 << 12;
const OV_BIT_FADE_DURATION = 1 << 13;

export interface ShareableSettings {
  cropResWidth?: number;
  cropResHeight?: number;
  titleSuffix?: string;
  newMarkerSpeed?: number;
  newMarkerCrop?: string;
  markerPairMergeList?: string;
}

export interface ShareablePair {
  start: number;
  end: number;
  speed: number;
  crop: string;
  enableZoomPan?: boolean;
  speedMap?: SpeedPoint[];
  cropMap?: CropPoint[];
  overrides?: MarkerPair['overrides'];
}

export interface SharePayload {
  settings: ShareableSettings;
  markerPairs: ShareablePair[];
}

function findDenoiseId(d: Denoise): number {
  const idx = DENOISE_PRESET_ORDER.indexOf(d.desc as (typeof DENOISE_PRESET_ORDER)[number]);
  if (idx < 0) {
    console.warn(`share-format: unknown denoise preset "${d.desc}", snapping to Disabled`);
    return 0;
  }
  return idx;
}

function findVStabId(v: VideoStabilization): number {
  const idx = VSTAB_PRESET_ORDER.indexOf(v.desc as (typeof VSTAB_PRESET_ORDER)[number]);
  if (idx < 0) {
    console.warn(
      `share-format: unknown videoStabilization preset "${v.desc}", snapping to Disabled`
    );
    return 0;
  }
  return idx;
}

function denoisePresetFromId(id: number): Denoise {
  const key = DENOISE_PRESET_ORDER[id] ?? DENOISE_PRESET_ORDER[0];
  return { ...presetsMap.denoise[key] } as Denoise;
}

function vstabPresetFromId(id: number): VideoStabilization {
  const key = VSTAB_PRESET_ORDER[id] ?? VSTAB_PRESET_ORDER[0];
  return { ...presetsMap.videoStabilization[key] } as VideoStabilization;
}

function writeSpeedMap(w: ByteWriter, points: SpeedPoint[]) {
  if (points.length > MAX_MAP_POINT_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: speedMap count ${points.length} exceeds limit ${MAX_MAP_POINT_COUNT}`
    );
  }
  w.writeVaruint(points.length);
  let prevX = 0;
  for (const p of points) {
    const x = quantizeTime(p.x);
    w.writeVarsint(x - prevX);
    prevX = x;
    w.writeVaruint(quantizeCentipoint(p.y));
  }
}

function readSpeedMap(r: ByteReader): SpeedPoint[] {
  const count = r.readVaruint();
  if (count > MAX_MAP_POINT_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: speedMap count ${count} exceeds limit ${MAX_MAP_POINT_COUNT}`
    );
  }
  const points: SpeedPoint[] = [];
  let prevX = 0;
  for (let i = 0; i < count; i++) {
    prevX += r.readVarsint();
    const y = dequantizeCentipoint(r.readVaruint());
    points.push({ x: dequantizeTime(prevX), y });
  }
  return points;
}

// cropMap point encoding:
//   varsint(Δx)
//   flagsByte: bits 0-3 = is-literal (iw/ih) per slot {x,y,w,h}; bit 4 = easeIn='instant'
//   for each numeric slot (not literal): varsint(value - lastNumeric[slot])
// Literal slots contribute nothing; lastNumeric tracks the last *numeric* value per
// slot across the whole cropMap (init 0), so a repeated crop compresses to 4 zero deltas.
function writeCropMap(w: ByteWriter, points: CropPoint[]) {
  if (points.length > MAX_MAP_POINT_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: cropMap count ${points.length} exceeds limit ${MAX_MAP_POINT_COUNT}`
    );
  }
  w.writeVaruint(points.length);
  let prevX = 0;
  const lastNumeric = [0, 0, 0, 0];
  for (const p of points) {
    const x = quantizeTime(p.x);
    w.writeVarsint(x - prevX);
    prevX = x;
    const { parts, literalFlags } = parseCrop(p.crop);
    let flags = literalFlags;
    if (p.easeIn === 'instant') flags |= CROP_MAP_FLAG_EASE_IN;
    w.writeByte(flags);
    for (let i = 0; i < CROP_PART_COUNT; i++) {
      if (literalFlags & (1 << i)) continue;
      const n = parseCropNumeric(parts, i, p.crop);
      w.writeVarsint(n - lastNumeric[i]);
      lastNumeric[i] = n;
    }
  }
}

function readCropMap(r: ByteReader): CropPoint[] {
  const count = r.readVaruint();
  if (count > MAX_MAP_POINT_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: cropMap count ${count} exceeds limit ${MAX_MAP_POINT_COUNT}`
    );
  }
  const points: CropPoint[] = [];
  let prevX = 0;
  const lastNumeric = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    prevX += r.readVarsint();
    const flags = r.readByte();
    const parts: string[] = [];
    for (let j = 0; j < CROP_PART_COUNT; j++) {
      if (flags & (1 << j)) {
        parts.push(j % 2 === 0 ? 'iw' : 'ih');
      } else {
        lastNumeric[j] += r.readVarsint();
        parts.push(String(lastNumeric[j]));
      }
    }
    const point: CropPoint = { x: dequantizeTime(prevX), y: 0, crop: parts.join(':') };
    if (flags & CROP_MAP_FLAG_EASE_IN) point.easeIn = 'instant';
    points.push(point);
  }
  return points;
}

// Overrides: a varuint mask selects which fields are present, then non-enum fields
// are written in order, then (if any of DENOISE/VSTAB/LOOP is set) one packed
// enum byte carries all three small-domain enums: denoise (3 bits) | vstab (3 bits) | loop (2 bits).
const OV_ENUM_MASK = OV_BIT_DENOISE | OV_BIT_VSTAB | OV_BIT_LOOP;

function writeOverrides(w: ByteWriter, o: MarkerPair['overrides']) {
  let mask = 0;
  if (o.titlePrefix != null) mask |= OV_BIT_TITLE_PREFIX;
  if (o.enableHDR === true) mask |= OV_BIT_ENABLE_HDR;
  if (o.gamma != null) mask |= OV_BIT_GAMMA;
  if (o.encodeSpeed != null) mask |= OV_BIT_ENCODE_SPEED;
  if (o.crf != null) mask |= OV_BIT_CRF;
  if (o.targetMaxBitrate != null) mask |= OV_BIT_TARGET_MAX_BITRATE;
  if (o.twoPass === true) mask |= OV_BIT_TWO_PASS;
  if (o.denoise != null) mask |= OV_BIT_DENOISE;
  if (o.audio === true) mask |= OV_BIT_AUDIO;
  if (o.videoStabilization != null) mask |= OV_BIT_VSTAB;
  if (o.videoStabilizationDynamicZoom === true) mask |= OV_BIT_VSTAB_DZ;
  if (o.minterpFpsMultiplier != null) mask |= OV_BIT_MINTERP_FPS_MUL;
  if (o.loop != null) mask |= OV_BIT_LOOP;
  if (o.fadeDuration != null) mask |= OV_BIT_FADE_DURATION;

  w.writeVaruint(mask);
  if (o.titlePrefix != null) w.writeStr(o.titlePrefix);
  if (o.gamma != null) w.writeVaruint(quantizeCentipoint(o.gamma));
  if (o.encodeSpeed != null) w.writeVaruint(quantizeCentipoint(o.encodeSpeed));
  if (o.crf != null) w.writeVaruint(o.crf);
  if (o.targetMaxBitrate != null) w.writeVaruint(o.targetMaxBitrate);
  if (o.minterpFpsMultiplier != null) w.writeVaruint(quantizeCentipoint(o.minterpFpsMultiplier));
  if (o.fadeDuration != null) w.writeVaruint(quantizeCentipoint(o.fadeDuration));
  if (mask & OV_ENUM_MASK) {
    const d = o.denoise != null ? findDenoiseId(o.denoise) : 0;
    const v = o.videoStabilization != null ? findVStabId(o.videoStabilization) : 0;
    const idx = o.loop != null ? LOOP_ORDER.indexOf(o.loop) : 0;
    const l = idx < 0 ? 0 : idx;
    w.writeByte((d & 0x07) | ((v & 0x07) << 3) | ((l & 0x03) << 6));
  }
}

function readOverrides(r: ByteReader): MarkerPair['overrides'] {
  const mask = r.readVaruint();
  const o: MarkerPair['overrides'] = {};
  if (mask & OV_BIT_TITLE_PREFIX) o.titlePrefix = r.readStr();
  if (mask & OV_BIT_ENABLE_HDR) o.enableHDR = true;
  if (mask & OV_BIT_GAMMA) o.gamma = dequantizeCentipoint(r.readVaruint());
  if (mask & OV_BIT_ENCODE_SPEED) o.encodeSpeed = dequantizeCentipoint(r.readVaruint());
  if (mask & OV_BIT_CRF) o.crf = r.readVaruint();
  if (mask & OV_BIT_TARGET_MAX_BITRATE) o.targetMaxBitrate = r.readVaruint();
  if (mask & OV_BIT_TWO_PASS) o.twoPass = true;
  if (mask & OV_BIT_AUDIO) o.audio = true;
  if (mask & OV_BIT_VSTAB_DZ) o.videoStabilizationDynamicZoom = true;
  if (mask & OV_BIT_MINTERP_FPS_MUL) o.minterpFpsMultiplier = dequantizeCentipoint(r.readVaruint());
  if (mask & OV_BIT_FADE_DURATION) o.fadeDuration = dequantizeCentipoint(r.readVaruint());
  if (mask & OV_ENUM_MASK) {
    const enumByte = r.readByte();
    if (mask & OV_BIT_DENOISE) o.denoise = denoisePresetFromId(enumByte & 0x07);
    if (mask & OV_BIT_VSTAB) o.videoStabilization = vstabPresetFromId((enumByte >> 3) & 0x07);
    if (mask & OV_BIT_LOOP) o.loop = LOOP_ORDER[(enumByte >> 6) & 0x03] ?? 'none';
  }
  return o;
}

function writeSettings(w: ByteWriter, s: ShareableSettings) {
  let mask = 0;
  if (s.cropResWidth != null && s.cropResHeight != null) mask |= SETTINGS_BIT_CROP_RES;
  if (s.titleSuffix) mask |= SETTINGS_BIT_TITLE_SUFFIX;
  if (s.newMarkerSpeed != null && s.newMarkerSpeed !== 1) mask |= SETTINGS_BIT_NEW_MARKER_SPEED;
  if (s.newMarkerCrop) mask |= SETTINGS_BIT_NEW_MARKER_CROP;
  if (s.markerPairMergeList) mask |= SETTINGS_BIT_MERGE_LIST;

  w.writeVaruint(mask);
  if (s.cropResWidth != null && s.cropResHeight != null) {
    w.writeVaruint(s.cropResWidth);
    w.writeVaruint(s.cropResHeight);
  }
  if (s.titleSuffix) w.writeStr(s.titleSuffix);
  if (s.newMarkerSpeed != null && s.newMarkerSpeed !== 1) {
    w.writeVaruint(quantizeCentipoint(s.newMarkerSpeed));
  }
  if (s.newMarkerCrop) writeCrop(w, s.newMarkerCrop);
  if (s.markerPairMergeList) w.writeStr(s.markerPairMergeList);
}

function readSettings(r: ByteReader): ShareableSettings {
  const mask = r.readVaruint();
  const settings: ShareableSettings = {};
  if (mask & SETTINGS_BIT_CROP_RES) {
    settings.cropResWidth = r.readVaruint();
    settings.cropResHeight = r.readVaruint();
  }
  if (mask & SETTINGS_BIT_TITLE_SUFFIX) settings.titleSuffix = r.readStr();
  if (mask & SETTINGS_BIT_NEW_MARKER_SPEED) {
    settings.newMarkerSpeed = dequantizeCentipoint(r.readVaruint());
  }
  if (mask & SETTINGS_BIT_NEW_MARKER_CROP) settings.newMarkerCrop = readCrop(r);
  if (mask & SETTINGS_BIT_MERGE_LIST) settings.markerPairMergeList = r.readStr();
  return settings;
}

// Pair layout: mask varuint, then start (abs varuint for index 0, else Δ varsint),
// duration varuint, optional speed varuint, crop, and optional sub-blocks in the
// order speedMap → cropMap → overrides. Returns the pair's quantized start in ms
// so the caller can thread the delta state forward.
function writePair(w: ByteWriter, p: ShareablePair, index: number, prevStart: number): number {
  const speedCenti = quantizeCentipoint(p.speed);

  let mask = 0;
  if (p.speedMap && p.speedMap.length > 0) mask |= PAIR_BIT_SPEED_MAP;
  if (p.cropMap && p.cropMap.length > 0) mask |= PAIR_BIT_CROP_MAP;
  if (p.enableZoomPan === true) mask |= PAIR_BIT_ZOOM_PAN;
  if (p.overrides && Object.keys(p.overrides).length > 0) mask |= PAIR_BIT_OVERRIDES;
  if (speedCenti === SPEED_DEFAULT_CENTIPOINT) mask |= PAIR_BIT_DEFAULT_SPEED;
  w.writeVaruint(mask);

  const startMs = quantizeTime(p.start);
  if (index === 0) w.writeVaruint(startMs);
  else w.writeVarsint(startMs - prevStart);

  const durationMs = Math.max(0, quantizeTime(p.end) - startMs);
  w.writeVaruint(durationMs);
  if (!(mask & PAIR_BIT_DEFAULT_SPEED)) w.writeVaruint(speedCenti);
  writeCrop(w, p.crop);

  if (p.speedMap && p.speedMap.length > 0) writeSpeedMap(w, p.speedMap);
  if (p.cropMap && p.cropMap.length > 0) writeCropMap(w, p.cropMap);
  if (p.overrides && Object.keys(p.overrides).length > 0) writeOverrides(w, p.overrides);

  return startMs;
}

function readPair(
  r: ByteReader,
  index: number,
  prevStart: number
): { pair: ShareablePair; startMs: number } {
  const mask = r.readVaruint();
  const startMs = index === 0 ? r.readVaruint() : prevStart + r.readVarsint();
  const durationMs = r.readVaruint();
  const speed =
    mask & PAIR_BIT_DEFAULT_SPEED
      ? dequantizeCentipoint(SPEED_DEFAULT_CENTIPOINT)
      : dequantizeCentipoint(r.readVaruint());
  const crop = readCrop(r);

  const pair: ShareablePair = {
    start: dequantizeTime(startMs),
    end: dequantizeTime(startMs + durationMs),
    speed,
    crop,
  };
  if (mask & PAIR_BIT_ZOOM_PAN) pair.enableZoomPan = true;
  if (mask & PAIR_BIT_SPEED_MAP) pair.speedMap = readSpeedMap(r);
  if (mask & PAIR_BIT_CROP_MAP) pair.cropMap = readCropMap(r);
  if (mask & PAIR_BIT_OVERRIDES) pair.overrides = readOverrides(r);
  return { pair, startMs };
}

export function serializeBinary(payload: SharePayload): Uint8Array {
  if (payload.markerPairs.length > MAX_PAIR_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: pair count ${payload.markerPairs.length} exceeds limit ${MAX_PAIR_COUNT}`
    );
  }
  const w = new ByteWriter();
  w.writeByte(SHARE_FORMAT_VERSION);
  writeSettings(w, payload.settings);
  w.writeVaruint(payload.markerPairs.length);
  let prevStart = 0;
  for (let i = 0; i < payload.markerPairs.length; i++) {
    prevStart = writePair(w, payload.markerPairs[i], i, prevStart);
  }
  return w.toUint8Array();
}

export function deserializeBinary(bytes: Uint8Array): SharePayload {
  const r = new ByteReader(bytes);
  const version = r.readByte();
  if (version !== SHARE_FORMAT_VERSION) {
    throw new UnsupportedShareVersionError(version);
  }
  const settings = readSettings(r);
  const pairCount = r.readVaruint();
  if (pairCount > MAX_PAIR_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: pair count ${pairCount} exceeds limit ${MAX_PAIR_COUNT}`
    );
  }
  const markerPairs: ShareablePair[] = [];
  let prevStart = 0;
  for (let i = 0; i < pairCount; i++) {
    const { pair, startMs } = readPair(r, i, prevStart);
    markerPairs.push(pair);
    prevStart = startMs;
  }
  return { settings, markerPairs };
}

export class UnsupportedShareVersionError extends Error {
  constructor(public readonly version: number) {
    super(`Unsupported share format version: ${version}`);
    this.name = 'UnsupportedShareVersionError';
  }
}
