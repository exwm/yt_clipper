/**
 * Runtime feature flags for the markup userscript.
 *
 * Flip a flag to enable / disable a feature without removing its code
 * from the bundle. Each flag is read at runtime by its consumer (a
 * shortcut's `guard` callback, a conditional call site, etc.), so
 * toggling means a one-line source edit and a rebundle — the script's
 * surface area changes but no code disappears.
 *
 * Add a flag when a feature is wired up end-to-end but not yet ready to
 * expose by default — typically because its data format is still in
 * flux, the UX needs more iteration, or the implementation is gated on
 * an external dependency that isn't deployed.
 */
export const featureFlags = {
  /** Shareable-URL save / load.
   *  - Anchors the Shift+S "Share" chip in the Data group of the hints
   *    bar (`copyShareableUrl` shortcut).
   *  - Auto-loads markers from a `?share=...` URL fragment on init
   *    via `tryLoadSharedMarkers()`.
   *  Off by default — the embedded-markers URL format is still
   *  iterating and shared links from one bundle version may not parse
   *  cleanly in another. */
  shareLink: false,
} as const;
