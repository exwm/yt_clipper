import { appState, VideoElement, YTPlayer } from '../appState';
import { onVideoFrames, VideoFrameSubscription } from './video-frame-loop';
import { getPlatform, VideoPlatforms } from '../platforms/platforms';
import { chartState } from '../charts';
import { isDrawingCrop } from '../crop-overlay';
import { isMouseManipulatingCrop } from '../crop-overlay';
import { blockEvent, flashMessage, getPendingSeekTime, seekBySafe, seekToSafe } from './util';
import {
  loopTurnBack,
  OwnSeek,
  frameStepTarget,
  frameTime,
  Refresh,
  ScreenFrame,
  screenFrame,
  TIME_ROUNDING,
} from './frame-step';
import { FrameGrid, frameSeekTarget } from './frame-grid';
import { registerActiveDragCleanup } from './drag-recovery';
import {
  getFrameOnScreen,
  getHeldFrame,
  getMeasuredFrameRate,
  isNewMeasuredFrameRate,
} from './presented-frame-clock';
import { getCurrentPageVideoID, isStaleVideo } from '../platforms/navigation';

let frameRateFrames: VideoFrameSubscription | null = null;
/** Reads the frame rate on each played frame, so a measured rate is flashed and shown as soon as it
 *  is measured rather than at the next action that needs it. */
export function followFrameRate(video: VideoElement): void {
  // Starts the frame clock first, so its listeners reset the measured rate before these read it.
  getMeasuredFrameRate(video);
  frameRateFrames?.stop();
  frameRateFrames = onVideoFrames(video, updateFrameRate, { phase: 'update', label: 'frame rate' });
  // A new source (YouTube reuses the video element on navigation) has its own stats rate, and its
  // playhead never shows the frame of a seek made on the old one.
  video.addEventListener('emptied', () => {
    ownSeek = null;
    youTubeStatsFps = null;
    isNewSourceLoaded = false;
    updateFrameRate();
  });
  video.addEventListener('loadedmetadata', () => {
    isNewSourceLoaded = true;
    updateFrameRate();
  });
  video.addEventListener('resize', updateFrameRate);
}

// The video playing is the one the markup is for. `isStaleVideo` is set only once YouTube finishes a
// navigation, after a new video's rate can already be measured (history forward), so compare ids too.
function isMarkupVideo(): boolean {
  const markupVideoID = appState.settings?.videoID;
  const pageVideoID = getCurrentPageVideoID();
  return (
    !isStaleVideo && (markupVideoID == null || pageVideoID == null || pageVideoID === markupVideoID)
  );
}

function updateFrameRate(): void {
  const frameRate = getFrameRate();
  const { rate, source } = frameRate;
  if (source === 'measured' && isMarkupVideo() && isNewMeasuredFrameRate(appState.video, rate)) {
    flashMessage(`Measured the frame rate: ${formatFps(rate)} fps.`, 'olive');
  }
  showFrameRate(frameRate);
}

// Whether getFPS uses the rate measured from played frames, saved in this browser. Read on first
// use; storage that is blocked or full keeps the setting for this page only.
const MEASURE_FRAME_RATE_KEY = 'ytc-measure-frame-rate';
let measureFrameRate: boolean | null = null;
export function isFrameRateMeasured(): boolean {
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
  const frameRate = getFrameRate();
  // This flash names the rate, so the next frame doesn't flash it again.
  if (frameRate.source === 'measured') isNewMeasuredFrameRate(appState.video, frameRate.rate);
  flashMessage(
    `Frame rate measurement ${measureFrameRate ? 'on' : 'off'}. Using ${formatFps(frameRate.rate)} fps.`,
    measureFrameRate ? 'green' : 'red'
  );
  showFrameRate(frameRate);
  if (typeof document !== 'undefined') {
    document
      .getElementById('global-frame-rate-toggle')
      ?.classList.toggle('active', measureFrameRate);
  }
}

