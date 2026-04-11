import { ShortcutRegistry } from './registry';
import { ShortcutDefinition } from './types';

function makeDef(partial: Partial<ShortcutDefinition> & { id: string }): ShortcutDefinition {
  return {
    description: partial.description ?? `desc-${partial.id}`,
    displayKey: partial.displayKey ?? '',
    section: partial.section ?? 'Basic Features',
    category: partial.category ?? 'Marker Shortcuts',
    essential: partial.essential ?? false,
    binding: partial.binding ?? null,
    handler: partial.handler ?? null,
    executable: partial.executable ?? true,
    ...partial,
  };
}

describe('ShortcutRegistry', () => {
  test('register adds a shortcut', () => {
    const reg = new ShortcutRegistry();
    const def = makeDef({ id: 'a' });
    reg.register(def);
    expect(reg.getAll()).toEqual([def]);
    expect(reg.getById('a')).toBe(def);
  });

  test('registerAll adds multiple shortcuts preserving order', () => {
    const reg = new ShortcutRegistry();
    const defs = [makeDef({ id: 'a' }), makeDef({ id: 'b' }), makeDef({ id: 'c' })];
    reg.registerAll(defs);
    expect(reg.getAll().map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  test('register throws on duplicate id', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'a' }));
    expect(() => reg.register(makeDef({ id: 'a' }))).toThrow(/duplicate/);
  });

  test('unregister removes shortcut by id', () => {
    const reg = new ShortcutRegistry();
    reg.registerAll([makeDef({ id: 'a' }), makeDef({ id: 'b' })]);
    reg.unregister('a');
    expect(reg.getAll().map((d) => d.id)).toEqual(['b']);
    expect(reg.getById('a')).toBeUndefined();
  });

  test('unregister is a no-op for unknown id', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'a' }));
    expect(() => reg.unregister('missing')).not.toThrow();
    expect(reg.getAll()).toHaveLength(1);
  });

  test('getGrouped returns section -> category -> shortcuts map in insertion order', () => {
    const reg = new ShortcutRegistry();
    reg.registerAll([
      makeDef({ id: 'a', section: 'Basic', category: 'Marker' }),
      makeDef({ id: 'b', section: 'Basic', category: 'Marker' }),
      makeDef({ id: 'c', section: 'Basic', category: 'Cropping' }),
      makeDef({ id: 'd', section: 'Advanced', category: 'Markup' }),
    ]);
    const grouped = reg.getGrouped();
    expect(Array.from(grouped.keys())).toEqual(['Basic', 'Advanced']);
    const basic = grouped.get('Basic')!;
    expect(Array.from(basic.keys())).toEqual(['Marker', 'Cropping']);
    expect(basic.get('Marker')!.map((d) => d.id)).toEqual(['a', 'b']);
    expect(basic.get('Cropping')!.map((d) => d.id)).toEqual(['c']);
    expect(grouped.get('Advanced')!.get('Markup')!.map((d) => d.id)).toEqual(['d']);
  });

  test('getByBinding returns exact match on code + modifiers', () => {
    const reg = new ShortcutRegistry();
    const defA = makeDef({
      id: 'a',
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
    });
    const defB = makeDef({
      id: 'b',
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: true, alt: false } },
    });
    reg.registerAll([defA, defB]);
    expect(reg.getByBinding('KeyA', { ctrl: false, shift: false, alt: false })).toEqual([defA]);
    expect(reg.getByBinding('KeyA', { ctrl: false, shift: true, alt: false })).toEqual([defB]);
  });

  test('getByBinding returns empty when no match', () => {
    const reg = new ShortcutRegistry();
    reg.register(
      makeDef({ id: 'a', binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } } }),
    );
    expect(reg.getByBinding('KeyB', { ctrl: false, shift: false, alt: false })).toEqual([]);
    expect(reg.getByBinding('KeyA', { ctrl: true, shift: false, alt: false })).toEqual([]);
  });

  test('getByBinding with undefined modifier acts as wildcard', () => {
    const reg = new ShortcutRegistry();
    const wildcard = makeDef({
      id: 'wild',
      binding: { code: 'ArrowLeft', modifiers: {} },
    });
    reg.register(wildcard);
    expect(reg.getByBinding('ArrowLeft', { ctrl: false, shift: false, alt: false })).toEqual([wildcard]);
    expect(reg.getByBinding('ArrowLeft', { ctrl: true, shift: false, alt: false })).toEqual([wildcard]);
    expect(reg.getByBinding('ArrowLeft', { ctrl: false, shift: true, alt: true })).toEqual([wildcard]);
  });

  test('getByBinding ignores shortcuts with null binding', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'mouse', binding: null }));
    expect(reg.getByBinding('KeyA', { ctrl: false, shift: false, alt: false })).toEqual([]);
  });

  test('search with empty query returns all shortcuts', () => {
    const reg = new ShortcutRegistry();
    reg.registerAll([
      makeDef({ id: 'a', description: 'Add a marker' }),
      makeDef({ id: 'b', description: 'Remove a marker' }),
    ]);
    expect(reg.search('').map((r) => r.shortcut.id)).toEqual(['a', 'b']);
    expect(reg.search('   ').map((r) => r.shortcut.id)).toEqual(['a', 'b']);
  });

  test('search returns fuzzy ranked results', () => {
    const reg = new ShortcutRegistry();
    reg.registerAll([
      makeDef({ id: 'a', description: 'Add a marker' }),
      makeDef({ id: 'b', description: 'Remove a marker' }),
      makeDef({ id: 'c', description: 'Save settings' }),
    ]);
    const ids = reg.search('marker').map((r) => r.shortcut.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  test('search returns empty for gibberish', () => {
    const reg = new ShortcutRegistry();
    reg.register(makeDef({ id: 'a', description: 'Add a marker' }));
    expect(reg.search('zzzzzzzqqqqqqq')).toEqual([]);
  });
});
