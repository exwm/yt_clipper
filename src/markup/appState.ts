import { MarkerPair, Settings } from './@types/yt_clipper';
import { VideoPlatformHooks } from './platforms/platforms';

export interface AppState {
  player: HTMLElement;
  video: HTMLVideoElement;
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
};
