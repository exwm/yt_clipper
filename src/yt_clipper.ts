// ==UserScript==
// @locale       english
// @name         yt_clipper
// @namespace    http://tampermonkey.net/
// @version      0.0.55
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
  let keys = {
    A: 65,
    S: 83,
    Q: 81,
    W: 87,
    E: 69,
    D: 68,
    Z: 90,
    X: 88,
    R: 82,
    C: 67,
    G: 71,
  };

  let fps = null;
  try {
    let playerApiScript = document.querySelectorAll('#player > script:nth-child(3)')[0]
      .textContent;
    fps = parseInt(playerApiScript.match(/fps=(\d+)/)[1]);
  } catch (e) {
    console.log(e);
  }

  const CLIENT_ID = 'XXXX';
  const REDIRECT_URI = 'http://127.0.0.1:4443/yt_clipper';
  const AUTH_ENDPOINT = 'https://api.gfycat.com/v1/oauth/token?';
  const BROWSER_BASED_AUTH_ENDPOINT = `https://gfycat.com/oauth/authorize?client_id=${CLIENT_ID}&scope=all&state=yt_clipper&response_type=token&redirect_uri=${REDIRECT_URI}`;

  let start = true;
  let markerHotkeysEnabled = false;
  let isMarkerEditorOpen = false;
  let wasDefaultsEditorOpen = false;
  let isOverlayOpen = false;
  let checkGfysCompletedId;
  let markers = [];
  let links = [];
  markers.toString = function() {
    let markersString = '';
    this.forEach((marker, idx) => {
      markersString += `${marker[0]},${marker[1]},${marker[2]},'${marker[3]}',`;
      if (idx === this.length - 1) {
        markersString = markersString.slice(0, -1);
      }
    });
    return markersString;
  };

  let startTime = 0.0;
  let toggleKeys = false;
  let undoMarkerOffset = 0;
  let prevMarker = null;

  document.addEventListener('keyup', hotkeys, false);

  function hotkeys(e) {
    console.log(e.which);
    if (toggleKeys) {
      switch (e.which) {
        case keys.A:
          if (!e.shiftKey) {
            addMarker();
          } else if (
            e.shiftKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.moveMarker
          ) {
            enableMarkerHotkeys.moveMarker(enableMarkerHotkeys.endMarker);
          }
          break;
        case keys.S:
          if (!e.shiftKey && !e.altKey) {
            saveToFile(createScript());
          } else if (e.shiftKey && !e.altKey) {
            copyToClipboard(createScript());
          } else if (e.altKey && !e.shiftKey) {
            saveMarkers();
          } else if (e.altKey && e.shiftKey) {
            saveAuthServerScript();
          }
          break;
        case keys.Q:
          if (!e.shiftKey) {
            togglePlayerSpeed();
          } else if (
            e.shiftKey &&
            markerHotkeysEnabled &&
            enableMarkerHotkeys.moveMarker
          ) {
            enableMarkerHotkeys.moveMarker(enableMarkerHotkeys.startMarker);
          }
          break;
        case keys.W:
          toggleDefaultSettings();
          break;
        case keys.E:
          if (e.shiftKey && !e.ctrlKey) {
            updateAllMarkers('slowdown', settings.defaultSlowdown);
          }
          break;
        case keys.D:
          if (e.shiftKey && !e.ctrlKey) {
            updateAllMarkers('crop', settings.defaultCrop);
          }
          break;
        case keys.G:
          if (!e.shiftKey) {
            loadMarkers();
          } else if (e.shiftKey) {
            toggleSpeedAutoDucking();
          }
          break;
        case keys.Z:
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
        case keys.X:
          drawCropOverlay();
          break;
        case keys.C:
          if (!e.shiftKey && !e.ctrlKey) {
            sendGfyRequests(markers, playerInfo.url);
          } else if (e.shiftKey && !e.ctrlKey) {
            requestGfycatAuth();
          } else if (!e.shiftKey && e.ctrlKey) break;
      }
    }
    if (e.ctrlKey && e.shiftKey && e.which === keys.A) {
      toggleKeys = !toggleKeys;
      console.log('keys enabled: ' + toggleKeys);
      initOnce();
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
  function initPlayerInfo() {
    playerInfo.url = player.getVideoUrl();
    playerInfo.playerData = player.getVideoData();
    playerInfo.duration = player.getDuration();
    playerInfo.video = document.getElementsByTagName('video')[0];
    playerInfo.isVerticalVideo = player.getVideoAspectRatio() <= 1;
    playerInfo.progress_bar = document.getElementsByClassName('ytp-progress-bar')[0];
  }

  let settings;
  let markers_svg;
  function initMarkersContainer() {
    settings = {
      defaultSlowdown: 1.0,
      defaultCrop: '0:0:iw:ih',
      shortTitle: `${playerInfo.playerData.video_id}`,
      videoRes: playerInfo.isVerticalVideo ? '1080x1920' : '1920x1080',
      videoWidth: playerInfo.isVerticalVideo ? 1080 : 1920,
      videoHeight: playerInfo.isVerticalVideo ? 1920 : 1080,
    };
    const markers_div = document.createElement('div');
    markers_div.setAttribute('id', 'markers_div');
    markers_div.innerHTML = `<svg width="100%" height="300%" style="top:-4;position:absolute;z-index:99"></svg>`;
    playerInfo.progress_bar.appendChild(markers_div);

    markers_svg = markers_div.firstChild;
  }

  function initCSS() {
    const clipperCSS = `\
@keyframes valid-input {
  0% {background-color: tomato;}
  100% {background-color: lightgreen;}
}
@keyframes invalid-input {
  0% {background-color: lightgreen;}
  100% {background-color: tomato;}
}
#speed-input:valid, #crop-input:valid, #res-input:valid {
  animation-name: valid-input;
  animation-duration:1s;
  animation-fill-mode: forwards;
}    
#speed-input:invalid, #crop-input:invalid, #res-input:invalid {
  animation-name: invalid-input;
  animation-duration:1s;
  animation-fill-mode: forwards;
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
        input.addEventListener('focus', e => (toggleKeys = false), {
          capture: true,
        });
        input.addEventListener('blur', e => (toggleKeys = true), {
          capture: true,
        });
      }
    });
  }

  function toggleSpeedAutoDucking() {
    if (playerInfo.video.ontimeupdate === autoducking) {
      playerInfo.video.removeEventListener('timeupdate', autoducking);
    } else {
      playerInfo.video.addEventListener('timeupdate', autoducking, false);
    }
  }

  function autoducking(e) {
    let currentIdx;
    const currentTime = e.target.getCurrentTime();
    const isTimeBetweenMarkerPair = markers.some((marker, idx) => {
      if (currentTime >= marker[0] && currentTime <= marker[1]) {
        currentIdx = idx;
        return true;
      }
    });
    if (isTimeBetweenMarkerPair && markers[currentIdx]) {
      const currentSlowdown = 1 / markers[currentIdx][2];
      if (player.getPlaybackRate() !== currentSlowdown) {
        player.setPlaybackRate(currentSlowdown);
      }
    } else {
      player.setPlaybackRate(1);
    }
  }

  function watchAvailableQualityChange() {
    const quality = player.getAvailableQualityLevels();
    const timer = setInterval(() => {
      if (player.getAvailableQualityLevels() !== quality) {
        clearInterval(timer);
        console.log(player.getAvailableQualityLevels());
      }
    }, 5000);
  }

  function saveMarkers() {
    const markersJson = JSON.stringify({
      [playerInfo.playerData.video_id]: markers,
    });
    const blob = new Blob([markersJson], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${settings.shortTitle}.json`);
  }

  function loadMarkers() {
    if (document.getElementById('markers-upload-div')) {
      const markersUploadDiv = document.getElementById('markers-upload-div');
      markersUploadDiv.parentElement.removeChild(markersUploadDiv);
    } else {
      const meta = document.getElementById('meta');
      const markersUploadDiv = document.createElement('div');
      markersUploadDiv.setAttribute('id', 'markers-upload-div');
      markersUploadDiv.innerHTML = `<fieldset>\
      <h2>Upload a markers .json file.</h2>\
        <input type="file" id="markers-json-input">\
        <input type="button" id="upload-markers-json" value="Load">\
      </fieldset>`;
      meta.insertAdjacentElement('beforebegin', markersUploadDiv);
      const fileUploadButton = document.getElementById('upload-markers-json');
      fileUploadButton.onclick = loadMarkersJson;
    }
  }

  function loadMarkersJson(e) {
    const input = document.getElementById('markers-json-input');
    console.log(input.files);
    const file = input.files[0];
    const fr = new FileReader();
    fr.onload = receivedJson;
    fr.readAsText(file);
    const markersUploadDiv = document.getElementById('markers-upload-div');
    markersUploadDiv.parentElement.removeChild(markersUploadDiv);
  }

  function receivedJson(e) {
    const lines = e.target.result;
    const markersJson = JSON.parse(lines);
    console.log(markersJson);
    if (markersJson[playerInfo.playerData.video_id]) {
      markers.length = 0;
      undoMarkerOffset = 0;
      markersJson[playerInfo.playerData.video_id].forEach(marker => {
        const [startTime, endTime, slowdown, crop] = marker;
        const startMarker = [startTime, slowdown, crop];
        const endMarker = [endTime, slowdown, crop];
        addMarker(startMarker);
        addMarker(endMarker);
      });
    }
  }

  const marker_attrs = {
    width: '1px',
    height: '12px',
    style: 'pointer-events:fill',
  };

  function addMarker(markerConfig = [null, null, null]) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    markers_svg.appendChild(marker);

    const roughCurrentTime = markerConfig[0] || player.getCurrentTime();
    let currentTime;
    fps
      ? (currentTime = Math.floor(roughCurrentTime * fps) / fps)
      : (currentTime = roughCurrentTime);

    const progress_pos = (currentTime / playerInfo.duration) * 100;
    marker_attrs.slowdown = markerConfig[1] || settings.defaultSlowdown;
    marker_attrs.crop = markerConfig[2] || settings.defaultCrop;

    setAttributes(marker, marker_attrs);
    marker.setAttribute('x', `${progress_pos}%`);
    const rectIdx = markers.length + 1 + undoMarkerOffset;
    marker.setAttribute('idx', rectIdx.toString());
    marker.setAttribute('time', currentTime);

    if (start === true) {
      marker.setAttribute('fill', 'lime');
      marker.setAttribute('type', 'start');
      marker.setAttribute('z-index', '1');
      startTime = currentTime;
    } else {
      marker.addEventListener('mouseover', toggleMarkerEditor, false);
      marker.setAttribute('fill', 'gold');
      marker.setAttribute('type', 'end');
      marker.setAttribute('z-index', '2');
      updateMarkers(currentTime, markerConfig);
    }

    start = !start;
    console.log(markers);
  }

  function updateMarkers(currentTime, markerConfig = [null, null, null]) {
    const updatedMarker = [
      startTime,
      currentTime,
      markerConfig[1] || settings.defaultSlowdown,
      markerConfig[2] || settings.defaultCrop,
    ];

    if (undoMarkerOffset === -1) {
      const lastMarkerIdx = markers.length - 1;
      markers[lastMarkerIdx] = updatedMarker;
      undoMarkerOffset = 0;
    } else if (undoMarkerOffset === 0) {
      markers.push(updatedMarker);
    }
  }

  function undoMarker() {
    const targetMarker = markers_svg.lastChild;
    if (targetMarker) {
      const deletedMarkerType = targetMarker.getAttribute('type');
      markers_svg.removeChild(targetMarker);
      if (deletedMarkerType === 'start' && undoMarkerOffset === -1) {
        markers.pop();
        undoMarkerOffset = 0;
      } else if (deletedMarkerType === 'end') {
        undoMarkerOffset = -1;
        startTime = markers[Math.floor(markers.length - 1)][0];
      }
      start = !start;
    }
  }

  function togglePlayerSpeed() {
    if (player.getPlaybackRate() === 0.25) {
      player.setPlaybackRate(1);
    } else {
      player.setPlaybackRate(0.25);
    }
  }

  function toggleDefaultSettings() {
    if (isMarkerEditorOpen) {
      deleteMarkerEditor();
      if (isOverlayOpen) {
        toggleOverlay();
      }
    }
    if (wasDefaultsEditorOpen && !prevMarker) {
      wasDefaultsEditorOpen = false;
    } else {
      if (prevMarker) {
        restoreMarkerColor(prevMarker);
        prevMarker = null;
      }
      toggleOverlay();
      createCropOverlay(settings.defaultCrop);
      const infoContents = document.getElementById('info-contents');
      const markerInputs = document.createElement('div');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const resInputValidation = `\\d+x\\d+`;
      const resList = playerInfo.isVerticalVideo
        ? `<option value="1080x1920"><option value="2160x3840">`
        : `<option value="1920x1080"><option value="3840x2160">`;
      markerInputs.setAttribute('id', 'slowdownInputDiv');
      markerInputs.innerHTML = `\
      <input id="speed-input" type="number" placeholder="speed" value="${
        settings.defaultSlowdown
      }" step="0.01" min="0.1" max="8" style="width:4em">
      <span style="color:grey;font-size:12pt;font-style:italic"> Default Slowdown - </span>
      <input id="crop-input" value="${
        settings.defaultCrop
      }" pattern="${cropInputValidation}" style="width:10em">
      <span style="color:grey;font-size:12pt"> Default Crop - </span>
      <input id="res-input" list="resolutions"pattern="${resInputValidation}" value="${
        settings.videoRes
      }" style="width:7em">
      <datalist id="resolutions" autocomplete="off">${resList}</datalist>
      <span style="color:grey;font-size:12pt"> Download Res - </span>
      <input id="short-title-input" value="${settings.shortTitle}" style="width:7em">
        <span style="color:grey;font-size:12pt"> Short Title </span>
      `;

      infoContents.insertBefore(markerInputs, infoContents.firstChild);

      addInputListeners([
        ['speed-input', 'defaultSlowdown'],
        ['crop-input', 'defaultCrop'],
        ['res-input', 'videoRes'],
        ['short-title-input', 'shortTitle'],
      ]);
      wasDefaultsEditorOpen = true;
      isMarkerEditorOpen = true;
    }
  }

  function addInputListeners(inputs) {
    inputs.forEach(input => {
      const id = input[0];
      const updateTarget = input[1];
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', e => (toggleKeys = false), false);
      inputElem.addEventListener('blur', e => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        e => updateDefaultValue(e, updateTarget),
        false
      );
    });
  }

  function updateDefaultValue(e, updateTarget) {
    if (e.target.reportValidity()) {
      settings[updateTarget] = e.target.value;
    }
    if (
      settings[updateTarget] === settings.defaultCrop ||
      settings[updateTarget] === settings.videoRes
    ) {
      createCropOverlay(settings.defaultCrop);
    }
    if (settings[updateTarget] === settings.videoRes) {
      settings.videoWidth = parseInt(settings.videoRes.split('x')[0]);
      settings.videoHeight = parseInt(settings.videoRes.split('x')[1]);
    }
    console.log(settings);
  }

  function createCropOverlay(crop) {
    if (isOverlayOpen) {
      deleteCropOverlay();
    }

    crop = crop.split(':');
    if (crop[2] === 'iw') {
      crop[2] = settings.videoWidth;
    }
    if (crop[3] === 'ih') {
      crop[3] = settings.videoHeight;
    }
    const cropDiv = document.createElement('div');
    cropDiv.setAttribute('id', 'crop-div');
    cropDiv.innerHTML = `<svg id="crop-svg" width="100%" height="100%" style="top:0;position:absolute;z-index:95"></svg>`;

    let annotations = document.getElementsByClassName('ytp-iv-video-content')[0];
    if (!annotations) {
      resizeCropOverlay(cropDiv);
      annotations = document.getElementsByClassName('html5-video-container')[0];
      annotations.insertAdjacentElement('afterend', cropDiv);
      window.addEventListener('resize', e => resizeCropOverlay(cropDiv));
    } else {
      annotations.insertBefore(cropDiv, annotations.firstElementChild);
    }
    const cropSvg = cropDiv.firstElementChild;
    const cropRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const cropRectAttrs = {
      x: `${(crop[0] / settings.videoWidth) * 100}%`,
      y: `${(crop[1] / settings.videoHeight) * 100}%`,
      width: `${(crop[2] / settings.videoWidth) * 100}%`,
      height: `${(crop[3] / settings.videoHeight) * 100}%`,
      fill: 'none',
      stroke: 'white',
      'stroke-width': '4px',
    };

    setAttributes(cropRect, cropRectAttrs);
    cropSvg.appendChild(cropRect);

    isOverlayOpen = true;
  }

  function resizeCropOverlay(cropDiv) {
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
    cropDiv.parentElement.removeChild(cropDiv);
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

  function drawCropOverlay() {
    if (document.getElementById('crop-input')) {
      const videoRect = player.getVideoContentRect();
      playerInfo.video.addEventListener('mousedown', e => beginDraw(e, videoRect), {
        once: true,
        capture: true,
      });
      togglePlayerControls();
    }
  }

  function togglePlayerControls() {
    const controls = document.getElementsByClassName('ytp-chrome-bottom')[0];
    if (controls.style.display !== 'none') {
      controls.style.display = 'none';
    } else {
      controls.style.display = 'block';
    }
  }

  function beginDraw(e, videoRect) {
    if (e.button == 0 && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const beginX = Math.round(
        ((e.pageX - videoRect.left) / videoRect.width) * settings.videoWidth
      );
      const beginY = Math.round(
        ((e.pageY - 56) / videoRect.height) * settings.videoHeight
      );
      let crop = `${beginX}:${beginY}:`;
      playerInfo.video.addEventListener(
        'mousedown',
        e => endDraw(e, crop, beginX, beginY, videoRect),
        { once: true, capture: true }
      );
    } else {
      togglePlayerControls();
    }
  }

  function endDraw(e, crop, beginX, beginY, videoRect) {
    if (e.button == 0 && e.shiftKey && !e.ctrlKey && !e.altKey) {
      const endX = Math.round(
        ((e.pageX - videoRect.left) / videoRect.width) * settings.videoWidth
      );
      const endY = Math.round(((e.pageY - 56) / videoRect.height) * settings.videoHeight);
      crop += `${endX - beginX}:${endY - beginY}`;
      const cropInput = document.getElementById('crop-input');
      cropInput.value = crop;
      cropInput.dispatchEvent(new Event('change'));
    }
    togglePlayerControls();
  }

  function updateAllMarkers(updateTarget, newValue) {
    let idx;
    if (updateTarget === 'slowdown') {
      idx = 2;
    } else if (updateTarget === 'crop') {
      idx = 3;
    }
    if (markers) {
      markers.forEach(marker => {
        marker[idx] = newValue;
      });
      markers_svg.childNodes.forEach(mrkr => {
        mrkr.setAttribute(updateTarget, newValue.toString());
      });
    }
  }

  function toggleMarkerEditor(e) {
    console.log(e.target);
    const currentMarker = e.target;
    if (currentMarker && e.shiftKey) {
      if (isMarkerEditorOpen) {
        deleteMarkerEditor();
        restoreMarkerColor(currentMarker);
        if (isOverlayOpen) {
          toggleOverlay();
        }
      }
      if (prevMarker === currentMarker) {
        prevMarker = null;
      } else {
        if (prevMarker) {
          restoreMarkerColor(prevMarker);
        }
        prevMarker = currentMarker;
        if (isOverlayOpen) {
          toggleOverlay();
        }
        toggleOverlay();
        colorSelectedMarkers(currentMarker);
        enableMarkerHotkeys(currentMarker);
        createMarkerEditor(currentMarker);
      }
    }

    function createMarkerEditor(currentMarker) {
      const startMarker = currentMarker.previousSibling;
      const infoContents = document.getElementById('info-contents');
      const currentIdx = currentMarker.getAttribute('idx');
      const currentMarkerTime = toHHMMSS(currentMarker.getAttribute('time'));
      const startMarkerTime = toHHMMSS(startMarker.getAttribute('time'));
      const currentSlowdown = currentMarker.getAttribute('slowdown');
      const currentCrop = currentMarker.getAttribute('crop');
      const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
      const markerInputs = document.createElement('div');

      createCropOverlay(currentCrop);

      markerInputs.setAttribute('id', 'slowdownInputDiv');
      markerInputs.innerHTML = `\
        <input id="speed-input" type="number" placeholder="speed"
        value="${currentSlowdown}" step="0.01" min="0.1" max="8" style="width:4em"></input>
        <input id="crop-input" value="${currentCrop}" pattern="${cropInputValidation}" 
        style="width:10em"></input>
        <div style="display:inline;color:grey;font-size:12pt;font-style:italic">
        <span>slowdown: ${currentSlowdown}x - crop: ${currentCrop} - number: ${currentIdx} - time: </span>
        <span id='start-time'> ${startMarkerTime}</span>
        <span>-</span>
        <span id='end-time'>${currentMarkerTime}</span></div>`;

      infoContents.insertBefore(markerInputs, infoContents.firstChild);
      addMarkerInputListeners(
        [['speed-input', 'slowdown'], ['crop-input', 'crop']],
        currentMarker,
        currentMarkerTime,
        currentIdx
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
      marker.setAttribute('time', `${currentTime}`);
      markers[idx][type === 'start' ? 0 : 1] = currentTime;
      markerTimeSpan.textContent = `${toHHMMSS(currentTime)}`;
    };
    enableMarkerHotkeys.deleteMarkerPair = () => {
      const idx = parseInt(enableMarkerHotkeys.endMarker.getAttribute('idx')) - 1;
      markers.splice(idx, 1);

      const me = new MouseEvent('mouseover', { shiftKey: true });
      enableMarkerHotkeys.endMarker.dispatchEvent(me);
      enableMarkerHotkeys.endMarker.parentElement.removeChild(
        enableMarkerHotkeys.endMarker
      );
      enableMarkerHotkeys.startMarker.parentElement.removeChild(
        enableMarkerHotkeys.startMarker
      );
      enableMarkerHotkeys.moveMarker = null;
      enableMarkerHotkeys.deleteMarkerPair = null;
      markerHotkeysEnabled = false;
    };
  }

  function colorSelectedMarkers(currentMarker) {
    currentMarker.setAttribute('fill', '#5880F2');
    currentMarker.previousSibling.setAttribute('fill', '#5880F2');
  }

  function addMarkerInputListeners(inputs, currentMarker, currentMarkerTime, currentIdx) {
    inputs.forEach(input => {
      const id = input[0];
      const updateTarget = input[1];
      const inputElem = document.getElementById(id);
      inputElem.addEventListener('focus', e => (toggleKeys = false), false);
      inputElem.addEventListener('blur', e => (toggleKeys = true), false);
      inputElem.addEventListener(
        'change',
        e => updateMarker(e, updateTarget, currentMarker, currentMarkerTime, currentIdx),
        false
      );
    });
  }

  function restoreMarkerColor(marker) {
    if (marker.getAttribute && marker.previousSibling) {
      marker.setAttribute('fill', 'gold');
      marker.previousSibling.setAttribute('fill', 'lime');
    }
  }

  function deleteMarkerEditor() {
    const slowdownInputDiv = document.getElementById('slowdownInputDiv');
    slowdownInputDiv.parentElement.removeChild(slowdownInputDiv);
    isMarkerEditorOpen = false;
    markerHotkeysEnabled = false;
  }

  function updateMarker(e, updateTarget, currentMarker, currentMarkerTime, currentIdx) {
    const currentType = currentMarker.getAttribute('type');
    const currentCrop = currentMarker.getAttribute('crop');
    const currentSlowdown = currentMarker.getAttribute('slowdown');
    const newValue = e.target.value;
    const markerInfo = document.getElementById('slowdownInputDiv').children[2];

    if (e.target.reportValidity()) {
      if (updateTarget === 'slowdown') {
        markerInfo.textContent = `slowdown: ${newValue}x - crop: ${currentCrop} - number: ${currentIdx} - time: ${currentMarkerTime}`;
        markers[currentIdx - 1][2] = parseFloat(newValue);
      } else if (updateTarget === 'crop') {
        markerInfo.textContent = `slowdown: ${currentSlowdown}x - crop: ${newValue} - number: ${currentIdx} - time: ${currentMarkerTime}`;
        markers[currentIdx - 1][3] = newValue;
        createCropOverlay(newValue);
      }

      currentMarker.setAttribute(updateTarget, newValue);
      if (currentType === 'start') {
        currentMarker.nextSibling.setAttribute(updateTarget, newValue);
      } else if (currentType === 'end') {
        currentMarker.previousSibling.setAttribute(updateTarget, newValue);
      }
    }
  }

  const pyClipper = `\
def loadMarkers(markersJson):
    markersDict = json.loads(markersJson)
    videoUrl = ''
    for videoID, markers in markersDict.items():
      videoUrl = 'https://www.youtube.com/watch?v=' + videoID
      print('videoUrl: ', videoUrl)
      break
    markers = list(itertools.chain.from_iterable(markers))
    return videoUrl, markers

def clipper(markers, title, videoUrl, ytdlFormat, cropMultipleX, cropMultipleY, overlayPath='', delay=0):

    def trim_video(startTime, endTime, slowdown, cropString,  outPath):
        filter_complex = ''
        startTime += delay
        endTime += delay
        duration = (endTime - startTime)*slowdown

        if args.url:
            ytdl_cmd = f'''youtube-dl -f "{ytdlFormat}" -g '{videoUrl}' '''
            ytdl_cmd = shlex.split(ytdl_cmd)
            proc = subprocess.Popen(
                ytdl_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            urls = proc.stdout.readlines()
            urls = [url.decode().rstrip() for url in urls]

            inputs = f'''ffmpeg -ss {startTime} -i "{urls[0]}" '''
            filter_complex += f'[0:v]setpts={slowdown}*(PTS-STARTPTS)[slowed];'
            if args.audio:
                inputs += f''' -ss {startTime} -i "{urls[1]}" '''
                filter_complex += f'''[1:a]atempo={1/slowdown};'''
            else:
                inputs += ' -an '
        else:
            inputs = f'ffmpeg -i "{videoUrl}" '
            filter_complex += f'''[0:v]trim={startTime}:{endTime},
                setpts={slowdown}*(PTS-STARTPTS)[slowed];'''
            if args.audio:
                filter_complex += f'''[0:a]atrim={startTime}:{endTime},
                    atempo={1/slowdown};'''
            else:
                inputs += ' -an '

        inputs += ' -hide_banner '

        crops = cropString.split(':')
        filter_complex += f'''[slowed]crop=x={cropMultipleX}*{crops[0]}:y={cropMultipleY}*{crops[1]}\
                              :w={cropMultipleX}*{crops[2]}:h={cropMultipleY}*{crops[3]}'''

        filter_complex += f'''[cropped];[cropped]lutyuv=y=gammaval({args.gamma})'''

        if args.rotate:
          filter_complex += f''',transpose={args.rotate}'''

        if overlayPath:
            filter_complex += f'[corrected];[corrected][1:v]overlay=x=W-w-10:y=10:alpha=0.5'
            inputs += f'-i "{overlayPath}"'

        ffmpegCommand = ' '.join((
            inputs,
            f'''-filter_complex "{filter_complex}" ''',
            f'''-c:v libvpx-vp9 -c:a libopus -pix_fmt yuv420p  ''',
            f'''-speed {args.speed} -slices 8 -threads 8 -row-mt 1 -tile-columns 6 -tile-rows 2 ''',
            f'''-qmin 0 -crf 30 -qmax 60 -qcomp 0.9 -b:v 0 -q:a 6 -f webm ''',
            f'''-metadata title='{title}' -t {duration} ''',
            f'''"{outPath}"''',
        ))

        print(ffmpegCommand.encode())

        ffmpeg_args = shlex.split(ffmpegCommand)

        subprocess.run(ffmpeg_args)

    for i in range(0, len(markers), 4):
        startTime = markers[i]
        endTime = markers[i+1]
        slowdown = markers[i+2]
        cropString = markers[i+3]
        os.mkdir(shortTitle)
        fileName = f'{shortTitle}-{i//4+1}'
        outPath = f'./{shortTitle}/{fileName}.webm'
        outPaths.append(outPath)
        fileNames.append(outPath[0:-5])
        trim_video(startTime, endTime, slowdown, cropString, outPath)


# cli arguments
parser = argparse.ArgumentParser(
    description='Generate trimmed webms from input video.')
parser.add_argument('infile', metavar='I',
                    help='input marker jsons')
parser.add_argument('--overlay', '-o', dest='overlay',
                    help='overlay image path')
parser.add_argument('--multiply-crop', '-m', type=float, dest='cropMultiple', default=1,
                    help=('Multiply all crop dimensions by an integer ' +
                          '(helpful if you change resolutions: eg 1920x1080 * 2 = 3840x2160(4k))')
                    )
parser.add_argument('--multiply-crop-x', '-x', type=float, dest='cropMultipleX', default=1,
                    help='Multiply all x crop dimensions by an integer')
parser.add_argument('--multiply-crop-y', '-y', type=float, dest='cropMultipleY', default=1,
                    help='Multiply all y crop dimensions by an integer')
parser.add_argument('--gfycat', '-g', action='store_true',
                    help='upload all output webms to gfycat and print reddit markdown with all links')
parser.add_argument('--audio', '-a', action='store_true',
                    help='enable audio in output webms')
parser.add_argument('--url', '-u', action='store_true',
                    help='use youtube-dl and ffmpeg to download only the portions of the video required')
parser.add_argument('--format', '-f', default='bestvideo+bestaudio',
                    help='specify format string passed to youtube-dl')
parser.add_argument('--delay', '-d', type=float, dest='delay', default=0,
                    help='Add a fixed delay to both the start and end time of each marker. Can be negative.')
parser.add_argument('--gamma', '-ga', type=float, dest='gamma', default=1,
                    help='Apply luminance gamma correction. Pass in a value between 0 and 1 to brighten shadows and reveal darker details.')
parser.add_argument('--rotate', '-r', dest='rotate', choices=['clock', 'cclock'],
                    help='Rotate video 90 degrees clockwise or counter-clockwise.')  
parser.add_argument('--encode-speed', '-s', type=int, dest='speed', default=1, choices=range(0,5),
                    help='Set the vp9 encoding speed.')

args = parser.parse_args()

if args.cropMultiple != 1:
    args.cropMultipleX = args.cropMultiple
    args.cropMultipleY = args.cropMultiple

shortTitle = Path(args.infile).stem

with open(args.infile, 'r', encoding='utf-8-sig' ) as file:
    markersJson = file.read()
    videoUrl, markers = loadMarkers(markersJson)

args.url = True
clipper(markers, title, videoUrl=videoUrl, cropMultipleX=args.cropMultipleX,
    cropMultipleY=args.cropMultipleY, ytdlFormat=args.format, overlayPath=args.overlay, delay=args.delay)

# auto gfycat uploading
if (args.gfycat):
    import urllib3
    import json
    from urllib.parse import urlencode
    http = urllib3.PoolManager()

    for outPath in outPaths:
        with open(outPath, 'rb') as fp:
            file_data = fp.read()
        encoded_args = urlencode({'title': f'{outPath}'})
        url = UPLOAD_KEY_REQUEST_ENDPOINT + encoded_args
        r_key = http.request('POST', url)
        print(r_key.status)
        gfyname = json.loads(r_key.data.decode('utf-8'))['gfyname']
        links.append(f'https://gfycat.com/{gfyname}')
        print(gfyname)
        fields = {'key': gfyname, 'file': (
            gfyname, file_data, 'multipart/formdata')}
        r_upload = http.request(
            'POST', FILE_UPLOAD_ENDPOINT, fields=fields)
        print(r_upload.status)
        print(r_upload.data)

    for fileName, link in zip(fileNames, links):
        markdown += f'({fileName})[{link}]\\n\\n'
        print('\\n==Reddit Markdown==')
        print(markdown)
  `;

  function createScript() {
    const pyHeader = `\
import sys
import subprocess
import shlex
import argparse
import re
import json
import itertools
import os
from pathlib import Path

UPLOAD_KEY_REQUEST_ENDPOINT = 'https://api.gfycat.com/v1/gfycats?'
FILE_UPLOAD_ENDPOINT = 'https://filedrop.gfycat.com'
AUTHENTICATION_ENDPOINT = 'https://api.gfycat.com/v1/oauth/token'

markers = [${markers.toString()}]
markers = ['0:0:iw:ih' if m == 'undefined' else m for m in markers]
title = re.sub("'","", r'''${
      document.getElementsByClassName('title')[0].lastElementChild.textContent
    }''')
shortTitle = re.sub("'","", r'''${settings.shortTitle}''')

outPaths = []
fileNames = []
links = []
markdown = ''

`;

    return pyHeader + pyClipper;
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
    return markers.map((marker, idx) => {
      const start = marker[0];
      const end = marker[1];
      const speed = (1 / marker[2]).toPrecision(4);
      const crop = marker[3];
      const startHHMMSS = toHHMMSS(start).split(':');
      const startHH = startHHMMSS[0];
      const startMM = startHHMMSS[1];
      const startSS = startHHMMSS[2];
      const duration = end - start;
      let req = {
        fetchUrl: url,
        title: `${settings.shortTitle}-${idx + 1}`,
        fetchHours: startHH,
        fetchMinutes: startMM,
        fetchSeconds: startSS,
        noMd5: 'true',
        cut: { start, duration },
        speed,
      };
      if (crop && crop !== '0:0:iw:ih') {
        const crops = crop.split(':');
        req.crop = {
          x: crops[0],
          y: crops[1],
          w: crops[2] === 'iw' ? settings.videoWidth : crops[2],
          h: crops[3] === 'ih' ? settings.videoHeight : crops[3],
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
    return new Promise((resolve, reject) => {
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

  function sendGfyRequests(markers, url, accessToken) {
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

  function buildGfyRequestPromise(req, idx, accessToken) {
    req.speed = req.speed === '1.000' ? '' : `?speed=${req.speed}`;
    return new Promise((resolve, reject) => {
      postData('https://api.gfycat.com/v1/gfycats', req, accessToken)
        .then(resp => {
          links.push(
            `(${settings.shortTitle}-${idx})[https://gfycat.com/${resp.gfyname}${
              req.speed
            }]`
          );
          resolve(resp.gfyname);
        })
        .catch(error => reject(error));
    });
  }

  function checkGfysCompleted(gfynames, markdown) {
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

  function updateUploadStatus(markdown, status, gfyname) {
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
      if (gfyStatuses.every(isCompleted => isCompleted)) {
        resolve();
      } else {
        reject();
      }
    });
  }

  function checkGfyStatus(gfyname, markdown) {
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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function postData(url, data, accessToken) {
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
    return fetch(url, req).then(response => response.json()); // parses response to JSON
  }

  function toHHMMSS(seconds) {
    return new Date(seconds * 1000).toISOString().substr(11, 8);
  }

  function setAttributes(el, attrs) {
    Object.keys(attrs).forEach(key => el.setAttribute(key, attrs[key]));
  }

  function saveToFile(str) {
    const blob = new Blob([str], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, `${settings.shortTitle}-clip.py`);
  }

  function copyToClipboard(str) {
    const el = document.createElement('textarea');
    el.value = str;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }

  function once(fn, context) {
    var result;
    return function() {
      if (fn) {
        result = fn.apply(context || this, arguments);
        fn = null;
      }
      return result;
    };
  }
})();
