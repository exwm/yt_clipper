import { querySelectors } from '../util/util';

export enum VideoPlatforms {
  youtube = 'youtube',
  vlive = 'vlive',
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
  cropMouseManipulation: T;
  speedChartContainer: T;
  cropChartContainer: T;
  markerNumberingsDiv: T;
  controls: T;
  controlsGradient: T;
  shortcutsTableButton: T;
  playerClickZone: T;
};

type VideoPlatformSelectors = VideoPlatform<string>;
export type VideoPlatformHooks = VideoPlatform<HTMLElement>;
export function getVideoPlatformSelectors(platform: VideoPlatforms) {
  let selectors: VideoPlatformSelectors;
  if (platform === VideoPlatforms.youtube) {
    selectors = {
      playerContainer: '#ytd-player #container',
      player: '#movie_player',
      videoContainer: '#ytd-player #container',
      video: 'video',
      markersDiv: '.ytp-progress-bar',
      theaterModeIndicator: 'ytd-watch-flexy',
      progressBar: '.ytp-progress-bar',
      settingsEditor: '#info-contents',
      settingsEditorTheater: '#player-wide-container',
      shortcutsTable: '#info-contents',
      frameCapturerProgressBar: '#info-contents',
      flashMessage: '#info-contents',
      cropOverlay: '.html5-video-container',
      cropMouseManipulation: '.html5-video-container',
      speedChartContainer: '.html5-video-container',
      cropChartContainer: '#columns',
      markerNumberingsDiv: '.ytp-chrome-bottom',
      controls: '.ytp-chrome-bottom',
      controlsGradient: '.ytp-gradient-bottom',
      shortcutsTableButton: '.ytp-right-controls',
      playerClickZone: '.html5-video-container',
    };
  } else if (platform === VideoPlatforms.vlive) {
    selectors = {
      playerContainer: 'div[class*=player_area]',
      player: 'div[id$="videoArea"]',
      videoContainer: 'div[id$="videoArea"]',
      video: 'video',
      progressBar: '.u_rmc_progress_bar',
      markersDiv: '.u_rmc_progress_bar',
      theaterModeIndicator: 'placeholder',
      settingsEditor: 'div[class*=player_area]',
      settingsEditorTheater: 'div[class*=player_area]',
      shortcutsTable: '[class*="video_title"]',
      frameCapturerProgressBar: '[class*="video_title"]',
      flashMessage: '[class*="video_title"]',
      cropOverlay: 'div[id$="videoArea"]',
      cropMouseManipulation: '._click_zone[data-video-overlay]',
      speedChartContainer: '._click_zone[data-video-overlay]',
      cropChartContainer: '[class*="video_title"]',
      markerNumberingsDiv: '.u_rmc_progress_bar_container',
      controls: '.u_rmcplayer_control',
      controlsGradient: '.u_rmcplayer_control_bg._click_zone',
      shortcutsTableButton: 'div[class*=video_content]',
      playerClickZone: '._click_zone[data-video-overlay]',
    };
  }
  return selectors;
}

export function getVideoPlatformHooks(selectors: VideoPlatformSelectors): VideoPlatformHooks {
  return querySelectors(selectors);
}

export function getPlatform() {
  const host = window.location.hostname;
  if (host.includes('youtube')) {
    return VideoPlatforms.youtube;
  } else if (host.includes('vlive')) {
    return VideoPlatforms.vlive;
  } else {
    return VideoPlatforms.youtube;
  }
}
