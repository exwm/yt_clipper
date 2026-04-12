import { appState } from './appState';
import { hideChart } from './charts';
import { createCropOverlay, hideCropOverlay, showCropOverlay } from './crop-overlay';
import { getCropComponents, getDefaultCropRes } from './crop-utils';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { toggleOffMarkerPairEditor } from './marker-settings-editor';
import { injectYtcWidget } from './save-load';
import {
  addCropInputHotkeys,
  addSettingsInputListeners,
  deleteSettingsEditor,
  highlightModifiedSettings,
  isExtraSettingsEditorEnabled,
  setCropInput,
  setCropAspectRatioSpan,
} from './settings-editor';
import { Tooltips } from './ui/tooltips';
import { assertDefined, safeSetInnerHtml, toHHMMSSTrimmed } from './util/util';

export function toggleGlobalSettingsEditor() {
  if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen) {
    toggleOffMarkerPairEditor();
  }
  if (appState.wasGlobalSettingsEditorOpen) {
    toggleOffGlobalSettingsEditor();
  } else {
    createGlobalSettingsEditor();
  }
}
export function toggleOffGlobalSettingsEditor() {
  deleteSettingsEditor();
  hideCropOverlay();
  hideChart();
}
export function createGlobalSettingsEditor() {
  createCropOverlay(appState.settings.newMarkerCrop);
  const globalSettingsEditorDiv = document.createElement('div');
  const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_x, _y, w, h] = getCropComponents(appState.settings.newMarkerCrop);
  const cropAspectRatio = (w / h).toFixed(13);
  const numOrRange = `(\\d{1,2})|(\\d{1,2}-\\d{1,2})`;
  const csvRange = `(${numOrRange})*(,(${numOrRange}))*`;
  const csvRangeReq = `(${numOrRange}){1}(,(${numOrRange}))*`;
  const mergeListInputValidation = `^(${csvRange})(;${csvRangeReq})*$`;
  const gte100 = `([1-9]\\d{3}|[1-9]\\d{2})`;
  const cropResInputValidation = `${gte100}x${gte100}`;
  const { cropRes, cropResWidth, cropResHeight } = getDefaultCropRes();
  const cropResX2 = `${cropResWidth * 2}x${cropResHeight * 2}`;
  const resList = `<option value="${cropRes}"><option value="${cropResX2}">`;
  // const minterpMode = appState.settings.minterpMode;
  // const minterpFPS = appState.settings.minterpFPS;
  const minterpFpsMultiplier = appState.settings.minterpFpsMultiplier;
  const denoise = appState.settings.denoise;
  const denoiseDesc = denoise ? denoise.desc : null;
  const vidstab = appState.settings.videoStabilization;
  const vidstabDesc = vidstab ? vidstab.desc : null;
  const vidstabDynamicZoomEnabled = appState.settings.videoStabilizationDynamicZoom;
  const markerPairMergelistDurations = getMarkerPairMergeListDurations();
  const globalEncodeSettingsEditorDisplay = isExtraSettingsEditorEnabled ? 'block' : 'none';
  globalSettingsEditorDiv.setAttribute('id', 'settings-editor-div');
  safeSetInnerHtml(
    globalSettingsEditorDiv,
    `
    <fieldset id="new-marker-defaults-inputs"
      class="settings-editor-panel global-settings-editor global-settings-editor-highlighted-div">
      <legend class="global-settings-editor-highlighted-label">New Marker Settings</legend>
      <div class="settings-editor-input-div" title="${Tooltips.speedTooltip}">
        <span>Speed</span>
        <input id="speed-input" type="number" placeholder="speed" value="${appState.settings.newMarkerSpeed}" step="0.05" min="0.05" max="2" style="width:7ch">
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.cropTooltip}">
        <span>Crop</span>
        <input id="crop-input" value="${appState.settings.newMarkerCrop}" pattern="${cropInputValidation}" style="width:21ch" required>
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
        <input id="title-suffix-input" value="${appState.settings.titleSuffix}" style="background-color:lightgreen;min-width:20em;text-align:right" required>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.cropResolutionTooltip}">
        <span>Crop Resolution</span>
        <input id="crop-res-input" list="resolutions" pattern="${cropResInputValidation}" value="${appState.settings.cropRes}" style="width:14ch" required>
        <datalist id="resolutions" autocomplete="off">${resList}</datalist>
      </div>
      <div id="global-settings-rotate" class="settings-editor-input-div" title="${Tooltips.rotateTooltip}">
        <span style="display:inline">Rotate: </span>
        <input id="rotate-0" type="radio" name="rotate" value="0" ${appState.settings.rotate == null || appState.settings.rotate === '0' ? 'checked' : ''}></input>
        <label for="rotate-0">0&#x00B0; </label>
        <input id="rotate-90-clock" type="radio" value="clock" name="rotate" ${appState.settings.rotate === 'clock' ? 'checked' : ''}></input>
        <label for="rotate-90-clock">90&#x00B0; &#x27F3;</label>
        <input id="rotate-90-counterclock" type="radio" value="cclock" name="rotate" ${appState.settings.rotate === 'cclock' ? 'checked' : ''}></input>
        <label for="rotate-90-counterclock">90&#x00B0; &#x27F2;</label>
      </div>
      <div id="merge-list-div" class="settings-editor-input-div" title="${Tooltips.mergeListTooltip}">
          <span style="display:inline">Merge List: </span>
          <input id="merge-list-input" pattern="${mergeListInputValidation}" value="${
            appState.settings.markerPairMergeList ?? ''
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
          <option value="Default" ${appState.settings.audio == null ? 'selected' : ''}>(Disabled)</option>
          <option ${appState.settings.audio === false ? 'selected' : ''}>Disabled</option>
          <option ${appState.settings.audio ? 'selected' : ''}>Enabled</option>
        </select>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.encodeSpeedTooltip}">
        <span>Encode Speed (0-5)</span>
        <input id="encode-speed-input" type="number" min="0" max="5" step="1" value="${appState.settings.encodeSpeed ?? ''}" placeholder="Auto" style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.CRFTooltip}">
        <span>CRF (0-63)</span>
        <input id="crf-input" type="number" min="0" max="63" step="1" value="${appState.settings.crf ?? ''}" placeholder="Auto" style="min-width:4em"></input>
      </div>
      <div class="settings-editor-input-div" title="${Tooltips.targetBitrateTooltip}">
        <span>Target Bitrate (kb/s)</span>
        <input id="target-max-bitrate-input" type="number" min="0" max="1e5"step="100" value="${appState.settings.targetMaxBitrate ?? ''}" placeholder="Auto" style="min-width:4em"></input>
      </div>

      <div class="settings-editor-input-div" title="${Tooltips.twoPassTooltip}">
        <span>Two-Pass</span>
        <select id="two-pass-input">
          <option value="Default" ${appState.settings.twoPass == null ? 'selected' : ''}>(Disabled)</option>
          <option ${appState.settings.twoPass === false ? 'selected' : ''}>Disabled</option>
          <option ${appState.settings.twoPass ? 'selected' : ''}>Enabled</option>
        </select>
      </div>

      <div class="settings-editor-input-div" title="${Tooltips.gammaTooltip}">
        <span>Gamma (0-4)</span>
        <input id="gamma-input" type="number" min="0.01" max="4.00" step="0.01" value="${appState.settings.gamma ?? ''}" placeholder="1" style="min-width:4em"></input>
      </div>

      <div class="settings-editor-input-div" title="${Tooltips.hdrTooltip}">
        <span>Enable HDR</span>
        <select id="enable-hdr-input">
          <option value="Default" ${appState.settings.enableHDR == null ? 'selected' : ''}>(Disabled)</option>
          <option ${appState.settings.enableHDR === false ? 'selected' : ''}>Disabled</option>
          <option ${appState.settings.enableHDR ? 'selected' : ''}>Enabled</option>
        </select>
      </div>

      <div class="settings-editor-input-div" title="${Tooltips.denoiseTooltip}">
        <span>Denoise</span>
        <select id="denoise-input">
          <option value="Inherit" ${denoiseDesc == null ? 'selected' : ''}>(Disabled)</option>
          <option ${denoiseDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
          <option ${denoiseDesc === 'Weak' ? 'selected' : ''}>Weak</option>
          <option ${denoiseDesc === 'Medium' ? 'selected' : ''}>Medium</option>
          <option ${denoiseDesc === 'Strong' ? 'selected' : ''}>Strong</option>
          <option ${denoiseDesc === 'Very Strong' ? 'selected' : ''}>Very Strong</option>
        </select>
      </div>
      <div class="settings-editor-input-div">
        <div  title="${Tooltips.minterpFpsMultiplierTooltip}">
          <span>Src FPS Multiplier</span>
          <div class="fps-mul-stepper">
            <button class="fps-mul-step-btn" data-step="-1">−1</button>
            <input id="minterp-fps-multiplier-input" class="fps-mul-input" type="number" min="0" max="5" step="0.05" value="${minterpFpsMultiplier ?? ''}" placeholder="0"></input>
            <button class="fps-mul-step-btn" data-step="+1">+1</button>
            <span class="fps-mul-suffix"></span>
          </div>
        </div>
      </div>
      <div class="settings-editor-input-div multi-input-div" title="${Tooltips.vidstabTooltip}">
        <div>
          <span>Stabilization</span>
          <select id="video-stabilization-input">
            <option value="Inherit" ${vidstabDesc == null ? 'selected' : ''}>(Disabled)</option>
            <option ${vidstabDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option ${vidstabDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${vidstabDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${vidstabDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${vidstabDesc === 'Very Strong' ? 'selected' : ''}>Very Strong</option>
            <option ${vidstabDesc === 'Strongest' ? 'selected' : ''}>Strongest</option>
          </select>
        </div>
        <div title="${Tooltips.dynamicZoomTooltip}">
          <span>Dynamic Zoom</span>
          <select id="video-stabilization-dynamic-zoom-input">
            <option value="Default" ${vidstabDynamicZoomEnabled == null ? 'selected' : ''}>(Disabled)</option>
            <option ${vidstabDynamicZoomEnabled === false ? 'selected' : ''}>Disabled</option>
            <option ${vidstabDynamicZoomEnabled ? 'selected' : ''}>Enabled</option>
          </select>
        </div>
      </div>
      <div class="settings-editor-input-div multi-input-div" title="${Tooltips.loopTooltip}">
        <div>
          <span>Loop</span>
          <select id="loop-input">
          <option value="Default" ${appState.settings.loop == null ? 'selected' : ''}>(none)</option>
          <option ${appState.settings.loop === 'none' ? 'selected' : ''}>none</option>
            <option ${appState.settings.loop === 'fwrev' ? 'selected' : ''}>fwrev</option>
            <option ${appState.settings.loop === 'fade' ? 'selected' : ''}>fade</option>
          </select>
        </div>
        <div title="${Tooltips.fadeDurationTooltip}">
          <span>Fade Duration</span>
          <input id="fade-duration-input" type="number" min="0.1" step="0.1" value="${appState.settings.fadeDuration ?? ''}" placeholder="0.7" style="width:7em"></input>
        </div>
      </div>
    </fieldset>
    `
  );

  injectYtcWidget(globalSettingsEditorDiv);

  const settingsInputsConfigs = [['crop-res-input', 'cropRes', 'string']];
  const settingsInputsConfigsHighlightable = [
    ['crop-input', 'newMarkerCrop', 'string'],
    ['speed-input', 'newMarkerSpeed', 'number'],
    ['title-suffix-input', 'titleSuffix', 'string'],
    ['merge-list-input', 'markerPairMergeList', 'string'],
    ['enable-hdr-input', 'enableHDR', 'ternary'],
    ['gamma-input', 'gamma', 'number'],
    ['encode-speed-input', 'encodeSpeed', 'number'],
    ['crf-input', 'crf', 'number'],
    ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
    ['rotate-0', 'rotate', 'string'],
    ['rotate-90-clock', 'rotate', 'string'],
    ['rotate-90-counterclock', 'rotate', 'string'],
    ['two-pass-input', 'twoPass', 'ternary'],
    ['audio-input', 'audio', 'ternary'],
    ['denoise-input', 'denoise', 'preset'],
    // ['minterp-mode-input', 'minterpMode', 'inheritableString'],
    // ['minterp-fps-input', 'minterpFPS', 'number'],
    ['minterp-fps-multiplier-input', 'minterpFpsMultiplier', 'number'],
    ['video-stabilization-input', 'videoStabilization', 'preset'],
    ['video-stabilization-dynamic-zoom-input', 'videoStabilizationDynamicZoom', 'ternary'],
    ['loop-input', 'loop', 'inheritableString'],
    ['fade-duration-input', 'fadeDuration', 'number'],
  ];

  addSettingsInputListeners(settingsInputsConfigs, appState.settings, false);
  addSettingsInputListeners(settingsInputsConfigsHighlightable, appState.settings, true);
  bindFpsMulStepBtns();

  setCropInput(document.getElementById('crop-input') as HTMLInputElement);
  setCropAspectRatioSpan(document.getElementById('crop-aspect-ratio') as HTMLSpanElement);

  appState.wasGlobalSettingsEditorOpen = true;
  appState.isSettingsEditorOpen = true;
  addMarkerPairMergeListDurationsListener();
  addCropInputHotkeys();
  highlightModifiedSettings(settingsInputsConfigsHighlightable, appState.settings);
  showCropOverlay();
  triggerCropPreviewRedraw();
}
export function bindFpsMulStepBtns() {
  document.querySelectorAll<HTMLButtonElement>('.fps-mul-step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stepper = btn.closest<HTMLElement>('.fps-mul-stepper');
      assertDefined(stepper);
      const input = stepper.querySelector<HTMLInputElement>('input[type="number"]');
      assertDefined(input);
      const cur = parseFloat(input.value) || 0;
      const stepDir = parseInt(btn.dataset.step ?? '', 10);
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || Infinity;
      const next =
        stepDir > 0
          ? Math.min(max, Math.floor(cur) + stepDir)
          : Math.max(min, Math.ceil(cur) + stepDir);
      input.value = String(next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
export function getMarkerPairMergeListDurations(
  markerPairMergeList = appState.settings.markerPairMergeList
) {
  const durations: number[] = [];
  for (const merge of markerPairMergeList.split(';')) {
    let duration = 0;
    for (const mergeRange of merge.split(',')) {
      if (mergeRange.includes('-')) {
        let [mergeRangeStart, mergeRangeEnd] = mergeRange
          .split('-')
          .map((str) => parseInt(str, 10) - 1);
        if (mergeRangeStart > mergeRangeEnd) {
          [mergeRangeStart, mergeRangeEnd] = [mergeRangeEnd, mergeRangeStart];
        }
        for (let idx = mergeRangeStart; idx <= mergeRangeEnd; idx++) {
          if (!isNaN(idx) && idx >= 0 && idx < appState.markerPairs.length) {
            const marker = appState.markerPairs[idx];
            duration += (marker.end - marker.start) / marker.speed;
          }
        }
      } else {
        const idx = parseInt(mergeRange, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < appState.markerPairs.length) {
          const marker = appState.markerPairs[idx];
          duration += (marker.end - marker.start) / marker.speed;
        }
      }
    }
    durations.push(duration);
  }
  const markerPairMergelistDurations = durations.map(toHHMMSSTrimmed).join(' ; ');
  return markerPairMergelistDurations;
}
export function addMarkerPairMergeListDurationsListener() {
  const markerPairMergeListInput = document.getElementById('merge-list-input');
  const markerPairMergeListDurationsSpan = document.getElementById('merge-list-durations');
  assertDefined(markerPairMergeListInput);
  assertDefined(markerPairMergeListDurationsSpan);
  markerPairMergeListInput.addEventListener('change', () => {
    const markerPairMergelistDurations = getMarkerPairMergeListDurations();
    markerPairMergeListDurationsSpan.textContent = markerPairMergelistDurations;
  });
}
