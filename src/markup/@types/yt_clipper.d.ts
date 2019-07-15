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
  enableSpeedMaps?: boolean;
}

interface MarkerPair {
  start: number;
  end: number;
  crop: string;
  speed: number;
  speedMap: SpeedPoint[];
  speedMapLoop: SpeedMapLoop;
  overrides: MarkerPairOverrides;
}

interface MarkerConfig {
  time?: number;
  type?: 'start' | 'end';
  speed?: number;
  speedMap?: SpeedPoint[];
  speedMapLoop?: SpeedMapLoop;
  crop?: string;
  overrides?: MarkerPairOverrides;
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
  enableSpeedMaps?: boolean;
}

interface SpeedMapLoop {
  start?: number;
  end?: number;
  enabled: boolean;
}
interface VideoStabilization {
  enabled: boolean;
  shakiness: number;
  desc: string;
}

interface Denoise {
  enabled: boolean;
  lumaSpatial: number;
  desc: string;
}

interface SpeedPoint {
  x: number;
  y: number;
}
