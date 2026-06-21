// BANNER GUARD
// ==UserScript==
// BANNER GUARD
// @locale       english
// @name         yt_clipper
// @version      5.47.0
// @version      5.47.0
// @description  Mark up YouTube videos and quickly generate clipped webms.
// @author       elwm
// @namespace    https://github.com/exwm
// @homepage     https://github.com/exwm/yt_clipper
// @supportURL   https://github.com/exwm/yt_clipper/issues
// @downloadURL  https://update.greasyfork.org/scripts/543460/yt_clipper.user.js
// @updateURL    https://update.greasyfork.org/scripts/543460/yt_clipper.meta.js
// @icon         https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/pepe-clipper.gif
// @license      MIT
// @require      https://cdn.jsdelivr.net/npm/jszip@3.4.0/dist/jszip.min.js
// @require      https://cdn.jsdelivr.net/gh/exwm/Chart.js@141fe542034bc127b0a932de25d0c4f351f3bce1/dist/Chart.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js
// @require      https://cdn.jsdelivr.net/gh/exwm/chartjs-plugin-zoom@b1adf6115d5816cabf0d82fba87950a32f7f965e/dist/chartjs-plugin-zoom.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@0.7.0/dist/chartjs-plugin-datalabels.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-style@0.5.0/dist/chartjs-plugin-style.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@0.5.7/chartjs-plugin-annotation.min.js
// @run-at       document-end
// @match        http*://*.youtube.com/*
// @match        http*://*.vlive.tv/video/*
// @match        http*://*.vlive.tv/post/*
// @match        http*://weverse.io/*
// @match        https*://tv.naver.com/*
// @match        https*://*.afreecatv.com/*
// @match        https*://exwm.github.io/yt_clipper/*

// @noframes
// dummy grant to enable sandboxing
// @grant         GM_getValue
// BANNER GUARD
// ==/UserScript==
// BANNER GUARD

import { readFileSync } from 'fs';
import { enableAllPlugins as immerEnableAllPlugins } from 'immer';
import { flattenVRVideo } from './actions/misc';
import { featureFlags } from './feature-flags';
import { disableCommonBlockers, enableCommonBlockers } from './platforms/blockers/common';
import { disableYTBlockers, enableYTBlockers } from './platforms/blockers/youtube';
import {
  getPlatform,
  getVideoPlatformHooks,
  videoPlatformDataRecords,
  VideoPlatforms,
} from './platforms/platforms';
import './ui/chart/chart.js-drag-data-plugin';
import { addChartPoint } from './ui/chart/chartutil';
import {
  blockEvent,
  copyToClipboard,
  flashMessage,
  injectCSS,
  observeVideoElementChange,
  seekBySafe,
  setFlashMessageHook,
} from './util/util';
import { toggleCropPreview } from './crop/crop-preview';
import { CommandPalette, HotkeyEngine, ShortcutRegistry } from '../command-palette';
import { createShortcutDefinitions } from './shortcut-definitions';
import { appState, VideoElement, YTPlayer } from './appState';
import { captureFrame, saveCapturedFrames } from './frame-capture';
import { rotateVideo, toggleBigVideoPreviews, refreshRotatedVideoCSS } from './video-rotation';
import { toggleGammaPreview, toggleFadeLoopPreview, toggleAllPreviews } from './preview-toggles';
import {
  toggleMarkerPairSpeedPreview,
  toggleMarkerPairLoop,
  cycleForceSetSpeedValueDown,
  toggleForceSetSpeed,
  updateAllMarkerPairSpeeds,
} from './speed';
import {
  saveMarkersAndSettings,
  getClipperInputJSON,
  toggleMarkersDataCommands,
  copyShareableUrl,
  tryLoadSharedMarkers,
} from './save-load';
import { updateAllMarkerPairCrops } from './crop-utils';
import { toggleGlobalSettingsEditor } from './features/settings/global-settings-editor';
import { resolvePlayerAndVideo } from './bootstrap';
import { startNavigationWatcher } from './navigation';
import { isStaleVideo } from './platforms/navigation';
import {
  addCropHoverListener,
  addCropMouseManipulationListener,
  cycleCropDimOpacity,
  drawCrop,
  removeCropHoverListener,
  resizeCropOverlay,
  toggleCropCrossHair,
} from './crop-overlay';
import {
  addMarker,
  deleteMarkerPair,
  duplicateSelectedMarkerPair,
  getActiveStartMarker,
  getActiveEndMarker,
  initMarkersContainer,
  jumpToNearestMarkerOrPair,
  loopMarkerPair,
  moveMarker,
  moveMarkerByFrameHandler,
  redoMarker,
  togglePrevSelectedMarkerPair,
  undoMarker,
  undoRedoMarkerPairChange,
} from './markers';
import {
  chartState,
  getCurrentCropComponents,
  inheritCropPointCrop,
  initChartHooks,
  renderSpeedAndCropUI,
  selectCropPointWithMouseWheel,
  toggleChart,
  toggleChartLoop,
  toggleCropChartLooping,
} from './charts';
import { installLitUrlSanitizer } from './util/url-sanitizer';
import { addScrubVideoHandler, getFPS } from './util/videoUtil';
import { mountHintsBar, setHintsBarEnabled, toggleHintsBar } from './features/hints-bar/hints-bar';
import {
  HoveredRegion,
  registerHoverRegion,
  setHoveredRegion,
} from './features/hints-bar/hover-region';
import { cropManipulationKind, isMouseInsideCrop, isMouseManipulatingCrop } from './crop-overlay';
import { initVideoZoom, toggleReframe, toggleZoomMinimap } from './crop/video-zoom-controller';
import { resetViewport } from './crop/video-zoom-state';
import {
  arrowKeyCropAdjustmentEnabled,
  hideCommandPaletteToggleButton,
  hideHintsBarToggleButton,
  injectToggleCommandPaletteButton,
  injectToggleHintsBarButton,
  showCommandPaletteToggleButton,
  showHintsBarToggleButton,
  toggleArrowKeyCropAdjustment,
  toggleMarkerPairOverridesEditor,
  toggleShortcutsTable,
} from './features/settings/settings-editor';
import {
  placeSettingsToggleBar,
  refreshSettingsBar,
  toggleAutoHideUnselectedMarkerPairs,
} from './features/settings/marker-settings-editor';

