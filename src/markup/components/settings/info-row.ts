import { html, nothing, TemplateResult } from 'lit-html';

export interface InfoRowProps {
  tooltip?: string;
  label: string;
  valueId?: string;
  value: string | number | TemplateResult;
  breakBeforeValue?: boolean;
}

export function InfoRow(p: InfoRowProps): TemplateResult {
  return html`
    <div class="settings-editor-input-div settings-info-display" title=${p.tooltip ?? nothing}>
      <span>${p.label}</span>
      ${p.breakBeforeValue ? html`<br />` : nothing}
      <span id=${p.valueId ?? nothing}>${p.value}</span>
    </div>
  `;
}
