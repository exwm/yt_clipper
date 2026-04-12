import { appState } from './appState';
import { chartState, hideChart, loadChartData, showChart } from './charts';
import { createCropOverlay, hideCropOverlay, showCropOverlay } from './crop-overlay';
import { getCropComponents } from './crop-utils';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { bindFpsMulStepBtns, toggleOffGlobalSettingsEditor } from './global-settings-editor';
import {
  enableMarkerHotkeys,
  hideSelectedMarkerPairOverlay,
  highlightSelectedMarkerPair,
  renumberMarkerPairs,
} from './markers';
import { injectYtcWidget } from './save-load';
import {
  addCropInputHotkeys,
  addSettingsInputListeners,
  arrowKeyCropAdjustmentEnabled,
  deleteSettingsEditor,
  highlightModifiedSettings,
  isExtraSettingsEditorEnabled,
} from './settings-editor';
import { getMinterpFpsMulSuffix, updateMinterpFpsMulLabel, updateSpeedInputLabel } from './speed';
import { setCurrentCropPoint } from './ui/chart/cropchart/cropChartSpec';
import { autoHideUnselectedMarkerPairsCSS } from './ui/css/css';
import { Tooltips } from './ui/tooltips';
import {
  assertDefined,
  blockEvent,
  deleteElement,
  flashMessage,
  injectCSS,
  safeSetInnerHtml,
  ternaryToString,
  toHHMMSSTrimmed,
} from './util/util';

