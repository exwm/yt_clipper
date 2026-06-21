/**
 * Editor video "zoom" controller: reframe crop preview.
 *
 * Reframe (toggle `V`) turns the player into the output frame: the current crop is
 * scaled to fill the player and everything outside it is clipped to black, a WYSIWYG
 * preview of the output as the (dynamic) crop pans/zooms over time. Ctrl+wheel in
 * reframe zooms the crop itself (scale around its centre) without grabbing it.
 *
 * The viewport is a transient viewing aid and never touches exported output; crops
 * drawn/edited while reframed map correctly because `getClickPosScaled` reads the
 * transformed `getBoundingClientRect`. This module maps DOM events to viewport/clip
 * updates; the precision math lives in video-zoom-math / video-transform.
 */
import { appState } from '../appState';
import { getCurrentCropComponents, renderSpeedAndCropUI } from '../charts';
import { setCropPointHighlightVisible } from '../ui/chart/cropchart/cropChartSpec';
import { platform } from '../yt_clipper';
import { VideoPlatforms } from '../platforms/platforms';
import { blockEvent, deleteElement, flashMessage, injectCSS } from '../util/util';
import {
  applyActiveCropDimOpacity,
  forceRerenderCrop,
  isDrawingCrop,
  isMouseManipulatingCrop,
  reframeWheelZoomCrop,
  resizeCropOverlay,
  setCropDimVisible,
} from '../crop-overlay';
import { applyVideoTransform, getVideoTransformParams } from './video-transform';
import {
  initReframeCanvas,
  isReframeCanvasActive,
  redrawReframeCanvas,
  teardownReframeCanvas,
} from './video-reframe-canvas';
import { initZoomMinimap, teardownZoomMinimap } from './video-zoom-minimap';
export { toggleZoomMinimap } from './video-zoom-minimap';
import { isZoomed, resetViewport, setViewport, subscribeZoom } from './video-zoom-state';
import { reframeFillScale, rotateFocalPoint } from './video-zoom-math';

const ZOOM_CSS = `
.ytc-zoom-clip { overflow: hidden !important; }`;

let inited = false;
let zoomCssStyle: HTMLStyleElement | null = null;
let unsubscribe: (() => void) | null = null;
let containerResizeObserver: ResizeObserver | null = null;
let reframeEnabled = false;

function isSupportedPlatform(): boolean {
  return platform === VideoPlatforms.youtube || platform === VideoPlatforms.yt_clipper;
}

function videoContainer(): HTMLElement | undefined {
  return appState.hooks.videoContainer as HTMLElement | undefined;
}

/** Re-apply the visual state: clip class, composed transform, overlay reposition. */
function syncZoomVisual(): void {
  videoContainer()?.classList.toggle('ytc-zoom-clip', isZoomed());
  applyVideoTransform();
  // In reframe the overlay is the framing aid, so lock it to the transform synchronously; the
  // rAF-debounced resizeCropOverlay would land a frame late and the crop rect would trail.
  if (isCropViewModeActive()) {
    forceRerenderCrop();
  } else {
    resizeCropOverlay();
  }
}

export function initVideoZoom(): void {
  if (inited || !isSupportedPlatform()) return;
  inited = true;
  zoomCssStyle = injectCSS(ZOOM_CSS, 'yt-clipper-zoom-css');
  unsubscribe = subscribeZoom(syncZoomVisual);
  initZoomMinimap();
  // Fullscreen/theater/window resize changes the video box, so reframe's viewport (scale/pan to fill
  // the crop) goes stale. Playing, the rVFC loop recomputes it each frame; paused, the loop is idle,
  // so re-sync on the box change. Mirrors the overlay's own ResizeObserver on the same container.
  const container = videoContainer();
  if (container) {
    containerResizeObserver = new ResizeObserver(() => {
      if (reframeEnabled) syncReframe(getCurrentCropComponents());
    });
    containerResizeObserver.observe(container);
  }
  // Ctrl+wheel in reframe zooms the crop (see onWheel).
  appState.hooks.cropMouseManipulation.addEventListener('wheel', onWheel, {
    passive: false,
    capture: true,
  });
}

export function teardownVideoZoom(): void {
  if (!inited) return;
  appState.hooks.cropMouseManipulation?.removeEventListener('wheel', onWheel, true);
  teardownZoomMinimap();
  containerResizeObserver?.disconnect();
  containerResizeObserver = null;
  unsubscribe?.();
  unsubscribe = null;
  if (zoomCssStyle) deleteElement(zoomCssStyle);
  zoomCssStyle = null;
  resetViewport();
  inited = false;
}