const ytClipperCSS = readFileSync(__dirname + '/ui/css/yt-clipper.css', 'utf8');
export const shortcutsTableStyle = readFileSync(
  __dirname + '/ui/shortcuts-table/shortcuts-table.css',
  'utf8'
);

export const platform = getPlatform();
export const selectors = videoPlatformDataRecords[platform].selectors;

void loadytClipper();

async function loadytClipper() {
  console.log('Loading yt_clipper markup script...');
  await resolvePlayerAndVideo();
  appState.isReady = true;
  startNavigationWatcher();
}

export let initOnceCalled = false;
function initOnce() {
  if (initOnceCalled) return;
  initOnceCalled = true;
  init();
}

function init() {
  //immer
  immerEnableAllPlugins();

  // Install lit-html URL sanitizer as defense-in-depth against dangerous URL
  // schemes (javascript:/data:/vbscript:) in template bindings. Must run
  // before any render() call — lit-html captures the factory at template
  // instantiation time.
  installLitUrlSanitizer();

  //yt-clipper
  injectCSS(ytClipperCSS, 'yt-clipper-css');
  injectCSS(videoPlatformDataRecords[platform].css, 'platform-css');
  initHooks();
  initVideoInfo();
  initObservers();
  initMarkersContainer();
  initChartHooks();
  addForeignEventListeners();
  // Order matters: the command-palette button must be injected first so
  // the hints-bar injection can position itself directly afterend of it
  // (see injectToggleHintsBarButton). The left-to-right result is
  // [command palette] [hints bar] across every platform.
  injectToggleCommandPaletteButton();
  injectToggleHintsBarButton();
  addCropMouseManipulationListener();
  // Reframe crop-preview controller: zoom CSS, the navigator minimap, the resize observer that
  // re-syncs the reframe viewport, and the Ctrl+wheel reframe crop-zoom listener.
  initVideoZoom();
  addScrubVideoHandler();
  loopMarkerPair();
}

export let shortcutRegistry: ShortcutRegistry | null = null;
let hotkeyEngine: HotkeyEngine | null = null;
export let commandPalette: CommandPalette | null = null;

