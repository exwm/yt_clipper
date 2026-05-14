import { html, nothing, TemplateResult } from 'lit-html';
import { styleMap } from 'lit-html/directives/style-map.js';

export interface SettingsRowProps {
  tooltip?: string;
  extraClass?: string;
  display?: 'block' | 'inline' | 'inline-block' | 'flex' | 'none';
  children: TemplateResult;
}

export function SettingsRow(p: SettingsRowProps): TemplateResult {
  const cls = p.extraClass
    ? `settings-editor-input-div ${p.extraClass}`
    : 'settings-editor-input-div';
  return html`
    <div
      class=${cls}
      title=${p.tooltip ?? nothing}
      style=${p.display ? styleMap({ display: p.display }) : nothing}
    >
      ${p.children}
    </div>
  `;
}
