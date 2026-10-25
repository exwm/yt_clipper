/**
 * Runtime feature flags for the markup userscript.
 *
 * Flip a flag to enable / disable a feature without removing its code
 * from the bundle. Each flag is read at runtime by its consumer (a
 * shortcut's `guard` callback, a conditional call site, etc.), so
 * toggling means a one-line source edit and a rebundle: the script's
 * surface area changes but no code disappears.
 *
 * Add a flag when a feature is wired up end-to-end but not yet ready to
 * expose by default: typically because its data format is still in
 * flux, the UX needs more iteration, or the implementation is gated on
 * an external dependency that isn't deployed.
 */
export const featureFlags = {
  /** Shareable-URL save / load.
   *  - Anchors the Shift+S "Share" chip in the Data group of the hints
   *    bar (`copyShareableUrl` shortcut).
   *  - Auto-loads markers from a `?share=...` URL fragment on init
   *    via `tryLoadSharedMarkers()`.
   *  Off by default: the embedded-markers URL format is still
   *  iterating and shared links from one bundle version may not parse
   *  cleanly in another. */
  shareLink: false,
  /** Flash the segment count and solve time of each Cinematic crop path solve. */
  cinematicSolveStats: true,
  /** Log a summary of the reframe canvas's redraws to the console every 2 s of playback: frames
   *  skipped, late redraws, draw time, drawn picture vs the crop's frame, and crop evenness. */
  reframeFrameStats: false,
  /** When reframe, the crop previews, the minimap and the frame clock get video frames
   *  (`util/video-frame-loop.ts`): 'everyRefresh' takes the frame the video holds on each screen
   *  refresh, 'frameCallback' waits for requestVideoFrameCallback. */
  videoFrameLoopTiming: 'frameCallback' as 'everyRefresh' | 'frameCallback',
  /** Log what each video frame loop did every 2 s of playback: its timing and consumers, refreshes,
   *  frames taken and repeated, new frames, the frame callback's calls and misses, and the time the
   *  loop and each consumer took. */
  videoFrameLoopStats: false,
} as const;