export function initShortcutSystem() {
  if (shortcutRegistry) return;
  shortcutRegistry = new ShortcutRegistry();
  shortcutRegistry.registerAll(
    createShortcutDefinitions({
      showShortcutsReference: () => {
        toggleShortcutsTable();
      },
      addMarker: () => {
        // During an active crop manipulation (pan-drag OR resize) with
        // the crop chart visible, plain `A` reroutes to "add crop
        // point" so the user can drop keyframes one-handed without
        // involving Alt — Alt + A still works globally but mixes
        // awkwardly with the Alt-Y pan lock during pan-drag. Outside
        // this context, `A` is its usual "add marker" hotkey.
        if (
          isMouseManipulatingCrop &&
          cropManipulationKind != null &&
          appState.isCurrentChartVisible &&
          chartState.currentChartInput?.type === 'crop'
        ) {
          addChartPoint();
        } else {
          addMarker();
        }
      },
      moveMarkerToCurrentTime: (which) => {
        const marker = which === 'start' ? getActiveStartMarker() : getActiveEndMarker();
        if (marker) moveMarker(marker);
      },
      addChartPoint: () => {
        addChartPoint();
      },
      duplicateSelectedMarkerPair: () => {
        duplicateSelectedMarkerPair();
      },
      saveMarkersAndSettings: () => {
        saveMarkersAndSettings();
      },
      copyMarkersToClipboard: () => {
        copyToClipboard(getClipperInputJSON());
      },
      copyShareableUrl: () => {
        void copyShareableUrl();
      },
      toggleForceSetSpeed: () => {
        toggleForceSetSpeed();
      },
      cycleForceSetSpeedValueDown: () => {
        cycleForceSetSpeedValueDown();
      },
      updateAllMarkerPairSpeedsToDefault: () => {
        updateAllMarkerPairSpeeds(appState.settings.newMarkerSpeed, renderSpeedAndCropUI);
      },
      captureFrame: () => captureFrame(),
      saveCapturedFrames: () => {
        saveCapturedFrames();
      },
      toggleGlobalSettingsEditor: () => {
        toggleGlobalSettingsEditor();
      },
      toggleMarkerPairOverridesEditor: () => {
        toggleMarkerPairOverridesEditor();
        refreshSettingsBar();
        placeSettingsToggleBar();
      },
      toggleMarkerPairSpeedPreview: () => {
        toggleMarkerPairSpeedPreview();
        refreshSettingsBar();
      },
      toggleMarkerPairLoop: () => {
        toggleMarkerPairLoop();
        refreshSettingsBar();
      },
      toggleGammaPreview: () => {
        toggleGammaPreview();
        refreshSettingsBar();
      },
      toggleFadeLoopPreview: () => {
        toggleFadeLoopPreview();
      },
      toggleCropChartLooping: () => {
        toggleCropChartLooping();
      },
      toggleAllPreviews: () => {
        toggleAllPreviews();
        refreshSettingsBar();
      },
      toggleMarkersDataCommands: () => {
        toggleMarkersDataCommands();
      },
      toggleSpeedChart: () => {
        toggleChart(chartState.speedChartInput);
        refreshSettingsBar();
      },
      toggleChartLoop: () => {
        toggleChartLoop();
      },
      toggleCropChart: () => {
        toggleChart(chartState.cropChartInput);
        refreshSettingsBar();
      },
      undoMarker: () => {
        undoMarker();
      },
      redoMarker: () => {
        redoMarker();
      },
      undoMarkerPairChange: () => {
        undoRedoMarkerPairChange('undo');
      },
      redoMarkerPairChange: () => {
        undoRedoMarkerPairChange('redo');
      },
      deleteMarkerPair: () => {
        deleteMarkerPair();
      },
      drawCrop: () => {
        drawCrop();
      },
      toggleArrowKeyCropAdjustment: () => {
        toggleArrowKeyCropAdjustment();
      },
      updateAllMarkerPairCropsToDefault: () => {
        updateAllMarkerPairCrops(appState.settings.newMarkerCrop);
      },
      cycleCropDimOpacity: () => {
        cycleCropDimOpacity();
        refreshSettingsBar();
      },
      toggleCropCrossHair: () => {
        toggleCropCrossHair();
        refreshSettingsBar();
      },
      toggleReframe: () => {
        toggleReframe(getCurrentCropComponents());
        refreshSettingsBar();
      },
      toggleZoomMinimap: () => {
        toggleZoomMinimap();
      },
      toggleCropPreviewModal: () => {
        toggleCropPreview('modal');
        refreshSettingsBar();
      },
      toggleCropPreviewPopOut: () => {
        toggleCropPreview('pop-out');
        refreshSettingsBar();
      },
      rotateVideoClock: () => {
        rotateVideo('clock');
        refreshSettingsBar();
      },
      rotateVideoCClock: () => {
        rotateVideo('cclock');
        refreshSettingsBar();
      },
      toggleBigVideoPreviews: () => {
        toggleBigVideoPreviews();
      },
      flashNotTheatreMode: () => {
        flashMessage('Please switch to theater mode to rotate video.', 'red');
      },
      flattenVRVideo: () => {
        flattenVRVideo(appState.hooks.videoContainer as HTMLDivElement, appState.video);
      },
      jumpToNearestMarkerOrPair: (e) => {
        jumpToNearestMarkerOrPair(e, e.code);
      },
      togglePrevSelectedMarkerPair: () => {
        togglePrevSelectedMarkerPair();
      },
      toggleAutoHideUnselectedMarkerPairs: (e) => {
        toggleAutoHideUnselectedMarkerPairs(e);
      },
      toggleHintsBar: () => {
        toggleHintsBar();
      },

      isMarkerHotkeysEnabled: () => appState.markerHotkeysEnabled,
      isTheatreMode: () => isTheatreMode(),
      isArrowKeyCropAdjustmentDisabled: () => !arrowKeyCropAdjustmentEnabled,
      hasMarkerPairs: () => appState.markerPairs.length > 0,
      isInCropManipulationWithCropChart: () =>
        isMouseManipulatingCrop &&
        cropManipulationKind != null &&
        appState.isCurrentChartVisible &&
        chartState.currentChartInput?.type === 'crop',
    })
  );

  hotkeyEngine = new HotkeyEngine(shortcutRegistry);
  hotkeyEngine.setBlocker((e) => {
    blockEvent(e);
  });
  hotkeyEngine.setEnabled(appState.isHotkeysEnabled);

  mountHintsBar(shortcutRegistry);

  let wasPausedBeforeOpen = false;
  commandPalette = new CommandPalette(shortcutRegistry, {
    zIndex: 99999,
    onOpenReference: () => {
      toggleShortcutsTable();
    },
    onOpen: () => {
      wasPausedBeforeOpen = appState.video.paused;
      if (!wasPausedBeforeOpen) appState.video.pause();
    },
    onClose: () => {
      if (!wasPausedBeforeOpen) void appState.video.play();
    },
  });
}

