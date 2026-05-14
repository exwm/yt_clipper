import {
  ClipperInputValidationError,
  parseClipperInput,
  parseClipperInputJSON,
  toApplicableSettings,
} from './parse-clipper-input';

describe('parseClipperInputJSON: syntactic + proto strip', () => {
  test('rejects invalid JSON with unified error type', () => {
    expect(() => parseClipperInputJSON('not json')).toThrow(ClipperInputValidationError);
  });

  test('strips __proto__ during JSON.parse (reviver path)', () => {
    const text = JSON.stringify({
      __proto__: { isAdmin: true },
      markerPairs: [],
      videoID: 'x',
    });
    const { input } = parseClipperInputJSON(text);
    // Object.prototype must not have been polluted.
    expect(({} as any).isAdmin).toBeUndefined();
    // Input has no __proto__ own key.
    expect(Object.prototype.hasOwnProperty.call(input, '__proto__')).toBe(false);
    expect(input.videoID).toBe('x');
  });

  test('strips constructor + prototype keys too', () => {
    const text = '{"constructor": "x", "prototype": "y", "markerPairs": []}';
    const { input } = parseClipperInputJSON(text);
    const asRec = input as unknown as Record<string, unknown>;
    expect(asRec.constructor).not.toBe('x'); // not copied as own prop
    expect(asRec.prototype).toBeUndefined();
  });
});

describe('parseClipperInput: top-level shape', () => {
  test('rejects non-object top level', () => {
    expect(() => parseClipperInput(null)).toThrow(/object at the top level/);
    expect(() => parseClipperInput(42)).toThrow(/object at the top level/);
    expect(() => parseClipperInput('string')).toThrow(/object at the top level/);
    expect(() => parseClipperInput([1, 2, 3])).toThrow(/object at the top level/);
  });

  test('rejects missing markerPairs', () => {
    expect(() => parseClipperInput({ videoID: 'x' })).toThrow(/markerPairs must be an array/);
  });

  test('rejects non-array markerPairs', () => {
    expect(() => parseClipperInput({ markerPairs: 'not-an-array' })).toThrow(
      /markerPairs must be an array/
    );
  });

  test('accepts empty markerPairs array', () => {
    const { input } = parseClipperInput({ markerPairs: [], videoID: 'x' });
    expect(input.markerPairs).toEqual([]);
    expect(input.videoID).toBe('x');
  });

  test('normalizes legacy `markers` → `markerPairs`', () => {
    const { input } = parseClipperInput({ markers: [{ start: 0, end: 5 }], videoID: 'x' });
    expect(input.markerPairs).toHaveLength(1);
    expect(input.markerPairs[0].start).toBe(0);
  });

  test('prefers `markerPairs` over legacy `markers` when both present', () => {
    const { input } = parseClipperInput({
      markerPairs: [{ start: 0, end: 5 }],
      markers: [{ start: 100, end: 200 }],
    });
    expect(input.markerPairs).toHaveLength(1);
    expect(input.markerPairs[0].start).toBe(0);
  });

  test('caps markerPairs count', () => {
    const pairs = Array.from({ length: 10_001 }, (_, i) => ({ start: i, end: i + 1 }));
    expect(() => parseClipperInput({ markerPairs: pairs })).toThrow(/max 10000/);
  });
});

describe('parseClipperInput: marker pair validation', () => {
  test('rejects non-object pair', () => {
    expect(() => parseClipperInput({ markerPairs: ['not an object'] })).toThrow(
      /markerPairs\[0\] is not an object/
    );
    expect(() => parseClipperInput({ markerPairs: [[1, 2, 3]] })).toThrow(
      /markerPairs\[0\] is not an object/
    );
  });

  test('rejects pair with non-finite start', () => {
    expect(() => parseClipperInput({ markerPairs: [{ start: NaN, end: 5 }] })).toThrow(
      /start must be a finite/
    );
    expect(() => parseClipperInput({ markerPairs: [{ start: Infinity, end: 5 }] })).toThrow(
      /start must be a finite/
    );
    expect(() => parseClipperInput({ markerPairs: [{ start: 'text', end: 5 }] })).toThrow(
      /start must be a finite/
    );
  });

  test('rejects pair with negative start', () => {
    expect(() => parseClipperInput({ markerPairs: [{ start: -1, end: 5 }] })).toThrow(
      /start must be a finite >= 0/
    );
  });

  test('rejects pair with non-finite end', () => {
    expect(() => parseClipperInput({ markerPairs: [{ start: 0, end: NaN }] })).toThrow(
      /end must be a finite/
    );
  });

  test('coerces speed-as-string to number (legacy format compat)', () => {
    const { input } = parseClipperInput({ markerPairs: [{ start: 0, end: 5, speed: '1.5' }] });
    expect(input.markerPairs[0].speed).toBe(1.5);
  });

  test('drops invalid speedMap / cropMap points silently', () => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          speedMap: [
            { x: 0, y: 1 },
            { x: 1, y: NaN }, // dropped
            { x: 'bad', y: 2 }, // dropped
            { x: 2, y: 1.5 },
          ],
          cropMap: [
            { x: 0, y: 0, crop: '0:0:iw:ih' },
            { x: 1, y: 5, crop: 'bad' }, // dropped — y must be 0
            { x: 2, y: 0, crop: '100:100:200:200', easeIn: 'instant' },
          ],
        },
      ],
    });
    expect(input.markerPairs[0].speedMap).toHaveLength(2);
    expect(input.markerPairs[0].cropMap).toHaveLength(2);
    expect(input.markerPairs[0].cropMap![1].easeIn).toBe('instant');
  });
});

