import {
  ClipperInputValidationError,
  parseClipperInput,
  parseClipperInputJSON,
  toApplicableSettings,
  applyLoadedSettings,
} from './parse-clipper-input';
import { Settings } from '../@types/yt_clipper';

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
            { x: 1, y: 5, crop: 'bad' }, // dropped, y must be 0
            { x: 2, y: 0, crop: '100:100:200:200', easeIn: 'instant' },
          ],
        },
      ],
    });
    expect(input.markerPairs[0].speedMap).toHaveLength(2);
    expect(input.markerPairs[0].cropMap).toHaveLength(2);
    expect(input.markerPairs[0].cropMap![1].easeIn).toBe('instant');
  });

  // A hold point keeps its flag only while its saved crop equals the crop before it: the clipper
  // renders the saved crop, so a mismatched one loads as a normal point with that crop.
  // A point is normal, instant, or hold. One saved as both keeps the instant cut the clipper renders.
  test.each([
    ['a matching hold point', true, '0:0:960:540', undefined, true],
    ['a hold that is not true', 'yes', '0:0:960:540', undefined, undefined],
    ['a hold point with a different crop', true, '100:0:960:540', undefined, undefined],
    ['an instant hold point', true, '0:0:960:540', 'instant', undefined],
  ])('loads %s', (_name, hold, crop, easeIn, expectedHold) => {
    const { input } = parseClipperInput({
      markerPairs: [
        {
          start: 0,
          end: 5,
          cropMap: [
            { x: 0, y: 0, crop: '0:0:960:540', hold: true },
            { x: 2, y: 0, crop, hold, easeIn },
            { x: 5, y: 0, crop: '0:0:960:540' },
          ],
        },
      ],
    });
    const cropMap = input.markerPairs[0].cropMap!;
    expect(cropMap[0].hold).toBeUndefined();
    expect(cropMap[1]).toEqual({ x: 2, y: 0, crop, easeIn, hold: expectedHold });
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
      cropPointEasingCinematicSolverVersion: 1,
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
    expect((applied as Record<string, unknown>).cropPointEasingCinematicSolverVersion).toBeUndefined();
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
    // crf wasn't in input: should not appear as a key in `applied`.
    expect('crf' in applied).toBe(false);
    expect('rotate' in applied).toBe(false);
  });

  test.each([
    // The clipper renders markers saved before 5.49 (no crop easing) with EaseInOut. Per pair, so
    // the session's own pairs and global mode stay as they are.
    [
      'markers from before 5.49 keep EaseInOut on their pairs',
      {
        markerPairs: [
          { start: 0, end: 5 },
          { start: 6, end: 8, overrides: { cropPointEasing: 'cinematic' } },
        ],
      },
      undefined,
      ['smoothInOut', 'cinematic'],
    ],
    [
      'saved crop easing applies',
      { markerPairs: [{ start: 0, end: 5 }], cropPointEasing: 'cinematic' },
      'cinematic',
      [undefined],
    ],
    [
      'an invalid saved crop easing is dropped, and the file is not taken for one from before 5.49',
      { markerPairs: [{ start: 0, end: 5 }], cropPointEasing: 'linear' },
      undefined,
      [undefined],
    ],
  ])('markers JSON crop easing: %s', (_case, data, globalEasing, pairEasings) => {
    const { input } = parseClipperInputJSON(JSON.stringify(data));
    expect(toApplicableSettings(input).cropPointEasing).toBe(globalEasing);
    expect(input.markerPairs.map((pair) => pair.overrides?.cropPointEasing)).toEqual(pairEasings);
  });
});

