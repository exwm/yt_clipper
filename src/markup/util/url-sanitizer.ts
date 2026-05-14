import { render } from 'lit-html';
import type { SanitizerFactory, ValueSanitizer } from 'lit-html';

// This sanitizer is defense-in-depth against scheme-based XSS in URL
// attributes committed through lit-html templates. It is NOT a complete
// defense against URL-based attacks:
//
// - Only blocks dangerous SCHEMES (`javascript:` / `data:` / `vbscript:`).
//   An attacker-controlled `https://attacker.com/...` URL passes through.
// - Auto-fetch contexts (`<img src>`, `<link href>`, `<iframe src>`,
//   `<script src>`, `<video poster>`) still leak Referer/IP/UA/timing to
//   the attacker origin and enable third-party CSRF + CSS-selector exfil.
// - Does not cover direct DOM writes (`el.href = x`, `el.setAttribute(...)`)
//   or navigation sinks (`location.href = x`, `window.open(x)`) — those are
//   caught by the `local/no-url-attribute-interpolation` ESLint rule at dev
//   time.
//
// The primary defense is the lint rule, which forbids dynamic URL values
// from reaching URL-context bindings at all. This sanitizer is the runtime
// backstop when that rule is bypassed (e.g. via `eslint-disable`).
//
// If we ever NEED dynamic URLs, the next hardening step is an origin
// allowlist (validate that the URL's origin matches a known-trusted host)
// plus `rel="noreferrer noopener"` on user-clickable `<a>` tags. We have
// no dynamic URLs today, so that complexity is deferred.

// URL-context HTML attributes — when lit-html commits a value to one of these
// attributes, schemes like `javascript:` / `data:` / `vbscript:` navigate or
// execute. Keep in sync with eslint-rules/no-url-attribute-interpolation.ts.
const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'ping',
  'xlink:href',
  'xlink:show',
  'xlink:actuate',
]);

// URL-valued DOM properties. camelCase `formAction` vs `formaction` attribute.
const URL_PROPS = new Set(['href', 'src', 'action', 'formAction', 'poster']);

// Leading whitespace / C0 controls can be used to bypass naive scheme checks,
// so strip them before testing. Matches DOMPurify's ALLOWED_URI_REGEXP style.
// eslint-disable-next-line no-control-regex
const DANGEROUS_SCHEME = /^[\s\u0000-\u001f]*(javascript|data|vbscript):/i;

function isUrlContext(name: string, type: 'property' | 'attribute'): boolean {
  if (type === 'attribute') return URL_ATTRS.has(name.toLowerCase());
  return URL_PROPS.has(name);
}

export const blockDangerousUrl: ValueSanitizer = (value) => {
  if (typeof value !== 'string') return value;
  if (DANGEROUS_SCHEME.test(value)) {
    console.error('[yt_clipper] Blocked dangerous URL scheme in lit template:', value);
    return '';
  }
  return value;
};

export const identitySanitizer: ValueSanitizer = (value) => value;

export const urlSanitizerFactory: SanitizerFactory = (_node, name, type) =>
  isUrlContext(name, type) ? blockDangerousUrl : identitySanitizer;

// Install the URL sanitizer as lit-html's sanitizer factory. Must be called
// before the first `render()` invocation — lit-html caches the factory at
// template instantiation time, so a late install has no effect on templates
// already rendered.
//
// IMPORTANT: lit-html's sanitizer hooks are compiled out of the production
// build via `ENABLE_EXTRA_SECURITY_HOOKS = false`. In production bundles,
// `render.setSanitizer` does not exist — we guard against that or init will
// throw a TypeError. In dev/test builds the hook is present and the
// sanitizer runs. Effective in production only if Parcel is configured to
// resolve `lit-html` → `lit-html/development/lit-html.js` (not the default).
// That's a deliberate tradeoff (bundle size + perf for defense-in-depth) and
// we don't take it — our primary defense is the `local/no-url-attribute-
// interpolation` ESLint rule plus lit-html's built-in structural safety,
// which together prevent dynamic URLs from reaching template bindings at
// dev time and prevent HTML injection at runtime regardless.
export function installLitUrlSanitizer(): void {
  const setSanitizer = (render as unknown as { setSanitizer?: typeof render.setSanitizer })
    .setSanitizer;
  if (typeof setSanitizer !== 'function') return;
  setSanitizer(urlSanitizerFactory);
}
