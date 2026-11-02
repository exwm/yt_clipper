import { html, render } from 'lit-html';
import { clampNumber } from './pure-util';
import { VideoPlatforms } from '../platforms/platforms';
import { appState, VideoElement } from '../appState';
import { onExternalSeek, onSeekRequest, onSeekSettled, SeekDecision } from './seek-coalescer';
import { frameTiming } from './frame-timing';

export {
  bsearch,
  clampNumber,
  getEasedValue,
  getOutputDuration,
  toHHMMSS,
  toHHMMSSTrimmed,
} from './pure-util';

export function assertDefined<T>(value: T | null | undefined, msg?: string): asserts value is T {
  if (value == null) {
    throw new Error(msg ?? 'Expected value to be defined');
  }
}

let flashMessageHook: HTMLElement;
export function setFlashMessageHook(hook: HTMLElement) {
  flashMessageHook = hook;
}

export type FlashSeverity = 'info' | 'success' | 'warn' | 'error';

const SEVERITY_DEFAULT_LIFETIME: Record<FlashSeverity, number> = {
  info: 3000,
  success: 3000,
  warn: 6000,
  error: 12000,
};

const SEVERITY_ICON: Record<FlashSeverity, string> = {
  info: '',
  success: '\u2713 ',
  warn: '\u26A0 ',
  error: '\u2716 ',
};

interface ActiveFlash {
  div: HTMLDivElement;
  countEl: HTMLSpanElement;
  timeoutId: number;
  count: number;
  lifetime: number;
}

const activeFlashes = new Map<string, ActiveFlash>();

function inferSeverityFromColor(color: string): FlashSeverity {
  const c = color.toLowerCase().trim();
  if (c === 'red' || c === 'crimson' || c === 'tomato' || c.includes('rgb(237')) {
    return 'error';
  }
  if (c === 'orange' || c === 'yellow' || c === 'gold' || c === 'darkorange') {
    return 'warn';
  }
  if (c === 'green' || c === 'lime' || c === 'lightgreen' || c === 'limegreen') {
    return 'success';
  }
  return 'info';
}

export function flashMessage(
  msg: string,
  color: string,
  lifetime?: number,
  severity?: FlashSeverity
) {
  if (!flashMessageHook) return;
  const sev: FlashSeverity = severity ?? inferSeverityFromColor(color);
  const life = lifetime ?? SEVERITY_DEFAULT_LIFETIME[sev];
  const key = sev + '\u0000' + msg;

  const existing = activeFlashes.get(key);
  if (existing) {
    existing.count += 1;
    existing.countEl.textContent = ' \u00D7' + existing.count;
    existing.countEl.style.display = 'inline';
    existing.div.classList.remove('flash-div');
    void existing.div.offsetWidth;
    existing.div.classList.add('flash-div');
    existing.div.style.animationDuration = life + 'ms';
    clearTimeout(existing.timeoutId);
    existing.timeoutId = window.setTimeout(() => {
      deleteElement(existing.div);
      activeFlashes.delete(key);
    }, life);
    return;
  }

  const flashDiv = document.createElement('div');
  flashDiv.className = 'msg-div flash-div flash-' + sev;
  flashDiv.style.animationDuration = life + 'ms';

  const textSpan = document.createElement('span');
  textSpan.className = 'flash-msg';
  textSpan.textContent = SEVERITY_ICON[sev] + msg;
  flashDiv.appendChild(textSpan);

  const countEl = document.createElement('span');
  countEl.className = 'flash-count';
  countEl.style.display = 'none';
  flashDiv.appendChild(countEl);

  flashMessageHook.insertAdjacentElement('beforebegin', flashDiv);

  const timeoutId = window.setTimeout(() => {
    deleteElement(flashDiv);
    activeFlashes.delete(key);
  }, life);

  activeFlashes.set(key, { div: flashDiv, countEl, timeoutId, count: 1, lifetime: life });
}

