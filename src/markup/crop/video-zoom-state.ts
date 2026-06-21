/**
 * Transient state for the reframe viewport. Kept out of appState/immer and never serialized, so it
 * can't leak into markers, settings, or exported output. The viewport is the single source of truth
 * that `applyVideoTransform` and the minimap read; reframe is its only writer.
 */
import { clampViewport, FIT, isZoomedViewport, ZoomViewport } from './video-zoom-math';

let viewport: ZoomViewport = { ...FIT };
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((fn) => fn());
}

/** Subscribe to viewport changes (minimap, overlay sync). Returns an unsubscribe. */
export function subscribeZoom(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getViewport(): ZoomViewport {
  return viewport;
}

/**
 * Set the viewport. Clamped to keep the frame covering the view by default; pass
 * `{ clamp: false }` for the reframe preview, which centres on the crop exactly
 * and intentionally over-pans (the clipped-out area is black). No-ops if unchanged.
 */
export function setViewport(v: ZoomViewport, opts?: { clamp?: boolean }): void {
  const next = opts?.clamp === false ? v : clampViewport(v);
  if (next.scale === viewport.scale && next.panX === viewport.panX && next.panY === viewport.panY) {
    return;
  }
  viewport = next;
  notify();
}

export function resetViewport(): void {
  setViewport({ ...FIT });
}

export function isZoomed(): boolean {
  return isZoomedViewport(viewport);
}
