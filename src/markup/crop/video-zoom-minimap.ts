/**
 * Zoom navigator minimap — a small full-frame thumbnail with a red rectangle marking
 * the part of the frame currently visible in the magnified player, plus a white
 * outline of the current crop. Drag on it to
 * move the view by the drag delta (init + delta, like crop pan — never jumps). It
 * auto-shows whenever the view is zoomed (>1x) and removes itself at fit, so it
 * doubles as the "you are zoomed" affordance.
 *
 * The thumbnail draws the *displayed* (post-rotation) frame so its rectangle and
 * the drag→focal-point mapping live in the same normalized space as the viewport
 * (video-zoom-math). A requestVideoFrameCallback loop keeps it live and is always
 * cancelled on teardown.
 */
import { html, render } from 'lit-html';
import { createDraft } from 'immer';
import { appState } from '../appState';
import { CropPoint } from '../@types/yt_clipper';
import {
  autoKeyCurrentCropPoint,
  getCropMapProperties,
  getCurrentCropComponents,
  renderSpeedAndCropUI,
} from '../charts';
import { isReframeEnabled } from './video-zoom-controller';
import { getCropComponents, getRelevantCropString, updateCropString } from '../crop-utils';
import {
  ensureReframeZoomPan,
  setCropManipulationKind,
  setIsMouseManipulatingCrop,
} from '../crop-overlay';
import { clampNumber, flashMessage, getCropString, injectCSS } from '../util/util';
import { getMarkerPairHistory, saveMarkerPairHistory } from '../util/undoredo';
import { renderUIIcon } from '../features/icons/glyphs';
import { cropToTargetRect, lockPanAxis, minimapRect, unrotateFocalPoint } from './video-zoom-math';
import { getViewport, isZoomed, setViewport, subscribeZoom } from './video-zoom-state';

// Pixels the pointer must travel before a press on the minimap becomes a pan, so
// an accidental click never jumps the view.
const DRAG_THRESHOLD = 4;

// Reframe crop manipulation: smallest crop dimension (cropRes units) and the edge
// band (a fraction of the crop, capped at a fraction of the frame) within which a
// grab resizes that edge instead of moving the crop.
const CROP_MIN = 10;
const RESIZE_EDGE_FRAC = 0.2;
const RESIZE_EDGE_MAX_FRAME_FRAC = 0.06;

// Minimap move/resize cursors built from Blender's double-headed arrow
// (blender:ARROW_LEFTRIGHT, CC BY-SA 4.0) so they match the rest of the UI. Drawn
// white with a dark outline (paint-order:stroke) so they stay visible on any video,
// at ~16px to obscure less of the small minimap; native names are kept as fallbacks.
// The square viewBox is centred on the arrow (800,400) so rotations stay centred.
const BLENDER_ARROW_LR =
  'm184.49609 623.99414a.50005.50005 0 0 0 -.34961.85938l2.14649 2.14648h-10.58594l2.14649-2.14648a.50005.50005 0 1 0 -.70704-.70704l-3 3a.50005.50005 0 0 0 0 .70704l3 3a.50005.50005 0 1 0 .70704-.70704l-2.14649-2.14648h10.58594l-2.14649 2.14648a.50005.50005 0 1 0 .70704.70704l3-3a.50005.50005 0 0 0 0-.70704l-3-3a.50005.50005 0 0 0 -.35743-.15234z';
// blender:MOD_LENGTH — diagonal double-headed arrow (bottom-left ↔ top-right),
// centred at (800,800). Used for the corner cursors so they're drawn natively on the
// diagonal instead of a 45°-rotated copy of the horizontal arrow (nw/se = +90°).
const BLENDER_MOD_LENGTH =
  `<path d='m224.38607 100.78271c-.15574.005-.30353.0699-.41211.18164l-2.05673 2.00254c-.62065.56444.28322 1.46831.84766.84765l2.05673-2.00254c.39088-.38144.1104-1.04428-.43555-1.02929z'/>` +
  `<path d='m225.6621 95.349988c-.67621-.0096-.67621 1.009611 0 1h2.79493c-1.0479 1.117288-1.7641 1.668027-2.82812 2.732043-.62065.56444.28321 1.468319.84765.847657 1.06063-1.101282 1.59202-1.777197 2.68554-2.870716v2.791016c-.01.676162 1.00956.676162 1 0v-4c-.00003-.276131-.22387-.499973-.5-.5z'/>` +
  `<path d='m221.03217 109.33958c.67621.01.67621-1.00961 0-1h-2.79493c1.0479-1.11729 1.7641-1.66802 2.82812-2.73204.62065-.56444-.28321-1.46832-.84765-.84766-1.06063 1.10128-1.59202 1.7772-2.68554 2.87072v-2.79102c.01-.67616-1.00956-.67616-1 0v4c.00003.27613.22387.49998.5.5z'/>`;
