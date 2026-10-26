import { html, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { CropEasingMode, cropEasingModeLabels } from '../../components/settings/crop-easing-select';
import { NumberInputRow } from '../../components/settings/number-input-row';
import { getCropComponents } from '../../crop-utils';
import { CinematicHolds } from '../../crop/cinematic-path';
import { CINEMATIC_PATH_SOLVED_EVENT } from '../../crop/cinematic-path-plot';
import { Tooltips } from '../../ui/tooltips';
import {
  CinematicPathPlot,
  CinematicPathPlotProps,
  redrawCinematicPathPlot,
} from './cinematic-path-plot';
import { BoundInput, gateHotkeys } from './settings-editor';

// Convenience buttons that fill in both margins (percent of the crop size). Only the margins are saved.
export const CINEMATIC_STRENGTH_PRESETS = [
  { name: 'Weak', margin: 6, zoomMargin: 4 },
  { name: 'Medium', margin: 12, zoomMargin: 8 },
  { name: 'Strong', margin: 20, zoomMargin: 15 },
] as const;

const CUSTOM = 'Custom';

// The margins last set by hand per editor, so Custom can restore them after a preset click. Keyed
// by what the editor edits, so the memory follows a marker pair that moves and goes with one deleted.
const customMargins = new WeakMap<object, { margin: string; zoomMargin: string }>();

export interface CinematicSettingsProps {
  // What the editor edits, for Custom's memory: the global settings, or the marker pair.
  editorKey: object;
  marginInput: BoundInput;
  zoomMarginInput: BoundInput;
  margin: number | undefined;
  zoomMargin: number | undefined;
  // The values an empty input inherits, shown as its placeholder.
  inheritedMargin: number;
  inheritedZoomMargin: number;
  // The crops the margin applies to, for the pixel hint.
  crops: () => readonly string[];
  // The marker pair's path plot. The global settings have no crop points to plot.
  plot?: CinematicPathPlotProps;
  // The editor's Crop Easing select, which the easing buttons switch.
  easingSelectId: string;
  activeEasing: () => CropEasingMode;
  // The easing a marker pair inherits. The global settings inherit none.
  inheritedEasing?: CropEasingMode;
  holdsInput: BoundInput;
  holds: CinematicHolds | undefined;
  inheritedHolds: CinematicHolds;
}

const holdsLabels: Record<CinematicHolds, string> = {
  loose: 'Loose',
  firm: 'Firm',
  exact: 'Exact',
};
// One expression, so the formatter keeps the option's text off lines of its own, which would put
// their line breaks and indent into the label.
const inheritedHoldsLabel = (p: { inheritedHolds: CinematicHolds }) =>
  `(${holdsLabels[p.inheritedHolds]})`;

function onHoldsChange(p: CinematicSettingsProps) {
  return (e: Event) => {
    p.holdsInput.onChange(e);
    const popover = (e.currentTarget as HTMLElement).closest<HTMLElement>('.ytc-settings-popover');
    if (popover) refresh(popover, p);
  };
}

const holdsSelect = (p: CinematicSettingsProps) => html`
  <div class="ytc-cinematic-holds" title=${Tooltips.cinematicHoldsTooltip}>
    <span>Hold Points</span>
    <select id=${p.holdsInput.id} @change=${onHoldsChange(p)} ${ref(gateHotkeys)}>
      <option value="Default" ?selected=${p.holds == null}>${inheritedHoldsLabel(p)}</option>
      ${(['loose', 'firm', 'exact'] as const).map(
        (holds) =>
          html`<option value=${holds} ?selected=${p.holds === holds}>${holdsLabels[holds]}</option>`
      )}
    </select>
  </div>
`;

// The easings to compare, as the Crop Easing select lists them.
const COMPARED_EASINGS = ['smoothTrack', 'cinematic', 'smoothInOut'] as const;

// The props of each open popover's controls, so a change made outside it can refresh it.
const shownSettings = new WeakMap<Element, CinematicSettingsProps>();

function forEachShownSettings(
  update: (popover: HTMLElement, p: CinematicSettingsProps) => void
): void {
  document.querySelectorAll('.ytc-cinematic-easing').forEach((group) => {
    const popover = group.closest<HTMLElement>('.ytc-settings-popover');
    const p = shownSettings.get(group);
    if (popover && p) update(popover, p);
  });
}

// Shows a Crop Easing chosen in the editor's own select in an open popover.
export function refreshCinematicSettings(): void {
  forEachShownSettings(refresh);
}

// A solve follows a crop change, such as an undo with a hotkey, so the pixel hints follow it too. The
// plot redraws itself on the same event.
if (typeof document !== 'undefined') {
  document.addEventListener(CINEMATIC_PATH_SOLVED_EVENT, () =>
    forEachShownSettings(refreshControls)
  );
}

let applyingPreset = false;

function inputValue(input: HTMLInputElement): number {
  return Number(input.value !== '' ? input.value : input.placeholder);
}

function activeStrength(margin: number, zoomMargin: number): string {
  const preset = CINEMATIC_STRENGTH_PRESETS.find(
    (p) => p.margin === margin && p.zoomMargin === zoomMargin
  );
  return preset?.name ?? CUSTOM;
}

// The margin in cropRes px, as the solver applies it: the position margin is a share of each crop's
// shorter side, and the zoom margin a share of its width, either way.
function marginPxHint(marginPercent: number, crops: readonly string[], zoom: boolean): string {
  const sides = crops.map((crop) => {
    const [, , w, h] = getCropComponents(crop);
    return zoom ? w : Math.min(w, h);
  });
  if (sides.length === 0 || !Number.isFinite(marginPercent)) return '';
  const lo = Math.round((Math.min(...sides) * marginPercent) / 100);
  const hi = Math.round((Math.max(...sides) * marginPercent) / 100);
  const px = lo === hi ? `${lo}` : `${lo}-${hi}`;
  return zoom ? `≈ ±${px} px width` : `≈ ${px} px`;
}

function refresh(popover: HTMLElement, p: CinematicSettingsProps): void {
  refreshControls(popover, p);
  redrawCinematicPathPlot(popover);
}

// Everything but the plot: the strength and easing highlights, the sliders and the pixel hints.
function refreshControls(popover: HTMLElement, p: CinematicSettingsProps): void {
  const marginEl = popover.querySelector<HTMLInputElement>(`#${p.marginInput.id}`);
  const zoomEl = popover.querySelector<HTMLInputElement>(`#${p.zoomMarginInput.id}`);
  if (!marginEl || !zoomEl) return;
  const active = activeStrength(inputValue(marginEl), inputValue(zoomEl));
  popover.querySelectorAll<HTMLButtonElement>('[data-cinematic-strength]').forEach((button) => {
    button.classList.toggle('active', button.dataset.cinematicStrength === active);
    if (button.dataset.cinematicStrength === CUSTOM)
      button.disabled = !customMargins.has(p.editorKey);
  });
  popover.querySelectorAll<HTMLButtonElement>('[data-crop-easing]').forEach((button) => {
    button.classList.toggle('active', button.dataset.cropEasing === p.activeEasing());
  });
  for (const input of [marginEl, zoomEl]) {
    const slider = popover.querySelector<HTMLInputElement>(`#${input.id}-slider`);
    if (slider) slider.value = String(inputValue(input));
    const hint = popover.querySelector(`#${input.id}-px`);
    if (hint) hint.textContent = marginPxHint(inputValue(input), p.crops(), input === zoomEl);
  }
}

function inheritedValue(input: HTMLInputElement, p: CinematicSettingsProps): number {
  return input.id === p.zoomMarginInput.id ? p.inheritedZoomMargin : p.inheritedMargin;
}

// A value equal to the inherited one is cleared, so the setting keeps following the global setting
// (or the default) instead of pinning a copy of it.
function valueToSet(input: HTMLInputElement, p: CinematicSettingsProps, value: string): string {
  return value !== '' && Number(value) === inheritedValue(input, p) ? '' : value;
}

// Sets both inputs through their own change handlers, so a preset saves and recomputes as typing does.
function applyMargins(
  button: HTMLElement,
  p: CinematicSettingsProps,
  margin: string,
  zoomMargin: string
): void {
  const popover = button.closest<HTMLElement>('.ytc-settings-popover');
  if (!popover) return;
  applyingPreset = true;
  try {
    for (const [id, presetValue] of [
      [p.marginInput.id, margin],
      [p.zoomMarginInput.id, zoomMargin],
    ]) {
      const input = popover.querySelector<HTMLInputElement>(`#${id}`);
      const value = input && valueToSet(input, p, presetValue);
      if (input && value != null && input.value !== value) {
        input.value = value;
        input.dispatchEvent(new Event('change'));
      }
    }
  } finally {
    applyingPreset = false;
  }
  refresh(popover, p);
}

function onInputChange(bound: BoundInput, p: CinematicSettingsProps) {
  return (e: Event) => {
    bound.onChange(e);
    const popover = (e.currentTarget as HTMLElement).closest<HTMLElement>('.ytc-settings-popover');
    if (!popover) return;
    if (!applyingPreset) {
      const value = (id: string) => popover.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '';
      customMargins.set(p.editorKey, {
        margin: value(p.marginInput.id),
        zoomMargin: value(p.zoomMarginInput.id),
      });
    }
    refresh(popover, p);
  };
}

// While dragging, shows the margin without saving it, so the path is solved once, on release.
function previewMarginSlider(slider: HTMLInputElement, p: CinematicSettingsProps): void {
  const popover = slider.closest<HTMLElement>('.ytc-settings-popover');
  const input = popover?.querySelector<HTMLInputElement>(`#${slider.id.replace(/-slider$/, '')}`);
  if (!popover || !input) return;
  input.value = slider.value;
  const zoom = input.id === p.zoomMarginInput.id;
  const hint = popover.querySelector(`#${input.id}-px`);
  if (hint) hint.textContent = marginPxHint(Number(slider.value), p.crops(), zoom);
  const share = Number(slider.value) / 100;
  redrawCinematicPathPlot(popover, zoom ? { zoom: share } : { pos: share });
}

// On release, saves the margin as typing it does.
function commitMarginSlider(slider: HTMLInputElement, p: CinematicSettingsProps): void {
  const popover = slider.closest('.ytc-settings-popover');
  const input = popover?.querySelector<HTMLInputElement>(`#${slider.id.replace(/-slider$/, '')}`);
  if (!input) return;
  input.value = valueToSet(input, p, slider.value);
  input.dispatchEvent(new Event('change'));
}

const marginSlider = (
  p: CinematicSettingsProps,
  bound: BoundInput,
  label: string,
  max: number,
  value: number
) => html`
  <input
    type="range"
    id=${`${bound.id}-slider`}
    class="ytc-cinematic-margin-slider"
    min="0"
    max=${max}
    step="1"
    .value=${String(value)}
    aria-label=${label}
    @input=${(e: Event) => previewMarginSlider(e.currentTarget as HTMLInputElement, p)}
    @change=${(e: Event) => commitMarginSlider(e.currentTarget as HTMLInputElement, p)}
  />
  <div id=${`${bound.id}-px`} class="ytc-cinematic-margin-px">
    ${marginPxHint(value, p.crops(), bound.id === p.zoomMarginInput.id)}
  </div>
`;

// Switches the editor's Crop Easing through its select, so it saves as choosing it there does. A
// marker pair switched back to the easing it inherits returns to Default, so it keeps following the
// global setting.
function switchEasing(
  button: HTMLElement,
  p: CinematicSettingsProps,
  easing: CropEasingMode
): void {
  const select = document.getElementById(p.easingSelectId);
  const popover = button.closest<HTMLElement>('.ytc-settings-popover');
  if (!(select instanceof HTMLSelectElement) || !popover || p.activeEasing() === easing) return;
  select.value = easing === p.inheritedEasing ? 'Default' : easing;
  select.dispatchEvent(new Event('change'));
  refresh(popover, p);
}

const easingButtons = (p: CinematicSettingsProps) => html`
  <div
    class="ytc-cinematic-strength ytc-cinematic-easing"
    role="group"
    aria-label="Crop Easing"
    ${ref((el) => {
      if (el) shownSettings.set(el, p);
    })}
  >
    ${COMPARED_EASINGS.map(
      (easing) =>
        html`<button
          type="button"
          class="settings-toggle ytc-cinematic-easing-button ${p.activeEasing() === easing
            ? 'active'
            : ''}"
          data-crop-easing=${easing}
          @click=${(e: Event) => switchEasing(e.currentTarget as HTMLElement, p, easing)}
        >
          ${cropEasingModeLabels[easing]}
        </button>`
    )}
  </div>
`;