export function toggleMarkerPairEditorHandler(e: PointerEvent, targetMarker?: SVGRectElement) {
  targetMarker = targetMarker ?? (e.target as SVGRectElement);

  if (targetMarker && e.shiftKey) {
    toggleMarkerPairEditor(targetMarker);
  }
}
export let markerPairNumberInput: HTMLInputElement;
export function createMarkerPairEditor(targetMarker: SVGRectElement) {
  const idx = targetMarker.getAttribute('data-idx');
  assertDefined(idx, 'targetMarker missing data-idx attribute');
  const markerPairIndex = parseInt(idx, 10) - 1;
  const markerPair = appState.markerPairs[markerPairIndex];
  const endTime = toHHMMSSTrimmed(markerPair.end);
  const speed = markerPair.speed;
  const duration = toHHMMSSTrimmed(markerPair.end - markerPair.start);
  const speedAdjustedDuration = toHHMMSSTrimmed((markerPair.end - markerPair.start) / speed);
  const crop = markerPair.crop;
  const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
  const [, , w, h] = getCropComponents(crop);
  const cropAspectRatio = (w / h).toFixed(13);

  const settingsEditorDiv = document.createElement('div');
  const overrides = markerPair.overrides;
  const vidstab = overrides.videoStabilization;
  const vidstabDesc = vidstab ? vidstab.desc : null;
  const vidstabDescGlobal = appState.settings.videoStabilization
    ? `(${appState.settings.videoStabilization.desc})`
    : '(Disabled)';
  const vidstabDynamicZoomEnabled = overrides.videoStabilizationDynamicZoom;
  // const minterpMode = overrides.minterpMode;
  // const minterpFPS = overrides.minterpFPS;
  const minterpFpsMultiplier = overrides.minterpFpsMultiplier;
  const effectiveMinterpMul = (minterpFpsMultiplier ??
    appState.settings.minterpFpsMultiplier ??
    0);
  const minterpFpsMulLabel = getMinterpFpsMulSuffix(effectiveMinterpMul, speed);
  const denoise = overrides.denoise;
  const denoiseDesc = denoise ? denoise.desc : null;
  const denoiseDescGlobal = appState.settings.denoise
    ? `(${appState.settings.denoise.desc})`
    : '(Disabled)';
  const overridesEditorDisplay = isExtraSettingsEditorEnabled ? 'block' : 'none';
  createCropOverlay(crop);

  settingsEditorDiv.setAttribute('id', 'settings-editor-div');
  safeSetInnerHtml(
    settingsEditorDiv,
    `
      <fieldset class="settings-editor-panel marker-pair-settings-editor-highlighted-div">
        <legend class="marker-pair-settings-editor-highlighted-label">Marker Pair
          <input id="marker-pair-number-input"
            title="${Tooltips.markerPairNumberTooltip}"
            type="number" value="${markerPairIndex + 1}"
            step="1" min="1" max="${appState.markerPairs.length}" style="width:3em" required>
          </input>
          /
          <span id="marker-pair-count-label">${appState.markerPairs.length}</span>
          Settings\
        </legend>
        <div class="settings-editor-input-div" title="${Tooltips.speedTooltip}">
          <span id="speed-input-label">Speed</span>
          <input id="speed-input"type="number" placeholder="speed" value="${speed}"
            step="0.05" min="0.05" max="2" style="width:7ch" required></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.cropTooltip}">
          <span id="crop-input-label">Crop</span>
          <input id="crop-input" value="${crop}" pattern="${cropInputValidation}"
          style="width:20ch" required></input>
        </div>
        <div class="settings-editor-input-div settings-info-display">
          <span>Crop Aspect Ratio</span>
          <br>
          <span id="crop-aspect-ratio">${cropAspectRatio}</span>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.titlePrefixTooltip}">
          <span>Title Prefix</span>
          <input id="title-prefix-input" value="${overrides.titlePrefix ?? ''}" placeholder="None" style="width:20ch;text-align:right"></input>
        </div>
        <div class="settings-editor-input-div settings-info-display" title="${Tooltips.timeDurationTooltip}">
          <span>Time:</span>
          <span id="start-time">${appState.startTime}</span>
          <span> - </span>
          <span id="end-time">${endTime}</span>
          <br>
          <span>Duration: </span>
          <span id="duration">${duration}/${markerPair.speed} = ${speedAdjustedDuration}</span>
        </div>
      </fieldset>
      <fieldset id="marker-pair-overrides" class="settings-editor-panel marker-pair-settings-editor-highlighted-div" style="display:${overridesEditorDisplay}">
        <legend class="marker-pair-settings-editor-highlighted-label">Overrides</legend>
        <div class="settings-editor-input-div" title="${Tooltips.audioTooltip}">
          <span>Audio</span>
          <select id="audio-input">
            <option value="Default" ${overrides.audio == null ? 'selected' : ''}>${ternaryToString(
              appState.settings.audio
            )}</option>
            <option ${overrides.audio === false ? 'selected' : ''}>Disabled</option>
            <option ${overrides.audio ? 'selected' : ''}>Enabled</option>
          </select>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.encodeSpeedTooltip}">
          <span>Encode Speed (0-5)</span>
          <input id="encode-speed-input" type="number" min="0" max="5" step="1" value="${overrides.encodeSpeed ?? ''}" placeholder="${appState.settings.encodeSpeed ?? 'Auto'}"  style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.CRFTooltip}">
          <span>CRF (0-63)</span>
          <input id="crf-input" type="number" min="0" max="63" step="1" value="${overrides.crf ?? ''}" placeholder="${appState.settings.crf ?? 'Auto'}" style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.targetBitrateTooltip}">
          <span>Bitrate (kb/s)</span>
          <input id="target-max-bitrate-input" type="number" min="0" max="10e5" step="100" value="${overrides.targetMaxBitrate ?? ''}" placeholder="${appState.settings.targetMaxBitrate ?? 'Auto'}" style="min-width:4em"></input>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.twoPassTooltip}">
          <span>Two-Pass</span>
          <select id="two-pass-input">
            <option value="Default" ${overrides.twoPass == null ? 'selected' : ''}>
              ${ternaryToString(appState.settings.twoPass)}
            </option>
            <option ${overrides.twoPass === false ? 'selected' : ''}>Disabled</option>
            <option ${overrides.twoPass ? 'selected' : ''}>Enabled</option>
          </select>
        </div>

      <div class="settings-editor-input-div" title="${Tooltips.hdrTooltip}">
        <span>Enable HDR</span>
        <select id="enable-hdr-input">
          <option value="Default" ${overrides.enableHDR == null ? 'selected' : ''}>
            ${ternaryToString(appState.settings.enableHDR)}
          </option>
          <option ${overrides.enableHDR === false ? 'selected' : ''}>Disabled</option>
          <option ${overrides.enableHDR ? 'selected' : ''}>Enabled</option>
        </select>
      </div>

      </div>
        <div class="settings-editor-input-div" title="${Tooltips.gammaTooltip}">
          <span>Gamma (0-4)</span>
          <input id="gamma-input" type="number" min="0.01" max="4.00" step="0.01" value="${overrides.gamma ?? ''}" placeholder="${appState.settings.gamma ?? '1'}" style="min-width:4em"></input>
        </div>

        <div class="settings-editor-input-div" title="${Tooltips.denoiseTooltip}">
          <span>Denoise</span>
          <select id="denoise-input">
            <option value="Inherit" ${denoiseDesc == null ? 'selected' : ''}>${denoiseDescGlobal}</option>
            <option value="Disabled" ${denoiseDesc == 'Disabled' ? 'selected' : ''}>Disabled</option>
            <option ${denoiseDesc === 'Very Weak' ? 'selected' : ''}>Very Weak</option>
            <option ${denoiseDesc === 'Weak' ? 'selected' : ''}>Weak</option>
            <option ${denoiseDesc === 'Medium' ? 'selected' : ''}>Medium</option>
            <option ${denoiseDesc === 'Strong' ? 'selected' : ''}>Strong</option>
            <option ${denoiseDesc === 'Very Strong' ? 'selected' : ''}>Very Strong</option>
          </select>
        </div>
        <div class="settings-editor-input-div">
          <div title="${Tooltips.minterpFpsMultiplierTooltip}">
            <span id="minterp-fps-mul-label">FPS Multiplier${minterpFpsMulLabel}</span>
            <div class="fps-mul-stepper">
              <button class="fps-mul-step-btn" data-step="-1">−1</button>
              <input id="minterp-fps-multiplier-input" type="number" min="0" max="5" step="0.05" value="${minterpFpsMultiplier ?? ''}" placeholder="0" style="min-width:2em"></input>
              <button class="fps-mul-step-btn" data-step="+1">+1</button>
            </div>
          </div>
        </div>
        <div class="settings-editor-input-div multi-input-div" title="${Tooltips.vidstabTooltip}">
        <div>
          <span>Stabilization</span>
          <select id="video-stabilization-input">
              <option value="Inherit" ${vidstabDesc == null ? 'selected' : ''}>${vidstabDescGlobal}</option>
              <option value="Disabled" ${vidstabDesc == 'Disabled' ? 'selected' : ''}>Disabled</option>
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
              <option value="Default" ${vidstabDynamicZoomEnabled == null ? 'selected' : ''}>${ternaryToString(appState.settings.videoStabilizationDynamicZoom)}</option>
              <option ${vidstabDynamicZoomEnabled === false ? 'selected' : ''}>Disabled</option>
              <option ${vidstabDynamicZoomEnabled ? 'selected' : ''}>Enabled</option>
            </select>
          </div>
        </div>
        <div class="settings-editor-input-div multi-input-div" title="${Tooltips.loopTooltip}">
          <div>
            <span>Loop</span>
            <select id="loop-input">
              <option value="Default" ${overrides.loop == null ? 'selected' : ''}>${appState.settings.loop != null ? `(${appState.settings.loop})` : '(none)'}</option>
              <option ${overrides.loop === 'none' ? 'selected' : ''}>none</option>
              <option ${overrides.loop === 'fwrev' ? 'selected' : ''}>fwrev</option>
              <option ${overrides.loop === 'fade' ? 'selected' : ''}>fade</option>
            </select>
          </div>
          <div title="${Tooltips.fadeDurationTooltip}">
            <span>Fade Duration</span>
            <input id="fade-duration-input" type="number" min="0.1" step="0.1" value="${overrides.fadeDuration ?? ''}" placeholder="${appState.settings.fadeDuration ?? '0.7'}" style="width:7em"></input>
          </div>
        </div>
        <div class="settings-editor-input-div" title="${Tooltips.enableZoomPanTooltip}">
          <span>ZoomPan</span>
            <select id="enable-zoom-pan-input">
              <option ${!markerPair.enableZoomPan ? 'selected' : ''}>Disabled</option>
              <option ${markerPair.enableZoomPan ? 'selected' : ''}>Enabled</option>
            </select>
        </div>
      </fieldset>
      `
  );

  injectYtcWidget(settingsEditorDiv);

  const inputConfigs = [
    ['speed-input', 'speed', 'number'],
    ['crop-input', 'crop', 'string'],
    ['enable-zoom-pan-input', 'enableZoomPan', 'bool'],
  ];
  addSettingsInputListeners(inputConfigs, markerPair, true);

  const overrideInputConfigs = [
    ['title-prefix-input', 'titlePrefix', 'string'],
    ['enable-hdr-input', 'enableHDR', 'ternary'],
    ['gamma-input', 'gamma', 'number'],
    ['encode-speed-input', 'encodeSpeed', 'number'],
    ['crf-input', 'crf', 'number'],
    ['target-max-bitrate-input', 'targetMaxBitrate', 'number'],
    ['two-pass-input', 'twoPass', 'ternary'],
    ['audio-input', 'audio', 'ternary'],
    // ['minterp-mode-input', 'minterpMode', 'inheritableString'],
    // ['minterp-fps-input', 'minterpFPS', 'number'],
    ['minterp-fps-multiplier-input', 'minterpFpsMultiplier', 'number'],
    ['denoise-input', 'denoise', 'preset'],
    ['video-stabilization-input', 'videoStabilization', 'preset'],
    ['video-stabilization-dynamic-zoom-input', 'videoStabilizationDynamicZoom', 'ternary'],
    ['loop-input', 'loop', 'inheritableString'],
    ['fade-duration-input', 'fadeDuration', 'number'],
  ];
  addSettingsInputListeners(overrideInputConfigs, markerPair.overrides, true);
  bindFpsMulStepBtns();
  markerPairNumberInput = document.getElementById('marker-pair-number-input') as HTMLInputElement;
  markerPairNumberInput.addEventListener('change', markerPairNumberInputHandler);
  appState.speedInputLabel = document.getElementById('speed-input-label') as HTMLInputElement;
  appState.speedInput = document.getElementById('speed-input') as HTMLInputElement;
  appState.minterpFpsMulLabelSpan = document.getElementById(
    'minterp-fps-mul-label'
  ) as HTMLSpanElement;

  const speedInput = document.getElementById('speed-input');
  assertDefined(speedInput, 'speed-input element not found');
  speedInput.addEventListener('change', () => { updateMinterpFpsMulLabel(markerPair); });

  const minterpFpsMultiplierInput = document.getElementById(
    'minterp-fps-multiplier-input'
  );
  assertDefined(minterpFpsMultiplierInput, 'minterp-fps-multiplier-input element not found');
  minterpFpsMultiplierInput.addEventListener('change', () => { updateMinterpFpsMulLabel(markerPair); });

  appState.cropInputLabel = document.getElementById('crop-input-label') as HTMLInputElement;
  appState.cropInput = document.getElementById('crop-input') as HTMLInputElement;
  appState.cropAspectRatioSpan = document.getElementById('crop-aspect-ratio') as HTMLSpanElement;
  appState.enableZoomPanInput = document.getElementById(
    'enable-zoom-pan-input'
  ) as HTMLInputElement;
  appState.isSettingsEditorOpen = true;
  appState.wasGlobalSettingsEditorOpen = false;

  if (appState.isForceSetSpeedOn) {
    updateSpeedInputLabel(`Speed (${appState.forceSetSpeedValue.toFixed(2)})`);
  }
  highlightModifiedSettings(inputConfigs, markerPair);
  highlightModifiedSettings(overrideInputConfigs, markerPair.overrides);
}
export function markerPairNumberInputHandler(e: Event) {
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  const startNumbering = markerPair.startNumbering;
  const endNumbering = markerPair.endNumbering;
  const value = (e.target as any).value;
  const newIdx = value - 1;
  appState.markerPairs.splice(
    newIdx,
    0,
    ...appState.markerPairs.splice(appState.prevSelectedMarkerPairIndex, 1)
  );

  let targetMarkerRect = appState.markersSvg.children[newIdx * 2];
  let targetStartNumbering = appState.startMarkerNumberings.children[newIdx];
  let targetEndNumbering = appState.endMarkerNumberings.children[newIdx];
  // if target succeedes current marker pair, move pair after target
  if (newIdx > appState.prevSelectedMarkerPairIndex) {
    assertDefined(targetMarkerRect.nextElementSibling, 'targetMarkerRect has no next sibling');
    assertDefined(targetMarkerRect.nextElementSibling.nextElementSibling, 'targetMarkerRect has no second next sibling');
    targetMarkerRect = targetMarkerRect.nextElementSibling.nextElementSibling;
    assertDefined(targetStartNumbering.nextElementSibling, 'targetStartNumbering has no next sibling');
    targetStartNumbering = targetStartNumbering.nextElementSibling;
    assertDefined(targetEndNumbering.nextElementSibling, 'targetEndNumbering has no next sibling');
    targetEndNumbering = targetEndNumbering.nextElementSibling;
  }

  const prevSelectedStartMarker = appState.prevSelectedEndMarker.previousElementSibling;
  assertDefined(prevSelectedStartMarker, 'prevSelectedEndMarker has no previous sibling');
  // if target precedes current marker pair, move pair before target
  appState.markersSvg.insertBefore(prevSelectedStartMarker, targetMarkerRect);
  appState.markersSvg.insertBefore(appState.prevSelectedEndMarker, targetMarkerRect);
  appState.startMarkerNumberings.insertBefore(startNumbering, targetStartNumbering);
  appState.endMarkerNumberings.insertBefore(endNumbering, targetEndNumbering);

  renumberMarkerPairs();
  appState.prevSelectedMarkerPairIndex = newIdx;
}
export function toggleMarkerPairEditor(targetMarker: SVGRectElement) {
  // if target marker is previously selected marker: toggle target on/off
  if (appState.prevSelectedEndMarker === targetMarker && !appState.wasGlobalSettingsEditorOpen) {
    appState.isSettingsEditorOpen
      ? toggleOffMarkerPairEditor()
      : toggleOnMarkerPairEditor(targetMarker);

    // otherwise switching from a different marker pair or from global appState.settings editor
  } else {
    // delete current appState.settings editor appropriately
    if (appState.isSettingsEditorOpen) {
      appState.wasGlobalSettingsEditorOpen
        ? toggleOffGlobalSettingsEditor()
        : toggleOffMarkerPairEditor();
    }
    // create new marker pair appState.settings editor
    toggleOnMarkerPairEditor(targetMarker);
  }
}