/** The video's frames at the frame rate in use. */
export function getFrameGrid(): FrameGrid {
  return { origin: 0, rate: getFPS() };
}

let ownSeek: OwnSeek | null = null;
/** Seeks to show the frame at `time`, a placed time such as a marker's or a crop point's. */
export function seekToFrameAt(time: number): void {
  const target = frameSeekTarget(getFrameGrid(), time);
  ownSeek = { target, frameStart: time, kind: 'place' };
  seekToSafe(appState.video, target);
}

// Where the playhead is or is going: the seek held back, else the current time.
function getPlayhead(): number {
  // eslint-disable-next-line no-restricted-syntax -- frame times and steps are built from it
  return getPendingSeekTime() ?? appState.video.getCurrentTime();
}

/** The frame on screen, its start on the platform's timeline. Placements and frame decisions read
 *  `getFrameTime`. */
export function getScreenFrame(): ScreenFrame {
  const { rate, source } = getFrameRate();
  // eslint-disable-next-line no-restricted-syntax -- the frame on screen is built from it
  const onScreen = getFrameOnScreen(appState.video);
  return screenFrame(onScreen, getPlayhead(), rate, source === 'measured');
}

/** The start of the frame a frame callback presents at `mediaTime` (on the video's own timeline), on
 *  the platform's timeline, as `getScreenFrame` gives it. */
export function frameStartOf(mediaTime: number): number {
  const video = appState.video;
  const { rate, source } = getFrameRate();
  // eslint-disable-next-line no-restricted-syntax -- whether the read at `seeked` timed this frame
  const onScreen = getFrameOnScreen(video);
  // eslint-disable-next-line no-restricted-syntax -- the frame's time on the platform's timeline
  const playhead = video.getCurrentTime();
  const platformTime = mediaTime + playhead - video.currentTime;
  const isRead =
    onScreen.isRead &&
    onScreen.mediaTime != null &&
    Math.abs(onScreen.mediaTime - platformTime) < TIME_ROUNDING;
  const presented = { mediaTime: platformTime, isRead, isCurrent: true };
  return screenFrame(presented, playhead, rate, source === 'measured').start;
}

/** The time of the frame the user is on, which placements store and frame decisions read. */
export function getFrameTime(): number {
  // eslint-disable-next-line no-restricted-syntax -- getFrameTime is built from it
  return frameTime(getScreenFrame(), {
    playhead: getPlayhead(),
    isSeekInFlight: isSeekInFlight(),
    ownSeek,
    fps: getFPS(),
  });
}

function isSeekInFlight(): boolean {
  return appState.video.seeking || getPendingSeekTime() != null;
}

/** Keeps playback within the frames shown from `start` through `end`, for the preview loops. */
export function loopPlaybackOver(start: number, end: number): void {
  const video = appState.video;
  // Playing, the frame on screen, so the loop turns back while its last frame shows.
  const isPlaying = !video.paused;
  // eslint-disable-next-line no-restricted-syntax -- a paused loop seeks back from the playhead; past the end, as 5.48
  const playhead = video.getCurrentTime();
  const turn = loopTurnBack({
    grid: getFrameGrid(),
    start,
    end,
    isPlaying,
    time: isPlaying ? getFrameTime() : playhead,
    playhead,
    held: isPlaying ? getHeldFrame(video) : null,
    refresh,
    playbackRate: video.playbackRate,
    lastOtherFrameAt,
  });
  lastOtherFrameAt = turn.lastOtherFrameAt;
  if (turn.seekTo != null) seekToSafe(video, turn.seekTo);
}

// NaN until two refreshes are noted, which never holds.
let refresh: Refresh = { time: NaN, gap: NaN };
let lastOtherFrameAt = -Infinity;
/** Notes an animation frame's time (its callback's argument), for the loop's end frame. */
export function noteRefresh(time: number): void {
  refresh = { time, gap: time - refresh.time };
}