function hotkeys(e: KeyboardEvent) {
  if (!appState.isReady) {
    console.log('yt_clipper not yet ready to process hotkeys.');
    return;
  }

  if (!e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyA') {
    if (isStaleVideo) {
      flashMessage(
        'Video changed since yt_clipper loaded. Reload the page to continue clipping.',
        'red'
      );
      return;
    }
    appState.isHotkeysEnabled = !appState.isHotkeysEnabled;
    initOnce();
    initShortcutSystem();
    hotkeyEngine?.setEnabled(appState.isHotkeysEnabled);
    if (appState.isHotkeysEnabled) {
      showCommandPaletteToggleButton();
      showHintsBarToggleButton();
      setHintsBarEnabled(true);
      enableCommonBlockers();
      if (platform === VideoPlatforms.youtube) {
        enableYTBlockers();
      }
      flashMessage('Enabled Hotkeys', 'green');
      if (featureFlags.shareLink) void tryLoadSharedMarkers();
    } else {
      hideCommandPaletteToggleButton();
      hideHintsBarToggleButton();
      setHintsBarEnabled(false);
      disableCommonBlockers();
      if (platform === VideoPlatforms.youtube) {
        disableYTBlockers();
      }
      flashMessage('Disabled Hotkeys', 'red');
    }
    return;
  }

  if (!appState.isHotkeysEnabled) return;

  if (!e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyE') {
    blockEvent(e);
    commandPalette?.toggle();
    return;
  }

  if (commandPalette?.isOpen()) return;

  hotkeyEngine?.dispatch(e);
}

function addEventListeners() {
  document.addEventListener('keydown', hotkeys, true);
  document.addEventListener('keydown', addCropHoverListener, true);
  document.addEventListener('keyup', removeCropHoverListener, true);
  document.body.addEventListener('wheel', mouseWheelFrameSkipHandler);
  document.body.addEventListener('mousedown', changeMouseWheelFrameSkipRateHandler);

  document.body.addEventListener('wheel', moveMarkerByFrameHandler);
  document.body.addEventListener('wheel', selectCropPointWithMouseWheel, { passive: false });
  document.body.addEventListener('wheel', inheritCropPointCrop, { passive: false });
}

