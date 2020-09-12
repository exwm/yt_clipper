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
  minterpMode?: string | boolean;
  minterpFPS?: number;
  loop?: Loop;
  fadeDuration?: number;
}

interface MarkerPair {
  start: number;
  end: number;
  speed: number;
  speedMap: SpeedPoint[];
  speedChartLoop: ChartLoop;
  crop: string;
  cropMap: CropPoint[];
  cropChartLoop: ChartLoop;
  enableZoomPan: boolean;
  cropRes: string;
  outputDuration: number;
  overrides: MarkerPairOverrides;
  startNumbering: SVGTextElement;
  endNumbering: SVGTextElement;
  undoredo: { history: MarkerPairHistory[]; index: number };
}

interface MarkerPairHistory {
  start: number;
  end: number;
  speed: number;
  speedMap: SpeedPoint[];
  crop: string;
  cropMap: CropPoint[];
  enableZoomPan: boolean;
  cropRes: string;
}

interface MarkerConfig {
  time?: number;
  type?: 'start' | 'end';
  speed?: number;
  speedMap?: SpeedPoint[];
  speedChartLoop?: ChartLoop;
  crop?: string;
  cropMap?: CropPoint[];
  cropChartLoop?: ChartLoop;
  enableZoomPan?: boolean;
  overrides?: MarkerPairOverrides;
  outputDuration?: number;
  startNumbering?: SVGTextElement;
  endNumbering?: SVGTextElement;
  undoredo?: { history: any[]; index: number };
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
