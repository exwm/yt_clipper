import { saveAs } from 'file-saver';
import { MarkerConfig, MarkerPair, SpeedPoint } from './@types/yt_clipper';
import { __version__, appState } from './appState';
import {
  getMarkersDataEntriesFromLocalStorage,
  loadClipperInputDataFromLocalStorage,
  downloadAutoSavedMarkersData,
  clearYTClipperLocalStorage,
} from './auto-save';
import { isStaticCrop } from './crop-utils';
import {
  safeSetInnerHtml,
  deleteElement,
  flashMessage,
  speedRounder,
  timeRounder,
  assertDefined,
} from './util/util';
import { isTheatreMode, updateSettingsEditorHook } from './yt_clipper';
import { addMarker } from './markers';

export function saveMarkersAndSettings() {
  const settingsJSON = getClipperInputJSON();

  const blob = new Blob([settingsJSON], { type: 'application/json;charset=utf-8' });
  saveAs(blob, `${appState.settings.titleSuffix || `[${appState.settings.videoID}]`}.json`);
}

export function getClipperInputData(date?) {
  appState.markerPairs.forEach((markerPair: MarkerPair, index: number) => {
    const speed = markerPair.speed;
    if (typeof speed === 'string') {
      markerPair.speed = Number(speed);
      console.log(`Converted marker pair ${index}'s speed from String to Number`);
    }
  });

  const markerPairsNumbered = appState.markerPairs.map((markerPair, idx) => {
    const markerPairNumbered = {
      number: idx + 1,
      ...markerPair,
      speedMapLoop: undefined,
      speedMap: isVariableSpeed(markerPair.speedMap) ? markerPair.speedMap : undefined,
      speedChartLoop: undefined,
      cropMap: !isStaticCrop(markerPair.cropMap) ? markerPair.cropMap : undefined,
      cropChartLoop: undefined,
      undoredo: undefined,
      startNumbering: undefined,
      endNumbering: undefined,
      moveHistory: undefined,
      outputDuration: undefined,
    };
    return markerPairNumbered;
  });

  const clipperInputData = {
    ...appState.settings,
    version: __version__,
    markerPairs: markerPairsNumbered,
    date: date ?? undefined,
  };
  return clipperInputData;
}

export function getClipperInputJSON() {
  const settingsJSON = JSON.stringify(getClipperInputData(), undefined, 2);
  return settingsJSON;
}

export function isVariableSpeed(speedMap: SpeedPoint[]) {
  if (speedMap.length < 2) return false;

  const isVarSpeed = speedMap.some((speedPoint, i) => {
    if (i === speedMap.length - 1) return false;

    return speedPoint.y !== speedMap[i + 1].y;
  });

  return isVarSpeed;
}

export function deleteMarkersDataCommands() {
  const markersDataCommandsDiv = document.getElementById('markers-data-commands-div');
  if (markersDataCommandsDiv) {
    deleteElement(markersDataCommandsDiv);
    return true;
  }
  return false;
}

export function toggleMarkersDataCommands() {
  if (!deleteMarkersDataCommands()) {
    const markersDataCommandsDiv = document.createElement('div');
    markersDataCommandsDiv.setAttribute('id', 'markers-data-commands-div');

    const markersUploadDiv = document.createElement('div');
    markersUploadDiv.setAttribute('class', 'long-msg-div');
    safeSetInnerHtml(
      markersUploadDiv,
      `
        <fieldset>
          <legend>Load markers data from an uploaded markers .json file.</legend>
          <input type="file" id="markers-json-input" />
          <input type="button" id="upload-markers-json" value="Load" />
        </fieldset>
        <fieldset hidden>
          <legend>Upload a markers array file.</legend>
          <input type="file" id="markers-array-input" />
          <input type="button" id="upload-markers-array" value="Load" />
        </fieldset>
      `
    );

    const restoreMarkersDataDiv = document.createElement('div');
    restoreMarkersDataDiv.setAttribute('class', 'long-msg-div');

    const markersDataFiles = getMarkersDataEntriesFromLocalStorage();

    safeSetInnerHtml(
      restoreMarkersDataDiv,
      `
        <fieldset>
          <legend>Restore auto-saved markers data from browser local storage.</legend>
          <input type="button" id="restore-markers-data" value="Restore" />
        </fieldset>
        <fieldset>
          <legend>
            Zip and download ${markersDataFiles?.length} auto-saved markers data files from browser
            local storage.
          </legend>
          <input type="button" id="download-markers-data" value="Download" />
        </fieldset>
      `
    );

    const clearMarkersDataDiv = document.createElement('div');
    clearMarkersDataDiv.setAttribute('class', 'long-msg-div');
    safeSetInnerHtml(
      clearMarkersDataDiv,
      `
        <fieldset>
          <legend>Clear all markers data files from browser local storage.</legend>
          <input type="button" id="clear-markers-data" value="Clear" style="color:red" />
        </fieldset>
      `
    );

    markersDataCommandsDiv.appendChild(markersUploadDiv);
    markersDataCommandsDiv.appendChild(restoreMarkersDataDiv);
    markersDataCommandsDiv.appendChild(clearMarkersDataDiv);

    injectYtcWidget(markersDataCommandsDiv);

    const fileUploadButton = document.getElementById('upload-markers-json');
    const markersArrayUploadButton = document.getElementById('upload-markers-array');
    const restoreMarkersDataButton = document.getElementById('restore-markers-data');
    const downloadMarkersDataButton = document.getElementById('download-markers-data');
    const clearMarkersDataButton = document.getElementById('clear-markers-data');
    assertDefined(fileUploadButton, 'Expected upload-markers-json button');
    assertDefined(markersArrayUploadButton, 'Expected upload-markers-array button');
    assertDefined(restoreMarkersDataButton, 'Expected restore-markers-data button');
    assertDefined(downloadMarkersDataButton, 'Expected download-markers-data button');
    assertDefined(clearMarkersDataButton, 'Expected clear-markers-data button');
    fileUploadButton.onclick = loadMarkersJson;
    markersArrayUploadButton.onclick = loadMarkersArray;
    restoreMarkersDataButton.onclick = loadClipperInputDataFromLocalStorage;
    downloadMarkersDataButton.onclick = downloadAutoSavedMarkersData;
    clearMarkersDataButton.onclick = clearYTClipperLocalStorage;
  }
}

