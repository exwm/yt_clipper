import { CropPoint, Denoise, VideoStabilization } from '../@types/yt_clipper';
import { presetsMap } from '../features/settings/presets';
import {
  DENOISE_PRESET_ORDER,
  LOOP_ORDER,
  SharePayload,
  ShareablePair,
  VSTAB_PRESET_ORDER,
  dequantizeCentipoint,
  dequantizeTime,
  quantizeCentipoint,
  quantizeTime,
} from './share-format';

function qTime(s: number): number {
  return dequantizeTime(quantizeTime(s));
}
function qCenti(v: number): number {
  return dequantizeCentipoint(quantizeCentipoint(v));
}

function canonicalizeOverrides(
  o: ShareablePair['overrides']
): ShareablePair['overrides'] | undefined {
  if (!o) return undefined;
  const c: NonNullable<ShareablePair['overrides']> = {};
  if (o.titlePrefix != null) c.titlePrefix = o.titlePrefix;
  if (o.enableHDR === true) c.enableHDR = true;
  if (o.gamma != null) c.gamma = qCenti(o.gamma);
  if (o.encodeSpeed != null) c.encodeSpeed = qCenti(o.encodeSpeed);
  if (o.crf != null) c.crf = Math.floor(o.crf);
  if (o.targetMaxBitrate != null) c.targetMaxBitrate = Math.floor(o.targetMaxBitrate);
  if (o.twoPass === true) c.twoPass = true;
  if (o.denoise != null) {
    const key = DENOISE_PRESET_ORDER.includes(
      o.denoise.desc as (typeof DENOISE_PRESET_ORDER)[number]
    )
      ? (o.denoise.desc as (typeof DENOISE_PRESET_ORDER)[number])
      : DENOISE_PRESET_ORDER[0];
    c.denoise = { ...presetsMap.denoise[key] } as Denoise;
  }
  if (o.audio === true) c.audio = true;
  if (o.videoStabilization != null) {
    const key = VSTAB_PRESET_ORDER.includes(
      o.videoStabilization.desc as (typeof VSTAB_PRESET_ORDER)[number]
    )
      ? (o.videoStabilization.desc as (typeof VSTAB_PRESET_ORDER)[number])
      : VSTAB_PRESET_ORDER[0];
    c.videoStabilization = { ...presetsMap.videoStabilization[key] } as VideoStabilization;
  }
  if (o.videoStabilizationDynamicZoom === true) c.videoStabilizationDynamicZoom = true;
  if (o.minterpFpsMultiplier != null) c.minterpFpsMultiplier = qCenti(o.minterpFpsMultiplier);
  if (o.loop != null) c.loop = LOOP_ORDER.includes(o.loop) ? o.loop : 'none';
  if (o.fadeDuration != null) c.fadeDuration = qCenti(o.fadeDuration);
  return Object.keys(c).length > 0 ? c : undefined;
}

export function canonicalizeSharePayload(p: SharePayload): SharePayload {
  const s = p.settings;
  const settings: SharePayload['settings'] = {};
  if (s.cropResWidth != null && s.cropResHeight != null) {
    settings.cropResWidth = Math.floor(s.cropResWidth);
    settings.cropResHeight = Math.floor(s.cropResHeight);
  }
  if (s.titleSuffix) settings.titleSuffix = s.titleSuffix;
  if (s.newMarkerSpeed != null && s.newMarkerSpeed !== 1) {
    settings.newMarkerSpeed = qCenti(s.newMarkerSpeed);
  }
  if (s.newMarkerCrop) settings.newMarkerCrop = s.newMarkerCrop;
  if (s.markerPairMergeList) settings.markerPairMergeList = s.markerPairMergeList;

  const markerPairs: ShareablePair[] = p.markerPairs.map((pair) => {
    const out: ShareablePair = {
      start: qTime(pair.start),
      end: qTime(pair.end),
      speed: qCenti(pair.speed),
      crop: pair.crop,
    };
    if (pair.enableZoomPan === true) out.enableZoomPan = true;
    if (pair.speedMap && pair.speedMap.length > 0) {
      out.speedMap = pair.speedMap.map((pt) => ({ x: qTime(pt.x), y: qCenti(pt.y) }));
    }
    if (pair.cropMap && pair.cropMap.length > 0) {
      out.cropMap = pair.cropMap.map((pt) => {
        const cp: CropPoint = { x: qTime(pt.x), y: 0, crop: pt.crop };
        if (pt.easeIn === 'instant') cp.easeIn = 'instant';
        return cp;
      });
    }
    const ov = canonicalizeOverrides(pair.overrides);
    if (ov) out.overrides = ov;
    return out;
  });

  return { settings, markerPairs };
}

