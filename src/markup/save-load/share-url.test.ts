/** @jest-environment jsdom */

// Stub the modules `share-url.ts` reaches into so the entry-point can run
// in jsdom without the full markup runtime. We only test the pre-decompress
// length cap here — no real markers data flows through.

jest.mock('../appState', () => ({
  appState: { markerPairs: [] },
  __version__: 'test',
}));

const flashMessageMock = jest.fn();
jest.mock('../util/util', () => ({
  copyToClipboard: jest.fn(),
  flashMessage: (...args: unknown[]) => flashMessageMock(...args),
}));

jest.mock('./save-load', () => ({
  applyClipperInput: jest.fn(),
  isVariableSpeed: () => false,
}));

jest.mock('../crop-utils', () => ({
  isStaticCrop: () => true,
}));

jest.mock('./load-markers-review', () => ({
  showLoadMarkersReviewModal: jest.fn(),
}));

import { __testing, tryLoadSharedMarkers } from './share-url';

describe('share-url: pre-decompression base64 length cap', () => {
  beforeEach(() => {
    flashMessageMock.mockClear();
    window.history.replaceState(null, '', '/');
    // The oversize-rejection and inflate-failure paths log via console.error by design. Silence it so
    // the expected-error output doesn't read as a test failure in the run log.
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the cap constant is set to 1 MB', () => {
    // Sanity check the value matches what the docs claim — if this is
    // ever raised, the security review document needs to be re-checked
    // for the new DoS implications.
    expect(__testing.MAX_BASE64_FRAGMENT_LEN).toBe(1024 * 1024);
  });

  test('the cap allows the full decompression budget through', () => {
    // Any legitimate payload that decompresses within the 256 KB output
    // cap must also fit in the base64 fragment cap. Even uncompressed
    // payloads base64-inflated (4/3 ratio) would land at ~341 KB, well
    // under the 1 MB cap.
    expect(__testing.MAX_BASE64_FRAGMENT_LEN).toBeGreaterThanOrEqual(
      __testing.MAX_DECOMPRESSED_BYTES * 4
    );
  });

  test('rejects oversized base64 fragment before decoding', async () => {
    // Construct a URL hash with a base64 fragment one byte over the cap.
    // The regex `[A-Za-z0-9_-]+` would match the whole thing; the cap
    // check fires before base64UrlDecode runs.
    const oversized = 'A'.repeat(__testing.MAX_BASE64_FRAGMENT_LEN + 1);
    window.location.hash = `#ytc/markers/2026-01-01/00-00-00/${oversized}`;

    await tryLoadSharedMarkers();

    expect(flashMessageMock).toHaveBeenCalledWith(expect.stringContaining('too large'), 'red');
    // The fragment should also be stripped from the URL so reloading
    // doesn't re-trigger the same rejection.
    expect(window.location.hash).not.toContain('ytc/markers');
  });

  test('accepts a fragment just below the cap (no oversize trigger)', async () => {
    // Below the length cap — the cap check passes, then base64 decode is
    // attempted. Since the bytes aren't a valid deflate stream the path
    // fails further downstream, but NOT via the oversize message.
    const justBelow = 'A'.repeat(__testing.MAX_BASE64_FRAGMENT_LEN - 4);
    window.location.hash = `#ytc/markers/2026-01-01/00-00-00/${justBelow}`;

    await tryLoadSharedMarkers();

    // Should NOT have flashed an oversize rejection.
    const oversizeCalls = flashMessageMock.mock.calls.filter((call) =>
      typeof call[0] === 'string' ? call[0].includes('too large') : false
    );
    expect(oversizeCalls).toHaveLength(0);
  });
});
