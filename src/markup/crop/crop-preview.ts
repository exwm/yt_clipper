import { html } from 'common-tags';
import { deleteElement, htmlToElement } from '../util/util';
import { isGammaPreviewOn, video } from '../yt_clipper';
import { createWebGLGammaRenderer, prevGammaVal, WebGLGammaRenderer } from '../util/previewGamma';

var cropPreviewCanvas: HTMLCanvasElement = null;
var gammaRenderer: WebGLGammaRenderer = null;

export function injectModal(
  video: HTMLVideoElement,
  toggleCallback: Function,
  getCropPreviewMouseTimeSetter: Function
) {
  const modalHTML = html`
    <div id="ytc-zoom-modal" class="ytc-modal">
      <div id="ytc-modal-content" class="ytc-modal-content">
        <div class="ytc-canvas-wrapper">
          <canvas id="ytc-zoom-canvas"></canvas>
        </div>
      </div>
    </div>
  `;

  const modalElement = htmlToElement(modalHTML);

  document.body.insertAdjacentElement('afterbegin', modalElement);

  const modalContent = document.getElementById('ytc-modal-content');

  cropPreviewCanvas = document.getElementById('ytc-zoom-canvas') as HTMLCanvasElement;

  gammaRenderer = createWebGLGammaRenderer(cropPreviewCanvas);
  cropPreviewCanvas.insertAdjacentElement('afterend', gammaRenderer.outputCanvas);

  modalElement.addEventListener('click', (e) => {
    if (!modalContent.contains(e.target)) {
      toggleCallback();
    }
  });

  modalElement.addEventListener('click', (e) => {
    if (modalContent.contains(e.target)) {
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
}

export function disableCropPreview() {
  const modal = document.getElementById('ytc-zoom-modal');
  deleteElement(modal);
}

export function startDrawZoomedRegion(getZoomRegion: Function) {
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

export function toggleCropPreviewGammaPreview() {
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
