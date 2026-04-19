/**
 * @jest-environment jsdom
 */
import { CommandPalette } from './palette-ui';
import { ShortcutRegistry } from './registry';
import { ShortcutDefinition } from './types';

function makeDef(partial: Partial<ShortcutDefinition> & { id: string }): ShortcutDefinition {
  return {
    description: partial.description ?? `desc-${partial.id}`,
    displayKey: partial.displayKey ?? '',
    section: partial.section ?? 'Markup',
    category: partial.category ?? 'General Shortcuts',
    essential: partial.essential ?? false,
    binding: partial.binding ?? null,
    handler: partial.handler ?? null,
    executable: partial.executable ?? true,
    ...partial,
  };
}

function makeRegistry(defs: ShortcutDefinition[]): ShortcutRegistry {
  const reg = new ShortcutRegistry();
  reg.registerAll(defs);
  return reg;
}

function qs<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`selector not found: ${sel}`);
  return el;
}

function qsAll<T extends Element = HTMLElement>(root: ParentNode, sel: string): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

function setupContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

const opened: CommandPalette[] = [];

function makePalette(
  registry: ShortcutRegistry,
  opts: ConstructorParameters<typeof CommandPalette>[1] = {}
): CommandPalette {
  const p = new CommandPalette(registry, opts);
  opened.push(p);
  return p;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
});

afterEach(() => {
  for (const p of opened) {
    try {
      p.close();
    } catch {
      // ignore; some tests close explicitly
    }
  }
  opened.length = 0;
});

describe('CommandPalette — build() chrome structure', () => {
  test('open attaches overlay to container', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    expect(qs(container, '.cmdp-overlay')).toBeTruthy();
    expect(palette.isOpen()).toBe(true);
  });

  test('close removes overlay and unlocks isOpen()', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    palette.close();
    expect(container.querySelector('.cmdp-overlay')).toBeNull();
    expect(palette.isOpen()).toBe(false);
  });

  test('search input is focused and has placeholder', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    expect(search.placeholder).toBe('Search shortcuts...');
    expect(search.type).toBe('text');
    expect(document.activeElement).toBe(search);
  });

  test('clear button starts hidden', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const clear = qs<HTMLButtonElement>(container, '.cmdp-search-clear');
    expect(clear.style.display).toBe('none');
  });

  test('counter shows total count when unfiltered', () => {
    const container = setupContainer();
    const defs = [makeDef({ id: 'a' }), makeDef({ id: 'b' }), makeDef({ id: 'c' })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    expect(qs(container, '.cmdp-counter').textContent).toBe('3');
  });

  test('filter checkboxes render with initial checked states from storage', () => {
    localStorage.setItem('cmdp-essential-only', 'true');
    localStorage.setItem('cmdp-executable-only', 'false');
    localStorage.setItem('cmdp-sort-mode', 'preserve');
    localStorage.setItem('cmdp-auto-pause', 'true');

    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();

    expect(qs<HTMLInputElement>(container, '.cmdp-essential-checkbox').checked).toBe(true);
    expect(qs<HTMLInputElement>(container, '.cmdp-executable-checkbox').checked).toBe(false);
    expect(qs<HTMLInputElement>(container, '.cmdp-sort-checkbox').checked).toBe(true);
    expect(qs<HTMLInputElement>(container, '.cmdp-autopause-checkbox').checked).toBe(true);
  });

  test('tab bar renders one tab per section with name and count badge', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', section: 'Markup', category: 'General Shortcuts' }),
      makeDef({ id: 'b', section: 'Markup', category: 'Marker Editing Shortcuts' }),
      makeDef({ id: 'c', section: 'Playback', category: 'Playback Shortcuts' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();

    const tabs = qsAll(container, '.cmdp-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Markup');
    expect(tabs[0].textContent).toContain('2/2');
    expect(tabs[1].textContent).toContain('Playback');
    expect(tabs[1].textContent).toContain('1/1');
  });

  test('first tab is active by default', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', section: 'Markup' }),
      makeDef({ id: 'b', section: 'Playback' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const tabs = qsAll(container, '.cmdp-tab');
    expect(tabs[0].classList.contains('cmdp-tab-active')).toBe(true);
    expect(tabs[1].classList.contains('cmdp-tab-active')).toBe(false);
  });

  test('category pills render inside active tab panel', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', section: 'Markup', category: 'General Shortcuts' }),
      makeDef({ id: 'b', section: 'Markup', category: 'Cropping Shortcuts' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const pills = qsAll(container, '.cmdp-category-pill');
    expect(pills.length).toBe(2);
    expect(pills[0].getAttribute('data-category')).toBe('General Shortcuts');
    expect(pills[1].getAttribute('data-category')).toBe('Cropping Shortcuts');
  });

  test('category pill uses short label when available', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', category: 'General Shortcuts' })]),
      { container }
    );
    palette.open();
    const pill = qs(container, '.cmdp-category-pill');
    expect(pill.textContent).toContain('General');
  });

  test('footer renders hint kbds and GitHub link', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const footer = qs(container, '.cmdp-footer');
    expect(footer.textContent).toContain('navigate');
    expect(footer.textContent).toContain('execute');
    expect(footer.textContent).toContain('close');
    const github = qs<HTMLAnchorElement>(footer, 'a.cmdp-footer-reference');
    expect(github.href).toBe('https://github.com/exwm/yt_clipper');
    expect(github.target).toBe('_blank');
  });

  test('full reference link appears only when onOpenReference provided', () => {
    const container1 = setupContainer();
    makePalette(makeRegistry([makeDef({ id: 'a' })]), { container: container1 }).open();
    expect(container1.querySelector('button.cmdp-footer-reference')).toBeNull();

    const container2 = setupContainer();
    makePalette(makeRegistry([makeDef({ id: 'a' })]), {
      container: container2,
      onOpenReference: () => {},
    }).open();
    expect(container2.querySelector('button.cmdp-footer-reference')).not.toBeNull();
  });

  test('last searches render pills from localStorage', () => {
    localStorage.setItem('cmdp-last-searches', JSON.stringify(['foo', 'bar']));
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const pills = qsAll(container, '.cmdp-last-search-pill');
    expect(pills.map((p) => p.textContent)).toEqual(['foo', 'bar']);
  });

  test('ensureStyles injects style element once', () => {
    const container = setupContainer();
    makePalette(makeRegistry([makeDef({ id: 'a' })]), { container }).open();
    makePalette(makeRegistry([makeDef({ id: 'a' })]), { container }).open();
    expect(qsAll(document.head, 'style#cmdp-styles').length).toBe(1);
  });
});

