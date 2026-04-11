import { ShortcutRegistry } from './registry';
import { ShortcutDefinition } from './types';

const SEPARATOR_RE = /(\s*\+\s*|\s*\/\s*|\s*,\s*|\s+or\s+)/g;

export function renderShortcutsTable(registry: ShortcutRegistry): string {
  const grouped = registry.getGrouped();
  const parts: string[] = [];
  for (const [section, categories] of grouped) {
    parts.push(`<h2>${escapeHtml(section)}</h2>`);
    for (const [category, shortcuts] of categories) {
      parts.push(renderCategoryTable(category, shortcuts));
    }
  }
  return parts.join('\n');
}

function renderCategoryTable(category: string, shortcuts: ShortcutDefinition[]): string {
  const rows = shortcuts.map(renderRow).join('\n');
  return [
    '<table>',
    '  <thead>',
    '    <tr>',
    `      <th colspan="2">${escapeHtml(category)}</th>`,
    '    </tr>',
    '    <tr>',
    '      <th>Action</th>',
    '      <th>Shortcut</th>',
    '    </tr>',
    '  </thead>',
    '  <tbody>',
    rows,
    '  </tbody>',
    '</table>',
  ].join('\n');
}

function renderRow(def: ShortcutDefinition): string {
  const rowClass = def.essential ? ' class="essential-row"' : '';
  const shortcutCell = def.displayNote
    ? `<pre>${escapeHtml(def.displayNote)}</pre>`
    : renderDisplayKey(def.displayKey);
  return [
    `    <tr${rowClass}>`,
    `      <td>${escapeHtml(def.description)}</td>`,
    `      <td>${shortcutCell}</td>`,
    `    </tr>`,
  ].join('\n');
}

export function renderDisplayKey(displayKey: string): string {
  if (displayKey === '') return '';
  const parts = displayKey.split(SEPARATOR_RE);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return escapeHtml(part);
      if (part === '') return '';
      return `<kbd>${escapeHtml(part)}</kbd>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
