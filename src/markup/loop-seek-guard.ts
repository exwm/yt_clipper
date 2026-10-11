// While a loop keeps playback inside a range (marker pair, chart loop, or crop-chart section), a
// click on the platform's progress bar outside that range seeks there and is pulled back to the
// loop start a frame later: a flash of the clicked frame and a visible jump. Intercept those clicks
// and seek straight to the loop start instead. Clicks inside the range, and on yt_clipper's own
// markers and numbers, pass through untouched.
import { appState } from './appState';
import { getActiveLoop } from './markers';
import { platform } from './yt_clipper';
import { getVideoDuration, seekToSafe } from './util/util';

// yt_clipper's own elements on or near the bar, which handle their own clicks.
const OWN_BAR_ELEMENTS = '#markers-div, #marker-numberings-div, .ytc-tz';

export function installLoopSeekGuard(): void {
  // The platform may start seeking on any of these, so a redirected press blocks all of them.
  for (const type of ['pointerdown', 'mousedown', 'click'] as const) {
    document.addEventListener(type, onProgressBarPress, true);
  }
}

/** Where a seek to `time` should go: `time` itself, or the active loop's start when `time` is
 *  outside the loop (which would otherwise pull playback back there a frame later). */
export function loopSafeSeekTime(time: number): number {
  const loop = getActiveLoop();
  return loop && (time < loop.start || time > loop.end) ? loop.start : time;
}

function onProgressBarPress(e: MouseEvent): void {
  if (e.button !== 0) return;
  const time = progressBarTimeAt(e);
  if (time == null) return;
  const safeTime = loopSafeSeekTime(time);
  if (safeTime === time) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'pointerdown') seekToSafe(appState.video, safeTime);
}

/** The video time under a press on the platform's progress bar, or null when the press is not on
 *  the bar (or is on yt_clipper's own markers). Maps through the markers' box, as markers do. */
function progressBarTimeAt(e: MouseEvent): number | null {
  const target = e.target as Element | null;
  if (target?.closest(OWN_BAR_ELEMENTS)) return null;
  // By target, not position: player buttons sit a few pixels below the bar. The bar holds its own
  // taller hit strip (YouTube's .ytp-progress-bar-padding).
  if (!target || !appState.hooks.progressBar.contains(target)) return null;
  const markers = appState.markersSvg.getBoundingClientRect();
  const onMarkers = e.clientX >= markers.left && e.clientX <= markers.right;
  if (!onMarkers || !markers.width) return null;
  return ((e.clientX - markers.left) / markers.width) * getVideoDuration(platform, appState.video);
}
