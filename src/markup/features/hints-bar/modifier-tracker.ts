/**
 * Tracks which keyboard modifiers (Ctrl/Shift/Alt) are currently held.
 *
 * The hints bar consults `getModifierState()` per frame in its RAF loop and
 * filters chips whose `whenModifiers` requirement no longer matches. This
 * lets the bar reveal/hide modifier-conditioned hints in real time.
 *
 * - Listeners run in capture phase so we see the keys before other handlers.
 * - `window.blur` and `visibilitychange` reset the state to handle Alt-Tab /
 *   browser-switch (where the keyup never fires).
 */

export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

let state: ModifierState = { ctrl: false, shift: false, alt: false };
let started = false;

export function getModifierState(): ModifierState {
  return state;
}

export function startModifierTracker(): void {
  if (started) return;
  started = true;
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function onKey(e: KeyboardEvent): void {
  state = { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
}

function onVisibilityChange(): void {
  if (document.hidden) reset();
}

function reset(): void {
  state = { ctrl: false, shift: false, alt: false };
}
