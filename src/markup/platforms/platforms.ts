import { querySelectors } from '../util/util';

export enum VideoPlatforms {
  youtube = 'youtube',
  vlive = 'vlive',
  weverse = 'weverse',
  naver_now_watch = 'naver_now_watch',
}
type VideoPlatform<T extends string | HTMLElement> = {
  // Contains the video element, progress bars, and controls.
  playerContainer: T;
  // Contains the video element, progress bars, and controls. Is contained by playerContainer
  player: T;
  // Either playerContainer or player depending on platform.
  videoContainer: T;
  // The video element.
  video: T;
  // The progress bar container.
  progressBar: T;
  // Where markers should be injected. Typically the progress bar container selected by progressBar.
  markersDiv: T;
  // An element that indicates whether the player is in theater mode or not.  Currently only relevant for YouTube.
  theaterModeIndicator: T;
  // Where the settings editor should be injected. Typically the container below the video player that contains the video title.
  settingsEditor: T;
  // Where the settings editor should be injected in theater mode.
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

export function getVideoPlatformSelectors(platform: VideoPlatforms): VideoPlatformSelectors {
  if (platform === VideoPlatforms.youtube) {
    return youtubeSelectors;
  } else if (platform === VideoPlatforms.vlive) {
    return vliveSelectors;
  } else if (platform === VideoPlatforms.naver_now_watch) {
    return naver_now_watchSelectors;
  } else if (platform === VideoPlatforms.weverse) {
    return weverseSelectors;
  }
  return null;
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
  } else if (host.includes('now.naver')) {
    return VideoPlatforms.naver_now_watch;
  } else if (host.includes('weverse')) {
    return VideoPlatforms.weverse;
  } else {
    return VideoPlatforms.youtube;
  }
}

const youtubeSelectors: VideoPlatformSelectors = {
  playerContainer: '#ytd-player #container',
  player: '#movie_player',
  videoContainer: '#ytd-player #container',
  video: 'video',
  markersDiv: '.ytp-progress-bar',
  theaterModeIndicator: 'ytd-watch-flexy',
  progressBar: '.ytp-progress-bar',
  settingsEditor: '#below',
  settingsEditorTheater: '#full-bleed-container',
  shortcutsTable: '#below',
  frameCapturerProgressBar: '#below',
  flashMessage: '#below',
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

const vliveSelectors: VideoPlatformSelectors = {
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

const naver_now_watchSelectors = {
  playerContainer: 'div[class=webplayer-internal-source-shadow]',
  player: 'div[class=webplayer-internal-source-wrapper]',
  playerClickZone: '.webplayer-internal-source-wrapper',
  videoContainer: 'div[class=webplayer-internal-source-wrapper]',
  video: 'video',
  progressBar: '.pzp-pc__progress-slider',
  markersDiv: '.pzp-pc__progress-slider',
  markerNumberingsDiv: '.pzp-pc__progress-slider',
  theaterModeIndicator: 'placeholder',
  settingsEditor: 'div[class*=ArticleSection_article_section]',
  settingsEditorTheater: 'div[class*=ArticleSection_article_section]',
  shortcutsTable: 'div[class*=ArticleSection_article_section]',
  frameCapturerProgressBar: 'div[class*=ArticleSection_article_section]',
  flashMessage: 'div[class*=ArticleSection_article_section]',
  cropOverlay: '.webplayer-internal-source-wrapper',
  cropMouseManipulation: '.webplayer-internal-source-wrapper',
  speedChartContainer: '.webplayer-internal-video',
  cropChartContainer: 'div[class*=ArticleSection_article_section]',
  controls: '.pzp-pc__bottom',
  controlsGradient: '.pzp-pc__bottom-shadow',
  shortcutsTableButton: '.pzp-pc__bottom-buttons-right',
};

const weverseSelectors = {
  playerContainer: 'div[class=webplayer-internal-source-shadow]',
  player: 'div[class=webplayer-internal-source-wrapper]',
  playerClickZone: '.webplayer-internal-source-wrapper',
  videoContainer: 'div[class=webplayer-internal-source-wrapper]',
  video: 'video',
  progressBar: '.pzp-pc__progress-slider',
  markersDiv: '.pzp-pc__progress-slider',
  markerNumberingsDiv: '.pzp-pc__progress-slider',
  theaterModeIndicator: 'placeholder',
  settingsEditor: 'div[class*=HeaderView_container]',
  settingsEditorTheater: 'div[class*=HeaderView_container]',
  shortcutsTable: 'div[class*="HeaderView_container"]',
  frameCapturerProgressBar: 'div[class*="HeaderView_container"]',
  flashMessage: 'div[class*="HeaderView_container"]',
  cropOverlay: '.webplayer-internal-source-wrapper',
  cropMouseManipulation: '.webplayer-internal-source-wrapper',
  speedChartContainer: '.webplayer-internal-video',
  cropChartContainer: 'div[class*="HeaderView_container"]',
  controls: '.pzp-pc__bottom-buttons',
  controlsGradient: '.pzp-pc__bottom-buttons',
  shortcutsTableButton: '.pzp-pc__bottom-buttons-right',
};