describe('parseClipperInput: allowlist filter', () => {
  test('strips unknown top-level keys', () => {
    const { input } = parseClipperInput({
      markerPairs: [],
      videoID: 'x',
      evilKey: 'attacker',
      __proto__: 'ignored', // kept as own prop by JSON (via obj-path, not reviver); should be stripped
    } as Record<string, unknown>);
    expect((input as unknown as Record<string, unknown>).evilKey).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(input, '__proto__')).toBe(false);
    expect(input.videoID).toBe('x');
  });

  test('strips unknown pair keys', () => {
    const { input } = parseClipperInput({
      markerPairs: [{ start: 0, end: 5, evil: 'x', anotherBad: 42 }],
    });
    expect((input.markerPairs[0] as Record<string, unknown>).evil).toBeUndefined();
    expect((input.markerPairs[0] as Record<string, unknown>).anotherBad).toBeUndefined();
  });

  test('strips unknown overrides keys', () => {
    const { input } = parseClipperInput({
      markerPairs: [{ start: 0, end: 5, overrides: { titlePrefix: 'ok', unknown: 'bad' } }],
    });
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(overrides.titlePrefix).toBe('ok');
    expect(overrides.unknown).toBeUndefined();
  });

  test('preserves all known Settings fields', () => {
    const { input } = parseClipperInput({
      markerPairs: [],
      videoID: 'v',
      titleSuffix: 't',
      cropResWidth: 1920,
      cropResHeight: 1080,
      encodeSpeed: 3,
      crf: 23,
      rotate: 'clock',
      enableHDR: true,
      loop: 'fwrev',
    });
    expect(input.videoID).toBe('v');
    expect(input.titleSuffix).toBe('t');
    expect(input.cropResWidth).toBe(1920);
    expect(input.encodeSpeed).toBe(3);
    expect(input.rotate).toBe('clock');
    expect(input.loop).toBe('fwrev');
  });

  test('preserves save-time metadata (version, date)', () => {
    const { input } = parseClipperInput({
      markerPairs: [],
      version: '5.43.0',
      date: 1_700_000_000_000,
    });
    expect(input.version).toBe('5.43.0');
    expect(input.date).toBe(1_700_000_000_000);
  });
});

describe('parseClipperInput: prototype pollution defense', () => {
  test('strips __proto__ nested in marker pair via recursive walk', () => {
    const { input } = parseClipperInput({
      markerPairs: [{ start: 0, end: 5, overrides: { __proto__: { polluted: true } } }],
    } as Record<string, unknown>);
    expect(({} as any).polluted).toBeUndefined();
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(overrides, '__proto__')).toBe(false);
  });

  test('rejects overly deep nesting (stack overflow defense)', () => {
    // Build a ~100-deep chain (cap is 64).
    let deep: Record<string, unknown> = { markerPairs: [] };
    for (let i = 0; i < 100; i++) deep = { nest: deep };
    expect(() => parseClipperInput(deep)).toThrow(/nesting too deep/);
  });
});

