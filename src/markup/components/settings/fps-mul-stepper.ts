import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export interface FpsMulStepperProps {
  id: string;
  label: string;
  labelId?: string;
  value: number | string | null | undefined;
  tooltip?: string;
  suffixSpanId?: string;
  suffixText?: string;
  onChange?: (e: Event) => void;
}

export function FpsMulStepper(p: FpsMulStepperProps): TemplateResult {
  return html`
    <div class="settings-editor-input-div">
      <div title=${p.tooltip ?? nothing}>
        <span id=${p.labelId ?? nothing}>${p.label}</span>
        <div class="fps-mul-stepper">
          <button class="fps-mul-step-btn" data-step="-1">−1</button>
          <input
            id=${p.id}
            class="fps-mul-input"
            type="number"
            min="0"
            max="5"
            step="0.05"
            placeholder="0"
            .value=${p.value ?? ''}
            @change=${p.onChange ?? nothing}
            ${ref(gateHotkeys)}
          />
          <button class="fps-mul-step-btn" data-step="+1">+1</button>
          <span id=${p.suffixSpanId ?? nothing} class="fps-mul-suffix">
            ${p.suffixText ?? ''}
          </span>
        </div>
      </div>
    </div>
  `;
}
