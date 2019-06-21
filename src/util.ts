export function toHHMMSS(seconds: number) {
  return new Date(seconds * 1000).toISOString().substr(11, 12);
}

export function toHHMMSSTrimmed(seconds: number) {
  return toHHMMSS(seconds).replace(/(00:)+(.*)/, '$2');
}

export function setAttributes(el: HTMLElement, attrs: {}) {
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