function arrowStyle(strokeWidth: number): string {
  return `fill='white' stroke='black' stroke-width='${strokeWidth}' stroke-linejoin='round' paint-order='stroke'`;
}
function arrowGroup(rotateDeg: number): string {
  return `<g transform='rotate(${rotateDeg} 800 400)'><path d='${BLENDER_ARROW_LR}' transform='matrix(100 0 0 100 -17300 -62300)' ${arrowStyle(1.1)}/></g>`;
}
function diagGroup(rotateDeg: number): string {
  return `<g transform='rotate(${rotateDeg} 800 800)'><g transform='matrix(102.83638 0 0 100 -22165.448 -9434.479)' ${arrowStyle(1.3)}>${BLENDER_MOD_LENGTH}</g></g>`;
}
function cursorCss(groups: string, viewBox: string, fallback: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='${viewBox}'>${groups}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, ${fallback}`;
}

// Phosphor Icons `hand-fill` / `hand-grabbing-fill` (MIT) — the move cursor's open hand
// (hover) and grabbing fist (drag), filled white with a dark outline so the solid
// silhouette reads on any video at a small cursor size; hotspot at the cursor centre.
const PHOSPHOR_HAND =
  'M216,64v90.93c0,46.2-36.85,84.55-83,85.06A83.71,83.71,0,0,1,72.6,215.4C50.79,192.33,26.15,136,26.15,136a16,16,0,0,1,6.53-22.23c7.66-4,17.1-.84,21.4,6.62l21,36.44a6.09,6.09,0,0,0,6,3.09l.12,0A8.19,8.19,0,0,0,88,151.74V48a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V112a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25V32a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V120a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25V64.45c0-8.61,6.62-16,15.23-16.43A16,16,0,0,1,216,64Z';
const PHOSPHOR_HAND_GRABBING =
  'M216,104v48a88,88,0,0,1-176,0V136a16,16,0,0,1,32,0v8a8,8,0,0,0,16,0V88a16,16,0,0,1,32,0v16a8,8,0,0,0,16,0V88a16,16,0,0,1,32,0v16a8,8,0,0,0,16,0,16,16,0,0,1,32,0Z';
function handCursor(path: string, fallback: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 256 256'><path d='${path}' fill='white' stroke='black' stroke-width='14' stroke-linejoin='round' paint-order='stroke'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, ${fallback}`;
}
// ARROW_LEFTRIGHT is centred at (800,400); MOD_LENGTH at (800,800), both with the
// hotspot at the cursor centre. Straight edges use the horizontal arrow, corners the
// diagonal arrow, and move uses the small custom hands (open on hover, fist on drag).
const ARROW_VB = '0 -400 1600 1600';
const DIAG_VB = '0 0 1600 1600';
const MINIMAP_CURSORS: Record<string, string> = {
  grab: handCursor(PHOSPHOR_HAND, 'grab'),
  grabbing: handCursor(PHOSPHOR_HAND_GRABBING, 'grabbing'),
  'e-resize': cursorCss(arrowGroup(0), ARROW_VB, 'ew-resize'),
  'w-resize': cursorCss(arrowGroup(0), ARROW_VB, 'ew-resize'),
  'n-resize': cursorCss(arrowGroup(90), ARROW_VB, 'ns-resize'),
  's-resize': cursorCss(arrowGroup(90), ARROW_VB, 'ns-resize'),
  'ne-resize': cursorCss(diagGroup(0), DIAG_VB, 'nesw-resize'),
  'sw-resize': cursorCss(diagGroup(0), DIAG_VB, 'nesw-resize'),
  'nw-resize': cursorCss(diagGroup(90), DIAG_VB, 'nwse-resize'),
  'se-resize': cursorCss(diagGroup(90), DIAG_VB, 'nwse-resize'),
};
function toMinimapCursor(name: string): string {
  return MINIMAP_CURSORS[name] ?? name;
}

const BOX_W = 200;
const BOX_H = 150;
// Height of the draggable header strip (carrying the close button) above the canvas.
const HEADER_H = 14;
// Minimal gap from the container edge the minimap snaps against, so it hugs the edge
// without wasting space.
const MINIMAP_MARGIN = 4;

type MinimapEdge = 'left' | 'right' | 'top' | 'bottom';

