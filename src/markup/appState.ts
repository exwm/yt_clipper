import { MarkerPair, Settings } from './@types/yt_clipper';
import { VideoPlatformHooks } from './platforms/platforms';

export type VideoElement = HTMLVideoElement & {
  getCurrentTime: () => number;
  seekTo: (time: number) => void;
};

export interface YTPlayer extends HTMLElement {
  seekTo(time: number): void;
  getVideoData(): { video_id: string; title: string; [key: string]: any };
  getStatsForNerds(): { resolution: string; [key: string]: any };
  theater?: boolean;
}

export interface AppState {
  player: HTMLElement;
  video: VideoElement;
  hooks: VideoPlatformHooks;
  settingsEditorHook: HTMLElement;

  markersSvg: SVGSVGElement;
  markersDiv: HTMLDivElement;
  markerNumberingsDiv: HTMLDivElement;
  selectedMarkerPairOverlay: SVGSVGElement;
  startMarkerNumberings: SVGSVGElement;
  endMarkerNumberings: SVGSVGElement;
  prevSelectedEndMarker: SVGRectElement;

  markerPairs: MarkerPair[];
  markerPairsHistory: MarkerPair[];
  prevSelectedMarkerPairIndex: number;

  settings: Settings;
  videoInfo: Record<string, any>;
  rotation: number;
  startTime: number;

  isReady: boolean;
  isNextMarkerStart: boolean;
  isHotkeysEnabled: boolean;
  markerHotkeysEnabled: boolean;

  isSettingsEditorOpen: boolean;
  wasGlobalSettingsEditorOpen: boolean;

  isCropOverlayVisible: boolean;
  isCurrentChartVisible: boolean;
  isChartEnabled: boolean;
  isAutoHideUnselectedMarkerPairsOn: boolean;

  isGammaPreviewOn: boolean;
  isCropChartLoopingOn: boolean;
  isAllPreviewsOn: boolean;

  currentCropPointIndex: number;

  // Speed module shared state
  speedInputLabel: HTMLInputElement | null;
  minterpFpsMulLabelSpan: HTMLSpanElement | null;
  speedInput: HTMLInputElement | null;
  easingMode: 'linear' | 'cubicInOut';
  forceSetSpeedValue: number;
  isForceSetSpeedOn: boolean;

  cropInputLabel: HTMLInputElement | null;
  cropInput: HTMLInputElement | null;
  cropAspectRatioSpan: HTMLSpanElement | null;
  enableZoomPanInput: HTMLInputElement | null;
}

export const appState: AppState = {
  player: null as any,
  video: null as any,
  hooks: {} as VideoPlatformHooks,
  settingsEditorHook: null as any,

  markersSvg: null as any,
  markersDiv: null as any,
  markerNumberingsDiv: null as any,
  selectedMarkerPairOverlay: null as any,
  startMarkerNumberings: null as any,
  endMarkerNumberings: null as any,
  prevSelectedEndMarker: null as any,

  markerPairs: [],
  markerPairsHistory: [],
  prevSelectedMarkerPairIndex: null as any,

  settings: null as any,
  videoInfo: {},
  rotation: 0,
  startTime: 0.0,

  isReady: false,
  isNextMarkerStart: true,
  isHotkeysEnabled: false,
  markerHotkeysEnabled: false,

  isSettingsEditorOpen: false,
  wasGlobalSettingsEditorOpen: false,

  isCropOverlayVisible: false,
  isCurrentChartVisible: false,
  isChartEnabled: false,
  isAutoHideUnselectedMarkerPairsOn: false,

  isGammaPreviewOn: false,
  isCropChartLoopingOn: false,
  isAllPreviewsOn: false,

  currentCropPointIndex: 0,

  // Speed module shared state
  speedInputLabel: null,
  minterpFpsMulLabelSpan: null,
  speedInput: null,
  easingMode: 'linear',
  forceSetSpeedValue: 1,
  isForceSetSpeedOn: false,

  cropInputLabel: null,
  cropInput: null,
  cropAspectRatioSpan: null,
  enableZoomPanInput: null,
};
