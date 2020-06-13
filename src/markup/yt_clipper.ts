// ==UserScript==
// @locale       english
// @name         yt_clipper
// @version      0.0.90-beta.3.9.0-alpha.1
// @description  Mark up YouTube videos and quickly generate clipped webms.
// @author       elwm
// @namespace    https://github.com/exwm
// @homepage     https://github.com/exwm/yt_clipper
// @supportURL   https://github.com/exwm/yt_clipper/issues
// @downloadURL  https://openuserjs.org/src/scripts/elwm/yt_clipper.user.js
// @updateURL    https://openuserjs.org/meta/elwm/yt_clipper.meta.js
// @icon         https://raw.githubusercontent.com/exwm/yt_clipper/master/assets/image/pepe-clipper.gif
// @require      https://cdn.jsdelivr.net/npm/jszip@3.4.0/dist/jszip.min.js
// @require      https://rawcdn.githack.com/exwm/Chart.js/141fe542034bc127b0a932de25d0c4f351f3bce1/dist/Chart.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@0.7.0/dist/chartjs-plugin-datalabels.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-style@latest/dist/chartjs-plugin-style.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js
// @require      https://gitcdn.xyz/repo/exwm/chartjs-plugin-zoom/master/dist/chartjs-plugin-zoom.min.js
// @require      https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@0.5.7/chartjs-plugin-annotation.min.js
// @run-at       document-end
// @license      MIT
// @match        *://*.youtube.com/*
// @noframes
// @grant        none
// ==/UserScript==

const __version__ = '0.0.90-beta.3.9.0-alpha.1';

import { Chart, ChartConfiguration } from 'chart.js';
import { html } from 'common-tags';
import { easeCubicInOut, easeSinInOut } from 'd3-ease';
import { saveAs } from 'file-saver';
import { readFileSync } from 'fs';
import JSZip from 'jszip';
import {
  ChartInput,
  ChartLoop,
  CropPoint,
  MarkerConfig,
  MarkerPair,
  MarkerPairOverrides,
  Settings,
  SpeedPoint,
} from './@types/yt_clipper';
import './components/chart/chart.js-drag-data-plugin';
import { cubicInOutTension, sortX } from './components/chart/chartutil';
import {
  cropChartMode,
  cropPointFormatter,
  cropPointXYFormatter,
  currentCropChartMode,
  currentCropChartSection,
  currentCropPointIndex,
  getCropChartConfig,
  setCurrentCropPoint,
} from './components/chart/cropchart/cropChartSpec';
import { scatterChartDefaults } from './components/chart/scatterChartSpec';
import { speedChartSpec } from './components/chart/speedchart/speedChartSpec';
import { Tooltips } from './tooltips';
import {
  bsearch,
  clampNumber,
  copyToClipboard,
  deleteElement,
  htmlToElement,
  htmlToSVGElement,
  injectCSS,
  once,
  retryUntilTruthyResult,
  roundValue,
  setAttributes,
  speedRounder,
  timeRounder,
  toHHMMSSTrimmed,
} from './util';
const ytClipperCSS = readFileSync(__dirname + '/css/yt-clipper.css', 'utf8');
const shortcutsTable = readFileSync(
  __dirname + '/components/shortcuts-table/shortcuts-table.html',
  'utf8'
);
const shortcutsTableStyle = readFileSync(
  __dirname + '/components/shortcuts-table/shortcuts-table.css',
  'utf8'
);
const shortcutsTableToggleButtonHTML = readFileSync(
  __dirname + '/components/shortcuts-table/shortcuts-table-toggle-button.html',
  'utf8'
);

export let player: HTMLElement;
export let isCropChartLoopingOn = false;

let shouldTriggerCropChartLoop = false;
export function triggerCropChartLoop() {
  shouldTriggerCropChartLoop = true;
}

