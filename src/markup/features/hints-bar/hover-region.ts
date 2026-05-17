/**
 * Tracks which logical "region" of the page the mouse is currently over.
 * The hints bar reads this to add region-specific shortcuts to the chip set.
 *
 * Two simple mechanisms:
 *
 *  1. **Stability debounce** — when the raw region changes, the reported
 *     value lags by a small window. Two flavors:
 *       - `HOVER_STABILITY_MS` (short): region → region transitions. Short
 *         enough to feel responsive when the user deliberately switches
 *         between adjacent regions.
 *       - `HOVER_GRACE_MS` (longer): region → null transitions. Gives the
 *         user time to transit from a region toward the hints bar without
 *         losing the contextual chip set before the cursor arrives.
 *     Entering a region from null (no prior region) is always instant.
 *
 *  2. **Freeze** — `freezeHover()` captures the currently-reported value
 *     and locks it until `unfreezeHover()`. The hints bar calls these from
 *     its own `mouseenter`/`mouseleave` listeners so that as soon as the
 *     cursor is actually on the bar, the chip set is pinned for inspection.
 *
 * Each call to `registerHoverRegion(el, region)` returns a disposer; the
 * caller is responsible for calling it when the element is unmounted.
 */

export type HoveredRegion =
  | 'video'
  | 'crop'
  | 'progress-bar'
  | 'speed-chart'
  | 'speed-chart-point'
  | 'crop-chart'
  | 'crop-chart-point'
  | null;

/** Region → region transitions debounce by this much. Short enough to feel
 *  instant, long enough to absorb fast transits between adjacent regions. */
const HOVER_STABILITY_MS = 200;

/** Region → null transitions debounce by this much. Longer than the
 *  region→region window so that the contextual chip set persists while the
 *  user moves from the region toward the hints bar. */
const HOVER_GRACE_MS = 400;

/** Null → region transitions debounce by this much. Suppresses
 *  "transit-through" context flips when the user is moving from one part
 *  of the page through an adjacent hover region to reach the hints bar
 *  (e.g., markers mode → crossing crop chart → reaching the bar). Brief
 *  enough that deliberate hovers still register without feeling sluggish. */
const HOVER_ENTRY_MS = 180;

let hoveredRegion: HoveredRegion = null;
let rawRegionChangedAt = 0;
let lastReportedRegion: HoveredRegion = null;

let isFrozen = false;
let frozenRegion: HoveredRegion = null;

function updateRegion(region: HoveredRegion): void {
  // Always track the raw region (even while frozen) so that after unfreeze
  // we report what the cursor is actually over now, not a stale value.
  if (region === hoveredRegion) return;
  hoveredRegion = region;
  rawRegionChangedAt = performance.now();
}

/** Direct setter for callers that need fine-grained control (e.g. the chart
 *  canvas mousemove hit-tester switches between `{type}-chart` and
 *  `{type}-chart-point` based on whether the cursor is over a data point). */
export function setHoveredRegion(region: HoveredRegion): void {
  updateRegion(region);
}

/** Peek at the raw current region, bypassing both the stability window and
 *  the freeze. Used to detect "cursor is over a tracked region" decisions
 *  that should not be affected by what's currently REPORTED. */
export function peekRawHoveredRegion(): HoveredRegion {
  return hoveredRegion;
}

export function getHoveredRegion(): HoveredRegion {
  if (isFrozen) return frozenRegion;
  if (hoveredRegion === lastReportedRegion) return lastReportedRegion;
  // Pick the debounce window based on the transition kind:
  //   null → region: brief entry debounce so the cursor merely transiting
  //     through a region (e.g. crossing the crop chart on the way to the
  //     hints bar) doesn't flip context before it settles.
  //   region → null: longer grace so the contextual chip set persists while
  //     the user moves from the region toward the hints bar.
  //   region → region: short stability window for deliberate switches
  //     between adjacent regions.
  let debounce: number;
  if (lastReportedRegion === null) {
    debounce = HOVER_ENTRY_MS;
  } else if (hoveredRegion === null) {
    debounce = HOVER_GRACE_MS;
  } else {
    debounce = HOVER_STABILITY_MS;
  }
  if (performance.now() - rawRegionChangedAt < debounce) {
    return lastReportedRegion;
  }
  lastReportedRegion = hoveredRegion;
  return lastReportedRegion;
}

/** Captures the currently-reported region and locks it until `unfreezeHover`.
 *  No-op if there's nothing to freeze. */
export function freezeHover(): void {
  const current = getHoveredRegion();
  if (current === null) return;
  frozenRegion = current;
  isFrozen = true;
}

export function unfreezeHover(): void {
  isFrozen = false;
  frozenRegion = null;
}

/** Active registrations, keyed by element so the same element can't double-register. */
const activeRegistrations = new WeakMap<
  HTMLElement,
  { region: Exclude<HoveredRegion, null>; onEnter: () => void; onLeave: () => void }
>();

export function registerHoverRegion(
  el: HTMLElement | undefined | null,
  region: Exclude<HoveredRegion, null>
): () => void {
  if (!el) return () => {};

  const existing = activeRegistrations.get(el);
  if (existing) {
    el.removeEventListener('mouseenter', existing.onEnter);
    el.removeEventListener('mouseleave', existing.onLeave);
    activeRegistrations.delete(el);
  }

  const onEnter = (): void => {
    updateRegion(region);
  };
  const onLeave = (): void => {
    if (hoveredRegion === region) updateRegion(null);
  };

  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);
  activeRegistrations.set(el, { region, onEnter, onLeave });

  return () => {
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
    activeRegistrations.delete(el);
    if (hoveredRegion === region) updateRegion(null);
  };
}
