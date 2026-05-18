import { appState, YTPlayer } from '../appState';
import { getPlatform, VideoPlatforms } from '../platforms/platforms';
import { chartState } from '../charts';
import { isDrawingCrop } from '../crop-overlay';
import { isMouseManipulatingCrop } from '../crop-overlay';
import { blockEvent, seekBySafe } from './util';
import { registerActiveDragCleanup } from './drag-recovery';

export let prevVideoWidth: number;
export function getFPS(defaultFPS: number | null = 60) {
  let fps: number;
  try {
    if (
      appState.videoInfo.fps != null &&
      appState.video.videoWidth != null &&
      prevVideoWidth === appState.video.videoWidth
    ) {
      fps = appState.videoInfo.fps;
    } else if (getPlatform() === VideoPlatforms.youtube) {
      appState.videoInfo.fps = parseFloat(
        /@(\d+)/.exec((appState.player as YTPlayer).getStatsForNerds().resolution)?.[1] ?? '60'
      );
      fps = appState.videoInfo.fps;
    } else {
      fps = defaultFPS ?? 60;
    }
  } catch (e) {
    console.log('Could not detect fps', e);
    fps = defaultFPS ?? 60; // by default parameter value assume high fps to avoid skipping frames
  }
  prevVideoWidth = appState.video.videoWidth;
  return fps;
}
export function getFrameTimeBetweenLeftFrames(currentTime: number): number {
  const fps = getFPS();

  const leftFrameIndex = Math.floor(currentTime * fps);
  const midpointTime = (leftFrameIndex - 0.5) / fps;

  return midpointTime;
}
export function hidePlayerControls() {
  appState.hooks.controls.originalDisplay =
    appState.hooks.controls.originalDisplay ?? appState.hooks.controls.style.display;
  appState.hooks.controlsGradient.originalDisplay =
    appState.hooks.controlsGradient.originalDisplay ??
    appState.hooks.controlsGradient.style.display;

  appState.hooks.controls.style.display = 'none';
  appState.hooks.controlsGradient.style.display = 'none';
}
export function showPlayerControls() {
  appState.hooks.controls.style.display = appState.hooks.controls.originalDisplay ?? '';
  appState.hooks.controlsGradient.style.display =
    appState.hooks.controlsGradient.originalDisplay ?? '';
}
export function addScrubVideoHandler() {
  appState.hooks.cropMouseManipulation.addEventListener('pointerdown', scrubVideoHandler, {
    capture: true,
  });
}
export function scrubVideoHandler(e) {
  const isCropBlockingChartVisible =
    appState.isCurrentChartVisible &&
    chartState.currentChartInput &&
    chartState.currentChartInput.type !== 'crop';
  if (
    !e.ctrlKey &&
    e.altKey &&
    !e.shiftKey &&
    !isMouseManipulatingCrop &&
    !isDrawingCrop &&
    !isCropBlockingChartVisible
  ) {
    blockEvent(e);
    document.addEventListener('click', blockVideoPause, {
      once: true,
      capture: true,
    });
    const videoRect = appState.video.getBoundingClientRect();
    let prevClickPosX = e.clientX - videoRect.left;
    const pointerId = e.pointerId;
    appState.video.setPointerCapture(pointerId);
    // The captured element receives every subsequent pointer event for
    // this pointer — pointermove, pointerup, and pointercancel — even when
    // the cursor leaves the video region. Attaching listeners here rather
    // than to `document` means the spec-mandated `pointercancel` reaches
    // us when the browser implicitly releases capture (devtools focus,
    // alt-tab, OS pointer reassignment), so the scrub never sticks.
    const captureTarget = appState.video;
    let unregisterDragRecovery: () => void = () => {};

    const baseWidth = 1920;
    function dragHandler(e: PointerEvent) {
      blockEvent(e);
      const pixelRatio = window.devicePixelRatio;
      const widthMultiple = baseWidth / screen.width;
      const dragPosX = e.clientX - videoRect.left;
      const changeX = (dragPosX - prevClickPosX) * pixelRatio * widthMultiple;
      const seekBy = changeX * (1 / appState.videoInfo.fps);
      seekBySafe(appState.video, seekBy);
      prevClickPosX = e.clientX - videoRect.left;
    }

    function cleanup(): void {
      captureTarget.removeEventListener('pointermove', dragHandler);
      captureTarget.removeEventListener('pointerup', endDragHandler, { capture: true });
      captureTarget.removeEventListener('pointercancel', cancelDragHandler, { capture: true });
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      unregisterDragRecovery();
    }

    function endDragHandler(e: PointerEvent) {
      blockEvent(e);
      cleanup();
    }

    function cancelDragHandler() {
      cleanup();
    }

    captureTarget.addEventListener('pointermove', dragHandler);
    captureTarget.addEventListener('pointerup', endDragHandler, {
      once: true,
      capture: true,
    });
    captureTarget.addEventListener('pointercancel', cancelDragHandler, {
      once: true,
      capture: true,
    });
    unregisterDragRecovery = registerActiveDragCleanup(cleanup);
  }
}
export function blockVideoPause(e) {
  e.stopImmediatePropagation();
}
