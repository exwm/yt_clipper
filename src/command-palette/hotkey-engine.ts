import { ShortcutRegistry } from './registry';
import { KeyModifiers } from './types';

export type EventBlocker = (e: KeyboardEvent) => void;

export class HotkeyEngine {
  private enabled = true;
  private blocker: EventBlocker | null = null;
  private target: EventTarget | null = null;
  private listener: (e: KeyboardEvent) => void;

  constructor(private registry: ShortcutRegistry) {
    this.listener = (e: KeyboardEvent) => {
      this.dispatch(e);
    };
  }

  attach(target: EventTarget): void {
    if (this.target) this.detach();
    this.target = target;
    target.addEventListener('keydown', this.listener as EventListener, true);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.listener as EventListener, true);
    this.target = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setBlocker(fn: EventBlocker | null): void {
    this.blocker = fn;
  }

  dispatch(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const modifiers: KeyModifiers = {
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
    };
    const matches = this.registry.getByBinding(e.code, modifiers);
    for (const def of matches) {
      if (!def.handler) continue;
      if (def.guard && !def.guard()) continue;
      if (this.blocker) this.blocker(e);
      def.handler(e);
    }
  }
}