/** Seeks `frames` whole frames from the frame on screen, to the middle of that frame. */
export function seekByFrames(frames: number): void {
  const video = appState.video;
  // Without frame callbacks the frame on screen is unknown: step from the playhead.
  if (typeof video.requestVideoFrameCallback !== 'function') {
    seekBySafe(video, frames / getFPS());
    return;
  }
  const fps = getFPS();
  // eslint-disable-next-line no-restricted-syntax -- frame steps start from the frame on screen
  const target = frameStepTarget(getScreenFrame(), {
    playhead: getPlayhead(),
    isSeekInFlight: isSeekInFlight(),
    ownSeek,
    fps,
    duration: video.duration,
    frames,
  });
  ownSeek = { target, frameStart: target - 0.5 / fps, kind: 'step' };
  seekToSafe(video, target);
}

export let prevVideoWidth: number;
// YouTube's stats rate for the rendition playing, read once per rendition (width) and source. Between
// a new source's `emptied` and its `loadedmetadata` the stats still describe the old video, so the
// rate read then isn't kept.
let youTubeStatsFps: number | null = null;
let isNewSourceLoaded = true;

export type FrameRateSource = 'measured' | 'platform' | 'default';

/** The frame rate in use and where it comes from: a confirmed measured rate, else the platform's
 *  (YouTube's stats), else the default. */
export function getFrameRate(defaultFPS = 60): { rate: number; source: FrameRateSource } {
  let frameRate: { rate: number; source: FrameRateSource } = {
    rate: defaultFPS,
    source: 'default',
  };
  try {
    const isYouTube = getPlatform() === VideoPlatforms.youtube;
    if (isYouTube) {
      let statsFps = youTubeStatsFps;
      if (statsFps == null || prevVideoWidth !== appState.video.videoWidth) {
        statsFps = parseFloat(
          /@(\d+)/.exec((appState.player as YTPlayer).getStatsForNerds().resolution)?.[1] ?? '60'
        );
        if (isNewSourceLoaded) youTubeStatsFps = statsFps;
      }
      frameRate = { rate: statsFps, source: 'platform' };
    }
    // A confirmed measured rate replaces the default. On YouTube it only refines the stats rate, which
    // shows 29.97 fps as 30.
    const measured = isFrameRateMeasured() ? getMeasuredFrameRate(appState.video) : null;
    if (
      measured != null &&
      (!isYouTube || Math.abs(measured - frameRate.rate) <= frameRate.rate * 0.005)
    ) {
      frameRate = { rate: measured, source: 'measured' };
    }
  } catch (e) {
    console.log('Could not detect fps', e);
  }
  prevVideoWidth = appState.video.videoWidth;
  return frameRate;
}

const FRAME_RATE_SOURCES: Record<FrameRateSource, string> = {
  measured: 'measured',
  platform: "the platform's",
  default: 'assumed',
};

/** The frame rate in use and where it comes from, as the global settings editor shows it. */
export function describeFrameRate({ rate, source }: { rate: number; source: FrameRateSource }) {
  return `${formatFps(rate)} fps (${FRAME_RATE_SOURCES[source]})`;
}

// Runs on every played frame: touch the page only when the text changes.
function showFrameRate(frameRate: { rate: number; source: FrameRateSource }) {
  if (typeof document === 'undefined') return;
  const field = document.getElementById('global-frame-rate');
  const text = describeFrameRate(frameRate);
  if (field != null && field.textContent !== text) field.textContent = text;
}

export function getFPS(defaultFPS: number | null = 60): number {
  // By default assume a high rate, so a step never skips a frame.
  return getFrameRate(defaultFPS ?? 60).rate;
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
  // Where the hook holds the progress bar (the generic site), Alt+drag on a marker number moves it.
  const isOnMarkerNumber = appState.markerNumberingsDiv?.contains(e.target as Node);
  if (
    !isOnMarkerNumber &&
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
