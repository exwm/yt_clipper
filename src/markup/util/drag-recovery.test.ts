/**
 * @jest-environment jsdom
 */
import {
  _resetDragRecoveryForTests,
  registerActiveDragCleanup,
  releaseAllActiveDrags,
} from './drag-recovery';

describe('drag-recovery', () => {
  beforeEach(() => {
    _resetDragRecoveryForTests();
  });

  test('unregister removes the cleanup so a later releaseAll does not fire it', () => {
    const cleanup = jest.fn();
    const unregister = registerActiveDragCleanup(cleanup);
    unregister();
    releaseAllActiveDrags();
    expect(cleanup).not.toHaveBeenCalled();
  });

  test('releaseAllActiveDrags fires every registered cleanup exactly once', () => {
    const a = jest.fn();
    const b = jest.fn();
    registerActiveDragCleanup(a);
    registerActiveDragCleanup(b);
    releaseAllActiveDrags();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    releaseAllActiveDrags();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('cleanup that calls its own unregister during releaseAll does not throw', () => {
    let unregister: () => void = () => {};
    const cleanup = jest.fn(() => unregister());
    unregister = registerActiveDragCleanup(cleanup);
    expect(() => releaseAllActiveDrags()).not.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('a throwing cleanup does not prevent the next cleanup from running', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const thrower = jest.fn(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registerActiveDragCleanup(thrower);
    registerActiveDragCleanup(survivor);
    releaseAllActiveDrags();
    expect(thrower).toHaveBeenCalled();
    expect(survivor).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  test('window blur triggers releaseAll for registered cleanups', () => {
    const cleanup = jest.fn();
    registerActiveDragCleanup(cleanup);
    window.dispatchEvent(new Event('blur'));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('visibilitychange to hidden triggers releaseAll', () => {
    const cleanup = jest.fn();
    registerActiveDragCleanup(cleanup);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cleanup).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  test('visibilitychange while still visible does NOT trigger releaseAll', () => {
    const cleanup = jest.fn();
    registerActiveDragCleanup(cleanup);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cleanup).not.toHaveBeenCalled();
  });
});
