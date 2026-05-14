/** @jest-environment jsdom */
import { render } from 'lit-html';
import { ShortcutRegistry } from './registry';
import { renderDisplayKey, renderShortcutsTable } from './static-table';
import { ShortcutDefinition } from './types';

function makeDef(partial: Partial<ShortcutDefinition> & { id: string }): ShortcutDefinition {
  return {
    description: partial.description ?? `desc-${partial.id}`,
    displayKey: partial.displayKey ?? '',
    section: partial.section ?? 'Markup',
    category: partial.category ?? 'Marker Shortcuts',
    essential: partial.essential ?? false,
    binding: partial.binding ?? null,
    handler: partial.handler ?? null,
    executable: partial.executable ?? true,
    ...partial,
  };
}

function renderToString(
  template: ReturnType<typeof renderShortcutsTable> | ReturnType<typeof renderDisplayKey>
): string {
  const div = document.createElement('div');
  render(template, div);
  return div.innerHTML;
}

describe('renderDisplayKey', () => {
  test('single key', () => {
    expect(renderToString(renderDisplayKey('A'))).toBe('<kbd>A</kbd>');
  });

  test('compound key with plus', () => {
    expect(renderToString(renderDisplayKey('Ctrl + X'))).toBe('<kbd>Ctrl</kbd> + <kbd>X</kbd>');
  });

  test('three-modifier compound', () => {
    expect(renderToString(renderDisplayKey('Ctrl + Alt + Shift + Z'))).toBe(
      '<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd>'
    );
  });

  test('alternatives with spaced slash', () => {
    expect(renderToString(renderDisplayKey('Z / Shift + Z'))).toBe(
      '<kbd>Z</kbd> / <kbd>Shift</kbd> + <kbd>Z</kbd>'
    );
  });

  test('alternatives with unspaced slash', () => {
    expect(renderToString(renderDisplayKey('Shift + Q/A'))).toBe(
      '<kbd>Shift</kbd> + <kbd>Q</kbd>/<kbd>A</kbd>'
    );
  });

  test('escapes angle brackets', () => {
    expect(renderToString(renderDisplayKey('< / >'))).toBe('<kbd>&lt;</kbd> / <kbd>&gt;</kbd>');
  });

  test('"or" connector', () => {
    expect(renderToString(renderDisplayKey('< / > or Shift + Mousewheel'))).toBe(
      '<kbd>&lt;</kbd> / <kbd>&gt;</kbd> or <kbd>Shift</kbd> + <kbd>Mousewheel</kbd>'
    );
  });

  test('multi-word token kept together', () => {
    expect(renderToString(renderDisplayKey('Alt + Mousewheel Down'))).toBe(
      '<kbd>Alt</kbd> + <kbd>Mousewheel Down</kbd>'
    );
  });

  test('empty string returns empty', () => {
    expect(renderToString(renderDisplayKey(''))).toBe('');
  });
});

describe('renderShortcutsTable', () => {
  test('empty registry produces empty string', () => {
    const reg = new ShortcutRegistry();
    expect(renderToString(renderShortcutsTable(reg))).toBe('');
  });

  test('emits section h2 and category table', () => {
    const reg = new ShortcutRegistry();
    reg.register(
      makeDef({
        id: 'a',
        description: 'Add marker',
        displayKey: 'A',
        section: 'Markup',
        category: 'Marker Shortcuts',
        essential: true,
      })
    );
    const html = renderToString(renderShortcutsTable(reg));
    expect(html).toContain('<h2>Markup</h2>');
    expect(html).toContain('<th colspan="2">Marker Shortcuts</th>');
    expect(html).toContain('<tr class="essential-row">');
    expect(html).toContain('<td>Add marker</td>');
    expect(html).toContain('<kbd>A</kbd>');
  });

  test('non-essential row has no class', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'a', description: 'Foo', displayKey: 'A', essential: false }));
    const html = renderToString(renderShortcutsTable(reg));
    expect(html).not.toContain('class="essential-row"');
    expect(html).toContain('<tr>');
  });

  test('displayNote renders as pre', () => {
    const reg = new ShortcutRegistry();
    reg.register(
      makeDef({
        id: 'a',
        description: 'Adjust crop',
        displayNote: 'Place cursor on target value',
      })
    );
    const html = renderToString(renderShortcutsTable(reg));
    expect(html).toContain('<pre>Place cursor on target value</pre>');
  });

  test('groups by section then category in insertion order', () => {
    const reg = new ShortcutRegistry();
    reg.registerAll([
      makeDef({ id: 'a', section: 'Markup', category: 'Marker Shortcuts' }),
      makeDef({ id: 'b', section: 'Markup', category: 'Cropping Shortcuts' }),
      makeDef({ id: 'c', section: 'Dynamic Effects', category: 'Chart Shortcuts' }),
    ]);
    const html = renderToString(renderShortcutsTable(reg));
    const basicIdx = html.indexOf('<h2>Markup</h2>');
    const advancedIdx = html.indexOf('<h2>Dynamic Effects</h2>');
    const markerIdx = html.indexOf('Marker Shortcuts');
    const cropIdx = html.indexOf('Cropping Shortcuts');
    const chartIdx = html.indexOf('Chart Shortcuts');
    expect(basicIdx).toBeGreaterThanOrEqual(0);
    expect(advancedIdx).toBeGreaterThan(basicIdx);
    expect(markerIdx).toBeGreaterThan(basicIdx);
    expect(cropIdx).toBeGreaterThan(markerIdx);
    expect(chartIdx).toBeGreaterThan(advancedIdx);
  });

  test('escapes special chars in description', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'a', description: 'Rotate 90<deg>' }));
    const html = renderToString(renderShortcutsTable(reg));
    expect(html).toContain('Rotate 90&lt;deg&gt;');
  });
});
