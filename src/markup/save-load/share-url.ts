import { MarkerPair } from '../@types/yt_clipper';
import { __version__, appState } from '../appState';
import { isStaticCrop } from '../crop-utils';
import { copyToClipboard, flashMessage } from '../util/util';
import { showLoadMarkersReviewModal } from './load-markers-review';
import { applyClipperInput, isVariableSpeed } from './save-load';
import { ClipperInputValidationError, parseClipperInput, ParseResult } from './parse-clipper-input';
import {
  SHARE_FORMAT_VERSION,
  ShareFormatLimitError,
  ShareablePair,
  ShareableSettings,
  SharePayload,
  UnsupportedShareVersionError,
  deserializeBinary,
  serializeBinary,
} from './share-format';

const SHARE_FRAGMENT_RE = /#ytc\/markers\/([^/]+)\/([^/]+)\/([A-Za-z0-9_-]+)/;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

const MAX_DECOMPRESSED_BYTES = 256 * 1024;

/** Hard cap on the base64 fragment length before we even attempt to decode
 *  it. Chosen at ~4× the bound implied by `MAX_DECOMPRESSED_BYTES` so any
 *  legitimately-encoded payload that decompresses within the cap easily
 *  fits, while a maliciously-large fragment is refused before it can
 *  consume CPU/memory on base64 + decompression. */
const MAX_BASE64_FRAGMENT_LEN = 1024 * 1024;

export class DecompressionTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`share-format: decompressed payload exceeded ${limit} bytes`);
    this.name = 'DecompressionTooLargeError';
  }
}

async function decompressBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // best-effort cancel; ignore
        }
        throw new DecompressionTooLargeError(MAX_DECOMPRESSED_BYTES);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function buildSharePayload(): SharePayload {
  const s = appState.settings;
  const settings: ShareableSettings = {};
  if (s.cropResWidth != null && s.cropResHeight != null) {
    settings.cropResWidth = s.cropResWidth;
    settings.cropResHeight = s.cropResHeight;
  }
  if (s.titleSuffix) settings.titleSuffix = s.titleSuffix;
  if (s.newMarkerSpeed != null && s.newMarkerSpeed !== 1) {
    settings.newMarkerSpeed = s.newMarkerSpeed;
  }
  if (s.newMarkerCrop) settings.newMarkerCrop = s.newMarkerCrop;
  if (s.markerPairMergeList) settings.markerPairMergeList = s.markerPairMergeList;

  const markerPairs: ShareablePair[] = appState.markerPairs.map((pair: MarkerPair) => {
    const out: ShareablePair = {
      start: pair.start,
      end: pair.end,
      speed: typeof pair.speed === 'string' ? Number(pair.speed) : pair.speed,
      crop: pair.crop,
    };
    if (pair.enableZoomPan) out.enableZoomPan = true;
    if (isVariableSpeed(pair.speedMap)) out.speedMap = pair.speedMap;
    if (!isStaticCrop(pair.cropMap)) out.cropMap = pair.cropMap;
    if (pair.overrides && Object.keys(pair.overrides).length > 0) {
      out.overrides = pair.overrides;
    }
    return out;
  });

  return { settings, markerPairs };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// UTC so the share URL doesn't leak the author's local timezone offset.
function buildUtcDate(): { date: string; time: string } {
  const d = new Date();
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}-${pad2(d.getUTCSeconds())}`;
  return { date, time };
}

export async function copyShareableUrl() {
  try {
    const payload = buildSharePayload();
    const bytes = serializeBinary(payload);
    const compressed = await compressBytes(bytes);
    const encoded = base64UrlEncode(compressed);
    const { date, time } = buildUtcDate();

    const baseUrl = location.href.split('#')[0];
    const shareUrl = `${baseUrl}#ytc/markers/${date}/${time}/${encoded}`;

    if (shareUrl.length > 6000) {
      flashMessage(
        `Shareable URL is ${shareUrl.length} chars — may not work in all platforms. Consider exporting JSON instead.`,
        'olive'
      );
    }

    copyToClipboard(shareUrl);
    flashMessage(`Copied shareable URL (${shareUrl.length} chars) to clipboard.`, 'green');
  } catch (err) {
    console.error('Failed to build shareable URL', err);
    flashMessage('Failed to build shareable URL. See console.', 'red');
  }
}

function readSharedMarkersFromUrl(): string | null {
  const hash = location.hash;
  if (!hash) return null;
  const match = SHARE_FRAGMENT_RE.exec(hash);
  return match ? match[3] : null;
}

function stripSharedMarkersFromUrl() {
  const hash = location.hash;
  if (!hash) return;
  const cleaned = hash.replace(SHARE_FRAGMENT_RE, '');
  const suffix = cleaned && cleaned !== '#' ? cleaned : '';
  history.replaceState(null, '', location.pathname + location.search + suffix);
}

