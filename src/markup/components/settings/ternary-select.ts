import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export interface TernarySelectProps {
  id: string;
  label: string;
  tooltip?: string;
  value: boolean | null | undefined;
  defaultOptionLabel: string;
  compact?: boolean;
  onChange?: (e: Event) => void;
}

export function TernarySelect(p: TernarySelectProps): TemplateResult {
  const v = p.value;
  const wrapperClass = p.compact ? nothing : 'settings-editor-input-div';
  return html`
    <div class=${wrapperClass} title=${p.tooltip ?? nothing}>
      <span>${p.label}</span>
      <select id=${p.id} @change=${p.onChange ?? nothing} ${ref(gateHotkeys)}>
        <option value="Default" ?selected=${v == null}>${p.defaultOptionLabel}</option>
        <option ?selected=${v === false}>Disabled</option>
        <option ?selected=${v === true}>Enabled</option>
      </select>
    </div>
  `;
}
