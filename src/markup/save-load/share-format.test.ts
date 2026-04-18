import { presetsMap } from '../presets';
import {
  ByteReader,
  ByteWriter,
  DENOISE_PRESET_ORDER,
  SHARE_FORMAT_VERSION,
  UnsupportedShareVersionError,
  VSTAB_PRESET_ORDER,
  deserializeBinary,
  serializeBinary,
  slugify,
} from './share-format';
import {
  boundaryFixture,
  canonicalizeSharePayload,
  emptyFixture,
  kitchenSinkFixture,
  manyPairsFixture,
  minimalFixture,
  unicodeTitleFixture,
  variableCropFixture,
  variableSpeedFixture,
  zoomPanFixture,
} from './share-format.fixtures';

describe('share-format primitives', () => {
  describe('varuint', () => {
    const boundaries = [0, 1, 127, 128, 16383, 16384, 2 ** 21 - 1, 2 ** 21, 2 ** 28];
    test.each(boundaries)('roundtrips %i', (n) => {
      const w = new ByteWriter();
      w.writeVaruint(n);
      const r = new ByteReader(w.toUint8Array());
      expect(r.readVaruint()).toBe(n);
    });

    test('throws on negative', () => {
      const w = new ByteWriter();
      expect(() => w.writeVaruint(-1)).toThrow();
    });
  });

  describe('varsint', () => {
    const boundaries = [-(2 ** 27), -16384, -128, -1, 0, 1, 127, 16383, 2 ** 27];
    test.each(boundaries)('roundtrips %i', (n) => {
      const w = new ByteWriter();
      w.writeVarsint(n);
      const r = new ByteReader(w.toUint8Array());
      expect(r.readVarsint()).toBe(n);
    });
  });

  describe('str', () => {
    const cases = ['', 'hello', 'with spaces', '日本語', '🎬🎥', 'clip – 日本'];
    test.each(cases)('roundtrips %s', (s) => {
      const w = new ByteWriter();
      w.writeStr(s);
      const r = new ByteReader(w.toUint8Array());
      expect(r.readStr()).toBe(s);
    });
  });

  describe('ByteReader bounds', () => {
    test('throws RangeError on read past end', () => {
      const r = new ByteReader(new Uint8Array([0x01]));
      r.readByte();
      expect(() => r.readByte()).toThrow(RangeError);
    });

    test('throws RangeError when varuint claims more bytes than available', () => {
      const w = new ByteWriter();
      w.writeStr('long string content');
      const bytes = w.toUint8Array();
      const truncated = bytes.slice(0, 3);
      const r = new ByteReader(truncated);
      expect(() => r.readStr()).toThrow(RangeError);
    });
  });
});

describe('share-format preset guards', () => {
  test('DENOISE_PRESET_ORDER keys are all in presetsMap.denoise', () => {
    for (const key of DENOISE_PRESET_ORDER) {
      expect(presetsMap.denoise).toHaveProperty(key);
    }
  });

  test('VSTAB_PRESET_ORDER keys are all in presetsMap.videoStabilization', () => {
    for (const key of VSTAB_PRESET_ORDER) {
      expect(presetsMap.videoStabilization).toHaveProperty(key);
    }
  });
});

describe('share-format slugify', () => {
  test.each([
    ['', ''],
    ['Hello World', 'hello-world'],
    ['  multiple   spaces  ', 'multiple-spaces'],
    ['日本 clip 2026', 'clip-2026'],
    ['---dashes-and-!@#-symbols---', 'dashes-and-symbols'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  test('truncates to 40 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });
});

describe('share-format roundtrip', () => {
  const fixtures = [
    ['minimal', minimalFixture],
    ['variableSpeed', variableSpeedFixture],
    ['variableCrop', variableCropFixture],
    ['zoomPan', zoomPanFixture],
    ['kitchenSink', kitchenSinkFixture],
    ['unicodeTitle', unicodeTitleFixture],
    ['boundary', boundaryFixture],
    ['manyPairs', manyPairsFixture],
    ['empty', emptyFixture],
  ] as const;

  test.each(fixtures)('%s roundtrips', (_name, fixture) => {
    const bytes = serializeBinary(fixture);
    const decoded = deserializeBinary(bytes);
    const expected = canonicalizeSharePayload(fixture);
    expect(decoded).toEqual(expected);
  });
});

describe('share-format byte budget', () => {
  test('minimal fixture is under 75 B', () => {
    const bytes = serializeBinary(minimalFixture);
    expect(bytes.byteLength).toBeLessThan(75);
  });

  test('kitchenSink fixture is under 80 B', () => {
    const bytes = serializeBinary(kitchenSinkFixture);
    expect(bytes.byteLength).toBeLessThan(80);
  });

  test('50-pair static fixture is under 800 B', () => {
    const bytes = serializeBinary(manyPairsFixture);
    expect(bytes.byteLength).toBeLessThan(800);
  });
});

describe('share-format version handling', () => {
  test('rejects unknown version byte', () => {
    const bytes = serializeBinary(minimalFixture);
    const mutated = new Uint8Array(bytes);
    mutated[0] = 0x02;
    expect(() => deserializeBinary(mutated)).toThrow(UnsupportedShareVersionError);
  });

  test('emits correct version byte', () => {
    const bytes = serializeBinary(minimalFixture);
    expect(bytes[0]).toBe(SHARE_FORMAT_VERSION);
  });
});

describe('share-format corruption handling', () => {
  test('truncated payload throws RangeError', () => {
    const bytes = serializeBinary(kitchenSinkFixture);
    const truncated = bytes.slice(0, Math.floor(bytes.byteLength / 2));
    expect(() => deserializeBinary(truncated)).toThrow(RangeError);
  });
});
