import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export interface PresetSelectProps {
  id: string;
  label: string;
  tooltip?: string;
  value: string | null | undefined;
  defaultOptionLabel: string;
  options: string[];
  includeDisabledOption?: boolean;
  compact?: boolean;
  onChange?: (e: Event) => void;
}

export function PresetSelect(p: PresetSelectProps): TemplateResult {
  const v = p.value;
  const wrapperClass = p.compact ? nothing : 'settings-editor-input-div';
  return html`
    <div class=${wrapperClass} title=${p.tooltip ?? nothing}>
      <span>${p.label}</span>
      <select id=${p.id} @change=${p.onChange ?? nothing} ${ref(gateHotkeys)}>
        <option value="Inherit" ?selected=${v == null}>${p.defaultOptionLabel}</option>
        ${p.includeDisabledOption
          ? html`<option value="Disabled" ?selected=${v === 'Disabled'}>Disabled</option>`
          : nothing}
        ${p.options.map((opt) => html`<option ?selected=${v === opt}>${opt}</option>`)}
      </select>
    </div>
  `;
}
