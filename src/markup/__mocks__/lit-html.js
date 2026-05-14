const nothing = Symbol('lit-html-nothing');
const noChange = Symbol('lit-html-noChange');

function isAttributePosition(precedingString) {
  const lastOpen = precedingString.lastIndexOf('<');
  const lastClose = precedingString.lastIndexOf('>');
  return lastOpen > lastClose;
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function serialize(val, inAttr) {
  if (val == null || val === nothing || val === noChange || val === false || val === true)
    return '';
  if (Array.isArray(val)) return val.map((v) => serialize(v, inAttr)).join('');
  if (typeof val === 'object' && val._$litType$) {
    const { strings, values } = val;
    let result = '';
    for (let i = 0; i < strings.length; i++) {
      result += strings[i];
      if (i < values.length) {
        result += serialize(values[i], isAttributePosition(result));
      }
    }
    return result;
  }
  const s = String(val);
  return inAttr ? escapeAttr(s) : escapeText(s);
}

const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const svg = (strings, ...values) => ({ _$litType$: 2, strings, values });

function render(template, container) {
  if (container && typeof container === 'object' && 'innerHTML' in container) {
    container.innerHTML = serialize(template);
  }
}
render.setSanitizer = () => {};
render.createSanitizer = () => (/** @type {unknown} */ value) => value;

module.exports = {
  html,
  svg,
  render,
  nothing,
  noChange,
};
