import DOMPurify from 'dompurify';
import { SpeedPoint } from '../@types/yt_clipper';
import { VideoPlatforms } from '../platforms/platforms';
import { appState, VideoElement } from '../appState';

export function assertDefined<T>(value: T | null | undefined, msg?: string): asserts value is T {
  if (value == null) {
    throw new Error(msg ?? 'Expected value to be defined');
  }
}

export function sanitizeHtml(html: string, forceBody = false): string | TrustedHTML {
  const trustedHtml = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    RETURN_TRUSTED_TYPE: Boolean(window.TrustedHTML),
    FORCE_BODY: forceBody,
  });

  if (DOMPurify.removed.length > 0) {
    console.warn('Sanitized html. removed elements = ', DOMPurify.removed);
  }

  if (window.TrustedHTML) {
    return trustedHtml as unknown as TrustedHTML;
  } else {
    return trustedHtml;
  }
}

export function safeSetInnerHtml(e: HTMLOrSVGElement, html: string, forceBody = false) {
  (e as HTMLElement).innerHTML = sanitizeHtml(html, forceBody) as string;
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
  safeSetInnerHtml(style, css);
  document.body.appendChild(style);
  return style;
}
export function htmlToElement(html: string) {
  const template = document.createElement('template');
  html = html.trim(); // Never return a text node of whitespace as the result
  safeSetInnerHtml(template, html);
  return template.content.firstChild;
}

export function htmlToSVGElement(html: string) {
  const template = document.createElementNS('http://www.w3.org/2000/svg', 'template');
  html = html.trim(); // Never return a text node of whitespace as the result
  safeSetInnerHtml(template, html);
  return template.firstElementChild;
}

export function deleteElement(elem: Element) {
  if (elem?.parentElement) {
    elem.parentElement.removeChild(elem);
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
export function clampNumber(number: number, min: number, max: number) {
  return Math.max(min, Math.min(number, max));
}
export function toHHMMSS(seconds: number) {
  return new Date(seconds * 1000).toISOString().substring(11, 23);
}

export function toHHMMSSTrimmed(seconds: number) {
  return toHHMMSS(seconds).replace(/(00:)+(.*)/, '$2');
}

export function mod(dividend: number, divisor: number): number {
  return ((dividend % divisor) + divisor) % divisor;
}

export function bsearch<A, B>(
  haystack: ArrayLike<A>,
  needle: B,
  comparator: (a: A, b: B, index?: number, haystack?: ArrayLike<A>) => any,
  lowParam?: number,
  highParam?: number
): [number, number] {
  let mid, cmp;

  let low: number = lowParam ?? 0;
  low = low | 0;
  if (low < 0 || low >= haystack.length) throw new RangeError('invalid lower bound');

  let high: number = highParam ?? haystack.length - 1;
  high = high | 0;
  if (high < low || high >= haystack.length) throw new RangeError('invalid upper bound');

  while (low <= high) {
    // The naive `low + high >>> 1` could fail for array lengths > 2**31
    // because `>>>` converts its operands to int32. `low + (high - low >>> 1)`
    // works for array lengths <= 2**32-1 which is also Javascript's max array
    // length.
    mid = low + ((high - low) >>> 1);
    cmp = +comparator(haystack[mid], needle, mid, haystack);

    // Too low.
    if (cmp < 0.0) low = mid + 1;
    // Too high.
    else if (cmp > 0.0) high = mid - 1;
    // Key found.
    else return [mid, mid];
  }

  // Key not found.
  return [high, low];
}

export function getEasedValue(
  easingFunc: (number) => number,
  startValue: number,
  endValue: number,
  startTime: number,
  endTime: number,
  currentTime: number
) {
  const elapsed = currentTime - startTime;
  const duration = endTime - startTime;
  const valueDelta = endValue - startValue;

  const easedValuePercentage = easingFunc(elapsed / duration);

  const easedValue = startValue + valueDelta * easedValuePercentage;
  return easedValue;
}

export function seekToSafe(video: VideoElement, newTime: number) {
  newTime = clampNumber(newTime, 0, video.duration);
  if (!isNaN(newTime) && video.getCurrentTime() != newTime && !video.seeking) {
    try {
      video.seekTo(newTime);
    } catch (e) {
      console.error(e);
    }
  }
}
export function seekBySafe(video: VideoElement, timeDelta: number) {
  const newTime = video.getCurrentTime() + timeDelta;
  seekToSafe(video, newTime);
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

export function getOutputDuration(speedMap: SpeedPoint[], fps = 30) {
  let outputDuration = 0;
  const frameDur = 1 / fps;
  const nSects = speedMap.length - 1;
  // Account for marker pair start time as trim filter sets start time to ~0
  const speedMapStartTime = speedMap[0].x;
  // Account for first input frame delay due to potentially imprecise trim
  const startt = Math.ceil(speedMapStartTime / frameDur) * frameDur - speedMapStartTime;

  for (let sect = 0; sect < nSects; ++sect) {
    const left = speedMap[sect];
    const right = speedMap[sect + 1];

    const startSpeed = left.y;
    const endSpeed = right.y;
    const speedChange = endSpeed - startSpeed;

    const sectStart = left.x - speedMapStartTime - startt;
    let sectEnd = right.x - speedMapStartTime - startt;
    // Account for last input frame delay due to potentially imprecise trim
    if (sect === nSects - 1) {
      sectEnd = Math.floor(right.x / frameDur) * frameDur;
      // When trim is frame-precise, the frame that begins at the marker pair end time is not included
      if (right.x - sectEnd < 1e-10) sectEnd = sectEnd - frameDur;
      sectEnd = sectEnd - speedMapStartTime - startt;
      sectEnd = Math.floor(sectEnd * 1000000) / 1000000;
    }

    const sectDuration = sectEnd - sectStart;
    if (sectDuration === 0) continue;

    const m = speedChange / sectDuration;
    const b = startSpeed - m * sectStart;

    if (speedChange === 0) {
      outputDuration += sectDuration / endSpeed;
    } else {
      // Integrate the reciprocal of the linear time vs speed function for the current section
      outputDuration +=
        (1 / m) * (Math.log(Math.abs(m * sectEnd + b)) - Math.log(Math.abs(m * sectStart + b)));
    }
  }
  // Each output frame time is rounded to the nearest multiple of a frame's duration at the given fps
  outputDuration = Math.round(outputDuration / frameDur) * frameDur;
  // The last included frame is held for a single frame's duration
  outputDuration += frameDur;
  outputDuration = Math.round(outputDuration * 1000) / 1000;
  return outputDuration;
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
  safeSetInnerHtml(
    progressDiv,
    `<span class="flash-msg" style="color:${color}"> ${tag} Zipping Progress: 0%</span>`
  );
  appState.hooks.frameCapturerProgressBar.insertAdjacentElement('beforebegin', progressDiv);
  return progressDiv;
}
