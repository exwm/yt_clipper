import { blockDangerousUrl, identitySanitizer, urlSanitizerFactory } from './url-sanitizer';

describe('blockDangerousUrl', () => {
  const stubNode = {} as Node;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    ['  javascript:alert(1)'],
    ['\tjavascript:alert(1)'],
    ['\u0001javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['DATA:text/html,x'],
    ['vbscript:msgbox("x")'],
  ])('blocks %s', (value) => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(blockDangerousUrl(value)).toBe('');
    expect(spy).toHaveBeenCalled();
  });

  test.each([
    ['https://example.com'],
    ['http://example.com'],
    ['/relative/path'],
    ['./local'],
    ['../up'],
    ['#fragment'],
    ['blob:https://example.com/abc'],
    ['mailto:a@b.com'],
    ['tel:+1234'],
    ['javascripts:fake'], // extra letters after scheme name — not dangerous
    ['xjavascript:fake'], // prefix before scheme — not dangerous
    ['https://example.com/javascript:foo'], // scheme embedded in path is harmless
  ])('allows %s', (value) => {
    expect(blockDangerousUrl(value)).toBe(value);
  });

  test('passes through non-string values unchanged', () => {
    expect(blockDangerousUrl(42)).toBe(42);
    expect(blockDangerousUrl(null)).toBe(null);
    expect(blockDangerousUrl(undefined)).toBe(undefined);
    const obj = { toString: () => 'javascript:alert(1)' };
    expect(blockDangerousUrl(obj)).toBe(obj);
    // Note: lit-html stringifies non-string values at commit time. If an
    // attacker somehow gets a toString-returning-javascript-url object into
    // a URL-context binding, lit-html's string conversion happens AFTER the
    // sanitizer runs. The lint rule covers that case at the source.
  });

  test('identity sanitizer returns value unchanged', () => {
    expect(identitySanitizer('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(identitySanitizer(42)).toBe(42);
  });

  test('factory returns block sanitizer for URL attributes', () => {
    expect(urlSanitizerFactory(stubNode, 'href', 'attribute')).toBe(blockDangerousUrl);
    expect(urlSanitizerFactory(stubNode, 'src', 'attribute')).toBe(blockDangerousUrl);
    expect(urlSanitizerFactory(stubNode, 'action', 'attribute')).toBe(blockDangerousUrl);
    expect(urlSanitizerFactory(stubNode, 'xlink:href', 'attribute')).toBe(blockDangerousUrl);
  });

  test('factory is case-insensitive for attributes', () => {
    expect(urlSanitizerFactory(stubNode, 'HREF', 'attribute')).toBe(blockDangerousUrl);
    expect(urlSanitizerFactory(stubNode, 'Src', 'attribute')).toBe(blockDangerousUrl);
  });

  test('factory returns block sanitizer for URL properties', () => {
    expect(urlSanitizerFactory(stubNode, 'href', 'property')).toBe(blockDangerousUrl);
    expect(urlSanitizerFactory(stubNode, 'formAction', 'property')).toBe(blockDangerousUrl);
  });

  test('factory is case-sensitive for properties (camelCase)', () => {
    // `formAction` is the DOM property; `formaction` is the HTML attribute.
    expect(urlSanitizerFactory(stubNode, 'formaction', 'property')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'formAction', 'property')).toBe(blockDangerousUrl);
  });

  test('factory returns identity for non-URL attributes', () => {
    expect(urlSanitizerFactory(stubNode, 'class', 'attribute')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'id', 'attribute')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'title', 'attribute')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'data-foo', 'attribute')).toBe(identitySanitizer);
  });

  test('factory returns identity for non-URL properties', () => {
    expect(urlSanitizerFactory(stubNode, 'value', 'property')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'textContent', 'property')).toBe(identitySanitizer);
    expect(urlSanitizerFactory(stubNode, 'className', 'property')).toBe(identitySanitizer);
  });

  test('factory returns identity for `data` as a property (Chart.js-style false-positive guard)', () => {
    // `data` is a URL attribute on `<object>`, but `.data` as a DOM property
    // is far more often a data payload (Chart.js, form data).
    expect(urlSanitizerFactory(stubNode, 'data', 'property')).toBe(identitySanitizer);
    // But `data` as an attribute is URL-valued.
    expect(urlSanitizerFactory(stubNode, 'data', 'attribute')).toBe(blockDangerousUrl);
  });
});