const MINIMAP_CSS = `
.ytc-zoom-minimap {
  position: fixed;
  z-index: 9999;
  overflow: hidden;
  background: #000;
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  line-height: 0;
}
.ytc-zoom-minimap-header {
  height: ${HEADER_H}px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.6);
  cursor: move;
}
.ytc-zoom-minimap-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${HEADER_H}px;
  height: ${HEADER_H}px;
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}
.ytc-zoom-minimap-close:hover { color: #fff; }
.ytc-zoom-minimap-canvas { display: block; }
.ytc-zoom-minimap-rect {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(237, 28, 63, 0.95);
  /* The huge spread dims everything outside the viewport rect; overflow:hidden on
     the host clips it to the minimap. */
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.7),
    0 0 0 9999px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}`;

let cssInjected = false;
let host: HTMLDivElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let canvasCtx: CanvasRenderingContext2D | null = null;
let rectEl: HTMLDivElement | null = null;
let rafId = 0;
let frameSource: HTMLVideoElement | null = null;
let unsubscribe: (() => void) | null = null;
let mmW = BOX_W;
let mmH = BOX_H;
// Displayed-frame aspect last drawn, so the panel only re-fits when rotation/source changes it.
let lastDisplayedW = 0;
let lastDisplayedH = 0;
// Backing-store density for the thumbnail: 2x is plenty and caps fill rate on hidpi screens.
const MINIMAP_DPR = Math.max(
  1,
  Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
);
// True while a reframe crop drag is in progress, so the hover handler leaves the
// grab/resize cursor it set alone.
let minimapCropManipulating = false;
// True from pointerdown until release on the crop surface, so the hover handler doesn't
// overwrite the press (grabbing fist / resize) cursor before/while a drag engages.
let minimapPointerDown = false;
// True while the panel itself is being dragged to a new corner.
let panelDragging = false;
// Which edge the panel snaps to, and its free position ALONG that edge (top px for
// left/right, left px for top/bottom). Persists across show/hide within the session.
let minimapEdge: MinimapEdge = 'right';
let minimapAlong = MINIMAP_MARGIN;
// The user closed it via the × — stay hidden until the show-condition re-engages
// (e.g. reframe toggled off then on, or zoom re-entered).
let minimapClosed = false;
let wasShowable = false;

const minimapTemplate = () => html`
  <div class="ytc-zoom-minimap-header">
    <button
      class="ytc-zoom-minimap-close"
      title="Hide minimap (Shift+V; toggles back on with the same hotkey)"
    >
      ${renderUIIcon('close', 10)}
    </button>
  </div>
  <canvas class="ytc-zoom-minimap-canvas"></canvas>
  <div class="ytc-zoom-minimap-rect"></div>
`;

/** Subscribe to zoom changes so the minimap shows/updates/hides automatically. */
export function initZoomMinimap(): void {
  if (unsubscribe) return;
  if (!cssInjected) {
    injectCSS(MINIMAP_CSS, 'yt-clipper-zoom-minimap-css');
    cssInjected = true;
  }
  unsubscribe = subscribeZoom(sync);
  document.addEventListener('fullscreenchange', onFullscreenChange);
}

export function teardownZoomMinimap(): void {
  unsubscribe?.();
  unsubscribe = null;
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  destroyMinimap();
}

/** Show/hide the minimap (Shift+V). Only meaningful in a mode that shows it (reframe),
 *  where it doubles as the crop-manipulation surface; flashes feedback otherwise. */
export function toggleZoomMinimap(): void {
  if (!isZoomed() && !isReframeEnabled()) {
    flashMessage('Zoom minimap is only available in reframe mode', 'grey');
    return;
  }
  minimapClosed = !minimapClosed;
  sync();
  flashMessage(`Zoom minimap: ${minimapClosed ? 'off' : 'on'}`, minimapClosed ? 'grey' : 'olive');
}

// Entering/leaving fullscreen changes which element a fixed minimap is visible in, so
// re-home it and re-clamp its position to the (possibly new) viewport.
function onFullscreenChange(): void {
  if (!host) return;
  minimapParent().appendChild(host);
  applyMinimapPosition();
}

function sync(): void {
  // Show in reframe even at 1x: there the minimap is the crop-manipulation surface,
  // not just a zoom navigator.
  const showable = isZoomed() || isReframeEnabled();
  // Re-entering the mode (off→on) clears a prior manual close, so the minimap comes
  // back without persisting a "closed forever" state.
  if (showable && !wasShowable) minimapClosed = false;
  wasShowable = showable;
  if (showable && !minimapClosed) {
    ensureMinimap();
    // During playback the minimap's own requestVideoFrameCallback loop already redraws the
    // canvas each presented frame, so skip the redundant full-frame redraw here — reframe
    // fires this subscriber every frame as the viewport follows the crop. When paused that
    // loop is idle, so a viewport change from an edit still needs an explicit redraw.
    if (appState.video.paused) redrawZoomMinimap();
    updateRect();
  } else {
    destroyMinimap();
  }
}