export async function retryUntilTruthyResult<R>(fn: () => R, wait = 200) {
  let result: R = fn();
  while (!result) {
    console.debug(
      `Retrying function: ${
        fn.name || 'arrow'
      } with body ${fn.toString()} because result was ${String(result)}`
    );
    result = fn();
    await sleep(wait);
  }
  return result;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function injectCSS(css: string, id: string) {
  const style = document.createElement('style');
  style.setAttribute('id', id);
  style.textContent = css;
  document.body.appendChild(style);
  return style;
}
export function deleteElement(elem: Element) {
  if (elem?.parentElement) {
    elem.parentElement.removeChild(elem);
  }
}

// Fired when something outside the settings bar changes a state the bar
// reflects (e.g. the crop preview modal closing on click-outside), so the bar
// can resync without the dispatcher importing it (avoids an import cycle).
export const SETTINGS_BAR_REFRESH_EVENT = 'yt-clipper:settings-bar-refresh';
export function dispatchSettingsBarRefresh() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new Event(SETTINGS_BAR_REFRESH_EVENT));
  }
}

export function querySelectors<S extends Record<string, string>>(
  selectors: S,
  root: ParentNode = document
): { [key in keyof S]: HTMLElement } {
  type T = { [key in keyof S]: HTMLElement };
  const elements: Partial<T> = {};
  for (const key in selectors) {
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    elements[key] = root.querySelector(selectors[key]) as T[Extract<keyof S, string>];
  }
  return elements as T;
}

export function once(fn: Function, context: any) {
  let result: Function | null = null;
  return function (this: any, ...args: any[]) {
    if (fn) {
      result = fn.apply(context ?? this, args);
      fn = null as any;
    }
    return result;
  };
}

export function setAttributes(el: Element, attrs: Record<string, string>) {
  Object.keys(attrs).forEach((key) => {
    el.setAttribute(key, attrs[key]);
  });
}

export function copyToClipboard(str: string) {
  const el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy'); // eslint-disable-line @typescript-eslint/no-deprecated
  document.body.removeChild(el);
}

export function getRounder(multiple: number, precision: number) {
  return (value: number) => {
    const roundedValue = Math.round(value / multiple) * multiple;
    const roundedValueFixedPrecision = +roundedValue.toFixed(precision);
    return roundedValueFixedPrecision;
  };
}

export function roundValue(value: number, multiple: number, precision: number) {
  return getRounder(multiple, precision)(value);
}

export const speedRounder = getRounder(5e-2, 2);
export const timeRounder = getRounder(1e-6, 6);
export function mod(dividend: number, divisor: number): number {
  return ((dividend % divisor) + divisor) % divisor;
}

// --- seekToSafe coalescer --------------------------------------------------
//
// HTML5 video can only run one seek at a time. The previous seekToSafe
// just dropped requests while ``video.seeking`` was true, which is fine
// for one-shot callers but broken for drag handlers that fire 10-100
// requests per second (crop-point drag, marker drag, Alt+Drag video
// scrub). With drops, only one in every N requests landed:
// the user would let go of a drag and the video would be stuck at some
// earlier intermediate position; "shifting" again was needed to break
// the stuck state.
//
// Now we coalesce instead. While a seek is in flight, the latest
// requested target lives in a single pending slot; when the active
// seek finishes (``seeked`` event), the pending target is flushed:
// "latest write wins". The decision logic is the pure core in
// seek-coalescer.ts; this file is the shell that holds the state and
// applies its effects. On top of that:
//
//   - A 1s timer recovers a missed ``seeked``: a normal seek settles well within it
//     and its ``seeked`` flushes the pending. The earlier 250ms was too
//     short: a slow seek (YouTube buffering mid-scrub) outran it and
//     the pending was dropped, stranding a fast drag at an intermediate
//     frame. A seek still running after a second keeps its pending and
//     re-arms, so frame steps held behind a slow seek are not lost; a
//     new source (``emptied``) drops it. 5.48's frame timing drops it
//     after the second instead, as 5.48 did (``frameTiming.staleSeek``).
//
//   - A ``seeking`` event listener detects external seeks (YouTube
//     progress bar, native keyboard shortcuts, ad insertion, etc.)
//     and discards any pending target, so an external seek can't be
//     snap-backed by a stale pending from our coalescer.