const strengthButtons = (p: CinematicSettingsProps, active: string) => html`
  <div class="ytc-cinematic-strength" role="group" aria-label="Cinematic strength">
    ${CINEMATIC_STRENGTH_PRESETS.map(
      (preset) =>
        html`<button
          type="button"
          class="settings-toggle ytc-cinematic-strength-button ${active === preset.name
            ? 'active'
            : ''}"
          data-cinematic-strength=${preset.name}
          @click=${(e: Event) =>
            applyMargins(
              e.currentTarget as HTMLElement,
              p,
              String(preset.margin),
              String(preset.zoomMargin)
            )}
        >
          ${preset.name}
        </button>`
    )}
    <button
      type="button"
      class="settings-toggle ytc-cinematic-strength-button ${active === CUSTOM ? 'active' : ''}"
      data-cinematic-strength=${CUSTOM}
      title=${Tooltips.cinematicCustomStrengthTooltip}
      ?disabled=${!customMargins.has(p.editorKey)}
      @click=${(e: Event) => {
        const custom = customMargins.get(p.editorKey);
        if (custom)
          applyMargins(e.currentTarget as HTMLElement, p, custom.margin, custom.zoomMargin);
      }}
    >
      ${CUSTOM}
    </button>
  </div>
`;

// The Cinematic gear popover's controls: the easings to compare and the path plot, then the
// Cinematic Easing section (strength presets, the two margins in percent of the crop, and holds),
// which the CSS dims while another easing is chosen.
export function CinematicSettings(p: CinematicSettingsProps): TemplateResult {
  const margin = p.margin ?? p.inheritedMargin;
  const zoomMargin = p.zoomMargin ?? p.inheritedZoomMargin;
  return html`
    ${easingButtons(p)}
    ${p.plot
      ? CinematicPathPlot(p.plot)
      : html`<div class="ytc-cinematic-plot-hint">
          Open a marker pair's settings to plot its path.
        </div>`}
    <div class="ytc-cinematic-section-header" title=${Tooltips.cinematicSectionTooltip}>
      Cinematic Easing
    </div>
    ${strengthButtons(p, activeStrength(margin, zoomMargin))}
    ${NumberInputRow({
      ...p.marginInput,
      onChange: onInputChange(p.marginInput, p),
      label: 'Pan Margin (%)',
      value: p.margin ?? '',
      placeholder: String(p.inheritedMargin),
      min: 0,
      max: 50,
      // Any value the markers JSON allows; the arrows still step by 1.
      step: 'any',
      tooltip: Tooltips.cinematicMarginTooltip,
      compact: true,
    })}
    ${marginSlider(p, p.marginInput, 'Pan Margin (%)', 50, margin)}
    ${NumberInputRow({
      ...p.zoomMarginInput,
      onChange: onInputChange(p.zoomMarginInput, p),
      label: 'Zoom Margin (%)',
      value: p.zoomMargin ?? '',
      placeholder: String(p.inheritedZoomMargin),
      min: 0,
      max: 100,
      // Any value the markers JSON allows; the arrows still step by 1.
      step: 'any',
      tooltip: Tooltips.cinematicZoomMarginTooltip,
      compact: true,
    })}
    ${marginSlider(p, p.zoomMarginInput, 'Zoom Margin (%)', 100, zoomMargin)} ${holdsSelect(p)}
  `;
}