/** Re-render the thumbnail (e.g. after a rotation change while paused). No-op if hidden. */
export function redrawZoomMinimap(): void {
  if (!host) return;
  drawFrame();
}

function displayedFrameSize(): { dW: number; dH: number } {
  const v = appState.video;
  const rotated = appState.rotation === 90 || appState.rotation === -90;
  const vw = v.videoWidth || 16;
  const vh = v.videoHeight || 9;
  return { dW: rotated ? vh : vw, dH: rotated ? vw : vh };
}

function computeSize(): void {
  const { dW, dH } = displayedFrameSize();
  const ar = dW / dH;
  if (ar >= BOX_W / BOX_H) {
    mmW = BOX_W;
    mmH = Math.round(BOX_W / ar);
  } else {
    mmH = BOX_H;
    mmW = Math.round(BOX_H * ar);
  }
  if (host) {
    host.style.width = `${mmW}px`;
    host.style.height = `${mmH + HEADER_H}px`;
  }
  if (canvasEl) {
    canvasEl.style.width = `${mmW}px`;
    canvasEl.style.height = `${mmH}px`;
  }
}

/** Pin the panel against its current edge at its free along-position (survives
 *  show/hide); the along-position is clamped to stay within the container. */
function applyMinimapPosition(): void {
  if (!host) return;
  const m = MINIMAP_MARGIN;
  const hr = host.getBoundingClientRect();
  const maxAlongX = Math.max(m, window.innerWidth - hr.width - m);
  const maxAlongY = Math.max(m, window.innerHeight - hr.height - m);
  host.style.top = 'auto';
  host.style.bottom = 'auto';
  host.style.left = 'auto';
  host.style.right = 'auto';
  if (minimapEdge === 'left') {
    host.style.left = `${m}px`;
    host.style.top = `${clampNumber(minimapAlong, m, maxAlongY)}px`;
  } else if (minimapEdge === 'right') {
    host.style.right = `${m}px`;
    host.style.top = `${clampNumber(minimapAlong, m, maxAlongY)}px`;
  } else if (minimapEdge === 'top') {
    host.style.top = `${m}px`;
    host.style.left = `${clampNumber(minimapAlong, m, maxAlongX)}px`;
  } else {
    host.style.bottom = `${m}px`;
    host.style.left = `${clampNumber(minimapAlong, m, maxAlongX)}px`;
  }
}

// The minimap floats over the whole window (position: fixed). In fullscreen a
// body-level fixed element is hidden, so it must live inside the fullscreen element.
function minimapParent(): HTMLElement {
  return (document.fullscreenElement as HTMLElement | null) ?? document.body;
}
function ensureMinimap(): void {
  if (host) return;
  host = document.createElement('div');
  host.className = 'ytc-zoom-minimap';
  render(minimapTemplate(), host);
  canvasEl = host.querySelector('.ytc-zoom-minimap-canvas');
  canvasCtx = canvasEl?.getContext('2d') ?? null;
  rectEl = host.querySelector('.ytc-zoom-minimap-rect');
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('pointermove', onHoverMove, true);
  minimapParent().appendChild(host);
  computeSize();
  applyMinimapPosition();
  startLoop();
}

function destroyMinimap(): void {
  stopLoop();
  if (host) {
    host.removeEventListener('pointerdown', onPointerDown, true);
    host.removeEventListener('pointermove', onHoverMove, true);
    render(null, host);
    host.remove();
  }
  host = null;
  canvasEl = null;
  canvasCtx = null;
  rectEl = null;
}

function startLoop(): void {
  stopLoop();
  const v = appState.video;
  frameSource = v;
  const draw = (): void => {
    if (!host) return;
    drawFrame();
    rafId = v.requestVideoFrameCallback(draw);
  };
  drawFrame();
  rafId = v.requestVideoFrameCallback(draw);
}

function stopLoop(): void {
  if (rafId && frameSource) frameSource.cancelVideoFrameCallback(rafId);
  rafId = 0;
  frameSource = null;
}

