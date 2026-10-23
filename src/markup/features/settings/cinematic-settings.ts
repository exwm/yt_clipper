import { html, TemplateResult } from 'lit-html';
import { NumberInputRow } from '../../components/settings/number-input-row';
import { getCropComponents } from '../../crop-utils';
import { Tooltips } from '../../ui/tooltips';
import { BoundInput } from './settings-editor';

// Convenience buttons that fill in both margins (percent of the crop size). Only the margins are saved.
export const CINEMATIC_STRENGTH_PRESETS = [
  { name: 'Weak', margin: 6, zoomMargin: 4 },
  { name: 'Medium', margin: 12, zoomMargin: 8 },
  { name: 'Strong', margin: 20, zoomMargin: 15 },
] as const;

const CUSTOM = 'Custom';

// The margins last typed by hand per editor (the global settings, or a marker pair), so Custom can
// restore them after a preset click. Kept for the page session only.
const customMargins = new Map<string, { margin: string; zoomMargin: string }>();

export interface CinematicSettingsProps {
  // Names the editor for Custom's memory: 'global', or the marker pair.
  editorKey: string;
  marginInput: BoundInput;
  zoomMarginInput: BoundInput;
  margin: number | undefined;
  zoomMargin: number | undefined;
  // The values an empty input inherits, shown as its placeholder.
  inheritedMargin: number;
  inheritedZoomMargin: number;
  // The crops the margin applies to, for the pixel hint.
  crops: () => readonly string[];
}

let applyingPreset = false;

function inputValue(input: HTMLInputElement): number {
  return Number(input.value !== '' ? input.value : input.placeholder);
}

function activeStrength(margin: number, zoomMargin: number): string {
  const preset = CINEMATIC_STRENGTH_PRESETS.find((p) => p.margin === margin && p.zoomMargin === zoomMargin);
  return preset?.name ?? CUSTOM;
}

// The margin in cropRes px: a share of each crop's shorter side, as the solver applies it.
function marginPxHint(marginPercent: number, crops: readonly string[]): string {
  const sides = crops.map((crop) => {
    const [, , w, h] = getCropComponents(crop);
    return Math.min(w, h);
  });
  if (sides.length === 0 || !Number.isFinite(marginPercent)) return '';
  const lo = Math.round((Math.min(...sides) * marginPercent) / 100);
  const hi = Math.round((Math.max(...sides) * marginPercent) / 100);
  return lo === hi ? `≈ ${lo} px` : `≈ ${lo}-${hi} px`;
}

function refresh(popover: HTMLElement, p: CinematicSettingsProps): void {
  const marginEl = popover.querySelector<HTMLInputElement>(`#${p.marginInput.id}`);
  const zoomEl = popover.querySelector<HTMLInputElement>(`#${p.zoomMarginInput.id}`);
  if (!marginEl || !zoomEl) return;
  const active = activeStrength(inputValue(marginEl), inputValue(zoomEl));
  popover.querySelectorAll<HTMLButtonElement>('[data-cinematic-strength]').forEach((button) => {
    button.classList.toggle('active', button.dataset.cinematicStrength === active);
    if (button.dataset.cinematicStrength === CUSTOM) button.disabled = !customMargins.has(p.editorKey);
  });
  const hint = popover.querySelector('.ytc-cinematic-margin-px');
  if (hint) hint.textContent = marginPxHint(inputValue(marginEl), p.crops());
}

// Sets both inputs through their own change handlers, so a preset saves and recomputes as typing does.
function applyMargins(button: HTMLElement, p: CinematicSettingsProps, margin: string, zoomMargin: string): void {
  const popover = button.closest<HTMLElement>('.ytc-settings-popover');
  if (!popover) return;
  applyingPreset = true;
  try {
    for (const [id, value] of [
      [p.marginInput.id, margin],
      [p.zoomMarginInput.id, zoomMargin],
    ]) {
      const input = popover.querySelector<HTMLInputElement>(`#${id}`);
      if (input && input.value !== value) {
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
      customMargins.set(p.editorKey, { margin: value(p.marginInput.id), zoomMargin: value(p.zoomMarginInput.id) });
    }
    refresh(popover, p);
  };
}

const strengthButtons = (p: CinematicSettingsProps, active: string) => html`
  <div class="ytc-cinematic-strength" role="group" aria-label="Cinematic strength">
    ${CINEMATIC_STRENGTH_PRESETS.map(
      (preset) => html`<button
        type="button"
        class="settings-toggle ytc-cinematic-strength-button ${active === preset.name ? 'active' : ''}"
        data-cinematic-strength=${preset.name}
        @click=${(e: Event) =>
          applyMargins(e.currentTarget as HTMLElement, p, String(preset.margin), String(preset.zoomMargin))}
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
        if (custom) applyMargins(e.currentTarget as HTMLElement, p, custom.margin, custom.zoomMargin);
      }}
    >
      ${CUSTOM}
    </button>
  </div>
`;

// The Cinematic gear popover's controls: strength presets, then the two margins in percent of the crop.
export function CinematicSettings(p: CinematicSettingsProps): TemplateResult {
  const margin = p.margin ?? p.inheritedMargin;
  const zoomMargin = p.zoomMargin ?? p.inheritedZoomMargin;
  return html`
    ${strengthButtons(p, activeStrength(margin, zoomMargin))}
    ${NumberInputRow({
      ...p.marginInput,
      onChange: onInputChange(p.marginInput, p),
      label: 'Margin (%)',
      value: p.margin ?? '',
      placeholder: String(p.inheritedMargin),
      min: 0,
      max: 50,
      step: 1,
      tooltip: Tooltips.cinematicMarginTooltip,
      compact: true,
    })}
    <div class="ytc-cinematic-margin-px">${marginPxHint(margin, p.crops())}</div>
    ${NumberInputRow({
      ...p.zoomMarginInput,
      onChange: onInputChange(p.zoomMarginInput, p),
      label: 'Zoom Margin (%)',
      value: p.zoomMargin ?? '',
      placeholder: String(p.inheritedZoomMargin),
      min: 0,
      max: 100,
      step: 1,
      tooltip: Tooltips.cinematicZoomMarginTooltip,
      compact: true,
    })}
  `;
}
