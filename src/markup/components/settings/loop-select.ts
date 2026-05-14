import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export type LoopValue = 'none' | 'fwrev' | 'fade' | null | undefined;

export interface LoopSelectProps {
  id: string;
  label: string;
  tooltip?: string;
  value: LoopValue;
  defaultOptionLabel: string;
  onChange?: (e: Event) => void;
}

export function LoopSelect(p: LoopSelectProps): TemplateResult {
  const v = p.value;
  return html`
    <div title=${p.tooltip ?? nothing}>
      <span>${p.label}</span>
      <select id=${p.id} @change=${p.onChange ?? nothing} ${ref(gateHotkeys)}>
        <option value="Default" ?selected=${v == null}>${p.defaultOptionLabel}</option>
        <option ?selected=${v === 'none'}>none</option>
        <option ?selected=${v === 'fwrev'}>fwrev</option>
        <option ?selected=${v === 'fade'}>fade</option>
      </select>
    </div>
  `;
}
