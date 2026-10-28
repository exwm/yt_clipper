import { appState, VideoElement, YTPlayer } from '../appState';
import { onVideoFrames, VideoFrameSubscription } from './video-frame-loop';
import { getPlatform, VideoPlatforms } from '../platforms/platforms';
import { chartState } from '../charts';
import { isDrawingCrop } from '../crop-overlay';
import { isMouseManipulatingCrop } from '../crop-overlay';
import { blockEvent, flashMessage, getPendingSeekTime, seekBySafe, seekToSafe } from './util';
import { FrameSeek, frameDecisionTime, frameStepTarget } from './frame-step';
import { FrameGrid, frameSeekTarget, loopSeekTarget } from './frame-grid';
import { registerActiveDragCleanup } from './drag-recovery';
import {
  FRAMES_TO_TELL_NTSC_RATES,
  getMeasuredFrameRate,
  getPresentedFrameTime,
  isNewMeasuredFrameRate,
} from './presented-frame-clock';
import { isStaleVideo } from '../platforms/navigation';

let frameRateFrames: VideoFrameSubscription | null = null;
/** Reads the frame rate on each played frame, so a measured rate is taken, and flashed, as soon as
 *  it is measured rather than at the next action that needs it. */
export function followFrameRate(video: VideoElement): void {
  frameRateFrames?.stop();
  frameRateFrames = onVideoFrames(video, () => getFPS(), { phase: 'update', label: 'frame rate' });
  // A new source (YouTube reuses the video element on navigation) has its own stats rate.
  video.addEventListener('emptied', () => {
    youTubeStatsFps = null;
  });
}

// Whether getFPS uses the rate measured from played frames, saved in this browser. Read on first
// use; storage that is blocked or full keeps the setting for this page only.
const MEASURE_FRAME_RATE_KEY = 'ytc-measure-frame-rate';
let measureFrameRate: boolean | null = null;
function isFrameRateMeasured(): boolean {
  if (measureFrameRate == null) {
    try {
      measureFrameRate = localStorage.getItem(MEASURE_FRAME_RATE_KEY) !== 'false';
    } catch {
      measureFrameRate = true;
    }
  }
  return measureFrameRate;
}

const formatFps = (fps: number) => Number(fps.toFixed(3));

export function toggleFrameRateMeasurement(): void {
  measureFrameRate = !isFrameRateMeasured();
  try {
    localStorage.setItem(MEASURE_FRAME_RATE_KEY, String(measureFrameRate));
  } catch {
    // Blocked or full storage: the setting holds for this page only.
  }
  const fps = getFPS();
  flashMessage(
    `Frame rate measurement ${measureFrameRate ? 'on' : 'off'}. Using ${formatFps(fps)} fps.`,
    measureFrameRate ? 'green' : 'red'
  );
}

/** The video's frames at the frame rate in use. */
export function getFrameGrid(): FrameGrid {
  return { origin: 0, rate: getFPS() };
}

let lastFrameSeek: FrameSeek | null = null;
/** Seeks to show the frame at `time`, a placed time such as a marker's or a crop point's. */
export function seekToFrameAt(time: number): void {
  const target = frameSeekTarget(getFrameGrid(), time);
  lastFrameSeek = { target, frameTime: time };
  seekToSafe(appState.video, target);
}

/** The time of the frame the user is on, for decisions such as which marker or crop point is next. */
export function getFrameDecisionTime(): number {
  return frameDecisionTime({ ...frameSeekState(), fallbackTime: getPresentedFrameTime(appState.video) });
}

/** The time to place a crop point at: the playhead, or right after a frame seek, its frame time. */
export function getPlacementTime(): number {
  return frameDecisionTime({ ...frameSeekState(), fallbackTime: appState.video.getCurrentTime() });
}

function frameSeekState() {
  const video = appState.video;
  return { playhead: getPendingSeekTime() ?? video.getCurrentTime(), lastFrameSeek, fps: getFPS() };
}

/** Keeps playback within the frames shown from `start` through `end`, for the preview loops. */
export function loopPlaybackOver(start: number, end: number): void {
  const target = loopSeekTarget(getFrameGrid(), start, end, appState.video.getCurrentTime());
  if (target != null) seekToSafe(appState.video, target);
}

