import { stripIndent } from 'common-tags';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { appState } from './appState';
import { assertDefined, flashMessage } from './util/util';
import { getClipperInputData, loadClipperInputJSON, deleteMarkersDataCommands } from './save-load';
import { injectProgressBar } from './util/util';

let autoSaveIntervalId;
const localStorageKeyPrefix = 'yt_clipper';

export function initAutoSave() {
  if (autoSaveIntervalId == null) {
    flashMessage('Initializing auto saving of markers data to local storage...', 'olive');
    autoSaveIntervalId = setInterval(() => {
      saveClipperInputDataToLocalStorage();
    }, 5000);
  }
}

export function saveClipperInputDataToLocalStorage() {
  const date = Date.now(); /*  */
  const key = `${localStorageKeyPrefix}_${appState.settings.videoTag}`;
  const data = getClipperInputData(date);
  try {
    localStorage.setItem(key, JSON.stringify(data, null, 2));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      const markersDataFiles = getMarkersDataEntriesFromLocalStorage();
      flashMessage(
        `Failed to save markers data.
          Browser local storage quota exceeded with ${markersDataFiles?.length} markers data files.
          Try clearing auto-saved markers data after backing it up (see marker data commands menu (shortcut: G).`,
        'red',
        4500
      );
    } else {
      flashMessage(`Failed to save markers data. Error: ${String(e)}`, 'red');
    }
  }
}

export function loadClipperInputDataFromLocalStorage() {
  if (appState.markerPairs.length === 0) {
    const key = `${localStorageKeyPrefix}_${appState.settings.videoTag}`;
    const clipperInputJSON = localStorage.getItem(key);
    if (clipperInputJSON != null) {
      const clipperInputData = JSON.parse(clipperInputJSON);
      const date = new Date(clipperInputData.date);
      const confirmLoad = confirm(stripIndent`
        The last auto-saved markers data for appState.video ${appState.settings.videoTag} will be restored.
        This data was saved on ${date}.
        It contains ${clipperInputData.markerPairs.length} marker pair(s).\n
        Proceed to restore markers data?
      `);
      if (confirmLoad) {
        loadClipperInputJSON(clipperInputJSON);
        deleteMarkersDataCommands();
      }
    } else {
      flashMessage(
        `No markers data found in local storage for appState.video ${appState.settings.videoTag}.`,
        'red'
      );
    }
  } else {
    flashMessage('Please delete all marker pairs before restoring markers data.', 'red');
  }
}

export function getMarkersDataEntriesFromLocalStorage(): string[] {
  const entries = Object.entries(localStorage)
    .map((x) => x[0])
    .filter((x) => x.startsWith(localStorageKeyPrefix));
  return entries;
}

export function clearYTClipperLocalStorage() {
  const entries = getMarkersDataEntriesFromLocalStorage();

  const nEntries = entries.length;

  const clearAll = confirm(stripIndent`
      The following markers data files will be cleared from local storage:
      ${entries.map((entry) => entry.replace(localStorageKeyPrefix + '_', '')).join(', ')}\n
      Proceed to clear all (${nEntries}) markers data files from local storage?
    `);

  if (clearAll) {
    entries.map((x) => {
      localStorage.removeItem(x);
    });
    flashMessage(`Cleared ${nEntries} markers data files.`, 'olive');
  }
}

export function downloadAutoSavedMarkersData() {
  const entries = Object.entries(localStorage)
    .map((x) => x[0])
    .filter((x) => x.startsWith(localStorageKeyPrefix));

  const nEntries = entries.length;
  if (nEntries === 0) {
    flashMessage('No markers data in local storage to zip.', 'olive');
    return;
  }

  flashMessage(`Zipping ${nEntries} markers data files.`, 'olive');

  const now = new Date();
  const zip = new JSZip();
  const markersZipFolderName = 'yt_clipper_markers_data_' + now.toISOString();
  const markersZip = zip.folder(markersZipFolderName);

  assertDefined(markersZip, 'Failed to create zip folder');
  entries.forEach((entry) => {
    const data = localStorage.getItem(entry);
    assertDefined(data, `Expected localStorage entry for ${entry}`);
    markersZip.file(entry.replace(localStorageKeyPrefix, '') + '.json', data, { binary: false });
  });

  const progressDiv = injectProgressBar('green', 'Markers Data');
  const progressSpan = progressDiv.firstElementChild;
  assertDefined(progressSpan, 'Expected progress bar to have a child element');
  void zip
    .generateAsync({ type: 'blob' }, (metadata) => {
      const percent = metadata.percent.toFixed(2) + '%';
      progressSpan.textContent = `Markers Data Zipping Progress: ${percent}`;
    })
    .then((blob) => {
      saveAs(blob, markersZipFolderName + '.zip');
      progressDiv.dispatchEvent(new Event('done'));
    });
}