function initHooks() {
  appState.hooks = getVideoPlatformHooks(selectors);
  setFlashMessageHook(appState.hooks.flashMessage);
  updateSettingsEditorHook();
  appState.hooks.progressBar.removeAttribute('draggable');
  attachVideoHoverDetector(appState.hooks.cropMouseManipulation);
  registerHoverRegion(appState.hooks.progressBar, 'progress-bar');
}

/** Custom hover detector for the video area: distinguishes "inside the crop
 *  rectangle" (region: 'crop') from "elsewhere on the video" (region:
 *  'video') so the hints bar can scope crop-manipulation chips precisely. */
function attachVideoHoverDetector(el: HTMLElement): void {
  let inside = false;
  let currentRegion: HoveredRegion = null;
  const sync = (next: HoveredRegion): void => {
    if (next === currentRegion) return;
    currentRegion = next;
    setHoveredRegion(next);
  };
  el.addEventListener('mouseenter', () => {
    inside = true;
  });
  el.addEventListener('mouseleave', () => {
    inside = false;
    sync(null);
  });
  el.addEventListener('mousemove', (e) => {
    if (!inside) return;
    const overCrop = appState.isCropOverlayVisible && isMouseInsideCrop(e.clientX, e.clientY);
    sync(overCrop ? 'crop' : 'video');
  });
}

export function isTheatreMode() {
  if (platform === VideoPlatforms.youtube) {
    return (appState.hooks.theaterModeIndicator as any).theater;
  } else if (platform === VideoPlatforms.yt_clipper) {
    return true;
  }
}

function applyVideoAspectRatio(videoWidth: number, videoHeight: number) {
  appState.videoInfo.aspectRatio = videoWidth / videoHeight;
  appState.videoInfo.isVerticalVideo = appState.videoInfo.aspectRatio <= 1;
}

// Re-read the video's intrinsic dimensions and update the stored aspect ratio.
// Returns whether the aspect ratio actually changed. Guards against the 0
// dimensions reported before a newly navigated video's metadata has loaded.
function refreshVideoDimensions(): boolean {
  const { videoWidth, videoHeight } = appState.video;
  if (!videoWidth || !videoHeight) return false;
  if (videoWidth / videoHeight === appState.videoInfo.aspectRatio) return false;
  applyVideoAspectRatio(videoWidth, videoHeight);
  return true;
}

// The host (e.g. YouTube) reuses the same <video> element across SPA
// navigation and fires a 'resize' event when the new video's intrinsic
// dimensions differ. Refresh the aspect ratio and re-fit the (possibly
// rotated) video + crop overlay so a portrait<->landscape change doesn't
// leave the video mis-sized. yt_clipper stays locked to the originally
// loaded video — the stale-video banner still tells the user to navigate
// back to avoid losing in-progress work; this only keeps the rendering sane.
function handleVideoDimensionsChange() {
  if (!refreshVideoDimensions()) return;
  // A new video loaded into the reused element — clear any editor zoom so we
  // don't carry a stale focal point onto a different frame.
  resetViewport();
  if (appState.rotation !== 0) refreshRotatedVideoCSS();
  resizeCropOverlay();
}

