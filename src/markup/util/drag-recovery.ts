/**
 * Safety net for mouse-based drag handlers that need a guaranteed cleanup
 * path even when the browser silently drops their `pointerup`.
 *
 * Each drag handler in the markup userscript follows the same shape:
 *  1. On `pointerdown`, capture the pointer and attach listeners that track
 *     `pointermove` / `pointerup` / `pointercancel`.
 *  2. On end, release the capture and detach the listeners.
 *
 * Layers 1+2 (captured-target listeners + `pointercancel`) handle the vast
 * majority of edge cases the Pointer Events spec describes — devtools
 * stealing focus, touch interruption, etc. But there is a residual class of
 * situations where neither `pointerup` nor `pointercancel` fires for our
 * captured target: the user alt-tabs away while mid-drag, the OS reassigns
 * pointer ownership, or the tab is hidden (`document.hidden`) before the
 * pointer is released. This module is the belt-and-suspenders fallback that
 * fires the registered cleanups on those window-level signals.
 *
 * Usage:
 *
 *   const unregister = registerActiveDragCleanup(() => {
 *     // restore module state, remove leftover listeners, release capture
 *   });
 *   // ...later, on normal pointerup:
 *   unregister();
 *
 * The cleanup must be idempotent — it may be invoked by either the normal
 * end path or the recovery fallback, but not both for the same drag (the
 * unregister call removes it from the registry).
 */

const activeCleanups = new Set<() => void>();
let listenersAttached = false;

function ensureGlobalListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener('blur', releaseAllActiveDrags);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllActiveDrags();
  });
}

/** Iterates a snapshot of registered cleanups and fires each. Snapshotting
 *  first lets cleanups remove themselves from the registry (via their
 *  `unregister` closure) without mutating the set we're iterating. */
export function releaseAllActiveDrags(): void {
  const snapshot = Array.from(activeCleanups);
  activeCleanups.clear();
  for (const cleanup of snapshot) {
    try {
      cleanup();
    } catch (err) {
      // A buggy cleanup must not block the others. Surface it on the
      // console rather than letting it tear down the recovery loop.
      console.warn('[drag-recovery] cleanup threw', err);
    }
  }
}

export function registerActiveDragCleanup(cleanup: () => void): () => void {
  ensureGlobalListeners();
  activeCleanups.add(cleanup);
  return () => {
    activeCleanups.delete(cleanup);
  };
}

/** Test-only: clears registry state so unit tests start clean. Don't call
 *  from production code paths — drag handlers should always own their own
 *  unregister closure. */
export function _resetDragRecoveryForTests(): void {
  activeCleanups.clear();
}
