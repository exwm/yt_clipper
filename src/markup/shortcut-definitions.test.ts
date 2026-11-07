import { ShortcutRegistry } from '../command-palette/registry';
import { createShortcutDefinitions, ShortcutDeps } from './shortcut-definitions';

describe('the shortcut definitions in the palette', () => {
  it("a search for 'wheel' finds reframe by its Ctrl+Mousewheel crop zoom", () => {
    const deps = new Proxy({}, { get: () => () => false }) as ShortcutDeps;
    const registry = new ShortcutRegistry();
    registry.registerAll(createShortcutDefinitions(deps));
    const reframe = registry.search('wheel').find((r) => r.shortcut.id === 'toggleReframe');
    expect(reframe?.matchKind).toBe('details');
  });
});
