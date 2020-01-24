export async function retryUntilTruthyResult<R>(fn: () => R, wait = 100) {
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

export function once(fn: Function, context: any) {
  var result: Function;
  return function() {
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
    if (high < low || high >= haystack.length)
      throw new RangeError('invalid upper bound');
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