let lastFrameStep: { target: number; presentedFrameTime: number; direction: number } | null =
  null;
/** Seeks `frames` whole frames from the frame on screen, to the middle of that frame. */
export function seekByFrames(frames: number): void {
  const video = appState.video;
  // Without frame callbacks the frame on screen is unknown: step from the playhead.
  if (typeof video.requestVideoFrameCallback !== 'function') {
    seekBySafe(video, frames / getFPS());
    return;
  }
  const presentedFrameTime = getPresentedFrameTime(video);
  const pendingSeekTime = getPendingSeekTime();
  const fps = getFPS();
  const target = frameStepTarget({
    presentedFrameTime,
    isSeekInFlight: video.seeking || pendingSeekTime != null,
    // A step held back while another seek is in flight is where the playhead is headed.
    playhead: pendingSeekTime ?? video.getCurrentTime(),
    lastStep: lastFrameStep,
    fps,
    frames,
  });
  lastFrameStep = { target, presentedFrameTime, direction: Math.sign(frames) };
  // Not a frame seek for decisions: on a rate higher than the video's, a step's frame start isn't the
  // frame it shows, so decisions read the frame on screen.
  lastFrameSeek = null;
  seekToSafe(video, target);
}

export let prevVideoWidth: number;
// YouTube's stats rate for the rendition playing, read once per rendition (width) and source.
let youTubeStatsFps: number | null = null;
export function getFPS(defaultFPS: number | null = 60) {
  let fps: number;
  try {
    const isYouTube = getPlatform() === VideoPlatforms.youtube;
    if (isYouTube) {
      if (youTubeStatsFps == null || prevVideoWidth !== appState.video.videoWidth) {
        youTubeStatsFps = parseFloat(
          /@(\d+)/.exec((appState.player as YTPlayer).getStatsForNerds().resolution)?.[1] ?? '60'
        );
      }
      fps = youTubeStatsFps;
    } else {
      fps = defaultFPS ?? 60;
    }
    // A rate measured from played frames replaces the default. On YouTube it only refines the stats
    // rate, which shows 29.97 fps as 30.
    const measuredFPS = isFrameRateMeasured()
      ? getMeasuredFrameRate(appState.video, isYouTube ? FRAMES_TO_TELL_NTSC_RATES : undefined)
      : null;
    if (measuredFPS != null && (!isYouTube || Math.abs(measuredFPS - fps) <= fps * 0.005)) {
      fps = measuredFPS;
      // A rate taken after a few frames can be corrected later; the correction flashes too, after the
      // flash interval. Waiting for a confirmed rate would never flash where frames drop every so often.
      if (!isStaleVideo && isNewMeasuredFrameRate(appState.video, fps)) {
        flashMessage(`Measured the frame rate: ${formatFps(fps)} fps.`, 'olive');
      }
    }
  } catch (e) {
    console.log('Could not detect fps', e);
    fps = defaultFPS ?? 60; // by default parameter value assume high fps to avoid skipping frames
  }
  prevVideoWidth = appState.video.videoWidth;
  return fps;
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
// Fake viewer activity on the player so the host's controls + progress bar
// reappear and their auto-hide countdown restarts. Hotkey-driven seeking
// (e.g. jumping between markers) never moves the mouse, so without this the
// controls stay hidden while the playhead jumps around.
let autoHideWakeNudge = 0;
export function refreshPlayerControlsAutoHideTimer() {
  const playerRect = appState.hooks.player.getBoundingClientRect();
  // The host ignores a mousemove whose coordinates match the previous one, so
  // alternate the position by a pixel each call to keep every nudge "real".
  autoHideWakeNudge ^= 1;
  appState.hooks.player.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: playerRect.left + playerRect.width / 2 + autoHideWakeNudge,
      clientY: playerRect.top + playerRect.height / 2,
    })
  );
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
    // this pointer (pointermove, pointerup, and pointercancel) even when
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
      const seekBy = changeX * (1 / getFPS());
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
