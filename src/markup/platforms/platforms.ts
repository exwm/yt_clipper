import { querySelectors } from '../util/util';
import { readFileSync } from 'fs';

const youtubeCSS: string = '';
const vliveCSS: string = readFileSync(__dirname + '/css/vlive.css', 'utf8');
const naver_tvCSS: string = readFileSync(__dirname + '/css/naver_tv.css', 'utf8');
const weverseCSS: string = readFileSync(__dirname + '/css/weverse.css', 'utf8');
const afreecatvCSS: string = readFileSync(__dirname + '/css/afreecatv.css', 'utf8');
const ytclipperCSS: string = readFileSync(__dirname + '/css/yt_clipper.css', 'utf8');

export enum VideoPlatforms {
  youtube = 'youtube',
  vlive = 'vlive',
  weverse = 'weverse',
  naver_tv = 'naver_tv',
  afreecatv = 'afreecatv',
  yt_clipper = 'ytc_generic',
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

export function getVideoPlatformHooks(selectors: VideoPlatformSelectors): VideoPlatformHooks {
  return querySelectors(selectors);
}

export function getPlatform() {
  const host = window.location.hostname;
  if (host.includes('youtube')) {
    return VideoPlatforms.youtube;
  } else if (host.includes('vlive')) {
    return VideoPlatforms.vlive;
  } else if (host.includes('weverse')) {
    return VideoPlatforms.weverse;
  } else if (host.includes('tv.naver')) {
    return VideoPlatforms.naver_tv;
  } else if (host.includes('afreecatv.com')) {
    return VideoPlatforms.afreecatv;
  } else if (
    host.includes('exwm.github.io') ||
    host.includes('127.0.0.1') ||
    host.includes('localhost')
  ) {
    return VideoPlatforms.yt_clipper;
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

const naver_tvSelectors = {
  playerContainer: 'div[class=webplayer-internal-source-shadow]',
  player: 'div[class=webplayer-internal-source-wrapper]',
  playerClickZone: '.webplayer-internal-source-wrapper',
  videoContainer: 'div[class=webplayer-internal-source-wrapper]',
  video: 'video',
  progressBar: '.pzp-pc__progress-slider',
  markersDiv: '.pzp-ui-slider__wrap',
  markerNumberingsDiv: '.pzp-ui-slider__wrap',
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

const afreecaPlayerItemListSelector = 'div[class~=player_item_list]';
const afreecatvSelectors = {
  playerContainer: 'div[class~=htmlplayer_wrap]',
  player: 'div[id=afreecatv_player]',
  playerClickZone: 'div[id=afreecatv_player]',
  videoContainer: 'div[id=videoLayer]',
  video: 'video[id=video]',
  progressBar: 'div[class~=progress_track]',
  markersDiv: 'div[class~=progress_track]',
  markerNumberingsDiv: 'div[class~=progress_track]',
  theaterModeIndicator: 'placeholder',
  settingsEditor: afreecaPlayerItemListSelector,
  settingsEditorTheater: afreecaPlayerItemListSelector,
  shortcutsTable: afreecaPlayerItemListSelector,
  frameCapturerProgressBar: afreecaPlayerItemListSelector,
  flashMessage: afreecaPlayerItemListSelector,
  cropOverlay: 'div[id=afreecatv_player]',
  cropMouseManipulation: 'div[id=afreecatv_player]',
  speedChartContainer: 'div[id=videoLayer]',
  cropChartContainer: afreecaPlayerItemListSelector,
  controls: 'div[class~=ctrl]',
  controlsGradient: 'div[class~=ctrl]',
  shortcutsTableButton: 'div[class~=right_ctrl]',
};

const ytclipperSelectors = {
  playerContainer: 'div[id=ytc-media-player-container]',
  player: '#my-video',
  playerClickZone: 'div[id=ytc-media-player-container]',
  videoContainer: 'div[id=ytc-media-player-container]',
  video: 'video',
  progressBar: '.vjs-progress-control',
  markersDiv: '.vjs-progress-control',
  markerNumberingsDiv: '.vjs-progress-control',
  theaterModeIndicator: 'placeholder',
  settingsEditor: '#ytc-editor',
  settingsEditorTheater: '#ytc-editor',
  shortcutsTable: '#ytc-editor',
  frameCapturerProgressBar: '#ytc-editor',
  flashMessage: '#ytc-editor',
  cropOverlay: '#my-video',
  cropMouseManipulation: '#my-video',
  speedChartContainer: 'video',
  cropChartContainer: '#ytc-editor',
  controls: '.vjs-control-bar',
  controlsGradient: '.vjs-control-bar',
  shortcutsTableButton: '.vjs-fullscreen-control',
};

interface videoPlatformData {
  selectors: VideoPlatformSelectors;
  css: string;
}

const youtubeData: videoPlatformData = {
  selectors: youtubeSelectors,
  css: youtubeCSS,
};

const vliveData: videoPlatformData = {
  selectors: vliveSelectors,
  css: vliveCSS,
};

const weverseData: videoPlatformData = {
  selectors: weverseSelectors,
  css: weverseCSS,
};

const naver_tvData: videoPlatformData = {
  selectors: naver_tvSelectors,
  css: naver_tvCSS,
};

const afreecaData: videoPlatformData = {
  selectors: afreecatvSelectors,
  css: afreecatvCSS,
};

const ytclipperData: videoPlatformData = {
  selectors: ytclipperSelectors,
  css: ytclipperCSS,
};

export const videoPlatformDataRecords: Record<VideoPlatforms, videoPlatformData> = {
  [VideoPlatforms.youtube]: youtubeData,
  [VideoPlatforms.weverse]: weverseData,
  [VideoPlatforms.vlive]: vliveData,
  [VideoPlatforms.naver_tv]: naver_tvData,
  [VideoPlatforms.afreecatv]: afreecaData,
  [VideoPlatforms.yt_clipper]: ytclipperData,
};
