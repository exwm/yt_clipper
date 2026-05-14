import { html, render, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { appState } from '../../appState';
import { chartState, hideChart, loadChartData, showChart } from '../../charts';
import { InfoRow, NumberInputRow, SettingsFieldset, TextInputRow } from '../../components/settings';
import { EncodeSettingsFieldset } from './encode-settings-fieldset';
import { createCropOverlay, hideCropOverlay, showCropOverlay } from '../../crop-overlay';
import { getCropComponents } from '../../crop-utils';
import { triggerCropPreviewRedraw } from '../../crop/crop-preview';
import { bindFpsMulStepBtns, toggleOffGlobalSettingsEditor } from './global-settings-editor';
import {
  enableMarkerHotkeys,
  hideSelectedMarkerPairOverlay,
  highlightSelectedMarkerPair,
  renumberMarkerPairs,
} from '../../markers';
import { injectYtcWidget } from '../../save-load';
import {
  addCropInputHotkeys,
  arrowKeyCropAdjustmentEnabled,
  createBindings,
  deleteSettingsEditor,
  FieldBinder,
  gateHotkeys,
  highlightModifiedSettings,
  isExtraSettingsEditorEnabled,
  SettingsBinder,
  setCropAspectRatioSpan,
  setCropInput,
  setCropInputLabel,
  setEnableZoomPanInput,
} from './settings-editor';
import { MarkerPair, MarkerPairOverrides } from '../../@types/yt_clipper';
import {
  getMinterpFpsMulSuffix,
  updateMinterpFpsMulLabel,
  updateSpeedInputLabel,
} from '../../speed';
import { setCurrentCropPoint } from '../../ui/chart/cropchart/cropChartSpec';
import { autoHideUnselectedMarkerPairsCSS } from '../../ui/css/css';
import { Tooltips } from '../../ui/tooltips';
import {
  assertDefined,
  blockEvent,
  deleteElement,
  flashMessage,
  injectCSS,
  toHHMMSSTrimmed,
} from '../../util/util';

export function toggleMarkerPairEditorHandler(e: PointerEvent, targetMarker?: SVGRectElement) {
  targetMarker = targetMarker ?? (e.target as SVGRectElement);

  if (targetMarker && e.shiftKey) {
    toggleMarkerPairEditor(targetMarker);
  }
}
export let markerPairNumberInput: HTMLInputElement;

function MarkerPairEditorTemplate(
  markerPair: MarkerPair,
  pairBinder: SettingsBinder<MarkerPair>,
  overrideBinder: SettingsBinder<MarkerPairOverrides>
): TemplateResult {
  const { bind: bindPair } = pairBinder;
  const { bind: bindOverride } = overrideBinder;
  const markerPairIndex = appState.markerPairs.indexOf(markerPair);
  const endTime = toHHMMSSTrimmed(markerPair.end);
  const speed = markerPair.speed;
  const duration = toHHMMSSTrimmed(markerPair.end - markerPair.start);
  const speedAdjustedDuration = toHHMMSSTrimmed((markerPair.end - markerPair.start) / speed);
  const crop = markerPair.crop;
  const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
  const [, , w, h] = getCropComponents(crop);
  const cropAspectRatio = (w / h).toFixed(13);

  const overrides = markerPair.overrides;
  const effectiveMinterpMul =
    overrides.minterpFpsMultiplier ?? appState.settings.minterpFpsMultiplier ?? 0;
  const minterpFpsMulLabel = getMinterpFpsMulSuffix(effectiveMinterpMul, speed);
  const overridesDisplay = isExtraSettingsEditorEnabled ? 'block' : 'none';

  const legend = html`
    Marker Pair
    <input
      id="marker-pair-number-input"
      title=${Tooltips.markerPairNumberTooltip}
      type="number"
      step="1"
      min="1"
      max=${String(appState.markerPairs.length)}
      style="width:3em"
      required
      .value=${String(markerPairIndex + 1)}
      @change=${markerPairNumberInputHandler}
      ${ref(gateHotkeys)}
    />
    /
    <span id="marker-pair-count-label">${appState.markerPairs.length}</span>
    Settings
  `;

  return html`
    ${SettingsFieldset({
      variant: 'marker',
      legend,
      children: html`
        ${NumberInputRow({
          ...bindPair('speed-input', 'speed', 'number', {
            afterChange: () => updateMinterpFpsMulLabel(markerPair),
          }),
          labelId: 'speed-input-label',
          label: 'Speed',
          value: speed,
          tooltip: Tooltips.speedTooltip,
          min: 0.05,
          max: 2,
          step: 0.05,
          placeholder: 'speed',
          styleInfo: { width: '7ch' },
          required: true,
        })}
        ${TextInputRow({
          ...bindPair('crop-input', 'crop', 'string'),
          labelId: 'crop-input-label',
          label: 'Crop',
          value: crop,
          tooltip: Tooltips.cropTooltip,
          pattern: cropInputValidation,
          styleInfo: { width: '20ch' },
          required: true,
        })}
        ${InfoRow({
          label: 'Crop Aspect Ratio',
          valueId: 'crop-aspect-ratio',
          value: cropAspectRatio,
          breakBeforeValue: true,
        })}
        ${TextInputRow({
          ...bindOverride('title-prefix-input', 'titlePrefix', 'string'),
          label: 'Title Prefix',
          value: overrides.titlePrefix ?? '',
          tooltip: Tooltips.titlePrefixTooltip,
          placeholder: 'None',
          styleInfo: { width: '20ch' },
        })}
        <div
          class="settings-editor-input-div settings-info-display"
          title=${Tooltips.timeDurationTooltip}
        >
          <span>Time:</span>
          <span id="start-time">${appState.startTime}</span>
          <span> - </span>
          <span id="end-time">${endTime}</span>
          <br />
          <span>Duration: </span>
          <span id="duration">${duration}/${markerPair.speed} = ${speedAdjustedDuration}</span>
        </div>
      `,
    })}
    ${EncodeSettingsFieldset({
      id: 'marker-pair-overrides',
      variant: 'marker',
      display: overridesDisplay,
      source: overrides,
      inheritFrom: appState.settings,
      bind: bindOverride as FieldBinder,
      fpsMulSuffix: {
        labelId: 'minterp-fps-mul-label',
        spanId: 'minterp-fps-mul-suffix',
        text: minterpFpsMulLabel,
        onChange: () => updateMinterpFpsMulLabel(markerPair),
      },
      zoomPan: { enabled: markerPair.enableZoomPan, bind: bindPair as FieldBinder },
    })}
  `;
}

export function createMarkerPairEditor(targetMarker: SVGRectElement) {
  const idx = targetMarker.getAttribute('data-idx');
  assertDefined(idx, 'targetMarker missing data-idx attribute');
  const markerPairIndex = parseInt(idx, 10) - 1;
  const markerPair = appState.markerPairs[markerPairIndex];
  createCropOverlay(markerPair.crop);

  const settingsEditorDiv = document.createElement('div');
  settingsEditorDiv.setAttribute('id', 'settings-editor-div');

  const pairBinder = createBindings(markerPair);
  const overrideBinder = createBindings(markerPair.overrides);
  render(MarkerPairEditorTemplate(markerPair, pairBinder, overrideBinder), settingsEditorDiv);

  injectYtcWidget(settingsEditorDiv);

  bindFpsMulStepBtns();
  markerPairNumberInput = document.getElementById('marker-pair-number-input') as HTMLInputElement;
  appState.speedInputLabel = document.getElementById('speed-input-label') as HTMLInputElement;
  appState.speedInput = document.getElementById('speed-input') as HTMLInputElement;
  appState.minterpFpsMulSuffixSpan = document.getElementById(
    'minterp-fps-mul-suffix'
  ) as HTMLSpanElement;

  appState.cropInputLabel = document.getElementById('crop-input-label') as HTMLInputElement;
  appState.cropInput = document.getElementById('crop-input') as HTMLInputElement;
  appState.cropAspectRatioSpan = document.getElementById('crop-aspect-ratio') as HTMLSpanElement;
  appState.enableZoomPanInput = document.getElementById(
    'enable-zoom-pan-input'
  ) as HTMLInputElement;
  setCropInputLabel(appState.cropInputLabel);
  setCropInput(appState.cropInput);
  setCropAspectRatioSpan(appState.cropAspectRatioSpan);
  setEnableZoomPanInput(appState.enableZoomPanInput);
  appState.isSettingsEditorOpen = true;
  appState.wasGlobalSettingsEditorOpen = false;

  if (appState.isForceSetSpeedOn) {
    updateSpeedInputLabel(`Speed (${appState.forceSetSpeedValue.toFixed(2)})`);
  }
  highlightModifiedSettings(pairBinder.all(), markerPair);
  highlightModifiedSettings(overrideBinder.all(), markerPair.overrides);
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
    assertDefined(
      targetMarkerRect.nextElementSibling.nextElementSibling,
      'targetMarkerRect has no second next sibling'
    );
    targetMarkerRect = targetMarkerRect.nextElementSibling.nextElementSibling;
    assertDefined(
      targetStartNumbering.nextElementSibling,
      'targetStartNumbering has no next sibling'
    );
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
  assertDefined(
    appState.prevSelectedEndMarker.previousElementSibling,
    'prevSelectedEndMarker has no previous sibling'
  );
  appState.prevSelectedEndMarker.previousElementSibling.classList.remove('selected-marker');
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  markerPair.startNumbering.classList.remove('selectedMarkerNumbering');
  markerPair.endNumbering.classList.remove('selectedMarkerNumbering');
  if (appState.isAutoHideUnselectedMarkerPairsOn) {
    deleteElement(autoHideUnselectedMarkerPairsStyle);
  }
}
