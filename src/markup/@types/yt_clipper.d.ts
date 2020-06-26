import { ChartConfiguration } from 'chart.js';

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
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  enableSpeedMaps?: boolean;
  minterpMode?: string | boolean;
  minterpFPS?: number;
  loop?: Loop;
  fadeDuration?: number;
}

interface MarkerPair {
  start: number;
  end: number;
  crop: string;
  speed: number;
  overrides: MarkerPairOverrides;
  speedChartLoop: ChartLoop;
  cropChartLoop: ChartLoop;
  speedMap: SpeedPoint[];
  cropMap: CropPoint[];
  outputDuration: number;
  startNumbering: SVGTextElement;
  endNumbering: SVGTextElement;
  moveHistory: { undos: markerMoveRecord[]; redos: markerMoveRecord[] };
}
interface markerMoveRecord {
  marker: SVGRectElement;
  fromTime: number;
  toTime: number;
}

interface MarkerConfig {
  time?: number;
  type?: 'start' | 'end';
  speed?: number;
  overrides?: MarkerPairOverrides;
  speedChartLoop?: ChartLoop;
  cropChartLoop?: ChartLoop;
  speedMap?: SpeedPoint[];
  crop?: string;
  cropMap?: CropPoint[];
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
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  enableSpeedMaps?: boolean;
  minterpMode?: string | boolean;
  minterpFPS?: number;
  loop?: Loop;
  fadeDuration?: number;
}

interface ChartLoop {
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
interface CropPoint {
  x: number;
  y: 0;
  crop: string;
  prevCrop?: string;
  initCrop?: string;
  easeIn?: 'instant';
}

interface ChartInput {
  chart: Chart;
  type: 'speed' | 'crop';
  chartContainer: HTMLDivElement;
  chartContainerId: string;
  chartContainerHook: HTMLElement;
  chartContainerHookPosition: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';
  chartContainerStyle: string;
  chartCanvasHTML: string;
  chartCanvasId: string;
  chartSpec: ChartConfiguration;
  minBound: number;
  maxBound: number;
  chartLoopKey: 'speedChartLoop' | 'cropChartLoop';
  dataMapKey: 'speedMap' | 'cropMap';
}
