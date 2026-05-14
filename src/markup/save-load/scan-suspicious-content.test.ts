/** @jest-environment jsdom */
import { formatFindings, scanSuspiciousContent } from './scan-suspicious-content';

describe('scanSuspiciousContent', () => {
  test('returns empty for safe payload', () => {
    const payload = {
      settings: { titleSuffix: 'my clip', videoID: 'abc123' },
      markerPairs: [{ speed: 1, crop: '0:0:iw:ih' }],
    };
    expect(scanSuspiciousContent(payload)).toEqual([]);
  });

  test('returns empty for primitives and null/undefined', () => {
    expect(scanSuspiciousContent(42)).toEqual([]);
    expect(scanSuspiciousContent(null)).toEqual([]);
    expect(scanSuspiciousContent(undefined)).toEqual([]);
    expect(scanSuspiciousContent(true)).toEqual([]);
  });

  test('flags <iframe> in a string field', () => {
    // Note: <script> is stripped by jsdom's HTML fragment parser before
    // DOMPurify's sanitizer hook fires, so it does not appear in .removed
    // in this test env (it does in real browsers). We use <iframe> which
    // reliably reaches DOMPurify's walker in both environments.
    const payload = { settings: { titleSuffix: '<iframe src="x"></iframe>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('settings.titleSuffix');
    expect(findings[0].items).toContain('<iframe>');
  });

  test('flags inline event handler attributes', () => {
    const payload = { settings: { titleSuffix: '<img src=x onerror=alert(1)>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('settings.titleSuffix');
    expect(findings[0].items.some((i) => i.includes('onerror'))).toBe(true);
  });

  test('reports per-field paths in nested structures', () => {
    const payload = {
      settings: { titleSuffix: '<iframe></iframe>' },
      markerPairs: [
        { overrides: { titlePrefix: 'clean text' } },
        { overrides: { titlePrefix: '<svg onload=x></svg>' } },
      ],
    };
    const findings = scanSuspiciousContent(payload);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['markerPairs[1].overrides.titlePrefix', 'settings.titleSuffix']);
  });

  test('does not flag angle brackets in non-tag contexts (HTML parser treats as text)', () => {
    const payload = { settings: { titleSuffix: 'My <3 clips, x < 5, a > b' } };
    expect(scanSuspiciousContent(payload)).toEqual([]);
  });

  test('flags benign formatting tags under strict config (no legitimate HTML use)', () => {
    // With ALLOWED_TAGS: [], any tag — even <b> — is flagged for review.
    // This matches our threat model: loadable fields have no legit HTML use.
    const payload = { settings: { titleSuffix: '<b>bold title</b>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].items).toContain('<b>');
  });

  test('flags <a href> tags with safe URLs under strict config', () => {
    const payload = { settings: { titleSuffix: '<a href="https://ok.com">link</a>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].items).toContain('<a>');
  });

  test('flags HTML entities stripped by DOMPurify? No — entities are text-level', () => {
    // HTML entities (&amp;, &lt;) are decoded / kept by DOMPurify, not stripped.
    // They don't appear in .removed — consistent with them being legitimate text.
    const payload = { settings: { titleSuffix: 'a &amp; b, x &lt; y' } };
    expect(scanSuspiciousContent(payload)).toEqual([]);
  });

  test('resets DOMPurify.removed state between fields', () => {
    const payload = {
      a: '<iframe></iframe>',
      b: 'clean',
      c: '<object></object>',
    };
    const findings = scanSuspiciousContent(payload);
    // Two findings, one per dangerous field — not cumulative.
    expect(findings).toHaveLength(2);
    const pathA = findings.find((f) => f.path === 'a');
    const pathC = findings.find((f) => f.path === 'c');
    expect(pathA?.items).toContain('<iframe>');
    expect(pathC?.items).toContain('<object>');
    // Field b should not be in findings at all.
    expect(findings.find((f) => f.path === 'b')).toBeUndefined();
  });

  test('skips empty strings to avoid pointless sanitizer calls', () => {
    const payload = { settings: { titleSuffix: '' } };
    expect(scanSuspiciousContent(payload)).toEqual([]);
  });

  // Note: <style> and <link> tags don't survive jsdom's HTML fragment parser
  // long enough to reach DOMPurify's sanitizer walker, so they cannot be
  // asserted via findings in this test env. In real browsers DOMPurify uses
  // an isolated parser (hidden iframe / DOMParser) that DOES pass them to
  // the walker, and the SCAN_CONFIG's `FORBID_TAGS: ['style', 'link', ...]`
  // causes them to be stripped and reported. Covered by <form> here and
  // manually verified in a real browser.

  test('flags inline style attribute (CSS injection vector)', () => {
    const payload = { settings: { titleSuffix: '<div style="background:url(//x)">x</div>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].items.some((i) => i.includes('style'))).toBe(true);
  });

  test('flags <form> elements (FORBID_TAGS addition)', () => {
    const payload = { settings: { titleSuffix: '<form action="//x"><input name=a></form>' } };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].items).toContain('<form>');
  });

  test('flags srcset attribute (FORBID_ATTR addition)', () => {
    const payload = {
      settings: { titleSuffix: '<img srcset="//attacker/a 1x, //attacker/b 2x">' },
    };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    expect(findings[0].items.some((i) => i.includes('srcset'))).toBe(true);
  });

  test('walks arrays with bracket notation paths', () => {
    const payload = ['<iframe></iframe>', 'clean', '<object></object>'];
    const findings = scanSuspiciousContent(payload);
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['[0]', '[2]']);
  });

  test('de-duplicates repeated item descriptions within a field', () => {
    const payload = { titleSuffix: '<iframe></iframe><iframe></iframe>' };
    const findings = scanSuspiciousContent(payload);
    expect(findings).toHaveLength(1);
    // Even though two <iframe> elements were stripped, we collapse to one.
    expect(findings[0].items.filter((i) => i === '<iframe>')).toHaveLength(1);
  });
});

describe('formatFindings', () => {
  test('formats empty findings as empty string', () => {
    expect(formatFindings([])).toBe('');
  });

  test('formats one finding as path: items', () => {
    expect(formatFindings([{ path: 'settings.titleSuffix', items: ['<script>'] }])).toBe(
      'settings.titleSuffix: <script>'
    );
  });

  test('formats multiple findings across multiple lines', () => {
    const formatted = formatFindings([
      { path: 'a.b', items: ['<script>', '<iframe>'] },
      { path: 'c.d', items: ['onclick= attribute'] },
    ]);
    expect(formatted).toBe('a.b: <script>, <iframe>\nc.d: onclick= attribute');
  });
});
