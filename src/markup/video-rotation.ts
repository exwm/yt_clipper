import { appState } from './appState';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { adjustRotatedVideoPositionCSS, getRotatedVideoCSS } from './ui/css/css';
import { deleteElement, flashMessage, injectCSS } from './util/util';
import { resizeCropOverlay } from './crop-overlay';
import { highlightModifiedSettings } from './features/settings/settings-editor';

let rotatedVideoCSS: string;
let fullscreenRotatedVideoCSS: string;
let rotatedVideoPreviewsCSS: string;
let rotatedVideoStyle: HTMLStyleElement;
let adjustRotatedVideoPositionStyle: HTMLStyleElement;
let fullscreenRotatedVideoStyle: HTMLStyleElement;
let rotatedVideoPreviewsStyle: HTMLStyleElement;
let bigVideoPreviewsStyle: HTMLStyleElement | null;

// Hotkeys: toggle one direction (0 <-> ±90).
export function rotateVideo(direction: string) {
  if (direction === 'clock') {
    appState.rotation = appState.rotation === 0 ? 90 : 0;
  } else if (direction === 'cclock') {
    appState.rotation = appState.rotation === 0 ? -90 : 0;
  }
  applyPreviewRotation();
}

// Bar button: cycle through all three orientations 0 -> 90 (CW) -> -90 (CCW) -> 0.
export function cyclePreviewRotation() {
  appState.rotation = appState.rotation === 0 ? 90 : appState.rotation === 90 ? -90 : 0;
  applyPreviewRotation();
}

// Inject/remove the preview rotation CSS for the current appState.rotation, then
// resync the crop overlay, crop preview, and output rotation setting.
function applyPreviewRotation() {
  // Remove any previously injected rotation CSS first. injectCSS appends rather
  // than replaces, so re-applying from a different orientation (cycling 90 ->
  // -90 without passing through 0) must clear the old styles or it strands a
  // second, orphaned set that survives the return to 0.
  deleteElement(rotatedVideoStyle);
  deleteElement(adjustRotatedVideoPositionStyle);
  deleteElement(fullscreenRotatedVideoStyle);
  deleteElement(rotatedVideoPreviewsStyle);
  if (bigVideoPreviewsStyle) deleteElement(bigVideoPreviewsStyle);
  bigVideoPreviewsStyle = null;

  if (appState.rotation === 90 || appState.rotation === -90) {
    buildRotatedVideoCSSStrings();
    if (document.fullscreenElement == null) {
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
    window.dispatchEvent(new Event('resize'));
    document.addEventListener('fullscreenchange', fullscreenRotateVideoHandler);
  } else {
    window.dispatchEvent(new Event('resize'));
    document.removeEventListener('fullscreenchange', fullscreenRotateVideoHandler);
  }
  resizeCropOverlay();
  triggerCropPreviewRedraw();
  syncOutputRotationToPreview();
}

// Preview rotation (this module) and encode/output rotation (the Global Settings
// `rotate` radios) are intentionally separate: you may want to view or mark up
// rotated without rotating the exported clip. The trap is previewing rotated and
// forgetting to set the output to match. So mirror preview -> output here. It
// stays one-way: the radios still set output alone without rotating the preview,
// so output rotation can be chosen without previewing it.
const rotateSettingByPreviewLabel = {
  '0': 'rotate-0',
  clock: 'rotate-90-clock',
  cclock: 'rotate-90-counterclock',
} as const;
function syncOutputRotationToPreview() {
  const rotate = appState.rotation === 90 ? 'clock' : appState.rotation === -90 ? 'cclock' : '0';
  appState.settings.rotate = rotate;
  // Live-reflect in the Global Settings editor if it is open (no-op otherwise):
  // tick the matching radio and refresh the shared rotate-row highlight.
  for (const [label, id] of Object.entries(rotateSettingByPreviewLabel)) {
    const radio = document.getElementById(id) as HTMLInputElement | null;
    if (radio) radio.checked = label === rotate;
  }
  highlightModifiedSettings(
    [{ id: rotateSettingByPreviewLabel[rotate], field: 'rotate', type: 'string' }] as const,
    appState.settings
  );
  flashMessage(
    rotate === '0'
      ? 'Preview and output rotation reset to 0°.'
      : `Preview and output rotation set to 90° ${rotate === 'clock' ? '⟳' : '⟲'}.`,
    'olive'
  );
}

// Build the rotation CSS strings from the current rotation and the current
// video's aspect ratio. The tooltip offset and the fullscreen scale both
// depend on the aspect ratio, so these must be rebuilt whenever the video
// (and thus its aspect ratio) changes — not just on the initial rotate.
function buildRotatedVideoCSSStrings() {
  const scale = 1 / appState.videoInfo.aspectRatio;
  rotatedVideoCSS = getRotatedVideoCSS(appState.rotation);
  const tooltipOffset = Math.round(((appState.videoInfo.aspectRatio - 1) / 2) * 100);
  rotatedVideoPreviewsCSS = `\
        .ytp-tooltip {
          transform: translateY(-${tooltipOffset}%) rotate(${appState.rotation}deg) !important;
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
}

// Recompute and re-inject the aspect-ratio-dependent rotation CSS for the
// current video. Used when the video's dimensions change (e.g. SPA navigation
// to a video with a different aspect ratio) so a stale ratio doesn't
// misposition the rotated tooltip previews or fullscreen scaling. The windowed
// rotate CSS only depends on the rotation angle, so it does not need refreshing.
export function refreshRotatedVideoCSS() {
  if (appState.rotation === 0) return;
  buildRotatedVideoCSSStrings();
  if (rotatedVideoPreviewsStyle) {
    deleteElement(rotatedVideoPreviewsStyle);
    rotatedVideoPreviewsStyle = injectCSS(
      rotatedVideoPreviewsCSS,
      'yt-clipper-rotated-video-previews-css'
    );
  }
  if (document.fullscreenElement != null && fullscreenRotatedVideoStyle) {
    deleteElement(fullscreenRotatedVideoStyle);
    fullscreenRotatedVideoStyle = injectCSS(
      fullscreenRotatedVideoCSS,
      'fullscreen-rotated-video-css'
    );
  }
}

export function fullscreenRotateVideoHandler() {
  if (document.fullscreenElement != null) {
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