function initVideoInfo() {
  applyVideoAspectRatio(appState.video.videoWidth, appState.video.videoHeight);
  const url = window.location.origin + window.location.pathname;
  appState.videoInfo.videoUrl = url;
  appState.videoInfo.fps = getFPS();

  appState.video.seekTo = (time) => (appState.video.currentTime = time);
  appState.video.getCurrentTime = () => {
    return appState.video.currentTime;
  };

  if (platform === VideoPlatforms.youtube) {
    const playerData = (appState.player as YTPlayer).getVideoData();
    appState.videoInfo.id = playerData.video_id;
    appState.videoInfo.videoUrl += '?v=' + appState.videoInfo.id;
    appState.videoInfo.title = playerData.title;

    appState.video.seekTo = (time) => {
      (appState.player as YTPlayer).seekTo(time);
    };
  } else if (platform === VideoPlatforms.vlive) {
    const location = window.location;

    const preloadedState = (unsafeWindow as any).__PRELOADED_STATE__;
    const videoParams = preloadedState?.postDetail?.post?.officialVideo;
    appState.videoInfo.id = videoParams?.videoSeq;
    appState.videoInfo.title = videoParams?.title;
    if (location.pathname.includes('video')) {
      appState.videoInfo.id ??= location.pathname.split('/')[2];
      appState.videoInfo.title ??= document.querySelector('[class*="video_title"]')?.textContent;
    }
  } else if (platform === VideoPlatforms.naver_tv) {
    appState.videoInfo.id = location.pathname.split('/')[2];
    appState.videoInfo.title = document.querySelector(
      'h2[class*=ArticleSection_article_title]'
    )?.textContent;
  } else if (platform === VideoPlatforms.weverse) {
    appState.videoInfo.title = document.querySelector('h2[class*=TitleView_title]')?.textContent;

    if (location.pathname.includes('media') || location.pathname.includes('live')) {
      appState.videoInfo.id ??= location.pathname.split('/')[3];
    }
  } else if (platform === VideoPlatforms.yt_clipper) {
    appState.videoInfo.id = 'unknown';
    const videoTile = document.querySelector('#ytc-video-title');
    appState.videoInfo.title = videoTile?.textContent;
  } else if (platform === VideoPlatforms.afreecatv) {
    appState.videoInfo.id = location.pathname.split('/')[2];
    appState.videoInfo.title = document.querySelector('div[class~=broadcast_title]')?.textContent;

    appState.video.getCurrentTime = () => {
      return (unsafeWindow as any).vodCore.playerController._playingTime;
    };

    appState.video.seekTo = (time) => {
      (unsafeWindow as any).vodCore.seek(time);
    };
  }

  if (appState.videoInfo.id == null) {
    flashMessage('Could not get video ID.', 'red');
    throw new Error('Could not get video ID.');
  }
}

function initObservers() {
  new ResizeObserver(resizeCropOverlay).observe(appState.hooks.videoContainer);
  // Refresh the aspect ratio when the (reused) video element's intrinsic
  // dimensions change, e.g. SPA navigation to a portrait vs landscape video.
  appState.video.addEventListener('resize', handleVideoDimensionsChange);

  if (platform === VideoPlatforms.afreecatv) {
    observeVideoElementChange(appState.hooks.videoContainer, (addedNodes: NodeList) => {
      appState.video = addedNodes[0] as unknown as VideoElement;
      appState.video.classList.add('yt-clipper-video');
      initVideoInfo();
    });
  }
}

export function updateSettingsEditorHook() {
  if (isTheatreMode()) {
    appState.settingsEditorHook = appState.hooks.settingsEditorTheater;
  } else {
    appState.settingsEditorHook = appState.hooks.settingsEditor;
  }
}
addEventListeners();

let mouseWheelFrameSkipRate = 1;
function mouseWheelFrameSkipHandler(event: WheelEvent) {
  if (
    appState.isHotkeysEnabled &&
    !event.ctrlKey &&
    !event.altKey &&
    event.shiftKey &&
    Math.abs(event.deltaY) > 0
  ) {
    const fps = getFPS();
    if (event.deltaY < 0) {
      seekBySafe(appState.video, mouseWheelFrameSkipRate / fps);
    } else if (event.deltaY > 0) {
      seekBySafe(appState.video, -mouseWheelFrameSkipRate / fps);
    }
  }
}

function changeMouseWheelFrameSkipRateHandler(event: MouseEvent) {
  if (
    appState.isHotkeysEnabled &&
    !event.ctrlKey &&
    !event.altKey &&
    event.shiftKey &&
    event.button == 1
  ) {
    event.preventDefault();
    mouseWheelFrameSkipRate += 1;
    if (mouseWheelFrameSkipRate > 4) mouseWheelFrameSkipRate = 1;
    flashMessage(`Mouse wheel frame skip rate set to ${mouseWheelFrameSkipRate}`, 'green');
  }
}

function addForeignEventListeners() {
  const selectors = ['input[type="text"', 'textarea'];
  selectors.forEach((selector) => {
    const inputs = document.querySelectorAll(selector);
    for (const input of Array.from(inputs)) {
      if (appState.isHotkeysEnabled) {
        input.addEventListener('focus', () => (appState.isHotkeysEnabled = false), {
          capture: true,
        });
        input.addEventListener('blur', () => (appState.isHotkeysEnabled = true), {
          capture: true,
        });
      }
    }
  });
}