function drawFrame(): void {
  if (!canvasEl) return;
  const source = appState.video;
  const vw = source.videoWidth;
  const vh = source.videoHeight;
  if (!vw || !vh) return;
  const { dW, dH } = displayedFrameSize();
  // Re-fit the panel only when the displayed-frame aspect changes (rotation or source swap).
  if (lastDisplayedW !== dW || lastDisplayedH !== dH) {
    lastDisplayedW = dW;
    lastDisplayedH = dH;
    computeSize();
    updateRect();
  }
  const ctx = canvasCtx;
  if (!ctx) return;
  // Size the backing store to the on-screen thumbnail (x dpr), not the full frame: rasterizing a
  // 1080p frame each tick just to show a ~180px thumbnail wastes fill rate. Pre-scale the context
  // so the source-space draw below (frame + crop rect, rotated together) is otherwise unchanged.
  const bw = Math.max(1, Math.round(mmW * MINIMAP_DPR));
  const bh = Math.max(1, Math.round(mmH * MINIMAP_DPR));
  if (canvasEl.width !== bw || canvasEl.height !== bh) {
    canvasEl.width = bw;
    canvasEl.height = bh;
  }
  ctx.save();
  ctx.scale(bw / dW, bh / dH);
  if (appState.rotation === 90) {
    ctx.translate(dW, 0);
    ctx.rotate(Math.PI / 2);
  } else if (appState.rotation === -90) {
    ctx.translate(0, dH);
    ctx.rotate(-Math.PI / 2);
  }
  // Draw the frame and the crop rect in the same (rotated) source space, so the
  // crop marker rotates with the frame for free.
  ctx.drawImage(source, 0, 0, vw, vh, 0, 0, vw, vh);
  drawCropMarker(ctx, vw, vh, dW);
  ctx.restore();
}

/** Outline the current crop on the minimap canvas with a thin white stroke (distinct
 *  from the red viewport rect). cropRes coords are scaled into the source frame, so
 *  the rotated context aligns it with the drawn frame. No-op when no crop is edited. */
function drawCropMarker(ctx: CanvasRenderingContext2D, vw: number, vh: number, dW: number): void {
  const crop = getCurrentCropComponents();
  if (!crop) return;
  const cw = appState.settings.cropResWidth || vw;
  const ch = appState.settings.cropResHeight || vh;
  const { x: sx, y: sy, w: sw, h: sh } = cropToTargetRect(crop, cw, ch, vw, vh);
  // Canvas is drawn at frame resolution but shown at ~mmW px, so scale the stroke
  // to read as ~1 px once scaled down.
  ctx.lineWidth = Math.max(1, dW / mmW);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeRect(sx, sy, sw, sh);
}

function updateRect(): void {
  if (!rectEl) return;
  // The viewport rect is meaningless in reframe (the view IS the crop); hide it so
  // the crop marker is the only overlay.
  if (isReframeEnabled()) {
    rectEl.style.display = 'none';
    return;
  }
  rectEl.style.display = 'block';
  const r = minimapRect(getViewport(), mmW, mmH);
  rectEl.style.left = `${r.left}px`;
  rectEl.style.top = `${HEADER_H + r.top}px`;
  rectEl.style.width = `${r.w}px`;
  rectEl.style.height = `${r.h}px`;
}

let panRafId = 0;
let pendingPan: PointerEvent | null = null;

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !host || !canvasEl) return;
  const target = e.target as HTMLElement;
  // Close button: route through the same toggle as the Shift+V hotkey so their state and
  // feedback stay in sync (the × is only shown while the minimap is, so this hides it).
  if (target.closest('.ytc-zoom-minimap-close')) {
    e.preventDefault();
    e.stopPropagation();
    toggleZoomMinimap();
    return;
  }
  // Header strip: drag the whole panel to another corner.
  if (target.closest('.ytc-zoom-minimap-header')) {
    beginPanelDrag(e);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  // In reframe the minimap manipulates the crop itself (the only overlay shown), not the zoom
  // viewport. Gate it behind Ctrl so a stray click/drag on the minimap can't move the crop by
  // accident; without Ctrl the minimap is view-only in reframe.
  if (isReframeEnabled()) {
    if (e.ctrlKey || e.metaKey) beginCropManipulation(e);
    return;
  }
  const canvas = canvasEl;
  host.setPointerCapture(e.pointerId);
  const downX = e.clientX;
  const downY = e.clientY;
  let dragging = false;
  // Reference frame captured when the drag actually begins (init + delta, like
  // crop pan) so the view never jumps to the cursor.
  let dragStartX = 0;
  let dragStartY = 0;
  let startPanX = 0;
  let startPanY = 0;
  let mapW = 1;
  let mapH = 1;

  const beginDrag = (ev: PointerEvent): void => {
    dragging = true;
    dragStartX = ev.clientX;
    dragStartY = ev.clientY;
    const v = getViewport();
    startPanX = v.panX;
    startPanY = v.panY;
    const r = canvas.getBoundingClientRect();
    mapW = r.width || 1;
    mapH = r.height || 1;
  };

  const applyPan = (ev: PointerEvent): void => {
    // Focal moves by the drag delta as a fraction of the minimap, with the shared
    // crop-pan axis locks (Shift = X, Alt = Y; both = cancel back to start).
    const { dx, dy } = lockPanAxis(ev.clientX - dragStartX, ev.clientY - dragStartY, {
      shift: ev.shiftKey,
      alt: ev.altKey,
    });
    setViewport({
      scale: getViewport().scale,
      panX: startPanX + dx / mapW,
      panY: startPanY + dy / mapH,
    });
  };

  const onMove = (ev: PointerEvent): void => {
    if (!dragging) {
      // Hold off until the pointer has clearly moved — a click should not pan.
      if (
        Math.abs(ev.clientX - downX) < DRAG_THRESHOLD &&
        Math.abs(ev.clientY - downY) < DRAG_THRESHOLD
      ) {
        return;
      }
      beginDrag(ev);
    }
    pendingPan = ev;
    if (!panRafId) {
      panRafId = requestAnimationFrame(() => {
        panRafId = 0;
        if (pendingPan) applyPan(pendingPan);
        pendingPan = null;
      });
    }
  };
  const onUp = (): void => {
    if (panRafId) cancelAnimationFrame(panRafId);
    panRafId = 0;
    pendingPan = null;
    host?.removeEventListener('pointermove', onMove, true);
    host?.removeEventListener('pointerup', onUp, true);
    host?.removeEventListener('pointercancel', onUp, true);
    try {
      host?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };
  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);
  host.addEventListener('pointercancel', onUp, true);
}