/** Crop (cropRes coords) -> centre + size as fractions of the frame. */
function cropToFrac(crop: [number, number, number, number]): {
  cx: number;
  cy: number;
  w: number;
  h: number;
} {
  const [x, y, w, h] = crop;
  const cw = appState.settings.cropResWidth || 1;
  const ch = appState.settings.cropResHeight || 1;
  return { cx: (x + w / 2) / cw, cy: (y + h / 2) / ch, w: w / cw, h: h / ch };
}

export function isReframeEnabled(): boolean {
  return reframeEnabled;
}

/** True when a crop-driven view mode owns the view (only reframe now). */
function isCropViewModeActive(): boolean {
  return reframeEnabled;
}

// ── Reframe crop preview ─────────────────────────────────────────────────────
// Show only the current crop, scaled to fill the player, the rest clipped to black:
// a WYSIWYG preview of the output as the dynamic crop pans/zooms over time.

export function toggleReframe(crop: [number, number, number, number] | null): void {
  reframeEnabled = !reframeEnabled;
  // Scopes the CSS that hides the platform's center play/pause bezel: in reframe the rapid play/pause
  // used to track a subject would otherwise flash a big icon over the crop.
  document.body.classList.toggle('ytc-reframe-active', reframeEnabled);
  // Swap the overlay dim onto the active mode's value (reframe has its own preference).
  applyActiveCropDimOpacity();
  if (reframeEnabled) {
    flashMessage('Reframe: on', 'olive');
    initReframeCanvas();
    // The canvas draws its own bars and hides the video, so hide the SVG dim too.
    setCropDimVisible(!isReframeCanvasActive());
    syncReframe(crop);
    // Refresh once so the dynamic crop start/end section overlays hide immediately, rather than
    // lingering until the next playback frame runs updateDynamicCropOverlays.
    renderSpeedAndCropUI(true);
  } else {
    teardownReframeCanvas();
    setCropDimVisible(true);
    resetViewport();
    // Reframe may have hidden the crop-point highlight (between keyframes); restore it so the chart
    // shows the selection again outside reframe, even if the chart was closed when we toggled off.
    setCropPointHighlightVisible(true);
    // Reframe suppressed the per-frame chart re-renders, so the dynamic crop overlays are still
    // hidden and the selected point is a stale keyframe. Refresh once, re-deriving the selection
    // from the current time, so the green/yellow start/end overlays come back at the right point
    // instead of where reframe last left them (or waiting for the next playback frame).
    renderSpeedAndCropUI(true, true);
    flashMessage('Reframe: off', 'grey');
  }
}

/** Apply the viewport for the crop, then redraw the canvas if paused. Called per frame and edit. */
export function syncReframe(crop: [number, number, number, number] | null): void {
  applyReframeViewport(crop);
  // Paused edits present no new frames (the rVFC loop is idle), so redraw now.
  if (isReframeCanvasActive() && appState.video.paused) redrawReframeCanvas();
}

/** Position the hidden video transform and clip to the crop. getClickPosScaled and the crop
 *  overlay read this, so it must stay current every frame; the canvas loop calls it too. No
 *  redraw here, so it can't recurse with that loop. */
export function applyReframeViewport(crop: [number, number, number, number] | null): void {
  if (!reframeEnabled || !crop || isDrawingCrop) return;
  const { cx, cy, w, h } = cropToFrac(crop);
  // Fit the crop into the whole video player area, not just the letterboxed video box: a crop in a
  // portrait video (narrow box, wide player) or a rotated crop fills the area the box leaves empty.
  // Prefer the video's offset parent when it has real layout (the sized .video-js wrapper on the
  // generic platform, which excludes the control-bar strip); fall back to the container when it
  // doesn't (on YouTube the offset parent is a zero-size wrapper). rotated/fsScale/box come from the
  // shared transform params (we set the new scale/pan below, so ignore their current zoom fields).
  const { rotated, fsScale, boxW, boxH } = getVideoTransformParams();
  const op = appState.video.offsetParent as HTMLElement | null;
  const player = op?.clientWidth && op?.clientHeight ? op : appState.hooks.videoContainer;
  const targetW = player.clientWidth;
  const targetH = player.clientHeight;
  const scale = reframeFillScale(w, h, boxW * fsScale, boxH * fsScale, targetW, targetH, rotated);
  // The pan is a displayed-frame focal point, so map the source crop centre through the rotation.
  const { x: panX, y: panY } = rotateFocalPoint(cx, cy, appState.rotation);
  setViewport({ scale, panX, panY }, { clamp: false }); // centre exactly on the crop
}

function onWheel(e: WheelEvent): void {
  if (!reframeEnabled) return;
  // Ctrl+wheel zooms the crop (scale around its centre) without grabbing it. Plain wheel scrolls
  // the page; defer to the crop's own Ctrl+wheel scale handler during a manipulation.
  if (isMouseManipulatingCrop || !e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  blockEvent(e);
  reframeWheelZoomCrop(e.deltaY);
}