export let autoHideUnselectedMarkerPairsStyle: HTMLStyleElement;
export function toggleAutoHideUnselectedMarkerPairs(e: KeyboardEvent) {
  if (e.ctrlKey && !arrowKeyCropAdjustmentEnabled) {
    blockEvent(e);
    if (!appState.isAutoHideUnselectedMarkerPairsOn) {
      autoHideUnselectedMarkerPairsStyle = injectCSS(
        autoHideUnselectedMarkerPairsCSS,
        'auto-hide-unselected-marker-pairs-css'
      );
      appState.isAutoHideUnselectedMarkerPairsOn = true;
      flashMessage('Auto-hiding of unselected marker pairs enabled', 'green');
    } else {
      deleteElement(autoHideUnselectedMarkerPairsStyle);
      appState.isAutoHideUnselectedMarkerPairsOn = false;
      flashMessage('Auto-hiding of unselected marker pairs disabled', 'red');
    }
  }
}

// Assumes targetMarker is an end marker
export function toggleOnMarkerPairEditor(targetMarker: SVGRectElement) {
  appState.prevSelectedEndMarker = targetMarker;
  const idx = appState.prevSelectedEndMarker.getAttribute('data-idx');
  assertDefined(idx, 'prevSelectedEndMarker missing data-idx attribute');

  const selectedMarkerPairIndex = parseInt(idx) - 1;
  if (selectedMarkerPairIndex !== appState.prevSelectedMarkerPairIndex) {
    setCurrentCropPoint(null, 0);
  }
  appState.prevSelectedMarkerPairIndex = selectedMarkerPairIndex;

  highlightSelectedMarkerPair(targetMarker);
  enableMarkerHotkeys(targetMarker);
  // creating editor sets appState.isSettingsEditorOpen to true
  createMarkerPairEditor(targetMarker);
  addCropInputHotkeys();
  loadChartData(chartState.speedChartInput);
  loadChartData(chartState.cropChartInput);
  showCropOverlay();
  triggerCropPreviewRedraw();
  if (appState.isChartEnabled) {
    showChart();
  }

  targetMarker.classList.add('selected-marker');
  assertDefined(targetMarker.previousElementSibling, 'targetMarker has no previous sibling');
  targetMarker.previousElementSibling.classList.add('selected-marker');
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  markerPair.startNumbering.classList.add('selectedMarkerNumbering');
  markerPair.endNumbering.classList.add('selectedMarkerNumbering');
  if (appState.isAutoHideUnselectedMarkerPairsOn) {
    autoHideUnselectedMarkerPairsStyle = injectCSS(
      autoHideUnselectedMarkerPairsCSS,
      'auto-hide-unselected-marker-pairs-css'
    );
  }
}
export function toggleOffMarkerPairEditor(hardHide = false) {
  deleteSettingsEditor();
  hideSelectedMarkerPairOverlay(hardHide);
  hideCropOverlay();
  hideChart();
  appState.prevSelectedEndMarker.classList.remove('selected-marker');
  assertDefined(appState.prevSelectedEndMarker.previousElementSibling, 'prevSelectedEndMarker has no previous sibling');
  appState.prevSelectedEndMarker.previousElementSibling.classList.remove('selected-marker');
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  markerPair.startNumbering.classList.remove('selectedMarkerNumbering');
  markerPair.endNumbering.classList.remove('selectedMarkerNumbering');
  if (appState.isAutoHideUnselectedMarkerPairsOn) {
    deleteElement(autoHideUnselectedMarkerPairsStyle);
  }
}
