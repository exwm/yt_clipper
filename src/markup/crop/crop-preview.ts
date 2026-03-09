import { html } from 'common-tags';
import { deleteElement, htmlToElement } from '../util/util';
import { isGammaPreviewOn, rotation, video } from '../yt_clipper';
import { createWebGLGammaRenderer, prevGammaVal, WebGLGammaRenderer } from '../util/previewGamma';
import { FloatingVideoPreviewHandle, mountFloatingVideoPreview } from './video-preview-element';

var cropPreviewCanvas: HTMLCanvasElement = null;
var gammaRenderer: WebGLGammaRenderer = null;
var floatingPreviewHandle: FloatingVideoPreviewHandle = null;
var lastMiniState: { x: number; y: number; width: number; height: number } | null = null;
var lastPopoutBounds: { screenX: number; screenY: number; width: number; height: number } | null =
  null;

export type cropPreviewMode = 'modal' | 'pop-out' | 'floating';

export function startCropPreview(
  video: HTMLVideoElement,
  toggleCallback: Function,
  getCropPreviewMouseTimeSetter: Function,
  getSourceRect?: () => [x: number, y: number, w: number, h: number],
  mode: cropPreviewMode = 'modal'
) {
  const mountModal = (): void => {
    const modalHTML = html`
      <div id="ytc-zoom-modal" class="ytc-modal">
        <div id="ytc-modal-content" class="ytc-modal-content">
          <div class="ytc-canvas-wrapper">
            <canvas id="ytc-zoom-canvas"></canvas>
          </div>
        </div>
      </div>
    `;

    const modalElement = htmlToElement(modalHTML) as HTMLElement;

    document.body.insertAdjacentElement('afterbegin', modalElement);

    const modalContent = document.getElementById('ytc-modal-content');

    cropPreviewCanvas = document.getElementById('ytc-zoom-canvas') as HTMLCanvasElement;

    gammaRenderer = createWebGLGammaRenderer(cropPreviewCanvas);
    cropPreviewCanvas.insertAdjacentElement('afterend', gammaRenderer.outputCanvas);

    setTimeout(() => {
      modalElement.addEventListener('click', (e) => {
        if (!modalContent.contains(e.target as Node)) {
          deleteElement(modalElement);
          toggleCallback();
        }
      });
    }, 0);

    modalElement.addEventListener('click', (e) => {
      if (modalContent.contains(e.target as Node)) {
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
    });

    const cropPreviewMouseTimeSetter = getCropPreviewMouseTimeSetter(modalContent);

    modalElement.addEventListener('pointerdown', cropPreviewMouseTimeSetter, true);

    toggleCropPreviewGammaPreview();
    if (getSourceRect) startDrawZoomedRegion(getSourceRect);
  };

  if (mode == 'modal') {
    mountModal();
    return;
  }

  const [, , w, h] = getSourceRect?.() ?? [0, 0, 16, 9];
  const isRotated = rotation === 90 || rotation === -90;
  let wasPopoutInThisSession = false;
  floatingPreviewHandle = mountFloatingVideoPreview(video, {
    getSourceRect,
    aspectRatio: isRotated ? h / w : w / h,
    initialX: lastMiniState?.x,
    initialY: lastMiniState?.y,
    initialWidth: lastMiniState?.width,
    initialHeight: lastMiniState?.height,
    initialPopoutBounds: lastPopoutBounds,
    onPopoutClose: (bounds) => {
      lastPopoutBounds = bounds;
      wasPopoutInThisSession = true;
    },
    onSwitchToModal: () => {
      lastMiniState = floatingPreviewHandle?.getState() ?? null;
      lastPopoutBounds = null;
      floatingPreviewHandle = null;
      mountModal();
    },
    onDestroy: () => {
      if (!wasPopoutInThisSession) {
        lastMiniState = floatingPreviewHandle?.getState() ?? null;
        lastPopoutBounds = null;
      }
      wasPopoutInThisSession = false;
      floatingPreviewHandle = null;
      toggleCallback();
    },
  });
  if (lastPopoutBounds !== null || mode == 'pop-out') {
    floatingPreviewHandle.popOut();
  }
  floatingPreviewHandle.redraw();
}

export function disableCropPreview() {
  const wasPopped = floatingPreviewHandle?.isPopped() ?? false;
  floatingPreviewHandle?.closePopup(); // if wasPopped: fires beforeunload → onPopoutClose + onDestroy
  if (!wasPopped && floatingPreviewHandle) {
    // Was floating (not popped out) and destroy will be silent — capture state now
    lastMiniState = floatingPreviewHandle.getState();
    lastPopoutBounds = null;
  }
  floatingPreviewHandle?.destroy(true);
  floatingPreviewHandle = null;
  const modal = document.getElementById('ytc-zoom-modal');
  deleteElement(modal);
}

export function startDrawZoomedRegion(getZoomRegion: Function) {
  if (!cropPreviewCanvas) return;
  const ctx = cropPreviewCanvas.getContext('2d');
  const modal = document.getElementById('ytc-zoom-modal');
  const modalContent = document.getElementsByClassName('ytc-modal-content')[0];

  const [x, y, w, h] = getZoomRegion();

  cropPreviewCanvas.width = w;
  cropPreviewCanvas.height = h;

  drawZoomedRegion(getZoomRegion, cropPreviewCanvas, ctx, modal, modalContent);
}

function drawZoomedRegion(
  getZoomRegion: Function,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  modal: HTMLElement,
  modalContent: HTMLElement
) {
  if (modal && modal.isConnected && !modal.classList.contains('hidden')) {
    const [x, y, w, h] = getZoomRegion();

    canvas.width = w;
    canvas.height = h;

    resizeModalToAspect(modalContent, w, h);

    ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);

    if (isGammaPreviewOn) {
      gammaRenderer.render(canvas, prevGammaVal);
    }

    video.requestVideoFrameCallback(() =>
      drawZoomedRegion(getZoomRegion, canvas, ctx, modal, modalContent)
    );
  }
}

function resizeModalToAspect(modalContent: HTMLElement, width: number, height: number) {
  const maxWidth = window.innerWidth * 0.95;
  const maxHeight = window.innerHeight * 0.95;
  const aspectRatio = width / height;

  let modalWidth = maxWidth;
  let modalHeight = modalWidth / aspectRatio;

  if (modalHeight > maxHeight) {
    modalHeight = maxHeight;
    modalWidth = modalHeight * aspectRatio;
  }

  modalContent.style.width = `${modalWidth}px`;
  modalContent.style.height = `${modalHeight}px`;
}

export function triggerCropPreviewRedraw() {
  floatingPreviewHandle?.redraw();
}

export function resetCropPreviewAnchor() {
  floatingPreviewHandle?.resetAnchor();
}

export function toggleCropPreviewGammaPreview() {
  floatingPreviewHandle?.redraw();
  if (!cropPreviewCanvas || !gammaRenderer) {
    return;
  }

  if (isGammaPreviewOn) {
    cropPreviewCanvas.style.display = 'none';
    gammaRenderer.outputCanvas.style.display = '';
  } else {
    cropPreviewCanvas.style.display = '';
    gammaRenderer.outputCanvas.style.display = 'none';
  }
}
