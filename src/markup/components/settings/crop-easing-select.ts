import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export type CropEasingMode = 'smoothInOut' | 'smoothTrack';
export type CropEasingValue = CropEasingMode | null | undefined;

// Human-readable names for the modes, for building the inherited-default option label.
export const cropEasingModeLabels: Record<CropEasingMode, string> = {
  smoothTrack: 'Smooth Track',
  smoothInOut: 'EaseInOut',
};

export interface CropEasingSelectProps {
  id: string;
  label: string;
  tooltip?: string;
  value: CropEasingValue;
  // Shown on the Default option, e.g. the inherited global value for a marker pair, parenthesized.
  defaultOptionLabel?: string;
  onChange?: (e: Event) => void;
}

// Picks the curve a dynamic crop follows between its points. Smooth Track flows through points to
// hold a moving subject without overshooting one on a reversal; EaseInOut eases each section in and
// out, coming to rest at every point. Default inherits the global setting.
export function CropEasingSelect(p: CropEasingSelectProps): TemplateResult {
  const v = p.value;
  return html`
    <div class="settings-editor-input-div" title=${p.tooltip ?? nothing}>
      <span>${p.label}</span>
      <select id=${p.id} @change=${p.onChange ?? nothing} ${ref(gateHotkeys)}>
        <option value="Default" ?selected=${v == null}>${p.defaultOptionLabel ?? 'Default'}</option>
        <option value="smoothTrack" ?selected=${v === 'smoothTrack'}>Smooth Track</option>
        <option value="smoothInOut" ?selected=${v === 'smoothInOut'}>EaseInOut</option>
      </select>
    </div>
  `;
}
