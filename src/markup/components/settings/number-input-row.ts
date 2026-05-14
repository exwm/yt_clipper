import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { styleMap, StyleInfo } from 'lit-html/directives/style-map.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export interface NumberInputRowProps {
  id: string;
  label: string;
  labelId?: string;
  value: number | string | null | undefined;
  tooltip?: string;
  min?: number;
  max?: number | string;
  step?: number | string;
  placeholder?: string;
  styleInfo?: Readonly<StyleInfo>;
  required?: boolean;
  compact?: boolean;
  onChange?: (e: Event) => void;
}

export function NumberInputRow(p: NumberInputRowProps): TemplateResult {
  const wrapperClass = p.compact ? nothing : 'settings-editor-input-div';
  return html`
    <div class=${wrapperClass} title=${p.tooltip ?? nothing}>
      <span id=${p.labelId ?? nothing}>${p.label}</span>
      <input
        id=${p.id}
        type="number"
        min=${p.min ?? nothing}
        max=${p.max ?? nothing}
        step=${p.step ?? nothing}
        placeholder=${p.placeholder ?? nothing}
        style=${p.styleInfo ? styleMap(p.styleInfo) : nothing}
        ?required=${p.required ?? false}
        .value=${p.value ?? ''}
        @change=${p.onChange ?? nothing}
        ${ref(gateHotkeys)}
      />
    </div>
  `;
}