/** Drag the whole minimap panel; on release it snaps to the nearest window edge. */
function beginPanelDrag(e: PointerEvent): void {
  if (!host) return;
  e.preventDefault();
  e.stopPropagation();
  const panel = host;
  panel.setPointerCapture(e.pointerId);
  panelDragging = true;
  panel.style.cursor = 'move';
  const hr = panel.getBoundingClientRect();
  // Fixed positioning → drag and snap in viewport coordinates.
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const maxLeft = Math.max(0, viewW - hr.width);
  const maxTop = Math.max(0, viewH - hr.height);
  const startLeft = clampNumber(hr.left, 0, maxLeft);
  const startTop = clampNumber(hr.top, 0, maxTop);
  const downX = e.clientX;
  const downY = e.clientY;
  let curLeft = startLeft;
  let curTop = startTop;

  const onMove = (ev: PointerEvent): void => {
    curLeft = clampNumber(startLeft + (ev.clientX - downX), 0, maxLeft);
    curTop = clampNumber(startTop + (ev.clientY - downY), 0, maxTop);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${curLeft}px`;
    panel.style.top = `${curTop}px`;
  };
  const onUp = (): void => {
    panelDragging = false;
    panel.style.cursor = '';
    // Snap to whichever container edge the panel ended up nearest, keeping its free
    // position along that edge.
    const distLeft = curLeft;
    const distRight = viewW - (curLeft + hr.width);
    const distTop = curTop;
    const distBottom = viewH - (curTop + hr.height);
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    if (minDist === distTop) {
      minimapEdge = 'top';
      minimapAlong = curLeft;
    } else if (minDist === distBottom) {
      minimapEdge = 'bottom';
      minimapAlong = curLeft;
    } else if (minDist === distLeft) {
      minimapEdge = 'left';
      minimapAlong = curTop;
    } else {
      minimapEdge = 'right';
      minimapAlong = curTop;
    }
    applyMinimapPosition();
    panel.removeEventListener('pointermove', onMove, true);
    panel.removeEventListener('pointerup', onUp, true);
    panel.removeEventListener('pointercancel', onUp, true);
    try {
      panel.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };
  panel.addEventListener('pointermove', onMove, true);
  panel.addEventListener('pointerup', onUp, true);
  panel.addEventListener('pointercancel', onUp, true);
}

/** Map a minimap pointer position to cropRes (source-frame) coordinates. Rotation is
 *  handled HERE (display→source), so all the move/resize math downstream is
 *  rotation-agnostic. */
function minimapPointerToCropRes(
  clientX: number,
  clientY: number,
  cropResW: number,
  cropResH: number
): { cx: number; cy: number } {
  if (!canvasEl) return { cx: 0, cy: 0 };
  const r = canvasEl.getBoundingClientRect();
  const fx = clampNumber((clientX - r.left) / (r.width || 1), 0, 1);
  const fy = clampNumber((clientY - r.top) / (r.height || 1), 0, 1);
  // The minimap draws the displayed (post-rotation) frame; map the cursor back to source fractions.
  const { x: sfx, y: sfy } = unrotateFocalPoint(fx, fy, appState.rotation);
  return { cx: sfx * cropResW, cy: sfy * cropResH };
}

interface CropEdgeRegion {
  nearLeft: boolean;
  nearRight: boolean;
  nearTop: boolean;
  nearBottom: boolean;
}

/** Resize-edge region of a cropRes point relative to a crop, using the same edge band
 *  as the manipulation so the cursor and the action always agree. All-false = move. */
function cropResHoverRegion(
  cx: number,
  cy: number,
  x: number,
  y: number,
  w: number,
  h: number,
  cropResW: number,
  cropResH: number
): CropEdgeRegion {
  const edgeX = Math.min(w * RESIZE_EDGE_FRAC, cropResW * RESIZE_EDGE_MAX_FRAME_FRAC);
  const edgeY = Math.min(h * RESIZE_EDGE_FRAC, cropResH * RESIZE_EDGE_MAX_FRAME_FRAC);
  const inside = cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  const nearLeft = inside && cx <= x + edgeX;
  const nearRight = inside && !nearLeft && cx >= x + w - edgeX;
  const nearTop = inside && cy <= y + edgeY;
  const nearBottom = inside && !nearTop && cy >= y + h - edgeY;
  return { nearLeft, nearRight, nearTop, nearBottom };
}

/** Map a cropRes edge region to a resize/move cursor, rotating the edge labels into the
 *  displayed orientation so the arrows match what the user sees ('grab' = move). */
function regionCursor(r: CropEdgeRegion): string {
  let dN: boolean;
  let dE: boolean;
  let dS: boolean;
  let dW: boolean;
  if (appState.rotation === 90) {
    dN = r.nearLeft;
    dS = r.nearRight;
    dE = r.nearTop;
    dW = r.nearBottom;
  } else if (appState.rotation === -90) {
    dS = r.nearLeft;
    dN = r.nearRight;
    dW = r.nearTop;
    dE = r.nearBottom;
  } else {
    dW = r.nearLeft;
    dE = r.nearRight;
    dN = r.nearTop;
    dS = r.nearBottom;
  }
  if (dN && dW) return 'nw-resize';
  if (dN && dE) return 'ne-resize';
  if (dS && dW) return 'sw-resize';
  if (dS && dE) return 'se-resize';
  if (dN) return 'n-resize';
  if (dS) return 's-resize';
  if (dE) return 'e-resize';
  if (dW) return 'w-resize';
  return 'grab';
}

/** Reframe: show move/resize cursors over the crop, matching the on-video handler.
 *  Outside reframe the minimap keeps its default (pan) cursor. */
function onHoverMove(e: PointerEvent): void {
  if (minimapCropManipulating || panelDragging || minimapPointerDown || !host) return;
  if (!isReframeEnabled()) {
    host.style.cursor = '';
    return;
  }
  // Crop manipulation is Ctrl-gated, so only show the grab/resize affordance with Ctrl held;
  // otherwise the minimap is view-only, so show the normal cursor (not the panel's grab cursor).
  if (!(e.ctrlKey || e.metaKey)) {
    host.style.cursor = 'default';
    return;
  }
  const cropResW = appState.settings.cropResWidth || 1;
  const cropResH = appState.settings.cropResHeight || 1;
  const crop = getCurrentCropComponents();
  if (!crop) {
    host.style.cursor = 'grab';
    return;
  }
  const { cx, cy } = minimapPointerToCropRes(e.clientX, e.clientY, cropResW, cropResH);
  host.style.cursor = toMinimapCursor(
    regionCursor(cropResHoverRegion(cx, cy, crop[0], crop[1], crop[2], crop[3], cropResW, cropResH))
  );
}

/** Reframe: drag on the minimap to move the crop, or grab an edge to resize it.
 *  Auto-keys at the current time (like a manipulation on the video), edits via the
 *  shared `updateCropString`, and commits the whole gesture as one undo step. */
function beginCropManipulation(e: PointerEvent): void {
  const pair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!pair || appState.wasGlobalSettingsEditorOpen || !host || !canvasEl) return;
  host.setPointerCapture(e.pointerId);
  const downX = e.clientX;
  const downY = e.clientY;
  minimapPointerDown = true;
  // Immediate press feedback: the grabbing fist for a move (or the resize cursor on an
  // edge) right on pointerdown, so click-and-hold shows it before the drag threshold.
  const pressCrop = getCurrentCropComponents();
  if (host && pressCrop) {
    const pw = appState.settings.cropResWidth || 1;
    const ph = appState.settings.cropResHeight || 1;
    const p = minimapPointerToCropRes(downX, downY, pw, ph);
    const r = cropResHoverRegion(
      p.cx,
      p.cy,
      pressCrop[0],
      pressCrop[1],
      pressCrop[2],
      pressCrop[3],
      pw,
      ph
    );
    const pressResize = r.nearLeft || r.nearRight || r.nearTop || r.nearBottom;
    host.style.cursor = toMinimapCursor(pressResize ? regionCursor(r) : 'grabbing');
  }

  let active = false;
  let cropResW = 1;
  let cropResH = 1;
  let x0 = 0;
  let y0 = 0;
  let w0 = 0;
  let h0 = 0;
  let startCx = 0;
  let startCy = 0;
  let nearLeft = false;
  let nearRight = false;
  let nearTop = false;
  let nearBottom = false;
  let isResize = false;
  let initCropMap: CropPoint[] | undefined;
  let rafId = 0;
  let pending: PointerEvent | null = null;

  // Deferred until the pointer actually moves, so a stray click never auto-keys.
  const begin = (): void => {
    active = true;
    autoKeyCurrentCropPoint();
    cropResW = appState.settings.cropResWidth || 1;
    cropResH = appState.settings.cropResHeight || 1;
    [x0, y0, w0, h0] = getCropComponents(getRelevantCropString());
    initCropMap = getCropMapProperties().initCropMap ?? undefined;
    const s = minimapPointerToCropRes(downX, downY, cropResW, cropResH);
    startCx = s.cx;
    startCy = s.cy;
    const region = cropResHoverRegion(startCx, startCy, x0, y0, w0, h0, cropResW, cropResH);
    nearLeft = region.nearLeft;
    nearRight = region.nearRight;
    nearTop = region.nearTop;
    nearBottom = region.nearBottom;
    isResize = nearLeft || nearRight || nearTop || nearBottom;
    // A minimap edge-resize is a per-keyframe zoom — switch to zoompan before `apply`
    // writes the size, so it lands on this keyframe instead of all of them. A move
    // (pan) is mode-agnostic, so leave it alone.
    if (isResize) ensureReframeZoomPan();
    setIsMouseManipulatingCrop(true);
    setCropManipulationKind(isResize ? 'resize' : 'drag');
    minimapCropManipulating = true;
    if (host) host.style.cursor = toMinimapCursor(isResize ? regionCursor(region) : 'grabbing');
  };

  const apply = (ev: PointerEvent): void => {
    const now = minimapPointerToCropRes(ev.clientX, ev.clientY, cropResW, cropResH);
    const dcx = now.cx - startCx;
    const dcy = now.cy - startCy;
    let nx = x0;
    let ny = y0;
    let nw = w0;
    let nh = h0;
    if (!isResize) {
      nx = clampNumber(x0 + dcx, 0, cropResW - w0);
      ny = clampNumber(y0 + dcy, 0, cropResH - h0);
    } else {
      if (nearLeft) {
        nx = clampNumber(x0 + dcx, 0, x0 + w0 - CROP_MIN);
        nw = x0 + w0 - nx;
      } else if (nearRight) {
        nw = clampNumber(w0 + dcx, CROP_MIN, cropResW - x0);
      }
      if (nearTop) {
        ny = clampNumber(y0 + dcy, 0, y0 + h0 - CROP_MIN);
        nh = y0 + h0 - ny;
      } else if (nearBottom) {
        nh = clampNumber(h0 + dcy, CROP_MIN, cropResH - y0);
      }
    }
    updateCropString(getCropString(nx, ny, nw, nh), false, false, initCropMap);
    // Paused during manipulation, so the rVFC loop is idle — redraw the minimap here
    // so its crop marker tracks the edit.
    drawFrame();
  };

  const onMove = (ev: PointerEvent): void => {
    if (!active) {
      if (
        Math.abs(ev.clientX - downX) < DRAG_THRESHOLD &&
        Math.abs(ev.clientY - downY) < DRAG_THRESHOLD
      ) {
        return;
      }
      begin();
    }
    pending = ev;
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (pending) apply(pending);
        pending = null;
      });
    }
  };

  const onUp = (ev: PointerEvent): void => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pending = null;
    minimapCropManipulating = false;
    minimapPointerDown = false;
    if (active) {
      setIsMouseManipulatingCrop(false);
      setCropManipulationKind(null);
      // One checkpoint for the whole gesture (auto-key insert + edits), matching the
      // video crop handler — the per-edit updateCropString calls don't push history.
      saveMarkerPairHistory(createDraft(getMarkerPairHistory(pair)), pair);
      renderSpeedAndCropUI();
      drawFrame();
    }
    host?.removeEventListener('pointermove', onMove, true);
    host?.removeEventListener('pointerup', onUp, true);
    host?.removeEventListener('pointercancel', onUp, true);
    // Restore the hover cursor for where the pointer ended up (open hand / resize),
    // instead of leaving the default crosshair until the next move.
    onHoverMove(ev);
    try {
      host?.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };

  host.addEventListener('pointermove', onMove, true);
  host.addEventListener('pointerup', onUp, true);
  host.addEventListener('pointercancel', onUp, true);
}
