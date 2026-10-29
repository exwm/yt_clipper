/**
 * Reframe preview drawn on a canvas. Drawing each presented frame's crop region explicitly avoids
 * the compositor shimmer the old CSS-transform preview had, and matches the exported output. The
 * <video> stays transformed (so editing coords and the crop overlay still track it) but hidden via
 * an `!important` class, since YouTube re-writes opacity:1 inline. The canvas is the video's next
 * sibling with no z-index: above the video, below the controls and crop overlay. Unrotated it
 * covers the video box; rotated, the whole player container (a rotated crop fills the area the
 * landscape box leaves empty).
 *
 * The crop draw, border and crosshair all run through the video's transform matrix
 * (applyVideoTransform), so they line up at every rotation. The SVG crop border is hidden in
 * reframe: it tracked the browser-snapped element box and shimmered on pan.
 */
import { appState } from '../appState';
import { reframeCropAtFrameTime, reframeKeyframeColor, withPresentedFrameTime } from '../charts';
import { cropCrossHairEnabled, getCropDimOpacity, setSvgCropBorderHidden } from '../crop-overlay';
import { applyReframeViewport } from './video-zoom-controller';
import { getPlayerAreaElement, getVideoTransformParams } from './video-transform';
import { resetViewport } from './video-zoom-state';
import { cropToTargetRect, videoBoxToCanvasPoint } from './video-zoom-math';
import { createWebGLGammaRenderer, prevGammaVal, WebGLGammaRenderer } from '../util/previewGamma';
import { deleteElement, injectCSS } from '../util/util';
import { onVideoFrames, VideoFrameSubscription } from '../util/video-frame-loop';
import { frameStartOf, getFPS } from '../util/videoUtil';
import { readHeldFrame } from '../util/presented-frame-clock';
import { featureFlags } from '../feature-flags';
import { bandsAround, touchedPixels, wholePixelsInside } from './reframe-canvas-pixels';
import {
  formatReframeFrameSummary,
  ReframeFrameSample,
  recordReframeFrame,
} from './reframe-frame-stats';

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
// Lazily created the first frame gamma is on, so reframe with gamma off costs no GL context.
let gammaRenderer: WebGLGammaRenderer | null = null;
let frames: VideoFrameSubscription | null = null;
let hideStyle: HTMLStyleElement | null = null;
// The crop (cropRes source coords) the last frame was drawn with. Async consumers like the crop-hover
// hit-test read this so they match exactly what's on screen, instead of recomputing the crop at the
// wall-clock time which can drift from the presented frame and disagree near a crop point.
let lastDrawnReframeCrop: [number, number, number, number] | null = null;
// YouTube re-writes opacity:1 inline on the <video>, so only an !important stylesheet rule hides it.
const HIDE_CLASS = 'ytc-reframe-video-hidden';
const HIDE_CSS = `.${HIDE_CLASS} { opacity: 0 !important; }`;
// Backing-store density, capped so a hidpi screen doesn't blow up the per-frame fill rate.
const dpr = Math.max(
  1,
  Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
);

/** True while the reframe canvas exists; it owns the display for every rotation. */
export function isReframeCanvasActive(): boolean {
  return canvas != null;
}

/** The crop (cropRes source coords) the reframe canvas drew for the current frame, or null when the
 *  canvas is inactive. Lets the crop-hover hit-test use the on-screen crop exactly. */
export function getLastDrawnReframeCrop(): [number, number, number, number] | null {
  return canvas ? lastDrawnReframeCrop : null;
}

export function initReframeCanvas(): void {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'ytc-reframe-canvas';
  Object.assign(canvas.style, {
    position: 'absolute',
    pointerEvents: 'none', // editing and control clicks pass through
    // No z-index: DOM order keeps it above the video, below the controls and crop overlay.
  });
  appState.video.insertAdjacentElement('afterend', canvas);
  hideStyle ??= injectCSS(HIDE_CSS, 'yt-clipper-reframe-hide-css');
  // The canvas draws the border itself, so hide the SVG one.
  setSvgCropBorderHidden(true);
  ctx = canvas.getContext('2d');
  startLoop();
}

export function teardownReframeCanvas(): void {
  stopLoop();
  appState.video.classList.remove(HIDE_CLASS);
  setSvgCropBorderHidden(false);
  if (hideStyle) deleteElement(hideStyle);
  hideStyle = null;
  gammaRenderer?.destroy();
  gammaRenderer = null;
  canvas?.remove();
  canvas = null;
  ctx = null;
  lastDrawnReframeCrop = null;
}

function startLoop(): void {
  stopLoop();
  const v = appState.video;
  frames = onVideoFrames(
    v,
    (frame) => {
      if (!canvas) return;
      const start = performance.now();
      drawReframeFrame(frameStartOf(frame.mediaTime), frame.image);
      if (featureFlags.reframeFrameStats) {
        recordFrameStats(v, {
          now: frame.now,
          expectedDisplayTime: frame.expectedDisplayTime ?? Infinity,
          mediaTime: frame.mediaTime,
          presentedFrames: frame.presentedFrames ?? Math.round(frame.mediaTime * getFPS()),
          drawMs: performance.now() - start,
          // Drawn from the video itself, the picture can be a newer frame than the crop's.
          drawnTime: frame.image === v ? (readHeldFrame(v)?.time ?? null) : frame.mediaTime,
        });
      }
    },
    { label: 'reframe' }
  );
  frames.redraw();
}

