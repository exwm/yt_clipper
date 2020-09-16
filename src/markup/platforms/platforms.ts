import { querySelectors } from '../util/util';

export enum VideoPlatforms {
  youtube,
}
type VideoPlatform<T extends string | HTMLElement> = {
  playerContainer: T;
  player: T;
  videoContainer: T;
  video: T;
  markersDiv: T;
  theaterModeIndicator: T;
  progressBar: T;
  settingsEditor: T;
  settingsEditorTheater: T;
  shortcutsTable: T;
  frameCapturerProgressBar: T;
  flashMessage: T;
  cropOverlay: T;
  speedChartContainer: T;
  cropChartContainer: T;
  markerNumberingsDiv: T;
  controls: T;
  controlsGradient: T;
};

type VideoPlatformSelectors = VideoPlatform<string>;
export type VideoPlatformHooks = VideoPlatform<HTMLElement>;
export function getVideoPlatformSelectors(platform: VideoPlatforms) {
  let selectors: VideoPlatformSelectors;
  if (platform === VideoPlatforms.youtube) {
    selectors = {
      playerContainer: '#ytd-player #container',
      player: '#movie_player',
      videoContainer: '.html5-video-container',
      video: 'video',
      markersDiv: '.ytp-progress-bar',
      theaterModeIndicator: 'ytd-watch-flexy',
      progressBar: '.ytp-progress-bar',
      settingsEditor: '#info-contents',
      settingsEditorTheater: '#player-theater-container',
      shortcutsTable: '#info-contents',
      frameCapturerProgressBar: '#info-contents',
      flashMessage: '#info-contents',
      cropOverlay: '.html5-video-container',
      speedChartContainer: '.html5-video-container',
      cropChartContainer: '#columns',
      markerNumberingsDiv: '.ytp-chrome-bottom',
      controls: '.ytp-chrome-bottom',
      controlsGradient: '.ytp-gradient-bottom',
    };
  }
  return selectors;
}

export function getVideoPlatformHooks(selectors: VideoPlatformSelectors): VideoPlatformHooks {
  return querySelectors(selectors);
}

export function getPlatform() {
  const host = window.location.hostname;
  if (host === 'www.youtube.com') {
    return VideoPlatforms.youtube;
  } else {
    return VideoPlatforms.youtube;
  }
}
