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
  private buf = new Uint8Array(256);
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
    for (let i = 0; i < 9; i++) {
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

function writeCrop(w: ByteWriter, crop: string) {
  const parts = crop.split(':');
  if (parts.length !== 4) throw new Error(`share-format: crop must have 4 parts, got "${crop}"`);
  let flags = 0;
  for (let i = 0; i < 4; i++) {
    const expected = i % 2 === 0 ? 'iw' : 'ih';
    if (parts[i] === expected) flags |= 1 << i;
  }
  w.writeByte(flags);
  for (let i = 0; i < 4; i++) {
    if (flags & (1 << i)) continue;
    const n = parseInt(parts[i], 10);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`share-format: non-numeric crop part "${parts[i]}" in "${crop}"`);
    }
    w.writeVaruint(n);
  }
}

function readCrop(r: ByteReader): string {
  const flags = r.readByte();
  const parts: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (flags & (1 << i)) {
      parts.push(i % 2 === 0 ? 'iw' : 'ih');
    } else {
      parts.push(String(r.readVaruint()));
    }
  }
  return parts.join(':');
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
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

function writeCropMap(w: ByteWriter, points: CropPoint[]) {
  w.writeVaruint(points.length);
  let prevX = 0;
  for (const p of points) {
    const x = quantizeTime(p.x);
    w.writeVarsint(x - prevX);
    prevX = x;
    writeCrop(w, p.crop);
    w.writeByte(p.easeIn === 'instant' ? 1 : 0);
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
  for (let i = 0; i < count; i++) {
    prevX += r.readVarsint();
    const crop = readCrop(r);
    const flags = r.readByte();
    const point: CropPoint = { x: dequantizeTime(prevX), y: 0, crop };
    if (flags & 1) point.easeIn = 'instant';
    points.push(point);
  }
  return points;
}

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
  if (o.denoise != null) w.writeByte(findDenoiseId(o.denoise));
  if (o.videoStabilization != null) w.writeByte(findVStabId(o.videoStabilization));
  if (o.minterpFpsMultiplier != null) w.writeVaruint(quantizeCentipoint(o.minterpFpsMultiplier));
  if (o.loop != null) {
    const idx = LOOP_ORDER.indexOf(o.loop);
    w.writeByte(idx < 0 ? 0 : idx);
  }
  if (o.fadeDuration != null) w.writeVaruint(quantizeCentipoint(o.fadeDuration));
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
  if (mask & OV_BIT_DENOISE) o.denoise = denoisePresetFromId(r.readByte());
  if (mask & OV_BIT_AUDIO) o.audio = true;
  if (mask & OV_BIT_VSTAB) o.videoStabilization = vstabPresetFromId(r.readByte());
  if (mask & OV_BIT_VSTAB_DZ) o.videoStabilizationDynamicZoom = true;
  if (mask & OV_BIT_MINTERP_FPS_MUL) o.minterpFpsMultiplier = dequantizeCentipoint(r.readVaruint());
  if (mask & OV_BIT_LOOP) {
    const idx = r.readByte();
    o.loop = LOOP_ORDER[idx] ?? 'none';
  }
  if (mask & OV_BIT_FADE_DURATION) o.fadeDuration = dequantizeCentipoint(r.readVaruint());
  return o;
}

