import { html, render } from 'lit-html';
import { createWebGLGammaRenderer, prevGammaVal, WebGLGammaRenderer } from '../util/previewGamma';
import { appState } from '../appState';
import { computeARChange, computeARLockedResize } from './preview-resize-math';

export type FloatingVideoPreviewOptions = {
  parent?: HTMLElement;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: number;
  zIndex?: number;
  mirror?: boolean;
  /** When provided, renders a cropped/zoomed canvas instead of the full video.
   *  Returns [x, y, w, h] in source video pixel coordinates. */
  getSourceRect?: () => [x: number, y: number, w: number, h: number];
  /** When provided, shows a button that destroys this floating preview and switches to the modal view. */
  onSwitchToModal?: () => void;
  /** Called when the preview is destroyed (e.g. close button). */
  onDestroy?: () => void;
  /** If set, the next popout window will open at this screen position/size. */
  initialPopoutBounds?: { screenX: number; screenY: number; width: number; height: number };
  /** Called just before a popped-out window closes, with its final screen position/size. */
  onPopoutClose?: (bounds: { screenX: number; screenY: number; width: number; height: number }) => void;
};

export type FloatingVideoPreviewHandle = {
  element: HTMLDivElement;
  destroy: (silent?: boolean) => void;
  /** Trigger a one-shot redraw — fires even when the video is paused. */
  redraw: () => void;
  /** Close any popped-out browser window created by this preview. */
  closePopup: () => void;
  /** Returns the current in-page position and size. */
  getState: () => { x: number; y: number; width: number; height: number };
  /** Programmatically trigger the pop-out to a browser window. */
  popOut: () => void;
  /** True when a pop-out browser window is currently open. */
  isPopped: () => boolean;
  /** Reset anchor to default (top-left) for the next crop modification session. */
  resetAnchor: () => void;
};

type FloatingVideoPreviewState = {
  sourceVideo: HTMLVideoElement | null;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  aspectRatio: number;
  zIndex: number;
  mirror: boolean;
  controlsVisible: boolean;
  dragging: boolean;
};

