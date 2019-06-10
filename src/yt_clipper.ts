// ==UserScript==
// @locale       english
// @name         yt_clipper
// @namespace    http://tampermonkey.net/
// @version      0.0.76
// @description  add markers to youtube videos and generate clipped webms online or offline
// @updateURL    https://openuserjs.org/meta/elwm/yt_clipper.meta.js
// @run-at       document-end
// @license      MIT
// @author       elwm
// @match        *://www.youtube.com/watch?v=*
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.8/FileSaver.min.js
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  document.addEventListener('keydown', hotkeys, true);

  function hotkeys(e: KeyboardEvent) {
    if (toggleKeys) {
      switch (e.code) {
        case 'KeyA':
          if (!e.shiftKey) {
            addMarkerSVGRect();
          } else if (
            e.shiftKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.moveMarker
          ) {
            enableMarkerHotkeys.moveMarker(enableMarkerHotkeys.endMarker);
          }
          break;
        case 'KeyS':
          if (!e.shiftKey && !e.altKey) {
            saveSettings();
          } else if (e.altKey && !e.shiftKey) {
            copyToClipboard(getSettingsJSON());
          } else if (e.altKey && e.shiftKey) {
            saveAuthServerScript();
          }
          break;
        case 'KeyQ':
          if (!e.shiftKey) {
            cyclePlayerSpeedDown();
          } else if (
            e.shiftKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.moveMarker
          ) {
            enableMarkerHotkeys.moveMarker(enableMarkerHotkeys.startMarker);
          }
          break;
        case 'KeyW':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
            toggleDefaultsEditor();
          } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
            toggleMarkerPairOverridesEditor();
          }
          break;
        case 'KeyE':
          if (!e.ctrlKey && e.shiftKey) {
            updateAllMarkers('speed', settings.newMarkerSpeed);
          }
          break;
        case 'KeyD':
          if (!e.ctrlKey && e.shiftKey) {
            updateAllMarkers('crop', settings.newMarkerCrop);
          }
          break;
        case 'KeyG':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
            loadMarkers();
          } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
            toggleSpeedAutoDucking();
          } else if (!e.ctrlKey && !e.shiftKey && e.altKey) {
            toggleMarkerLooping();
          } else if (!e.ctrlKey && e.shiftKey && e.altKey) {
            toggleGammaPreview();
          }
          break;
        case 'KeyZ':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
            undoMarker();
          } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
            redoMarker();
          } else if (
            !e.ctrlKey &&
            !e.shiftKey &&
            e.altKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.deleteMarkerPair
          ) {
            enableMarkerHotkeys.deleteMarkerPair();
          }
          break;
        case 'KeyX':
          if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
            drawCropOverlay(false);
          } else if (!e.ctrlKey && !e.altKey && e.shiftKey) {
            drawCropOverlay(true);
          } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
            toggleArrowKeyCropAdjustment();
          }
          break;
        case 'KeyC':
          if (!e.ctrlKey && !e.shiftKey && e.altKey) {
            sendGfyRequests(playerInfo.url);
          } else if (!e.ctrlKey && e.shiftKey && e.altKey) {
            requestGfycatAuth();
          }
          break;
        case 'KeyR':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && playerInfo.watchFlexy.theater) {
            rotateVideo('clock');
          } else if (
            !e.ctrlKey &&
            !e.shiftKey &&
            e.altKey &&
            playerInfo.watchFlexy.theater
          ) {
            rotateVideo('cclock');
          } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
            toggleBigVideoPreviews();
          } else if (!e.ctrlKey && !e.shiftKey && !playerInfo.watchFlexy.theater) {
            flashMessage('Please switch to theater mode to rotate video.', 'red');
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          jumpToNearestMarkerOrPair(e, e.code);
          break;
        case 'ArrowUp':
          toggleSelectedMarkerPair(e);
          break;
      }
    }
    if (!e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyA') {
      toggleKeys = !toggleKeys;
      initOnce();
      if (toggleKeys) {
        flashMessage('Enabled Hotkeys', 'green');
      } else {
        flashMessage('Disabled Hotkeys', 'red');
      }
    }
  }

  function toggleSelectedMarkerPair(e: KeyboardEvent) {
    if (e.ctrlKey && !arrowKeyCropAdjustmentEnabled) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (enableMarkerHotkeys.endMarker) {
        toggleMarkerPairEditor(enableMarkerHotkeys.endMarker);
      } else if (prevSelectedMarkerPair) {
        toggleMarkerPairEditor(prevSelectedMarkerPair);
      }
    }
  }
  // global variables

  const CLIENT_ID = 'XXXX';
  const REDIRECT_URI = 'https://127.0.0.1:4443/yt_clipper';
  const BROWSER_BASED_AUTH_ENDPOINT = `https://gfycat.com/oauth/authorize?client_id=${CLIENT_ID}&scope=all&state=yt_clipper&response_type=token&redirect_uri=${REDIRECT_URI}`;

  let start = true;
  let markerHotkeysEnabled = false;
  let isMarkerEditorOpen = false;
  let wasDefaultsEditorOpen = false;
  let isOverlayOpen = false;
  let checkGfysCompletedId: number;
  interface markerPairOverrides {
    titlePrefix?: string;
    gamma?: number;
    encodeSpeed?: number;
    crf?: number;
    targetMaxBitrate?: number;
    twoPass?: boolean;
    denoise?: boolean;
    audio?: boolean;
    videoStabilization?: videoStabilization;
  }
  interface marker {
    start: number;
    end: number;
    speed: number;
    crop: string;
    overrides: markerPairOverrides;
  }
  let markers: marker[] = [];
  let markersHistory: marker[] = [];
  let links: string[] = [];

  let startTime = 0.0;
  let toggleKeys = false;
  let prevSelectedMarkerPair: SVGRectElement = null;

  function init() {
    injectCSS(ytClipperCSS, 'yt-clipper-css');
    initPlayerInfo();
    initMarkersContainer();
    addForeignEventListeners();
  }

  const initOnce = once(init, this);
  const player = document.getElementById('movie_player');
  const playerInfo = {};
  const video = document.getElementsByTagName('video')[0];
  let settingsEditorHook: HTMLElement;
  let flashMessageHook: HTMLElement;
  function initPlayerInfo() {
    playerInfo.url = player.getVideoUrl();
    playerInfo.playerData = player.getVideoData();

    playerInfo.duration = player.getDuration();
    playerInfo.video = document.getElementsByTagName('video')[0];
    playerInfo.video.setAttribute('id', 'yt-clipper-video');
    playerInfo.aspectRatio = player.getVideoAspectRatio();
    playerInfo.isVerticalVideo = playerInfo.aspectRatio <= 1;
    playerInfo.progress_bar = document.getElementsByClassName('ytp-progress-bar')[0];
    playerInfo.watchFlexy = document.getElementsByTagName('ytd-watch-flexy')[0];
    playerInfo.infoContents = document.getElementById('info-contents');
    flashMessageHook = playerInfo.infoContents;
    playerInfo.columns = document.getElementById('columns');
    while (!playerInfo.columns) {
      playerInfo.columns = document.getElementById('columns');
      sleep(100);
    }
    updateSettingsEditorHook();
    playerInfo.annotations = document.getElementsByClassName('ytp-iv-video-content')[0];
    playerInfo.controls = document.getElementsByClassName('ytp-chrome-bottom')[0];
  }

  function updateSettingsEditorHook() {
    if (playerInfo.watchFlexy.theater) {
      settingsEditorHook = playerInfo.columns;
    } else {
      settingsEditorHook = playerInfo.infoContents;
    }
  }

  document.body.addEventListener('wheel', mouseWheelFrameSkipHandler);
  function mouseWheelFrameSkipHandler(event: WheelEvent) {
    if (
      toggleKeys &&
      !event.ctrlKey &&
      !event.altKey &&
      event.shiftKey &&
      Math.abs(event.deltaY) > 0
    ) {
      const videoStats = player.getStatsForNerds();
      let fps = videoStats ? videoStats.resolution.match(/@(\d\d)/)[1] : null;
      if (event.deltaY < 0) {
        player.seekBy(1 / fps);
      } else if (event.deltaY > 0) {
        player.seekBy(-1 / fps);
      }
    }
  }
  interface videoStabilization {
    enabled: boolean;
    shakiness: number;
    desc: string;
  }
  interface settings {
    videoID: string;
    videoTitle: string;
    newMarkerSpeed: number;
    newMarkerCrop: string;
    titleSuffix: string;
    cropRes: string;
    cropResWidth: number;
    cropResHeight: number;
    markerPairMergeList: string;
    encodeSpeed?: number;
    crf?: number;
    targetMaxBitrate?: number;
    gamma?: number;
    twoPass?: boolean;
    denoise?: boolean;
    audio?: boolean;
    videoStabilization?: videoStabilization;
  }
  let settings: settings;
  let markersSvg: SVGSVGElement;
  let selectedMarkerPairOverlay: SVGSVGElement;
  function initMarkersContainer() {
    settings = {
      videoID: playerInfo.playerData.video_id,
      videoTitle: playerInfo.playerData.title,
      newMarkerSpeed: 1.0,
      newMarkerCrop: '0:0:iw:ih',
      titleSuffix: `[${playerInfo.playerData.video_id}]`,
      cropRes: playerInfo.isVerticalVideo ? '1080x1920' : '1920x1080',
      cropResWidth: playerInfo.isVerticalVideo ? 1080 : 1920,
      cropResHeight: playerInfo.isVerticalVideo ? 1920 : 1080,
      markerPairMergeList: '',
    };
    const markersDiv = document.createElement('div');
    markersDiv.setAttribute('id', 'markers-div');
    markersDiv.innerHTML = `\
    <svg id="markers-svg"></svg>
    <svg id="selected-marker-pair-overlay" style="display:none">
      <rect id="selected-start-marker-overlay" class="selected-marker-overlay"></rect>
      <rect id="selected-end-marker-overlay" class="selected-marker-overlay"></rect>
    </svg>
    `;
    playerInfo.progress_bar.appendChild(markersDiv);
    markersSvg = markersDiv.children[0] as SVGSVGElement;
    selectedMarkerPairOverlay = markersDiv.children[1] as SVGSVGElement;
  }

  const ytClipperCSS = `\
@keyframes valid-input {
  0% {
    background-color: tomato;
  }
  100% {
    background-color: lightgreen;
  }
}
@keyframes invalid-input {
  0% {
    background-color: lightgreen;
  }
  100% {
    background-color: tomato;
  }
}
@keyframes flash {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
.flash-div {
  margin-top: 2px;
  padding: 2px;
  border: 2px outset grey;
  animation-name: flash;
  animation-duration: 5s;
  animation-fill-mode: forwards;
}
.flash-msg {
  font-size: 10pt;
  font-weight: bold;
}
.marker {
  width: 1.5px;
  height: 16px;
}
.start-marker {
  fill: lime;
  pointer-events: none;
}
.end-marker {
  fill: gold;
  pointer-events: visibleFill;
}
.selected-marker-overlay {
  fill: black;
  width: 1.5px;
  height: 8.5px;
  y: 3.5px;
  pointer-events: none;
}
#markerInputsDiv {
  display: flex;
}
.editor-input-div {
  display: inline-block;
  color: grey;
  font-size: 12pt;
  margin: 2px;
  padding: 2px;
  border: 2px solid grey;
}
.editor-input-label {
  color: grey;
  font-size: 12pt;
}
.yt_clipper-input {
  font-weight: bold;
}
.yt_clipper-input:valid {
  animation-name: valid-input;
  animation-duration: 1s;
  animation-fill-mode: forwards;
}
.yt_clipper-input:invalid {
  animation-name: invalid-input;
  animation-duration: 1s;
  animation-fill-mode: forwards;
}
.marker-settings-display {
  display: block;
  color: grey;
  font-size: 12pt;
  font-style: italic;
  margin: 2px;
  padding: 2px;
  border: 2px solid grey;
}
.yt_clipper-settings-editor {
  display: inline;
  color: grey;
  font-size: 12pt;
  margin: 10px;
  padding: 4px;
  border: 2px solid grey;
  border-radius: 5px;
}
#markers-svg,
#selected-marker-pair-overlay {
  width: 100%;
  height: 300%;
  top: -4px;
  position: absolute;
  z-index: 99;
}
#crop-svg {
  width: 100%;
  height: 100%;
  top: 0px;
  position: absolute;
  z-index: 95;
}
`;
  function injectCSS(css: string, id: string) {
    const style = document.createElement('style');
    style.setAttribute('id', id);
    style.innerHTML = css;
    document.body.appendChild(style);
    return style;
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
          transform: translateY(-20%) rotate(${rotation}deg) !important;
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
    const ids = ['search'];
    ids.forEach((id) => {
      const input = document.getElementById(id);
      if (toggleKeys) {
        input.addEventListener('focus', () => (toggleKeys = false), {
          capture: true,
        });
        input.addEventListener('blur', () => (toggleKeys = true), {
          capture: true,
        });
      }
    });
  }

  function flashMessage(msg: string, color: string, lifetime = 2500) {
    const flashDiv = document.createElement('div');
    flashDiv.setAttribute('class', 'flash-div');
    flashDiv.innerHTML = `<span class="flash-msg" style="color:${color}">${msg}</span>`;
    flashMessageHook.insertAdjacentElement('beforebegin', flashDiv);
    setTimeout(() => deleteElement(flashDiv), lifetime);
  }

  function deleteElement(elem: HTMLElement) {
    if (elem && elem.parentElement) {
      elem.parentElement.removeChild(elem);
    }
  }

  const toggleSpeedAutoDucking = () => {
    let _this = toggleSpeedAutoDucking;
    if (_this.listenerAdded) {
      playerInfo.video.removeEventListener('timeupdate', autoducking, false);
      _this.listenerAdded = false;
      flashMessage('Auto speed ducking disabled', 'red');
    } else {
      playerInfo.video.addEventListener('timeupdate', autoducking, false);
      _this.listenerAdded = true;
      flashMessage('Auto speed ducking enabled', 'green');
    }
  };

  function autoducking() {
    const shortestActiveMarkerPair = getShortestActiveMarkerPair();
    if (shortestActiveMarkerPair) {
      const currentMarkerSlowdown = shortestActiveMarkerPair.speed;
      if (player.getPlaybackRate() !== currentMarkerSlowdown) {
        player.setPlaybackRate(currentMarkerSlowdown);
      }
    } else if (player.getPlaybackRate() !== 1) {
      player.setPlaybackRate(1);
    }
  }

  function getShortestActiveMarkerPair(currentTime: number = video.currentTime) {
    const activeMarkerPairs = markers.filter((markerPair) => {
      if (currentTime >= markerPair.start && currentTime <= markerPair.end) {
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

  function toggleMarkerLooping() {
    let _this = toggleMarkerLooping;
    if (_this.listenerAdded) {
      playerInfo.video.removeEventListener('timeupdate', markerLoopingHandler, false);
      _this.listenerAdded = false;
      flashMessage('Auto marker looping disabled', 'red');
    } else {
      playerInfo.video.addEventListener('timeupdate', markerLoopingHandler, false);
      _this.listenerAdded = true;
      flashMessage('Auto marker looping enabled', 'green');
    }
  }

  function markerLoopingHandler() {
    const endMarker = prevSelectedMarkerPair;
    if (endMarker) {
      const idx = parseInt(endMarker.getAttribute('idx')) - 1;
      const startMarkerTime = markers[idx].start;
      const endMarkerTime = markers[idx].end;
      const currentTime = video.currentTime;

      const isTimeBetweenMarkerPair =
        startMarkerTime < currentTime && currentTime < endMarkerTime;
      if (!isTimeBetweenMarkerPair) {
        player.seekTo(startMarkerTime);
        player.playVideo();
      }
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
      video.addEventListener('timeupdate', gammaPreviewHandler, false);
      isGammaPreviewOn = true;
      flashMessage('Gamma preview enabled', 'green');
    } else {
      video.style.filter = null;
      video.removeEventListener('timeupdate', gammaPreviewHandler, false);
      isGammaPreviewOn = false;
      flashMessage('Gamma preview disabled', 'red');
    }
  }

  let prevGammaVal = 1;
  function gammaPreviewHandler() {
    const shortestActiveMarkerPair = getShortestActiveMarkerPair();
    if (shortestActiveMarkerPair) {
      const markerPairGamma =
        shortestActiveMarkerPair.overrides.gamma || settings.gamma || 1;
      if (prevGammaVal !== markerPairGamma) {
        console.log(`Updating gamma from ${prevGammaVal} to ${markerPairGamma}`);
        gammaR.exponent.baseVal = markerPairGamma;
        gammaG.exponent.baseVal = markerPairGamma;
        gammaB.exponent.baseVal = markerPairGamma;
        // force re-render of filter (possible bug with chrome and other browsers?)
        gammaFilterSvg.setAttribute('width', '0');
        prevGammaVal = markerPairGamma;
      }
    } else {
      if (prevGammaVal !== 1) {
        console.log(`Updating gamma from ${prevGammaVal} to 1`);
        gammaR.exponent.baseVal = 1;
        gammaG.exponent.baseVal = 1;
        gammaB.exponent.baseVal = 1;
        gammaFilterSvg.setAttribute('width', '0');
        prevGammaVal = 1;
      }
    }
  }

  function jumpToNearestMarkerOrPair(e: KeyboardEvent, keyCode: string) {
    if (!arrowKeyCropAdjustmentEnabled) {
      const currentEndMarker = enableMarkerHotkeys.endMarker;
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        jumpToNearestMarker(e, video.currentTime, keyCode);
      } else if (isMarkerEditorOpen && currentEndMarker && e.altKey && !e.shiftKey) {
        jumpToNearestMarkerPair(e, currentEndMarker, keyCode);
      }
    }
  }

  function jumpToNearestMarkerPair(
    e: KeyboardEvent,
    currentEndMarker: SVGRectElement,
    keyCode: string
  ) {
    e.preventDefault();
    e.stopImmediatePropagation();
    let index = parseInt(currentEndMarker.getAttribute('idx')) - 1;
    let targetMarker: SVGRectElement;
    if (keyCode === 'ArrowLeft' && index > 0) {
      targetMarker = enableMarkerHotkeys.endMarker.previousSibling.previousSibling;
      targetMarker && toggleMarkerPairEditor(targetMarker);
      if (e.ctrlKey) {
        index--;
        player.seekTo(markers[index].start);
      }
    } else if (keyCode === 'ArrowRight' && index < markers.length - 1) {
      targetMarker = enableMarkerHotkeys.endMarker.nextSibling.nextSibling;
      targetMarker && toggleMarkerPairEditor(targetMarker);
      if (e.ctrlKey) {
        index++;
        player.seekTo(markers[index].start);
      }
    }
    return;
  }

  function jumpToNearestMarker(e: KeyboardEvent, currentTime: number, keyCode: string) {
    e.preventDefault();
    e.stopImmediatePropagation();
    let minDist = 0;

    // Choose marker time to jump to based on low precision time distance
    // Avoids being unable to jump away from a marker that the current time is very close to
    let times = markers.map((markerPair) => {
      const distToStartMarker = markerPair.start - currentTime;
      const distToStartMarkerFixed = parseFloat(distToStartMarker.toFixed(1));
      const distToEndMarker = markerPair.end - currentTime;
      const distToEndMarkerFixed = parseFloat(distToEndMarker.toFixed(1));
      return [
        {
          distToMarker: distToStartMarker,
          distToMarkerFixed: distToStartMarkerFixed,
        },
        { distToMarker: distToEndMarker, distToMarkerFixed: distToEndMarkerFixed },
      ];
    });
    times = times.flat();
    if (keyCode === 'ArrowLeft') {
      minDist = times.reduce((prevDistToMarker, dist) => {
        dist.distToMarkerFixed =
          dist.distToMarkerFixed >= 0 ? -Infinity : dist.distToMarkerFixed;
        if (dist.distToMarkerFixed > prevDistToMarker) {
          return dist.distToMarker;
        } else {
          return prevDistToMarker;
        }
      }, -Infinity);
    } else if (keyCode === 'ArrowRight') {
      minDist = times.reduce((prevDistToMarker, dist) => {
        dist.distToMarkerFixed =
          dist.distToMarkerFixed <= 0 ? Infinity : dist.distToMarkerFixed;
        if (dist.distToMarkerFixed < prevDistToMarker) {
          return dist.distToMarker;
        } else {
          return prevDistToMarker;
        }
      }, Infinity);
    }
    if (minDist != Infinity && minDist != -Infinity && minDist != 0) {
      player.seekTo(minDist + currentTime);
    }
  }

  function saveSettings() {
    const settingsJSON = getSettingsJSON();

    const blob = new Blob([settingsJSON], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${settings.titleSuffix}.json`);
  }

  function getSettingsJSON() {
    markers.forEach((marker: marker, index: number) => {
      const speed = marker.speed;
      if (typeof speed === 'string') {
        marker.speed = Number(speed);
        console.log(`Converted marker pair ${index}'s speed from String to Number`);
      }
    });

    const markersNumbered = markers.map((markerPair, idx) => {
      return { number: idx + 1, ...markerPair };
    });
    const settingsJSON = JSON.stringify(
      {
        ...settings,
        markers: markersNumbered,
      },
      undefined,
      2
    );
    return settingsJSON;
  }

  function loadMarkers() {
    const markersUploadDiv = document.getElementById('markers-upload-div');
    if (markersUploadDiv) {
      deleteElement(markersUploadDiv);
    } else {
      const markersUploadDiv = document.createElement('div');
      markersUploadDiv.setAttribute('id', 'markers-upload-div');
      markersUploadDiv.setAttribute(
        'style',
        'color:grey;margin-top:2px;padding:2px;border:2px outset grey'
      );
      markersUploadDiv.innerHTML = `
      <fieldset>\
        <h2>Upload a markers .json file.</h2>\
        <input type="file" id="markers-json-input">\
        <input type="button" id="upload-markers-json" style="color:grey" value="Load">\
      </fieldset>`;
      updateSettingsEditorHook();
      settingsEditorHook.insertAdjacentElement('beforebegin', markersUploadDiv);
      const fileUploadButton = document.getElementById('upload-markers-json');
      fileUploadButton.onclick = loadMarkersJson;
    }
  }

  function loadMarkersJson() {
    const input = document.getElementById('markers-json-input');
    console.log(input.files);
    const file = input.files[0];
    const fr = new FileReader();
    fr.onload = receivedJson;
    fr.readAsText(file);
    const markersUploadDiv = document.getElementById('markers-upload-div');
    deleteElement(markersUploadDiv);
  }

  function receivedJson(e: ProgressEvent) {
    const lines = e.target.result;
    const markersJson = JSON.parse(lines);
    console.log(markersJson);
    if (isMarkerEditorOpen) {
      deleteMarkerEditor();
      if (isOverlayOpen) {
        toggleCropOverlay();
      }
    }

    flashMessage('Loading markers.', 'green');

    if (markersJson && markersJson.markers) {
      // copy markersJson to settings object less markers field
      const { markers: _markers, ..._settings } = markersJson;
      settings = _settings;
      markers.length = 0;
      markersJson.markers.forEach((marker: marker) => {
        const startMarkerConfig: markerConfig = { time: marker.start, type: 'start' };
        const endMarkerConfig: markerConfig = {
          time: marker.end,
          type: 'end',
          crop: marker.crop,
          speed: marker.speed,
          overrides: marker.overrides,
        };
        addMarkerSVGRect(startMarkerConfig);
        addMarkerSVGRect(endMarkerConfig);
      });
    }
  }

  const marker_attrs = {
    class: 'marker',
    markerPairOverridesEditorDisplay: 'none',
  };

  interface markerConfig {
    time?: number;
    type?: 'start' | 'end';
    speed?: number;
    crop?: string;
    overrides?: markerPairOverrides;
  }
  function addMarkerSVGRect(markerConfig: markerConfig = {}) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    markersSvg.appendChild(marker);

    const roughCurrentTime = markerConfig.time || player.getCurrentTime();
    const currentFrameTime = getCurrentFrameTime(roughCurrentTime);
    const progress_pos = (currentFrameTime / playerInfo.duration) * 100;

    setAttributes(marker, marker_attrs);
    marker.setAttribute('x', `${progress_pos}%`);
    const rectIdx = markers.length + 1;
    marker.setAttribute('idx', rectIdx.toString());

    if (start === true) {
      marker.classList.add('start-marker');
      marker.setAttribute('type', 'start');
      marker.setAttribute('z-index', '1');
      startTime = currentFrameTime;
    } else {
      marker.addEventListener('mouseover', toggleMarkerEditorHandler, false);
      marker.classList.add('end-marker');
      marker.setAttribute('type', 'end');
      marker.setAttribute('z-index', '2');
      updateMarkersArray(currentFrameTime, markerConfig);
      updateMarkerPairEditor();
    }

    start = !start;
    console.log(markers);
  }

  function getCurrentFrameTime(roughCurrentTime: number): number {
    let currentFrameTime: number;
    const videoStats = player.getStatsForNerds();
    let fps = videoStats ? videoStats.resolution.match(/@(\d\d)/)[1] : null;
    fps
      ? (currentFrameTime = Math.floor(roughCurrentTime * fps) / fps)
      : (currentFrameTime = roughCurrentTime);
    return currentFrameTime;
  }

  function updateMarkersArray(currentTime: number, markerPairConfig: markerConfig) {
    const updatedMarker: marker = {
      start: startTime,
      end: currentTime,
      speed: markerPairConfig.speed || settings.newMarkerSpeed,
      crop: markerPairConfig.crop || settings.newMarkerCrop,
      overrides: markerPairConfig.overrides || {},
    };

    markers.push(updatedMarker);
  }

  function updateMarkerPairEditor() {
    if (isMarkerEditorOpen) {
      const markerPairCountLabel = document.getElementById('marker-pair-count-label');
      if (markerPairCountLabel) {
        markerPairCountLabel.textContent = markers.length.toString();
      }
    }
  }

  function undoMarker() {
    const targetMarker = markersSvg.lastChild;

    const targetMarkerType = targetMarker.getAttribute('type');
    // do not undo markers part of or before a currently select marker pair
    if (
      targetMarkerType === 'end' &&
      isMarkerEditorOpen &&
      enableMarkerHotkeys.markerPairIndex >= markers.length
    ) {
      toggleMarkerPairEditor(enableMarkerHotkeys.endMarker);
    }
    if (targetMarker) {
      markersSvg.removeChild(targetMarker);
      if (targetMarkerType === 'end') {
        startTime = markers[markers.length - 1].start;
        markersHistory.push(markers.pop());
        console.log(markers);
        updateMarkerPairEditor();
      }
      start = !start;
    }
  }

  function redoMarker() {
    if (markersHistory.length > 0) {
      const markerPairToRestore = markersHistory[markersHistory.length - 1];
      if (start) {
        addMarkerSVGRect({ time: markerPairToRestore.start });
      } else {
        markersHistory.pop();
        addMarkerSVGRect({ ...markerPairToRestore, time: markerPairToRestore.end });
      }
    }
  }
  function cyclePlayerSpeedDown() {
    let newSpeed = player.getPlaybackRate() - 0.25;
    newSpeed = newSpeed <= 0 ? 1 : newSpeed;
    player.setPlaybackRate(newSpeed);
    flashMessage(`Video playback speed set to ${newSpeed}`, 'green');
  }

  let globalEncodeSettingsEditorDisplay: 'none' | 'block' = 'none';
  function toggleDefaultsEditor() {
    if (isMarkerEditorOpen) {
      toggleOffMarkerEditor();
    }
    if (wasDefaultsEditorOpen) {
      wasDefaultsEditorOpen = false;
    } else {
      hideSelectedMarkerPairCropOverlay();
      toggleCropOverlay();
      createCropOverlay(settings.newMarkerCrop);
      const markerInputs = document.createElement('div');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const csvRange = `(\\d{1,2})([,-]\\d{1,2})*`;
      const mergeListInputValidation = `(${csvRange})+(;${csvRange})*`;
      const gte100 = `([1-9]\\d{3}|[1-9]\\d{2})`;
      const cropResInputValidation = `${gte100}x${gte100}`;
      const resList = playerInfo.isVerticalVideo
        ? `<option value="1080x1920"><option value="2160x3840">`
        : `<option value="1920x1080"><option value="3840x2160">`;
      const vidstab = settings.videoStabilization;
      const vidstabDesc = vidstab ? vidstab.desc : null;

      markerInputs.setAttribute('id', 'markerInputsDiv');
      markerInputs.innerHTML = `\
      <div id="new-marker-defaults-inputs" class="yt_clipper-settings-editor">
        <span style="font-weight:bold">New Marker Settings: </span>
        <div class="editor-input-div">
          <span class="editor-input-label">Speed: </span>
          <input id="speed-input" class="yt_clipper-input"  type="number" placeholder="speed" value="${
            settings.newMarkerSpeed
          }" step="0.05" min="0.05" max="2" style="width:4em">
        </div>
        <div class="editor-input-div">
          <span class="editor-input-label">Crop: </span>
          <input id="crop-input" class="yt_clipper-input" value="${
            settings.newMarkerCrop
          }" pattern="${cropInputValidation}" style="width:10em" required>
        </div>
      </div>
      <div id="global-marker-settings" class="yt_clipper-settings-editor">
        <span style="font-weight:bold">Global Marker Settings: </span>
        <div class="editor-input-div">
          <span class="editor-input-label"> Title Suffix: </span>
          <input id="title-suffix-input" class="yt_clipper-input" value="${
            settings.titleSuffix
          }" style="background-color:lightgreen;width:20em;text-align:right">
        </div>
        <div class="editor-input-div">
          <span class="editor-input-label"> Crop Resolution: </span>
          <input id="crop-res-input" class="yt_clipper-input" list="resolutions" pattern="${cropResInputValidation}" value="${
        settings.cropRes
      }" style="width:7em" required>
          <datalist id="resolutions" autocomplete="off">${resList}</datalist>
        </div>
        <div class="editor-input-div">
          <span class="editor-input-label"> Merge List: </span>
          <input id="merge-list-input" class="yt_clipper-input" pattern="${mergeListInputValidation}" value="${
        settings.markerPairMergeList != null ? settings.markerPairMergeList : ''
      }" placeholder="None" style="width:15em">
        </div>
        <div class="editor-input-div">
          <span>Rotate: </span>
          <input id="rotate-0" class="yt_clipper-input" type="radio" name="rotate" value="0" ${
            settings.rotate == null || settings.rotate === '0' ? 'checked' : ''
          }></input>
          <label for="rotate-0">0&#x00B0; </label>
          <input id="rotate-90-clock" class="yt_clipper-input" type="radio" value="clock" name="rotate" ${
            settings.rotate === 'clock' ? 'checked' : ''
          }></input>
          <label for="rotate-90-clock">90&#x00B0; &#x27F3;</label>
          <input id="rotate-90-counterclock" class="yt_clipper-input" type="radio" value="cclock" name="rotate" ${
            settings.rotate === 'cclock' ? 'checked' : ''
          }></input>
          <label for="rotate-90-counterclock">90&#x00B0; &#x27F2;</label>
        </div>
      </div>
      <div id="global-encode-settings" class="yt_clipper-settings-editor" style="display:${globalEncodeSettingsEditorDisplay}">
        <span style="font-weight:bold">Global Encode Settings: </span>
        <div class="editor-input-div">
          <span>Encode Speed (0-5): </span>
          <input id="encode-speed-input" class="yt_clipper-input" type="number" min="0" max="5" step="1" value="${
            settings.encodeSpeed != null ? settings.encodeSpeed : ''
          }" placeholder="Auto" style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>CRF (0-63): </span>
          <input id="crf-input" class="yt_clipper-input" type="number" min="0" max="63" step="1" value="${
            settings.crf != null ? settings.crf : ''
          }" placeholder="Auto" style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Target Bitrate (kb/s) (0 = &#x221E;): </span>
          <input id="target-max-bitrate-input" class="yt_clipper-input" type="number" min="0" max="1e5"step="100" value="${
            settings.targetMaxBitrate != null ? settings.targetMaxBitrate : ''
          }" placeholder="Auto" "style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Gamma (0-4): </span>
          <input id="gamma-input" class="yt_clipper-input" type="number" min="0" max="4.00" step="0.01" value="${
            settings.gamma != null ? settings.gamma : ''
          }" placeholder="1" style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Two-Pass: </span>
          <select id="two-pass-input"> 
            <option ${settings.twoPass ? 'selected' : ''}>Enabled</option>
            <option ${settings.twoPass === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              settings.twoPass == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Denoise: </span>
          <select id="denoise-input"> 
            <option ${settings.denoise ? 'selected' : ''}>Enabled</option>
            <option ${settings.denoise === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              settings.denoise == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Audio: </span>
          <select id="audio-input"> 
            <option ${settings.audio ? 'selected' : ''}>Enabled</option>
            <option ${settings.audio === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              settings.audio == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Stabilization: </span>
          <select id="video-stabilization-input">
            <option ${
              vidstabDesc === 'Very Strong' ? 'selected' : ''
            }>Very Strong</option>
            <option ${vidstabDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${vidstabDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${vidstabDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${vidstabDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option value="Inherit" ${
              vidstabDesc == null ? 'selected' : ''
            }>Inherit (Disabled)</option>
          </select>
        </div>
      </div>
      `;

      updateSettingsEditorHook();
      settingsEditorHook.insertAdjacentElement('beforebegin', markerInputs);

      addInputListeners([
        ['speed-input', 'newMarkerSpeed', 'number'],
        ['crop-input', 'newMarkerCrop', 'string'],
        ['crop-res-input', 'cropRes', 'string'],
        ['merge-list-input', 'markerPairMergeList', 'string'],
        ['title-suffix-input', 'titleSuffix', 'string'],
        ['gamma-input', 'gamma', 'number'],
        ['encode-speed-input', 'encodeSpeed', 'number'],
        ['crf-input', 'crf', 'number'],
        ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
        ['rotate-0', 'rotate', 'string'],
        ['rotate-90-clock', 'rotate', 'string'],
        ['rotate-90-counterclock', 'rotate', 'string'],
        ['two-pass-input', 'twoPass', 'ternary'],
        ['denoise-input', 'denoise', 'ternary'],
        ['audio-input', 'audio', 'ternary'],
        ['video-stabilization-input', 'videoStabilization', 'vidstab'],
      ]);
      wasDefaultsEditorOpen = true;
      isMarkerEditorOpen = true;
      addCropInputHotkeys();
    }
  }

  function addInputListeners(inputs: string[][]) {
    inputs.forEach((input) => {
      const id = input[0];
      const updateTarget = input[1];
      const valueType = input[2] || 'string';
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', () => (toggleKeys = false), false);
      inputElem.addEventListener('blur', () => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        (e) => updateDefaultValue(e, updateTarget, valueType),
        false
      );
    });
  }

  const vidstabMap = {
    'Very Strong': { enabled: true, shakiness: 10, desc: 'Very Strong' },
    Strong: { enabled: true, shakiness: 8, desc: 'Strong' },
    Medium: { enabled: true, shakiness: 5, desc: 'Medium' },
    Weak: { enabled: true, shakiness: 3, desc: 'Weak' },
    'Very Weak': { enabled: true, shakiness: 1, desc: 'Very Weak' },
    Disabled: { enabled: false, desc: 'Disabled' },
  };
  function updateDefaultValue(e: Event, updateTarget: string, valueType: string) {
    if (e.target.reportValidity()) {
      let newValue = e.target.value;
      if (newValue != null) {
        if (updateTarget !== 'markerPairMergeList' && newValue === '') {
          delete settings[updateTarget];
          return;
        } else if (valueType === 'number') {
          newValue = parseFloat(newValue);
        } else if (valueType === 'boolean') {
          newValue = e.target.checked;
        } else if (valueType === 'ternary') {
          if (newValue === 'Default') {
            delete settings[updateTarget];
            return;
          } else if (newValue === 'Enabled') {
            newValue = true;
          } else if (newValue === 'Disabled') {
            newValue = false;
          }
        } else if (valueType === 'vidstab') {
          if (newValue === 'Inherit') {
            delete settings[updateTarget];
            return;
          }
          newValue = vidstabMap[newValue];
        }
      }

      settings[updateTarget] = newValue;

      if (updateTarget === 'newMarkerCrop') {
        createCropOverlay(settings.newMarkerCrop);
      }
      if (updateTarget === 'cropRes') {
        const prevWidth = settings.cropResWidth;
        const prevHeight = settings.cropResHeight;
        const [newWidth, newHeight] = settings.cropRes
          .split('x')
          .map((str) => parseInt(str), 10);
        const cropMultipleX = newWidth / prevWidth;
        const cropMultipleY = newHeight / prevHeight;
        settings.cropResWidth = newWidth;
        settings.cropResHeight = newHeight;
        multiplyAllCrops(cropMultipleX, cropMultipleY);
      }
    }
    console.log(settings);
  }

  function multiplyAllCrops(cropMultipleX: number, cropMultipleY: number) {
    const cropString = settings.newMarkerCrop;
    const multipliedCropString = multiplyCropString(
      cropMultipleX,
      cropMultipleY,
      cropString
    );
    settings.newMarkerCrop = multipliedCropString;
    const cropInput = document.getElementById('crop-input');
    cropInput.value = multipliedCropString;

    if (markers) {
      markers.forEach((markerPair) => {
        const multipliedCropString = multiplyCropString(
          cropMultipleX,
          cropMultipleY,
          markerPair.crop
        );
        markerPair.crop = multipliedCropString;
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

  function addCropInputHotkeys() {
    const cropInput = document.getElementById('crop-input') as HTMLInputElement;
    cropInput.addEventListener('keydown', (ke: KeyboardEvent) => {
      if (ke.code === 'ArrowUp' || ke.code === 'ArrowDown') {
        let cropString = cropInput.value;
        let cropStringArray = cropString.split(':');
        let cropArray = extractCropComponents(cropString);
        // let [x, y, w, ] = cropArray;
        const cropStringCursorPos = ke.target.selectionStart;
        let cropComponentCursorPos = cropStringCursorPos;
        let cropTarget = 0;
        while (cropComponentCursorPos - (cropStringArray[cropTarget].length + 1) >= 0) {
          cropComponentCursorPos -= cropStringArray[cropTarget].length + 1;
          cropTarget++;
        }
        if (
          cropTarget >= 0 &&
          cropTarget <= cropArray.length - 1 &&
          typeof cropArray[cropTarget] === 'number'
        ) {
          let changeAmount: number;
          if (!ke.ctrlKey && !ke.altKey && !ke.shiftKey) {
            changeAmount = 10;
          } else if (!ke.ctrlKey && ke.altKey && !ke.shiftKey) {
            changeAmount = 1;
          } else if (!ke.ctrlKey && !ke.altKey && ke.shiftKey) {
            changeAmount = 50;
          } else if (ke.ctrlKey && !ke.altKey && !ke.shiftKey) {
            changeAmount = 100;
          }

          if (ke.code === 'ArrowUp') {
            cropArray[cropTarget] += changeAmount;
          } else if (ke.code === 'ArrowDown') {
            cropArray[cropTarget] -= changeAmount;
          }

          ke.preventDefault();
          ke.stopImmediatePropagation();
          cropArray = clampCropArray(cropArray, cropTarget);
          const updatedCropString = cropArray.join(':');
          cropInput.value = updatedCropString;
          const newCursorPosition = cropStringCursorPos - cropComponentCursorPos;
          cropInput.selectionStart = newCursorPosition;
          cropInput.selectionEnd = newCursorPosition;
          cropInput.dispatchEvent(new Event('change'));
        }
      }
    });
  }
  function clampCropArray(cropArray: number[], target: string | number) {
    let [x, y, w, h] = cropArray;
    switch (target) {
      case 'x':
      case 0:
        x = clampNumber(x, 0, settings.cropResWidth - w);
        break;
      case 'y':
      case 1:
        y = clampNumber(y, 0, settings.cropResHeight - h);
        break;
      case 'w':
      case 2:
        w = clampNumber(w, 1, settings.cropResWidth - x);
        break;
      case 'h':
      case 3:
        h = clampNumber(h, 1, settings.cropResHeight - y);
        break;
    }
    return [x, y, w, h];
  }
  function clampNumber(number: number, min: number, max: number) {
    return Math.max(min, Math.min(number, max));
  }

  function createCropOverlay(crop: string) {
    if (isOverlayOpen) {
      deleteCropOverlay();
    }

    crop = crop.split(':');
    if (crop[2] === 'iw') {
      crop[2] = settings.cropResWidth;
    }
    if (crop[3] === 'ih') {
      crop[3] = settings.cropResHeight;
    }
    const cropDiv = document.createElement('div');
    cropDiv.setAttribute('id', 'crop-div');
    cropDiv.innerHTML = `<svg id="crop-svg" ></svg>`;

    let annotations = playerInfo.annotations;
    if (!annotations) {
      resizeCropOverlay(cropDiv);
      annotations = document.getElementsByClassName('html5-video-container')[0];
      annotations.insertAdjacentElement('afterend', cropDiv);
      window.addEventListener('resize', () => resizeCropOverlay(cropDiv));
    } else {
      annotations.insertBefore(cropDiv, annotations.firstElementChild);
    }
    const cropSvg = cropDiv.firstElementChild;
    const cropRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const cropRectAttrs = {
      x: `${(crop[0] / settings.cropResWidth) * 100}%`,
      y: `${(crop[1] / settings.cropResHeight) * 100}%`,
      width: `${(crop[2] / settings.cropResWidth) * 100}%`,
      height: `${(crop[3] / settings.cropResHeight) * 100}%`,
      fill: 'none',
      stroke: 'grey',
      'stroke-width': '3px',
      'stroke-dasharray': '25 5',
      'stroke-opacity': 0.8,
    };

    setAttributes(cropRect, cropRectAttrs);
    cropSvg.appendChild(cropRect);

    isOverlayOpen = true;
  }

  function resizeCropOverlay(cropDiv: HTMLDivElement) {
    const videoRect = player.getVideoContentRect();
    cropDiv.setAttribute(
      'style',
      `width:${videoRect.width}px;height:${videoRect.height}px;left:${
        videoRect.left
      }px;top:${videoRect.top}px;position:absolute`
    );
  }

  function deleteCropOverlay() {
    const cropDiv = document.getElementById('crop-div');
    deleteElement(cropDiv);
    isOverlayOpen = false;
  }

  function toggleCropOverlay() {
    const cropSvg = document.getElementById('crop-svg');
    if (cropSvg) {
      const cropDivDisplay = cropSvg.getAttribute('display');
      if (cropDivDisplay === 'none') cropSvg.setAttribute('display', 'block');
      else {
        cropSvg.setAttribute('display', 'none');
      }
    }
  }

  let isDrawingCrop = false;
  let beginDrawHandler: (e: MouseEvent) => void;
  let endDrawHandler: (e: MouseEvent) => void;
  function drawCropOverlay(verticalFill: boolean) {
    if (isDrawingCrop) {
      cancelDrawingCrop();
    } else {
      if (document.getElementById('crop-input')) {
        const videoRect = player.getVideoContentRect();
        const playerRect = player.getBoundingClientRect();

        beginDrawHandler = (e: MouseEvent) =>
          beginDraw(e, playerRect, videoRect, verticalFill);
        playerInfo.video.addEventListener('mousedown', beginDrawHandler, {
          once: true,
          capture: true,
        });
        togglePlayerControls();
        isDrawingCrop = true;
        flashMessage('Begin drawing crop', 'green');
      }
    }
  }

  function cancelDrawingCrop() {
    clearPartialCrop();
    flashMessage('Drawing crop canceled', 'red');
  }

  function clearPartialCrop() {
    togglePlayerControls();
    const beginCropPreview = document.getElementById('begin-crop-preview-div');
    if (beginCropPreview) {
      deleteElement(beginCropPreview);
    }
    if (beginDrawHandler) {
      playerInfo.video.removeEventListener('mousedown', beginDrawHandler, {
        capture: true,
      });
      beginDrawHandler = null;
    }
    if (endDrawHandler) {
      playerInfo.video.removeEventListener('mousedown', endDrawHandler, {
        capture: true,
      });
      endDrawHandler = null;
    }
    isDrawingCrop = false;
  }

  function createBeginCropPreview(x: number, y: number) {
    const beginCropPreview = document.createElement('div');
    beginCropPreview.setAttribute('id', 'begin-crop-preview-div');
    beginCropPreview.innerHTML = `<svg id="crop-svg"></svg>`;

    let annotations = playerInfo.annotations;
    if (!annotations) {
      resizeCropOverlay(beginCropPreview);
      annotations = document.getElementsByClassName('html5-video-container')[0];
      annotations.insertAdjacentElement('afterend', beginCropPreview);
      window.addEventListener('resize', () => resizeCropOverlay(beginCropPreview));
    } else {
      annotations.insertBefore(beginCropPreview, annotations.firstElementChild);
    }
    const beginCropPreviewSvg = beginCropPreview.firstElementChild;
    const beginCropPreviewRect = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect'
    );
    const cropRectAttrs = {
      x: `${(x / settings.cropResWidth) * 100}%`,
      y: `${(y / settings.cropResHeight) * 100}%`,
      width: '5px',
      height: '5px',
      fill: 'grey',
      'fill-opacity': 1,
    };
    setAttributes(beginCropPreviewRect, cropRectAttrs);
    beginCropPreviewSvg.appendChild(beginCropPreviewRect);
  }

  function togglePlayerControls() {
    const controls = playerInfo.controls;
    if (controls.style.display !== 'none') {
      controls.style.display = 'none';
    } else {
      controls.style.display = 'block';
    }
  }

  function beginDraw(
    e: MouseEvent,
    playerRect: ClientRect | DOMRect,
    videoRect: { left: number; width: number; top: number; height: number },
    verticalFill: boolean
  ) {
    if (e.button == 0 && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const beginX = Math.round(
        ((e.pageX - videoRect.left - playerRect.left) / videoRect.width) *
          settings.cropResWidth
      );
      let beginY = 0;
      if (!verticalFill) {
        beginY = Math.round(
          ((e.pageY - videoRect.top - playerRect.top) / videoRect.height) *
            settings.cropResHeight
        );
      }
      let crop = `${beginX}:${beginY}:`;
      createBeginCropPreview(beginX, beginY);

      endDrawHandler = (e: MouseEvent) =>
        endDraw(e, crop, beginX, beginY, playerRect, videoRect, verticalFill);
      playerInfo.video.addEventListener('mousedown', endDrawHandler, {
        once: true,
        capture: true,
      });
    } else {
      cancelDrawingCrop();
    }
  }

  function endDraw(
    e: MouseEvent,
    crop: string,
    beginX: number,
    beginY: number,
    playerRect: ClientRect | DOMRect,
    videoRect: { left: number; width: number; top: number; height: number },
    verticalFill: boolean
  ) {
    if (e.button == 0 && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const endX = Math.round(
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
      crop += `${endX - beginX}:${endY - beginY}`;
      const cropInput = document.getElementById('crop-input') as HTMLInputElement;
      cropInput.value = crop;
      cropInput.dispatchEvent(new Event('change'));

      clearPartialCrop();
    } else {
      cancelDrawingCrop();
    }
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
    if (isMarkerEditorOpen) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(ke.code) > -1) {
        ke.preventDefault();
        ke.stopImmediatePropagation();
        const cropInput = document.getElementById('crop-input') as HTMLInputElement;
        let [x, y, w, h] = extractCropComponents(cropInput.value);
        let changeAmount: number;
        if (!ke.altKey && !ke.shiftKey) {
          changeAmount = 10;
        } else if (ke.altKey && !ke.shiftKey) {
          changeAmount = 1;
        } else if (!ke.altKey && ke.shiftKey) {
          changeAmount = 50;
        } else if (ke.altKey && ke.altKey) {
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
        const cropArray = clampCropArray([x, y, w, h], cropTarget);
        cropInput.value = cropArray.join(':');
        cropInput.dispatchEvent(new Event('change'));
      }
    }
  }
  function extractCropComponents(cropString: string) {
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
  function updateAllMarkers(updateTarget: string, newValue: string | number) {
    if (updateTarget === 'speed') {
      newValue = parseFloat(newValue);
    }
    if (markers) {
      markers.forEach((marker) => {
        marker[updateTarget] = newValue;
      });
      markersSvg.childNodes.forEach((marker) => {
        marker.setAttribute(updateTarget, newValue.toString());
      });
    }
    flashMessage(`All marker ${updateTarget}s updated to ${newValue}`, 'olive');
  }

  function toggleMarkerEditorHandler(e: MouseEvent) {
    const targetMarker = e.target as SVGRectElement;

    if (targetMarker && e.shiftKey) {
      toggleMarkerPairEditor(targetMarker);
    }
  }

  function toggleMarkerPairEditor(targetMarker: SVGRectElement) {
    // toggling on off current pair editor
    if (prevSelectedMarkerPair === targetMarker && !wasDefaultsEditorOpen) {
      if (isMarkerEditorOpen) {
        toggleOffMarkerEditor();
      } else {
        toggleOnMarkerEditor(targetMarker);
      }
      // switching to different marker pair
      // delete current editor and create new editor
    } else {
      if (isMarkerEditorOpen) {
        toggleOffMarkerEditor();
      }
      toggleOnMarkerEditor(targetMarker);
    }
  }

  function toggleOffMarkerEditor() {
    deleteMarkerEditor();
    hideSelectedMarkerPairCropOverlay();
    if (isOverlayOpen) {
      toggleCropOverlay();
    }
  }

  function toggleOnMarkerEditor(targetMarker: SVGRectElement) {
    toggleCropOverlay();
    colorSelectedMarkerPair(targetMarker);
    enableMarkerHotkeys(targetMarker);
    createMarkerEditor(targetMarker);
    addCropInputHotkeys();
    prevSelectedMarkerPair = targetMarker;
  }

  function createMarkerEditor(targetMarker: SVGRectElement) {
    const markerIndex = targetMarker.getAttribute('idx') - 1;
    const currentMarker = markers[markerIndex];
    const startTime = toHHMMSS(currentMarker.start);
    const endTime = toHHMMSS(currentMarker.end);
    const speed = currentMarker.speed;
    const crop = currentMarker.crop;
    const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
    const markerInputsDiv = document.createElement('div');
    const overrides = currentMarker.overrides;
    const vidstab = overrides.videoStabilization;
    const vidstabDesc = vidstab ? vidstab.desc : null;
    const vidstabDescGlobal = settings.videoStabilization
      ? `(${settings.videoStabilization.desc})`
      : '';
    const markerPairOverridesEditorDisplay = targetMarker.getAttribute(
      'markerPairOverridesEditorDisplay'
    );
    createCropOverlay(crop);

    markerInputsDiv.setAttribute('id', 'markerInputsDiv');
    markerInputsDiv.innerHTML = `\
      <div class="yt_clipper-settings-editor">
        <span style="font-weight:bold;font-style:none">Marker Pair \
          <span id="marker-pair-number-label">${markerIndex + 1}</span>\
          /\
          <span id="marker-pair-count-label">${markers.length}</span>\
        Settings: </span>
        <div class="editor-input-div">
          <span>Speed: </span>
          <input id="speed-input" class="yt_clipper-input" type="number" placeholder="speed" value="${speed}" 
            step="0.05" min="0.05" max="2" style="width:4em" required></input>
        </div>
        <div class="editor-input-div">
          <span>Crop: </span>
          <input id="crop-input" class="yt_clipper-input" value="${crop}" pattern="${cropInputValidation}" 
          style="width:10em" required></input>
        </div>
        <div class="editor-input-div">
          <span>Title Prefix: </span>
          <input id="title-prefix-input" class="yt_clipper-input" value="${
            overrides.titlePrefix != null ? overrides.titlePrefix : ''
          }" placeholder="None" style="width:10em;text-align:right"></input>
        </div>
        <div class="editor-input-div">
          <span style="font-weight:bold;font-style:none">Time:</span>
          <span id="start-time">${startTime}</span>
          <span> - </span>
          <span id="end-time">${endTime}</span>
        </div>
      </div>
      <div id="marker-pair-overrides" class="yt_clipper-settings-editor" style="display:${markerPairOverridesEditorDisplay}">
        <span style="font-weight:bold">Overrides: </span>
        <div class="editor-input-div">
          <span>Gamma (0-4): </span>
          <input id="gamma-input" class="yt_clipper-input" type="number" min="0" max="4.00" step="0.01" value="${
            overrides.gamma != null ? overrides.gamma : ''
          }" placeholder="${settings.gamma || '1'}" style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Encode Speed (0-5): </span>
          <input id="encode-speed-input" class="yt_clipper-input" type="number" min="0" max="5" step="1" value="${
            overrides.encodeSpeed != null ? overrides.encodeSpeed : ''
          }" placeholder="${settings.encodeSpeed || 'Auto'}"  style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>CRF (0-63): </span>
          <input id="crf-input" class="yt_clipper-input" type="number" min="0" max="63" step="1" value="${
            overrides.crf != null ? overrides.crf : ''
          }" placeholder="${settings.crf || 'Auto'}" "style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Target Bitrate (kb/s) (0 = &#x221E;): </span>
          <input id="target-max-bitrate-input" class="yt_clipper-input" type="number" min="0" max="10e5" step="100" value="${
            overrides.targetMaxBitrate != null ? overrides.targetMaxBitrate : ''
          }" placeholder="${settings.targetMaxBitrate ||
      'Auto'}" "style="width:4em"></input>
        </div>
        <div class="editor-input-div">
          <span>Two-Pass: </span>
          <select id="two-pass-input"> 
            <option ${overrides.twoPass ? 'selected' : ''}>Enabled</option>
            <option ${overrides.twoPass === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              overrides.twoPass == null ? 'selected' : ''
            }>Inherit Global ${ternaryToString(settings.twoPass)}</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Denoise: </span>
          <select id="denoise-input"> 
            <option ${overrides.denoise ? 'selected' : ''}>Enabled</option>
            <option ${overrides.denoise === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              overrides.denoise == null ? 'selected' : ''
            }>Inherit Global ${ternaryToString(settings.denoise)}</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Audio: </span>
          <select id="audio-input"> 
            <option ${overrides.audio ? 'selected' : ''}>Enabled</option>
            <option ${overrides.audio === false ? 'selected' : ''}>Disabled</option>
            <option value="Default" ${
              overrides.audio == null ? 'selected' : ''
            }>Inherit Global ${ternaryToString(settings.audio)}</option>
          </select>
        </div>
        <div class="editor-input-div">
          <span>Stabilization: </span>
          <select id="video-stabilization-input">
            <option ${
              vidstabDesc === 'Very Strong' ? 'selected' : ''
            }>Very Strong</option>
            <option ${vidstabDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${vidstabDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${vidstabDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${vidstabDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option value="Disabled" ${
              vidstabDesc == 'Disabled' ? 'selected' : ''
            }>Disabled</option>
            <option value="Inherit" ${
              vidstabDesc == null ? 'selected' : ''
            }>Inherit Global ${vidstabDescGlobal}</option>
          </select>
        </div>
      </div>
      `;

    updateSettingsEditorHook();
    settingsEditorHook.insertAdjacentElement('beforebegin', markerInputsDiv);

    addMarkerInputListeners(
      [['speed-input', 'speed', 'number'], ['crop-input', 'crop', 'string']],
      targetMarker,
      markerIndex
    );
    addMarkerInputListeners(
      [
        ['title-prefix-input', 'titlePrefix', 'string'],
        ['gamma-input', 'gamma', 'number'],
        ['encode-speed-input', 'encodeSpeed', 'number'],
        ['crf-input', 'crf', 'number'],
        ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
        ['two-pass-input', 'twoPass', 'ternary'],
        ['denoise-input', 'denoise', 'ternary'],
        ['audio-input', 'audio', 'ternary'],
        ['video-stabilization-input', 'videoStabilization', 'vidstab'],
      ],
      targetMarker,
      markerIndex,
      true
    );
    isMarkerEditorOpen = true;
    wasDefaultsEditorOpen = false;
  }

  function ternaryToString(ternary: boolean) {
    if (ternary == null) {
      return '';
    } else if (ternary === true) {
      return '(Enabled)';
    } else if (ternary === false) {
      return '(Disabled)';
    } else {
      return null;
    }
  }

  function enableMarkerHotkeys(endMarker: SVGRectElement) {
    markerHotkeysEnabled = true;
    enableMarkerHotkeys.endMarker = endMarker;
    enableMarkerHotkeys.markerPairIndex = endMarker.getAttribute('idx');
    enableMarkerHotkeys.startMarker = endMarker.previousSibling;

    enableMarkerHotkeys.moveMarker = (marker) => {
      const type = marker.getAttribute('type');
      const idx = parseInt(marker.getAttribute('idx')) - 1;
      const currentTime = player.getCurrentTime();
      const progress_pos = (currentTime / playerInfo.duration) * 100;
      const markerTimeSpan = document.getElementById(`${type}-time`);
      marker.setAttribute('x', `${progress_pos}%`);
      if (type === 'start') {
        selectedStartMarkerOverlay.setAttribute('x', `${progress_pos}%`);
      } else if (type === 'end') {
        selectedEndMarkerOverlay.setAttribute('x', `${progress_pos}%`);
      }
      markers[idx][type === 'start' ? 'start' : 'end'] = currentTime;
      markerTimeSpan.textContent = `${toHHMMSS(currentTime)}`;
      if (type === 'start') {
      }
    };

    enableMarkerHotkeys.deleteMarkerPair = () => {
      const idx = parseInt(enableMarkerHotkeys.endMarker.getAttribute('idx')) - 1;
      markers.splice(idx, 1);

      const me = new MouseEvent('mouseover', { shiftKey: true });
      enableMarkerHotkeys.endMarker.dispatchEvent(me);
      deleteElement(enableMarkerHotkeys.endMarker);
      deleteElement(enableMarkerHotkeys.startMarker);
      const markersSvg = document.getElementById('markers-svg');
      markersSvg.childNodes.forEach((markerRect, idx) => {
        // renumber markers by pair starting with index 1
        const newIdx = Math.floor((idx + 2) / 2);
        markerRect.setAttribute('idx', newIdx);
      });

      enableMarkerHotkeys.moveMarker = null;
      enableMarkerHotkeys.deleteMarkerPair = null;
      markerHotkeysEnabled = false;
    };
  }

  let selectedStartMarkerOverlay: HTMLElement;
  let selectedEndMarkerOverlay: HTMLElement;
  function colorSelectedMarkerPair(currentMarker: SVGRectElement) {
    if (!selectedStartMarkerOverlay) {
      selectedStartMarkerOverlay = document.getElementById(
        'selected-start-marker-overlay'
      );
    }
    if (!selectedEndMarkerOverlay) {
      selectedEndMarkerOverlay = document.getElementById('selected-end-marker-overlay');
    }
    const startMarker = currentMarker.previousSibling;
    selectedStartMarkerOverlay.setAttribute('x', startMarker.getAttribute('x'));
    selectedEndMarkerOverlay.setAttribute('x', currentMarker.getAttribute('x'));
    selectedMarkerPairOverlay.style.display = 'block';
  }

  function addMarkerInputListeners(
    inputs: string[][],
    currentMarker: SVGRectElement,
    currentIdx: number,
    overridesField: boolean = false
  ) {
    inputs.forEach((input) => {
      const id = input[0];
      const updateTarget = input[1];
      const valueType = input[2] || 'string';
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', () => (toggleKeys = false), false);
      inputElem.addEventListener('blur', () => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        (e) =>
          updateMarkerSettings(
            e,
            updateTarget,
            valueType,
            currentMarker,
            currentIdx,
            overridesField
          ),
        false
      );
    });
  }

  function hideSelectedMarkerPairCropOverlay() {
    if (selectedEndMarkerOverlay) {
      selectedMarkerPairOverlay.style.display = 'none';
    }
  }

  function deleteMarkerEditor() {
    const markerInputsDiv = document.getElementById('markerInputsDiv');
    deleteElement(markerInputsDiv);
    isMarkerEditorOpen = false;
    markerHotkeysEnabled = false;
  }

  function toggleMarkerPairOverridesEditor() {
    if (isMarkerEditorOpen) {
      const markerPairOverridesEditor = document.getElementById('marker-pair-overrides');
      const globalEncodeSettingsEditor = document.getElementById(
        'global-encode-settings'
      );
      if (markerPairOverridesEditor) {
        if (markerPairOverridesEditor.style.display === 'none') {
          markerPairOverridesEditor.style.display = 'block';
          enableMarkerHotkeys.endMarker.setAttribute(
            'markerPairOverridesEditorDisplay',
            'block'
          );
        } else {
          markerPairOverridesEditor.style.display = 'none';
          enableMarkerHotkeys.endMarker.setAttribute(
            'markerPairOverridesEditorDisplay',
            'none'
          );
        }
      } else if (globalEncodeSettingsEditor) {
        if (globalEncodeSettingsEditor.style.display === 'none') {
          globalEncodeSettingsEditor.style.display = 'block';
          globalEncodeSettingsEditorDisplay = 'block';
        } else if (globalEncodeSettingsEditor.style.display === 'block') {
          globalEncodeSettingsEditor.style.display = 'none';
          globalEncodeSettingsEditorDisplay = 'none';
        }
      }
    }
  }
  function updateMarkerSettings(
    e: Event,
    updateTarget: string,
    valueType: string,
    currentMarker: SVGRectElement,
    currentIdx: number,
    overridesField: boolean = false
  ) {
    if (e.target.reportValidity()) {
      const marker = markers[currentIdx];
      let newValue = e.target.value;
      if (newValue != null) {
        if (newValue === '') {
          delete marker.overrides[updateTarget];
          console.log(marker.overrides);
          return;
        } else if (valueType === 'number') {
          newValue = parseFloat(newValue);
        } else if (valueType === 'ternary') {
          if (newValue === 'Default') {
            delete marker.overrides[updateTarget];
            console.log(marker.overrides);
            return;
          } else if (newValue === 'Enabled') {
            newValue = true;
          } else if (newValue === 'Disabled') {
            newValue = false;
          }
        } else if (valueType === 'vidstab') {
          if (newValue === 'Inherit') {
            delete marker.overrides[updateTarget];
            console.log(marker.overrides);
            return;
          }
          newValue = vidstabMap[newValue];
        }
      }
      if (!overridesField) {
        marker[updateTarget] = newValue;
        if (updateTarget === 'crop') {
          createCropOverlay(newValue);
        }
      } else {
        marker.overrides[updateTarget] = newValue;
      }
      console.log(marker.overrides);
    }
  }

  function saveAuthServerScript() {
    const authScript = `\
import json
import re
from urllib.parse import urlencode, urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler

CLIENT_ID = 'XXXX'
REDIRECT_URI = 'http://127.0.0.1:4443/yt_clipper?'

BROWSER_BASED_AUTH_ENDPOINT = f'https://gfycat.com/oauth/authorize?client_id={CLIENT_ID}&scope=all&state=yt_clipper&response_type=token&redirect_uri={REDIRECT_URI}'

REDIRECT_PAGE_BODY = b'''
<body>
    <script>
        let url = window.location.href;
        url = url.replace('?','&');
        url = url.replace('#','?access-token=');
        window.open(url,'_self');
    </script>
</body>
'''

COMPLETE_AUTH_PAGE_BODY = b'''
<body>
    <span>
        Please close this window and return to yt_clipper.
    </span>
</body>
'''


class getServer(BaseHTTPRequestHandler):
    redirected = -1

    def do_GET(self):
        print(self.path)
        if re.match('/yt_clipper*', self.path):
            if getServer.redirected == -1:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(REDIRECT_PAGE_BODY)
                getServer.redirected = 0
            elif getServer.redirected == 0:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(COMPLETE_AUTH_PAGE_BODY)
                getServer.query = parse_qs(urlparse(self.path).query)
                getServer.redirected = 1
            elif getServer.redirected == 1:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(getServer.query).encode())


httpd = HTTPServer(('localhost', 4443), getServer)
httpd.serve_forever()
`;
    const blob = new Blob([authScript], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `yt_clipper_auth.py`);
  }

  function buildGfyRequests(markers, url: string) {
    return markers.map((marker: marker, idx: number) => {
      const start = marker.start;
      const end = marker.end;
      const speed = marker.speed;
      let [x, y, w, h] = marker.crop.split(':');
      w = w === 'iw' ? settings.cropResWidth.toString() : w;
      h = h === 'ih' ? settings.cropResHeight.toString() : h;
      let crop = [x, y, w, h].map((num) => parseInt(num, 10));
      const startHHMMSS = toHHMMSS(start).split(':');
      const startHH = startHHMMSS[0];
      const startMM = startHHMMSS[1];
      const startSS = startHHMMSS[2];
      const duration = end - start;
      let req = {
        fetchUrl: url,
        title: `${settings.titleSuffix}-${idx + 1}`,
        fetchHours: startHH,
        fetchMinutes: startMM,
        fetchSeconds: startSS,
        noMd5: 'false',
        cut: { start, duration },
        speed,
        crop: { x: crop[0], y: crop[1], w: crop[2], h: crop[3] },
      };
      return req;
    });
  }

  function requestGfycatAuth() {
    const authPage = window.open(BROWSER_BASED_AUTH_ENDPOINT);
    const timer = setInterval(() => {
      if (authPage.closed) {
        clearInterval(timer);
        getAccessToken();
      }
    }, 2500);
  }

  function getAccessToken() {
    return new Promise(() => {
      fetch(REDIRECT_URI, { mode: 'cors' })
        .then((response) => {
          return response.json();
        })
        .then((json) => {
          const accessToken = json['access-token'][0];
          console.log(accessToken);
          sendGfyRequests(playerInfo.url, accessToken);
        })
        .catch((error) => console.error(error));
    });
  }

  function sendGfyRequests(url: string, accessToken?: string) {
    if (markers.length > 0) {
      const markdown = toggleUploadStatus();
      const reqs = buildGfyRequests(markers, url).map(
        (req: { speed: string }, idx: any) => {
          return buildGfyRequestPromise(req, idx, accessToken);
        }
      );

      Promise.all(reqs).then((gfynames) => {
        console.log(reqs);
        console.log(gfynames);
        checkGfysCompletedId = setInterval(checkGfysCompleted, 5000, gfynames, markdown);
      });
    }
  }

  function buildGfyRequestPromise(
    reqData: { speed: string },
    idx: any,
    accessToken: any
  ) {
    return new Promise((resolve, reject) => {
      postData('https://api.gfycat.com/v1/gfycats', reqData, accessToken)
        .then((resp: { gfyname: {} | PromiseLike<{}> }) => {
          links.push(
            `(${settings.titleSuffix}-${idx})[https://gfycat.com/${resp.gfyname}]`
          );
          resolve(resp.gfyname);
        })
        .catch((error: Error) => reject(error));
    });
  }

  function checkGfysCompleted(gfynames: string[], markdown: any) {
    const gfyStatuses = gfynames.map((gfyname) => {
      return checkGfyStatus(gfyname, markdown).then((isComplete) => {
        return isComplete;
      });
    });
    Promise.all(gfyStatuses)
      .then((gfyStatuses) => {
        areGfysCompleted(gfyStatuses).then(() => insertMarkdown(markdown));
      })
      .catch(() => console.log('gfys not yet completed'));
  }

  function toggleUploadStatus() {
    const meta = document.getElementById('meta');
    const markdown = document.createElement('textarea');
    meta.insertAdjacentElement('beforebegin', markdown);
    setAttributes(markdown, {
      id: 'markdown',
      style: 'color:grey;width:600px;height:100px;',
      spellcheck: false,
    });
    markdown.textContent = 'Upload initiated. Progress updates will begin shortly.\n';
    return markdown;
  }

  function updateUploadStatus(
    markdown: { textContent: string; scrollTop: any; scrollHeight: any },
    status: { progress: any },
    gfyname: name
  ) {
    if (markdown) {
      markdown.textContent += `${gfyname} progress: ${status.progress}\n`;
      markdown.scrollTop = markdown.scrollHeight;
    }
  }

  function insertMarkdown(markdown: { textContent: string }) {
    if (markdown) {
      markdown.textContent = links.join('\n');
      window.clearInterval(checkGfysCompletedId);
    }
  }

  function areGfysCompleted(gfyStatuses: {}[]) {
    return new Promise((resolve, reject) => {
      if (gfyStatuses.every(Boolean)) {
        resolve();
      } else {
        reject();
      }
    });
  }

  function checkGfyStatus(gfyname: string, markdown: any) {
    return new Promise((resolve, reject) => {
      fetch(`https://api.gfycat.com/v1/gfycats/fetch/status/${gfyname}`)
        .then((response) => {
          return response.json();
        })
        .then((myJson) => {
          updateUploadStatus(markdown, myJson, gfyname);
          myJson.task === 'complete' ? resolve(true) : reject(false);
        })
        .catch((error) => console.error(error));
    });
  }

  function postData(url: RequestInfo, data: any, accessToken: any) {
    const auth = accessToken ? `Bearer ${accessToken}` : null;
    const req = {
      body: JSON.stringify(data), // must match 'Content-Type' header
      cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
      credentials: 'omit', // include, same-origin, *omit
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      mode: 'cors', // no-cors, cors, *same-origin
      redirect: 'follow', // manual, *follow, error
      referrer: 'no-referrer', // *client, no-referrer
    };
    if (auth) {
      req.headers.Authorization = auth;
    }
    console.log(req);
    return fetch(url, req).then((response: { json: () => void }) => response.json()); // parses response to JSON
  }

  function toHHMMSS(seconds: number) {
    return new Date(seconds * 1000).toISOString().substr(11, 12);
  }

  function setAttributes(el: HTMLElement, attrs: {}) {
    Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]));
  }

  function copyToClipboard(str: string) {
    const el = document.createElement('textarea');
    el.value = str;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function once(fn: Function, context: any) {
    var result: Function;
    return function() {
      if (fn) {
        result = fn.apply(context || this, arguments);
        fn = null;
      }
      return result;
    };
  }
})();