export function injectYtcWidget(widget: HTMLDivElement) {
  updateSettingsEditorHook();

  if (isTheatreMode()) {
    appState.settingsEditorHook.insertAdjacentElement('afterend', widget);
  } else {
    widget.style.position = 'relative';
    appState.settingsEditorHook.insertAdjacentElement('beforebegin', widget);
  }
}

function loadMarkersJson() {
  const input = document.getElementById('markers-json-input') as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  console.log(input.files);
  const file = input.files[0];
  const fr = new FileReader();
  fr.onload = (e) => {
    assertDefined(e.target, 'Expected FileReader event target');
    loadClipperInputJSON(e.target.result);
  };
  fr.readAsText(file);
  deleteMarkersDataCommands();
}

function loadMarkersArray() {
  const input = document.getElementById('markers-array-input') as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  console.log(input.files);
  const file = input.files[0];
  const fr = new FileReader();
  fr.onload = receivedMarkersArray;
  fr.readAsText(file);
  deleteMarkersDataCommands();
}

export function loadClipperInputJSON(json) {
  const markersData = JSON.parse(json);
  console.log(markersData);

  flashMessage('Loading markers data...', 'green');

  if (markersData) {
    // move markers field to marker Pairs for backwards compat)
    if (markersData.markers && !markersData.markerPairs) {
      markersData.markerPairs = markersData.markers;
      delete markersData.markers;
    }

    if (!markersData.markerPairs) {
      flashMessage(
        'Could not find markers or appState.markerPairs field. Could not load marker data.',
        'red'
      );
    }
    // copy markersJson to appState.settings object less markerPairs field
    const { markerPairs: _markerPairs, ...loadedSettings } = markersData; // eslint-disable-line @typescript-eslint/no-unused-vars

    delete loadedSettings.videoID;
    delete loadedSettings.videoTitle;
    delete loadedSettings.isVerticalVideo;
    delete loadedSettings.version;

    appState.settings = { ...appState.settings, ...loadedSettings };

    addMarkerPairs(markersData.markerPairs);
  }
}

export function addMarkerPairs(markerPairs: MarkerPair[]) {
  markerPairs.forEach((markerPair: MarkerPair) => {
    const startMarkerConfig: MarkerConfig = {
      time: markerPair.start,
      type: 'start',
    };
    const endMarkerConfig: MarkerConfig = {
      time: markerPair.end,
      type: 'end',
      speed: markerPair.speed,
      speedMap: markerPair.speedMap,
      speedChartLoop: markerPair.speedChartLoop,
      crop: markerPair.crop,
      cropMap: markerPair.cropMap,
      cropChartLoop: markerPair.cropChartLoop,
      enableZoomPan: markerPair.enableZoomPan,
      overrides: markerPair.overrides,
      undoredo: markerPair.undoredo,
    };
    addMarker(startMarkerConfig);
    addMarker(endMarkerConfig);
  });
}

function receivedMarkersArray(e: ProgressEvent) {
  const lines = (e.target as FileReader).result;
  const markersJson = JSON.parse(lines as string);
  console.log(markersJson);

  flashMessage('Loading markers...', 'green');

  markersJson.markerPairs = markersJson.markerPairs.flat(1);
  for (let i = 0; i < markersJson.markerPairs.length; i = i + 4) {
    console.log(appState.markerPairs);
    const start = timeRounder(markersJson.markerPairs[i]);
    const end = timeRounder(markersJson.markerPairs[i + 1]);
    const speed = speedRounder(1 / markersJson.markerPairs[i + 2]);
    const cropString = markersJson.markerPairs[i + 3];
    const startMarkerConfig: MarkerConfig = {
      time: start,
      type: 'start',
    };
    const endMarkerConfig: MarkerConfig = {
      time: end,
      type: 'end',
      crop: cropString,
      speed: speed,
    };
    addMarker(startMarkerConfig);
    addMarker(endMarkerConfig);
  }
}
