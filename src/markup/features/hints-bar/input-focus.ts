/**
 * Tracks which form input in the settings editor currently has keyboard
 * focus, so the hints bar can surface input-specific shortcuts as a
 * hover-layer context.
 *
 * Listens once on `document` for focusin / focusout (events bubble) and
 * compares the focused element against the singleton input references
 * exported by `settings-editor`. Re-checks identity on every event, so
 * an input element being replaced (editor reopened) doesn't strand us.
 */

import { cropInput } from '../settings/settings-editor';

let cropInputFocused = false;

/** True when the focus event targets the current `cropInput` element.
 *  `cropInput` is null before the settings editor is mounted and gets
 *  reassigned each time the editor reopens, so we identity-compare
 *  on every event rather than cache. */
function isCropInputEvent(e: FocusEvent): boolean {
  return cropInput != null && e.target === cropInput;
}

function onFocusIn(e: FocusEvent): void {
  if (isCropInputEvent(e)) cropInputFocused = true;
}

function onFocusOut(e: FocusEvent): void {
  if (isCropInputEvent(e)) cropInputFocused = false;
}

let started = false;

export function startInputFocusTracker(): void {
  if (started) return;
  started = true;
  document.addEventListener('focusin', onFocusIn, { passive: true });
  document.addEventListener('focusout', onFocusOut, { passive: true });
}

export type FocusedInputContext = 'crop-input-focused';

export function getFocusedInputContext(): FocusedInputContext | null {
  return cropInputFocused ? 'crop-input-focused' : null;
}
