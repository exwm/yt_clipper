import { html, render, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { appState } from '../../appState';
import { hideChart } from '../../charts';
import { InfoRow, NumberInputRow, SettingsFieldset, TextInputRow } from '../../components/settings';
import { EncodeSettingsFieldset } from './encode-settings-fieldset';
import { createCropOverlay, hideCropOverlay, showCropOverlay } from '../../crop-overlay';
import { getCropComponents, getDefaultCropRes } from '../../crop-utils';
import { triggerCropPreviewRedraw } from '../../crop/crop-preview';
import { toggleOffMarkerPairEditor } from './marker-settings-editor';
import { injectYtcWidget } from '../../save-load';
import {
  addCropInputHotkeys,
  createBindings,
  deleteSettingsEditor,
  FieldBinder,
  gateHotkeys,
  highlightModifiedSettings,
  isExtraSettingsEditorEnabled,
  SettingsBinder,
  setCropAspectRatioSpan,
  setCropInput,
} from './settings-editor';
import { Settings } from '../../@types/yt_clipper';
import { Tooltips } from '../../ui/tooltips';
import { assertDefined, toHHMMSSTrimmed } from '../../util/util';

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

function GlobalSettingsEditorTemplate(binder: SettingsBinder<Settings>): TemplateResult {
  const { bind } = binder;
  const settings = appState.settings;
  const cropInputValidation = `\\d+:\\d+:(\\d+|iw):(\\d+|ih)`;
  const [, , w, h] = getCropComponents(settings.newMarkerCrop);
  const cropAspectRatio = (w / h).toFixed(13);
  const numOrRange = `(\\d{1,2})|(\\d{1,2}-\\d{1,2})`;
  const csvRange = `(${numOrRange})*(,(${numOrRange}))*`;
  const csvRangeReq = `(${numOrRange}){1}(,(${numOrRange}))*`;
  const mergeListInputValidation = `^(${csvRange})(;${csvRangeReq})*$`;
  const gte100 = `([1-9]\\d{3}|[1-9]\\d{2})`;
  const cropResInputValidation = `${gte100}x${gte100}`;
  const { cropRes, cropResWidth, cropResHeight } = getDefaultCropRes();
  const cropResX2 = `${cropResWidth * 2}x${cropResHeight * 2}`;
  const markerPairMergelistDurations = getMarkerPairMergeListDurations();
  const encodeDisplay = isExtraSettingsEditorEnabled ? 'block' : 'none';
  const rotate = settings.rotate;

  const rotate0 = bind('rotate-0', 'rotate', 'string');
  const rotate90Clock = bind('rotate-90-clock', 'rotate', 'string');
  const rotate90CounterClock = bind('rotate-90-counterclock', 'rotate', 'string');
  const mergeList = bind('merge-list-input', 'markerPairMergeList', 'string', {
    afterChange: () => {
      const span = document.getElementById('merge-list-durations');
      if (span) span.textContent = getMarkerPairMergeListDurations();
    },
  });

  return html`
    ${SettingsFieldset({
      id: 'new-marker-defaults-inputs',
      variant: 'global',
      legend: 'New Marker Settings',
      children: html`
        ${NumberInputRow({
          ...bind('speed-input', 'newMarkerSpeed', 'number'),
          label: 'Speed',
          value: settings.newMarkerSpeed,
          tooltip: Tooltips.speedTooltip,
          min: 0.05,
          max: 2,
          step: 0.05,
          placeholder: 'speed',
          styleInfo: { width: '7ch' },
        })}
        ${TextInputRow({
          ...bind('crop-input', 'newMarkerCrop', 'string'),
          label: 'Crop',
          value: settings.newMarkerCrop,
          tooltip: Tooltips.cropTooltip,
          pattern: cropInputValidation,
          styleInfo: { width: '21ch' },
          required: true,
        })}
        ${InfoRow({
          label: 'Crop Aspect Ratio',
          valueId: 'crop-aspect-ratio',
          value: cropAspectRatio,
        })}
      `,
    })}
    ${SettingsFieldset({
      id: 'global-marker-settings',
      variant: 'global',
      legend: 'Global Settings',
      children: html`
        ${TextInputRow({
          ...bind('title-suffix-input', 'titleSuffix', 'string'),
          label: 'Title Suffix',
          value: settings.titleSuffix,
          tooltip: Tooltips.titleSuffixTooltip,
          required: true,
        })}
        ${TextInputRow({
          ...bind('crop-res-input', 'cropRes', 'string', { highlightable: false }),
          label: 'Crop Resolution',
          value: settings.cropRes,
          tooltip: Tooltips.cropResolutionTooltip,
          pattern: cropResInputValidation,
          styleInfo: { width: '14ch' },
          required: true,
          list: 'resolutions',
          listChildren: html`
            <datalist id="resolutions" autocomplete="off">
              <option value=${cropRes}></option>
              <option value=${cropResX2}></option>
            </datalist>
          `,
        })}
        <div
          id="global-settings-rotate"
          class="settings-editor-input-div"
          title=${Tooltips.rotateTooltip}
        >
          <span style="display:inline">Rotate: </span>
          <input
            id=${rotate0.id}
            type="radio"
            name="rotate"
            value="0"
            ?checked=${rotate == null || rotate === '0'}
            @change=${rotate0.onChange}
            ${ref(gateHotkeys)}
          />
          <label for="rotate-0">0&#x00B0; </label>
          <input
            id=${rotate90Clock.id}
            type="radio"
            value="clock"
            name="rotate"
            ?checked=${rotate === 'clock'}
            @change=${rotate90Clock.onChange}
            ${ref(gateHotkeys)}
          />
          <label for="rotate-90-clock">90&#x00B0; &#x27F3;</label>
          <input
            id=${rotate90CounterClock.id}
            type="radio"
            value="cclock"
            name="rotate"
            ?checked=${rotate === 'cclock'}
            @change=${rotate90CounterClock.onChange}
            ${ref(gateHotkeys)}
          />
          <label for="rotate-90-counterclock">90&#x00B0; &#x27F2;</label>
        </div>
        <div
          id="merge-list-div"
          class="settings-editor-input-div"
          title=${Tooltips.mergeListTooltip}
        >
          <span style="display:inline">Merge List: </span>
          <input
            id=${mergeList.id}
            pattern=${mergeListInputValidation}
            placeholder="None"
            style="min-width:15em"
            .value=${settings.markerPairMergeList ?? ''}
            @change=${mergeList.onChange}
            ${ref(gateHotkeys)}
          />
        </div>
        <div class="settings-editor-input-div">
          <span style="display:inline">Merge Durations: </span>
          <span id="merge-list-durations" style="display:inline"
            >${markerPairMergelistDurations}</span
          >
        </div>
      `,
    })}
    ${EncodeSettingsFieldset({
      id: 'global-encode-settings',
      variant: 'global',
      display: encodeDisplay,
      source: settings,
      bind: bind as FieldBinder,
    })}
  `;
}

export function createGlobalSettingsEditor() {
  createCropOverlay(appState.settings.newMarkerCrop);
  const globalSettingsEditorDiv = document.createElement('div');
  globalSettingsEditorDiv.setAttribute('id', 'settings-editor-div');

  const binder = createBindings(appState.settings);
  render(GlobalSettingsEditorTemplate(binder), globalSettingsEditorDiv);

  injectYtcWidget(globalSettingsEditorDiv);

  bindFpsMulStepBtns();

  setCropInput(document.getElementById('crop-input') as HTMLInputElement);
  setCropAspectRatioSpan(document.getElementById('crop-aspect-ratio') as HTMLSpanElement);

  appState.wasGlobalSettingsEditorOpen = true;
  appState.isSettingsEditorOpen = true;
  addCropInputHotkeys();
  highlightModifiedSettings(binder.all(), appState.settings);
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
