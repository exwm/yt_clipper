import { saveAs } from 'file-saver';
import { MarkerConfig, MarkerPair, SpeedPoint } from '../@types/yt_clipper';
import { __version__, appState } from '../appState';
import {
  getMarkersDataEntriesFromLocalStorage,
  loadClipperInputDataFromLocalStorage,
  downloadAutoSavedMarkersData,
  clearYTClipperLocalStorage,
} from '../auto-save';
import { html, render } from 'lit-html';
import { isStaticCrop } from '../crop-utils';
import { deleteElement, flashMessage, assertDefined } from '../util/util';
import { isTheatreMode, updateSettingsEditorHook } from '../yt_clipper';
import { addMarker } from '../markers';
import { showLoadMarkersReviewModal } from './load-markers-review';
import {
  ClipperInput,
  ClipperInputValidationError,
  ParseResult,
  parseClipperInputJSON,
  toApplicableSettings,
} from './parse-clipper-input';

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

const markersUploadTemplate = html`
  <fieldset>
    <legend>Load markers data from an uploaded markers .json file.</legend>
    <input type="file" id="markers-json-input" />
    <input type="button" id="upload-markers-json" value="Load" />
  </fieldset>
`;

function RestoreMarkersTemplate(markersDataFilesCount: number | undefined) {
  return html`
    <fieldset>
      <legend>Restore auto-saved markers data from browser local storage.</legend>
      <input type="button" id="restore-markers-data" value="Restore" />
    </fieldset>
    <fieldset>
      <legend>
        Zip and download ${markersDataFilesCount} auto-saved markers data files from browser local
        storage.
      </legend>
      <input type="button" id="download-markers-data" value="Download" />
    </fieldset>
  `;
}

const clearMarkersTemplate = html`
  <fieldset>
    <legend>Clear all markers data files from browser local storage.</legend>
    <input type="button" id="clear-markers-data" value="Clear" style="color:red" />
  </fieldset>
`;

export function toggleMarkersDataCommands() {
  if (!deleteMarkersDataCommands()) {
    const markersDataCommandsDiv = document.createElement('div');
    markersDataCommandsDiv.setAttribute('id', 'markers-data-commands-div');

    const markersUploadDiv = document.createElement('div');
    markersUploadDiv.setAttribute('class', 'long-msg-div');
    render(markersUploadTemplate, markersUploadDiv);

    const restoreMarkersDataDiv = document.createElement('div');
    restoreMarkersDataDiv.setAttribute('class', 'long-msg-div');

    const markersDataFiles = getMarkersDataEntriesFromLocalStorage();

    render(RestoreMarkersTemplate(markersDataFiles?.length), restoreMarkersDataDiv);

    const clearMarkersDataDiv = document.createElement('div');
    clearMarkersDataDiv.setAttribute('class', 'long-msg-div');
    render(clearMarkersTemplate, clearMarkersDataDiv);

    markersDataCommandsDiv.appendChild(markersUploadDiv);
    markersDataCommandsDiv.appendChild(restoreMarkersDataDiv);
    markersDataCommandsDiv.appendChild(clearMarkersDataDiv);

    injectYtcWidget(markersDataCommandsDiv);

    const fileUploadButton = document.getElementById('upload-markers-json');
    const restoreMarkersDataButton = document.getElementById('restore-markers-data');
    const downloadMarkersDataButton = document.getElementById('download-markers-data');
    const clearMarkersDataButton = document.getElementById('clear-markers-data');
    assertDefined(fileUploadButton, 'Expected upload-markers-json button');
    assertDefined(restoreMarkersDataButton, 'Expected restore-markers-data button');
    assertDefined(downloadMarkersDataButton, 'Expected download-markers-data button');
    assertDefined(clearMarkersDataButton, 'Expected clear-markers-data button');
    fileUploadButton.onclick = loadMarkersJson;
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
  const file = input.files[0];
  const fr = new FileReader();
  fr.onload = (e) => {
    assertDefined(e.target, 'Expected FileReader event target');
    const text = typeof e.target.result === 'string' ? e.target.result : '';
    showMarkersJsonReviewModal(file.name, text);
  };
  fr.readAsText(file);
  deleteMarkersDataCommands();
}

// Standalone "load from file" entry point (the markers data commands panel's
// Load button reads its own file input; this opens a picker directly) — used by
// the global settings editor's Load action.
export function promptLoadMarkersJsonFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const fr = new FileReader();
    fr.onload = (e) => {
      assertDefined(e.target, 'Expected FileReader event target');
      const text = typeof e.target.result === 'string' ? e.target.result : '';
      showMarkersJsonReviewModal(file.name, text);
    };
    fr.readAsText(file);
  });
  input.click();
}

function showMarkersJsonReviewModal(fileName: string, text: string) {
  let result: ParseResult;
  try {
    result = parseClipperInputJSON(text);
  } catch (err) {
    if (err instanceof ClipperInputValidationError) {
      console.error('Failed to parse clipper input', err);
      flashMessage(`${fileName}: ${err.message}`, 'red');
      return;
    }
    throw err;
  }
  const pairCount = result.input.markerPairs.length;

  showLoadMarkersReviewModal({
    modalTitle: 'Load markers from file?',
    warning: `⚠ Review before loading. Loading will overwrite current settings and add ${pairCount} marker pair(s).`,
    sourceLabel: `file: ${fileName}`,
    payload: result.input,
    issues: result.issues,
    onLoad: () => {
      applyClipperInput(result.input);
      flashMessage(`Loaded ${pairCount} marker pair(s) from ${fileName}.`, 'green');
    },
  });
}

/** Apply an already-parsed ClipperInput to appState. Safe because:
 *   - parser stripped __proto__/constructor/prototype keys at load boundary.
 *   - parser allowlisted to known Settings keys only.
 *   - toApplicableSettings drops source-environment keys (videoID/title/...).
 *   - Object spread creates own data properties, never triggers setters. */
export function applyClipperInput(input: ClipperInput): void {
  appState.settings = { ...appState.settings, ...toApplicableSettings(input) };
  addMarkerPairs(input.markerPairs as MarkerPair[]);
}

export function loadClipperInputJSON(json: string) {
  let result: ParseResult;
  try {
    result = parseClipperInputJSON(json);
  } catch (err) {
    if (err instanceof ClipperInputValidationError) {
      console.error('Failed to parse clipper input', err);
      flashMessage(err.message, 'red');
      return;
    }
    throw err;
  }

  flashMessage('Loading markers data...', 'green');
  applyClipperInput(result.input);
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
