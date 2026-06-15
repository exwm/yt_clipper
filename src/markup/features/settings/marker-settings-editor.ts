import { html, render, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { appState } from '../../appState';
import { chartState, hideChart, loadChartData, showChart, toggleChart } from '../../charts';
import { InfoRow, NumberInputRow, SettingsFieldset, TextInputRow } from '../../components/settings';
import { EncodeSettingsFieldset } from './encode-settings-fieldset';
import {
  createCropOverlay,
  cropCrossHairEnabled,
  cycleCropDimOpacity,
  getCropDimOpacityPercent,
  hideCropOverlay,
  showCropOverlay,
  toggleCropCrossHair,
} from '../../crop-overlay';
import { captureFrame } from '../../frame-capture';
import { cyclePreviewRotation } from '../../video-rotation';
import { loadClipperInputDataFromLocalStorage } from '../../auto-save';
import { cropStringsEqual, getCropComponents } from '../../crop-utils';
import {
  cropPreviewEnabled,
  toggleCropPreview,
  triggerCropPreviewRedraw,
} from '../../crop/crop-preview';
import { bindFpsMulStepBtns, toggleOffGlobalSettingsEditor } from './global-settings-editor';
import {
  canRedoMarkerPairChange,
  canUndoMarkerPairChange,
  enableMarkerHotkeys,
  getRedoMarkerPairChangeCount,
  getUndoMarkerPairChangeCount,
  hideSelectedMarkerPairOverlay,
  highlightSelectedMarkerPair,
  moveMarkerPairToIndex,
  refreshMarkerPairNavButtonsDisabledState,
  selectAdjacentMarkerPair,
  undoRedoMarkerPairChange,
} from '../../markers';
import {
  getClipperInputJSON,
  injectYtcWidget,
  isVariableSpeed,
  promptLoadMarkersJsonFile,
  saveMarkersAndSettings,
} from '../../save-load';
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
  toggleMarkerPairOverridesEditor,
} from './settings-editor';
import { MarkerPair, MarkerPairOverrides } from '../../@types/yt_clipper';
import {
  getIsMarkerLoopPreviewOn,
  getIsSpeedPreviewOn,
  getMinterpFpsMulSuffix,
  toggleMarkerPairLoop,
  toggleMarkerPairSpeedPreview,
  updateMinterpFpsMulLabel,
  updateSpeedInputLabel,
} from '../../speed';
import { toggleGammaPreview } from '../../preview-toggles';
import { renderToggleIcon, ToggleIconName } from '../icons/glyphs';
import { setCurrentCropPoint } from '../../ui/chart/cropchart/cropChartSpec';
import { refreshPlayerControlsAutoHideTimer } from '../../util/videoUtil';
import { MARKER_PAIR_HISTORY_CHANGED_EVENT } from '../../util/undoredo';
import { autoHideUnselectedMarkerPairsCSS } from '../../ui/css/css';
import { Tooltips } from '../../ui/tooltips';
import {
  assertDefined,
  blockEvent,
  clampNumber,
  copyToClipboard,
  deleteElement,
  flashMessage,
  injectCSS,
  SETTINGS_BAR_REFRESH_EVENT,
  toHHMMSSTrimmed,
} from '../../util/util';

export function toggleMarkerPairEditorHandler(e: PointerEvent, targetMarker?: SVGRectElement) {
  targetMarker = targetMarker ?? (e.target as SVGRectElement);

  if (targetMarker && e.shiftKey) {
    toggleMarkerPairEditor(targetMarker);
  }
}
export let markerPairNumberInput: HTMLInputElement;

