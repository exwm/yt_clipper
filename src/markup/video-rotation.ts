import { appState } from './appState';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { adjustRotatedVideoPositionCSS, getRotatedVideoCSS } from './ui/css/css';
import { deleteElement, injectCSS } from './util/util';
import { resizeCropOverlay } from './crop-overlay';

let rotatedVideoCSS: string;
let fullscreenRotatedVideoCSS: string;
let rotatedVideoPreviewsCSS: string;
let rotatedVideoStyle: HTMLStyleElement;
let adjustRotatedVideoPositionStyle: HTMLStyleElement;
let fullscreenRotatedVideoStyle: HTMLStyleElement;
let rotatedVideoPreviewsStyle: HTMLStyleElement;
let bigVideoPreviewsStyle: HTMLStyleElement | null;

export function rotateVideo(direction: string) {
  if (direction === 'clock') {
    appState.rotation = appState.rotation === 0 ? 90 : 0;
  } else if (direction === 'cclock') {
    appState.rotation = appState.rotation === 0 ? -90 : 0;
  }
  if (appState.rotation === 90 || appState.rotation === -90) {
    let scale = 1;
    scale = 1 / appState.videoInfo.aspectRatio;
    rotatedVideoCSS = getRotatedVideoCSS(appState.rotation);
    rotatedVideoPreviewsCSS = `\
        .ytp-tooltip {
          transform: translateY(-15%) rotate(${appState.rotation}deg) !important;
        }
        .ytp-tooltip-text-wrapper {
          transform: rotate(${-appState.rotation}deg) !important;
          opacity: 0.6;
        }
      `;
    fullscreenRotatedVideoCSS = `
      .yt-clipper-video {
        transform: rotate(${appState.rotation}deg) scale(${scale}) !important;
        margin-left: auto;
      }
      `;
    if (!document.fullscreen) {
      adjustRotatedVideoPositionStyle = injectCSS(
        adjustRotatedVideoPositionCSS,
        'adjust-rotated-video-position-css'
      );
      rotatedVideoStyle = injectCSS(rotatedVideoCSS, 'yt-clipper-rotate-video-css');
      window.dispatchEvent(new Event('resize'));
    } else {
      fullscreenRotatedVideoStyle = injectCSS(
        fullscreenRotatedVideoCSS,
        'fullscreen-rotated-video-css'
      );
    }
    rotatedVideoPreviewsStyle = injectCSS(
      rotatedVideoPreviewsCSS,
      'yt-clipper-rotated-video-previews-css'
    );
    deleteElement(bigVideoPreviewsStyle!);
    bigVideoPreviewsStyle = null;
    window.dispatchEvent(new Event('resize'));
    document.addEventListener('fullscreenchange', fullscreenRotateVideoHandler);
  } else {
    deleteElement(rotatedVideoStyle);
    deleteElement(adjustRotatedVideoPositionStyle);
    deleteElement(fullscreenRotatedVideoStyle);
    deleteElement(rotatedVideoPreviewsStyle);
    deleteElement(bigVideoPreviewsStyle!);
    bigVideoPreviewsStyle = null;
    window.dispatchEvent(new Event('resize'));
    document.removeEventListener('fullscreenchange', fullscreenRotateVideoHandler);
  }
  resizeCropOverlay();
  triggerCropPreviewRedraw();
}

export function fullscreenRotateVideoHandler() {
  if (document.fullscreen) {
    deleteElement(rotatedVideoStyle);
    deleteElement(adjustRotatedVideoPositionStyle);
    fullscreenRotatedVideoStyle = injectCSS(
      fullscreenRotatedVideoCSS,
      'fullscreen-rotated-video-css'
    );
  } else {
    deleteElement(fullscreenRotatedVideoStyle);
    adjustRotatedVideoPositionStyle = injectCSS(
      adjustRotatedVideoPositionCSS,
      'adjust-rotated-video-position-css'
    );
    rotatedVideoStyle = injectCSS(rotatedVideoCSS, 'yt-clipper-rotate-video-css');
    document.removeEventListener('fullscreenchange', fullscreenRotateVideoHandler);
    window.dispatchEvent(new Event('resize'));
  }
}

export function toggleBigVideoPreviews() {
  const bigVideoPreviewsCSS = `\
    .ytp-tooltip {
      left: 45% !important;
      transform: ${
        appState.rotation
          ? `translateY(-285%) rotate(${appState.rotation}deg)`
          : 'translateY(-160%) '
      } scale(4) !important;
      padding: 1px !important;
      border-radius: 1px !important;
    }
    .ytp-tooltip-text-wrapper {
      transform: scale(0.5) ${appState.rotation ? `rotate(${-appState.rotation}deg)` : ''}!important;
      opacity: 0.6;
    }
    `;
  if (bigVideoPreviewsStyle) {
    deleteElement(bigVideoPreviewsStyle);
    bigVideoPreviewsStyle = null;
  } else {
    bigVideoPreviewsStyle = injectCSS(bigVideoPreviewsCSS, 'yt-clipper-big-video-previews-css');
  }
}
