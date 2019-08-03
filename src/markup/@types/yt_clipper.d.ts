interface Settings {
  videoID: string;
  videoTitle: string;
  newMarkerSpeed: number;
  newMarkerCrop: string;
  titleSuffix: string;
  isVerticalVideo: boolean;
  cropRes: string;
  cropResWidth: number;
  cropResHeight: number;
  markerPairMergeList: string;
  encodeSpeed?: number;
  crf?: number;
  targetMaxBitrate?: number;
  rotate?: '0' | 'clock' | 'cclock';
  gamma?: number;
  twoPass?: boolean;
  denoise?: Denoise;
  audio?: boolean;
  expandColorRange?: boolean;
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  enableSpeedMaps?: boolean;
  loop?: Loop;
  fadeDuration?: number;
}

interface MarkerPair {
  start: number;
  end: number;
  crop: string;
  speed: number;
  overrides: MarkerPairOverrides;
  speedMapLoop: SpeedMapLoop;
  speedMap: SpeedPoint[];
  outputDuration: number;
  startNumbering: SVGTextElement;
  endNumbering: SVGTextElement;
}

interface MarkerConfig {
  time?: number;
  type?: 'start' | 'end';
  speed?: number;
  overrides?: MarkerPairOverrides;
  speedMapLoop?: SpeedMapLoop;
  speedMap?: SpeedPoint[];
  crop?: string;
  outputDuration?: number;
  startNumbering?: SVGTextElement;
  endNumbering?: SVGTextElement;
}

interface MarkerPairOverrides {
  titlePrefix?: string;
  gamma?: number;
  encodeSpeed?: number;
  crf?: number;
  targetMaxBitrate?: number;
  twoPass?: boolean;
  denoise?: Denoise;
  audio?: boolean;
  expandColorRange?: boolean;
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  enableSpeedMaps?: boolean;
  loop?: Loop;
  fadeDuration?: number;
}

interface SpeedMapLoop {
  start?: number;
  end?: number;
  enabled: boolean;
}
interface VideoStabilization {
  desc: string;
  enabled: boolean;
  shakiness?: number;
  smoothing?: number;
}

type Loop = 'none' | 'fwrev' | 'fade';

interface Denoise {
  enabled: boolean;
  lumaSpatial: number;
  desc: string;
}

interface SpeedPoint {
  x: number;
  y: number;
}