function recordFrameStats(
  v: HTMLVideoElement,
  timing: Pick<
    ReframeFrameSample,
    'now' | 'expectedDisplayTime' | 'mediaTime' | 'presentedFrames' | 'drawMs' | 'drawnTime'
  >
): void {
  const crop = lastDrawnReframeCrop;
  if (!crop) return;
  const [x, y, w, h] = crop;
  recordReframeFrame(
    {
      ...timing,
      playbackRate: v.playbackRate,
      cropCenterX: x + w / 2,
      cropCenterY: y + h / 2,
      cropWidth: w,
    },
    getFPS(),
    (summary) => {
      console.log(formatReframeFrameSummary(summary));
      if (canvas) canvas.dataset.reframeFrameStats = JSON.stringify(summary);
    }
  );
}

function stopLoop(): void {
  frames?.stop();
  frames = null;
}

/** Redraw outside the video frame loop. Paused edits present no new frames (the loop is idle), so
 *  the controller calls this on each edit. */
export function redrawReframeCanvas(): void {
  if (canvas) frames?.redraw();
}

/** No active crop (no marker pair selected and global settings closed) or no frame yet: show the
 *  plain, untransformed video instead of a black/frozen canvas. Keeps reframe armed, so it resumes
 *  when a crop becomes available again. */