(function () {
  'use strict';
  async function onLoadVideoPage(callback: Function) {
    const ytdapp = await retryUntilTruthyResult(
      () => document.getElementsByTagName('ytd-app')[0]
    );
    if (ytdapp.hasAttribute('is-watch-page')) {
      console.log('watch page loaded');
      callback();
      return;
    }
    const observer = new MutationObserver((mutationList) => {
      mutationList.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'is-watch-page' &&
          ytdapp.hasAttribute('is-watch-page')
        ) {
          console.log('watch page loaded');
          observer.disconnect();
          callback();
        }
      });
    });
    const config = { attributeFilter: ['is-watch-page'] };
    console.log(`Waiting for video page load before calling ${callback.name}`);
    observer.observe(ytdapp, config);
  }
  onLoadVideoPage(loadytClipper);

  async function loadytClipper() {
    console.log('Loading yt clipper markup script');

    document.addEventListener('keydown', hotkeys, true);

    function hotkeys(e: KeyboardEvent) {
      if (isHotkeysEnabled) {
        switch (e.code) {
          case 'KeyA':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              addMarker();
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey && markerHotkeysEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              moveMarker(enableMarkerHotkeys.endMarker);
            }
            break;
          case 'KeyS':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              saveMarkersAndSettings();
            } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              copyToClipboard(getSettingsJSON());
            }
            break;
          case 'KeyQ':
            if (!e.ctrlKey && !e.altKey && e.shiftKey && markerHotkeysEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              moveMarker(enableMarkerHotkeys.startMarker);
            } else if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleForceSetSpeed();
            } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              cycleForceSetSpeedValueDown();
            } else if (!e.ctrlKey && e.altKey && e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              updateAllMarkerPairSpeeds(settings.newMarkerSpeed);
            }
            break;
          case 'KeyE':
            if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              captureFrame();
            } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              saveCapturedFrames();
            }
            break;
          case 'KeyW':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleGlobalSettingsEditor();
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleMarkerPairOverridesEditor();
            }
            break;
          case 'KeyC':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleMarkerPairSpeedPreview();
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleMarkerPairLoop();
            } else if (!e.ctrlKey && !e.shiftKey && e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleGammaPreview();
            } else if (!e.ctrlKey && e.shiftKey && e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleFadeLoopPreview();
            } else if (e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleCropChartLooping();
            } else if (e.ctrlKey && e.shiftKey && e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleAllPreviews();
            }
            break;
          case 'KeyG':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              loadMarkers();
            }
            break;
          case 'KeyD':
            // alt+shift+D does not work in chrome 75.0.3770.100
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleChart(speedChartInput);
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleChartLoop();
            } else if (!e.ctrlKey && !e.shiftKey && e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleChart(cropChartInput);
            } else if (e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleCropChartPanOnly();
            }
            break;
          case 'KeyZ':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              undoMarker();
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              redoMarker();
            } else if (!e.ctrlKey && !e.shiftKey && e.altKey && markerHotkeysEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              undoMarkerMove();
            } else if (!e.ctrlKey && e.shiftKey && e.altKey && markerHotkeysEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              redoMarkerMove();
            } else if (e.ctrlKey && e.shiftKey && e.altKey && markerHotkeysEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              deleteMarkerPair();
            }
            break;
          case 'KeyX':
            if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              drawCropOverlay(false);
            } else if (!e.ctrlKey && !e.altKey && e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              drawCropOverlay(true);
            } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleArrowKeyCropAdjustment();
            } else if (!e.ctrlKey && e.altKey && e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              updateAllMarkerPairCrops(settings.newMarkerCrop);
            } else if (e.ctrlKey && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              cycleCropDimOpacity();
            }
            break;
          case 'KeyR':
            if (!e.ctrlKey && !e.shiftKey && !e.altKey && playerInfo.watchFlexy.theater) {
              e.preventDefault();
              e.stopImmediatePropagation();
              rotateVideo('clock');
            } else if (
              !e.ctrlKey &&
              !e.shiftKey &&
              e.altKey &&
              playerInfo.watchFlexy.theater
            ) {
              e.preventDefault();
              e.stopImmediatePropagation();
              rotateVideo('cclock');
            } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              toggleBigVideoPreviews();
            } else if (!e.ctrlKey && !e.shiftKey && !playerInfo.watchFlexy.theater) {
              e.preventDefault();
              e.stopImmediatePropagation();
              flashMessage('Please switch to theater mode to rotate video.', 'red');
            }
            break;
          case 'KeyF':
            if (!e.ctrlKey && e.shiftKey && !e.altKey) {
              e.preventDefault();
              e.stopImmediatePropagation();
              flattenVRVideo();
            }
            break;
          case 'ArrowLeft':
          case 'ArrowRight':
            jumpToNearestMarkerOrPair(e, e.code);
            break;
          case 'ArrowUp':
            if (e.ctrlKey && !arrowKeyCropAdjustmentEnabled) {
              e.preventDefault();
              e.stopImmediatePropagation();
              togglePrevSelectedMarkerPair();
            }
            break;
          case 'ArrowDown':
            toggleAutoHideUnselectedMarkerPairs(e);
            break;
        }
      }
      if (!e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyA') {
        isHotkeysEnabled = !isHotkeysEnabled;
        initOnce();
        if (isHotkeysEnabled) {
          showShortcutsTableToggleButton();
          enablePreventSideBarPull();
          enablePreventAltDefault();
          enablePreventMouseZoom();
          flashMessage('Enabled Hotkeys', 'green');
        } else {
          hideShortcutsTableToggleButton();
          disablePreventSideBarPull();
          disablePreventAltDefault();
          disablePreventMouseZoom();
          flashMessage('Disabled Hotkeys', 'red');
        }
      }
    }

    function enablePreventAltDefault() {
      window.addEventListener('keyup', preventAltDefaultHandler, true);
    }

    function disablePreventAltDefault() {
      window.removeEventListener('keyup', preventAltDefaultHandler, true);
    }

    function enablePreventSideBarPull() {
      const sideBar = document.getElementById('contentContainer');
      const sideBarContent = document.getElementById('guide-content');
      sideBarContent.style.pointerEvents = 'auto';
      if (sideBar != null) sideBar.style.pointerEvents = 'none';
    }
    function disablePreventSideBarPull() {
      const sideBar = document.getElementById('contentContainer');
      if (sideBar != null) sideBar.style.removeProperty('pointer-events');
    }

    function preventAltDefaultHandler(e: KeyboardEvent) {
      if (e.code === 'AltLeft' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
      }
    }

    function enablePreventMouseZoom() {
      window.addEventListener('mousewheel', stopWheelZoom, { passive: false });
      window.addEventListener('DOMMouseScroll', stopWheelZoom, { passive: false });
    }

    function disablePreventMouseZoom() {
      window.removeEventListener('mousewheel', stopWheelZoom);
      window.removeEventListener('DOMMouseScroll', stopWheelZoom);
    }

    function stopWheelZoom(e: MouseEvent) {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    }

    window.addEventListener('keydown', addCropOverlayHoverListener, true);

    window.addEventListener('keyup', removeCropOverlayHoverListener, true);

    function addCropOverlayHoverListener(e: KeyboardEvent) {
      const isCropBlockingChartVisible =
        isCurrentChartVisible && currentChartInput && currentChartInput.type !== 'crop';
      if (
        e.key === 'Control' &&
        isHotkeysEnabled &&
        !e.repeat &&
        isCropOverlayVisible &&
        !isDrawingCrop &&
        !isCropBlockingChartVisible
      ) {
        window.addEventListener('mousemove', cropOverlayHoverHandler, true);
      }
    }

    function removeCropOverlayHoverListener(e: KeyboardEvent) {
      if (e.key === 'Control') {
        window.removeEventListener('mousemove', cropOverlayHoverHandler, true);
        showPlayerControls();
        video.style.removeProperty('cursor');
      }
    }

    function cropOverlayHoverHandler(e) {
      if (isSettingsEditorOpen && isCropOverlayVisible && !isDrawingCrop) {
        updateCropHoverCursor(e);
      }
    }

    function updateCropHoverCursor(e) {
      const cursor = getMouseCropHoverRegion(e);

      if (cursor) {
        hidePlayerControls();
        video.style.cursor = cursor;
      } else {
        showPlayerControls();
        video.style.removeProperty('cursor');
      }
    }

    function togglePrevSelectedMarkerPair() {
      if (enableMarkerHotkeys.endMarker) {
        toggleMarkerPairEditor(enableMarkerHotkeys.endMarker);
      } else if (prevSelectedEndMarker) {
        toggleMarkerPairEditor(prevSelectedEndMarker);
      } else {
        const firstEndMarker = markersSvg.firstElementChild
          ? (markersSvg.firstElementChild.nextElementSibling as SVGRectElement)
          : null;
        if (firstEndMarker) toggleMarkerPairEditor(firstEndMarker);
      }
    }

    let start = true;
    let markerHotkeysEnabled = false;
    let isSettingsEditorOpen = false;
    let wasGlobalSettingsEditorOpen = false;
    let isCropOverlayVisible = false;
    let isCurrentChartVisible = false;

    let markerPairs: MarkerPair[] = [];
    let markerPairsHistory: MarkerPair[] = [];

    let startTime = 0.0;
    let isHotkeysEnabled = false;
    let prevSelectedEndMarker: SVGRectElement = null;
    let prevSelectedMarkerPairIndex: number = null;

    function init() {
      injectCSS(ytClipperCSS, 'yt-clipper-css');
      initPlayerInfo();
      initMarkersContainer();
      initChartHooks();
      addForeignEventListeners();
      injectToggleShortcutsTableButton();
      addCropOverlayDragListener();
    }

    function getMinWH() {
      const minWHMultiplier =
        Math.min(settings.cropResWidth, settings.cropResHeight) / 1080;
      const minW = Math.round(25 * minWHMultiplier);
      const minH = Math.round(25 * minWHMultiplier);
      return { minW, minH };
    }

    function getRelevantCropString() {
      if (!isSettingsEditorOpen) return null;
      if (!wasGlobalSettingsEditorOpen) {
        return markerPairs[prevSelectedMarkerPairIndex].cropMap[currentCropPointIndex]
          .crop;
      } else {
        return settings.newMarkerCrop;
      }
    }

    let isDraggingCrop = false;
    let endCropOverlayDrag: (e, forceEndDrag?: boolean) => void;

    function addCropOverlayDragListener() {
      video.addEventListener('pointerdown', cropOverlayDragHandler, {
        capture: true,
      });
      function cropOverlayDragHandler(e) {
        const isCropBlockingChartVisible =
          isCurrentChartVisible && currentChartInput && currentChartInput.type !== 'crop';
        if (
          e.ctrlKey &&
          isSettingsEditorOpen &&
          isCropOverlayVisible &&
          !isDrawingCrop &&
          !isCropBlockingChartVisible
        ) {
          const cropString = getRelevantCropString();
          const [ix, iy, iw, ih] = getCropComponents(cropString);
          if (!wasGlobalSettingsEditorOpen) {
            const markerPair = markerPairs[prevSelectedMarkerPairIndex];
            const cropMap = markerPair.cropMap;
            cropMap.forEach((cropPoint) => {
              cropPoint.initCrop = cropPoint.crop;
            });
          }

          const cropAspectRatio = iw / ih;
          const videoRect = player.getVideoContentRect();
          const playerRect = player.getBoundingClientRect();
          const clickPosX = e.pageX - videoRect.left - playerRect.left;
          const clickPosY = e.pageY - videoRect.top - playerRect.top;
          const cursor = getMouseCropHoverRegion(e, cropString);
          const pointerId = e.pointerId;

          endCropOverlayDrag = (e, forceEndDrag = false) => {
            if (forceEndDrag) {
              document.removeEventListener('pointerup', endCropOverlayDrag, {
                capture: true,
              });
            }
            isDraggingCrop = false;

            video.releasePointerCapture(pointerId);

            cropInput.dispatchEvent(new Event('change'));

            if (!wasGlobalSettingsEditorOpen) {
              const markerPair = markerPairs[prevSelectedMarkerPairIndex];
              const cropMap = markerPair.cropMap;
              cropMap.forEach((cropPoint) => {
                delete cropPoint.initCrop;
              });
            }

            cursor === 'grab'
              ? document.removeEventListener('pointermove', dragCropHandler)
              : document.removeEventListener('pointermove', resizeHandler);

            showPlayerControls();
            if (!forceEndDrag && e.ctrlKey) {
              if (cursor) video.style.cursor = cursor;
              updateCropHoverCursor(e);
              window.addEventListener('mousemove', cropOverlayHoverHandler, true);
            } else {
              video.style.removeProperty('cursor');
            }
            window.addEventListener('keyup', removeCropOverlayHoverListener, true);
            window.addEventListener('keydown', addCropOverlayHoverListener, true);
          };

          let resizeHandler;
          if (!cursor) {
            return;
          } else {
            document.addEventListener('click', blockVideoPause, {
              once: true,
              capture: true,
            });
            window.removeEventListener('mousemove', cropOverlayHoverHandler, true);
            window.removeEventListener('keydown', addCropOverlayHoverListener, true);
            window.removeEventListener('keyup', removeCropOverlayHoverListener, true);

            e.preventDefault();
            video.setPointerCapture(pointerId);

            if (cursor === 'grab') {
              video.style.cursor = 'grabbing';
              document.addEventListener('pointermove', dragCropHandler);
            } else {
              resizeHandler = (e: MouseEvent) => getResizeHandler(e, cursor);
              document.addEventListener('pointermove', resizeHandler);
            }

            document.addEventListener('pointerup', endCropOverlayDrag, {
              once: true,
              capture: true,
            });

            hidePlayerControls();
            isDraggingCrop = true;
          }

          function getResizeHandler(e, cursor) {
            const dragPosX = e.pageX - videoRect.left - playerRect.left;
            const changeX = dragPosX - clickPosX;
            let changeXScaled = (changeX / videoRect.width) * settings.cropResWidth;
            const dragPosY = e.pageY - videoRect.top - playerRect.top;
            const changeY = dragPosY - clickPosY;
            let changeYScaled = (changeY / videoRect.height) * settings.cropResHeight;
            const shouldMaintainCropAspectRatio = e.altKey || !isCropChartPanOnly;
            if (
              shouldMaintainCropAspectRatio &&
              ['ne-resize', 'se-resize', 'sw-resize', 'nw-resize'].includes(cursor)
            ) {
              if (Math.abs(changeXScaled) > Math.abs(changeYScaled)) {
                changeYScaled = changeXScaled / cropAspectRatio;
                if (['ne-resize', 'sw-resize'].includes(cursor))
                  changeYScaled = -changeYScaled;
              } else {
                changeXScaled = changeYScaled * cropAspectRatio;
                if (['ne-resize', 'sw-resize'].includes(cursor))
                  changeXScaled = -changeXScaled;
              }
            }

            let resizedDimensions;
            switch (cursor) {
              case 'n-resize':
                resizedDimensions = shouldMaintainCropAspectRatio
                  ? getResizeNE(-changeYScaled * cropAspectRatio, changeYScaled)
                  : getResizeN(changeYScaled);
                break;
              case 'ne-resize':
                resizedDimensions = getResizeNE(changeXScaled, changeYScaled);
                break;
              case 'e-resize':
                resizedDimensions = shouldMaintainCropAspectRatio
                  ? getResizeSE(changeXScaled, changeXScaled / cropAspectRatio)
                  : getResizeE(changeXScaled);
                break;
              case 'se-resize':
                resizedDimensions = getResizeSE(changeXScaled, changeYScaled);
                break;
              case 's-resize':
                resizedDimensions = shouldMaintainCropAspectRatio
                  ? getResizeSE(changeYScaled * cropAspectRatio, changeYScaled)
                  : getResizeS(changeYScaled);
                break;
              case 'sw-resize':
                resizedDimensions = getResizeSW(changeXScaled, changeYScaled);
                break;
              case 'w-resize':
                resizedDimensions = shouldMaintainCropAspectRatio
                  ? getResizeSW(changeXScaled, -changeXScaled / cropAspectRatio)
                  : getResizeW(changeXScaled);
                break;
              case 'nw-resize':
                resizedDimensions = getResizeNW(changeXScaled, changeYScaled);
                break;
            }

            const { resizedX, resizedY, resizedW, resizedH } = resizedDimensions;
            const optArgs = {
              ix,
              iy,
              iw,
              ih,
              minW: null,
              minH: null,
              updateCropChart: false,
            };
            updateCrop(resizedX, resizedY, resizedW, resizedH, optArgs);
          }

          function dragCropHandler(e) {
            const dragPosX = e.pageX - videoRect.left - playerRect.left;
            const dragPosY = e.pageY - videoRect.top - playerRect.top;
            const changeX = dragPosX - clickPosX;
            const changeY = dragPosY - clickPosY;
            let x = Math.round((changeX / videoRect.width) * settings.cropResWidth + ix);

            let y = Math.round(
              (changeY / videoRect.height) * settings.cropResHeight + iy
            );

            const optArgs = {
              ix,
              iy,
              iw,
              ih,
              minW: null,
              minH: null,
              updateCropChart: false,
            };

            const shouldMaintainCropX = e.shiftKey;
            const shouldMaintainCropY = e.altKey;
            if (shouldMaintainCropX) x = ix;
            if (shouldMaintainCropY) y = iy;

            updateCrop(x, y, iw, ih, optArgs);
          }

          function getResizeN(changeYScaled) {
            let Y = Math.round(iy + changeYScaled);
            let H = Math.round(ih - changeYScaled);

            return { resizedX: ix, resizedY: Y, resizedW: iw, resizedH: H };
          }

          function getResizeE(changeXScaled) {
            let W = Math.round(iw + changeXScaled);
            return { resizedX: ix, resizedY: iy, resizedW: W, resizedH: ih };
          }

          function getResizeS(changeYScaled) {
            let H = Math.round(ih + changeYScaled);
            return { resizedX: ix, resizedY: iy, resizedW: iw, resizedH: H };
          }
          function getResizeW(changeXScaled) {
            let X = Math.round(ix + changeXScaled);
            let W = Math.round(iw - changeXScaled);
            return { resizedX: X, resizedY: iy, resizedW: W, resizedH: ih };
          }
          function getResizeNE(changeXScaled, changeYScaled) {
            let Y = Math.round(iy + changeYScaled);
            let W = Math.round(iw + changeXScaled);
            let H = Math.round(ih - changeYScaled);

            return { resizedX: ix, resizedY: Y, resizedW: W, resizedH: H };
          }

          function getResizeSE(changeXScaled, changeYScaled) {
            let W = Math.round(iw + changeXScaled);
            let H = Math.round(ih + changeYScaled);
            return { resizedX: ix, resizedY: iy, resizedW: W, resizedH: H };
          }

          function getResizeSW(changeXScaled, changeYScaled) {
            let X = Math.round(ix + changeXScaled);
            let W = Math.round(iw - changeXScaled);
            let H = Math.round(ih + changeYScaled);
            return { resizedX: X, resizedY: iy, resizedW: W, resizedH: H };
          }

          function getResizeNW(changeXScaled, changeYScaled) {
            let X = Math.round(ix + changeXScaled);
            let W = Math.round(iw - changeXScaled);
            let Y = Math.round(iy + changeYScaled);
            let H = Math.round(ih - changeYScaled);
            return { resizedX: X, resizedY: Y, resizedW: W, resizedH: H };
          }
        }
      }
    }

    function getMouseCropHoverRegion(e: MouseEvent, cropString?: string) {
      cropString = cropString ?? getRelevantCropString();
      const [x, y, w, h] = getCropComponents(cropString);
      const videoRect = player.getVideoContentRect();
      const playerRect = player.getBoundingClientRect();
      const clickPosX = e.pageX - videoRect.left - playerRect.left;
      const clickPosY = e.pageY - videoRect.top - playerRect.top;
      const clickPosXScaled = (clickPosX / videoRect.width) * settings.cropResWidth;
      const clickPosYScaled = (clickPosY / videoRect.height) * settings.cropResHeight;

      const slMultiplier = Math.min(settings.cropResWidth, settings.cropResHeight) / 1080;
      const sl = Math.ceil(Math.min(w, h) * slMultiplier * 0.1);
      const edgeOffset = 30 * slMultiplier;
      let cursor: string;
      let mouseCropColumn: 1 | 2 | 3;
      if (x - edgeOffset < clickPosXScaled && clickPosXScaled < x + sl) {
        mouseCropColumn = 1;
      } else if (x + sl < clickPosXScaled && clickPosXScaled < x + w - sl) {
        mouseCropColumn = 2;
      } else if (x + w - sl < clickPosXScaled && clickPosXScaled < x + w + edgeOffset) {
        mouseCropColumn = 3;
      }
      let mouseCropRow: 1 | 2 | 3;
      if (y - edgeOffset < clickPosYScaled && clickPosYScaled < y + sl) {
        mouseCropRow = 1;
      } else if (y + sl < clickPosYScaled && clickPosYScaled < y + h - sl) {
        mouseCropRow = 2;
      } else if (y + h - sl < clickPosYScaled && clickPosYScaled < y + h + edgeOffset) {
        mouseCropRow = 3;
      }

      const isMouseInCropCenter = mouseCropColumn === 2 && mouseCropRow === 2;
      const isMouseInCropN = mouseCropColumn === 2 && mouseCropRow === 1;
      const isMouseInCropNE = mouseCropColumn === 3 && mouseCropRow === 1;
      const isMouseInCropE = mouseCropColumn === 3 && mouseCropRow === 2;
      const isMouseInCropSE = mouseCropColumn === 3 && mouseCropRow === 3;
      const isMouseInCropS = mouseCropColumn === 2 && mouseCropRow === 3;
      const isMouseInCropSW = mouseCropColumn === 1 && mouseCropRow === 3;
      const isMouseInCropW = mouseCropColumn === 1 && mouseCropRow === 2;
      const isMouseInCropNW = mouseCropColumn === 1 && mouseCropRow === 1;

      if (isMouseInCropCenter) cursor = 'grab';
      if (isMouseInCropN) cursor = 'n-resize';
      if (isMouseInCropNE) cursor = 'ne-resize';
      if (isMouseInCropE) cursor = 'e-resize';
      if (isMouseInCropSE) cursor = 'se-resize';
      if (isMouseInCropS) cursor = 's-resize';
      if (isMouseInCropSW) cursor = 'sw-resize';
      if (isMouseInCropW) cursor = 'w-resize';
      if (isMouseInCropNW) cursor = 'nw-resize';

      return cursor;
    }

    const initOnce = once(init, this);
    player = await retryUntilTruthyResult(() => document.getElementById('movie_player'));
    const playerInfo: { [index: string]: any } = {};
    const video = await retryUntilTruthyResult(
      () => document.getElementsByTagName('video')[0]
    );
    let settingsEditorHook: HTMLElement;
    let flashMessageHook: HTMLElement;
    let overlayHook: HTMLElement;
    function initPlayerInfo() {
      playerInfo.url = player.getVideoUrl();
      playerInfo.playerData = player.getVideoData();

      playerInfo.duration = player.getDuration();
      playerInfo.video = document.getElementsByTagName('video')[0];
      playerInfo.video.setAttribute('id', 'yt-clipper-video');
      playerInfo.aspectRatio = player.getVideoAspectRatio();
      playerInfo.isVerticalVideo = playerInfo.aspectRatio <= 1;
      playerInfo.progress_bar = document.getElementsByClassName('ytp-progress-bar')[0];
      playerInfo.progress_bar.removeAttribute('draggable');
      playerInfo.watchFlexy = document.getElementsByTagName('ytd-watch-flexy')[0];
      playerInfo.infoContents = document.getElementById('info-contents');
      flashMessageHook = playerInfo.infoContents;
      playerInfo.container = document.querySelector('#ytd-player #container');
      playerInfo.columns = document.getElementById('columns');
      playerInfo.playerTheaterContainer = document.getElementById(
        'player-theater-container'
      );
      updateSettingsEditorHook();
      playerInfo.annotations = document.getElementsByClassName('ytp-iv-video-content')[0];
      playerInfo.videoContainer = document.getElementsByClassName(
        'html5-video-container'
      )[0] as HTMLElement;
      overlayHook = playerInfo.videoContainer;
      playerInfo.controls = document.getElementsByClassName('ytp-chrome-bottom')[0];
      playerInfo.controlsBar = document.getElementsByClassName('ytp-chrome-controls')[0];
      playerInfo.progressBar = document.getElementsByClassName(
        'ytp-progress-bar-container'
      )[0];
      playerInfo.gradientBottom = document.getElementsByClassName(
        'ytp-gradient-bottom'
      )[0];
    }

    function updateSettingsEditorHook() {
      if (playerInfo.watchFlexy.theater) {
        settingsEditorHook = playerInfo.playerTheaterContainer;
      } else {
        settingsEditorHook = playerInfo.infoContents;
      }
    }

    document.body.addEventListener('wheel', mouseWheelFrameSkipHandler);
    function mouseWheelFrameSkipHandler(event: WheelEvent) {
      if (
        isHotkeysEnabled &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        Math.abs(event.deltaY) > 0
      ) {
        let fps = getFPS();
        if (event.deltaY < 0) {
          player.seekBy(1 / fps);
        } else if (event.deltaY > 0) {
          player.seekBy(-1 / fps);
        }
      }
    }

    document.body.addEventListener('wheel', moveMarkerByFrameHandler);
    function moveMarkerByFrameHandler(event: WheelEvent) {
      if (
        isHotkeysEnabled &&
        !event.ctrlKey &&
        event.altKey &&
        event.shiftKey &&
        Math.abs(event.deltaY) > 0 &&
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedEndMarker
      ) {
        const fps = getFPS();
        let targetMarker = prevSelectedEndMarker;
        const markerPair = markerPairs[prevSelectedMarkerPairIndex];
        let targetMarkerTime = markerPair.end;
        if (event.pageX < window.innerWidth / 2) {
          targetMarker = prevSelectedEndMarker.previousElementSibling as SVGRectElement;
          targetMarkerTime = markerPair.start;
        }

        let newMarkerTime: number;
        if (event.deltaY > 0) {
          newMarkerTime = targetMarkerTime - 1 / fps;
          moveMarker(targetMarker, Math.max(0, newMarkerTime));
        } else if (event.deltaY < 0) {
          newMarkerTime = targetMarkerTime + 1 / fps;
          moveMarker(targetMarker, Math.min(video.duration, newMarkerTime));
        }

        video.pause();
        player.seekTo(newMarkerTime);
      }
    }

    document.body.addEventListener('wheel', selectCropPoint, { passive: false });
    function selectCropPoint(event: WheelEvent) {
      if (isHotkeysEnabled && !event.ctrlKey && event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        return;
      }

      const cropChart = cropChartInput.chart;
      const cropChartData = cropChart.data.datasets[0].data;

      if (
        Math.abs(event.deltaY) > 0 &&
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedEndMarker &&
        cropChartInput.chart
      ) {
        if (event.deltaY < 0) {
          if (currentCropChartMode === cropChartMode.Start) {
            setCurrentCropPoint(cropChart, currentCropPointIndex + 1, cropChartMode.End);
          } else {
            setCurrentCropPoint(cropChart, currentCropPointIndex, cropChartMode.Start);
          }
        } else if (event.deltaY > 0) {
          if (currentCropChartMode === cropChartMode.End) {
            setCurrentCropPoint(
              cropChart,
              currentCropPointIndex - 1,
              cropChartMode.Start
            );
          } else {
            setCurrentCropPoint(cropChart, currentCropPointIndex, cropChartMode.End);
          }
        }
      }

      if (!isCropChartLoopingOn) {
        triggerCropChartLoop();
      }

      const cropPoint = cropChartData[currentCropPointIndex] as CropPoint;
      cropInput.value = cropPoint.crop;
      cropInput.dispatchEvent(new Event('change'));
      if (isCurrentChartVisible && currentChartInput.type === 'crop') {
        currentChartInput?.chart?.update();
      }
    }

    document.body.addEventListener('wheel', inheritCropPointCrop, { passive: false });
    function inheritCropPointCrop(event: WheelEvent) {
      if (
        isHotkeysEnabled &&
        event.ctrlKey &&
        event.altKey &&
        event.shiftKey &&
        Math.abs(event.deltaY) > 0 &&
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedEndMarker &&
        cropChartInput.chart
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const cropChart = cropChartInput.chart;
        const cropChartData = cropChart.data.datasets[0].data;
        const cropPoint = cropChartData[currentCropPointIndex] as CropPoint;
        const oldCropPointCrop = cropPoint.crop;
        if (event.deltaY < 0) {
          const nextCropPoint = cropChartData[
            Math.min(currentCropPointIndex + 1, cropChartData.length - 1)
          ] as CropPoint;
          cropPoint.crop = nextCropPoint.crop;
        } else if (event.deltaY > 0) {
          const prevCropPoint = cropChartData[
            Math.max(currentCropPointIndex - 1, 0)
          ] as CropPoint;
          cropPoint.crop = prevCropPoint.crop;
        }
        updateCropString(cropPoint.crop);
        if (
          isCurrentChartVisible &&
          currentChartInput.type === 'crop' &&
          oldCropPointCrop === cropPoint.crop
        ) {
          currentChartInput?.chart?.update();
        }
      }
    }

    let settings: Settings;
    let markersSvg: SVGSVGElement;
    let markersDiv: HTMLDivElement;
    let markerNumberingsDiv: HTMLDivElement;
    let selectedMarkerPairOverlay: SVGSVGElement;
    let startMarkerNumberings: SVGSVGElement;
    let endMarkerNumberings: SVGSVGElement;
    function initMarkersContainer() {
      settings = {
        videoID: playerInfo.playerData.video_id,
        videoTitle: playerInfo.playerData.title,
        newMarkerSpeed: 1.0,
        newMarkerCrop: '0:0:iw:ih',
        titleSuffix: `[${playerInfo.playerData.video_id}]`,
        isVerticalVideo: playerInfo.isVerticalVideo,
        cropRes: playerInfo.isVerticalVideo ? '1080x1920' : '1920x1080',
        cropResWidth: playerInfo.isVerticalVideo ? 1080 : 1920,
        cropResHeight: playerInfo.isVerticalVideo ? 1920 : 1080,
        markerPairMergeList: '',
      };
      markersDiv = document.createElement('div');
      markersDiv.setAttribute('id', 'markers-div');
      markersDiv.innerHTML = `\
        <svg id="markers-svg"></svg>
        <svg id="selected-marker-pair-overlay" style="display:none">
          <rect id="selected-start-marker-overlay"  class="selected-marker-overlay" width="1px" height="8px" y="3.5px" shape-rendering="crispEdges"></rect>
          <rect id="selected-end-marker-overlay"  class="selected-marker-overlay" width="1px" height="8px" y="3.5px" shape-rendering="crispEdges"></rect>
        </svg>
        <svg id="start-marker-numberings"></svg>
        <svg id="end-marker-numberings"></svg>
      `;
      playerInfo.progress_bar.appendChild(markersDiv);
      markersSvg = markersDiv.children[0] as SVGSVGElement;
      selectedMarkerPairOverlay = markersDiv.children[1] as SVGSVGElement;

      markerNumberingsDiv = document.createElement('div');
      markerNumberingsDiv.setAttribute('id', 'marker-numberings-div');
      markerNumberingsDiv.innerHTML = `\
        <svg id="start-marker-numberings"></svg>
        <svg id="end-marker-numberings"></svg>
      `;
      playerInfo.controls.appendChild(markerNumberingsDiv);
      startMarkerNumberings = markerNumberingsDiv.children[0] as SVGSVGElement;
      endMarkerNumberings = markerNumberingsDiv.children[1] as SVGSVGElement;
      playerInfo.fps = getFPS();
    }

    const adjustRotatedVideoPositionCSS = `\
    @media (min-aspect-ratio: 29/18) {
      #yt-clipper-video {
        margin-left: 36%;
      }
    }
    @media (min-aspect-ratio: 40/18) {
      #yt-clipper-video {
        margin-left: 25%;
      }
    }
    @media (max-aspect-ratio: 29/18) {
      #yt-clipper-video {
        margin-left: 34%;
      }
    }
    @media (max-aspect-ratio: 13/9) {
      #yt-clipper-video {
        margin-left: 32%;
      }
    }
    @media (max-aspect-ratio: 23/18) {
      #yt-clipper-video {
        margin-left: 30%;
      }
    }
    @media (max-aspect-ratio: 10/9) {
      #yt-clipper-video {
        margin-left: 26%;
      }
    }
    @media (max-aspect-ratio: 17/18) {
      #yt-clipper-video {
        margin-left: 22%;
      }
    }
    @media (max-aspect-ratio: 7/9) {
      #yt-clipper-video {
        margin-left: 16%;
      }
    }
    @media (max-aspect-ratio: 6/9) {
      #yt-clipper-video {
        margin-left: 14%;
      }
    }
    @media (max-aspect-ratio: 11/18) {
      #yt-clipper-video {
        margin-left: 10%;
      }
    }
    @media (max-aspect-ratio: 5/9) {
      #yt-clipper-video {
        margin-left: 0%;
      }
    }
    `;
    let rotatedVideoCSS: string;
    let fullscreenRotatedVideoCSS: string;
    let rotatedVideoPreviewsCSS: string;
    let rotatedVideoStyle: HTMLStyleElement;
    let adjustRotatedVideoPositionStyle: HTMLStyleElement;
    let fullscreenRotatedVideoStyle: HTMLStyleElement;
    let rotatedVideoPreviewsStyle: HTMLStyleElement;
    let rotation = 0;
    function rotateVideo(direction: string) {
      if (direction === 'clock') {
        rotation = rotation === 0 ? 90 : 0;
      } else if (direction === 'cclock') {
        rotation = rotation === 0 ? -90 : 0;
      }
      if (rotation === 90 || rotation === -90) {
        let scale = 1;
        scale = 1 / playerInfo.aspectRatio;
        rotatedVideoCSS = `
        #yt-clipper-video {
          transform: rotate(${rotation}deg) scale(2.2) !important;
          max-width: 45vh;
          max-height: 100vw;
        }
        #player-theater-container {
          height: 100vh !important;
          max-height: none !important;
        }
        #page-manager {
          margin-top: 0px !important;
        }
        #masthead #container {
          display: none !important;
        }
      `;
        rotatedVideoPreviewsCSS = `\
        .ytp-tooltip {
          transform: translateY(-35%) rotate(${rotation}deg) !important;
        }
        .ytp-tooltip-text-wrapper {
          transform: rotate(${-rotation}deg) !important;
          opacity: 0.6;
        }
      `;
        fullscreenRotatedVideoCSS = `
      #yt-clipper-video {
        transform: rotate(${rotation}deg) scale(${scale}) !important;
        margin-left: auto;
      }
      `;
        if (!document.fullscreen) {
          adjustRotatedVideoPositionStyle = injectCSS(
            adjustRotatedVideoPositionCSS,
            'adjust-rotated-video-position-css'
          );
          rotatedVideoStyle = injectCSS(rotatedVideoCSS, 'yt-clipper-rotate-video-css');
          window.dispatchEvent(new Event('resize'));
        } else {
          fullscreenRotatedVideoStyle = injectCSS(
            fullscreenRotatedVideoCSS,
            'fullscreen-rotated-video-css'
          );
        }
        rotatedVideoPreviewsStyle = injectCSS(
          rotatedVideoPreviewsCSS,
          'yt-clipper-rotated-video-previews-css'
        );
        deleteElement(bigVideoPreviewsStyle);
        bigVideoPreviewsStyle = null;
        window.dispatchEvent(new Event('resize'));
        document.addEventListener('fullscreenchange', fullscreenRotateVideoHandler);
      } else {
        deleteElement(rotatedVideoStyle);
        deleteElement(adjustRotatedVideoPositionStyle);
        deleteElement(fullscreenRotatedVideoStyle);
        deleteElement(rotatedVideoPreviewsStyle);
        deleteElement(bigVideoPreviewsStyle);
        bigVideoPreviewsStyle = null;
        window.dispatchEvent(new Event('resize'));
        document.removeEventListener('fullscreenchange', fullscreenRotateVideoHandler);
      }
    }

    function fullscreenRotateVideoHandler() {
      if (document.fullscreen) {
        deleteElement(rotatedVideoStyle);
        deleteElement(adjustRotatedVideoPositionStyle);
        fullscreenRotatedVideoStyle = injectCSS(
          fullscreenRotatedVideoCSS,
          'fullscreen-rotated-video-css'
        );
      } else {
        deleteElement(fullscreenRotatedVideoStyle);
        adjustRotatedVideoPositionStyle = injectCSS(
          adjustRotatedVideoPositionCSS,
          'adjust-rotated-video-position-css'
        );
        rotatedVideoStyle = injectCSS(rotatedVideoCSS, 'yt-clipper-rotate-video-css');
        document.removeEventListener('fullscreenchange', fullscreenRotateVideoHandler);
        window.dispatchEvent(new Event('resize'));
      }
    }

    let bigVideoPreviewsStyle: HTMLStyleElement;
    function toggleBigVideoPreviews() {
      const bigVideoPreviewsCSS = `\
    .ytp-tooltip {
      left: 45% !important;
      transform: ${
        rotation ? `translateY(-285%) rotate(${rotation}deg)` : 'translateY(-160%) '
      } scale(4) !important;
      padding: 1px !important;
      border-radius: 1px !important;
    }
    .ytp-tooltip-text-wrapper {
      transform: scale(0.5) ${rotation ? `rotate(${-rotation}deg)` : ''}!important;
      opacity: 0.6;
    }
    `;
      if (bigVideoPreviewsStyle) {
        deleteElement(bigVideoPreviewsStyle);
        bigVideoPreviewsStyle = null;
      } else {
        bigVideoPreviewsStyle = injectCSS(
          bigVideoPreviewsCSS,
          'yt-clipper-big-video-previews-css'
        );
      }
    }

    function addForeignEventListeners() {
      const selectors = ['#search-input #search'];
      selectors.forEach((selector) => {
        const input = document.querySelector(selector);
        if (isHotkeysEnabled) {
          input.addEventListener('focus', () => (isHotkeysEnabled = false), {
            capture: true,
          });
          input.addEventListener('blur', () => (isHotkeysEnabled = true), {
            capture: true,
          });
        }
      });
    }

    function flashMessage(msg: string, color: string, lifetime = 3000) {
      const flashDiv = document.createElement('div');
      flashDiv.setAttribute('class', 'msg-div flash-div');
      flashDiv.innerHTML = `<span class="flash-msg" style="color:${color}">${msg}</span>`;
      flashMessageHook.insertAdjacentElement('beforebegin', flashDiv);
      setTimeout(() => deleteElement(flashDiv), lifetime);
    }

    function getShortestActiveMarkerPair(
      currentTime: number = video.currentTime
    ): MarkerPair {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedMarkerPairIndex != null
      ) {
        const selectedMarkerPair = markerPairs[prevSelectedMarkerPairIndex];
        if (
          currentTime >= Math.floor(selectedMarkerPair.start * 1e6) / 1e6 &&
          currentTime <= Math.ceil(selectedMarkerPair.end * 1e6) / 1e6
        ) {
          return selectedMarkerPair;
        }
      }
      const activeMarkerPairs = markerPairs.filter((markerPair) => {
        if (
          currentTime >= Math.floor(markerPair.start * 1e6) / 1e6 &&
          currentTime <= Math.ceil(markerPair.end * 1e6) / 1e6
        ) {
          return true;
        }
        return false;
      });

      if (activeMarkerPairs.length === 0) {
        return null;
      }

      const shortestActiveMarkerPair = activeMarkerPairs.reduce((prev, cur) => {
        if (cur.end - cur.start < prev.end - prev.start) {
          return cur;
        }
        return prev;
      });

      return shortestActiveMarkerPair;
    }

    let isSpeedPreviewOn = false;
    const toggleMarkerPairSpeedPreview = () => {
      if (isSpeedPreviewOn) {
        isSpeedPreviewOn = false;
        flashMessage('Marker pair speed preview disabled', 'red');
      } else {
        isSpeedPreviewOn = true;
        if (!isForceSetSpeedOn) requestAnimationFrame(updateSpeed);
        flashMessage('Marker pair speed preview enabled', 'green');
      }
    };

    let prevSpeed = 1;
    const defaultRoundSpeedMapEasing = 0.05;
    function updateSpeed() {
      if (!isSpeedPreviewOn && !isForceSetSpeedOn) {
        player.setPlaybackRate(1);
        prevSpeed = 1;
        updateSpeedInputLabel('Speed');

        return;
      }

      if (isForceSetSpeedOn) {
        if (prevSpeed !== forceSetSpeedValue) {
          player.setPlaybackRate(forceSetSpeedValue);
          prevSpeed = forceSetSpeedValue;
          updateSpeedInputLabel(`Speed (${forceSetSpeedValue.toFixed(2)})`);
        }

        requestAnimationFrame(updateSpeed);
        return;
      }

      const shortestActiveMarkerPair = getShortestActiveMarkerPair();
      let newSpeed = prevSpeed;
      if (shortestActiveMarkerPair) {
        let markerPairSpeed: number;
        const enableSpeedMaps =
          shortestActiveMarkerPair.overrides.enableSpeedMaps !== undefined
            ? shortestActiveMarkerPair.overrides.enableSpeedMaps
            : settings.enableSpeedMaps !== false;

        if (enableSpeedMaps) {
          markerPairSpeed = getSpeedMapping(
            shortestActiveMarkerPair.speedMap,
            video.currentTime,
            defaultRoundSpeedMapEasing,
            2
          );
        } else {
          markerPairSpeed = shortestActiveMarkerPair.speed;
        }
        // console.log(markerPairSpeed);
        if (prevSpeed !== markerPairSpeed) {
          newSpeed = markerPairSpeed;
        }
      } else {
        newSpeed = 1;
      }

      if (prevSpeed !== newSpeed) {
        player.setPlaybackRate(newSpeed);
        prevSpeed = newSpeed;
        updateSpeedInputLabel('Speed');
      }

      requestAnimationFrame(updateSpeed);
    }

    function updateSpeedInputLabel(text: string) {
      if (isSettingsEditorOpen && speedInputLabel != null) {
        speedInputLabel.textContent = text;
      }
    }

    function getSpeedMapping(
      speedMap: SpeedPoint[],
      time: number,
      roundMultiple = defaultRoundSpeedMapEasing,
      roundPrecision = 2
    ) {
      let len = speedMap.length;
      if (len === 2 && speedMap[0].y === speedMap[1].y) {
        return speedMap[0].y;
      }

      len--;
      let left: SpeedPoint;
      let right: SpeedPoint;
      for (let i = 0; i < len; ++i) {
        if (speedMap[i].x <= time && time <= speedMap[i + 1].x) {
          left = speedMap[i];
          right = speedMap[i + 1];
          break;
        }
      }

      if (left && right) {
        if (left.y === right.y) {
          return left.y;
        }
        const elapsed = video.currentTime - left.x;
        const duration = right.x - left.x;
        let easedTimePercentage: number;
        if (easingMode === 'cubicInOut') {
          easedTimePercentage = easeCubicInOut(elapsed / duration);
        } else if (easingMode === 'linear') {
          easedTimePercentage = elapsed / duration;
        }
        const change = right.y - left.y;
        const rawSpeed = left.y + change * easedTimePercentage || right.y;
        const roundedSpeed =
          roundMultiple > 0
            ? roundValue(rawSpeed, roundMultiple, roundPrecision)
            : rawSpeed;
        // console.log(roundedSpeed);
        return roundedSpeed;
      } else {
        return 1;
      }
    }

    let isMarkerLoopPreviewOn = false;
    function toggleMarkerPairLoop() {
      if (isMarkerLoopPreviewOn) {
        isMarkerLoopPreviewOn = false;
        flashMessage('Auto marker looping disabled', 'red');
      } else {
        isMarkerLoopPreviewOn = true;
        requestAnimationFrame(loopMarkerPair);
        flashMessage('Auto marker looping enabled', 'green');
      }
    }

    function loopMarkerPair() {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        (!isCropChartLoopingOn ||
          !isCurrentChartVisible ||
          currentChartInput.type === 'speed')
      ) {
        if (prevSelectedMarkerPairIndex != null) {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const chartLoop: ChartLoop = currentChartInput
            ? markerPair[currentChartInput.chartLoopKey]
            : null;
          if (
            chartLoop &&
            chartLoop.enabled &&
            chartLoop.start > markerPair.start &&
            chartLoop.end < markerPair.end &&
            chartLoop.start < chartLoop.end
          ) {
            const isTimeBetweenChartLoop =
              chartLoop.start <= video.currentTime && video.currentTime <= chartLoop.end;
            if (!isTimeBetweenChartLoop) {
              player.seekTo(chartLoop.start);
            }
          } else {
            const isTimeBetweenMarkerPair =
              markerPair.start <= video.currentTime &&
              video.currentTime <= markerPair.end;
            if (!isTimeBetweenMarkerPair) {
              player.seekTo(markerPair.start);
            }
          }
        }
      }

      if (isMarkerLoopPreviewOn) {
        requestAnimationFrame(loopMarkerPair);
      }
    }

    let gammaFilterDiv: HTMLDivElement;
    let isGammaPreviewOn = false;
    let gammaR: SVGFEFuncRElement;
    let gammaG: SVGFEFuncGElement;
    let gammaB: SVGFEFuncBElement;
    let gammaFilterSvg: SVGSVGElement;
    function toggleGammaPreview() {
      if (!gammaFilterDiv) {
        gammaFilterDiv = document.createElement('div');
        gammaFilterDiv.setAttribute('id', 'gamma-filter-div');
        gammaFilterDiv.innerHTML = `\
      <svg id="gamma-filter-svg" xmlns="http://www.w3.org/2000/svg" width="0" height="0">
        <defs>
          <filter id="gamma-filter">
            <feComponentTransfer id="gamma-filter-comp-transfer">
              <feFuncR id="gamma-r" type="gamma" offset="0" amplitude="1"></feFuncR>
              <feFuncG id="gamma-g" type="gamma" offset="0" amplitude="1"></feFuncG>
              <feFuncB id="gamma-b" type="gamma" offset="0" amplitude="1"></feFuncB>
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      `;
        document.body.appendChild(gammaFilterDiv);
        gammaFilterSvg = gammaFilterDiv.firstElementChild as SVGSVGElement;
        gammaR = (document.getElementById('gamma-r') as unknown) as SVGFEFuncRElement;
        gammaG = (document.getElementById('gamma-g') as unknown) as SVGFEFuncGElement;
        gammaB = (document.getElementById('gamma-b') as unknown) as SVGFEFuncBElement;
      }
      if (!isGammaPreviewOn) {
        video.style.filter = 'url(#gamma-filter)';
        isGammaPreviewOn = true;
        requestAnimationFrame(gammaPreviewHandler);
        flashMessage('Gamma preview enabled', 'green');
      } else {
        video.style.filter = null;
        isGammaPreviewOn = false;
        flashMessage('Gamma preview disabled', 'red');
      }
    }

    let prevGammaVal = 1;
    function gammaPreviewHandler() {
      const shortestActiveMarkerPair = getShortestActiveMarkerPair();

      const markerPairGamma =
        (shortestActiveMarkerPair && shortestActiveMarkerPair.overrides.gamma) ||
        settings.gamma ||
        1;

      if (markerPairGamma == 1) {
        if (video.style.filter) video.style.filter = null;
        prevGammaVal = 1;
      } else if (prevGammaVal !== markerPairGamma) {
        // console.log(`Updating gamma from ${prevGammaVal} to ${markerPairGamma}`);
        gammaR.exponent.baseVal = markerPairGamma;
        gammaG.exponent.baseVal = markerPairGamma;
        gammaB.exponent.baseVal = markerPairGamma;
        // force re-render of filter (possible bug with chrome and other browsers?)
        if (!video.style.filter) video.style.filter = 'url(#gamma-filter)';
        gammaFilterSvg.setAttribute('width', '0');
        prevGammaVal = markerPairGamma;
      }

      if (isGammaPreviewOn) {
        requestAnimationFrame(gammaPreviewHandler);
      }
    }

    let isFadeLoopPreviewOn = false;
    function toggleFadeLoopPreview() {
      if (!isFadeLoopPreviewOn) {
        isFadeLoopPreviewOn = true;
        requestAnimationFrame(fadeLoopPreviewHandler);
        flashMessage('Fade loop preview enabled', 'green');
      } else {
        isFadeLoopPreviewOn = false;
        video.style.opacity = '1';
        flashMessage('Fade loop preview disabled', 'red');
      }
    }

    function fadeLoopPreviewHandler() {
      const currentTime = video.currentTime;
      const shortestActiveMarkerPair = getShortestActiveMarkerPair();
      if (
        shortestActiveMarkerPair &&
        (shortestActiveMarkerPair.overrides.loop === 'fade' ||
          (shortestActiveMarkerPair.overrides.loop == null && settings.loop === 'fade'))
      ) {
        const currentTimeP = getFadeBounds(shortestActiveMarkerPair, currentTime);
        if (currentTimeP == null) {
          video.style.opacity = '1';
        } else {
          let currentTimeEased = Math.max(0.1, easeCubicInOut(currentTimeP));
          video.style.opacity = currentTimeEased.toString();
          // console.log(video.style.opacity);
        }
      } else {
        video.style.opacity = '1';
      }
      isFadeLoopPreviewOn
        ? requestAnimationFrame(fadeLoopPreviewHandler)
        : (video.style.opacity = '1');
    }

    function getFadeBounds(markerPair: MarkerPair, currentTime: number): number | null {
      const start = Math.floor(markerPair.start * 1e6) / 1e6;
      const end = Math.ceil(markerPair.end * 1e6) / 1e6;
      const inputDuration = end - start;
      const outputDuration = markerPair.outputDuration;
      let fadeDuration =
        markerPair.overrides.fadeDuration || settings.fadeDuration || 0.5;
      fadeDuration = Math.min(fadeDuration, 0.4 * outputDuration);
      const fadeInStartP = 0;
      const fadeInEndP = fadeDuration / outputDuration;
      const fadeOutStartP = (outputDuration - fadeDuration) / outputDuration;
      const fadeOutEndP = outputDuration / outputDuration;

      let currentTimeP = (currentTime - start) / inputDuration;

      if (currentTimeP >= fadeInStartP && currentTimeP <= fadeInEndP) {
        currentTimeP = (currentTime - start) / fadeDuration;
        return currentTimeP;
      } else if (currentTimeP >= fadeOutStartP && currentTimeP <= fadeOutEndP) {
        currentTimeP =
          1 - (currentTime - start - (inputDuration - fadeDuration)) / fadeDuration;
        return currentTimeP;
      } else {
        return null;
      }
    }

    let isAllPreviewsOn = false;
    function toggleAllPreviews() {
      isAllPreviewsOn =
        isSpeedPreviewOn &&
        isMarkerLoopPreviewOn &&
        isGammaPreviewOn &&
        isFadeLoopPreviewOn &&
        isCropChartLoopingOn;
      if (!isAllPreviewsOn) {
        !isSpeedPreviewOn && toggleMarkerPairSpeedPreview();
        !isMarkerLoopPreviewOn && toggleMarkerPairLoop();
        !isGammaPreviewOn && toggleGammaPreview();
        !isFadeLoopPreviewOn && toggleFadeLoopPreview();
        !isCropChartLoopingOn && toggleCropChartLooping();
        isAllPreviewsOn = true;
      } else {
        isSpeedPreviewOn && toggleMarkerPairSpeedPreview();
        isMarkerLoopPreviewOn && toggleMarkerPairLoop();
        isGammaPreviewOn && toggleGammaPreview();
        isFadeLoopPreviewOn && toggleFadeLoopPreview();
        isCropChartLoopingOn && toggleCropChartLooping();
        isAllPreviewsOn = false;
      }
    }

    function jumpToNearestMarkerOrPair(e: KeyboardEvent, keyCode: string) {
      if (!arrowKeyCropAdjustmentEnabled) {
        if (e.ctrlKey && !e.altKey && !e.shiftKey) {
          jumpToNearestMarker(e, video.currentTime, keyCode);
        } else if (e.altKey && !e.shiftKey) {
          if (!e.ctrlKey && !(isSettingsEditorOpen && !wasGlobalSettingsEditorOpen)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            togglePrevSelectedMarkerPair();
          }
          if (enableMarkerHotkeys.endMarker) {
            jumpToNearestMarkerPair(e, enableMarkerHotkeys.endMarker, keyCode);
          }
        }
      }
    }

    function jumpToNearestMarkerPair(
      e: KeyboardEvent,
      targetEndMarker: SVGRectElement,
      keyCode: string
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      let index = parseInt(targetEndMarker.getAttribute('idx')) - 1;
      if (keyCode === 'ArrowLeft' && index > 0) {
        targetEndMarker =
          enableMarkerHotkeys.endMarker.previousElementSibling.previousElementSibling;
        targetEndMarker && toggleMarkerPairEditor(targetEndMarker);
        if (e.ctrlKey) {
          index--;
          player.seekTo(markerPairs[index].start);
        }
      } else if (keyCode === 'ArrowRight' && index < markerPairs.length - 1) {
        targetEndMarker =
          enableMarkerHotkeys.endMarker.nextElementSibling.nextElementSibling;
        targetEndMarker && toggleMarkerPairEditor(targetEndMarker);
        if (e.ctrlKey) {
          index++;
          player.seekTo(markerPairs[index].start);
        }
      }
    }

    let dblJump = 0;
    let prevJumpKeyCode: 'ArrowLeft' | 'ArrowRight';
    let prevTime: number;
    function jumpToNearestMarker(e: KeyboardEvent, currentTime: number, keyCode: string) {
      e.preventDefault();
      e.stopImmediatePropagation();
      let minTime: number;
      currentTime = prevTime != null ? prevTime : currentTime;
      let markerTimes: number[] = [];
      markerPairs.forEach((markerPair) => {
        markerTimes.push(markerPair.start);
        markerTimes.push(markerPair.end);
      });

      if (start === false) {
        markerTimes.push(startTime);
      }
      markerTimes = markerTimes.map((markerTime) => parseFloat(markerTime.toFixed(6)));
      if (keyCode === 'ArrowLeft') {
        markerTimes = markerTimes.filter((markerTime) => markerTime < currentTime);
        minTime = Math.max(...markerTimes);
        if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowLeft') {
          markerTimes = markerTimes.filter((markerTime) => markerTime < minTime);
          minTime = Math.max(...markerTimes);
        }
        prevJumpKeyCode = 'ArrowLeft';
      } else if (keyCode === 'ArrowRight') {
        markerTimes = markerTimes.filter((markerTime) => markerTime > currentTime);
        minTime = Math.min(...markerTimes);
        if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowRight') {
          markerTimes = markerTimes.filter((markerTime) => markerTime > minTime);
          minTime = Math.min(...markerTimes);
        }
        prevJumpKeyCode = 'ArrowRight';
      }

      if (dblJump !== 0) {
        clearTimeout(dblJump);
        dblJump = 0;
        prevTime = null;
        if (minTime !== currentTime && minTime != Infinity && minTime != -Infinity)
          player.seekTo(minTime);
      } else {
        prevTime = currentTime;
        if (minTime !== currentTime && minTime != Infinity && minTime != -Infinity)
          player.seekTo(minTime);
        dblJump = (setTimeout(() => {
          dblJump = 0;
          prevTime = null;
        }, 150) as unknown) as number;
      }
    }

    function saveMarkersAndSettings() {
      const settingsJSON = getSettingsJSON();

      const blob = new Blob([settingsJSON], { type: 'text/plain;charset=utf-8' });
      saveAs(blob, `${settings.titleSuffix || `[${settings.videoID}]`}.json`);
    }

    function getSettingsJSON() {
      markerPairs.forEach((markerPair: MarkerPair, index: number) => {
        const speed = markerPair.speed;
        if (typeof speed === 'string') {
          markerPair.speed = Number(speed);
          console.log(`Converted marker pair ${index}'s speed from String to Number`);
        }
      });

      const markerPairsNumbered = markerPairs.map((markerPair, idx) => {
        const markerPairNumbered = {
          number: idx + 1,
          ...markerPair,
          speedMapLoop: undefined,
          speedMap: isVariableSpeed(markerPair.speedMap)
            ? markerPair.speedMap
            : undefined,
          speedChartLoop: undefined,
          cropMap: !isStaticCrop(markerPair.cropMap) ? markerPair.cropMap : undefined,
          cropChartLoop: undefined,
          startNumbering: undefined,
          endNumbering: undefined,
          moveHistory: undefined,
        };
        return markerPairNumbered;
      });

      const settingsJSON = JSON.stringify(
        {
          ...settings,
          version: __version__,
          markerPairs: markerPairsNumbered,
        },
        undefined,
        2
      );
      return settingsJSON;
    }

    function isVariableSpeed(speedMap: SpeedPoint[]) {
      if (speedMap.length < 2) return false;

      let isVariableSpeed = speedMap.some((speedPoint, i) => {
        if (i === speedMap.length - 1) return false;

        return speedPoint.y !== speedMap[i + 1].y;
      });

      return isVariableSpeed;
    }

    function loadMarkers() {
      const markersUploadDiv = document.getElementById('markers-upload-div');
      if (markersUploadDiv) {
        deleteElement(markersUploadDiv);
      } else {
        const markersUploadDiv = document.createElement('div');
        markersUploadDiv.setAttribute('id', 'markers-upload-div');
        markersUploadDiv.innerHTML = html`
          <fieldset>
            <legend>Upload a markers .json file.</legend>
            <input type="file" id="markers-json-input" />
            <input type="button" id="upload-markers-json" value="Load" />
          </fieldset>
          <fieldset hidden>
            <legend>Upload a markers array file.</legend>
            <input type="file" id="markers-array-input" />
            <input type="button" id="upload-markers-array" value="Load" />
          </fieldset>
        `;
        updateSettingsEditorHook();
        settingsEditorHook.insertAdjacentElement('afterend', markersUploadDiv);
        const fileUploadButton = document.getElementById('upload-markers-json');
        fileUploadButton.onclick = loadMarkersJson;
        const markersArrayUploadButton = document.getElementById('upload-markers-array');
        markersArrayUploadButton.onclick = loadMarkersArray;
      }
    }

    function loadMarkersJson() {
      const input = document.getElementById('markers-json-input');
      if (input.files.length === 0) return;
      console.log(input.files);
      const file = input.files[0];
      const fr = new FileReader();
      fr.onload = receivedJson;
      fr.readAsText(file);
      const markersUploadDiv = document.getElementById('markers-upload-div');
      deleteElement(markersUploadDiv);
    }

    function loadMarkersArray() {
      const input = document.getElementById('markers-array-input');
      if (input.files.length === 0) return;
      console.log(input.files);
      const file = input.files[0];
      const fr = new FileReader();
      fr.onload = receivedMarkersArray;
      fr.readAsText(file);
      const markersUploadDiv = document.getElementById('markers-upload-div');
      deleteElement(markersUploadDiv);
    }

    function receivedJson(e: ProgressEvent) {
      const lines = e.target.result;
      const markersJson = JSON.parse(lines);
      console.log(markersJson);

      flashMessage('Loading markers...', 'green');

      if (markersJson) {
        // move markers field to marker Pairs for backwards compat)
        if (markersJson.markers && !markersJson.markerPairs) {
          markersJson.markerPairs = markersJson.markers;
          delete markersJson.markers;
        }

        if (!markersJson.markerPairs) {
          flashMessage(
            'Could not find markers or markerPairs field. Could not load marker data.',
            'red'
          );
        }
        // copy markersJson to settings object less markerPairs field
        const { markerPairs: _markerPairs, ...loadedSettings } = markersJson;

        settings = { ...settings, ...loadedSettings };
        markersJson.markerPairs.forEach((markerPair: MarkerPair) => {
          const startMarkerConfig: MarkerConfig = {
            time: markerPair.start,
            type: 'start',
          };
          const endMarkerConfig: MarkerConfig = {
            time: markerPair.end,
            type: 'end',
            crop: markerPair.crop,
            speed: markerPair.speed,
            speedMap: markerPair.speedMap,
            speedChartLoop: markerPair.speedChartLoop,
            cropMap: markerPair.cropMap,
            cropChartLoop: markerPair.cropChartLoop,
            overrides: markerPair.overrides,
          };
          addMarker(startMarkerConfig);
          addMarker(endMarkerConfig);
        });
      }
    }

    function receivedMarkersArray(e: ProgressEvent) {
      const lines = e.target.result;
      const markersJson = JSON.parse(lines);
      console.log(markersJson);

      flashMessage('Loading markers...', 'green');

      settings = { ...settings };
      markersJson.markerPairs = markersJson.markerPairs.flat(1);
      for (let i = 0; i < markersJson.markerPairs.length; i = i + 4) {
        console.log(markerPairs);
        const start = timeRounder(markersJson.markerPairs[i]);
        const end = timeRounder(markersJson.markerPairs[i + 1]);
        const speed = speedRounder(1 / markersJson.markerPairs[i + 2]);
        const crop = markersJson.markerPairs[i + 3];
        const startMarkerConfig: MarkerConfig = {
          time: start,
          type: 'start',
        };
        const endMarkerConfig: MarkerConfig = {
          time: end,
          type: 'end',
          crop: crop,
          speed: speed,
        };
        addMarker(startMarkerConfig);
        addMarker(endMarkerConfig);
      }
    }

    // set width and height attributes for browsers not supporting svg 2
    const marker_attrs = {
      class: 'marker',
      width: '1px',
      height: '14px',
      'shape-rendering': 'crispEdges',
    };

    function addMarker(markerConfig: MarkerConfig = {}) {
      const preciseCurrentTime = markerConfig.time || player.getCurrentTime();
      // TODO: Calculate video fps precisely so current frame time
      // is accurately determined.
      // const currentFrameTime = getCurrentFrameTime(roughCurrentTime);
      const currentFrameTime = preciseCurrentTime;
      const progressPos = (currentFrameTime / playerInfo.duration) * 100;

      if (!start && currentFrameTime <= startTime) {
        flashMessage('Cannot add end marker before start marker.', 'red');
        return;
      }

      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      markersSvg.appendChild(marker);

      setAttributes(marker, marker_attrs);
      marker.setAttribute('x', `${progressPos}%`);
      const rectIdx = markerPairs.length + 1;
      marker.setAttribute('idx', rectIdx.toString());

      if (start === true) {
        marker.classList.add('start-marker');
        marker.setAttribute('type', 'start');
        marker.setAttribute('z-index', '1');
        startTime = currentFrameTime;
      } else {
        marker.addEventListener('mouseover', toggleMarkerPairEditorHandler, false);
        marker.classList.add('end-marker');
        marker.setAttribute('type', 'end');
        marker.setAttribute('z-index', '2');
        const startProgressPos = (startTime / playerInfo.duration) * 100;
        const [startNumbering, endNumbering] = addMarkerPairNumberings(
          rectIdx,
          startProgressPos,
          progressPos,
          marker
        );
        updateMarkerPairsArray(currentFrameTime, {
          ...markerConfig,
          ...{ startNumbering, endNumbering },
        });
        updateMarkerPairEditor();
      }

      start = !start;
      console.log(markerPairs);
    }

    let prevVideoWidth: number;
    function getFPS(defaultFPS: number | null = 60) {
      try {
        if (
          playerInfo.fps != null &&
          video.videoWidth != null &&
          prevVideoWidth === video.videoWidth
        ) {
          return playerInfo.fps;
        } else {
          playerInfo.fps = parseFloat(
            player.getStatsForNerds().resolution.match(/@(\d+)/)[1]
          );
          prevVideoWidth = video.videoWidth;
          return playerInfo.fps;
        }
      } catch (e) {
        console.log('Could not detect fps', e);
        return defaultFPS; // by default parameter value assume high fps to avoid skipping frames
      }
    }

    function getCurrentFrameTime(roughCurrentTime: number): number {
      let currentFrameTime: number;
      let fps = getFPS(null);
      // If fps cannot be detected use precise time reported by video player
      // instead of estimating nearest frame time
      fps
        ? (currentFrameTime = Math.floor(roughCurrentTime * fps) / fps)
        : (currentFrameTime = roughCurrentTime);
      return currentFrameTime;
    }

    function updateMarkerPairsArray(currentTime: number, markerPairConfig: MarkerConfig) {
      const speed = markerPairConfig.speed || settings.newMarkerSpeed;
      const crop = markerPairConfig.crop || settings.newMarkerCrop;
      const newMarkerPair: MarkerPair = {
        start: startTime,
        end: currentTime,
        crop,
        speed,
        outputDuration: markerPairConfig.outputDuration || currentTime - startTime,
        overrides: markerPairConfig.overrides || {},
        speedChartLoop: markerPairConfig.speedChartLoop || { enabled: true },
        speedMap: markerPairConfig.speedMap || [
          { x: startTime, y: speed },
          { x: currentTime, y: speed },
        ],
        cropChartLoop: markerPairConfig.cropChartLoop || { enabled: true },
        cropMap: markerPairConfig.cropMap || [
          { x: startTime, y: 0, crop: crop },
          { x: currentTime, y: 0, crop: crop },
        ],
        startNumbering: markerPairConfig.startNumbering,
        endNumbering: markerPairConfig.endNumbering,
        moveHistory: { undos: [], redos: [] },
      };

      markerPairs.push(newMarkerPair);
    }

    function updateMarkerPairEditor() {
      if (isSettingsEditorOpen) {
        const markerPairCountLabel = document.getElementById('marker-pair-count-label');
        if (markerPairCountLabel) {
          markerPairCountLabel.textContent = markerPairs.length.toString();
          markerPairNumberInput.setAttribute('max', markerPairs.length.toString());
        }
      }
    }

    function addMarkerPairNumberings(
      idx: number,
      startProgressPos: number,
      endProgressPos: number,
      endMarker: SVGRectElement
    ) {
      const startNumbering = htmlToSVGElement(`\
        <text class="markerNumbering startMarkerNumbering" idx="${idx}"\
        x="${startProgressPos}%" y="11.5px"
        text-anchor="middle">\
        ${idx}\
        </text>\
        `);
      const endNumbering = htmlToSVGElement(`\
        <text class="markerNumbering endMarkerNumbering" idx="${idx}"\
          x="${endProgressPos}%" y="11.5px"
          text-anchor="middle"
        >\
        ${idx}\
        </text>\
        `);

      const startNumberingText = startMarkerNumberings.appendChild(
        startNumbering
      ) as SVGTextElement;
      const endNumberingText = endMarkerNumberings.appendChild(
        endNumbering
      ) as SVGTextElement;

      endNumberingText.marker = endMarker;
      startNumberingText.marker = endMarker;
      endNumberingText.addEventListener(
        'mouseover',
        markerNumberingMouseOverHandler,
        false
      );
      startNumberingText.addEventListener(
        'pointerdown',
        markerNumberingMouseDownHandler,
        true
      );
      endNumberingText.addEventListener(
        'pointerdown',
        markerNumberingMouseDownHandler,
        true
      );

      return [startNumberingText, endNumberingText];
    }

    function undoMarker() {
      const targetMarker = markersSvg.lastElementChild;
      if (!targetMarker) return;

      const targetMarkerType = targetMarker.getAttribute('type');
      // toggle off marker pair editor before undoing a selected marker pair
      if (
        targetMarkerType === 'end' &&
        prevSelectedMarkerPairIndex >= markerPairs.length - 1
      ) {
        if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
          toggleOffMarkerPairEditor(true);
        } else {
          hideSelectedMarkerPairOverlay(true);
        }
        clearPrevSelectedMarkerPairReferences();
      }

      deleteElement(targetMarker);
      if (targetMarkerType === 'end') {
        const markerPair = markerPairs[markerPairs.length - 1];
        deleteElement(markerPair.startNumbering);
        deleteElement(markerPair.endNumbering);
        startTime = markerPair.start;
        markerPairsHistory.push(markerPairs.pop());
        console.log(markerPairs);
        updateMarkerPairEditor();
      }
      start = !start;
    }

    function redoMarker() {
      if (markerPairsHistory.length > 0) {
        const markerPairToRestore = markerPairsHistory[markerPairsHistory.length - 1];
        if (start) {
          addMarker({ time: markerPairToRestore.start });
        } else {
          markerPairsHistory.pop();
          addMarker({ ...markerPairToRestore, time: markerPairToRestore.end });
        }
      }
    }

    let forceSetSpeedValue = 1;
    function cycleForceSetSpeedValueDown() {
      forceSetSpeedValue = forceSetSpeedValue - 0.25;
      if (forceSetSpeedValue <= 0) forceSetSpeedValue = 1;
      flashMessage(`Force set video speed value set to ${forceSetSpeedValue}`, 'green');
    }

    let isForceSetSpeedOn = false;
    function toggleForceSetSpeed() {
      if (isForceSetSpeedOn) {
        isForceSetSpeedOn = false;
        updateSpeedInputLabel(`Speed`);
        flashMessage('Force set speed disabled', 'red');
      } else {
        isForceSetSpeedOn = true;
        updateSpeedInputLabel(`Speed (${forceSetSpeedValue.toFixed(2)})`);
        if (!isSpeedPreviewOn) requestAnimationFrame(updateSpeed);
        flashMessage('Force set speed enabled', 'green');
      }
    }

    function toggleGlobalSettingsEditor() {
      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
        toggleOffMarkerPairEditor();
      }
      if (wasGlobalSettingsEditorOpen) {
        toggleOffGlobalSettingsEditor();
      } else {
        createGlobalSettingsEditor();
      }
    }

    function toggleOffGlobalSettingsEditor() {
      deleteSettingsEditor();
      hideCropOverlay();
      hideChart();
    }

    function createGlobalSettingsEditor() {
      createCropOverlay(settings.newMarkerCrop);
      const globalSettingsEditorDiv = document.createElement('div');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const [x, y, w, h] = getCropComponents(settings.newMarkerCrop);
      const cropAspectRatio = (w / h).toFixed(13);
      const numOrRange = `(\\d{1,2})|(\\d{1,2}-\\d{1,2})`;
      const csvRange = `(${numOrRange})*(,(${numOrRange}))*`;
      const csvRangeReq = `(${numOrRange}){1}(,(${numOrRange}))*`;
      const mergeListInputValidation = `^(${csvRange})(;${csvRangeReq})*$`;
      const gte100 = `([1-9]\\d{3}|[1-9]\\d{2})`;
      const cropResInputValidation = `${gte100}x${gte100}`;
      const resList = playerInfo.isVerticalVideo
        ? `<option value="1080x1920"><option value="2160x3840">`
        : `<option value="1920x1080"><option value="3840x2160">`;
      const minterpMode = settings.minterpMode;
      const minterpFPS = settings.minterpFPS;
      const denoise = settings.denoise;
      const denoiseDesc = denoise ? denoise.desc : null;
      const vidstab = settings.videoStabilization;
      const vidstabDesc = vidstab ? vidstab.desc : null;
      const vidstabDynamicZoomEnabled = settings.videoStabilizationDynamicZoom;
      const markerPairMergelistDurations = getMarkerPairMergeListDurations();
      const globalEncodeSettingsEditorDisplay = isExtraSettingsEditorEnabled
        ? 'block'
        : 'none';
      globalSettingsEditorDiv.setAttribute('id', 'settings-editor-div');
      globalSettingsEditorDiv.innerHTML = `
    <fieldset id="new-marker-defaults-inputs" 
      class="settings-editor-panel global-settings-editor global-settings-editor-highlighted-div">
      <legend class="global-settings-editor-highlighted-label">New Marker Settings</legend>
      <div class="settings-editor-input-div" title="${Tooltips.speedTooltip}">
        <span>Speed</span>
        <input id="speed-input" type="number" placeholder="speed" value="${
          settings.newMarkerSpeed
        }" step="0.05" min="0.05" max="2" style="min-width:4em">
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.cropTooltip}">
        <span>Crop</span>
        <input id="crop-input" value="${
          settings.newMarkerCrop
        }" pattern="${cropInputValidation}" style="min-width:10em" required>
      </div>
      <div class="settings-editor-input-div  settings-info-display">
        <span>Crop Aspect Ratio</span>
        <span id="crop-aspect-ratio">${cropAspectRatio}</span>
      </div>
    </fieldset>
    <fieldset id="global-marker-settings" 
    class="settings-editor-panel global-settings-editor global-settings-editor-highlighted-div">
      <legend class="global-settings-editor-highlighted-label settings-editor-panel-label">Global Settings</legend>
      <div class="settings-editor-input-div" title="${Tooltips.titleSuffixTooltip}">
        <span>Title Suffix</span>
        <input id="title-suffix-input" value="${
          settings.titleSuffix
        }" style="background-color:lightgreen;min-width:20em;text-align:right" required>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.cropResolutionTooltip}">
        <span>Crop Resolution</span>
        <input id="crop-res-input" list="resolutions" pattern="${cropResInputValidation}" value="${
        settings.cropRes
      }" style="min-width:7em" required>
        <datalist id="resolutions" autocomplete="off">${resList}</datalist>
      </div>
      <div id="global-settings-rotate" class="settings-editor-input-div" title="${
        Tooltips.rotateTooltip
      }">
        <span style="display:inline">Rotate: </span>
        <input id="rotate-0" type="radio" name="rotate" value="0" ${
          settings.rotate == null || settings.rotate === '0' ? 'checked' : ''
        }></input>
        <label for="rotate-0">0&#x00B0; </label>
        <input id="rotate-90-clock" type="radio" value="clock" name="rotate" ${
          settings.rotate === 'clock' ? 'checked' : ''
        }></input>
        <label for="rotate-90-clock">90&#x00B0; &#x27F3;</label>
        <input id="rotate-90-counterclock" type="radio" value="cclock" name="rotate" ${
          settings.rotate === 'cclock' ? 'checked' : ''
        }></input>
        <label for="rotate-90-counterclock">90&#x00B0; &#x27F2;</label>
      </div>
      <div id="merge-list-div" class="settings-editor-input-div" title="${
        Tooltips.mergeListTooltip
      }">
          <span style="display:inline">Merge List: </span>
          <input id="merge-list-input" pattern="${mergeListInputValidation}" value="${
        settings.markerPairMergeList != null ? settings.markerPairMergeList : ''
      }" placeholder="None" style="min-width:15em">
      </div>
      <div class="settings-editor-input-div">
        <span style="display:inline">Merge Durations: </span>
        <span id="merge-list-durations" style="display:inline">${markerPairMergelistDurations}</span>
      </div>
    </fieldset>
    <fieldset id="global-encode-settings" 
      class="settings-editor-panel global-settings-editor global-settings-editor-highlighted-div" style="display:${globalEncodeSettingsEditorDisplay}">
      <legend class="global-settings-editor-highlighted-label">Encode Settings</legend>
      <div class="settings-editor-input-div" title="${Tooltips.audioTooltip}">
        <span>Audio</span>
        <select id="audio-input"> 
          <option ${settings.audio ? 'selected' : ''}>Enabled</option>
          <option ${settings.audio === false ? 'selected' : ''}>Disabled</option>
          <option value="Default" ${
            settings.audio == null ? 'selected' : ''
          }>Inherit (Disabled)</option>
        </select>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.encodeSpeedTooltip}">
        <span>Encode Speed (0-5)</span>
        <input id="encode-speed-input" type="number" min="0" max="5" step="1" value="${
          settings.encodeSpeed != null ? settings.encodeSpeed : ''
        }" placeholder="Auto" style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.CRFTooltip}">
        <span>CRF (0-63)</span>
        <input id="crf-input" type="number" min="0" max="63" step="1" value="${
          settings.crf != null ? settings.crf : ''
        }" placeholder="Auto" style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.targetBitrateTooltip}">
        <span>Target Bitrate (kb/s)</span>
        <input id="target-max-bitrate-input" type="number" min="0" max="1e5"step="100" value="${
          settings.targetMaxBitrate != null ? settings.targetMaxBitrate : ''
        }" placeholder="Auto" "style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.twoPassTooltip}">
        <span>Two-Pass</span>
        <select id="two-pass-input"> 
          <option ${settings.twoPass ? 'selected' : ''}>Enabled</option>
          <option ${settings.twoPass === false ? 'selected' : ''}>Disabled</option>
          <option value="Default" ${
            settings.twoPass == null ? 'selected' : ''
          }>Inherit (Disabled)</option>
        </select>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.gammaTooltip}">
        <span>Gamma (0-4)</span>
        <input id="gamma-input" type="number" min="0.01" max="4.00" step="0.01" value="${
          settings.gamma != null ? settings.gamma : ''
        }" placeholder="1" style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.expandColorRangeTooltip}">
        <span>Expand Colors</span>
        <select id="expand-color-range-input"> 
          <option ${settings.expandColorRange ? 'selected' : ''}>Enabled</option>
          <option ${
            settings.expandColorRange === false ? 'selected' : ''
          }>Disabled</option>
          <option value="Default" ${
            settings.expandColorRange == null ? 'selected' : ''
          }>Inherit (Disabled)</option>
        </select>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.denoiseTooltip}">
        <span>Denoise</span>
        <select id="denoise-input">
          <option value="Inherit" ${
            denoiseDesc == null ? 'selected' : ''
          }>Inherit (Disabled)</option>
          <option ${denoiseDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
          <option ${denoiseDesc === 'Weak' ? 'selected' : ''}>Weak</option>
          <option ${denoiseDesc === 'Medium' ? 'selected' : ''}>Medium</option>
          <option ${denoiseDesc === 'Strong' ? 'selected' : ''}>Strong</option>
          <option ${denoiseDesc === 'Very Strong' ? 'selected' : ''}>Very Strong</option>
        </select>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.speedMapTooltip}">
        <span>Speed Maps</span>
          <select id="enable-speed-maps-input">
            <option ${settings.enableSpeedMaps ? 'selected' : ''}>Enabled</option>
            <option ${
              settings.enableSpeedMaps === false ? 'selected' : ''
            }>Disabled</option>
            <option value="Default" ${
              settings.enableSpeedMaps == null ? 'selected' : ''
            }>Inherit (Enabled)</option>
          </select>
      </div>
      <div class="settings-editor-input-div">
        <div  title="${Tooltips.minterpModeTooltip}">
          <span>Minterpolation</span>
          <select id="minterp-mode-input">
            <option value="Default" ${
              minterpMode == null ? 'selected' : ''
            }>Inherit (Numeric)</option>
            <option ${minterpMode === 'None' ? 'selected' : ''}>None</option>
            <option value="MaxSpeed" ${
              minterpMode == 'MaxSpeed' ? 'selected' : ''
            }>MaxSpeed</option>
            <option value="VideoFPS" ${
              minterpMode == 'VideoFPS' ? 'selected' : ''
            }>VideoFPS</option>
            <option value="MaxSpeedx2" ${
              minterpMode == 'MaxSpeedx2' ? 'selected' : ''
            }>MaxSpeedx2</option>
            <option value="VideoFPSx2" ${
              minterpMode == 'VideoFPSx2' ? 'selected' : ''
            }>VideoFPSx2</option>
          </select>
        </div>
        <div  title="${Tooltips.minterpFPSTooltip}">
          <span>FPS</span>
          <input id="minterp-fps-input" type="number" min="10" max="120" step="1" value="${
            minterpFPS ?? ''
          }" placeholder="" style="min-width:2em"></input>
        </div>
      </div>
      <div class="settings-editor-input-div multi-input-div" title="${
        Tooltips.vidstabTooltip
      }">
        <div>
          <span>Stabilization</span>
          <select id="video-stabilization-input">
            <option value="Inherit" ${
              vidstabDesc == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
            <option ${vidstabDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option ${vidstabDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${vidstabDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${vidstabDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${
              vidstabDesc === 'Very Strong' ? 'selected' : ''
            }>Very Strong</option>
            <option ${vidstabDesc === 'Strongest' ? 'selected' : ''}>Strongest</option>
          </select>
        </div>
        <div title="${Tooltips.dynamicZoomTooltip}">
          <span>Dynamic Zoom</span>
          <select id="video-stabilization-dynamic-zoom-input"> 
            <option ${vidstabDynamicZoomEnabled ? 'selected' : ''}>Enabled</option>
            <option ${
              vidstabDynamicZoomEnabled === false ? 'selected' : ''
            }>Disabled</option>
            <option value="Default" ${
              vidstabDynamicZoomEnabled == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
          </select>
        </div>
      </div>
      <div class="settings-editor-input-div multi-input-div" title="${
        Tooltips.loopTooltip
      }">
        <div>
          <span>Loop</span>
          <select id="loop-input">
            <option ${settings.loop === 'fwrev' ? 'selected' : ''}>fwrev</option>
            <option ${settings.loop === 'fade' ? 'selected' : ''}>fade</option>
            <option ${settings.loop === 'none' ? 'selected' : ''}>none</option>
            <option value="Default" ${
              settings.loop == null ? 'selected' : ''
            }>Inherit (none)</option>
          </select>
        </div>
        <div title="${Tooltips.fadeDurationTooltip}">
          <span>Fade Duration</span>
          <input id="fade-duration-input" type="number" min="0.1" step="0.1" value="${
            settings.fadeDuration != null ? settings.fadeDuration : ''
          }" placeholder="0.7" style="width:7em"></input>
        </div>
      </div>
    </fieldset>
    `;

      updateSettingsEditorHook();
      settingsEditorHook.insertAdjacentElement('afterend', globalSettingsEditorDiv);

      const settingsInputsConfigs = [['crop-res-input', 'cropRes', 'string']];
      const settingsInputsConfigsHighlightable = [
        ['crop-input', 'newMarkerCrop', 'string'],
        ['speed-input', 'newMarkerSpeed', 'number'],
        ['title-suffix-input', 'titleSuffix', 'string'],
        ['merge-list-input', 'markerPairMergeList', 'string'],
        ['gamma-input', 'gamma', 'number'],
        ['encode-speed-input', 'encodeSpeed', 'number'],
        ['crf-input', 'crf', 'number'],
        ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
        ['rotate-0', 'rotate', 'string'],
        ['rotate-90-clock', 'rotate', 'string'],
        ['rotate-90-counterclock', 'rotate', 'string'],
        ['two-pass-input', 'twoPass', 'ternary'],
        ['audio-input', 'audio', 'ternary'],
        ['expand-color-range-input', 'expandColorRange', 'ternary'],
        ['denoise-input', 'denoise', 'preset'],
        ['enable-speed-maps-input', 'enableSpeedMaps', 'ternary'],
        ['minterp-mode-input', 'minterpMode', 'inheritableString'],
        ['minterp-fps-input', 'minterpFPS', 'number'],
        ['video-stabilization-input', 'videoStabilization', 'preset'],
        [
          'video-stabilization-dynamic-zoom-input',
          'videoStabilizationDynamicZoom',
          'ternary',
        ],
        ['loop-input', 'loop', 'inheritableString'],
        ['fade-duration-input', 'fadeDuration', 'number'],
      ];

      addSettingsInputListeners(settingsInputsConfigs, settings, false);
      addSettingsInputListeners(settingsInputsConfigsHighlightable, settings, true);

      cropInput = document.getElementById('crop-input') as HTMLInputElement;
      cropAspectRatioSpan = document.getElementById(
        'crop-aspect-ratio'
      ) as HTMLSpanElement;

      wasGlobalSettingsEditorOpen = true;
      isSettingsEditorOpen = true;
      addMarkerPairMergeListDurationsListener();
      addCropInputHotkeys();
      highlightModifiedSettings(settingsInputsConfigsHighlightable, settings);
    }
    function addSettingsInputListeners(
      inputs: string[][],
      target,
      highlightable = false
    ) {
      inputs.forEach((input) => {
        const id = input[0];
        const targetProperty = input[1];
        const valueType = input[2] || 'string';
        const inputElem = document.getElementById(id);
        inputElem.addEventListener('focus', () => (isHotkeysEnabled = false), false);
        inputElem.addEventListener('blur', () => (isHotkeysEnabled = true), false);
        inputElem.addEventListener(
          'change',
          (e) =>
            updateSettingsValue(e, id, target, targetProperty, valueType, highlightable),
          false
        );
      });
    }

    const presetsMap = {
      videoStabilization: {
        Disabled: { desc: 'Disabled', enabled: false },
        'Very Weak': {
          desc: 'Very Weak',
          enabled: true,
          shakiness: 2,
          smoothing: 2,
          zoomspeed: 0.05,
        },
        Weak: {
          desc: 'Weak',
          enabled: true,
          shakiness: 4,
          smoothing: 4,
          zoomspeed: 0.1,
        },
        Medium: {
          desc: 'Medium',
          enabled: true,
          shakiness: 6,
          smoothing: 6,
          zoomspeed: 0.2,
        },
        Strong: {
          desc: 'Strong',
          enabled: true,
          shakiness: 8,
          smoothing: 10,
          zoomspeed: 0.3,
        },
        'Very Strong': {
          desc: 'Very Strong',
          enabled: true,
          shakiness: 10,
          smoothing: 16,
          zoomspeed: 0.4,
        },
        Strongest: {
          desc: 'Strongest',
          enabled: true,
          shakiness: 10,
          smoothing: 22,
          zoomspeed: 0.5,
        },
      },
      denoise: {
        Disabled: { enabled: false, desc: 'Disabled' },
        'Very Weak': { enabled: true, lumaSpatial: 1, desc: 'Very Weak' },
        Weak: { enabled: true, lumaSpatial: 2, desc: 'Weak' },
        Medium: { enabled: true, lumaSpatial: 4, desc: 'Medium' },
        Strong: { enabled: true, lumaSpatial: 6, desc: 'Strong' },
        'Very Strong': { enabled: true, lumaSpatial: 8, desc: 'Very Strong' },
      },
    };

    function updateSettingsValue(
      e: Event,
      id: string,
      target: Settings | MarkerPair | MarkerPairOverrides,
      targetProperty: string,
      valueType: string,
      highlightable: boolean
    ) {
      if (e.target.reportValidity()) {
        let newValue = e.target.value;
        if (newValue != null) {
          if (
            targetProperty !== 'titleSuffix' &&
            targetProperty !== 'markerPairMergeList' &&
            newValue === ''
          ) {
            delete target[targetProperty];
            newValue = undefined;
          } else if (valueType === 'number') {
            newValue = parseFloat(newValue);
          } else if (valueType === 'boolean') {
            newValue = e.target.checked;
          } else if (valueType === 'ternary' || valueType === 'inheritableString') {
            if (newValue === 'Default' || newValue === 'Inherit') {
              delete target[targetProperty];
              newValue = undefined;
            } else if (newValue === 'Enabled') {
              newValue = true;
            } else if (newValue === 'Disabled') {
              newValue = false;
            }
          } else if (valueType === 'preset') {
            if (newValue === 'Inherit') {
              delete target[targetProperty];
              newValue = undefined;
            } else {
              newValue = presetsMap[targetProperty][newValue];
            }
          }
        }

        if (targetProperty !== 'crop') target[targetProperty] = newValue;

        if (targetProperty === 'newMarkerCrop') {
          createCropOverlay(target.newMarkerCrop);
        }

        if (targetProperty === 'cropRes') {
          const prevWidth = target.cropResWidth;
          const prevHeight = target.cropResHeight;
          const [newWidth, newHeight] = target.cropRes
            .split('x')
            .map((str) => parseInt(str), 10);
          const cropMultipleX = newWidth / prevWidth;
          const cropMultipleY = newHeight / prevHeight;
          target.cropResWidth = newWidth;
          target.cropResHeight = newHeight;
          multiplyAllCrops(cropMultipleX, cropMultipleY);
        }

        if (targetProperty === 'crop') {
          const prevCrop = target.cropMap[currentCropPointIndex].crop;
          const [ix, iy, iw, ih] = getCropComponents(prevCrop);
          const [x, y, w, h] = getCropComponents(newValue);
          const optArgs = {
            ix,
            iy,
            iw,
            ih,
            minW: null,
            minH: null,
            resizeOnly: true,
            updateCropChart: true,
          };
          updateCrop(x, y, w, h, optArgs);
        }

        if (targetProperty === 'speed') {
          const speedMap = target.speedMap;
          if (speedMap.length === 2 && speedMap[0].y === speedMap[1].y) {
            target.speedMap[1].y = newValue;
          }
          target.speedMap[0].y = newValue;
          speedChartInput.chart && speedChartInput.chart.update();
          updateMarkerPairDuration(target);
        }
      }

      if (highlightable)
        highlightModifiedSettings([[id, targetProperty, valueType]], target);
    }

    function multiplyAllCrops(cropMultipleX: number, cropMultipleY: number) {
      const cropString = settings.newMarkerCrop;
      const multipliedCropString = multiplyCropString(
        cropMultipleX,
        cropMultipleY,
        cropString
      );
      settings.newMarkerCrop = multipliedCropString;
      cropInput.value = multipliedCropString;

      if (markerPairs) {
        markerPairs.forEach((markerPair) => {
          const multipliedCropString = multiplyCropString(
            cropMultipleX,
            cropMultipleY,
            markerPair.crop
          );
          markerPair.crop = multipliedCropString;
          markerPair.cropMap.forEach((cropPoint) => {
            const multipliedCropString = multiplyCropString(
              cropMultipleX,
              cropMultipleY,
              cropPoint.crop
            );
            cropPoint.crop = multipliedCropString;
          });
        });
      }
    }

    function multiplyCropString(
      cropMultipleX: number,
      cropMultipleY: number,
      cropString: string
    ) {
      let [x, y, width, height] = cropString.split(':');
      x = Math.round(x * cropMultipleX);
      y = Math.round(y * cropMultipleY);
      width = width !== 'iw' ? Math.round(width * cropMultipleX) : width;
      height = height !== 'ih' ? Math.round(height * cropMultipleY) : height;
      const multipliedCropString = [x, y, width, height].join(':');
      return multipliedCropString;
    }

    function getMarkerPairMergeListDurations(
      markerPairMergeList = settings.markerPairMergeList
    ) {
      const durations = [];
      for (let merge of markerPairMergeList.split(';')) {
        let duration = 0;
        for (let mergeRange of merge.split(',')) {
          if (mergeRange.includes('-')) {
            let [mergeRangeStart, mergeRangeEnd] = mergeRange
              .split('-')
              .map((str) => parseInt(str, 10) - 1);
            if (mergeRangeStart > mergeRangeEnd) {
              [mergeRangeStart, mergeRangeEnd] = [mergeRangeEnd, mergeRangeStart];
            }
            for (let idx = mergeRangeStart; idx <= mergeRangeEnd; idx++) {
              if (!isNaN(idx) && idx >= 0 && idx < markerPairs.length) {
                const marker = markerPairs[idx];
                duration += (marker.end - marker.start) / marker.speed;
              }
            }
          } else {
            const idx = parseInt(mergeRange, 10) - 1;
            if (!isNaN(idx) && idx >= 0 && idx < markerPairs.length) {
              const marker = markerPairs[idx];
              duration += (marker.end - marker.start) / marker.speed;
            }
          }
        }
        durations.push(duration);
      }
      const markerPairMergelistDurations = durations.map(toHHMMSSTrimmed).join(' ; ');
      return markerPairMergelistDurations;
    }

    function addCropInputHotkeys() {
      cropInput.addEventListener('keydown', (ke: KeyboardEvent) => {
        if (
          ke.code === 'Space' ||
          (!ke.ctrlKey &&
            !ke.altKey &&
            66 <= ke.which &&
            ke.which <= 90 &&
            !(ke.code === 'KeyI' || ke.code === 'KeyW' || ke.code === 'KeyH')) ||
          (ke.which === 65 && (ke.ctrlKey || ke.altKey)) // blur on KeyA with ctrl or alt modifiers
        ) {
          ke.preventDefault();
          ke.stopImmediatePropagation();
          cropInput.blur();
          flashMessage('Auto blurred crop input focus', 'olive');
          return;
        }

        if (
          ke.code === 'ArrowUp' ||
          ke.code === 'ArrowDown' ||
          (ke.code === 'KeyA' && !ke.ctrlKey && !ke.altKey)
        ) {
          ke.preventDefault();
          ke.stopImmediatePropagation();
          let cropString = cropInput.value;
          let cropStringArray = cropString.split(':');
          const initialCropArray = getCropComponents(cropString);
          let cropArray = [...initialCropArray];
          const cropStringCursorPos = ke.target.selectionStart;
          let cropComponentCursorPos = cropStringCursorPos;
          let cropTarget = 0;
          while (cropComponentCursorPos - (cropStringArray[cropTarget].length + 1) >= 0) {
            cropComponentCursorPos -= cropStringArray[cropTarget].length + 1;
            cropTarget++;
          }

          const isValidCropTarget =
            cropTarget >= 0 &&
            cropTarget <= cropArray.length - 1 &&
            typeof cropArray[cropTarget] === 'number';
          if (!isValidCropTarget) return;

          if (ke.code === 'KeyA' && !wasGlobalSettingsEditorOpen) {
            const [ix, iy, iw, ih] = initialCropArray;
            if (
              cropTarget === 0 ||
              cropTarget === 1 ||
              (!isCropChartPanOnly && (cropTarget === 2 || cropTarget === 3))
            ) {
              const markerPair = markerPairs[prevSelectedMarkerPairIndex];
              const cropMap = markerPair.cropMap;
              cropMap.forEach((cropPoint, idx) => {
                if (
                  (!ke.shiftKey && idx <= currentCropPointIndex) ||
                  (ke.shiftKey && idx >= currentCropPointIndex)
                ) {
                  return;
                }
                let [x, y, w, h] = getCropComponents(cropPoint.crop);
                if (cropTarget === 0) x = ix;
                if (cropTarget === 1) y = iy;
                if (cropTarget === 2 || cropTarget === 3) {
                  w = iw;
                  h = ih;
                }
                cropPoint.crop = [x, y, w, h].join(':');
                if (idx === 0) markerPair.crop = cropPoint.crop;
              });
              updateCropChart();
            }

            const targetPointsMsg = `${ke.shiftKey ? 'preceding' : 'following'} point ${
              currentCropPointIndex + 1
            }`;
            if (cropTarget === 0)
              flashMessage(
                `Updated X values of crop points ${targetPointsMsg} to ${ix}`,
                'green'
              );
            if (cropTarget === 1)
              flashMessage(
                `Updated Y values crop points ${targetPointsMsg} Y values to ${iy}`,
                'green'
              );
            if (!isCropChartPanOnly && (cropTarget === 2 || cropTarget === 3))
              flashMessage(
                `Updated size of all crop points ${targetPointsMsg} to ${ih}x${iw}`,
                'green'
              );
            if (isCropChartPanOnly && (cropTarget === 2 || cropTarget === 3)) {
              flashMessage(
                `All crop points have the same size in pan-only mode`,
                'olive'
              );
            }
          } else if (ke.code === 'ArrowUp' || ke.code === 'ArrowDown') {
            let changeAmount: number;
            if (!ke.altKey && !ke.shiftKey) {
              changeAmount = 10;
            } else if (ke.altKey && !ke.shiftKey) {
              changeAmount = 1;
            } else if (!ke.altKey && ke.shiftKey) {
              changeAmount = 50;
            } else if (ke.altKey && ke.shiftKey) {
              changeAmount = 100;
            }

            if (ke.code === 'ArrowUp') {
              cropArray[cropTarget] += changeAmount;
            } else if (ke.code === 'ArrowDown') {
              cropArray[cropTarget] -= changeAmount;
            }

            const [nx, ny, nw, nh] = cropArray;
            updateCrop(nx, ny, nw, nh);
            const updatedCropString = cropInput.value;
            let newCursorPos = cropStringCursorPos - cropComponentCursorPos;
            if (cropTarget === 3 && cropStringArray[3] === 'ih') {
              const cropStringLengthDelta = updatedCropString.length - cropString.length;
              const cursorPosAdjustment = cropStringLengthDelta - cropComponentCursorPos;
              newCursorPos += cursorPosAdjustment;
            }
            cropInput.selectionStart = newCursorPos;
            cropInput.selectionEnd = newCursorPos;
            cropInput.dispatchEvent(new Event('change'));
          }
        }
      });
    }

    function addMarkerPairMergeListDurationsListener() {
      const markerPairMergeListInput = document.getElementById('merge-list-input');
      const markerPairMergeListDurationsSpan = document.getElementById(
        'merge-list-durations'
      );
      markerPairMergeListInput.addEventListener('change', () => {
        const markerPairMergelistDurations = getMarkerPairMergeListDurations();
        markerPairMergeListDurationsSpan.textContent = markerPairMergelistDurations;
      });
    }

    let shortcutsTableToggleButton: HTMLButtonElement;
    function injectToggleShortcutsTableButton() {
      const ytpRightControls = document.getElementsByClassName('ytp-right-controls')[0];
      shortcutsTableToggleButton = htmlToElement(
        shortcutsTableToggleButtonHTML
      ) as HTMLButtonElement;
      shortcutsTableToggleButton.onclick = toggleShortcutsTable;
      ytpRightControls.insertAdjacentElement('afterbegin', shortcutsTableToggleButton);
    }

    function showShortcutsTableToggleButton() {
      if (shortcutsTableToggleButton) {
        shortcutsTableToggleButton.style.display = 'inline-block';
      }
    }
    function hideShortcutsTableToggleButton() {
      if (shortcutsTableToggleButton) {
        shortcutsTableToggleButton.style.display = 'none';
      }
    }

    let shortcutsTableContainer: HTMLDivElement;
    function toggleShortcutsTable() {
      if (!shortcutsTableContainer) {
        injectCSS(shortcutsTableStyle, 'shortcutsTableStyle');
        shortcutsTableContainer = document.createElement('div');
        shortcutsTableContainer.setAttribute('id', 'shortcutsTableContainer');
        shortcutsTableContainer.innerHTML = shortcutsTable;
        flashMessageHook.insertAdjacentElement('afterend', shortcutsTableContainer);
      } else if (shortcutsTableContainer.style.display !== 'none') {
        shortcutsTableContainer.style.display = 'none';
      } else {
        shortcutsTableContainer.style.display = 'block';
      }
    }

    const frameCaptureViewerHeadHTML = `\
      <title>yt_clipper Frame Capture Viewer</title>
      <style>
        body {
          margin: 0px;
          text-align: center;
        }
        #frames-div {
          font-family: Helvetica;
          background-color: rgb(160,50,20);
          margin: 0 auto;
          padding: 2px;
          width: 99%;
          text-align: center;
        }
        .frame-div {
          margin: 2px;
          padding: 2px;
          border: 2px black solid;
          font-weight: bold;
          color: black;
          text-align: center;
        }
        figcaption {
          display: inline-block;
          margin: 2px;
        }
        button {
          display: inline-block;
          font-weight: bold;
          margin-bottom: 2px;
          cursor: pointer;
          border: 2px solid black;
          border-radius: 4px;
        }
        button.download {
          background-color: rgb(66, 134, 244);
        }
        button.delete {
          background-color: red;
        }
        button:hover {
          box-shadow: 2px 4px 4px 0 rgba(0,0,0,0.2);
        }
        canvas {
          display: block;
          margin: 0 auto;
          ${player.getVideoAspectRatio() > 1 ? 'width: 98%;' : 'height: 96vh;'}
        }
        @keyframes flash {
          0% {
            opacity: 1;
          }
          100% {
            opacity: 0.5;
          }
        }
        .flash-div {
          animation-name: flash;
          animation-duration: 0.5s;
          animation-fill-mode: forwards;
        }
        </style>
      `;
    const frameCaptureViewerBodyHTML = `\
        <div id="frames-div"><strong></strong></div>
        `;
    let frameCaptureViewer: Window;
    let frameCaptureViewerDoc: Document;
    async function captureFrame() {
      const currentTime = video.currentTime;
      for (let i = 0; i < video.buffered.length; i++) {
        console.log(video.buffered.start(i), video.buffered.end(i));
        if (
          video.buffered.start(i) <= currentTime &&
          currentTime <= video.buffered.end(i)
        ) {
          break;
        }

        if (i === video.buffered.length - 1) {
          flashMessage(
            'Frame not captured. Video has not yet buffered the frame.',
            'red'
          );
          return;
        }
      }

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      let resString: string;
      if (isSettingsEditorOpen) {
        const cropMultipleX = video.videoWidth / settings.cropResWidth;
        const cropMultipleY = video.videoHeight / settings.cropResHeight;
        if (!wasGlobalSettingsEditorOpen) {
          const idx = parseInt(prevSelectedEndMarker.getAttribute('idx'), 10) - 1;
          const markerPair = markerPairs[idx];
          resString = multiplyCropString(cropMultipleX, cropMultipleY, markerPair.crop);
        } else {
          resString = multiplyCropString(
            cropMultipleX,
            cropMultipleY,
            settings.newMarkerCrop
          );
        }
        const [x, y, w, h] = getCropComponents(resString);
        canvas.width = w;
        canvas.height = h;
        if (h > w) {
          canvas.style.height = '96vh';
          canvas.style.width = 'auto';
        }
        context.drawImage(video, x, y, w, h, 0, 0, w, h);
        resString = `x${x}y${y}w${w}h${h}`;
      } else {
        resString = `x0y0w${video.videoWidth}h${video.videoHeight}`;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      }
      if (!frameCaptureViewer || !frameCaptureViewerDoc || frameCaptureViewer.closed) {
        frameCaptureViewer = window.open(
          '',
          'window',
          `height=${window.innerHeight}, width=${window.innerWidth}`
        );
        frameCaptureViewer.downloadFrame = (btn: HTMLButtonElement) => {
          const frameCanvas = btn.parentElement.querySelector('canvas');
          frameCanvas.toBlob((blob) => saveAs(blob, frameCanvas.fileName));
        };
        frameCaptureViewer.deleteFrame = (btn: HTMLButtonElement) => {
          const frameDiv = btn.parentElement;
          frameDiv.setAttribute('class', 'frame-div flash-div');
          setTimeout(() => deleteElement(frameDiv), 300);
        };
        frameCaptureViewerDoc = frameCaptureViewer.document;
        frameCaptureViewerDoc.head.innerHTML = frameCaptureViewerHeadHTML;
        frameCaptureViewerDoc.body.innerHTML = frameCaptureViewerBodyHTML;
      }
      const frameDiv = document.createElement('div');
      frameDiv.setAttribute('class', 'frame-div');
      const frameCount = getFrameCount(currentTime);
      const frameFileName = `${
        settings.titleSuffix
      }-${resString}-@${currentTime}s(${toHHMMSSTrimmed(currentTime).replace(
        ':',
        ';'
      )})-f${frameCount.frameNumber}(${frameCount.totalFrames})`;
      frameDiv.innerHTML = `\
      <figcaption>Resolution: ${canvas.width}x${canvas.height} Name: ${frameFileName}</figcaption>
      <button class="download" onclick="downloadFrame(this)">Download Frame</button>
      <button class="delete" onclick="deleteFrame(this)">Delete Frame</button>
      `;

      canvas.fileName = `${frameFileName}.png`;
      const framesDiv = frameCaptureViewerDoc.getElementById('frames-div');
      frameDiv.appendChild(canvas);
      framesDiv.appendChild(frameDiv);
      flashMessage(`Captured frame: ${frameFileName}`, 'green');
    }

    function getFrameCount(seconds: number) {
      let fps = getFPS(null);
      let frameNumber: number | string;
      let totalFrames: number | string;
      if (fps) {
        frameNumber = Math.floor(seconds * fps);
        totalFrames = Math.floor(video.duration * fps);
      } else {
        frameNumber = 'Unknown';
        totalFrames = 'Unknown';
      }
      return { frameNumber, totalFrames };
    }

    function canvasBlobToPromise(canvas: HTMLCanvasElement): Promise<Blob> {
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob));
      });
    }

    let isFrameCapturerZippingInProgress = false;
    function saveCapturedFrames() {
      if (isFrameCapturerZippingInProgress) {
        flashMessage(
          'Frame Capturer zipping already in progress. Please wait before trying to zip again.',
          'red'
        );
        return;
      }
      if (!frameCaptureViewer || frameCaptureViewer.closed || !frameCaptureViewerDoc) {
        flashMessage(
          'Frame capturer not open. Please capture a frame before zipping.',
          'olive'
        );
        return;
      }
      const zip = new JSZip();
      const framesZip = zip.folder(settings.titleSuffix).folder('frames');
      const frames = frameCaptureViewerDoc.getElementsByTagName('canvas');
      if (frames.length === 0) {
        flashMessage('No frames to zip.', 'olive');
        return;
      }

      isFrameCapturerZippingInProgress = true;
      Array.from(frames).forEach((frame) => {
        framesZip.file(frame.fileName, canvasBlobToPromise(frame), { binary: true });
      });
      const progressDiv = injectProgressBar('green');
      const progressSpan = progressDiv.firstElementChild;
      zip
        .generateAsync({ type: 'blob' }, (metadata) => {
          const percent = metadata.percent.toFixed(2) + '%';
          progressSpan.textContent = `Frame Capturer Zipping Progress: ${percent}`;
        })
        .then((blob) => {
          saveAs(blob, `${settings.titleSuffix}-frames.zip`);
          progressDiv.dispatchEvent(new Event('done'));
          isFrameCapturerZippingInProgress = false;
        });
    }

    function injectProgressBar(color: string) {
      const progressDiv = document.createElement('div');
      progressDiv.setAttribute('class', 'msg-div');
      progressDiv.addEventListener('done', () => {
        progressDiv.setAttribute('class', 'msg-div flash-div');
        setTimeout(() => deleteElement(progressDiv), 2500);
      });
      progressDiv.innerHTML = `<span class="flash-msg" style="color:${color}"> Frame Capturer Zipping Progress: 0%</span>`;
      flashMessageHook.insertAdjacentElement('beforebegin', progressDiv);
      return progressDiv;
    }

    let cropSvg: SVGSVGElement;
    let cropDim: SVGRectElement;
    let cropRect: Element;
    let cropRectBorderBlack: Element;
    let cropRectBorderWhite: Element;
    let cropChartSectionStart: Element;
    let cropChartSectionStartBorderGreen: Element;
    let cropChartSectionStartBorderWhite: Element;
    let cropChartSectionEnd: Element;
    let cropChartSectionEndBorderYellow: Element;
    let cropChartSectionEndBorderWhite: Element;
    function createCropOverlay(cropString: string) {
      deleteCropOverlay();

      const cropDiv = document.createElement('div');
      cropDiv.setAttribute('id', 'crop-div');
      cropDiv.innerHTML = `\
        <svg id="crop-svg">
          <defs>
            <mask id="cropMask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect id="cropRect" x="0" y="0" width="100%" height="100%" fill="black" />
            </mask>
          </defs>
          <rect id="cropDim" mask="url(#cropMask)" x="0" y="0" width="100%" height="100%" 
            fill="black" fill-opacity="${cropDims[cropDimIndex]}"
          />

          <g id="cropChartSectionStart" opacity="0.7">
            <rect id="cropChartSectionStartBorderGreen" x="0" y="0" width="0%" height="0%" fill="none" 
              stroke="lime" shape-rendering="geometricPrecision" stroke-width="1px"
            />
            <rect id="cropChartSectionStartBorderWhite" x="0" y="0" width="0%" height="0%" fill="none" 
              stroke="black" shape-rendering="geometricPrecision" stroke-width="1px" stroke-dasharray="5 10"
            />
          </g>
          <g id="cropChartSectionEnd" opacity="0.7">
            <rect id="cropChartSectionEndBorderYellow" x="0" y="0" width="0%" height="0%" fill="none" 
              stroke="yellow" shape-rendering="geometricPrecision" stroke-width="1px"
            />
            <rect id="cropChartSectionEndBorderWhite" x="0" y="0" width="0%" height="0%" fill="none" 
              stroke="black" shape-rendering="geometricPrecision" stroke-width="1px" stroke-dasharray="5 10" 
            />
          </g>


          <rect id="cropRectBorderBlack" x="0" y="0" width="100%" height="100%" fill="none" 
            stroke="black" shape-rendering="geometricPrecision" stroke-width="1px" stroke-opacity="0.8"
          />
          <rect id="cropRectBorderWhite" x="0" y="0" width="100%" height="100%" fill="none" 
          stroke="white" shape-rendering="geometricPrecision" stroke-width="1px" stroke-dasharray="5 5" stroke-opacity="0.8"
          />
        </svg>
      `;
      resizeCropOverlay(cropDiv);
      overlayHook.insertAdjacentElement('afterend', cropDiv);
      window.addEventListener('resize', () => resizeCropOverlay(cropDiv));
      cropSvg = cropDiv.firstElementChild as SVGSVGElement;
      cropDim = document.getElementById('cropDim');
      cropRect = document.getElementById('cropRect') as Element;
      cropRectBorderBlack = document.getElementById('cropRectBorderBlack') as Element;
      cropRectBorderWhite = document.getElementById('cropRectBorderWhite') as Element;

      cropChartSectionStart = document.getElementById('cropChartSectionStart') as Element;
      cropChartSectionStartBorderGreen = document.getElementById(
        'cropChartSectionStartBorderGreen'
      ) as Element;
      cropChartSectionStartBorderWhite = document.getElementById(
        'cropChartSectionStartBorderWhite'
      ) as Element;
      cropChartSectionEnd = document.getElementById('cropChartSectionEnd') as Element;
      cropChartSectionEndBorderYellow = document.getElementById(
        'cropChartSectionEndBorderYellow'
      ) as Element;
      cropChartSectionEndBorderWhite = document.getElementById(
        'cropChartSectionEndBorderWhite'
      ) as Element;

      [cropRect, cropRectBorderBlack, cropRectBorderWhite].map((cropRect) =>
        setCropOverlay(cropRect, cropString)
      );
      isCropOverlayVisible = true;
    }

    function resizeCropOverlay(cropDiv: HTMLDivElement) {
      requestAnimationFrame(() => forceRerenderCrop(cropDiv));
    }

    function forceRerenderCrop(cropDiv: HTMLDivElement) {
      const { width, height, top, left } = video.style;
      Object.assign(cropDiv.style, { width, height, top, left, position: 'absolute' });
      if (cropSvg) {
        cropSvg.setAttribute('width', '0');
      }
    }

    function setCropOverlay(cropRect: Element, cropString: string) {
      const [x, y, w, h] = getCropComponents(cropString);
      setCropOverlayDimensions(cropRect, x, y, w, h);
    }

    function setCropOverlayDimensions(
      cropRect: Element,
      x: number,
      y: number,
      w: number,
      h: number
    ) {
      if (cropRect) {
        const cropRectAttrs = {
          x: `${(x / settings.cropResWidth) * 100}%`,
          y: `${(y / settings.cropResHeight) * 100}%`,
          width: `${(w / settings.cropResWidth) * 100}%`,
          height: `${(h / settings.cropResHeight) * 100}%`,
        };
        setAttributes(cropRect, cropRectAttrs);
      }
    }

    const cropDims = [0, 0.25, 0.5, 0.75, 0.9, 1];
    let cropDimIndex = 2;
    function cycleCropDimOpacity() {
      cropDimIndex = (cropDimIndex + 1) % cropDims.length;
      cropDim.setAttribute('fill-opacity', cropDims[cropDimIndex].toString());
    }

    function showCropOverlay() {
      if (cropSvg) {
        cropSvg.style.display = 'block';
        isCropOverlayVisible = true;
      }
    }

    function hideCropOverlay() {
      if (isDrawingCrop) {
        finishDrawingCrop(prevCropString);
      }
      if (isDraggingCrop) {
        endCropOverlayDrag(null, true);
      }
      if (cropSvg) {
        cropSvg.style.display = 'none';
        isCropOverlayVisible = false;
      }
    }

    function deleteCropOverlay() {
      const cropDiv = document.getElementById('crop-div');
      deleteElement(cropDiv);
      isCropOverlayVisible = false;
    }

    let isDrawingCrop = false;
    let prevCropString = '0:0:iw:ih';
    let beginDrawHandler: (e: PointerEvent) => void;
    function drawCropOverlay(verticalFill: boolean) {
      if (isDrawingCrop) {
        finishDrawingCrop(prevCropString);
      } else if (
        isCurrentChartVisible &&
        currentChartInput &&
        currentChartInput.type !== 'crop'
      ) {
        flashMessage('Please toggle off the speed chart before drawing crop', 'olive');
      } else if (isDraggingCrop) {
        flashMessage('Please finish dragging or resizing before drawing crop', 'olive');
      } else if (isSettingsEditorOpen && isCropOverlayVisible) {
        isDrawingCrop = true;
        if (!wasGlobalSettingsEditorOpen) {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const cropMap = markerPair.cropMap;
          prevCropString = markerPair.crop;
          cropMap.forEach((cropPoint) => {
            cropPoint.prevCrop = cropPoint.crop;
          });
        } else {
          prevCropString = settings.newMarkerCrop;
        }
        window.removeEventListener('keydown', addCropOverlayHoverListener, true);
        window.removeEventListener('mousemove', cropOverlayHoverHandler, true);
        hidePlayerControls();
        video.style.removeProperty('cursor');
        playerInfo.videoContainer.style.cursor = 'crosshair';
        beginDrawHandler = (e: PointerEvent) => beginDraw(e, verticalFill);
        playerInfo.container.addEventListener('pointerdown', beginDrawHandler, {
          once: true,
          capture: true,
        });
        flashMessage('Begin drawing crop', 'green');
      } else {
        flashMessage(
          'Please open the global settings or a marker pair editor before drawing crop',
          'olive'
        );
      }
    }

    function hidePlayerControls() {
      playerInfo.controls.style.display = 'none';
      playerInfo.gradientBottom.style.display = 'none';
    }
    function showPlayerControls() {
      playerInfo.controls.style.display = 'block';
      playerInfo.gradientBottom.style.display = 'block';
    }

    let dragCropPreviewHandler: EventListener;
    function beginDraw(e: PointerEvent, verticalFill: boolean) {
      if (e.button == 0 && !dragCropPreviewHandler) {
        e.preventDefault();
        video.setPointerCapture(e.pointerId);

        const videoRect = player.getVideoContentRect();
        const playerRect = player.getBoundingClientRect();
        const ix = e.pageX - videoRect.left - playerRect.left;
        const iy = e.pageY - videoRect.top - playerRect.top;
        let ixScaled = Math.round((ix / videoRect.width) * settings.cropResWidth);
        let iyScaled = 0;
        if (!verticalFill) {
          iyScaled = Math.round((iy / videoRect.height) * settings.cropResHeight);
        }
        ixScaled = clampNumber(ixScaled, 0, settings.cropResWidth);
        iyScaled = clampNumber(iyScaled, 0, settings.cropResHeight);

        if (!wasGlobalSettingsEditorOpen) {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const cropMap = markerPair.cropMap;

          if (
            isCropChartPanOnly &&
            (!isStaticCrop(cropMap) || currentCropPointIndex !== 0)
          ) {
            cropMap.forEach((cropPoint, idx) => {
              let [ix, iy, ,] = getCropComponents(cropPoint.crop);
              cropPoint.crop = [ix, iy, 0, 0].join(':');
              cropPoint.initCrop = cropPoint.crop;
            });
          }
        }

        const [px, py, ,] = getCropComponents(prevCropString);
        const optArgs = {
          ix: px,
          iy: py,
          iw: 0,
          ih: 0,
          minW: 0,
          minH: 0,
          resizeOnly: true,
          updateCropChart: false,
        };
        updateCrop(ixScaled, iyScaled, 0, 0, optArgs);

        dragCropPreviewHandler = function (e: PointerEvent) {
          let endX = Math.round(
            ((e.pageX - videoRect.left - playerRect.left) / videoRect.width) *
              settings.cropResWidth
          );
          let endY = settings.cropResHeight;
          if (!verticalFill) {
            endY = Math.round(
              ((e.pageY - videoRect.top - playerRect.top) / videoRect.height) *
                settings.cropResHeight
            );
          }

          endX = clampNumber(endX, 0, settings.cropResWidth);
          endY = clampNumber(endY, 0, settings.cropResHeight);
          let x: number, y: number, w: number, h: number;
          if (endX > ixScaled) {
            x = ixScaled;
            w = endX - x;
          } else {
            x = endX;
            w = ixScaled - x;
          }
          if (endY > iyScaled) {
            y = iyScaled;
            h = endY - y;
          } else {
            y = endY;
            h = iyScaled - y;
          }
          const optArgs = {
            ix: x,
            iy: y,
            iw: 0,
            ih: 0,
            minW: 0,
            minH: 0,
            resizeOnly: true,
            updateCropChart: false,
          };
          updateCrop(x, y, w, h, optArgs);
        };

        window.addEventListener('pointermove', dragCropPreviewHandler);

        window.addEventListener('pointerup', endDraw, {
          once: true,
          capture: true,
        });

        // exact event listener reference only added once so remove not required
        document.addEventListener('click', blockVideoPause, {
          once: true,
          capture: true,
        });
      } else {
        finishDrawingCrop(prevCropString);
      }
    }

    function blockVideoPause(e) {
      e.stopImmediatePropagation();
    }

    function endDraw(e: PointerEvent) {
      if (e.button === 0) {
        finishDrawingCrop(null, e.pointerId);
      } else {
        finishDrawingCrop(prevCropString, e.pointerId);
      }
      if (e.ctrlKey) {
        window.addEventListener('mousemove', cropOverlayHoverHandler, true);
      }
    }

    function finishDrawingCrop(prevCropString?: string, pointerId?: number) {
      if (pointerId) video.releasePointerCapture(pointerId);
      playerInfo.videoContainer.style.cursor = 'auto';
      playerInfo.container.removeEventListener('pointerdown', beginDrawHandler, true);
      window.removeEventListener('pointermove', dragCropPreviewHandler);
      window.removeEventListener('pointerup', endDraw, true);
      dragCropPreviewHandler = null;
      isDrawingCrop = false;
      showPlayerControls();
      window.addEventListener('keydown', addCropOverlayHoverListener, true);
      if (prevCropString) {
        updateCropString(prevCropString);
        if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
          markerPairs[prevSelectedMarkerPairIndex].cropMap.forEach((cropPoint) => {
            cropPoint.crop = cropPoint.prevCrop;
          });
        }
        flashMessage('Drawing crop canceled', 'red');
      } else {
        cropInput.dispatchEvent(new Event('change'));
        flashMessage('Finished drawing crop', 'green');
      }

      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
        markerPairs[prevSelectedMarkerPairIndex].cropMap.forEach((cropPoint) => {
          delete cropPoint.prevCrop;
          delete cropPoint.initCrop;
        });
      }
    }

    function updateCropString(cropString) {
      const [x, y, w, h] = getCropComponents(cropString);
      updateCrop(x, y, w, h);
    }

    function updateCrop(
      nx: number,
      ny: number,
      nw: number,
      nh: number,
      optArgs?: {
        ix: number;
        iy: number;
        iw: number;
        ih: number;
        minW: number;
        minH: number;
        resizeOnly?: boolean;
        updateCropChart?: boolean;
      }
    ) {
      if (isSettingsEditorOpen) {
        const [ix, iy, iw, ih] = getCropComponents(cropInput.value);
        optArgs = optArgs ?? {
          ix,
          iy,
          iw,
          ih,
          minW: null,
          minH: null,
          resizeOnly: false,
          updateCropChart: true,
        };

        const { cx, cy, cw, ch, dx, dy, dw, dh, isDrag } = clampCropChange(
          nx,
          ny,
          nw,
          nh,
          optArgs
        );

        [nx, ny, nw, nh] = [cx, cy, cw, ch];
        let newCropString = [nx, ny, nw, nh].join(':');

        if (!wasGlobalSettingsEditorOpen) {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const cropMap = markerPair.cropMap;
          if (currentCropPointIndex === 0 && isStaticCrop(cropMap)) {
            cropMap[1].crop = newCropString;
          } else if (isCropChartPanOnly) {
            const deltas = isDrag ? null : { dx, dy, dw, dh };
            if (deltas) {
              cropMap.forEach((cropPoint, idx) => {
                if (idx === currentCropPointIndex) return;
                let [ix, iy, iw, ih] = getCropComponents(cropPoint.initCrop);
                if (!optArgs.resizeOnly) {
                  ix += deltas.dx;
                  iy += deltas.dy;
                }
                iw += deltas.dw;
                ih += deltas.dh;
                cropPoint.crop = [ix, iy, iw, ih].join(':');
                if (idx === 0) markerPair.crop = cropPoint.crop;
              });
            }
          } else {
          }

          cropMap[currentCropPointIndex].crop = newCropString;
          if (currentCropPointIndex === 0) markerPair.crop = newCropString;
        } else {
          settings.newMarkerCrop = newCropString;
        }
        cropInput.value = newCropString;
        [cropRect, cropRectBorderBlack, cropRectBorderWhite].map((cropRect) =>
          setCropOverlayDimensions(cropRect, nx, ny, nw, nh)
        );
        const cropAspectRatio = (nw / nh).toFixed(13);
        cropAspectRatioSpan && (cropAspectRatioSpan.textContent = cropAspectRatio);
        if (optArgs.updateCropChart) updateCropChart();
      } else {
        throw new Error('No editor was open when trying to update crop.');
      }
    }

    function updateCropChart() {
      if (
        isCurrentChartVisible &&
        currentChartInput &&
        currentChartInput.chart &&
        currentChartInput.type === 'crop'
      ) {
        currentChartInput.chart.update();
      }
    }

    function clampCropChange(nx, ny, nw, nh, { ix, iy, iw, ih, minW, minH }) {
      let [minX, minY] = [0, 0];
      if (minW == null || minH == null) {
        ({ minW, minH } = getMinWH());
      }
      let dx = nx - ix;
      let dy = ny - iy;
      let dw = nw - iw;
      let dh = nh - ih;

      const isDrag = dw === 0 && dh === 0;
      const isWestResize = dx !== 0 && dw !== 0;
      const isNorthResize = dy !== 0 && dh !== 0;
      let { maxX, maxY, maxW, maxH } = getCropMaxBounds(
        ix,
        iy,
        iw,
        ih,
        minW,
        minH,
        isDrag,
        isWestResize,
        isNorthResize
      );
      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen && !isDrag) {
        if (!isCropChartPanOnly) {
          const iAspectRatio = iw / ih;
          const nAspectRatio = nw / nh;
          if (Math.abs(nAspectRatio - iAspectRatio) > 1e-13) {
            if (iw === nw) {
              nw = Math.round(iAspectRatio * nh);
            } else {
              nh = Math.round(nw / iAspectRatio);
            }
          }
        } else {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const cropMap = markerPair.cropMap;

          cropMap.forEach((cropPoint) => {
            const [ixcp, iycp, iwcp, ihcp] = getCropComponents(cropPoint.initCrop);

            const {
              // maxX: maxXCP,
              // maxY: maxYCP,
              maxW: maxWCP,
              maxH: maxHCP,
            } = getCropMaxBounds(
              ixcp,
              iycp,
              iwcp,
              ihcp,
              minW,
              minH,
              isDrag,
              isWestResize,
              isNorthResize
            );
            // maxX = dx != 0 ? Math.min(maxX, maxXCP) : maxX;
            minX = dx != 0 ? Math.max(minX, ix - ixcp) : minX;
            // maxY = dy != 0 ? Math.min(maxY, maxYCP) : maxY;
            minY = dy != 0 ? Math.max(minY, iy - iycp) : minY;
            maxW = dw != 0 ? Math.min(maxW, maxWCP) : maxW;
            maxH = dh != 0 ? Math.min(maxH, maxHCP) : maxH;
          });
        }
      }

      const cx = nx != null ? clampNumber(nx, minX, maxX) : null;
      const cy = ny != null ? clampNumber(ny, minY, maxY) : null;
      const cw = nw != null ? clampNumber(nw, minW, maxW) : null;
      const ch = nh != null ? clampNumber(nh, minH, maxH) : null;

      dx = cx - ix;
      dy = cy - iy;
      dw = cw - iw;
      dh = ch - ih;
      return { cx, cy, cw, ch, dx, dy, dw, dh, isDrag };
    }

    function getCropMaxBounds(
      ix,
      iy,
      iw,
      ih,
      minW,
      minH,
      isDrag = false,
      isWestResize,
      isNorthResize
    ) {
      const maxX = isDrag ? settings.cropResWidth - iw : ix + iw - minW;
      const maxY = isDrag ? settings.cropResHeight - ih : iy + ih - minH;
      const maxW = isWestResize ? ix + iw : settings.cropResWidth - ix;
      const maxH = isNorthResize ? iy + ih : settings.cropResHeight - iy;
      return { maxX, maxY, minW, maxW, minH, maxH };
    }

    let arrowKeyCropAdjustmentEnabled = false;
    function toggleArrowKeyCropAdjustment() {
      if (arrowKeyCropAdjustmentEnabled) {
        document.removeEventListener('keydown', arrowKeyCropAdjustmentHandler, true);
        flashMessage('Disabled crop adjustment with arrow keys', 'red');
        arrowKeyCropAdjustmentEnabled = false;
      } else {
        document.addEventListener('keydown', arrowKeyCropAdjustmentHandler, true);
        flashMessage('Enabled crop adjustment with arrow keys', 'green');
        arrowKeyCropAdjustmentEnabled = true;
      }
    }

    function arrowKeyCropAdjustmentHandler(ke: KeyboardEvent) {
      if (isSettingsEditorOpen) {
        if (
          cropInput !== document.activeElement &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(ke.code) > -1
        ) {
          ke.preventDefault();
          ke.stopImmediatePropagation();
          let [x, y, w, h] = getCropComponents(cropInput.value);
          let changeAmount: number;
          if (!ke.altKey && !ke.shiftKey) {
            changeAmount = 10;
          } else if (ke.altKey && !ke.shiftKey) {
            changeAmount = 1;
          } else if (!ke.altKey && ke.shiftKey) {
            changeAmount = 50;
          } else if (ke.altKey && ke.shiftKey) {
            changeAmount = 100;
          }
          // without modifiers move crop x/y offset
          // with ctrl key modifier expand/shrink crop width/height
          let cropTarget: string;
          if (!ke.ctrlKey) {
            switch (ke.code) {
              case 'ArrowUp':
                y -= changeAmount;
                cropTarget = 'y';
                break;
              case 'ArrowDown':
                y += changeAmount;
                cropTarget = 'y';
                break;
              case 'ArrowLeft':
                x -= changeAmount;
                cropTarget = 'x';
                break;
              case 'ArrowRight':
                x += changeAmount;
                cropTarget = 'x';
                break;
            }
          } else {
            switch (ke.code) {
              case 'ArrowUp':
                h -= changeAmount;
                cropTarget = 'h';
                break;
              case 'ArrowDown':
                h += changeAmount;
                cropTarget = 'h';
                break;
              case 'ArrowLeft':
                w -= changeAmount;
                cropTarget = 'w';
                break;
              case 'ArrowRight':
                w += changeAmount;
                cropTarget = 'w';
                break;
            }
          }
          updateCrop(x, y, w, h);
        }
      }
    }

    function getCropComponents(cropString?: string) {
      if (!cropString && isSettingsEditorOpen) {
        if (!wasGlobalSettingsEditorOpen && prevSelectedMarkerPairIndex != null) {
          cropString = markerPairs[prevSelectedMarkerPairIndex].crop;
        } else {
          cropString = settings.newMarkerCrop;
        }
      }

      if (!cropString) {
        console.error('No valid crop string to extract components from.');
        cropString = '0:0:iw:ih';
      }

      const cropArray = cropString.split(':').map((cropStringComponent) => {
        let cropComponent: number;
        if (cropStringComponent === 'iw') {
          cropComponent = settings.cropResWidth;
        } else if (cropStringComponent === 'ih') {
          cropComponent = settings.cropResHeight;
        } else {
          cropComponent = parseInt(cropStringComponent, 10);
        }
        return cropComponent;
      });
      return cropArray;
    }

    let speedChartInput: ChartInput = {
      chart: null,
      type: 'speed',
      chartContainer: null,
      chartContainerId: 'speedChartContainer',
      chartContainerHook: null,
      chartContainerHookPosition: 'afterend',
      chartContainerStyle:
        'width: 100%; height: calc(100% - 20px); position: relative; z-index: 12',
      chartCanvasHTML: `<canvas id="speedChartCanvas" width="1600px" height="900px"></canvas>`,
      chartSpec: speedChartSpec,
      chartCanvasId: 'speedChartCanvas',
      minBound: 0,
      maxBound: 0,
      chartLoopKey: 'speedChartLoop',
      dataMapKey: 'speedMap',
    };

    let isCropChartPanOnly = true;
    let cropChartInput: ChartInput = {
      chart: null,
      type: 'crop',
      chartContainer: null,
      chartContainerId: 'cropChartContainer',
      chartContainerHook: null,
      chartContainerHookPosition: 'beforebegin',
      chartContainerStyle: 'display:flex',
      chartCanvasHTML: `<canvas id="cropChartCanvas" width="1600px" height="87px"></canvas>`,
      chartCanvasId: 'cropChartCanvas',
      chartSpec: getCropChartConfig(isCropChartPanOnly),
      minBound: 0,
      maxBound: 0,
      chartLoopKey: 'cropChartLoop',
      dataMapKey: 'cropMap',
    };
    let currentChartInput: ChartInput;
    function initChartHooks() {
      speedChartInput.chartContainerHook = playerInfo.videoContainer;
      cropChartInput.chartContainerHook = playerInfo.columns;
    }

    Chart.helpers.merge(Chart.defaults.global, scatterChartDefaults);
    function toggleChart(chartInput: ChartInput) {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedMarkerPairIndex != null
      ) {
        if (!chartInput.chart) {
          if (currentChartInput && isCurrentChartVisible) {
            hideChart();
          }

          currentChartInput = chartInput;

          initializeChartData(chartInput.chartSpec, chartInput.dataMapKey);
          chartInput.chartContainer = htmlToElement(
            html`
              <div
                id="${chartInput.chartContainerId}"
                style="${chartInput.chartContainerStyle}"
              ></div>
            `
          ) as HTMLDivElement;
          chartInput.chartContainer.innerHTML = chartInput.chartCanvasHTML;
          chartInput.chartContainerHook.insertAdjacentElement(
            chartInput.chartContainerHookPosition,
            chartInput.chartContainer
          );
          chartInput.chart = new Chart(chartInput.chartCanvasId, chartInput.chartSpec);
          chartInput.chart.canvas.removeEventListener(
            'wheel',
            chartInput.chart.$zoom._wheelHandler
          );
          const wheelHandler = chartInput.chart.$zoom._wheelHandler;
          chartInput.chart.$zoom._wheelHandler = (e: MouseEvent) => {
            if (e.ctrlKey && !e.altKey && !e.shiftKey) {
              wheelHandler(e);
            }
          };
          chartInput.chart.ctx.canvas.addEventListener(
            'wheel',
            chartInput.chart.$zoom._wheelHandler
          );

          chartInput.chart.ctx.canvas.addEventListener(
            'contextmenu',
            (e) => {
              e.preventDefault();
              e.stopImmediatePropagation();
            },
            true
          );

          chartInput.chart.ctx.canvas.addEventListener(
            'pointerdown',
            getMouseChartTimeAnnotationSetter(chartInput),
            true
          );

          isCurrentChartVisible = true;
          isChartEnabled = true;

          updateChartTimeAnnotation();
          cropChartPreviewHandler();
          // console.log(chartInput.chart);
        } else {
          if (currentChartInput.type !== chartInput.type) {
            hideChart();
            currentChartInput = chartInput;
          }
          toggleCurrentChartVisibility();
          isChartEnabled = isCurrentChartVisible;
        }
      } else {
        flashMessage(
          'Please open a marker pair editor before toggling a chart input.',
          'olive'
        );
      }
    }

    function getMouseChartTimeAnnotationSetter(chartInput: ChartInput) {
      return function mouseChartTimeAnnotationSetter(e) {
        if (e.buttons !== 2) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const chart = chartInput.chart;
        const chartLoop =
          markerPairs[prevSelectedMarkerPairIndex][chartInput.chartLoopKey];
        // shift+right-click context menu opens screenshot tool in firefox 67.0.2

        function chartTimeAnnotationDragHandler(e) {
          const time = timeRounder(chart.scales['x-axis-1'].getValueForPixel(e.offsetX));
          if (!e.ctrlKey && !e.altKey && e.shiftKey) {
            chart.config.options.annotation.annotations[1].value = time;
            chartLoop.start = time;
          } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
            chart.config.options.annotation.annotations[2].value = time;
            chartLoop.end = time;
          }
          chart.config.options.annotation.annotations[0].value = time;
          if (Math.abs(video.currentTime - time) >= 0.01) {
            // player.seekTo(time);
            video.currentTime = time;
          }
        }

        function contextMenuBlocker(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }

        chartTimeAnnotationDragHandler(e);

        function chartTimeAnnotationDragEnd(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          chart.ctx.canvas.releasePointerCapture(e.pointerId);
          window.removeEventListener('pointermove', chartTimeAnnotationDragHandler);
        }

        chart.ctx.canvas.setPointerCapture(e.pointerId);
        window.addEventListener('pointermove', chartTimeAnnotationDragHandler);
        window.addEventListener('pointerup', chartTimeAnnotationDragEnd, { once: true });
        window.addEventListener('contextmenu', contextMenuBlocker, {
          once: true,
          capture: true,
        });
      };
    }

    let easingMode: 'linear' | 'cubicInOut' = 'linear';
    function toggleSpeedChartEasing(chartInput: ChartInput) {
      const chart = chartInput.chart;

      if (chart) {
        if (easingMode === 'linear') {
          chart.data.datasets[0].lineTension = cubicInOutTension;
          easingMode = 'cubicInOut';
        } else {
          chart.data.datasets[0].lineTension = 0;
          easingMode = 'linear';
        }
        chart.update();
      }
    }

    function toggleChartLoop() {
      if (
        currentChartInput &&
        isCurrentChartVisible &&
        prevSelectedMarkerPairIndex != null
      ) {
        const chart = currentChartInput.chart;
        const markerPair = markerPairs[prevSelectedMarkerPairIndex];
        const chartLoop = markerPair[currentChartInput.chartLoopKey];
        if (chartLoop.enabled) {
          chartLoop.enabled = false;
          chart.config.options.annotation.annotations[1].borderColor =
            'rgba(0, 255, 0, 0.4)';
          chart.config.options.annotation.annotations[2].borderColor =
            'rgba(255, 215, 0, 0.4)';
          flashMessage('Speed chart looping disabled', 'red');
        } else {
          chartLoop.enabled = true;
          chart.config.options.annotation.annotations[1].borderColor =
            'rgba(0, 255, 0, 0.9)';
          chart.config.options.annotation.annotations[2].borderColor =
            'rgba(255, 215, 0, 0.9)';
          flashMessage('Speed chart looping enabled', 'green');
        }
        chart.update();
      }
    }

    function resetChartLoop(chartInput: ChartInput) {
      if (isCurrentChartVisible && prevSelectedMarkerPairIndex != null) {
        const chart = chartInput.chart;
        const chartLoop =
          markerPairs[prevSelectedMarkerPairIndex][chartInput.chartLoopKey];
        chartLoop.start = undefined;
        chartLoop.end = undefined;
        chart.config.options.annotation.annotations[1].value = -1;
        chart.config.options.annotation.annotations[2].value = -1;
        chart.update();
      }
    }

    function initializeChartData(chartConfig: ChartConfiguration, dataMapKey: string) {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedMarkerPairIndex != null
      ) {
        const markerPair = markerPairs[prevSelectedMarkerPairIndex];
        const dataMap = markerPair[dataMapKey];
        chartConfig.data.datasets[0].data = dataMap;
        updateChartBounds(chartConfig, markerPair.start, markerPair.end);
      }
    }

    function loadChartData(chartInput: ChartInput) {
      if (chartInput && chartInput.chart) {
        if (
          isSettingsEditorOpen &&
          !wasGlobalSettingsEditorOpen &&
          prevSelectedMarkerPairIndex != null
        ) {
          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const dataMapKey = chartInput.dataMapKey;
          const dataMap = markerPair[dataMapKey];
          const chart = chartInput.chart;
          chart.data.datasets[0].data = dataMap;
          updateChartBounds(chart.config, markerPair.start, markerPair.end);
          if (isCurrentChartVisible && currentChartInput === chartInput) chart.update();
        }
      }
    }

    function updateChartBounds(chartConfig: ChartConfiguration, start, end) {
      if (currentChartInput) {
        currentChartInput.minBound = start;
        currentChartInput.maxBound = end;
      }
      chartConfig.options.scales.xAxes[0].ticks.min = start;
      chartConfig.options.scales.xAxes[0].ticks.max = end;
      chartConfig.options.plugins.zoom.pan.rangeMin.x = start;
      chartConfig.options.plugins.zoom.pan.rangeMax.x = end;
      chartConfig.options.plugins.zoom.zoom.rangeMin.x = start;
      chartConfig.options.plugins.zoom.zoom.rangeMax.x = end;
    }

    let prevChartTime: number;
    function updateChartTimeAnnotation() {
      if (isCurrentChartVisible) {
        if (prevChartTime !== video.currentTime) {
          const time = video.currentTime;
          prevChartTime = time;
          const chart = currentChartInput.chart;
          chart.config.options.annotation.annotations[0].value = clampNumber(
            time,
            currentChartInput.minBound,
            currentChartInput.maxBound
          );

          const timeAnnotation = Object.values(chart.annotation.elements)[0];
          timeAnnotation.options.value = clampNumber(
            time,
            currentChartInput.minBound,
            currentChartInput.maxBound
          );
          timeAnnotation.configure();
          chart.render();
        }

        requestAnimationFrame(updateChartTimeAnnotation);
      }
    }

    function isStaticCrop(cropMap: CropPoint[]) {
      return cropMap.length === 2 && cropMap[0].crop === cropMap[1].crop;
    }

    function toggleCropChartLooping() {
      if (!isCropChartLoopingOn) {
        isCropChartLoopingOn = true;
        flashMessage('Dynamic crop looping enabled', 'green');
      } else {
        isCropChartLoopingOn = false;
        flashMessage('Dynamic crop looping  disabled', 'red');
      }
    }

    function toggleCropChartPanOnly() {
      if (!isCropChartPanOnly) {
        isCropChartPanOnly = true;
        if (cropChartInput.chart) {
          cropChartInput.chart.options.plugins.datalabels.formatter = cropPointXYFormatter;
        } else {
          cropChartInput.chartSpec = getCropChartConfig(isCropChartPanOnly);
        }
        updateCropChart();
        flashMessage('Crop chart mode set to pan only.', 'olive');
      } else {
        isCropChartPanOnly = false;
        if (cropChartInput.chart) {
          cropChartInput.chart.options.plugins.datalabels.formatter = cropPointFormatter;
        } else {
          cropChartInput.chartSpec = getCropChartConfig(isCropChartPanOnly);
        }
        updateCropChart();
        flashMessage('Crop chart mode set to zoompan.', 'olive');
      }
    }

    function cropChartPreviewHandler() {
      const chart = cropChartInput.chart;
      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen && chart) {
        const chartData = chart?.data.datasets[0].data as CropPoint[];
        const time = video.currentTime;
        const isDynamicCrop = !isStaticCrop(chartData);
        const isCropChartVisible =
          currentChartInput && currentChartInput.type == 'crop' && isCurrentChartVisible;
        if (
          shouldTriggerCropChartLoop ||
          // assume auto time-based update not required for crop chart section if looping section
          (isCropChartLoopingOn && isCropChartVisible) ||
          isDraggingCrop ||
          isDrawingCrop
        ) {
          shouldTriggerCropChartLoop = false;
          cropChartSectionLoop();
        } else if (isDynamicCrop) {
          const searchCropPoint = { x: time, y: 0, crop: '' };
          let [istart, iend] = currentCropChartSection;
          let [start, end] = bsearch(chartData, searchCropPoint, sortX);
          if (currentCropChartMode === cropChartMode.Start) {
            if (start === end && end === iend) start--;
            setCurrentCropPoint(chart, Math.min(start, chartData.length - 2));
          } else if (currentCropChartMode === cropChartMode.End) {
            if (start === end && start === istart) end++;
            setCurrentCropPoint(chart, Math.max(end, 1));
          }
        }

        if (isDynamicCrop || currentCropPointIndex > 0) {
          cropInputLabel.textContent = `Crop Point ${currentCropPointIndex + 1}`;
        } else {
          cropInputLabel.textContent = `Crop`;
        }

        updateCropChartSectionOverlays(chartData, time, isDynamicCrop);
      }
      requestAnimationFrame(cropChartPreviewHandler);
    }

    const easeInstantIn = (nt) => (nt === 0 ? 0 : 1);
    function updateCropChartSectionOverlays(
      chartData: CropPoint[],
      currentTime: number,
      isDynamicCrop: boolean
    ) {
      if (isDynamicCrop || currentCropPointIndex > 0) {
        cropChartSectionStart.style.display = 'block';
        cropChartSectionEnd.style.display = 'block';
      } else {
        cropChartSectionStart.style.display = 'none';
        cropChartSectionEnd.style.display = 'none';
        return;
      }

      const sectStart = chartData[currentCropChartSection[0]];
      const sectEnd = chartData[currentCropChartSection[1]];

      [
        cropChartSectionStartBorderGreen,
        cropChartSectionStartBorderWhite,
      ].map((cropRect) => setCropOverlay(cropRect, sectStart.crop));
      [cropChartSectionEndBorderYellow, cropChartSectionEndBorderWhite].map((cropRect) =>
        setCropOverlay(cropRect, sectEnd.crop)
      );

      if (currentCropChartMode === cropChartMode.Start) {
        cropChartSectionStart.setAttribute('opacity', '0.7');
        cropChartSectionEnd.setAttribute('opacity', '0.4');
      } else if (currentCropChartMode === cropChartMode.End) {
        cropChartSectionStart.setAttribute('opacity', '0.4');
        cropChartSectionEnd.setAttribute('opacity', '0.7');
      }

      const [startX, startY, startW, startH] = getCropComponents(sectStart.crop);
      const [endX, endY, endW, endH] = getCropComponents(sectEnd.crop);

      const clampedTime = clampNumber(currentTime, sectStart.x, sectEnd.x);
      const easingFunc = sectEnd.easeIn == 'instant' ? easeInstantIn : easeSinInOut;
      const [easedX, easedY, easedW, easedH] = [
        [startX, endX],
        [startY, endY],
        [startW, endW],
        [startH, endH],
      ].map((pair) =>
        getEasedValue(easingFunc, pair[0], pair[1], sectStart.x, sectEnd.x, clampedTime)
      );

      [cropRect, cropRectBorderBlack, cropRectBorderWhite].map((cropRect) =>
        setCropOverlayDimensions(cropRect, easedX, easedY, easedW, easedH)
      );
    }

    function getEasedValue(
      easingFunc: (number) => number,
      startValue: number,
      endValue: number,
      startTime: number,
      endTime: number,
      currentTime: number
    ) {
      const elapsed = currentTime - startTime;
      const duration = endTime - startTime;
      const change = endValue - startValue;

      let easedTimePercentage: number;
      easedTimePercentage = easingFunc(elapsed / duration);

      const easedValue = startValue + change * easedTimePercentage;
      return easedValue;
    }

    function cropChartSectionLoop() {
      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
        if (prevSelectedMarkerPairIndex != null) {
          const chart = cropChartInput.chart;
          if (chart == null) return;
          const chartData = chart.data.datasets[0].data;
          const [start, end] = currentCropChartSection;
          const sectStart = chartData[start].x;
          const sectEnd = chartData[end].x;
          const isTimeBetweenCropChartSection =
            sectStart <= video.currentTime && video.currentTime <= sectEnd;

          if (!isTimeBetweenCropChartSection) {
            player.seekTo(sectStart);
          }
        }
      }
    }

    function updateAllMarkerPairSpeeds(newSpeed: number) {
      markerPairs.forEach((markerPair) => {
        markerPair.speed = newSpeed;
        const speedMap = markerPair.speedMap;
        if (speedMap.length === 2 && speedMap[0].y === speedMap[1].y) {
          markerPair.speedMap[1].y = newSpeed;
        }
        markerPair.speedMap[0].y = newSpeed;
      });
      if (isSettingsEditorOpen) {
        if (wasGlobalSettingsEditorOpen) {
          const markerPairMergeListInput = document.getElementById('merge-list-input');
          markerPairMergeListInput.dispatchEvent(new Event('change'));
        } else {
          const speedInput = document.getElementById('speed-input') as HTMLInputElement;
          speedInput.value = newSpeed.toString();
          speedInput.dispatchEvent(new Event('change'));
        }
      }
      flashMessage(`All marker speeds updated to ${newSpeed}`, 'olive');
    }

    function updateAllMarkerPairCrops(newCrop: string) {
      markerPairs.forEach((markerPair) => {
        const cropMap = markerPair.cropMap;
        if (isStaticCrop(cropMap)) {
          markerPair.crop = newCrop;
          cropMap[0].crop = newCrop;
          cropMap[1].crop = newCrop;
        }
      });
      if (isSettingsEditorOpen && !wasGlobalSettingsEditorOpen) {
        const markerPair = markerPairs[prevSelectedMarkerPairIndex];
        const cropMap = markerPair.cropMap;
        if (isStaticCrop(cropMap)) {
          const cropInput = document.getElementById('crop-input') as HTMLInputElement;
          cropInput.value = newCrop;
          cropInput.dispatchEvent(new Event('change'));
        }
      }
      flashMessage(`All static marker crops updated to ${newCrop}`, 'olive');
    }

    function markerNumberingMouseOverHandler(e: MouseEvent) {
      const targetMarker = e.target.marker as SVGRectElement;
      toggleMarkerPairEditorHandler(e, targetMarker);
    }

    function markerNumberingMouseDownHandler(e: PointerEvent) {
      if (!(e.button === 0)) return;
      const numbering = e.target as SVGTextElement;
      const numberingType = numbering.classList.contains('startMarkerNumbering')
        ? 'start'
        : 'end';
      const targetEndMarker = numbering.marker as SVGRectElement;
      const targetStartMarker = targetEndMarker.previousSibling as SVGRectElement;
      const targetMarker =
        numberingType === 'start' ? targetStartMarker : targetEndMarker;

      const markerPairIndex = parseInt(numbering.getAttribute('idx')) - 1;
      const markerPair = markerPairs[markerPairIndex];
      const markerTime = numberingType === 'start' ? markerPair.start : markerPair.end;

      // open editor of target marker corresponding to clicked numbering
      if (!isSettingsEditorOpen) {
        toggleOnMarkerPairEditor(targetEndMarker);
      } else {
        if (wasGlobalSettingsEditorOpen) {
          toggleOffGlobalSettingsEditor();
          toggleOnMarkerPairEditor(targetEndMarker);
        } else if (prevSelectedEndMarker != targetEndMarker) {
          toggleOffMarkerPairEditor();
          toggleOnMarkerPairEditor(targetEndMarker);
        }
      }

      player.seekTo(markerTime);

      if (!e.altKey) return;

      const pointerId = e.pointerId;
      numbering.setPointerCapture(pointerId);

      const numberingRect = numbering.getBoundingClientRect();
      const progressBarRect = playerInfo.progress_bar.getBoundingClientRect();
      const offsetX = e.pageX - numberingRect.left - numberingRect.width / 2;
      const offsetY = e.pageY - numberingRect.top;
      let prevPageX = e.pageX;
      let prevZoom = 1;
      function getDragTime(e: PointerEvent) {
        let newTime =
          (video.duration * (e.pageX - offsetX - progressBarRect.left)) /
          progressBarRect.width;
        let prevTime =
          (video.duration * (prevPageX - offsetX - progressBarRect.left)) /
          progressBarRect.width;
        const zoom = clampNumber((e.pageY - offsetY) / video.clientHeight, 0, 1);
        const zoomDelta = Math.abs(zoom - prevZoom);
        prevZoom = zoom;
        prevPageX = e.pageX;

        if (zoomDelta >= 0.0001) return video.currentTime;
        let timeDelta = roundValue(zoom * (newTime - prevTime), 0.01, 2);
        if (Math.abs(timeDelta) < 0.01) return video.currentTime;

        let time = video.currentTime + timeDelta;
        time =
          numberingType === 'start'
            ? clampNumber(time, 0, markerPair.end - 1e-3)
            : clampNumber(time, markerPair.start + 1e-3, video.duration);
        return time;
      }

      function dragNumbering(e: PointerEvent) {
        const time = getDragTime(e);
        if (Math.abs(time - video.currentTime) < 0.01) return;
        moveMarker(targetMarker, time, false, null, false);
        player.seekTo(time);
      }

      window.addEventListener('pointermove', dragNumbering);

      window.addEventListener(
        'pointerup',
        (e: PointerEvent) => {
          window.removeEventListener('pointermove', dragNumbering);
          numbering.releasePointerCapture(pointerId);
          const time = getDragTime(e);
          if (Math.abs(time - markerTime) < 0.001) return;
          moveMarker(targetMarker, time, true, markerTime, true);
        },
        {
          once: true,
          capture: true,
        }
      );
    }

    function toggleMarkerPairEditorHandler(e: MouseEvent, targetMarker?: SVGRectElement) {
      targetMarker = targetMarker ?? (e.target as SVGRectElement);

      if (targetMarker && e.shiftKey) {
        toggleMarkerPairEditor(targetMarker);
      }
    }

    let isChartEnabled = false;
    function toggleMarkerPairEditor(targetMarker: SVGRectElement) {
      // if target marker is previously selected marker: toggle target on/off
      if (prevSelectedEndMarker === targetMarker && !wasGlobalSettingsEditorOpen) {
        isSettingsEditorOpen
          ? toggleOffMarkerPairEditor()
          : toggleOnMarkerPairEditor(targetMarker);

        // otherwise switching from a different marker pair or from global settings editor
      } else {
        // delete current settings editor appropriately
        if (isSettingsEditorOpen) {
          wasGlobalSettingsEditorOpen
            ? toggleOffGlobalSettingsEditor()
            : toggleOffMarkerPairEditor();
        }
        // create new marker pair settings editor
        toggleOnMarkerPairEditor(targetMarker);
      }
    }

    function toggleOnMarkerPairEditor(targetMarker: SVGRectElement) {
      prevSelectedEndMarker = targetMarker;
      const selectedMarkerPairIndex =
        parseInt(prevSelectedEndMarker.getAttribute('idx')) - 1;
      if (selectedMarkerPairIndex !== prevSelectedMarkerPairIndex) {
        setCurrentCropPoint(null, 0);
      }
      prevSelectedMarkerPairIndex = selectedMarkerPairIndex;

      highlightSelectedMarkerPair(targetMarker);
      enableMarkerHotkeys(targetMarker);
      createMarkerPairEditor(targetMarker);
      addCropInputHotkeys();
      loadChartData(speedChartInput);
      loadChartData(cropChartInput);
      showCropOverlay();
      if (isChartEnabled) {
        showChart();
      }

      targetMarker.classList.add('selected-marker');
      targetMarker.previousElementSibling.classList.add('selected-marker');
      const markerPair = markerPairs[prevSelectedMarkerPairIndex];
      markerPair.startNumbering.classList.add('selectedMarkerNumbering');
      markerPair.endNumbering.classList.add('selectedMarkerNumbering');
      if (isAutoHideUnselectedMarkerPairsOn) {
        autoHideUnselectedMarkerPairsStyle = injectCSS(
          autoHideUnselectedMarkerPairsCSS,
          'auto-hide-unselected-marker-pairs-css'
        );
      }
    }

    function toggleOffMarkerPairEditor(hardHide = false) {
      deleteSettingsEditor();
      hideSelectedMarkerPairOverlay(hardHide);
      hideCropOverlay();
      hideChart();
      prevSelectedEndMarker.classList.remove('selected-marker');
      prevSelectedEndMarker.previousElementSibling.classList.remove('selected-marker');
      const markerPair = markerPairs[prevSelectedMarkerPairIndex];
      markerPair.startNumbering.classList.remove('selectedMarkerNumbering');
      markerPair.endNumbering.classList.remove('selectedMarkerNumbering');
      if (isAutoHideUnselectedMarkerPairsOn) {
        deleteElement(autoHideUnselectedMarkerPairsStyle);
      }
    }

    const autoHideUnselectedMarkerPairsCSS = `
    rect.marker {
      opacity: 0.25;
    }
    text.markerNumbering {
      opacity: 0.25;
      pointer-events: none;
    }

    rect.selected-marker {
      opacity: 1;
    }
    text.selectedMarkerNumbering {
      opacity: 1;
      pointer-events: visibleFill;
    }

    rect.marker.end-marker {
      pointer-events: none;
    }
    rect.selected-marker.end-marker {
      pointer-events: visibleFill;
    }
    `;
    let autoHideUnselectedMarkerPairsStyle: HTMLStyleElement;
    let isAutoHideUnselectedMarkerPairsOn = false;
    function toggleAutoHideUnselectedMarkerPairs(e: KeyboardEvent) {
      if (e.ctrlKey && !arrowKeyCropAdjustmentEnabled) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!isAutoHideUnselectedMarkerPairsOn) {
          autoHideUnselectedMarkerPairsStyle = injectCSS(
            autoHideUnselectedMarkerPairsCSS,
            'auto-hide-unselected-marker-pairs-css'
          );
          isAutoHideUnselectedMarkerPairsOn = true;
          flashMessage('Auto-hiding of unselected marker pairs enabled', 'green');
        } else {
          deleteElement(autoHideUnselectedMarkerPairsStyle);
          isAutoHideUnselectedMarkerPairsOn = false;
          flashMessage('Auto-hiding of unselected marker pairs disabled', 'red');
        }
      }
    }

    let speedInputLabel: HTMLInputElement;
    let cropInputLabel: HTMLInputElement;
    let cropInput: HTMLInputElement;
    let cropAspectRatioSpan: HTMLSpanElement;
    let markerPairNumberInput: HTMLInputElement;
    function createMarkerPairEditor(targetMarker: SVGRectElement) {
      const markerPairIndex = parseInt(targetMarker.getAttribute('idx'), 10) - 1;
      const markerPair = markerPairs[markerPairIndex];
      const startTime = toHHMMSSTrimmed(markerPair.start);
      const endTime = toHHMMSSTrimmed(markerPair.end);
      const speed = markerPair.speed;
      const duration = toHHMMSSTrimmed(markerPair.end - markerPair.start);
      const speedAdjustedDuration = toHHMMSSTrimmed(
        (markerPair.end - markerPair.start) / speed
      );
      const crop = markerPair.crop;
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const [x, y, w, h] = getCropComponents(crop);
      const cropAspectRatio = (w / h).toFixed(13);

      const settingsEditorDiv = document.createElement('div');
      const overrides = markerPair.overrides;
      const vidstab = overrides.videoStabilization;
      const vidstabDesc = vidstab ? vidstab.desc : null;
      const vidstabDescGlobal = settings.videoStabilization
        ? `(${settings.videoStabilization.desc})`
        : '(Disabled)';
      const vidstabDynamicZoomEnabled = overrides.videoStabilizationDynamicZoom;
      const minterpMode = overrides.minterpMode;
      const minterpFPS = overrides.minterpFPS;
      const denoise = overrides.denoise;
      const denoiseDesc = denoise ? denoise.desc : null;
      const denoiseDescGlobal = settings.denoise
        ? `(${settings.denoise.desc})`
        : '(Disabled)';
      const overridesEditorDisplay = isExtraSettingsEditorEnabled ? 'block' : 'none';
      createCropOverlay(crop);

      settingsEditorDiv.setAttribute('id', 'settings-editor-div');
      settingsEditorDiv.innerHTML = `
      <fieldset class="settings-editor-panel marker-pair-settings-editor-highlighted-div">
        <legend class="marker-pair-settings-editor-highlighted-label">Marker Pair
          <input id="marker-pair-number-input"
            title="${Tooltips.markerPairNumberTooltip}"
            type="number" value="${markerPairIndex + 1}"
            step="1" min="1" max="${markerPairs.length}" style="width:3em" required>
          </input>
          /
          <span id="marker-pair-count-label">${markerPairs.length}</span>
          Settings\
        </legend>
        <div class="settings-editor-input-div" title="${Tooltips.speedTooltip}">
          <span id="speed-input-label">Speed</span>
          <input id="speed-input"type="number" placeholder="speed" value="${speed}" 
            step="0.05" min="0.05" max="2" style="min-width:4em" required></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.cropTooltip}">
          <span id="crop-input-label">Crop</span>
          <input id="crop-input" value="${crop}" pattern="${cropInputValidation}" 
          style="min-width:10em" required></input>
        </div>
        <div class="settings-editor-input-div settings-info-display">
          <span>Crop Aspect Ratio</span>
          <br>
          <span id="crop-aspect-ratio">${cropAspectRatio}</span>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.titlePrefixTooltip}">
          <span>Title Prefix</span>
          <input id="title-prefix-input" value="${
            overrides.titlePrefix != null ? overrides.titlePrefix : ''
          }" placeholder="None" style="min-width:10em;text-align:right"></input>
        </div>
        <div class="settings-editor-input-div settings-info-display">
          <span>Time:</span>
          <span id="start-time">${startTime}</span>
          <span> - </span>
          <span id="end-time">${endTime}</span>
          <br>
          <span>Duration: </span>
          <span id="duration">${duration} / ${
        markerPair.speed
      } = ${speedAdjustedDuration}</span>
        </div>
      </fieldset>
      <fieldset id="marker-pair-overrides" class="settings-editor-panel marker-pair-settings-editor-highlighted-div" style="display:${overridesEditorDisplay}">
        <legend class="marker-pair-settings-editor-highlighted-label">Overrides</legend>
        <div class="settings-editor-input-div" title="${Tooltips.audioTooltip}">
          <span>Audio</span>
          <select id="audio-input">
            <option ${overrides.audio ? 'selected' : ''}>Enabled</option>
            <option ${overrides.audio === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              overrides.audio == null ? 'selected' : ''
            }>Inherit ${ternaryToString(settings.audio)}</option>
          </select>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.encodeSpeedTooltip}">
          <span>Encode Speed (0-5)</span>
          <input id="encode-speed-input" type="number" min="0" max="5" step="1" value="${
            overrides.encodeSpeed != null ? overrides.encodeSpeed : ''
          }" placeholder="${
        settings.encodeSpeed || 'Auto'
      }"  style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.CRFTooltip}">
          <span>CRF (0-63)</span>
          <input id="crf-input" type="number" min="0" max="63" step="1" value="${
            overrides.crf != null ? overrides.crf : ''
          }" placeholder="${
        settings.crf != null ? settings.crf : 'Auto'
      }" "style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.targetBitrateTooltip}">
          <span>Target Bitrate (kb/s)</span>
          <input id="target-max-bitrate-input" type="number" min="0" max="10e5" step="100" value="${
            overrides.targetMaxBitrate != null ? overrides.targetMaxBitrate : ''
          }" placeholder="${
        settings.targetMaxBitrate || 'Auto'
      }" "style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.twoPassTooltip}">
          <span>Two-Pass</span>
          <select id="two-pass-input"> 
            <option ${overrides.twoPass ? 'selected' : ''}>Enabled</option>
            <option ${overrides.twoPass === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              overrides.twoPass == null ? 'selected' : ''
            }>Inherit ${ternaryToString(settings.twoPass)}</option>
          </select>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.gammaTooltip}">
          <span>Gamma (0-4)</span>
          <input id="gamma-input" type="number" min="0.01" max="4.00" step="0.01" value="${
            overrides.gamma != null ? overrides.gamma : ''
          }" placeholder="${
        settings.gamma != null ? settings.gamma : '1'
      }" style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${
          Tooltips.expandColorRangeTooltip
        }">
          <span>Expand Colors</span>
          <select id="expand-color-range-input"> 
            <option ${overrides.expandColorRange ? 'selected' : ''}>Enabled</option>
            <option ${
              overrides.expandColorRange === false ? 'selected' : ''
            }>Disabled</option>
            <option value="Default" ${
              overrides.expandColorRange == null ? 'selected' : ''
            }>Inherit ${ternaryToString(settings.expandColorRange)}</option>
          </select>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.denoiseTooltip}">
          <span>Denoise</span>
          <select id="denoise-input">
            <option value="Inherit" ${
              denoiseDesc == null ? 'selected' : ''
            }>Inherit ${denoiseDescGlobal}</option>
            <option value="Disabled" ${
              denoiseDesc == 'Disabled' ? 'selected' : ''
            }>Disabled</option>
            <option ${denoiseDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option ${denoiseDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${denoiseDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${denoiseDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${
              denoiseDesc === 'Very Strong' ? 'selected' : ''
            }>Very Strong</option>
          </select>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.speedMapTooltip}">
          <span>Speed Map</span>
            <select id="enable-speed-maps-input">
              <option ${overrides.enableSpeedMaps ? 'selected' : ''}>Enabled</option>
              <option ${
                overrides.enableSpeedMaps === false ? 'selected' : ''
              }>Disabled</option>
              <option value="Default" ${
                overrides.enableSpeedMaps == null ? 'selected' : ''
              }>Inherit ${ternaryToString(settings.enableSpeedMaps, '(Enabled)')}</option>
            </select>
        </div>
        <div class="settings-editor-input-div">
          <div title="${Tooltips.minterpModeTooltip}">
            <span>Minterpolation</span>
            <select id="minterp-mode-input">
              <option value="Default" ${minterpMode == null ? 'selected' : ''}>Inherit ${
        settings.minterpMode != null ? `(${settings.minterpMode})` : '(Numeric)'
      }</option>
              <option ${minterpMode === 'None' ? 'selected' : ''}>None</option>
              <option ${minterpMode === 'Numeric' ? 'selected' : ''}>Numeric</option>
              <option value="MaxSpeed" ${
                minterpMode == 'MaxSpeed' ? 'selected' : ''
              }>MaxSpeed</option>
              <option value="VideoFPS" ${
                minterpMode == 'VideoFPS' ? 'selected' : ''
              }>VideoFPS</option>
              <option value="MaxSpeedx2" ${
                minterpMode == 'MaxSpeedx2' ? 'selected' : ''
              }>MaxSpeedx2</option>
              <option value="VideoFPSx2" ${
                minterpMode == 'VideoFPSx2' ? 'selected' : ''
              }>VideoFPSx2</option>
            </select>
          </div>
          <div title="${Tooltips.minterpFPSTooltip}">
            <span>FPS</span>
            <input id="minterp-fps-input" type="number" min="10" max="120" step="1" value="${
              minterpFPS ?? ''
            }" placeholder="" style="min-width:2em"></input>
          </div>
        </div>
        <div class="settings-editor-input-div multi-input-div" title="${
          Tooltips.vidstabTooltip
        }">
        <div>
          <span>Stabilization</span>
          <select id="video-stabilization-input">
              <option value="Inherit" ${
                vidstabDesc == null ? 'selected' : ''
              }>Inherit ${vidstabDescGlobal}</option>
              <option value="Disabled" ${
                vidstabDesc == 'Disabled' ? 'selected' : ''
              }>Disabled</option>
              <option ${vidstabDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
              <option ${vidstabDesc === 'Weak' ? 'selected' : ''}>Weak</option>
              <option ${vidstabDesc === 'Medium' ? 'selected' : ''}>Medium</option>
              <option ${vidstabDesc === 'Strong' ? 'selected' : ''}>Strong</option>
              <option ${
                vidstabDesc === 'Very Strong' ? 'selected' : ''
              }>Very Strong</option>
              <option ${vidstabDesc === 'Strongest' ? 'selected' : ''}>Strongest</option>
            </select>
          </div>
          <div title="${Tooltips.dynamicZoomTooltip}">
            <span>Dynamic Zoom</span>
            <select id="video-stabilization-dynamic-zoom-input"> 
              <option ${vidstabDynamicZoomEnabled ? 'selected' : ''}>Enabled</option>
              <option ${
                vidstabDynamicZoomEnabled === false ? 'selected' : ''
              }>Disabled</option>
              <option value="Default" ${
                vidstabDynamicZoomEnabled == null ? 'selected' : ''
              }>Inherit ${ternaryToString(
        settings.videoStabilizationDynamicZoom
      )}</option>
            </select>
          </div>
        </div>
        <div class="settings-editor-input-div multi-input-div" title="${
          Tooltips.loopTooltip
        }">
          <div>
            <span>Loop</span>
            <select id="loop-input">
              <option ${overrides.loop === 'fwrev' ? 'selected' : ''}>fwrev</option>
              <option ${overrides.loop === 'fade' ? 'selected' : ''}>fade</option>
              <option ${overrides.loop === 'none' ? 'selected' : ''}>none</option>
              <option value="Default" ${
                overrides.loop == null ? 'selected' : ''
              }>Inherit ${
        settings.loop != null ? `(${settings.loop})` : '(none)'
      }</option>
            </select>
          </div>
          <div title="${Tooltips.fadeDurationTooltip}">
            <span>Fade Duration</span>
            <input id="fade-duration-input" type="number" min="0.1" step="0.1" value="${
              overrides.fadeDuration != null ? overrides.fadeDuration : ''
            }" placeholder="${
        settings.fadeDuration != null ? settings.fadeDuration : '0.7'
      }" style="width:7em"></input>
          </div>
        </div>
      </fieldset>
      `;

      updateSettingsEditorHook();
      settingsEditorHook.insertAdjacentElement('afterend', settingsEditorDiv);

      const inputConfigs = [
        ['speed-input', 'speed', 'number'],
        ['crop-input', 'crop', 'string'],
      ];
      addSettingsInputListeners(inputConfigs, markerPairs[markerPairIndex], true);

      const overrideInputConfigs = [
        ['title-prefix-input', 'titlePrefix', 'string'],
        ['gamma-input', 'gamma', 'number'],
        ['encode-speed-input', 'encodeSpeed', 'number'],
        ['crf-input', 'crf', 'number'],
        ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
        ['two-pass-input', 'twoPass', 'ternary'],
        ['audio-input', 'audio', 'ternary'],
        ['expand-color-range-input', 'expandColorRange', 'ternary'],
        ['enable-speed-maps-input', 'enableSpeedMaps', 'ternary'],
        ['minterp-mode-input', 'minterpMode', 'inheritableString'],
        ['minterp-fps-input', 'minterpFPS', 'number'],
        ['denoise-input', 'denoise', 'preset'],
        ['video-stabilization-input', 'videoStabilization', 'preset'],
        [
          'video-stabilization-dynamic-zoom-input',
          'videoStabilizationDynamicZoom',
          'ternary',
        ],
        ['loop-input', 'loop', 'inheritableString'],
        ['fade-duration-input', 'fadeDuration', 'number'],
      ];
      addSettingsInputListeners(
        overrideInputConfigs,
        markerPairs[markerPairIndex].overrides,
        true
      );
      markerPairNumberInput = document.getElementById(
        'marker-pair-number-input'
      ) as HTMLInputElement;
      markerPairNumberInput.addEventListener('change', markerPairNumberInputHandler);
      speedInputLabel = document.getElementById('speed-input-label') as HTMLInputElement;
      cropInputLabel = document.getElementById('crop-input-label') as HTMLInputElement;
      cropInput = document.getElementById('crop-input') as HTMLInputElement;
      cropAspectRatioSpan = document.getElementById(
        'crop-aspect-ratio'
      ) as HTMLSpanElement;
      isSettingsEditorOpen = true;
      wasGlobalSettingsEditorOpen = false;

      if (isForceSetSpeedOn) {
        updateSpeedInputLabel(`Speed (${forceSetSpeedValue.toFixed(2)})`);
      }
      highlightModifiedSettings(inputConfigs, markerPairs[markerPairIndex]);
      highlightModifiedSettings(
        overrideInputConfigs,
        markerPairs[markerPairIndex].overrides
      );
    }

    function ternaryToString(ternary: boolean, def?: string) {
      if (ternary == null) {
        return def != null ? def : '(Disabled)';
      } else if (ternary === true) {
        return '(Enabled)';
      } else if (ternary === false) {
        return '(Disabled)';
      } else {
        return null;
      }
    }

    function markerPairNumberInputHandler(e: Event) {
      const markerPair = markerPairs[prevSelectedMarkerPairIndex];
      const startNumbering = markerPair.startNumbering;
      const endNumbering = markerPair.endNumbering;
      const newIdx = e.target.value - 1;
      markerPairs.splice(
        newIdx,
        0,
        ...markerPairs.splice(prevSelectedMarkerPairIndex, 1)
      );

      let targetMarkerRect = markersSvg.children[newIdx * 2];
      let targetStartNumbering = startMarkerNumberings.children[newIdx];
      let targetEndNumbering = endMarkerNumberings.children[newIdx];
      // if target succeedes current marker pair, move pair after target
      if (newIdx > prevSelectedMarkerPairIndex) {
        targetMarkerRect = targetMarkerRect.nextElementSibling.nextElementSibling;
        targetStartNumbering = targetStartNumbering.nextElementSibling;
        targetEndNumbering = targetEndNumbering.nextElementSibling;
      }

      const prevSelectedStartMarker = prevSelectedEndMarker.previousElementSibling;
      // if target precedes current marker pair, move pair before target
      markersSvg.insertBefore(prevSelectedStartMarker, targetMarkerRect);
      markersSvg.insertBefore(prevSelectedEndMarker, targetMarkerRect);
      startMarkerNumberings.insertBefore(startNumbering, targetStartNumbering);
      endMarkerNumberings.insertBefore(endNumbering, targetEndNumbering);

      renumberMarkerPairs();
      prevSelectedMarkerPairIndex = newIdx;
    }

    function highlightModifiedSettings(inputs: string[][], target) {
      if (isSettingsEditorOpen) {
        const markerPairSettingsLabelHighlight =
          'marker-pair-settings-editor-highlighted-label';
        const globalSettingsLabelHighlight = 'global-settings-editor-highlighted-label';
        let markerPair: MarkerPair;
        if (!wasGlobalSettingsEditorOpen && prevSelectedMarkerPairIndex != null) {
          markerPair = markerPairs[prevSelectedMarkerPairIndex];
        }
        inputs.forEach((input) => {
          const id = input[0];
          const targetProperty = input[1];
          const inputElem = document.getElementById(id);
          const storedTargetValue = target[targetProperty];

          let label = inputElem.previousElementSibling;
          if (id === 'rotate-90-clock' || id === 'rotate-90-counterclock')
            label = inputElem.parentElement.getElementsByTagName('span')[0];

          const shouldRemoveHighlight =
            storedTargetValue == null ||
            storedTargetValue === '' ||
            (id === 'title-suffix-input' &&
              storedTargetValue == `[${settings.videoID}]`) ||
            (markerPair &&
              id === 'speed-input' &&
              storedTargetValue === 1 &&
              !isVariableSpeed(markerPair.speedMap)) ||
            (id === 'crop-input' &&
              (storedTargetValue === '0:0:iw:ih' ||
                storedTargetValue ===
                  `0:0:${settings.cropResWidth}:${settings.cropResHeight}`)) ||
            id === 'rotate-0';

          if (shouldRemoveHighlight) {
            label.classList.remove(globalSettingsLabelHighlight);
            label.classList.remove(markerPairSettingsLabelHighlight);
          } else {
            if (target === settings) {
              label.classList.add(globalSettingsLabelHighlight);
            } else {
              if (storedTargetValue === settings[targetProperty]) {
                label.classList.add(globalSettingsLabelHighlight);
                label.classList.remove(markerPairSettingsLabelHighlight);
              } else {
                label.classList.add(markerPairSettingsLabelHighlight);
                label.classList.remove(globalSettingsLabelHighlight);
              }
            }
          }
        });
      }
    }

    function enableMarkerHotkeys(endMarker: SVGRectElement) {
      markerHotkeysEnabled = true;
      enableMarkerHotkeys.endMarker = endMarker;
      enableMarkerHotkeys.startMarker = endMarker.previousSibling;
    }

    function moveMarker(
      marker: SVGRectElement,
      newTime?: number,
      storeHistory = true,
      fromTime?: number,
      adjustCharts = true
    ) {
      const type = marker.getAttribute('type') as 'start' | 'end';
      const idx = parseInt(marker.getAttribute('idx')) - 1;
      const markerPair = markerPairs[idx];
      fromTime = fromTime ?? (type === 'start' ? markerPair.start : markerPair.end);
      const toTime = newTime != null ? newTime : video.currentTime;
      const progress_pos = (toTime / playerInfo.duration) * 100;
      const markerTimeSpan = document.getElementById(`${type}-time`);

      if (type === 'start' && toTime >= markerPair.end) {
        flashMessage('Start marker cannot be placed after or at end marker', 'red');
        return;
      }
      if (type === 'end' && toTime <= markerPair.start) {
        flashMessage('End marker cannot be placed before or at start marker', 'red');
        return;
      }

      marker.setAttribute('x', `${progress_pos}%`);
      markerPair[type] = toTime;
      if (type === 'start') {
        selectedStartMarkerOverlay.setAttribute('x', `${progress_pos}%`);
        markerPair.startNumbering.setAttribute('x', `${progress_pos}%`);
        if (adjustCharts) {
          markerPair.speedMap[0].x = toTime;
          markerPair.cropMap[0].x = toTime;
          markerPair.speedMap = markerPair.speedMap.filter((speedPoint) => {
            return speedPoint.x >= toTime;
          });
          markerPair.cropMap = markerPair.cropMap.filter((cropPoint) => {
            return cropPoint.x >= toTime;
          });
        }
      } else if (type === 'end') {
        selectedEndMarkerOverlay.setAttribute('x', `${progress_pos}%`);
        markerPair.endNumbering.setAttribute('x', `${progress_pos}%`);
        if (adjustCharts) {
          markerPair.speedMap[markerPair.speedMap.length - 1].x = toTime;
          markerPair.cropMap[markerPair.cropMap.length - 1].x = toTime;
          markerPair.speedMap = markerPair.speedMap.filter((speedPoint) => {
            return speedPoint.x <= toTime;
          });
          markerPair.cropMap = markerPair.cropMap.filter((cropPoint) => {
            return cropPoint.x <= toTime;
          });
        }
      }
      markerTimeSpan.textContent = `${toHHMMSSTrimmed(toTime)}`;

      if (adjustCharts) {
        const speedChart = speedChartInput.chart;
        if (speedChart) {
          speedChart.config.data.datasets[0].data = markerPair.speedMap;
          updateChartBounds(speedChart.config, markerPair.start, markerPair.end);
        }
        const cropChart = cropChartInput.chart;
        if (cropChart) {
          cropChart.config.data.datasets[0].data = markerPair.cropMap;
          updateChartBounds(cropChart.config, markerPair.start, markerPair.end);
        }
        if (isCurrentChartVisible && currentChartInput && currentChartInput.chart) {
          currentChartInput.chart.update();
        }
      }
      updateMarkerPairDuration(markerPair);
      if (storeHistory) markerPair.moveHistory.undos.push({ marker, fromTime, toTime });
    }

    function undoMarkerMove() {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedMarkerPairIndex != null &&
        markerPairs[prevSelectedMarkerPairIndex].moveHistory.undos.length > 0
      ) {
        const moveHistory = markerPairs[prevSelectedMarkerPairIndex].moveHistory;
        const lastMarkerMove = moveHistory.undos.pop();
        moveHistory.redos.push(lastMarkerMove);
        moveMarker(lastMarkerMove.marker, lastMarkerMove.fromTime, false);
      }
    }

    function redoMarkerMove() {
      if (
        isSettingsEditorOpen &&
        !wasGlobalSettingsEditorOpen &&
        prevSelectedMarkerPairIndex != null &&
        markerPairs[prevSelectedMarkerPairIndex].moveHistory.redos.length > 0
      ) {
        const moveHistory = markerPairs[prevSelectedMarkerPairIndex].moveHistory;
        const lastMarkerMoveUndo = moveHistory.redos.pop();
        moveMarker(lastMarkerMoveUndo.marker, lastMarkerMoveUndo.toTime, true);
      }
    }

    function deleteMarkerPair(idx?: number) {
      if (idx == null) idx = prevSelectedMarkerPairIndex;
      const markerPair = markerPairs[idx];

      const me = new MouseEvent('mouseover', { shiftKey: true });
      enableMarkerHotkeys.endMarker.dispatchEvent(me);
      deleteElement(enableMarkerHotkeys.endMarker);
      deleteElement(enableMarkerHotkeys.startMarker);
      deleteElement(markerPair.startNumbering);
      deleteElement(markerPair.endNumbering);
      hideSelectedMarkerPairOverlay(true);
      renumberMarkerPairs();

      markerPairs.splice(idx, 1);
      clearPrevSelectedMarkerPairReferences();
    }

    function clearPrevSelectedMarkerPairReferences() {
      prevSelectedMarkerPairIndex = null;
      prevSelectedEndMarker = null;
      enableMarkerHotkeys.startMarker = null;
      enableMarkerHotkeys.endMarker = null;
      markerHotkeysEnabled = false;
    }

    let selectedStartMarkerOverlay: HTMLElement;
    let selectedEndMarkerOverlay: HTMLElement;
    function highlightSelectedMarkerPair(currentMarker: SVGRectElement) {
      if (!selectedStartMarkerOverlay) {
        selectedStartMarkerOverlay = document.getElementById(
          'selected-start-marker-overlay'
        );
      }
      if (!selectedEndMarkerOverlay) {
        selectedEndMarkerOverlay = document.getElementById('selected-end-marker-overlay');
      }
      const startMarker = currentMarker.previousSibling as SVGRectElement;
      selectedStartMarkerOverlay.setAttribute('x', startMarker.getAttribute('x'));
      selectedEndMarkerOverlay.setAttribute('x', currentMarker.getAttribute('x'));
      selectedStartMarkerOverlay.classList.remove('selected-marker-overlay-hidden');
      selectedEndMarkerOverlay.classList.remove('selected-marker-overlay-hidden');
      selectedMarkerPairOverlay.style.display = 'block';
    }

    function updateMarkerPairDuration(markerPair: MarkerPair) {
      const speedAdjustedDurationSpan = document.getElementById('duration');
      const duration = markerPair.end - markerPair.start;
      const durationHHMMSS = toHHMMSSTrimmed(duration);
      const outputDuration = getOutputDuration(markerPair.speedMap);
      const outputDurationHHMMSS = toHHMMSSTrimmed(outputDuration);
      speedAdjustedDurationSpan.textContent = `${durationHHMMSS} (${outputDurationHHMMSS})`;
      markerPair.outputDuration = outputDuration;
    }

    function getOutputDuration(speedMap: SpeedPoint[]) {
      let outputDuration = 0;
      const fps = getFPS();
      const frameDur = 1 / fps;
      const nSects = speedMap.length - 1;
      // Account for marker pair start time as trim filter sets start time to ~0
      const speedMapStartTime = speedMap[0].x;
      // Account for first input frame delay due to potentially imprecise trim
      const startt =
        Math.ceil(speedMapStartTime / frameDur) * frameDur - speedMapStartTime;

      for (let sect = 0; sect < nSects; ++sect) {
        const left = speedMap[sect];
        const right = speedMap[sect + 1];

        const startSpeed = left.y;
        const endSpeed = right.y;
        const speedChange = endSpeed - startSpeed;

        const sectStart = left.x - speedMapStartTime - startt;
        let sectEnd = right.x - speedMapStartTime - startt;
        // Account for last input frame delay due to potentially imprecise trim
        if (sect === nSects - 1) {
          sectEnd = Math.floor(right['x'] / frameDur) * frameDur;
          // When trim is frame-precise, the frame that begins at the marker pair end time is not included
          if (right.x - sectEnd < 1e-10) sectEnd = sectEnd - frameDur;
          sectEnd = sectEnd - speedMapStartTime - startt;
          sectEnd = Math.floor(sectEnd * 1000000) / 1000000;
        }

        const sectDuration = sectEnd - sectStart;
        if (sectDuration === 0) continue;

        const m = speedChange / sectDuration;
        const b = startSpeed - m * sectStart;

        if (speedChange === 0) {
          outputDuration += sectDuration / endSpeed;
        } else {
          // Integrate the reciprocal of the linear time vs speed function for the current section
          outputDuration +=
            (1 / m) *
            (Math.log(Math.abs(m * sectEnd + b)) - Math.log(Math.abs(m * sectStart + b)));
        }
      }
      // Each output frame time is rounded to the nearest multiple of a frame's duration at the given fps
      outputDuration = Math.round(outputDuration / frameDur) * frameDur;
      // The last included frame is held for a single frame's duration
      outputDuration += frameDur;
      outputDuration = Math.round(outputDuration * 1000) / 1000;
      return outputDuration;
    }

    function renumberMarkerPairs() {
      const markersSvg = document.getElementById('markers-svg');
      markersSvg.childNodes.forEach((markerRect, idx) => {
        // renumber markers by pair starting with index 1
        const newIdx = Math.floor((idx + 2) / 2);
        markerRect.setAttribute('idx', newIdx);
      });

      startMarkerNumberings.childNodes.forEach((startNumbering, idx) => {
        const newIdx = idx + 1;
        startNumbering.setAttribute('idx', newIdx);
        startNumbering.textContent = newIdx.toString();
      });

      endMarkerNumberings.childNodes.forEach((endNumbering, idx) => {
        const newIdx = idx + 1;
        endNumbering.setAttribute('idx', newIdx);
        endNumbering.textContent = newIdx.toString();
      });
    }

    function hideSelectedMarkerPairOverlay(hardHide = false) {
      if (hardHide) {
        selectedMarkerPairOverlay.style.display = 'none';
      } else {
        selectedStartMarkerOverlay.classList.add('selected-marker-overlay-hidden');
        selectedEndMarkerOverlay.classList.add('selected-marker-overlay-hidden');
      }
    }

    function showChart() {
      if (currentChartInput && currentChartInput.chartContainer) {
        if (isDrawingCrop) {
          finishDrawingCrop();
        }
        currentChartInput.chartContainer.style.display = 'block';
        isCurrentChartVisible = true;
        currentChartInput.chart.update();
        requestAnimationFrame(updateChartTimeAnnotation);
      }
    }

    function hideChart() {
      if (currentChartInput && currentChartInput.chartContainer) {
        currentChartInput.chartContainer.style.display = 'none';
        isCurrentChartVisible = false;
      }
    }

    function toggleCurrentChartVisibility() {
      if (!isCurrentChartVisible) {
        showChart();
      } else {
        hideChart();
      }
    }

    function deleteSettingsEditor() {
      const settingsEditorDiv = document.getElementById('settings-editor-div');
      hideCropOverlay();
      deleteElement(settingsEditorDiv);
      isSettingsEditorOpen = false;
      wasGlobalSettingsEditorOpen = false;
      markerHotkeysEnabled = false;
    }

    let isExtraSettingsEditorEnabled = false;
    function toggleMarkerPairOverridesEditor() {
      if (isSettingsEditorOpen) {
        const markerPairOverridesEditor = document.getElementById(
          'marker-pair-overrides'
        );
        if (markerPairOverridesEditor) {
          if (markerPairOverridesEditor.style.display === 'none') {
            markerPairOverridesEditor.style.display = 'block';
            isExtraSettingsEditorEnabled = true;
          } else {
            markerPairOverridesEditor.style.display = 'none';
            isExtraSettingsEditorEnabled = false;
          }
        }

        const globalEncodeSettingsEditor = document.getElementById(
          'global-encode-settings'
        );
        if (globalEncodeSettingsEditor) {
          if (globalEncodeSettingsEditor.style.display === 'none') {
            globalEncodeSettingsEditor.style.display = 'block';
            isExtraSettingsEditorEnabled = true;
          } else if (globalEncodeSettingsEditor.style.display === 'block') {
            globalEncodeSettingsEditor.style.display = 'none';
            isExtraSettingsEditorEnabled = false;
          }
        }
      }
    }

    function flattenVRVideo() {
      let isVRVideo = true;

      const VRCanvas = playerInfo.videoContainer.getElementsByClassName('webgl')[0];
      VRCanvas != null ? deleteElement(VRCanvas) : (isVRVideo = false);
      const VRControl = document.getElementsByClassName('ytp-webgl-spherical-control')[0];
      VRControl != null ? deleteElement(VRControl) : (isVRVideo = false);

      if (isVRVideo) {
        playerInfo.videoContainer.style.cursor = 'auto';
        video.style.display = 'block';
        flashMessage('Flattened VR video.', 'green');
      } else {
        flashMessage('Not a VR video or already flattened.', 'red');
      }
    }
  }
})();
