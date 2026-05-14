import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { styleMap, StyleInfo } from 'lit-html/directives/style-map.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

export interface TextInputRowProps {
  id: string;
  label: string;
  labelId?: string;
  value: string | null | undefined;
  tooltip?: string;
  pattern?: string;
  placeholder?: string;
  styleInfo?: Readonly<StyleInfo>;
  required?: boolean;
  list?: string;
  listChildren?: TemplateResult;
  onChange?: (e: Event) => void;
}

export function TextInputRow(p: TextInputRowProps): TemplateResult {
  return html`
    <div class="settings-editor-input-div" title=${p.tooltip ?? nothing}>
      <span id=${p.labelId ?? nothing}>${p.label}</span>
      <input
        id=${p.id}
        pattern=${p.pattern ?? nothing}
        placeholder=${p.placeholder ?? nothing}
        style=${p.styleInfo ? styleMap(p.styleInfo) : nothing}
        list=${p.list ?? nothing}
        ?required=${p.required ?? false}
        .value=${p.value ?? ''}
        @change=${p.onChange ?? nothing}
        ${ref(gateHotkeys)}
      />
      ${p.listChildren ?? nothing}
    </div>
  `;
}