function selectPrevMarkerPairHandler() {
  selectAdjacentMarkerPair(-1);
}
function selectNextMarkerPairHandler() {
  selectAdjacentMarkerPair(1);
}
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

  const isFirstPair = markerPairIndex <= 0;
  const isLastPair = markerPairIndex >= appState.markerPairs.length - 1;
  const legend = html`
    <span class="settings-legend-main">
      <button
        type="button"
        id="select-prev-marker-pair"
        class="marker-pair-nav-button"
        title=${Tooltips.selectPrevMarkerPairTooltip}
        ?disabled=${isFirstPair}
        @click=${selectPrevMarkerPairHandler}
      >
        ◄ Prev
      </button>
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
      <button
        type="button"
        id="select-next-marker-pair"
        class="marker-pair-nav-button"
        title=${Tooltips.selectNextMarkerPairTooltip}
        ?disabled=${isLastPair}
        @click=${selectNextMarkerPairHandler}
      >
        Next ►
      </button>
    </span>
    <span class="settings-legend-connector"></span>
    <span id="settings-toggle-host-main">${renderSettingsToggleBar('marker')}</span>
  `;

  return html`
    ${SettingsFieldset({
      variant: 'marker',
      legend,
      legendClassExtra: 'settings-legend-with-toggles',
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
      // Host that the toggle bar relocates into while overrides are open.
      legendExtra: html`<span class="settings-legend-connector"></span
        ><span id="settings-toggle-host-encode"></span>`,
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
  placeSettingsToggleBar();
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
  const input = e.target as HTMLInputElement;
  const fromIdx = appState.prevSelectedMarkerPairIndex;
  const lastIdx = appState.markerPairs.length - 1;
  const requested = parseInt(input.value, 10);
  // Revert the field on an unusable entry; clamp valid entries into range.
  if (Number.isNaN(requested)) {
    input.value = String(fromIdx + 1);
    return;
  }
  const toIdx = clampNumber(requested - 1, 0, lastIdx);
  if (toIdx === fromIdx) {
    input.value = String(fromIdx + 1);
    return;
  }

  moveMarkerPairToIndex(fromIdx, toIdx);
  appState.prevSelectedMarkerPairIndex = toIdx;
  input.value = String(toIdx + 1);
  refreshMarkerPairNavButtonsDisabledState();
  refreshPlayerControlsAutoHideTimer();
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
// Core auto-hide toggle, callable from both the hotkey and the Focus button.
export function setAutoHideUnselectedMarkerPairs(on: boolean) {
  if (on === appState.isAutoHideUnselectedMarkerPairsOn) return;
  if (on) {
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
  refreshSettingsBar();
}
export function toggleAutoHideUnselectedMarkerPairs(e: KeyboardEvent) {
  if (e.ctrlKey && !arrowKeyCropAdjustmentEnabled) {
    blockEvent(e);
    setAutoHideUnselectedMarkerPairs(!appState.isAutoHideUnselectedMarkerPairsOn);
  }
}

// --- Settings editor toggle bar ---------------------------------------------
// A grouped icon bar injected into a settings editor's legend, serving both the
// marker pair and global editors; each item declares which via `editors`.
export type SettingsEditorType = 'marker' | 'global';

// "All previews" master: if speed, loop and gamma are all on, turn them off;
// otherwise turn them all on.
function areAllPreviewsOn() {
  return getIsSpeedPreviewOn() && getIsMarkerLoopPreviewOn() && appState.isGammaPreviewOn;
}
function toggleAllPreviewsScoped() {
  if (areAllPreviewsOn()) {
    toggleMarkerPairSpeedPreview();
    toggleMarkerPairLoop();
    toggleGammaPreview();
  } else {
    if (!getIsSpeedPreviewOn()) toggleMarkerPairSpeedPreview();
    if (!getIsMarkerLoopPreviewOn()) toggleMarkerPairLoop();
    if (!appState.isGammaPreviewOn) toggleGammaPreview();
  }
}

// A bar item is one button. Toggles set `isActive` (live on/off); one-shot
// actions set neither or `isDisabled`. `badge` adds a corner pill: return the
// value to show (0 included, e.g. crop-dim percent) or null to hide it.
// Items render grouped (BAR_GROUP_ORDER) in array order, so layout is just data.
// `isActive` is read live so the bar reflects state set by button or hotkey.
type BarGroup = 'Actions' | 'Focus' | 'Crop' | 'View' | 'Charts' | 'Previews' | 'Overrides';
const BAR_GROUP_ORDER: BarGroup[] = [
  'Actions',
  'Focus',
  'Crop',
  'View',
  'Charts',
  'Previews',
  'Overrides',
];

interface BarItem {
  id: string;
  icon: ToggleIconName;
  group: BarGroup;
  editors: SettingsEditorType[];
  tooltip: string;
  isActive?: () => boolean;
  isDisabled?: () => boolean;
  badge?: () => number | string | null;
  run: () => void;
}

// Chart toggle badge counts — only when the curve is dynamic (2+ differing
// points); a flat curve returns null so the badge hides.
function getSpeedPointBadgeCount(): number | null {
  const idx = appState.prevSelectedMarkerPairIndex;
  if (idx == null) return null;
  const speedMap = appState.markerPairs[idx]?.speedMap;
  return speedMap && isVariableSpeed(speedMap) ? speedMap.length : null;
}
function getCropPointBadgeCount(): number | null {
  const idx = appState.prevSelectedMarkerPairIndex;
  if (idx == null) return null;
  const cropMap = appState.markerPairs[idx]?.cropMap;
  if (!cropMap || cropMap.length < 2) return null;
  const isDynamic = cropMap.some((p) => !cropStringsEqual(p.crop, cropMap[0].crop));
  return isDynamic ? cropMap.length : null;
}

// Count of encode settings overridden on the selected pair, mirroring the
// "modified" highlight: a value that is unset ('' / null), an off boolean, or a
// disabled sub-object (denoise, video stabilization) does not count. null hides.
function getOverridesBadgeCount(): number | null {
  const idx = appState.prevSelectedMarkerPairIndex;
  if (idx == null) return null;
  const overrides = appState.markerPairs[idx]?.overrides;
  if (!overrides) return null;
  const count = Object.values(overrides).filter(isOverrideSet).length;
  return count > 0 ? count : null;
}
function isOverrideSet(value: unknown): boolean {
  if (value == null || value === '' || value === false) return false;
  if (typeof value === 'object') return (value as { enabled?: boolean }).enabled !== false;
  return true;
}

// Drops 0 to null so count badges (undo/redo depth) hide when empty, while
// value badges (crop-dim percent) can still show 0.
function hideZero(count: number): number | null {
  return count > 0 ? count : null;
}

const barItems: BarItem[] = [
  // Actions — pair history (marker) and data (global).
  {
    id: 'undo-marker-pair-change',
    icon: 'undo',
    group: 'Actions',
    editors: ['marker'],
    tooltip: Tooltips.undoMarkerPairChangeTooltip,
    isDisabled: () => !canUndoMarkerPairChange(),
    badge: () => hideZero(getUndoMarkerPairChangeCount()),
    run: () => undoRedoMarkerPairChange('undo'),
  },
  {
    id: 'redo-marker-pair-change',
    icon: 'redo',
    group: 'Actions',
    editors: ['marker'],
    tooltip: Tooltips.redoMarkerPairChangeTooltip,
    isDisabled: () => !canRedoMarkerPairChange(),
    badge: () => hideZero(getRedoMarkerPairChangeCount()),
    run: () => undoRedoMarkerPairChange('redo'),
  },
  {
    id: 'load-markers-json',
    icon: 'load',
    group: 'Actions',
    editors: ['global'],
    tooltip: Tooltips.loadMarkersTooltip,
    run: promptLoadMarkersJsonFile,
  },
  {
    id: 'restore-markers-json',
    icon: 'restore',
    group: 'Actions',
    editors: ['global'],
    tooltip: Tooltips.restoreMarkersTooltip,
    run: () => loadClipperInputDataFromLocalStorage(),
  },
  {
    id: 'save-markers-json',
    icon: 'save',
    group: 'Actions',
    editors: ['global'],
    tooltip: Tooltips.saveMarkersTooltip,
    run: saveMarkersAndSettings,
  },
  {
    id: 'copy-markers-json',
    icon: 'copy',
    group: 'Actions',
    editors: ['global'],
    tooltip: Tooltips.copyMarkersTooltip,
    run: () => copyToClipboard(getClipperInputJSON()),
  },
  // Focus.
  {
    id: 'toggle-focus-unselected-pairs',
    icon: 'focus',
    group: 'Focus',
    editors: ['marker'],
    tooltip: Tooltips.focusUnselectedPairsTooltip,
    isActive: () => appState.isAutoHideUnselectedMarkerPairsOn,
    run: () => setAutoHideUnselectedMarkerPairs(!appState.isAutoHideUnselectedMarkerPairsOn),
  },
  // Crop tools (crosshair, dim, preview, capture).
  {
    id: 'toggle-crop-crosshair',
    icon: 'crosshair',
    group: 'Crop',
    editors: ['marker', 'global'],
    tooltip: Tooltips.crosshairToggleTooltip,
    isActive: () => cropCrossHairEnabled,
    run: toggleCropCrossHair,
  },
  {
    id: 'cycle-crop-dim-opacity',
    icon: 'cropDim',
    group: 'Crop',
    editors: ['marker', 'global'],
    tooltip: Tooltips.cycleCropDimOpacityTooltip,
    badge: getCropDimOpacityPercent,
    run: cycleCropDimOpacity,
  },
  {
    id: 'toggle-crop-preview',
    icon: 'cropPreview',
    group: 'Crop',
    editors: ['marker'],
    tooltip: Tooltips.cropPreviewToggleTooltip,
    isActive: () => cropPreviewEnabled,
    run: () => toggleCropPreview('modal'),
  },
  {
    id: 'capture-frame',
    icon: 'captureFrame',
    group: 'Crop',
    editors: ['marker', 'global'],
    tooltip: Tooltips.captureFrameTooltip,
    run: captureFrame,
  },
  // View — preview rotation. Cycles 0 -> 90 -> -90 -> 0 with the angle on a
  // badge; also mirrors onto the output rotation setting (see video-rotation).
  {
    id: 'cycle-preview-rotation',
    icon: 'rotate',
    group: 'View',
    editors: ['global'],
    tooltip: Tooltips.rotateVideoTooltip,
    isActive: () => appState.rotation !== 0,
    badge: () => (appState.rotation === 0 ? null : String(appState.rotation)),
    run: cyclePreviewRotation,
  },
  // Charts.
  {
    id: 'toggle-speed-chart',
    icon: 'speedChart',
    group: 'Charts',
    editors: ['marker'],
    tooltip: Tooltips.speedChartToggleTooltip,
    isActive: () =>
      appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'speed',
    badge: getSpeedPointBadgeCount,
    run: () => toggleChart(chartState.speedChartInput),
  },
  {
    id: 'toggle-crop-chart',
    icon: 'cropChart',
    group: 'Charts',
    editors: ['marker'],
    tooltip: Tooltips.cropChartToggleTooltip,
    isActive: () => appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop',
    badge: getCropPointBadgeCount,
    run: () => toggleChart(chartState.cropChartInput),
  },
  // Previews.
  {
    id: 'toggle-all-previews',
    icon: 'allPreviews',
    group: 'Previews',
    editors: ['marker', 'global'],
    tooltip: Tooltips.allPreviewsToggleTooltip,
    isActive: areAllPreviewsOn,
    run: toggleAllPreviewsScoped,
  },
  {
    id: 'toggle-speed-preview',
    icon: 'speedPreview',
    group: 'Previews',
    editors: ['marker', 'global'],
    tooltip: Tooltips.speedPreviewToggleTooltip,
    isActive: getIsSpeedPreviewOn,
    run: toggleMarkerPairSpeedPreview,
  },
  {
    id: 'toggle-marker-pair-loop',
    icon: 'loop',
    group: 'Previews',
    editors: ['marker', 'global'],
    tooltip: Tooltips.loopMarkerPairTooltip,
    isActive: getIsMarkerLoopPreviewOn,
    run: toggleMarkerPairLoop,
  },
  {
    id: 'toggle-gamma-preview',
    icon: 'gamma',
    group: 'Previews',
    editors: ['marker', 'global'],
    tooltip: Tooltips.gammaPreviewToggleTooltip,
    isActive: () => appState.isGammaPreviewOn,
    run: toggleGammaPreview,
  },
  // Overrides gear (rightmost).
  {
    id: 'toggle-marker-pair-overrides',
    icon: 'overrides',
    group: 'Overrides',
    editors: ['marker', 'global'],
    tooltip: Tooltips.overridesToggleTooltip,
    isActive: () => isExtraSettingsEditorEnabled,
    badge: getOverridesBadgeCount,
    run: toggleMarkerPairOverridesEditor,
  },
];

function makeBarItemHandler(item: BarItem) {
  return () => {
    item.run();
    // Resync active/disabled/badges; the overrides toggle also relocates the bar.
    refreshSettingsBar();
    placeSettingsToggleBar();
  };
}

// The panel narrows when the encode settings open, cramping the bar; move it
// into whichever legend has room (the encode legend while open, else the
// primary one). Called after render and on encode-settings toggle.
export function placeSettingsToggleBar() {
  const bar = document.getElementById('settings-toggle-bar');
  if (!bar) return;
  const host = isExtraSettingsEditorEnabled
    ? document.getElementById('settings-toggle-host-encode')
    : document.getElementById('settings-toggle-host-main');
  if (host && bar.parentElement !== host) host.appendChild(bar);
}

// Corner pill, shared by toggle and action buttons. Hidden when badge() is null.
function renderButtonBadge(badge?: () => number | string | null): TemplateResult | string {
  if (!badge) return '';
  const value = badge();
  return html`<span class="settings-badge" style=${value == null ? 'display:none' : ''}
    >${value ?? ''}</span
  >`;
}
function updateButtonBadge(el: HTMLElement, badge?: () => number | string | null) {
  if (!badge) return;
  const badgeEl = el.querySelector<HTMLElement>('.settings-badge');
  if (!badgeEl) return;
  const value = badge();
  badgeEl.textContent = value == null ? '' : String(value);
  badgeEl.style.display = value == null ? 'none' : '';
}

function renderBarItem(item: BarItem): TemplateResult {
  const active = item.isActive?.() ? ' active' : '';
  return html`
    <button
      type="button"
      id=${item.id}
      class=${`settings-toggle${active}`}
      title=${item.tooltip}
      ?disabled=${item.isDisabled?.() ?? false}
      @click=${makeBarItemHandler(item)}
    >
      ${renderToggleIcon(item.icon, 16)}${renderButtonBadge(item.badge)}
    </button>
  `;
}

// Render groups in BAR_GROUP_ORDER, items in array order within each, separated
// by dividers. The gear (Overrides) stays rightmost with previews just left of
// it, so the controls shared by both editors line up across them.
export function renderSettingsToggleBar(editor: SettingsEditorType): TemplateResult {
  const sections = BAR_GROUP_ORDER.map((group) =>
    barItems.filter((it) => it.group === group && it.editors.includes(editor)).map(renderBarItem)
  ).filter((section) => section.length > 0);

  return html`
    <span id="settings-toggle-bar" class="settings-toggle-bar">
      ${sections.map(
        (section, i) =>
          html`${i > 0 ? html`<span class="settings-toggle-divider"></span>` : ''}${section}`
      )}
    </span>
  `;
}

// Re-sync every item's active class, disabled state, and badge from live state,
// without re-rendering — so hotkey/edit-driven changes stay reflected.
export function refreshSettingsBar() {
  barItems.forEach((item) => {
    const el = document.getElementById(item.id) as HTMLButtonElement | null;
    if (!el) return;
    if (item.isActive) el.classList.toggle('active', item.isActive());
    if (item.isDisabled) el.disabled = item.isDisabled();
    updateButtonBadge(el, item.badge);
  });
}

// Any pair edit (input, crop drag, chart point, undo/redo) fires the history
// event; externally-toggled bar state (e.g. the crop preview modal closing on
// click-outside) fires the bar-refresh event. Both resync the bar. Guarded for
// the DOM-less test environment.
if (typeof document !== 'undefined') {
  document.addEventListener(MARKER_PAIR_HISTORY_CHANGED_EVENT, refreshSettingsBar);
  document.addEventListener(SETTINGS_BAR_REFRESH_EVENT, refreshSettingsBar);
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