const STYLE_ID = 'floating-video-preview-lit-html-styles';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .floating-video-preview-host {
      position: absolute;
      inset: 0;
      display: block;
      pointer-events: none;
    }

    .floating-video-preview-shell {
      position: absolute;
      left: 0;
      top: 0;
      box-sizing: border-box;
      overflow: hidden;
      background: #000;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.28);
      touch-action: none;
      user-select: none;
      pointer-events: auto;
      cursor: grab;
    }

    .floating-video-preview-shell[data-dragging="true"] {
      cursor: grabbing;
    }

    .floating-video-preview-video {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
      pointer-events: none;
      transform-origin: center;
    }

    .floating-video-preview-canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: #000;
      pointer-events: none;
    }

    .floating-video-preview-topbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      row-gap: 2px;
      padding: 3px 4px;
      background: linear-gradient(to bottom, rgb(0 0 0 / 0.5) 0%, rgb(0 0 0 / 0) 100%);
      color: #fff;
      pointer-events: auto;
      opacity: 0;
      transform: translateY(-4px);
      transition:
        opacity 140ms ease,
        transform 140ms ease;
    }

    .floating-video-preview-topbar-btns {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
    }

    .floating-video-preview-shell[data-controls-visible="true"] .floating-video-preview-topbar {
      opacity: 1;
      transform: translateY(0);
    }

    .floating-video-preview-resize-icon {
      width: 14px;
      height: 14px;
      flex: 0 0 auto;
      pointer-events: none;
      opacity: 0.85;
      background:
        linear-gradient(
          135deg,
          transparent 0 35%,
          rgb(255 255 255 / 0.88) 35% 45%,
          transparent 45% 55%,
          rgb(255 255 255 / 0.88) 55% 65%,
          transparent 65% 100%
        );
    }

    .floating-video-preview-close-btn {
      background: none;
      border: none;
      color: rgb(255 255 255 / 0.85);
      font: 16px/1 system-ui, sans-serif;
      padding: 1px 5px 2px;
      cursor: pointer;
      border-radius: 4px;
      pointer-events: auto;
      display: flex;
      align-items: center;
    }

    .floating-video-preview-close-btn:hover {
      background: rgb(255 255 255 / 0.18);
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

export function mountFloatingVideoPreview(
  sourceVideo: HTMLVideoElement,
  options: FloatingVideoPreviewOptions = {}
): FloatingVideoPreviewHandle {
  const getSourceRect = options.getSourceRect ?? null;
  const onSwitchToModal = options.onSwitchToModal ?? null;
  const onDestroy = options.onDestroy ?? null;
  const onPopoutClose = options.onPopoutClose ?? null;
  const initialPopoutBounds = options.initialPopoutBounds ?? null;
  if (!sourceVideo.isConnected) {
    throw new Error('sourceVideo must already be connected to the document');
  }

  ensureStyles();

  const parent = options.parent ?? document.body;

  if (parent !== document.body) {
    const computed = window.getComputedStyle(parent);
    if (computed.position === 'static') {
      parent.style.position = 'relative';
    }
  }

  const host = document.createElement('div');
  host.className = 'floating-video-preview-host';

  if (parent === document.body) {
    host.style.position = 'fixed';
    host.style.inset = '0';
  } else {
    host.style.position = 'absolute';
    host.style.inset = '0';
  }
  host.style.zIndex = '2147483647';

  const previewWidth = options.initialWidth ?? 240;
  const previewHeight =
    options.initialHeight ??
    (options.aspectRatio != null ? Math.round(previewWidth / options.aspectRatio) : 135);

  let initialX = options.initialX;
  let initialY = options.initialY;

  if (initialX === undefined || initialY === undefined) {
    const sourceRect = sourceVideo.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const margin = 8;
    initialX = initialX ?? sourceRect.right - parentRect.left - previewWidth - margin;
    initialY = initialY ?? sourceRect.top + margin;
  }

  const state: FloatingVideoPreviewState = {
    sourceVideo,
    x: initialX,
    y: initialY,
    width: previewWidth,
    height: previewHeight,
    minWidth: options.minWidth ?? 50,
    minHeight: options.minHeight ?? 50,
    aspectRatio: options.aspectRatio ?? 16 / 9,
    zIndex: options.zIndex ?? 1000,
    mirror: options.mirror ?? false,
    controlsVisible: false,
    dragging: false,
  };

  let previewVideoEl: HTMLVideoElement | null = null;
  let cropCanvasEl: HTMLCanvasElement | null = null;
  let gammaRenderer: WebGLGammaRenderer | null = null;
  let cropLoopId: number | null = null;
  let cropLoopSource: HTMLVideoElement | null = null;
  let shellEl: HTMLDivElement | null = null;
  let controlsHideTimer: number | null = null;
  const sourceCleanup: Array<() => void> = [];
  let destroyed = false;
  let popupWindow: Window | null = null;
  // Track previous source dimensions to determine which changed
  let lastSourceW: number | null = null;
  let lastSourceH: number | null = null;
  let lastIsRotated: boolean | null = null;
  // Track anchor preference for consistent grow/shrink behavior
  let anchorX: 'left' | 'right' = 'left';
  let anchorY: 'top' | 'bottom' = 'top';
  // Track starting position for overflow detection
  // Anchor only switches back when user has "undone" the overflow
  let startModX: number | null = null;
  let startModY: number | null = null;

  const clearHideTimer = (): void => {
    if (controlsHideTimer !== null) {
      window.clearTimeout(controlsHideTimer);
      controlsHideTimer = null;
    }
  };

  const showControls = (): void => {
    state.controlsVisible = true;
    update();
  };

  const scheduleHideControls = (): void => {
    clearHideTimer();
    controlsHideTimer = window.setTimeout(() => {
      state.controlsVisible = false;
      update();
    }, 400);
  };

  const unbindSourceEvents = (): void => {
    for (const fn of sourceCleanup) fn();
    sourceCleanup.length = 0;
  };

  const cleanupPreviewVideo = (): void => {
    if (!previewVideoEl) return;
    previewVideoEl.pause();
    previewVideoEl.removeAttribute('src');
    previewVideoEl.srcObject = null;
    previewVideoEl.load();
  };

  const stopCropLoop = (): void => {
    if (cropLoopId !== null) {
      cropLoopSource?.cancelVideoFrameCallback(cropLoopId);
      cropLoopId = null;
      cropLoopSource = null;
    }
  };

  const drawFrame = (): void => {
    if (destroyed || !cropCanvasEl || !state.sourceVideo) return;
    const source = state.sourceVideo;
    const [sx, sy, sw, sh] = getSourceRect();
    const isRotated = appState.rotation === 90 || appState.rotation === -90;
    const canvasW = isRotated ? sh : sw;
    const canvasH = isRotated ? sw : sh;
    if (cropCanvasEl.width !== canvasW) cropCanvasEl.width = canvasW;
    if (cropCanvasEl.height !== canvasH) cropCanvasEl.height = canvasH;

    const newAR = canvasW / canvasH;
    if (Math.abs(newAR - state.aspectRatio) > 0.001) {
      const hostRect = host.getBoundingClientRect();
      const rotationChanged = lastIsRotated !== null && isRotated !== lastIsRotated;

      if (rotationChanged) {
        // Swap width and height to reflect the landscape↔portrait flip
        const swappedW = Math.max(state.minWidth, Math.min(state.height, hostRect.width - state.x));
        const swappedH = Math.max(state.minHeight, Math.min(state.width, hostRect.height - state.y));
        state.width = swappedW;
        state.height = swappedH;
        state.aspectRatio = newAR;
        anchorX = 'left';
        anchorY = 'top';
        startModX = null;
        startModY = null;
      } else {
        // Regular AR change (crop resize) — determine which source dimension changed more
        let lockDimension: 'width' | 'height' = 'width';
        if (lastSourceW !== null && lastSourceH !== null) {
          const wChange = Math.abs(sw - lastSourceW);
          const hChange = Math.abs(sh - lastSourceH);
          lockDimension = hChange > wChange ? 'width' : 'height';
          // When rotated 90°, canvas axes are swapped relative to source, so invert lock dimension
          if (isRotated) lockDimension = lockDimension === 'width' ? 'height' : 'width';
        }

        // Track starting position when modification begins (anchor is still left/top)
        // This is used to determine when the user has "undone" the overflow
        if (anchorX === 'left' && startModX === null) {
          startModX = state.x;
        }
        if (anchorY === 'top' && startModY === null) {
          startModY = state.y;
        }

        const r = computeARChange({
          x: state.x, y: state.y, width: state.width, height: state.height,
          minWidth: state.minWidth, minHeight: state.minHeight,
          newAR, viewportW: hostRect.width, viewportH: hostRect.height,
          lockDimension,
          anchorX,
          anchorY,
          startModX,
          startModY,
        });
        state.x = r.x; state.y = r.y;
        state.width = r.width; state.height = r.height;
        state.aspectRatio = newAR;
        // Update anchor tracking based on which anchors were actually used
        anchorX = r.anchorX;
        anchorY = r.anchorY;
      }
      update();
    }

    // Update tracked dimensions for next comparison
    lastSourceW = sw;
    lastSourceH = sh;
    lastIsRotated = isRotated;

    const ctx = cropCanvasEl.getContext('2d');
    if (ctx) {
      ctx.save();
      if (appState.rotation === 90) {
        ctx.translate(canvasW, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      } else if (appState.rotation === -90) {
        ctx.translate(0, canvasH);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      } else {
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      }
      ctx.restore();

      if (appState.isGammaPreviewOn) {
        if (!gammaRenderer) gammaRenderer = createWebGLGammaRenderer(cropCanvasEl);
        gammaRenderer.render(cropCanvasEl, prevGammaVal);
        ctx.drawImage(gammaRenderer.outputCanvas, 0, 0);
      }
    }
  };

  const startCropLoop = (): void => {
    if (!getSourceRect || !state.sourceVideo || destroyed) return;
    stopCropLoop();

    const source = state.sourceVideo;
    const draw = (): void => {
      if (destroyed) return;
      drawFrame();
      cropLoopId = source.requestVideoFrameCallback(draw);
    };

    cropLoopSource = source;
    cropLoopId = source.requestVideoFrameCallback(draw);
  };

  let redraw = (): void => {
    if (!getSourceRect || !state.sourceVideo || destroyed) return;
    drawFrame();
  };

  const syncFromSource = (): void => {
    if (!(state.sourceVideo instanceof HTMLVideoElement) || !previewVideoEl) {
      return;
    }

    const source = state.sourceVideo;
    const preview = previewVideoEl;

    if (source.srcObject instanceof MediaStream) {
      if (preview.srcObject !== source.srcObject) {
        preview.srcObject = source.srcObject;
      }
      void preview.play().catch(() => {});
      return;
    }

    const captureCandidate = source as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };

    const captured = captureCandidate.captureStream?.() ?? captureCandidate.mozCaptureStream?.();

    if (captured) {
      if (preview.srcObject !== captured) {
        preview.srcObject = captured;
      }
      void preview.play().catch(() => {});
      return;
    }

    if (source.currentSrc && preview.src !== source.currentSrc) {
      preview.srcObject = null;
      preview.src = source.currentSrc;
      preview.currentTime = source.currentTime || 0;
      void preview.play().catch(() => {});
    }
  };

  const bindSourceEvents = (): void => {
    if (!(state.sourceVideo instanceof HTMLVideoElement)) return;

    if (getSourceRect) {
      state.sourceVideo.addEventListener('play', startCropLoop);
      sourceCleanup.push(() => state.sourceVideo?.removeEventListener('play', startCropLoop));
    } else {
      const pause = (): void => {
        previewVideoEl?.pause();
      };

      state.sourceVideo.addEventListener('loadedmetadata', syncFromSource);
      state.sourceVideo.addEventListener('play', syncFromSource);
      state.sourceVideo.addEventListener('pause', pause);
      state.sourceVideo.addEventListener('emptied', cleanupPreviewVideo);

      sourceCleanup.push(() =>
        state.sourceVideo?.removeEventListener('loadedmetadata', syncFromSource)
      );
      sourceCleanup.push(() => state.sourceVideo?.removeEventListener('play', syncFromSource));
      sourceCleanup.push(() => state.sourceVideo?.removeEventListener('pause', pause));
      sourceCleanup.push(() =>
        state.sourceVideo?.removeEventListener('emptied', cleanupPreviewVideo)
      );
    }
  };

  const closePopup = (): void => {
    if (popupWindow && !popupWindow.closed) {
      popupWindow.close();
    }
    popupWindow = null;
  };

  const popOutWithSourceRect = (source: HTMLVideoElement): void => {
    const [, , sw, sh] = getSourceRect!();
    const pb = initialPopoutBounds;
    // When rotated 90° or -90°, swap width and height for the popup window
    const isRotated = appState.rotation === 90 || appState.rotation === -90;
    const popupW = isRotated ? sh : sw;
    const popupH = isRotated ? sw : sh;
    const features = `popup=yes,width=${pb?.width ?? popupW},height=${pb?.height ?? popupH}${pb ? `,left=${pb.screenX},top=${pb.screenY}` : ''}`;
    const popup = window.open('', '_blank', features);
    if (!popup) return;
    popupWindow = popup;

    popup.document.title = 'Video Preview';
    popup.document.body.style.cssText =
      'margin:0;padding:0;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;';

    const canvas = popup.document.createElement('canvas');
    // Canvas dimensions are swapped when rotated
    const canvasW = isRotated ? sh : sw;
    const canvasH = isRotated ? sw : sh;
    canvas.style.cssText = 'display:block;';
    canvas.width = canvasW;
    canvas.height = canvasH;
    popup.document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let popupLoopId: number | null = null;
    let popupGammaRenderer: WebGLGammaRenderer | null = null;
    const drawOnce = (): void => {
      if (popup.closed || !ctx) return;
      const [sx, sy, fsw, fsh] = getSourceRect!();
      // Canvas dimensions are swapped when rotated — check live since rotation can change after pop-out
      const isNowRotated = appState.rotation === 90 || appState.rotation === -90;
      const fcw = isNowRotated ? fsh : fsw;
      const fch = isNowRotated ? fsw : fsh;
      const vpW = popup.innerWidth || fcw;
      const vpH = popup.innerHeight || fch;
      const scale = Math.min(vpW / fcw, vpH / fch);
      const displayW = Math.floor(fcw * scale);
      const displayH = Math.floor(fch * scale);
      if (canvas.width !== fcw || canvas.height !== fch ||
          canvas.style.width !== displayW + 'px' || canvas.style.height !== displayH + 'px') {
        canvas.width = fcw;
        canvas.height = fch;
        canvas.style.width = displayW + 'px';
        canvas.style.height = displayH + 'px';
      }

      // Apply rotation transform if needed
      ctx.save();
      if (appState.rotation === 90) {
        ctx.translate(canvas.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(source, sx, sy, fsw, fsh, 0, 0, fsw, fsh);
      } else if (appState.rotation === -90) {
        ctx.translate(0, canvas.height);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(source, sx, sy, fsw, fsh, 0, 0, fsw, fsh);
      } else {
        ctx.drawImage(source, sx, sy, fsw, fsh, 0, 0, fsw, fsh);
      }
      ctx.restore();

      if (appState.isGammaPreviewOn) {
        if (!popupGammaRenderer) popupGammaRenderer = createWebGLGammaRenderer(canvas);
        popupGammaRenderer.render(canvas, prevGammaVal);
        ctx.drawImage(popupGammaRenderer.outputCanvas, 0, 0);
      }
    };
    const drawFrame = (): void => {
      if (popup.closed) return;
      drawOnce();
      popupLoopId = source.requestVideoFrameCallback(drawFrame);
    };

    popupLoopId = source.requestVideoFrameCallback(drawFrame);
    popup.addEventListener('beforeunload', () => {
      if (popupLoopId !== null) source.cancelVideoFrameCallback(popupLoopId);
      popupGammaRenderer?.destroy();
      popupGammaRenderer = null;
      onPopoutClose?.({ screenX: popup.screenX, screenY: popup.screenY, width: popup.outerWidth, height: popup.outerHeight });
      popupWindow = null;
      redraw = () => {};
      onDestroy?.();
    });
    redraw = drawOnce;
    redraw();

    destroy(true);
  };

  const popOutWithVideo = (source: HTMLVideoElement): void => {
    const w = source.videoWidth || 640;
    const h = source.videoHeight || 360;
    const pb = initialPopoutBounds;
    const features = `popup=yes,width=${pb?.width ?? w},height=${pb?.height ?? h}${pb ? `,left=${pb.screenX},top=${pb.screenY}` : ''}`;
    const popup = window.open('', '_blank', features);
    if (!popup) return;
    popupWindow = popup;

    popup.document.title = 'Video Preview';
    popup.document.body.style.cssText = 'margin:0;padding:0;background:#000;overflow:hidden;';

    const vid = popup.document.createElement('video');
    vid.style.cssText = 'width:100%;height:100%;display:block;background:#000;';
    vid.muted = true;
    vid.autoplay = true;
    vid.playsInline = true;
    popup.document.body.appendChild(vid);

    const captureCandidate = source as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const stream = captureCandidate.captureStream?.() ?? captureCandidate.mozCaptureStream?.();

    if (stream) {
      vid.srcObject = stream;
    } else if (source.currentSrc) {
      vid.src = source.currentSrc;
      vid.currentTime = source.currentTime;
    }

    void vid.play().catch(() => {});
    popup.addEventListener('beforeunload', () => {
      onPopoutClose?.({ screenX: popup.screenX, screenY: popup.screenY, width: popup.outerWidth, height: popup.outerHeight });
      popupWindow = null;
      onDestroy?.();
    });
    destroy(true);
  };

  const popOut = (): void => {
    const source = state.sourceVideo;
    if (!source) return;

    if (getSourceRect) {
      popOutWithSourceRect(source);
    } else {
      popOutWithVideo(source);
    }
  };

  const destroy = (silent = false): void => {
    if (destroyed) return;
    destroyed = true;
    clearHideTimer();
    teardownInteract?.();
    teardownInteract = null;
    unbindSourceEvents();
    stopCropLoop();
    gammaRenderer?.destroy();
    gammaRenderer = null;
    cleanupPreviewVideo();
    render(null, host);
    host.remove();
    if (!silent) onDestroy?.();
  };

  const template = () => html`
    <div
      class="floating-video-preview-shell"
      data-controls-visible=${String(state.controlsVisible)}
      data-dragging=${String(state.dragging)}
      style=${[
        `transform: translate(${state.x}px, ${state.y}px)`,
        `width: ${state.width}px`,
        `height: ${state.height}px`,
        `z-index: ${state.zIndex}`,
      ].join('; ')}
      tabindex="0"
      aria-label="Floating video preview"
    >
      ${getSourceRect
        ? html`<canvas class="floating-video-preview-canvas"></canvas>`
        : html`<video
            class="floating-video-preview-video"
            muted
            playsinline
            autoplay
            style=${`transform: ${state.mirror ? 'scaleX(-1)' : 'none'}`}
          ></video>`}

      <div class="floating-video-preview-topbar" role="toolbar" aria-label="Preview controls">
        <div class="floating-video-preview-resize-icon" aria-hidden="true"></div>
        <div class="floating-video-preview-topbar-btns">
          <button
            class="floating-video-preview-close-btn"
            @click=${() => popOut()}
            aria-label="Pop out preview"
            title="Pop out to window"
          >
            ⧉
          </button>
          ${onSwitchToModal
            ? html`<button
                class="floating-video-preview-close-btn"
                @click=${(e: MouseEvent) => {
                  e.stopPropagation();
                  destroy(true);
                  onSwitchToModal();
                }}
                aria-label="Switch to modal view"
                title="Switch to modal view"
              >
                ⊞
              </button>`
            : ''}
          <button
            class="floating-video-preview-close-btn"
            @click=${() => destroy()}
            aria-label="Close preview"
            title="Close preview"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  `;

  let teardownInteract: (() => void) | null = null;

  const setupInteract = (): void => {
    teardownInteract?.();
    teardownInteract = null;
    if (!shellEl) return;

    const shell = shellEl;

    type ResizeEdges = { left: boolean; right: boolean; top: boolean; bottom: boolean };

    const getResizeMargin = (w: number, h: number): number => {
      // Scale margin with preview size: 15% of smaller dimension, clamped to [8, 25]
      const smaller = Math.min(w, h);
      return Math.max(8, Math.min(25, Math.round(smaller * 0.15)));
    };

    const getEdges = (e: PointerEvent): ResizeEdges => {
      const r = shell.getBoundingClientRect();
      const margin = getResizeMargin(r.width, r.height);
      return {
        left: e.clientX - r.left < margin,
        right: r.right - e.clientX < margin,
        top: e.clientY - r.top < margin,
        bottom: r.bottom - e.clientY < margin,
      };
    };

    const edgeCursor = ({ left, right, top, bottom }: ResizeEdges): string => {
      if ((top && left) || (bottom && right)) return 'nwse-resize';
      if ((top && right) || (bottom && left)) return 'nesw-resize';
      if (left || right) return 'ew-resize';
      if (top || bottom) return 'ns-resize';
      return 'grab';
    };

    const applyDirect = (): void => {
      shell.style.transform = `translate(${state.x}px, ${state.y}px)`;
      shell.style.width = `${state.width}px`;
      shell.style.height = `${state.height}px`;
    };

    let mode: 'none' | 'drag' | 'resize' = 'none';
    let capturedId: number | null = null;
    let resizeEdges: ResizeEdges = { left: false, right: false, top: false, bottom: false };
    let startPx = 0,
      startPy = 0;
    let startX = 0,
      startY = 0,
      startW = 0,
      startH = 0;

    const onPointerDown = (e: PointerEvent): void => {
      if ((e.target as HTMLElement).closest('.floating-video-preview-close-btn')) return;
      if (e.button !== 0) return;
      const edges = getEdges(e);
      const isEdge = edges.left || edges.right || edges.top || edges.bottom;
      capturedId = e.pointerId;
      startPx = e.clientX;
      startPy = e.clientY;
      startX = state.x;
      startY = state.y;
      startW = state.width;
      startH = state.height;
      shell.setPointerCapture(e.pointerId);
      if (isEdge) {
        mode = 'resize';
        resizeEdges = edges;
        shell.style.cursor = edgeCursor(edges);
      } else {
        mode = 'drag';
        state.dragging = true;
        shell.style.cursor = 'grabbing';
        update();
      }
      showControls();
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (capturedId === null || e.pointerId !== capturedId) {
        if (mode === 'none') shell.style.cursor = edgeCursor(getEdges(e));
        return;
      }
      const dx = e.clientX - startPx;
      const dy = e.clientY - startPy;

      if (mode === 'drag') {
        const hostRect = host.getBoundingClientRect();
        const intendedX = startX + dx;
        const intendedY = startY + dy;
        state.x = Math.min(Math.max(intendedX, 0), hostRect.width - state.width);
        state.y = Math.min(Math.max(intendedY, 0), hostRect.height - state.height);
        applyDirect();
        return;
      }

      // resize — derive viewport max bounds from the fixed anchor so neither
      // axis can grow beyond the viewport edge
      const hostRect = host.getBoundingClientRect();
      const anchorRight = resizeEdges.left || (resizeEdges.top && !resizeEdges.right);
      const anchorBottom = resizeEdges.top;
      const maxW = anchorRight ? startX + startW : hostRect.width - startX;
      const maxH = anchorBottom ? startY + startH : hostRect.height - startY;
      const result = computeARLockedResize({
        startX,
        startY,
        startW,
        startH,
        minW: state.minWidth,
        minH: state.minHeight,
        maxW,
        maxH,
        ar: state.aspectRatio,
        edges: resizeEdges,
        dx,
        dy,
      });
      state.x = result.x;
      state.y = result.y;
      state.width = result.w;
      state.height = result.h;
      applyDirect();
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId !== capturedId) return;
      mode = 'none';
      capturedId = null;
      state.dragging = false;
      shell.style.cursor = '';
      update();
      if (!shell.matches(':hover')) scheduleHideControls();
    };

    shell.addEventListener('pointerdown', onPointerDown);
    shell.addEventListener('pointermove', onPointerMove);
    shell.addEventListener('pointerup', onPointerUp);
    shell.addEventListener('pointercancel', onPointerUp);

    teardownInteract = (): void => {
      shell.removeEventListener('pointerdown', onPointerDown);
      shell.removeEventListener('pointermove', onPointerMove);
      shell.removeEventListener('pointerup', onPointerUp);
      shell.removeEventListener('pointercancel', onPointerUp);
    };
  };

  const bindHoverBehavior = (): void => {
    if (!shellEl) return;

    const onEnter = (): void => {
      clearHideTimer();
      showControls();
    };

    const onLeave = (): void => {
      scheduleHideControls();
    };

    shellEl.addEventListener('mouseenter', onEnter);
    shellEl.addEventListener('mouseleave', onLeave);
    shellEl.addEventListener('focusin', onEnter);
    shellEl.addEventListener('focusout', onLeave);

    sourceCleanup.push(() => {
      shellEl?.removeEventListener('mouseenter', onEnter);
      shellEl?.removeEventListener('mouseleave', onLeave);
      shellEl?.removeEventListener('focusin', onEnter);
      shellEl?.removeEventListener('focusout', onLeave);
    });
  };

  const wireDomRefs = (): void => {
    shellEl = host.querySelector<HTMLDivElement>('.floating-video-preview-shell');
    previewVideoEl = host.querySelector<HTMLVideoElement>('.floating-video-preview-video');
    cropCanvasEl = host.querySelector<HTMLCanvasElement>('.floating-video-preview-canvas');
  };

  const update = (): void => {
    if (destroyed) return;
    render(template(), host);
    wireDomRefs();
  };

  parent.appendChild(host);
  update();
  if (getSourceRect) {
    startCropLoop();
  } else {
    syncFromSource();
  }
  bindSourceEvents();
  bindHoverBehavior();
  setupInteract();

  scheduleHideControls();

  const resetAnchor = (): void => {
    anchorX = 'left';
    anchorY = 'top';
    // Reset starting position tracking for the next modification session
    startModX = null;
    startModY = null;
  };

  return {
    element: host,
    destroy,
    redraw: () => redraw(),
    closePopup,
    getState: () => ({ x: state.x, y: state.y, width: state.width, height: state.height }),
    popOut,
    isPopped: () => popupWindow !== null && !popupWindow.closed,
    resetAnchor,
  };
}