export function serializeBinary(payload: SharePayload): Uint8Array {
  const w = new ByteWriter();
  w.writeByte(SHARE_FORMAT_VERSION);

  const s = payload.settings;
  let sMask = 0;
  if (s.cropResWidth != null && s.cropResHeight != null) sMask |= SETTINGS_BIT_CROP_RES;
  if (s.titleSuffix) sMask |= SETTINGS_BIT_TITLE_SUFFIX;
  if (s.newMarkerSpeed != null && s.newMarkerSpeed !== 1) sMask |= SETTINGS_BIT_NEW_MARKER_SPEED;
  if (s.newMarkerCrop) sMask |= SETTINGS_BIT_NEW_MARKER_CROP;
  if (s.markerPairMergeList) sMask |= SETTINGS_BIT_MERGE_LIST;

  w.writeVaruint(sMask);
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

  w.writeVaruint(payload.markerPairs.length);

  let prevStart = 0;
  for (let i = 0; i < payload.markerPairs.length; i++) {
    const p = payload.markerPairs[i];
    let pMask = 0;
    if (p.speedMap && p.speedMap.length > 0) pMask |= PAIR_BIT_SPEED_MAP;
    if (p.cropMap && p.cropMap.length > 0) pMask |= PAIR_BIT_CROP_MAP;
    if (p.enableZoomPan === true) pMask |= PAIR_BIT_ZOOM_PAN;
    if (p.overrides && Object.keys(p.overrides).length > 0) pMask |= PAIR_BIT_OVERRIDES;
    w.writeVaruint(pMask);

    const startMs = quantizeTime(p.start);
    if (i === 0) {
      w.writeVaruint(startMs);
    } else {
      w.writeVarsint(startMs - prevStart);
    }
    prevStart = startMs;

    const durationMs = Math.max(0, quantizeTime(p.end) - startMs);
    w.writeVaruint(durationMs);
    w.writeVaruint(quantizeCentipoint(p.speed));
    writeCrop(w, p.crop);

    if (p.speedMap && p.speedMap.length > 0) writeSpeedMap(w, p.speedMap);
    if (p.cropMap && p.cropMap.length > 0) writeCropMap(w, p.cropMap);
    if (p.overrides && Object.keys(p.overrides).length > 0) writeOverrides(w, p.overrides);
  }

  return w.toUint8Array();
}

export function deserializeBinary(bytes: Uint8Array): SharePayload {
  const r = new ByteReader(bytes);
  const version = r.readByte();
  if (version !== SHARE_FORMAT_VERSION) {
    throw new UnsupportedShareVersionError(version);
  }

  const sMask = r.readVaruint();
  const settings: ShareableSettings = {};
  if (sMask & SETTINGS_BIT_CROP_RES) {
    settings.cropResWidth = r.readVaruint();
    settings.cropResHeight = r.readVaruint();
  }
  if (sMask & SETTINGS_BIT_TITLE_SUFFIX) settings.titleSuffix = r.readStr();
  if (sMask & SETTINGS_BIT_NEW_MARKER_SPEED) {
    settings.newMarkerSpeed = dequantizeCentipoint(r.readVaruint());
  }
  if (sMask & SETTINGS_BIT_NEW_MARKER_CROP) settings.newMarkerCrop = readCrop(r);
  if (sMask & SETTINGS_BIT_MERGE_LIST) settings.markerPairMergeList = r.readStr();

  const pairCount = r.readVaruint();
  if (pairCount > MAX_PAIR_COUNT) {
    throw new ShareFormatLimitError(
      `share-format: pair count ${pairCount} exceeds limit ${MAX_PAIR_COUNT}`
    );
  }
  const markerPairs: ShareablePair[] = [];
  let prevStart = 0;
  for (let i = 0; i < pairCount; i++) {
    const pMask = r.readVaruint();
    const startMs = i === 0 ? r.readVaruint() : prevStart + r.readVarsint();
    prevStart = startMs;
    const durationMs = r.readVaruint();
    const speed = dequantizeCentipoint(r.readVaruint());
    const crop = readCrop(r);

    const pair: ShareablePair = {
      start: dequantizeTime(startMs),
      end: dequantizeTime(startMs + durationMs),
      speed,
      crop,
    };
    if (pMask & PAIR_BIT_ZOOM_PAN) pair.enableZoomPan = true;
    if (pMask & PAIR_BIT_SPEED_MAP) pair.speedMap = readSpeedMap(r);
    if (pMask & PAIR_BIT_CROP_MAP) pair.cropMap = readCropMap(r);
    if (pMask & PAIR_BIT_OVERRIDES) pair.overrides = readOverrides(r);
    markerPairs.push(pair);
  }

  return { settings, markerPairs };
}

export class UnsupportedShareVersionError extends Error {
  constructor(public readonly version: number) {
    super(`Unsupported share format version: ${version}`);
    this.name = 'UnsupportedShareVersionError';
  }
}