describe('CommandPalette — paintResults() results list', () => {
  test('renders one item row per shortcut', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', description: 'Alpha' }),
      makeDef({ id: 'b', description: 'Bravo' }),
      makeDef({ id: 'c', description: 'Charlie' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const items = qsAll(container, '.cmdp-results .cmdp-item');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Alpha');
    expect(items[2].textContent).toContain('Charlie');
  });

  test('item renders num, description, run button', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', description: 'My Shortcut' })]),
      { container }
    );
    palette.open();
    const item = qs(container, '.cmdp-item');
    expect(qs(item, '.cmdp-item-num').textContent).toBe('1');
    expect(qs(item, '.cmdp-item-desc').textContent).toBe('My Shortcut');
    expect(qs(item, '.cmdp-item-run')).toBeTruthy();
  });

  test('non-executable shortcut has badge and disabled run button', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', executable: false })]),
      { container }
    );
    palette.open();
    const item = qs(container, '.cmdp-item');
    expect(item.classList.contains('cmdp-non-executable')).toBe(true);
    expect(qs(item, '.cmdp-non-executable-badge').textContent).toBe('mouse');
    expect(qs<HTMLButtonElement>(item, '.cmdp-item-run').disabled).toBe(true);
  });

  test('essential shortcut gets cmdp-essential class', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', essential: true, handler: () => {} })]),
      { container }
    );
    palette.open();
    expect(qs(container, '.cmdp-item').classList.contains('cmdp-essential')).toBe(true);
  });

  test('shortcut with displayKey renders kbd elements', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', displayKey: 'ctrl + s', handler: () => {} })]),
      { container }
    );
    palette.open();
    const keys = qs(container, '.cmdp-item-keys');
    const kbds = qsAll(keys, 'kbd');
    expect(kbds.map((k) => k.textContent)).toEqual(['ctrl', 's']);
  });

  test('displayNote overrides displayKey badge', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([
        makeDef({ id: 'a', displayKey: 'ctrl + s', displayNote: 'custom', handler: () => {} }),
      ]),
      { container }
    );
    palette.open();
    const keys = qs(container, '.cmdp-item-keys');
    expect(qs(keys, '.cmdp-non-executable-badge').textContent).toBe('custom');
    expect(keys.querySelector('kbd')).toBeNull();
  });

  test('empty results show "No shortcuts match" message', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a', description: 'Alpha' })]), {
      container,
    });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    search.value = 'zzzzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(qs(container, '.cmdp-empty').textContent).toBe('No shortcuts match your search.');
  });

  test('section header renders with roman numeral and count', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', section: 'Markup' }),
      makeDef({ id: 'b', section: 'Markup' }),
      makeDef({ id: 'c', section: 'Playback' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const sections = qsAll(container, '.cmdp-results .cmdp-section');
    const realSections = sections.filter((s) => /^[IVX]+\. /.test(s.textContent ?? ''));
    expect(realSections.length).toBe(2);
    expect(realSections[0].textContent).toContain('I. Markup');
    expect(realSections[1].textContent).toContain('II. Playback');
  });

  test('category header renders with ordinal and count', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', category: 'General Shortcuts' }),
      makeDef({ id: 'b', category: 'General Shortcuts' }),
      makeDef({ id: 'c', category: 'Cropping Shortcuts' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const cats = qsAll(container, '.cmdp-results .cmdp-category');
    expect(cats.length).toBe(2);
    expect(cats[0].textContent).toContain('1. General Shortcuts');
    expect(cats[1].textContent).toContain('2. Cropping Shortcuts');
  });

  test('first executable item is highlighted by default', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', executable: false }),
      makeDef({ id: 'b', executable: true, handler: () => {} }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const items = qsAll(container, '.cmdp-item');
    expect(items[0].classList.contains('cmdp-highlighted')).toBe(false);
    expect(items[1].classList.contains('cmdp-highlighted')).toBe(true);
  });

  test('description matches get wrapped in <mark> on fuzzy search', () => {
    const container = setupContainer();
    const palette = makePalette(
      makeRegistry([makeDef({ id: 'a', description: 'Alpha bravo' })]),
      { container }
    );
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const marks = qsAll(container, '.cmdp-item-desc mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.map((m) => m.textContent).join('').toLowerCase()).toContain('alpha');
  });

  test('recent section appears when recentCommandIds and empty query', () => {
    localStorage.setItem('cmdp-recent-commands', JSON.stringify(['b']));
    const container = setupContainer();
    const defs = [makeDef({ id: 'a', description: 'Alpha' }), makeDef({ id: 'b', description: 'Bravo' })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const sections = qsAll(container, '.cmdp-results .cmdp-section');
    expect(sections[0].textContent).toContain('Recently used');
  });
});

describe('CommandPalette — interactions', () => {
  test('typing in search filters results', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', description: 'Alpha' }),
      makeDef({ id: 'b', description: 'Bravo' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const items = qsAll(container, '.cmdp-item');
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Alpha');
  });

  test('typing shows the clear button', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    const clear = qs<HTMLButtonElement>(container, '.cmdp-search-clear');
    search.value = 'x';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(clear.style.display).toBe('');
  });

  test('clear button resets search to empty', () => {
    const container = setupContainer();
    const defs = [makeDef({ id: 'a', description: 'Alpha' }), makeDef({ id: 'b', description: 'Bravo' })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    search.value = 'alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const clear = qs<HTMLButtonElement>(container, '.cmdp-search-clear');
    clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(search.value).toBe('');
    expect(qsAll(container, '.cmdp-item').length).toBe(2);
  });

  test('essential-only checkbox filters non-essential', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', essential: true, handler: () => {} }),
      makeDef({ id: 'b', essential: false, handler: () => {} }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const cb = qs<HTMLInputElement>(container, '.cmdp-essential-checkbox');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(qsAll(container, '.cmdp-item').length).toBe(1);
    expect(localStorage.getItem('cmdp-essential-only')).toBe('true');
  });

  test('executable-only checkbox filters non-executable', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', executable: false }),
      makeDef({ id: 'b', executable: true, handler: () => {} }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const cb = qs<HTMLInputElement>(container, '.cmdp-executable-checkbox');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    expect(qsAll(container, '.cmdp-item').length).toBe(1);
  });

  test('run button invokes selectCallback', () => {
    const container = setupContainer();
    const handler = jest.fn();
    const defs = [makeDef({ id: 'a', handler, executable: true })];
    const palette = makePalette(makeRegistry(defs), { container });
    const onSelect = jest.fn();
    palette.onSelect(onSelect);
    palette.open();
    const runBtn = qs<HTMLButtonElement>(container, '.cmdp-item-run');
    runBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('a');
    expect(palette.isOpen()).toBe(false);
  });

  test('pressing Enter executes highlighted item', () => {
    const container = setupContainer();
    const handler = jest.fn();
    const defs = [makeDef({ id: 'a', handler, executable: true })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true })
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(palette.isOpen()).toBe(false);
  });

  test('Escape closes palette', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Escape', bubbles: true, cancelable: true })
    );
    expect(palette.isOpen()).toBe(false);
  });

  test('ArrowDown moves highlight to next executable', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', handler: () => {}, executable: true }),
      makeDef({ id: 'b', handler: () => {}, executable: true }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    expect(qsAll(container, '.cmdp-item')[0].classList.contains('cmdp-highlighted')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown', bubbles: true }));
    expect(qsAll(container, '.cmdp-item')[1].classList.contains('cmdp-highlighted')).toBe(true);
  });

  test('ArrowUp wraps to last executable', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', handler: () => {}, executable: true }),
      makeDef({ id: 'b', handler: () => {}, executable: true }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
    expect(qsAll(container, '.cmdp-item')[1].classList.contains('cmdp-highlighted')).toBe(true);
  });

  test('clicking category pill toggles disabled state and persists', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', category: 'General Shortcuts' }),
      makeDef({ id: 'b', category: 'Cropping Shortcuts' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const pill = qsAll(container, '.cmdp-category-pill')[0];
    pill.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const saved = JSON.parse(localStorage.getItem('cmdp-disabled-categories') ?? '[]');
    expect(saved).toEqual(['General Shortcuts']);
    const headers = qsAll(container, '.cmdp-results .cmdp-category');
    const generalHeader = headers.find((h) => h.getAttribute('data-category') === 'General Shortcuts');
    expect(generalHeader?.classList.contains('cmdp-category-disabled')).toBe(true);
  });

  test('clicking tab switches active panel', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', section: 'Markup' }),
      makeDef({ id: 'b', section: 'Playback' }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const tabs = qsAll(container, '.cmdp-tab');
    tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(tabs[0].classList.contains('cmdp-tab-active')).toBe(false);
    expect(tabs[1].classList.contains('cmdp-tab-active')).toBe(true);
    expect(localStorage.getItem('cmdp-expanded-sections')).toBe('Playback');
  });

  test('options reset button clears all filter prefs', () => {
    localStorage.setItem('cmdp-essential-only', 'true');
    localStorage.setItem('cmdp-executable-only', 'true');
    localStorage.setItem('cmdp-sort-mode', 'preserve');
    localStorage.setItem('cmdp-auto-pause', 'true');
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const resetBtn = qsAll<HTMLButtonElement>(container, '.cmdp-reset-settings')[0];
    resetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(localStorage.getItem('cmdp-essential-only')).toBe('false');
    expect(localStorage.getItem('cmdp-executable-only')).toBe('false');
    expect(localStorage.getItem('cmdp-sort-mode')).toBe('rank');
    expect(localStorage.getItem('cmdp-auto-pause')).toBe('false');
    expect(qs<HTMLInputElement>(container, '.cmdp-essential-checkbox').checked).toBe(false);
    expect(qs<HTMLInputElement>(container, '.cmdp-executable-checkbox').checked).toBe(false);
  });

  test('close saves non-empty query to last searches', () => {
    const container = setupContainer();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), { container });
    palette.open();
    const search = qs<HTMLInputElement>(container, '.cmdp-search');
    search.value = 'hello';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    palette.close();
    expect(JSON.parse(localStorage.getItem('cmdp-last-searches') ?? '[]')).toEqual(['hello']);
  });

  test('clicking last-search pill refills search', () => {
    localStorage.setItem('cmdp-last-searches', JSON.stringify(['alpha']));
    const container = setupContainer();
    const defs = [makeDef({ id: 'a', description: 'Alpha' }), makeDef({ id: 'b', description: 'Bravo' })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const pill = qs(container, '.cmdp-last-search-pill');
    pill.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(qs<HTMLInputElement>(container, '.cmdp-search').value).toBe('alpha');
    expect(qsAll(container, '.cmdp-item').length).toBe(1);
  });

  test('autoPause invokes onOpen/onClose callbacks', () => {
    localStorage.setItem('cmdp-auto-pause', 'true');
    const container = setupContainer();
    const onOpen = jest.fn();
    const onClose = jest.fn();
    const palette = makePalette(makeRegistry([makeDef({ id: 'a' })]), {
      container,
      onOpen,
      onClose,
    });
    palette.open();
    expect(onOpen).toHaveBeenCalledTimes(1);
    palette.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('executing a command records it in recent commands', () => {
    const container = setupContainer();
    const handler = jest.fn();
    const defs = [makeDef({ id: 'my-id', handler, executable: true })];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true })
    );
    expect(JSON.parse(localStorage.getItem('cmdp-recent-commands') ?? '[]')).toEqual(['my-id']);
  });

  test('mouseenter on executable item moves highlight', () => {
    const container = setupContainer();
    const defs = [
      makeDef({ id: 'a', handler: () => {}, executable: true }),
      makeDef({ id: 'b', handler: () => {}, executable: true }),
    ];
    const palette = makePalette(makeRegistry(defs), { container });
    palette.open();
    const items = qsAll(container, '.cmdp-item');
    items[1].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(qsAll(container, '.cmdp-item')[1].classList.contains('cmdp-highlighted')).toBe(true);
  });
});
