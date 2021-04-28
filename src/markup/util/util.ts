import { SpeedPoint, CropPoint } from '../@types/yt_clipper';

let flashMessageHook: HTMLElement;
export function setFlashMessageHook(hook: HTMLElement) {
  flashMessageHook = hook;
}
export function flashMessage(msg: string, color: string, lifetime = 3000) {
  const flashDiv = document.createElement('div');
  flashDiv.setAttribute('class', 'msg-div flash-div');
  flashDiv.innerHTML = `<span class="flash-msg" style="color:${color}">${msg}</span>`;
  flashMessageHook.insertAdjacentElement('beforebegin', flashDiv);
  setTimeout(() => deleteElement(flashDiv), lifetime);
}

export async function retryUntilTruthyResult<R>(fn: () => R, wait = 200) {
  let result: R = fn();
  while (!result) {
    console.log(`Retrying function: ${fn.name} because result was ${result}`);
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
  style.innerHTML = css;
  document.body.appendChild(style);
  return style;
}
export function htmlToElement(html: string) {
  const template = document.createElement('template');
  html = html.trim(); // Never return a text node of whitespace as the result
  template.innerHTML = html;
  return template.content.firstChild;
}

export function htmlToSVGElement(html: string) {
  const template = document.createElementNS('http://www.w3.org/2000/svg', 'template');
  html = html.trim(); // Never return a text node of whitespace as the result
  template.innerHTML = html;
  return template.firstElementChild;
}

export function deleteElement(elem: Element) {
  if (elem && elem.parentElement) {
    elem.parentElement.removeChild(elem);
  }
}

export function querySelectors<
  S extends { [key: string]: string },
  T extends { [key in keyof S]: HTMLElement }
>(selectors: S, root: ParentNode = document): T {
  const elements: Partial<T> = {};
  for (const key in selectors) {
    elements[key] = root.querySelector(selectors[key]);
  }
  return elements as T;
}

export function once(fn: Function, context: any) {
  var result: Function;
  return function () {
    if (fn) {
      result = fn.apply(context || this, arguments);
      fn = null;
    }
    return result;
  };
}

export function setAttributes(el: Element, attrs: {}) {
  Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]));
}

export function copyToClipboard(str: string) {
  const el = document.createElement('textarea');
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
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
  return new Date(seconds * 1000).toISOString().substr(11, 12);
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
  low?: number,
  high?: number
): [number, number] {
  var mid, cmp;

  if (low === undefined) low = 0;
  else {
    low = low | 0;
    if (low < 0 || low >= haystack.length) throw new RangeError('invalid lower bound');
  }

  if (high === undefined) high = haystack.length - 1;
  else {
    high = high | 0;
    if (high < low || high >= haystack.length) throw new RangeError('invalid upper bound');
  }

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
  const change = endValue - startValue;

  let easedTimePercentage: number;
  easedTimePercentage = easingFunc(elapsed / duration);

  const easedValue = startValue + change * easedTimePercentage;
  return easedValue;
}

export function seekToSafe(video: HTMLVideoElement, newTime: number) {
  newTime = clampNumber(newTime, 0, video.duration);
  if (video.currentTime != newTime && !video.seeking) {
    video.currentTime = newTime;
  }
}
export function seekBySafe(video: HTMLVideoElement, timeDelta: number) {
  const newTime = video.currentTime + timeDelta;
  seekToSafe(video, newTime);
}
export function blockEvent(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function getCropString(x: number, y: number, w: number, h: number) {
  return `${x}:${y}:${w}:${h}`;
}
export function ternaryToString(ternary: boolean, def?: string) {
  if (ternary == null) {
    return def != null ? def : '(Disabled)';
  } else if (ternary === true) {
    return '(Enabled)';
  } else if (ternary === false) {
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
      sectEnd = Math.floor(right['x'] / frameDur) * frameDur;
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
