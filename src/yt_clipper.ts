// ==UserScript==
// @locale       english
// @name         yt_clipper
// @namespace    http://tampermonkey.net/
// @version      0.0.71
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
    twoPassEnabled?: boolean;
    denoiseEnabled?: boolean;
    audioEnabled?: boolean;
  }
  interface marker {
    start: number;
    end: number;
    speed: number;
    crop: string;
    overrides: markerPairOverrides;
  }
  let markers: marker[] = [];
  let links: string[] = [];

  let startTime = 0.0;
  let toggleKeys = false;
  let undoMarkerOffset = 0;
  let prevSelectedMarkerPair: SVGRectElement = null;

  document.addEventListener('keyup', hotkeys, false);

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
            saveMarkers();
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
          if (e.shiftKey && !e.ctrlKey) {
            updateAllMarkers('speed', settings.defaultSpeed);
          }
          break;
        case 'KeyD':
          if (e.shiftKey && !e.ctrlKey) {
            updateAllMarkers('crop', settings.defaultCrop);
          }
          break;
        case 'KeyG':
          if (!e.shiftKey && !e.altKey) {
            loadMarkers();
          } else if (e.shiftKey && !e.altKey) {
            toggleSpeedAutoDucking();
          } else if (!e.shiftKey && e.altKey) {
            toggleMarkerLooping();
          }
          break;
        case 'KeyZ':
          if (!e.shiftKey && !markerHotkeysEnabled) {
            undoMarker();
          } else if (
            e.shiftKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.deleteMarkerPair
          ) {
            enableMarkerHotkeys.deleteMarkerPair();
          }
          break;
        case 'KeyX':
          if (!e.shiftKey && !e.ctrlKey) {
            drawCropOverlay(false);
          } else if (e.shiftKey && !e.ctrlKey) {
            drawCropOverlay(true);
          }
          break;
        case 'KeyC':
          if (!e.ctrlKey && !e.shiftKey && e.altKey) {
            sendGfyRequests(markers, playerInfo.url);
          } else if (!e.ctrlKey && e.shiftKey && e.altKey) {
            requestGfycatAuth();
          }
          break;
      }
    }
    if (!e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyA') {
      toggleKeys = !toggleKeys;
      initOnce();
      console.log('keys enabled: ' + toggleKeys);
      if (toggleKeys) {
        flashMessage('Enabled Hotkeys', 'green');
      } else {
        flashMessage('Disabled Hotkeys', 'red');
      }
    }
  }

  function init() {
    initPlayerInfo();
    initMarkersContainer();
    initCSS();
    addForeignEventListeners();
  }
  const initOnce = once(init, this);
  const player = document.getElementById('movie_player');
  const playerInfo = {};
  const video = document.getElementsByTagName('video')[0];
  function initPlayerInfo() {
    playerInfo.url = player.getVideoUrl();
    playerInfo.playerData = player.getVideoData();
    playerInfo.videoTitle = playerInfo.playerData.title;
    playerInfo.duration = player.getDuration();
    playerInfo.video = document.getElementsByTagName('video')[0];
    playerInfo.isVerticalVideo = player.getVideoAspectRatio() <= 1;
    playerInfo.progress_bar = document.getElementsByClassName('ytp-progress-bar')[0];
    playerInfo.infoContents = document.getElementById('info-contents');
    playerInfo.annotations = document.getElementsByClassName('ytp-iv-video-content')[0];
    playerInfo.controls = document.getElementsByClassName('ytp-chrome-bottom')[0];
  }

  interface settings {
    defaultSpeed: number;
    defaultCrop: string;
    titleSuffix: string;
    cropRes: string;
    cropResWidth: number;
    cropResHeight: number;
    markerPairMergeList: string;
  }
  let settings: settings;
  let markersSvg: SVGAElement;
  let selectedMarkerPairOverlay: SVGAElement;
  function initMarkersContainer() {
    settings = {
      defaultSpeed: 1.0,
      defaultCrop: '0:0:iw:ih',
      titleSuffix: `${playerInfo.playerData.video_id}`,
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
    markersSvg = markersDiv.children[0] as SVGAElement;
    selectedMarkerPairOverlay = markersDiv.children[1] as SVGAElement;
  }

  function initCSS() {
    const clipperCSS = `\
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
.marker-settings-display {
  display: block;
  color: grey;
  font-size: 12pt;
  font-style: italic;
  margin: 2px;
  padding: 2px;
  border: 2px solid grey;
}
#marker-pair-overrides {
  color: grey;
  font-size: 12pt;
  margin: 2px;
  padding: 2px;
  border: 2px solid grey;
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

    const style = document.createElement('style');
    style.innerHTML = clipperCSS;
    document.body.appendChild(style);
  }

  function addForeignEventListeners() {
    const ids = ['search'];
    ids.forEach(id => {
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

  function flashMessage(msg: string, color: string, lifetime = 4000) {
    const infoContents = playerInfo.infoContents;
    const flashDiv = document.createElement('div');
    flashDiv.setAttribute('class', 'flash-div');
    flashDiv.innerHTML = `<span class="flash-msg" style="color:${color}">${msg}</span>`;
    infoContents.insertBefore(flashDiv, infoContents.firstChild);
    setTimeout(() => deleteElement(flashDiv), lifetime);
  }

  function deleteElement(elem: HTMLElement) {
    if (elem) {
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
    let currentIdx: number;
    const currentTime = video.currentTime;
    const isTimeBetweenMarkerPair = markers.some((marker, idx) => {
      if (currentTime >= marker.start && currentTime <= marker.end) {
        currentIdx = idx;
        return true;
      }
      return false;
    });
    if (isTimeBetweenMarkerPair && markers[currentIdx]) {
      const currentMarkerSlowdown = markers[currentIdx].speed;
      if (player.getPlaybackRate() !== currentMarkerSlowdown) {
        player.setPlaybackRate(currentMarkerSlowdown);
      }
    } else if (player.getPlaybackRate() !== 1) {
      player.setPlaybackRate(1);
    }
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
      const currentTime = player.getCurrentTime();

      const isTimeBetweenMarkerPair =
        startMarkerTime < currentTime && currentTime < endMarkerTime;
      if (!isTimeBetweenMarkerPair) {
        player.seekTo(startMarkerTime);
        player.playVideo();
      }
    }
  }

  function saveMarkers() {
    markers.forEach((marker: marker, index: number) => {
      const speed = marker.speed;
      if (typeof speed === 'string') {
        marker.speed = Number(speed);
        console.log(`Converted marker pair ${index}'s speed from String to Number`);
      }
    });
    const markersJson = JSON.stringify(
      {
        videoID: playerInfo.playerData.video_id,
        videoTitle: playerInfo.videoTitle,
        cropRes: settings.cropRes,
        cropResWidth: settings.cropResWidth,
        cropResHeight: settings.cropResHeight,
        titleSuffix: settings.titleSuffix,
        markerPairMergeList: settings.markerPairMergeList,
        markers: markers,
      },
      undefined,
      2
    );
    const blob = new Blob([markersJson], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${settings.titleSuffix}.json`);
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
        'margin-top:2px;padding:2px;border:2px outset grey'
      );
      markersUploadDiv.innerHTML = `<fieldset>\
      <h2>Upload a markers .json file.</h2>\
        <input type="file" id="markers-json-input">\
        <input type="button" id="upload-markers-json" value="Load">\
      </fieldset>`;
      playerInfo.infoContents.insertAdjacentElement('afterbegin', markersUploadDiv);
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
        toggleOverlay();
      }
    }

    flashMessage('Loading markers.', 'green');

    if (markersJson[playerInfo.playerData.video_id]) {
      settings.cropRes = markersJson['crop-res'];
      settings.cropResWidth = markersJson['crop-res-width'];
      settings.cropResHeight = markersJson['crop-res-height'];
      markers.length = 0;
      undoMarkerOffset = 0;
      markersJson[playerInfo.playerData.video_id].forEach((marker: marker) => {
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

    marker_attrs.speed = markerConfig.speed || settings.defaultSpeed;
    marker_attrs.crop = markerConfig.crop || settings.defaultCrop;

    const roughCurrentTime = markerConfig.time || player.getCurrentTime();
    const currentFrameTime = getCurrentFrameTime(roughCurrentTime);
    const progress_pos = (currentFrameTime / playerInfo.duration) * 100;

    setAttributes(marker, marker_attrs);
    marker.setAttribute('x', `${progress_pos}%`);
    const rectIdx = markers.length + 1 + undoMarkerOffset;
    marker.setAttribute('idx', rectIdx.toString());
    marker.setAttribute('time', currentFrameTime.toString());

    if (start === true) {
      marker.classList.add('start-marker');
      marker.setAttribute('type', 'start');
      marker.setAttribute('z-index', '1');
      startTime = currentFrameTime;
    } else {
      marker.addEventListener('mouseover', toggleMarkerEditor, false);
      marker.classList.add('end-marker');
      marker.setAttribute('type', 'end');
      marker.setAttribute('z-index', '2');
      updateMarkersArray(currentFrameTime, markerConfig);
    }

    start = !start;
    console.log(markers);
  }

  function getCurrentFrameTime(roughCurrentTime: number): number {
    let currentFrameTime;
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
      speed: markerPairConfig.speed || settings.defaultSpeed,
      crop: markerPairConfig.crop || settings.defaultCrop,
      overrides: markerPairConfig.overrides || {
        denoiseEnabled: false,
        twoPassEnabled: false,
        audioEnabled: false,
      },
    };

    if (undoMarkerOffset === -1) {
      const lastMarkerIdx = markers.length - 1;
      markers[lastMarkerIdx] = updatedMarker;
      undoMarkerOffset = 0;
    } else if (undoMarkerOffset === 0) {
      markers.push(updatedMarker);
    }
  }

  function undoMarker() {
    const targetMarker = markersSvg.lastChild;
    if (targetMarker) {
      const deletedMarkerType = targetMarker.getAttribute('type');
      markersSvg.removeChild(targetMarker);
      if (deletedMarkerType === 'start' && undoMarkerOffset === -1) {
        markers.pop();
        undoMarkerOffset = 0;
      } else if (deletedMarkerType === 'end') {
        undoMarkerOffset = -1;
        startTime = markers[Math.floor(markers.length - 1)].start;
      }
      start = !start;
    }
  }

  function cyclePlayerSpeedDown() {
    let newSpeed = player.getPlaybackRate() - 0.25;
    newSpeed = newSpeed <= 0 ? 1 : newSpeed;
    player.setPlaybackRate(newSpeed);
    flashMessage(`Video playback speed set to ${newSpeed}`, 'green');
  }

  function toggleDefaultsEditor() {
    if (isMarkerEditorOpen) {
      deleteMarkerEditor();
      if (isOverlayOpen) {
        toggleOverlay();
      }
    }
    if (wasDefaultsEditorOpen && !prevSelectedMarkerPair) {
      wasDefaultsEditorOpen = false;
    } else {
      if (prevSelectedMarkerPair) {
        clearSelectedMarkerPairOverlay(prevSelectedMarkerPair);
        prevSelectedMarkerPair = null;
      }
      toggleOverlay();
      createCropOverlay(settings.defaultCrop);
      const infoContents = playerInfo.infoContents;
      const markerInputs = document.createElement('div');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const csvRange = `(\\d{1,2})([,-]\\d{1,2})*`;
      const concatsInputValidation = `(${csvRange})+(;${csvRange})*`;
      const gte100 = `([1-9]\\d{3}|[1-9]\\d{2})`;
      const resInputValidation = `${gte100}x${gte100}`;
      const resList = playerInfo.isVerticalVideo
        ? `<option value="1080x1920"><option value="2160x3840">`
        : `<option value="1920x1080"><option value="3840x2160">`;
      markerInputs.setAttribute('id', 'markerInputsDiv');
      markerInputs.setAttribute(
        'style',
        'margin-top:2px;padding:2px;border:2px outset grey'
      );
      markerInputs.innerHTML = `\
      <div class="editor-input-div">
        <span class="editor-input-label">Default Speed: </span>
        <input id="speed-input" class="yt_clipper-input"  type="number" placeholder="speed" value="${
          settings.defaultSpeed
        }" step="0.05" min="0.05" max="2" style="width:4em;font-weight:bold">
      </div>
      <div class="editor-input-div">
        <span class="editor-input-label"> Default Crop: </span>
        <input id="crop-input" class="yt_clipper-input" value="${
          settings.defaultCrop
        }" pattern="${cropInputValidation}" style="width:10em;font-weight:bold" required>
      </div>
      <div class="editor-input-div">
        <span class="editor-input-label"> Crop Resolution: </span>
        <input id="crop-res-input" class="yt_clipper-input" list="resolutions" pattern="${resInputValidation}" value="${
        settings.cropRes
      }" style="width:7em;font-weight:bold" required>
        <datalist id="resolutions" autocomplete="off">${resList}</datalist>
      </div>
      <div class="editor-input-div">
        <span class="editor-input-label"> Merge List: </span>
        <input id="merge-list-input" class="yt_clipper-input" pattern="${concatsInputValidation}" style="width:15em;font-weight:bold">
      </div>
      <div class="editor-input-div">
        <span class="editor-input-label"> Title Prefix: </span>
        <input id="title-suffix-input" class="yt_clipper-input" value="[${
          settings.titleSuffix
        }]" style="background-color:lightgreen;width:20em;text-align:right">
      </div>
      `;

      infoContents.insertBefore(markerInputs, infoContents.firstChild);

      addInputListeners([
        ['speed-input', 'defaultSlowdown'],
        ['crop-input', 'defaultCrop'],
        ['crop-res-input', 'cropRes'],
        ['merge-list-input', 'markerPairMergeList'],
        ['title-suffix-input', 'titleSuffix'],
      ]);
      wasDefaultsEditorOpen = true;
      isMarkerEditorOpen = true;
    }
  }

  function addInputListeners(inputs: string[][]) {
    inputs.forEach(input => {
      const id = input[0];
      const updateTarget = input[1];
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', () => (toggleKeys = false), false);
      inputElem.addEventListener('blur', () => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        e => updateDefaultValue(e, updateTarget),
        false
      );
    });
  }

  function updateDefaultValue(e: Event, updateTarget: string) {
    if (e.target.reportValidity()) {
      settings[updateTarget] = e.target.value;
      if (
        settings[updateTarget] === settings.defaultCrop ||
        settings[updateTarget] === settings.cropRes
      ) {
        createCropOverlay(settings.defaultCrop);
      }
      if (settings[updateTarget] === settings.cropRes) {
        const prevWidth = settings.cropResWidth;
        const prevHeight = settings.cropResHeight;
        const [newWidth, newHeight] = settings.cropRes.split('x').map(parseInt);
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
    const cropString = settings.defaultCrop;
    const multipliedCropString = multiplyCropString(
      cropMultipleX,
      cropMultipleY,
      cropString
    );
    settings.defaultCrop = multipliedCropString;
    const cropInput = document.getElementById('crop-input');
    cropInput.value = multipliedCropString;

    if (markers) {
      markers.forEach(marker => {
        const multipliedCropString = multiplyCropString(
          cropMultipleX,
          cropMultipleY,
          marker.crop
        );
        marker.crop = multipliedCropString;
      });
      markersSvg.childNodes.forEach(marker => {
        const cropString = marker.getAttribute('crop');
        const multipliedCropString = multiplyCropString(
          cropMultipleX,
          cropMultipleY,
          cropString
        );
        marker.setAttribute('crop', multipliedCropString);
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

  function toggleOverlay() {
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
    videoRect: { left: number; width: number; height: number },
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
          ((e.pageY - playerRect.top) / videoRect.height) * settings.cropResHeight
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
    videoRect: { left: any; width: any; height: any },
    verticalFill: boolean
  ) {
    if (e.button == 0 && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const endX = Math.round(
        ((e.pageX - playerRect.left - videoRect.left) / videoRect.width) *
          settings.cropResWidth
      );
      let endY = settings.cropResHeight;
      if (!verticalFill) {
        endY = Math.round(
          ((e.pageY - playerRect.top) / videoRect.height) * settings.cropResHeight
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

  function updateAllMarkers(updateTarget: string, newValue: string | number) {
    if (updateTarget === 'speed') {
      newValue = parseFloat(newValue);
    }
    if (markers) {
      markers.forEach(marker => {
        marker[updateTarget] = newValue;
      });
      markersSvg.childNodes.forEach(marker => {
        marker.setAttribute(updateTarget, newValue.toString());
      });
    }
    flashMessage(`All marker ${updateTarget}s updated to ${newValue}`, 'olive');
  }

  function toggleMarkerEditor(e: MouseEvent) {
    const targetMarker = e.target as SVGRectElement;

    if (targetMarker && e.shiftKey) {
      // if marker editor is open, always delete it
      if (isMarkerEditorOpen) {
        deleteMarkerEditor();
        clearSelectedMarkerPairOverlay(targetMarker);
        if (isOverlayOpen) {
          toggleOverlay();
        }
      }
      // toggling already selected marker pair
      if (prevSelectedMarkerPair === targetMarker) {
        prevSelectedMarkerPair = null;
      }
      // switching to a different marker pair
      else {
        if (prevSelectedMarkerPair) {
          clearSelectedMarkerPairOverlay(prevSelectedMarkerPair);
        }
        prevSelectedMarkerPair = targetMarker;
        if (isOverlayOpen) {
          toggleOverlay();
        }
        toggleOverlay();
        colorSelectedMarkerPair(targetMarker);
        enableMarkerHotkeys(targetMarker);
        createMarkerEditor(targetMarker);
      }
    }

    function createMarkerEditor(targetMarker) {
      const infoContents = playerInfo.infoContents;
      const markerIndex = targetMarker.getAttribute('idx') - 1;
      const currentMarker = markers[markerIndex];
      const startTime = toHHMMSS(currentMarker.start);
      const endTime = toHHMMSS(currentMarker.end);
      const speed = currentMarker.speed;
      const crop: string = targetMarker.getAttribute('crop');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const markerInputsDiv = document.createElement('div');
      const overrides = currentMarker.overrides;
      const markerPairOverridesEditorDisplay = targetMarker.getAttribute(
        'markerPairOverridesEditorDisplay'
      );
      createCropOverlay(crop);

      markerInputsDiv.setAttribute('id', 'markerInputsDiv');
      markerInputsDiv.setAttribute(
        'style',
        'margin-top:2px;padding:2px;border:2px outset grey'
      );
      markerInputsDiv.innerHTML = `\
      <div class="editor-input-div">
        <span>Speed: </span>
        <input id="speed-input" class="yt_clipper-input" type="number" placeholder="speed" value="${speed}" 
          step="0.05" min="0.05" max="2" style="width:4em;font-weight:bold" required></input>
      </div>
      <div class="editor-input-div">
        <span>Crop: </span>
        <input id="crop-input" class="yt_clipper-input" value="${crop}" pattern="${cropInputValidation}" 
        style="width:10em;font-weight:bold" required></input>
      </div>
      <div class="marker-settings-display">
        <span style="font-weight:bold;font-style:none">Marker Pair Info:   </span>
        <span>   </span>
        <span id="marker-idx-display" ">[Number: ${markerIndex + 1}]</span>
        <span id="speed-display">[Speed: ${speed}x]</span>
        <span>   </span>
        <span id="crop-display">[Crop: ${crop}]</span>
        <span>[Time: </span>
        <span id="start-time">${startTime}</span>
        <span> - </span>
        <span id="end-time">${endTime}</span>
        <span>]</span>
      </div>
      <div id="marker-pair-overrides" style="display:${markerPairOverridesEditorDisplay}">
        <span style="font-weight:bold">Marker Pair Overrides: </span>
        <div class="editor-input-div">
          <span>Title Prefix: </span>
          <input id="title-prefix-input" class="yt_clipper-input" value="${
            overrides.titlePrefix != null ? overrides.titlePrefix : ''
          }" style="width:10em;font-weight:bold"></input>
        </div>
        <div class="editor-input-div">
          <span>Gamma (0.00-4.00): </span>
          <input id="gamma-input" class="yt_clipper-input" type="number" min="0" max="4.00" step="0.01" value="${
            overrides.gamma != null ? overrides.gamma : ''
          }" style="width:10em;font-weight:bold"></input>
        </div>
        <div class="editor-input-div">
          <span>Encode Speed (0-5): </span>
          <input id="encode-speed-input" class="yt_clipper-input" type="number" min="0" max="5" step="1" value="${
            overrides.encodeSpeed != null ? overrides.encodeSpeed : ''
          }" style="width:10em;font-weight:bold"></input>
        </div>
        <div class="editor-input-div">
          <span>CRF (0-63): </span>
          <input id="crf-input" class="yt_clipper-input" type="number" min="0" max="63" step="1" value="${
            overrides.crf != null ? overrides.crf : ''
          }" style="width:10em;font-weight:bold"></input>
        </div>
        <div class="editor-input-div">
          <span>Two-Pass: </span>
          <input id="two-pass-enabled-input" type="checkbox" value="${Boolean(
            overrides.twoPassEnabled
          )}"></input>
        </div>
        <div class="editor-input-div">
          <span>Denoise: </span>
          <input id="denoise-enabled-input" type="checkbox" value="${Boolean(
            overrides.denoiseEnabled
          )}"></input>
        </div>
        <div class="editor-input-div">
          <span>Audio: </span>
          <input id="audio-enabled-input" type="checkbox" value="${Boolean(
            overrides.audioEnabled
          )}"></input>
        </div>
      </div>
      `;
      infoContents.insertBefore(markerInputsDiv, infoContents.firstChild);

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
          ['two-pass-enabled-input', 'twoPassEnabled', 'boolean'],
          ['denoise-enabled-input', 'denoiseEnabled', 'boolean'],
          ['audio-enabled-input', 'audioEnabled', 'boolean'],
        ],
        targetMarker,
        markerIndex,
        true
      );
      isMarkerEditorOpen = true;
      wasDefaultsEditorOpen = false;
    }
  }

  function enableMarkerHotkeys(endMarker) {
    markerHotkeysEnabled = true;
    enableMarkerHotkeys.endMarker = endMarker;
    enableMarkerHotkeys.startMarker = endMarker.previousSibling;

    enableMarkerHotkeys.moveMarker = marker => {
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
      marker.setAttribute('time', `${currentTime}`);
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

  let selectedStartMarkerOverlay;
  let selectedEndMarkerOverlay;
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
    overridesField = false
  ) {
    inputs.forEach(input => {
      const id = input[0];
      const updateTarget = input[1];
      const valueType = input[2] || 'string';
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', () => (toggleKeys = false), false);
      inputElem.addEventListener('blur', () => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        e =>
          updateMarker(
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

  function clearSelectedMarkerPairOverlay(marker: SVGRectElement) {
    selectedMarkerPairOverlay.style.display = 'none';
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
      }
    }
  }
  function updateMarker(
    e: Event,
    updateTarget: string,
    valueType: string,
    currentMarker: SVGRectElement,
    currentIdx: number,
    overridesField: boolean = false
  ) {
    if (e.target.reportValidity()) {
      let newValue = e.target.value;
      if (newValue != null) {
        if (valueType === 'number') {
          newValue = parseFloat(newValue);
        } else if (valueType === 'boolean') {
          newValue = Boolean(newValue);
        }
      }

      const marker = markers[currentIdx];
      if (!overridesField) {
        const currentType = currentMarker.getAttribute('type');
        if (updateTarget === 'speed') {
          const speedDisplay = document.getElementById('speed-display');
          speedDisplay.textContent = `[Speed: ${newValue}]`;
        } else if (updateTarget === 'crop') {
          marker.crop = newValue;
          const cropDisplay = document.getElementById('crop-display');
          cropDisplay.textContent = `[Crop: ${newValue}]`;
          createCropOverlay(newValue);
        }
        currentMarker.setAttribute(updateTarget, newValue);
        if (currentType === 'start') {
          currentMarker.nextSibling.setAttribute(updateTarget, newValue);
        } else if (currentType === 'end') {
          currentMarker.previousSibling.setAttribute(updateTarget, newValue);
        }
      } else {
        if (newValue === '') {
          delete marker.overrides[updateTarget];
        } else {
          marker.overrides[updateTarget] = newValue;
        }
      }
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

  function buildGfyRequests(markers, url) {
    return markers.map((marker: marker, idx: number) => {
      const start = marker.start;
      const end = marker.end;
      const speed = (1 / marker.speed).toPrecision(4);
      const crop = marker.crop;
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
        noMd5: 'true',
        cut: { start, duration },
        speed,
        crop,
      };
      if (crop && crop !== '0:0:iw:ih') {
        const crops = crop.split(':');
        req.crop = {
          x: crops[0],
          y: crops[1],
          w: crops[2] === 'iw' ? settings.cropResWidth : crops[2],
          h: crops[3] === 'ih' ? settings.cropResHeight : crops[3],
        };
      }

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
        .then(response => {
          return response.json();
        })
        .then(json => {
          const accessToken = json['access-token'][0];
          console.log(accessToken);
          sendGfyRequests(markers, playerInfo.url, accessToken);
        })
        .catch(error => console.error(error));
    });
  }

  function sendGfyRequests(markers: markers[], url: string, accessToken?: string) {
    if (markers.length > 0) {
      const markdown = toggleUploadStatus();
      const reqs = buildGfyRequests(markers, url).map((req, idx) => {
        return buildGfyRequestPromise(req, idx, accessToken);
      });

      Promise.all(reqs).then(gfynames => {
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
    reqData.speed = reqData.speed === '1.000' ? '' : `?speed=${reqData.speed}`;
    return new Promise((resolve, reject) => {
      postData('https://api.gfycat.com/v1/gfycats', reqData, accessToken)
        .then(resp => {
          links.push(
            `(${settings.titleSuffix}-${idx})[https://gfycat.com/${resp.gfyname}${
              reqData.speed
            }]`
          );
          resolve(resp.gfyname);
        })
        .catch((error: Error) => reject(error));
    });
  }

  function checkGfysCompleted(gfynames: string[], markdown) {
    const gfyStatuses = gfynames.map(gfyname => {
      return checkGfyStatus(gfyname, markdown).then(isComplete => {
        return isComplete;
      });
    });
    Promise.all(gfyStatuses).then(gfyStatuses => {
      areGfysCompleted(gfyStatuses).then(() => insertMarkdown(markdown));
    });
  }

  function toggleUploadStatus() {
    const meta = document.getElementById('meta');
    const markdown = document.createElement('textarea');
    meta.insertAdjacentElement('beforebegin', markdown);
    setAttributes(markdown, {
      id: 'markdown',
      style: 'width:600px;height:100px;',
    });
    markdown.textContent = 'Upload initiated. Progress updates will begin shortly.\n';
    return markdown;
  }

  function updateUploadStatus(markdown, status, gfyname: name) {
    if (markdown) {
      markdown.textContent += `${gfyname} progress: ${status.progress}\n`;
      markdown.scrollTop = markdown.scrollHeight;
    }
  }

  function insertMarkdown(markdown) {
    if (markdown) {
      markdown.textContent = links.join('\n');
      window.clearInterval(checkGfysCompletedId);
    }
  }

  function areGfysCompleted(gfyStatuses) {
    return new Promise((resolve, reject) => {
      if (gfyStatuses.every((isCompleted: boolean) => isCompleted)) {
        resolve();
      } else {
        reject();
      }
    });
  }

  function checkGfyStatus(gfyname: string, markdown: any) {
    return new Promise((resolve, reject) => {
      fetch(`https://api.gfycat.com/v1/gfycats/fetch/status/${gfyname}`)
        .then(response => {
          return response.json();
        })
        .then(myJson => {
          updateUploadStatus(markdown, myJson, gfyname);
          myJson.task === 'complete' ? resolve(true) : reject(false);
        })
        .catch(error => console.error(error));
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
    Object.keys(attrs).forEach(key => el.setAttribute(key, attrs[key]));
  }

  function copyToClipboard(str: string) {
    const el = document.createElement('textarea');
    el.value = str;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
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
