import { deflateRawSync } from 'zlib';
import { CropPoint } from '../@types/yt_clipper';
import { serializeBinary, SharePayload } from './share-format';
import {
  boundaryFixture,
  emptyFixture,
  kitchenSinkFixture,
  manyPairsFixture,
  minimalFixture,
  unicodeTitleFixture,
  variableCropFixture,
  variableSpeedFixture,
  zoomPanFixture,
} from './share-format.fixtures';

// Dense slow-pan cropMap path: 30 points, each moving ~8 px. Represents the
// realistic best case for delta encoding (many small-magnitude deltas) and is
// the specific payload shape cropMap delta was designed to compress.
const densePanFixture: SharePayload = (() => {
  const cropMap: CropPoint[] = [];
  for (let i = 0; i < 30; i++) {
    cropMap.push({ x: i * 0.25, y: 0, crop: `${100 + i * 8}:${50 + i * 4}:960:540` });
  }
  return {
    settings: { cropResWidth: 1920, cropResHeight: 1080 },
    markerPairs: [{ start: 0, end: 10, speed: 1, crop: '100:50:960:540', cropMap }],
  };
})();

// Dense speed-ramp speedMap: 30 points sweeping 0.5x → 1.5x with small steps.
const denseSpeedFixture: SharePayload = (() => {
  const speedMap = [];
  for (let i = 0; i < 30; i++) {
    speedMap.push({ x: i * 0.25, y: 0.5 + (i / 29) * 1.0 });
  }
  return {
    settings: { cropResWidth: 1920, cropResHeight: 1080 },
    markerPairs: [{ start: 0, end: 10, speed: 1, crop: '0:0:iw:ih', speedMap }],
  };
})();

// Realistic "highlight reel" share: 20 clips cut from one session with a
// consistent look. Same crop, same overrides, small zoom-in cropMap per clip.
// This is the shape that justifies deflate — per-pair schema encoding can't
// dedupe repeated crop strings, repeated override masks, or near-identical
// cropMap point values across pairs, but deflate's LZ77 can.
const heavyEditFixture: SharePayload = (() => {
  const markerPairs = [];
  for (let i = 0; i < 20; i++) {
    const start = i * 15;
    const cropMap: CropPoint[] = [
      { x: start, y: 0, crop: '200:100:1280:720' },
      { x: start + 2, y: 0, crop: '220:110:1240:720' },
      { x: start + 5, y: 0, crop: '240:120:1200:720' },
    ];
    markerPairs.push({
      start,
      end: start + 5,
      speed: 1,
      crop: '200:100:1280:720',
      cropMap,
      overrides: { gamma: 1.2, encodeSpeed: 2, crf: 22 },
    });
  }
  return {
    settings: {
      cropResWidth: 1920,
      cropResHeight: 1080,
      titleSuffix: 'highlight-reel',
    },
    markerPairs,
  };
})();

interface Row {
  name: string;
  pairs: number;
  raw: number;
  deflated: number;
  base64url: number;
}

function base64UrlLen(bytes: Uint8Array): number {
  // btoa output length = 4 * ceil(n/3); strip '=' padding, URL-safe chars
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/=+$/, '').length;
}

function measure(name: string, p: SharePayload): Row {
  const raw = serializeBinary(p);
  const deflated = deflateRawSync(raw);
  return {
    name,
    pairs: p.markerPairs.length,
    raw: raw.byteLength,
    deflated: deflated.byteLength,
    base64url: base64UrlLen(new Uint8Array(deflated)),
  };
}

const fixtures: Array<[string, SharePayload]> = [
  ['empty', emptyFixture],
  ['minimal', minimalFixture],
  ['unicodeTitle', unicodeTitleFixture],
  ['boundary', boundaryFixture],
  ['zoomPan', zoomPanFixture],
  ['variableSpeed', variableSpeedFixture],
  ['variableCrop', variableCropFixture],
  ['kitchenSink', kitchenSinkFixture],
  ['manyPairs', manyPairsFixture],
  ['densePan', densePanFixture],
  ['denseSpeed', denseSpeedFixture],
  ['heavyEdit', heavyEditFixture],
];

describe('share-format size benchmark', () => {
  test('prints byte budgets per fixture', () => {
    const rows = fixtures.map(([n, f]) => measure(n, f));
    const pad = (s: string | number, w: number) => String(s).padStart(w, ' ');
    const lines = [
      `\n${pad('fixture', 16)} ${pad('pairs', 6)} ${pad('raw', 6)} ${pad('deflated', 9)} ${pad(
        'base64url',
        10
      )}`,
      '-'.repeat(52),
      ...rows.map(
        (r) =>
          `${pad(r.name, 16)} ${pad(r.pairs, 6)} ${pad(r.raw, 6)} ${pad(r.deflated, 9)} ${pad(
            r.base64url,
            10
          )}`
      ),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(rows.every((r) => r.raw > 0)).toBe(true);
  });

  // Regression guard: documents in code that deflate is load-bearing for
  // long-edit shares. If this ever flips, deflate has stopped earning its
  // keep and a conditional "skip when inflating" layer becomes a pure win.
  test('heavyEdit: deflate saves >60% vs raw', () => {
    const row = measure('heavyEdit', heavyEditFixture);
    expect(row.deflated).toBeLessThan(row.raw * 0.4);
    expect(row.raw).toBeGreaterThan(400);
  });
});
