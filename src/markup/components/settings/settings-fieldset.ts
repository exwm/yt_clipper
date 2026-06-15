import { html, nothing, TemplateResult } from 'lit-html';
import { styleMap } from 'lit-html/directives/style-map.js';

export type SettingsVariant = 'global' | 'marker';

export interface SettingsFieldsetProps {
  id?: string;
  legend: string | TemplateResult;
  variant: SettingsVariant;
  display?: 'block' | 'inline' | 'inline-block' | 'flex' | 'none';
  // Extra class on the <legend>, e.g. to opt a legend into the toggle-bar layout.
  legendClassExtra?: string;
  children: TemplateResult;
}

export function SettingsFieldset(p: SettingsFieldsetProps): TemplateResult {
  const prefix = p.variant === 'global' ? 'global-settings-editor' : 'marker-pair-settings-editor';
  const panelClass = `settings-editor-panel ${prefix} ${prefix}-highlighted-div`;
  const legendClass = `${prefix}-highlighted-label${
    p.legendClassExtra ? ` ${p.legendClassExtra}` : ''
  }`;
  return html`
    <fieldset
      id=${p.id ?? nothing}
      class=${panelClass}
      style=${p.display ? styleMap({ display: p.display }) : nothing}
    >
      <legend class=${legendClass}>${p.legend}</legend>
      ${p.children}
    </fieldset>
  `;
}
