import { ChartConfiguration } from 'chart.js';

interface Settings {
  platform: string;
  videoID: string;
  videoTag: string;
  videoTitle: string;
  videoUrl: string;
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
  enableHDR?: boolean;
  gamma?: number;
  twoPass?: boolean;
  denoise?: Denoise;
  audio?: boolean;
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  // minterpMode?: string | boolean;
  // minterpFPS?: number;
  minterpFpsMultiplier?: number;
  loop?: Loop;
  fadeDuration?: number;
  cropPointEasing?: 'smoothInOut' | 'smoothTrack' | 'cinematic';
  // Cinematic-mode margins: how far the L1 path may drift from the keyframed crop. Position margin
  // in cropRes px (x, y); zoom margin as a fraction of the keyframed size (w, h). Larger = steadier.
  cropPointEasingCinematicMargin?: number;
  cropPointEasingCinematicZoomMargin?: number;
  // How still Cinematic easing holds the crop at hold points.
  cropPointEasingCinematicHolds?: 'loose' | 'firm' | 'exact';
}

interface MarkerPair {
  start: TimelineTime;
  end: TimelineTime;
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
  start: TimelineTime;
  end: TimelineTime;
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
  cropPointEasing?: 'smoothInOut' | 'smoothTrack' | 'cinematic';
  // Cinematic-mode margins: how far the L1 path may drift from the keyframed crop. Position margin
  // in cropRes px (x, y); zoom margin as a fraction of the keyframed size (w, h). Larger = steadier.
  cropPointEasingCinematicMargin?: number;
  cropPointEasingCinematicZoomMargin?: number;
  cropPointEasingCinematicHolds?: 'loose' | 'firm' | 'exact';
  enableHDR?: boolean;
  gamma?: number;
  encodeSpeed?: number;
  crf?: number;
  targetMaxBitrate?: number;
  twoPass?: boolean;
  denoise?: Denoise;
  audio?: boolean;
  videoStabilization?: VideoStabilization;
  videoStabilizationDynamicZoom?: boolean;
  // minterpMode?: string | boolean;
  // minterpFPS?: number;
  minterpFpsMultiplier?: number;
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
  x: TimelineTime;
  y: number;
}
interface CropPoint {
  x: TimelineTime;
  y: 0;
  crop: string;
  easeIn?: 'instant';
  // Shows the crop of the point before it: `crop-point-holds.ts` keeps `crop` equal to that crop.
  hold?: true;
  // A hold point's own crop, which it gets back when released.
  ownCrop?: string;
  // A Firm hold point, set only in the Cinematic solve's copy of the crop map (never saved).
  firmHold?: true;
}

// One piece of a solved cinematic path. Each crop component is a quadratic in local time
// u = (t - startT): value(u) = c0 + c1*u + c2*u^2, in cropRes pixels. Segments tile [0, duration]
// contiguously with no gaps, so the rendered crop is continuous.
interface CropPathSegment {
  startT: number;
  endT: number;
  x: [number, number, number];
  y: [number, number, number];
  w: [number, number, number];
  h: [number, number, number];
}

interface CropPath {
  // CINEMATIC_SOLVER_VERSION when solved.
  version: number;
  // The margins the path was solved with (cropRes px for pos, fraction for zoom), echoed for the UI.
  margin: { pos: number; zoom: number };
  // Hash of the cropMap + margins it was solved from; a mismatch means the path is stale.
  signature: string;
  segments: CropPathSegment[];
  // The range the solver kept the crop center in, per grid sample (clip-relative seconds), in cropRes
  // px. Only the markup's Cinematic plot reads it.
  centerBounds?: CropPathCenterBounds;
}

interface CropPathCenterBounds {
  t: number[];
  xLow: number[];
  xHigh: number[];
  yLow: number[];
  yHigh: number[];
  // The range the solver kept the crop width in, which the zoom margin sets.
  wLow: number[];
  wHigh: number[];
}

interface ChartInput {
  chart: Chart | null;
  type: 'speed' | 'crop';
  chartContainer: HTMLDivElement | null;
  chartContainerId: string;
  chartContainerHook: HTMLElement | null;
  chartContainerHookPosition: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';
  chartContainerStyle: string;
  chartCanvasTemplate: import('lit-html').TemplateResult;
  chartCanvasId: string;
  chartSpec: ChartConfiguration;
  minBound: number;
  maxBound: number;
  chartLoopKey: 'speedChartLoop' | 'cropChartLoop';
  dataMapKey: 'speedMap' | 'cropMap';
}

/** A time on the video timeline that means a frame: a marker, a crop or speed point. A plain number
 *  assigns to it, and the type follows the value through copies, so the lint rule against ordering
 *  these times with < or > (local/no-timeline-time-comparison) still sees it. */
type TimelineTime = number & { readonly __timelineTime?: true };