describe('toApplicableSettings: applied vs skipped keys', () => {
  test('skips source-environment metadata (platform, videoTag, videoID, videoTitle, videoUrl, ...)', () => {
    const { input } = parseClipperInput({
      markerPairs: [],
      platform: 'youtube',
      videoID: 'abc',
      videoTag: 'old-tag',
      videoTitle: 'My Video',
      videoUrl: 'https://example.com/v',
      isVerticalVideo: false,
      version: '5.43.0',
      date: 1_700_000_000_000,
      titleSuffix: 'clip',
    });
    const applied = toApplicableSettings(input);
    // None of these source-environment keys should leak into appState.settings.
    expect(applied.platform).toBeUndefined();
    expect(applied.videoID).toBeUndefined();
    expect(applied.videoTag).toBeUndefined();
    expect(applied.videoTitle).toBeUndefined();
    expect(applied.videoUrl).toBeUndefined();
    expect(applied.isVerticalVideo).toBeUndefined();
    // 'version' / 'date' / 'markerPairs' aren't on Settings so they'd never
    // appear in the output anyway, but checking they don't leak via a cast.
    expect((applied as Record<string, unknown>).version).toBeUndefined();
    expect((applied as Record<string, unknown>).date).toBeUndefined();
    expect((applied as Record<string, unknown>).markerPairs).toBeUndefined();
  });

  test('applies user-configurable settings (titleSuffix, crf, rotate, loop, ...)', () => {
    const { input } = parseClipperInput({
      markerPairs: [],
      titleSuffix: 'clip',
      crf: 23,
      encodeSpeed: 3,
      rotate: 'clock',
      loop: 'fwrev',
      twoPass: true,
    });
    const applied = toApplicableSettings(input);
    expect(applied.titleSuffix).toBe('clip');
    expect(applied.crf).toBe(23);
    expect(applied.encodeSpeed).toBe(3);
    expect(applied.rotate).toBe('clock');
    expect(applied.loop).toBe('fwrev');
    expect(applied.twoPass).toBe(true);
  });

  test('omits keys whose source value is undefined', () => {
    const { input } = parseClipperInput({ markerPairs: [], titleSuffix: 'x' });
    const applied = toApplicableSettings(input);
    // crf wasn't in input — should not appear as a key in `applied`.
    expect('crf' in applied).toBe(false);
    expect('rotate' in applied).toBe(false);
  });
});

describe('parseOverrides: per-field type validation', () => {
  test('drops string-where-number override values', () => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          overrides: {
            crf: '<script>alert(1)</script>' as unknown as number,
            gamma: 'infinity' as unknown as number,
            encodeSpeed: 'fast' as unknown as number,
          },
        },
      ],
    } as Record<string, unknown>);
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(overrides.crf).toBeUndefined();
    expect(overrides.gamma).toBeUndefined();
    expect(overrides.encodeSpeed).toBeUndefined();
  });

  test('drops number-where-boolean override values', () => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          overrides: {
            twoPass: 1 as unknown as boolean,
            audio: 0 as unknown as boolean,
            enableHDR: 'true' as unknown as boolean,
          },
        },
      ],
    } as Record<string, unknown>);
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(overrides.twoPass).toBeUndefined();
    expect(overrides.audio).toBeUndefined();
    expect(overrides.enableHDR).toBeUndefined();
  });

  test('drops non-finite numeric override values (NaN, Infinity)', () => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          overrides: { crf: NaN, gamma: Infinity, fadeDuration: -Infinity },
        },
      ],
    } as Record<string, unknown>);
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(overrides.crf).toBeUndefined();
    expect(overrides.gamma).toBeUndefined();
    expect(overrides.fadeDuration).toBeUndefined();
  });

  test('rejects invalid loop enum values, accepts valid ones', () => {
    const accept = parseClipperInput({
      markerPairs: [{ start: 0, end: 5, overrides: { loop: 'fade' } }],
    });
    expect((accept.input.markerPairs[0].overrides as Record<string, unknown>).loop).toBe('fade');

    const reject = parseClipperInput({
      markerPairs: [{ start: 0, end: 5, overrides: { loop: 'javascript:alert(1)' } }],
    } as Record<string, unknown>);
    expect((reject.input.markerPairs[0].overrides as Record<string, unknown>).loop).toBeUndefined();
  });

  test('keeps well-typed values alongside dropped ones', () => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          overrides: {
            titlePrefix: 'real title',
            crf: 23,
            audio: true,
            gamma: 'bad' as unknown as number,
          },
        },
      ],
    } as Record<string, unknown>);
    const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
    expect(overrides.titlePrefix).toBe('real title');
    expect(overrides.crf).toBe(23);
    expect(overrides.audio).toBe(true);
    expect(overrides.gamma).toBeUndefined();
  });
});