let pendingSeekTime: number | null = null;
let pendingSeekVideo: VideoElement | null = null;
let stalePendingTimerId: number | null = null;
let expectingOurSeekingEvent = false;

const STALE_PENDING_TIMEOUT_MS = 1000;

/** The seek target held back while another seek is in flight, if any: where the playhead goes next. */
export function getPendingSeekTime(): number | null {
  return pendingSeekTime;
}

// Apply a decision from the pure core: store the new pending slot, (re)arm or clear the stale timer,
// and fire any seek it asked for.
function applyDecision(video: VideoElement, decision: SeekDecision) {
  pendingSeekTime = decision.pending;
  if (decision.effects.some((e) => e.type === 'armTimer')) {
    armStalePendingTimer();
  } else if (stalePendingTimerId !== null) {
    clearTimeout(stalePendingTimerId);
    stalePendingTimerId = null;
  }
  for (const effect of decision.effects) {
    if (effect.type === 'fire') fireSeekNow(video, effect.target);
  }
}

function armStalePendingTimer() {
  if (stalePendingTimerId !== null) clearTimeout(stalePendingTimerId);
  stalePendingTimerId = window.setTimeout(() => {
    stalePendingTimerId = null;
    if (pendingSeekVideo === null) return;
    applyDecision(
      pendingSeekVideo,
      frameTiming.staleSeek(
        pendingSeekTime,
        // eslint-disable-next-line no-restricted-syntax -- the seek coalescer owns seeks
        pendingSeekVideo.getCurrentTime(),
        pendingSeekVideo.seeking
      )
    );
  }, STALE_PENDING_TIMEOUT_MS);
}

function fireSeekNow(video: VideoElement, target: number) {
  // Tag the upcoming 'seeking' event as ours so onSeeking doesn't misclassify it as external. Reset on
  // throw so a failed seek doesn't leave us "expecting" forever.
  expectingOurSeekingEvent = true;
  try {
    video.seekTo(target);
  } catch (e) {
    expectingOurSeekingEvent = false;
    console.error(e);
  }
}

function onSeeked() {
  if (pendingSeekVideo === null) return;
  applyDecision(
    pendingSeekVideo,
    // eslint-disable-next-line no-restricted-syntax -- the seek coalescer owns seeks
    onSeekSettled(pendingSeekTime, pendingSeekVideo.getCurrentTime(), pendingSeekVideo.seeking)
  );
}

function onSeeking() {
  // Distinguish our seek from an external one (YT progress bar, native shortcut, ad). If WE just
  // fired, consume the flag. Otherwise an external source initiated this seek, so drop our pending so
  // it can't snap back over the user's intent.
  if (expectingOurSeekingEvent) {
    expectingOurSeekingEvent = false;
    return;
  }
  if (pendingSeekVideo !== null) applyDecision(pendingSeekVideo, onExternalSeek());
}

// A new source (YouTube reuses the video element) ends a stuck seek without 'seeked'.
function onEmptied() {
  const decision = frameTiming.newSourceSeek();
  if (pendingSeekVideo !== null && decision) applyDecision(pendingSeekVideo, decision);
}

function ensureSeekListeners(video: VideoElement) {
  if (pendingSeekVideo === video) return;
  if (pendingSeekVideo !== null) {
    pendingSeekVideo.removeEventListener('seeked', onSeeked);
    pendingSeekVideo.removeEventListener('seeking', onSeeking);
    pendingSeekVideo.removeEventListener('emptied', onEmptied);
    // The old video's target is not for this one.
    const decision = frameTiming.newSourceSeek();
    if (decision) applyDecision(video, decision);
  }
  pendingSeekVideo = video;
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('emptied', onEmptied);
}

