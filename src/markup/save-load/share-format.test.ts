import { presetsMap } from '../features/settings/presets';
import {
  ByteReader,
  ByteWriter,
  DENOISE_PRESET_ORDER,
  SHARE_FORMAT_VERSION,
  UnsupportedShareVersionError,
  VSTAB_PRESET_ORDER,
  deserializeBinary,
  serializeBinary,
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
  test('minimal fixture is under 32 B', () => {
    const bytes = serializeBinary(minimalFixture);
    expect(bytes.byteLength).toBeLessThan(32);
  });

  test('kitchenSink fixture is under 72 B', () => {
    const bytes = serializeBinary(kitchenSinkFixture);
    expect(bytes.byteLength).toBeLessThan(72);
  });

  test('50-pair static fixture is under 475 B', () => {
    const bytes = serializeBinary(manyPairsFixture);
    expect(bytes.byteLength).toBeLessThan(475);
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