function payloadToClipperInputObject(p: SharePayload) {
  const markerPairs = p.markerPairs.map((pair, idx) => ({
    number: idx + 1,
    start: pair.start,
    end: pair.end,
    speed: pair.speed,
    crop: pair.crop,
    enableZoomPan: pair.enableZoomPan ?? false,
    speedMap: pair.speedMap ?? undefined,
    cropMap: pair.cropMap ?? undefined,
    overrides: pair.overrides ?? {},
  }));
  return {
    ...p.settings,
    version: __version__,
    markerPairs,
  };
}

export async function tryLoadSharedMarkers() {
  const encoded = readSharedMarkersFromUrl();
  if (!encoded) return;

  if (appState.markerPairs.length > 0) {
    flashMessage(
      'Shared markers detected in URL but existing markers present — clear them first to load.',
      'olive'
    );
    return;
  }

  // Refuse oversized fragments before paying the base64 + decompression
  // cost. The downstream `MAX_DECOMPRESSED_BYTES` cap (256 KB) is enforced
  // per chunk during inflate, but reaching it requires walking the entire
  // base64 string + spinning up a DecompressionStream. This pre-check
  // shortcuts that work on a maliciously-large URL fragment.
  if (encoded.length > MAX_BASE64_FRAGMENT_LEN) {
    console.error(
      'Shared URL payload base64 length',
      encoded.length,
      'exceeds limit',
      MAX_BASE64_FRAGMENT_LEN
    );
    flashMessage('Shared URL payload is too large — refusing to decode.', 'red');
    stripSharedMarkersFromUrl();
    return;
  }

  let compressed: Uint8Array;
  try {
    compressed = base64UrlDecode(encoded);
  } catch (err) {
    console.error('Shared URL payload base64 decode failed', err);
    flashMessage('Shared URL payload is corrupt (base64 decode failed).', 'red');
    stripSharedMarkersFromUrl();
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await decompressBytes(compressed);
  } catch (err) {
    if (err instanceof DecompressionTooLargeError) {
      console.error('Shared URL payload exceeds size limit', err);
      flashMessage('Shared URL payload is too large — refusing to decompress.', 'red');
      stripSharedMarkersFromUrl();
      return;
    }
    console.error('Shared URL payload inflate failed', err);
    flashMessage('Shared URL payload is corrupt (inflate failed).', 'red');
    stripSharedMarkersFromUrl();
    return;
  }

  let payload: SharePayload;
  try {
    payload = deserializeBinary(bytes);
  } catch (err) {
    if (err instanceof UnsupportedShareVersionError) {
      console.error('Unsupported share format version', err);
      flashMessage(
        `Shared URL uses format v${err.version}. Upgrade the userscript to load it.`,
        'red'
      );
      return;
    }
    if (err instanceof ShareFormatLimitError) {
      console.error('Shared URL payload exceeds structural limits', err);
      flashMessage('Shared URL payload claims too many items — refusing to load.', 'red');
      stripSharedMarkersFromUrl();
      return;
    }
    if (err instanceof RangeError) {
      console.error('Shared URL binary decode overran buffer', err);
      flashMessage('Shared URL payload is corrupt (truncated).', 'red');
      stripSharedMarkersFromUrl();
      return;
    }
    console.error('Shared URL binary decode failed', err);
    flashMessage('Shared URL payload is corrupt.', 'red');
    stripSharedMarkersFromUrl();
    return;
  }

  let clipperInput: ReturnType<typeof payloadToClipperInputObject>;
  try {
    clipperInput = payloadToClipperInputObject(payload);
  } catch (err) {
    console.error('Failed to format shared markers JSON', err);
    flashMessage('Failed to format shared markers. See console.', 'red');
    return;
  }

  showSharedMarkersModal(clipperInput);
}

function showSharedMarkersModal(clipperInput: ReturnType<typeof payloadToClipperInputObject>) {
  let result: ParseResult;
  try {
    result = parseClipperInput(clipperInput);
  } catch (err) {
    if (err instanceof ClipperInputValidationError) {
      console.error('Shared URL payload failed validation', err);
      flashMessage(`Shared URL payload rejected: ${err.message}`, 'red');
      stripSharedMarkersFromUrl();
      return;
    }
    throw err;
  }

  const pairCount = result.input.markerPairs.length;

  showLoadMarkersReviewModal({
    modalTitle: 'Load shared markers?',
    warning: `⚠ Review the JSON below before loading. Shared URLs come from untrusted sources.\nLoading will overwrite your current settings and add ${pairCount} marker pair(s).`,
    sourceLabel: 'shared URL',
    payload: result.input,
    issues: result.issues,
    onLoad: () => {
      applyClipperInput(result.input);
      flashMessage(`Loaded ${pairCount} marker pair(s) from shared URL.`, 'green');
      stripSharedMarkersFromUrl();
    },
    onDismiss: () => {
      stripSharedMarkersFromUrl();
      flashMessage('Dismissed shared markers URL.', 'olive');
    },
  });
}

export const __testing = {
  SHARE_FORMAT_VERSION,
  SHARE_FRAGMENT_RE,
  MAX_BASE64_FRAGMENT_LEN,
  MAX_DECOMPRESSED_BYTES,
};