function fallBackToPlainVideo(): void {
  appState.video.classList.remove(HIDE_CLASS);
  resetViewport(); // drop the reframe zoom/pan so the video shows at its normal scale
  if (canvas && ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/** Draws the crop at `mediaTime` from `source`: the frame at that time, or the video. */
export function drawReframeFrame(
  mediaTime: number,
  source: CanvasImageSource = appState.video
): void {
  if (!canvas || !ctx) return;
  // Re-attach if YouTube re-rendered the player and dropped the canvas (the video persists,
  // since this rVFC still fires).
  if (!canvas.isConnected) appState.video.insertAdjacentElement('afterend', canvas);

  const v = appState.video;
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const boxW = v.offsetWidth;
  const boxH = v.offsetHeight;
  const crop = vw && vh && boxW && boxH ? reframeCropAtFrameTime(mediaTime) : null;
  lastDrawnReframeCrop = crop;
  if (!crop) {
    fallBackToPlainVideo();
    return;
  }
  // Hide the transformed video; the canvas draws the visible pixels.
  v.classList.add(HIDE_CLASS);
  // Sync the hidden video transform to this frame's crop so editing coords and the matrix below
  // match. Pin the crop clock to this frame so anything the sync reads resolves the same crop, not
  // the wall-clock crop a hair off.
  withPresentedFrameTime(mediaTime, () => applyReframeViewport(crop));

  // Same transform params the hidden video and overlay derive from, so the drawn crop, border, and
  // crosshair coincide with them at every rotation.
  const { rotation, rotated, scale, fsScale, tx, ty } = getVideoTransformParams();
  // Cover the whole video player area, not just the (letterboxed) video box: the reframe output is
  // the crop and should use the full area, so a portrait video in a wide player fills the side bars
  // and a rotated crop fills the area the landscape box leaves empty. getPlayerAreaElement must be the
  // SAME element centerVideo fits the box against, or the two disagree on what "the player area" is.
  // The box is centred in the player, so its centre (the rotate pivot and crop focal anchor) is the
  // video's offset plus half its box.
  const player = getPlayerAreaElement();
  const canvasLeft = 0;
  const canvasTop = 0;
  const canvasW = player.clientWidth;
  const canvasH = player.clientHeight;
  const boxCenterX = v.offsetLeft + boxW / 2;
  const boxCenterY = v.offsetTop + boxH / 2;
  if (!canvasW || !canvasH) {
    fallBackToPlainVideo(); // container not sized yet (transient): show the plain video meanwhile
    return;
  }
  canvas.style.left = `${canvasLeft}px`;
  canvas.style.top = `${canvasTop}px`;
  canvas.style.width = `${canvasW}px`;
  canvas.style.height = `${canvasH}px`;
  const bw = Math.round(canvasW * dpr);
  const bh = Math.round(canvasH * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  const CRW = appState.settings.cropResWidth || vw;
  const CRH = appState.settings.cropResHeight || vh;
  // Crop rect in the video's local box (CSS px), before the transform.
  const { x: clipX, y: clipY, w: clipW, h: clipH } = cropToTargetRect(crop, CRW, CRH, boxW, boxH);

  const c = ctx;
  const applyVideoMatrix = (): void => {
    c.scale(dpr, dpr); // work in CSS px; backing store is dpr-scaled
    c.translate(boxCenterX, boxCenterY);
    c.translate(tx, ty);
    c.scale(scale, scale);
    c.rotate((rotation * Math.PI) / 180);
    c.scale(fsScale, fsScale);
    c.translate(-boxW / 2, -boxH / 2);
  };

  // The crop rect's canvas bounds (CSS px): the axis-aligned bounds of its transformed corners,
  // exact for 0/±90°. The black bars and the border below both use them.
  const toCanvasCss = (px: number, py: number): [number, number] =>
    videoBoxToCanvasPoint(px, py, {
      rotation,
      rotated,
      scale,
      fsScale,
      boxW,
      boxH,
      tx,
      ty,
      boxCenterX,
      boxCenterY,
    });
  const corners = [
    toCanvasCss(clipX, clipY),
    toCanvasCss(clipX + clipW, clipY),
    toCanvasCss(clipX + clipW, clipY + clipH),
    toCanvasCss(clipX, clipY + clipH),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const cropLeft = Math.min(...xs);
  const cropTop = Math.min(...ys);
  const cropRight = Math.max(...xs);
  const cropBottom = Math.max(...ys);
  // The device pixels the opaque crop covers wholly: nothing drawn under them can show.
  const coveredPixels = wholePixelsInside(
    cropLeft * dpr,
    cropTop * dpr,
    cropRight * dpr,
    cropBottom * dpr,
    canvas.width,
    canvas.height
  );

  // Black bars base. Below full dim, draw the whole frame faintly (surroundings show through the
  // bars), then the crop at full brightness. dim is the bars' blackness (1 = solid). The black skips
  // the pixels the crop covers, which at a typical crop is most of the canvas. (Clipping the faint
  // frame the same way changes its edge pixels: Chrome stops antialiasing a clipped image's edges.)
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#000';
  for (const band of bandsAround(coveredPixels, canvas.width, canvas.height)) {
    c.fillRect(band.x, band.y, band.width, band.height);
  }
  const dim = getCropDimOpacity();
  if (dim < 1) {
    c.save();
    applyVideoMatrix();
    c.globalAlpha = 1 - dim;
    c.drawImage(source, 0, 0, vw, vh, 0, 0, boxW, boxH);
    c.restore();
  }
  c.save();
  applyVideoMatrix();
  c.beginPath();
  c.rect(clipX, clipY, clipW, clipH);
  c.clip();
  c.drawImage(source, 0, 0, vw, vh, 0, 0, boxW, boxH);
  c.restore();

  // Gamma-correct the video pixels through the same WebGL shader the crop preview uses, so reframe
  // matches the exported output. drawImage reads the raw frame, so the SVG gamma filter on the
  // hidden video has no effect here. Runs after the crop and before the border so the UI chrome
  // below stays its true colour. Solid black bars stay black, so only the pixels the crop touches
  // need the pass; below full dim the faint frame shows everywhere, so then the whole canvas.
  if (appState.isGammaPreviewOn && prevGammaVal !== 1) {
    gammaRenderer ??= createWebGLGammaRenderer(canvas);
    const region =
      dim < 1
        ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
        : touchedPixels(
            cropLeft * dpr,
            cropTop * dpr,
            cropRight * dpr,
            cropBottom * dpr,
            canvas.width,
            canvas.height
          );
    if (region) {
      const { x, y, width, height } = region;
      gammaRenderer.render(canvas, prevGammaVal, region);
      c.setTransform(1, 0, 0, 1, 0, 0); // identity: composite 1:1 over the dpr-scaled backing store
      c.drawImage(gammaRenderer.outputCanvas, 0, 0, width, height, x, y, width, height);
    }
  }

  // Border and crosshair on the canvas, through the same matrix as the content. Clamp 1px inside the
  // canvas so a crop filling an axis still shows its border at the edge.
  const rl = Math.max(cropLeft, 1);
  const rt = Math.max(cropTop, 1);
  const rr = Math.min(cropRight, canvasW - 1);
  const rb = Math.min(cropBottom, canvasH - 1);
  const color = reframeKeyframeColor(mediaTime);
  c.setTransform(dpr, 0, 0, dpr, 0, 0); // CSS px; backing store is dpr-scaled
  c.lineJoin = 'miter';
  c.strokeStyle = 'rgba(0,0,0,0.6)'; // contrast underlay
  c.lineWidth = 2;
  c.strokeRect(rl, rt, rr - rl, rb - rt);
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.strokeRect(rl, rt, rr - rl, rb - rt);
  if (cropCrossHairEnabled) {
    const mx = (rl + rr) / 2;
    const my = (rt + rb) / 2;
    const crossHair = (): void => {
      c.beginPath();
      c.moveTo(rl, my);
      c.lineTo(rr, my);
      c.moveTo(mx, rt);
      c.lineTo(mx, rb);
      c.stroke();
    };
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1;
    crossHair();
    c.strokeStyle = color;
    c.setLineDash([6, 6]);
    crossHair();
    c.setLineDash([]);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}
