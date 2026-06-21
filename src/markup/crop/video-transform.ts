/**
 * Single source of truth for the `<video>`'s CSS transform. The preview rotation
 * and the editor zoom both want the `transform` property, so they compose here
 * via CSS custom variables in one rule instead of fighting over separate
 * `!important` declarations.
 *
 * Order (applied right-to-left): fullscreen-fit scale -> rotate -> zoom scale ->
 * zoom pan. Transform-origin is the centre, matching rotation (which rotates
 * about the video centre), so the composition is well-defined. The rule is
 * present only while rotated or zoomed; at rest the video carries no transform,
 * exactly as before this refactor.
 */
import { appState } from '../appState';
import { deleteElement, injectCSS } from '../util/util';
import { transformedVideoBox, viewportToPixels } from './video-zoom-math';
import { getViewport } from './video-zoom-state';

const VIDEO_TRANSFORM_CSS = `
        .yt-clipper-video {
          transform: translate(var(--ytc-zoom-tx, 0px), var(--ytc-zoom-ty, 0px))
                     scale(var(--ytc-zoom-scale, 1))
                     rotate(var(--ytc-rotate, 0deg))
                     scale(var(--ytc-rotate-scale, 1)) !important;
          transform-origin: center !important;
          /* Promote to its own compositor layer so the per-frame reframe transform
             composites consistently (smooths sub-pixel shimmer, esp. pan-dominant
             tracks where only the translate changes). The rule is present only while
             transformed, so there's no idle layer cost. */
          will-change: transform !important;
          backface-visibility: hidden !important;
        }
      `;
const TRANSFORM_VARS = [
  '--ytc-rotate',
  '--ytc-rotate-scale',
  '--ytc-zoom-scale',
  '--ytc-zoom-tx',
  '--ytc-zoom-ty',
];
let videoTransformStyle: HTMLStyleElement | null = null;

export interface VideoTransformParams {
  /** Preview rotation in degrees (0, 90, -90). */
  rotation: number;
  rotated: boolean;
  /** Zoom magnification (viewport scale, >= 1). */
  scale: number;
  /** Fullscreen-rotated fit scale (1/aspectRatio fullscreen-rotated, else 1). */
  fsScale: number;
  /** Fitted (pre-transform) video box, = offsetWidth/Height. */
  boxW: number;
  boxH: number;
  /** Screen-space pan translate (px) for the zoom focal point. */
  tx: number;
  ty: number;
}

/**
 * The composed rotation+zoom transform as plain numbers, from the live `appState.rotation`,
 * fullscreen state, and zoom viewport. The single source every consumer derives from: the CSS
 * variables (applyVideoTransform), the transformed bounding box (getTransformedVideoBox), and the
 * reframe canvas matrix all read these same params, so they can never drift apart.
 */
export function getVideoTransformParams(): VideoTransformParams {
  const video = appState.video;
  const boxW = video.offsetWidth;
  const boxH = video.offsetHeight;
  const rotation = appState.rotation;
  const rotated = rotation === 90 || rotation === -90;
  const zoom = getViewport();
  // Fullscreen-rotated keeps the prior 1/aspectRatio fit scale.
  const fsScale =
    rotated && document.fullscreenElement != null ? 1 / appState.videoInfo.aspectRatio : 1;
  // Pan in displayed (post-rotation, screen-aligned) space, so rotation swaps the fitted dims.
  const { x: tx, y: ty } = viewportToPixels(zoom, rotated ? boxH : boxW, rotated ? boxW : boxH);
  return { rotation, rotated, scale: zoom.scale, fsScale, boxW, boxH, tx, ty };
}

/**
 * Recompute and apply the composed rotation+zoom transform. Idempotent; call it
 * after any change to rotation, zoom, or the fitted video size (centerVideo).
 */
export function applyVideoTransform(): void {
  const video = appState.video;
  if (!video) return;

  const { rotation, rotated, scale, fsScale, tx, ty } = getVideoTransformParams();

  if (!rotated && scale <= 1) {
    if (videoTransformStyle) {
      deleteElement(videoTransformStyle);
      videoTransformStyle = null;
    }
    TRANSFORM_VARS.forEach((v) => video.style.removeProperty(v));
    return;
  }

  videoTransformStyle ??= injectCSS(VIDEO_TRANSFORM_CSS, 'yt-clipper-video-transform-css');

  video.style.setProperty('--ytc-rotate', `${rotation}deg`);
  video.style.setProperty('--ytc-rotate-scale', `${fsScale}`);
  video.style.setProperty('--ytc-zoom-scale', `${scale}`);
  video.style.setProperty('--ytc-zoom-tx', `${tx}px`);
  video.style.setProperty('--ytc-zoom-ty', `${ty}px`);
}

/**
 * The transformed video's bounding box in offset-parent (container) coordinates, computed from the
 * same transform params `applyVideoTransform` applies. The reframe overlay uses this instead of
 * getBoundingClientRect, which the browser snaps to device pixels, so the overlay outline jitters
 * sub-pixel as the video pans.
 */
export function getTransformedVideoBox(): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const video = appState.video;
  return transformedVideoBox(getVideoTransformParams(), video.offsetLeft, video.offsetTop);
}
