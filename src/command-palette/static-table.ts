import { html, nothing, TemplateResult } from 'lit-html';
import { ShortcutRegistry } from './registry';
import { ShortcutDefinition } from './types';

const SEPARATOR_RE = /(\s*\+\s*|\s*\/\s*|\s*,\s*|\s+or\s+)/g;

export function renderShortcutsTable(registry: ShortcutRegistry): TemplateResult {
  const sections: TemplateResult[] = [];
  for (const [section, categories] of registry.getGrouped()) {
    const tables: TemplateResult[] = [];
    for (const [category, shortcuts] of categories) {
      tables.push(renderCategoryTable(category, shortcuts));
    }
    sections.push(
      html`<h2>${section}</h2>
        ${tables}`
    );
  }
  return html`${sections}`;
}

function renderCategoryTable(category: string, shortcuts: ShortcutDefinition[]): TemplateResult {
  return html`
    <table>
      <thead>
        <tr>
          <th colspan="2">${category}</th>
        </tr>
        <tr>
          <th>Action</th>
          <th>Shortcut</th>
        </tr>
      </thead>
      <tbody>
        ${shortcuts.map(renderRow)}
      </tbody>
    </table>
  `;
}

function renderRow(def: ShortcutDefinition): TemplateResult {
  const shortcutCell = def.displayNote
    ? html`<pre>${def.displayNote}</pre>`
    : renderDisplayKey(def.displayKey);
  return def.essential
    ? html`<tr class="essential-row">
        <td>${def.description}</td>
        <td>${shortcutCell}</td>
      </tr>`
    : html`<tr>
        <td>${def.description}</td>
        <td>${shortcutCell}</td>
      </tr>`;
}

export function renderDisplayKey(displayKey: string): TemplateResult | typeof nothing {
  if (displayKey === '') return nothing;
  const parts = displayKey.split(SEPARATOR_RE);
  const nodes = parts.map((part, idx) => {
    if (idx % 2 === 1) return part;
    if (part === '') return nothing;
    return html`<kbd>${part}</kbd>`;
  });
  return html`${nodes}`;
}