describe('applyLoadedSettings: the session settings after a load', () => {
  // A session that changed the Cinematic settings and the crop easing.
  const session = () =>
    ({
      crf: 30,
      cropPointEasing: 'cinematic',
      cropPointEasingCinematicMargin: 20,
      cropPointEasingCinematicZoomMargin: 30,
      cropPointEasingCinematicHolds: 'exact',
    }) as unknown as Settings;
  const cinematic = (settings: Partial<Settings>) => [
    settings.cropPointEasing,
    settings.cropPointEasingCinematicMargin,
    settings.cropPointEasingCinematicZoomMargin,
    settings.cropPointEasingCinematicHolds,
  ];

  test.each([
    // The clipper renders a missing Cinematic setting with its default, so the session's goes.
    ['a file without the Cinematic settings', {}, ['cinematic', undefined, undefined, undefined]],
    [
      'a file with them',
      {
        cropPointEasingCinematicMargin: 6,
        cropPointEasingCinematicZoomMargin: 4,
        cropPointEasingCinematicHolds: 'loose',
      },
      ['cinematic', 6, 4, 'loose'],
    ],
    [
      'a file whose Hold Points value is invalid',
      { cropPointEasingCinematicHolds: 'Firm' },
      ['cinematic', undefined, undefined, undefined],
    ],
    // A file's crop easing applies. A file without one keeps the session's (the first case): parsing
    // pins such a file's own pairs to EaseInOut instead.
    [
      'a file saved with a crop easing',
      { cropPointEasing: 'smoothTrack' },
      ['smoothTrack', undefined, undefined, undefined],
    ],
  ])('%s', (_case, fileSettings, expected) => {
    const { input } = parseClipperInputJSON(JSON.stringify({ markerPairs: [], ...fileSettings }));
    // In place: an open settings editor writes to this object.
    const settings = session();
    applyLoadedSettings(settings, input);
    expect(cinematic(settings)).toEqual(expected);
    expect(settings.crf).toBe(30);
    // Gone, not an explicit undefined that a later spread or save would carry.
    for (const [key, value] of Object.entries(settings)) expect([key, value]).not.toEqual([key, undefined]);
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

  const pairSettingValues: [string, unknown, boolean][] = [
    ['crf', '30 -y', false],
    ['crf', 30, true],
    ['loop', 'forever', false],
    ['loop', 'fade', true],
    ['audio', 'yes', false],
    ['cropPointEasingCinematicMargin', -50, false],
    ['cropPointEasingCinematicMargin', 0, true],
    ['cropPointEasingCinematicMargin', 50, true],
    ['cropPointEasingCinematicMargin', 51, false],
    ['cropPointEasingCinematicZoomMargin', 101, false],
    ['cropPointEasingCinematicZoomMargin', 100, true],
    ['cropPointEasing', 'Cinematic', false],
    ['cropPointEasing', 'cinematic', true],
    ['cropPointEasingCinematicHolds', 'Firm', false],
    ['cropPointEasingCinematicHolds', 'exact', true],
  ];
  test.each(pairSettingValues)(
    'override %s = %p is kept: %s (the schema values)',
    (key, value, kept) => {
      const { input } = parseClipperInput({
        markerPairs: [{ start: 0, end: 5, overrides: { [key]: value } }],
      } as Record<string, unknown>);
      const overrides = input.markerPairs[0].overrides as Record<string, unknown>;
      expect(overrides[key]).toBe(kept ? value : undefined);
    }
  );
  test.each(pairSettingValues)(
    'global setting %s = %p is kept: %s (the schema values)',
    (key, value, kept) => {
      const { input } = parseClipperInput({ markerPairs: [], [key]: value });
      expect((toApplicableSettings(input) as Record<string, unknown>)[key]).toBe(
        kept ? value : undefined
      );
    }
  );

  test('lists the settings it drops for invalid values, global and per pair', () => {
    const { issues } = parseClipperInput({
      crf: '30 -y',
      gamma: 1,
      markerPairs: [{ start: 0, end: 5, overrides: { loop: 'forever', audio: 'yes', crf: 20 } }],
    } as Record<string, unknown>);
    expect(issues).toEqual([
      { kind: 'invalidSettings', path: '(root)', keys: ['crf'] },
      { kind: 'invalidSettings', path: 'markerPairs[0].overrides', keys: ['audio', 'loop'] },
    ]);
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

test('drops the cinematic cropPath that 5.49 dev builds saved', () => {
  const { input, issues } = parseClipperInput({
    markerPairs: [{ start: 0, end: 1, cropPath: { version: 1, segments: [] } }],
  });
  expect(input.markerPairs[0]).not.toHaveProperty('cropPath');
  expect(issues).toEqual([{ kind: 'unexpectedFields', path: 'markerPairs[0]', keys: ['cropPath'] }]);
});