export function seekToSafe(video: VideoElement, newTime: number) {
  newTime = clampNumber(newTime, 0, video.duration);
  if (isNaN(newTime)) return;
  ensureSeekListeners(video);
  // eslint-disable-next-line no-restricted-syntax -- the seek coalescer owns seeks
  applyDecision(video, onSeekRequest(newTime, video.getCurrentTime(), video.seeking));
}
export function seekBySafe(video: VideoElement, timeDelta: number) {
  // eslint-disable-next-line no-restricted-syntax -- a relative seek starts from the playhead
  const newTime = video.getCurrentTime() + timeDelta;
  seekToSafe(video, newTime);
}
/** Pause only if playing. Re-pausing an already-paused element still churns the wrapping player
 *  (YouTube can flash a buffering spinner), and loops/auto-key call this repeatedly, so prefer it
 *  over a raw `video.pause()` in hot paths. */
export function pauseSafe(video: VideoElement) {
  if (!video.paused) video.pause();
}
export function blockEvent(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function getCropString(x: number, y: number, w: number, h: number) {
  return `${x}:${y}:${w}:${h}`;
}
export function ternaryToString(ternary?: boolean, def?: string) {
  if (ternary == null) {
    return def ?? '(Disabled)';
  } else if (ternary) {
    return '(Enabled)';
  } else if (!ternary) {
    return '(Disabled)';
  } else {
    return null;
  }
}

export function arrayEquals(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function onLoadVideoPage(callback: Function) {
  const ytdapp = await retryUntilTruthyResult(() => document.getElementsByTagName('ytd-app')[0]);
  if (ytdapp.hasAttribute('is-watch-page')) {
    console.log('watch page loaded');
    callback();
    return;
  }
  const observer = new MutationObserver((mutationList) => {
    mutationList.forEach((mutation) => {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'is-watch-page' &&
        ytdapp.hasAttribute('is-watch-page')
      ) {
        console.log('watch page loaded');
        observer.disconnect();
        callback();
      }
    });
  });
  const config = { attributeFilter: ['is-watch-page'] };
  console.log(`Waiting for video page load before calling ${callback.name}`);
  observer.observe(ytdapp, config);
}

export function observeVideoElementChange(videoContainer: HTMLElement, callback: Function) {
  const observer = new MutationObserver((mutationList: MutationRecord[]) => {
    mutationList.forEach((mutation) => {
      if (mutation.type === 'childList') {
        console.log('observed mutation in video container', mutation);
        callback(mutation.addedNodes);
      }
    });
  });
  console.log(`Watching for changes to video container nodes. callback=${callback.name}`);
  observer.observe(videoContainer, { childList: true });
}

export function parseTimeStringToSeconds(timeString) {
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

let videoDuration = NaN;
export function getVideoDuration(platform: VideoPlatforms, video: HTMLVideoElement): number {
  if (!Number.isNaN(videoDuration)) {
    return videoDuration;
  }

  if (platform === VideoPlatforms.afreecatv) {
    let duration = 0;
    for (const videoPart of (unsafeWindow as any).vodCore.playerController.fileItems) {
      duration += videoPart.duration;
    }

    videoDuration = duration;
  } else {
    videoDuration = video.duration;
  }

  return videoDuration;
}
export function injectProgressBar(color: string, tag: string) {
  const progressDiv = document.createElement('div');
  progressDiv.setAttribute('class', 'msg-div');
  progressDiv.addEventListener('done', () => {
    progressDiv.setAttribute('class', 'msg-div flash-div');
    setTimeout(() => {
      deleteElement(progressDiv);
    }, 2500);
  });
  render(
    html`<span class="flash-msg" style="color:${color}"> ${tag} Zipping Progress: 0%</span>`,
    progressDiv
  );
  appState.hooks.frameCapturerProgressBar.insertAdjacentElement('beforebegin', progressDiv);
  return progressDiv;
}
