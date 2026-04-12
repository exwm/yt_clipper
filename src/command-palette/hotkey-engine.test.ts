/**
 * @jest-environment jsdom
 */
import { HotkeyEngine } from './hotkey-engine';
import { ShortcutRegistry } from './registry';
import { ShortcutDefinition } from './types';

function makeDef(partial: Partial<ShortcutDefinition> & { id: string }): ShortcutDefinition {
  return {
    description: partial.description ?? `desc-${partial.id}`,
    displayKey: partial.displayKey ?? '',
    section: partial.section ?? 'Basic',
    category: partial.category ?? 'Cat',
    essential: partial.essential ?? false,
    binding: partial.binding ?? null,
    handler: partial.handler ?? null,
    executable: partial.executable ?? true,
    ...partial,
  };
}

function keydown(
  code: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    code,
    ctrlKey: !!modifiers.ctrl,
    shiftKey: !!modifiers.shift,
    altKey: !!modifiers.alt,
  });
}

describe('HotkeyEngine', () => {
  test('dispatches handler for matching key event', () => {
    const reg = new ShortcutRegistry();
    const handler = jest.fn();
    reg.register(
      makeDef({
        id: 'a',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler,
      })
    );
    const engine = new HotkeyEngine(reg);
    engine.dispatch(keydown('KeyA'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('setEnabled(false) prevents all dispatch', () => {
    const reg = new ShortcutRegistry();
    const handler = jest.fn();
    reg.register(
      makeDef({
        id: 'a',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler,
      })
    );
    const engine = new HotkeyEngine(reg);
    engine.setEnabled(false);
    engine.dispatch(keydown('KeyA'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('guard returning false skips the shortcut', () => {
    const reg = new ShortcutRegistry();
    const handler = jest.fn();
    reg.register(
      makeDef({
        id: 'a',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler,
        guard: () => false,
      })
    );
    const engine = new HotkeyEngine(reg);
    engine.dispatch(keydown('KeyA'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('calls blocker before handler', () => {
    const reg = new ShortcutRegistry();
    const order: string[] = [];
    const blocker = jest.fn(() => order.push('block'));
    const handler = jest.fn(() => order.push('handle'));
    reg.register(
      makeDef({
        id: 'a',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler,
      })
    );
    const engine = new HotkeyEngine(reg);
    engine.setBlocker(blocker);
    engine.dispatch(keydown('KeyA'));
    expect(order).toEqual(['block', 'handle']);
  });

  test('multiple bindings on same code with different modifiers dispatch independently', () => {
    const reg = new ShortcutRegistry();
    const plainHandler = jest.fn();
    const shiftHandler = jest.fn();
    reg.registerAll([
      makeDef({
        id: 'plain',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler: plainHandler,
      }),
      makeDef({
        id: 'shift',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: true, alt: false } },
        handler: shiftHandler,
      }),
    ]);
    const engine = new HotkeyEngine(reg);
    engine.dispatch(keydown('KeyA'));
    expect(plainHandler).toHaveBeenCalledTimes(1);
    expect(shiftHandler).not.toHaveBeenCalled();

    plainHandler.mockClear();
    engine.dispatch(keydown('KeyA', { shift: true }));
    expect(plainHandler).not.toHaveBeenCalled();
    expect(shiftHandler).toHaveBeenCalledTimes(1);
  });

  test('ignores entries with null binding', () => {
    const reg = new ShortcutRegistry();
    const handler = jest.fn();
    reg.register(makeDef({ id: 'mouse', binding: null, handler }));
    const engine = new HotkeyEngine(reg);
    engine.dispatch(keydown('KeyA'));
    expect(handler).not.toHaveBeenCalled();
  });

  test('ignores entries with null handler', () => {
    const reg = new ShortcutRegistry();
    reg.register(
      makeDef({
        id: 'display',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler: null,
      })
    );
    const engine = new HotkeyEngine(reg);
    expect(() => { engine.dispatch(keydown('KeyA')); }).not.toThrow();
  });

  test('attach listens to the target and detach removes listener', () => {
    const reg = new ShortcutRegistry();
    const handler = jest.fn();
    reg.register(
      makeDef({
        id: 'a',
        binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
        handler,
      })
    );
    const engine = new HotkeyEngine(reg);
    engine.attach(document);
    document.dispatchEvent(keydown('KeyA'));
    expect(handler).toHaveBeenCalledTimes(1);

    engine.detach();
    document.dispatchEvent(keydown('KeyA'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
