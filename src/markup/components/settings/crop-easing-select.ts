import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export type CropEasingMode = 'smoothInOut' | 'smoothTrack' | 'cinematic';
export type CropEasingValue = CropEasingMode | null | undefined;

// Human-readable names for the modes, for building the inherited-default option label.
export const cropEasingModeLabels: Record<CropEasingMode, string> = {
  smoothTrack: 'Smooth Track',
  cinematic: 'Cinematic',
  smoothInOut: 'EaseInOut',
};

export interface CropEasingSelectProps {
  id: string;
  label: string;
  tooltip?: string;
  value: CropEasingValue;
  // Shown on the Default option, e.g. the inherited global value for a marker pair, parenthesized.
  defaultOptionLabel?: string;
  // Optional content rendered on the same line as the label (e.g. the cinematic settings gear).
  labelSuffix?: TemplateResult;
  onChange?: (e: Event) => void;
}

// The Crop Easing select. Tooltips.cropPointEasingTooltip describes each mode.
export function CropEasingSelect(p: CropEasingSelectProps): TemplateResult {
  const v = p.value;
  const labelSpan = html`<span>${p.label}</span>`;
  return html`
    <div class="settings-editor-input-div" title=${p.tooltip ?? nothing}>
      ${p.labelSuffix
        ? html`<span class="text-input-label-row">${labelSpan}${p.labelSuffix}</span>`
        : labelSpan}
      <select id=${p.id} @change=${p.onChange ?? nothing} ${ref(gateHotkeys)}>
        <option value="Default" ?selected=${v == null}>${p.defaultOptionLabel ?? 'Default'}</option>
        <option value="smoothTrack" ?selected=${v === 'smoothTrack'}>Smooth Track</option>
        <option value="cinematic" ?selected=${v === 'cinematic'}>Cinematic</option>
        <option value="smoothInOut" ?selected=${v === 'smoothInOut'}>EaseInOut</option>
      </select>
    </div>
  `;
}
