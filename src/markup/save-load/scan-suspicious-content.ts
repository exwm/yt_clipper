import DOMPurify, { Config, RemovedAttribute, RemovedElement } from 'dompurify';

// Maximally strict DOMPurify config for SCAN-AND-REPORT use. yt_clipper's
// loadable fields (titleSuffix / titlePrefix / crop strings / merge list /
// etc.) have no legitimate HTML use — titleSuffix becomes a filename, the
// rest are syntactic strings (numeric, regex-matched). Any HTML-like tag
// or attribute in loaded data is worth flagging for user review, even if
// benign (e.g. `<b>` in a share URL is a surprise the user should see).
//
// `ALLOWED_TAGS: []` + `ALLOWED_ATTR: []` strips EVERY tag/attribute, so
// `.removed` catches anything that DOMPurify's parser recognizes as markup.
// Stray `<` / `>` in non-tag contexts (e.g. `<3 clips`, `x < y`) are NOT
// flagged because the HTML parser treats them as text, not tags.
const SCAN_CONFIG: Config = {
  ALLOWED_TAGS: [],
  ALLOWED_ATTR: [],
};

// Per-field findings from walking a loaded payload and passing each string
// value through DOMPurify. Purely informational — use for user warnings in
// load dialogs. DOMPurify's own docs say `.removed` must not be used for
// security-critical decisions (that's the sanitized output's job); here we
// use it as a "curious minds" helper for content review.
export interface SuspiciousHtmlFinding {
  /** Dotted/bracketed JSON path to the string field, e.g. `settings.titleSuffix`. */
  path: string;
  /** Human-readable descriptions of what DOMPurify stripped from the field's value. */
  items: string[];
}

// Walk an arbitrary loaded payload, invoking `visit` for every string leaf
// along with its dotted path.
function walkStrings(
  value: unknown,
  path: string,
  visit: (path: string, value: string) => void
): void {
  if (typeof value === 'string') {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
    return;
  }
  if (value != null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, path === '' ? k : `${path}.${k}`, visit);
    }
  }
}

// Elements DOMPurify's parser synthesizes around fragments (jsdom behavior
// varies too). Under strict `ALLOWED_TAGS: []`, these auto-generated
// wrappers get stripped and reported — but they weren't in the user's data,
// so filter them out UNLESS they carry attributes (which might be exploit
// vectors like `<body onload=...>`).
const PARSER_WRAPPER_TAGS = new Set(['html', 'head', 'body']);

function describeRemoved(entry: RemovedElement | RemovedAttribute): string | null {
  if ('element' in entry && entry.element) {
    const name = entry.element.nodeName;
    const tagName = typeof name === 'string' ? name.toLowerCase() : '?';
    if (PARSER_WRAPPER_TAGS.has(tagName)) {
      const el = entry.element as Element;
      if (el.attributes.length === 0) return null;
    }
    return `<${tagName}>`;
  }
  if ('attribute' in entry && entry.attribute) {
    return `${entry.attribute.name}= attribute`;
  }
  return 'unknown node';
}

// Walks `payload` and uses DOMPurify to scan every string leaf for
// HTML/markup that the library would strip. Returns per-field findings.
// Returns [] when the payload has no suspicious content.
export function scanSuspiciousContent(payload: unknown): SuspiciousHtmlFinding[] {
  const findings: SuspiciousHtmlFinding[] = [];

  walkStrings(payload, '', (path, str) => {
    // Empty strings are common and never have markup — skip the sanitizer call.
    if (str.length === 0) return;

    DOMPurify.sanitize(str, SCAN_CONFIG);
    if (DOMPurify.removed.length === 0) return;

    // Collect descriptions, filter parser-wrapper noise, de-duplicate.
    const items = Array.from(
      new Set(DOMPurify.removed.map(describeRemoved).filter((s): s is string => s !== null))
    );

    // DOMPurify.removed is module-level state — reset before the next scan
    // so findings don't accumulate across fields.
    DOMPurify.removed.length = 0;

    if (items.length === 0) return;
    findings.push({ path, items });
  });

  return findings;
}

// Formats findings as a short multi-line string for logs / flash messages.
// Example: `settings.titleSuffix: <script>, onclick= attribute`.
export function formatFindings(findings: readonly SuspiciousHtmlFinding[]): string {
  return findings.map((f) => `${f.path}: ${f.items.join(', ')}`).join('\n');
}