const DEFAULT_CROP = '0:0:iw:ih';

export const minimalFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [
    { start: 1.234, end: 5.678, speed: 1, crop: DEFAULT_CROP },
    { start: 10, end: 20, speed: 0.5, crop: '100:50:1720:980' },
  ],
};

export const variableSpeedFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [
    { start: 0, end: 5, speed: 1, crop: DEFAULT_CROP },
    {
      start: 6,
      end: 16,
      speed: 1,
      crop: DEFAULT_CROP,
      speedMap: [
        { x: 6.0, y: 1.0 },
        { x: 8.5, y: 0.5 },
        { x: 10.0, y: 1.0 },
        { x: 13.0, y: 0.25 },
        { x: 16.0, y: 1.0 },
      ],
    },
    { start: 20, end: 25, speed: 1, crop: DEFAULT_CROP },
  ],
};

export const variableCropFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [
    { start: 0, end: 5, speed: 1, crop: DEFAULT_CROP },
    {
      start: 10,
      end: 30,
      speed: 1,
      crop: '0:0:960:540',
      cropMap: [
        { x: 10, y: 0, crop: '0:0:960:540' },
        { x: 15, y: 0, crop: '480:270:960:540', easeIn: 'instant' },
        { x: 22, y: 0, crop: '960:540:960:540' },
        { x: 30, y: 0, crop: '0:0:1920:1080' },
      ],
    },
  ],
};

export const zoomPanFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [
    {
      start: 3.14,
      end: 9.42,
      speed: 1,
      crop: '0:0:480:270',
      enableZoomPan: true,
    },
  ],
};

export const kitchenSinkFixture: SharePayload = {
  settings: {
    cropResWidth: 1920,
    cropResHeight: 1080,
    titleSuffix: 'everything-set',
    newMarkerSpeed: 0.75,
    newMarkerCrop: '10:10:iw:ih',
    markerPairMergeList: '1-2,3',
  },
  markerPairs: [
    {
      start: 0.5,
      end: 10.5,
      speed: 0.5,
      crop: DEFAULT_CROP,
      overrides: {
        titlePrefix: 'prefix-ünicöde',
        enableHDR: true,
        gamma: 1.25,
        encodeSpeed: 2,
        crf: 23,
        targetMaxBitrate: 4500,
        twoPass: true,
        denoise: { ...presetsMap.denoise.Medium },
        audio: true,
        videoStabilization: { ...presetsMap.videoStabilization.Strong },
        videoStabilizationDynamicZoom: true,
        minterpFpsMultiplier: 2,
        loop: 'fade',
        fadeDuration: 0.5,
      },
    },
  ],
};

export const unicodeTitleFixture: SharePayload = {
  settings: {
    cropResWidth: 1920,
    cropResHeight: 1080,
    titleSuffix: 'clip – 日本 🎬',
  },
  markerPairs: [{ start: 0, end: 1, speed: 1, crop: DEFAULT_CROP }],
};

export const boundaryFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [
    { start: 0, end: 0.001, speed: 0.05, crop: '0:0:1:1' },
    { start: 3600, end: 3600.001, speed: 4, crop: '0:0:iw:ih' },
  ],
};

export const manyPairsFixture: SharePayload = (() => {
  const pairs: ShareablePair[] = [];
  for (let i = 0; i < 50; i++) {
    pairs.push({
      start: i * 10,
      end: i * 10 + 5,
      speed: 1,
      crop: DEFAULT_CROP,
    });
  }
  return { settings: { cropResWidth: 1920, cropResHeight: 1080 }, markerPairs: pairs };
})();

export const emptyFixture: SharePayload = {
  settings: { cropResWidth: 1920, cropResHeight: 1080 },
  markerPairs: [],
};
