import { appState, YTPlayer } from '../appState';
import { getPlatform, VideoPlatforms } from '../platforms/platforms';
import { frameTiming } from './frame-timing';
import { getMeasuredFrameRate } from './presented-frame-clock';

/** The frame rates a frame decision can take. Each decision accepts the ones its group reads. */
export interface Rates {
  // 5.48's rate: the platform's, else the default.
  legacy: number;
  // YouTube's stats rate for the rendition playing; null on other sites or while the stats fail.
  platform: number | null;
  // The rate measured from played frames, read only with measurement on. Confirmed where it agrees
  // with the platform's rate to 0.5 %, which only refines it (the stats show 29.97 fps as 30).
  measured: { rate: number; confirmed: boolean } | null;
}

export type FrameRateSource = 'measured' | 'platform' | 'default';

/** The frame rate in use and where it comes from: a confirmed measured rate, else the platform's,
 *  else the default. */
export function rateInUse(rates: Rates): { rate: number; source: FrameRateSource } {
  if (rates.measured?.confirmed) return { rate: rates.measured.rate, source: 'measured' };
  if (rates.platform != null) return { rate: rates.platform, source: 'platform' };
  return { rate: rates.legacy, source: 'default' };
}

// Whether the rate measured from played frames is read, saved in this browser. Off until turned
// on: the measurement doesn't yet handle every video. Read on first use; storage that is blocked or
// full keeps the setting for this page only. 5.48's frame timing has no measurement, so the setting
// saved is ignored there, and the Measure button and command that toggle it are hidden.
const MEASURE_FRAME_RATE_KEY = 'ytc-measure-frame-rate';
let measureFrameRate: boolean | null = null;
export function isFrameRateMeasured(): boolean {
  return frameTiming.usesMeasuredRate(isMeasureFrameRateOn);
}

function isMeasureFrameRateOn(): boolean {
  if (measureFrameRate == null) {
    try {
      measureFrameRate = localStorage.getItem(MEASURE_FRAME_RATE_KEY) === 'true';
    } catch {
      measureFrameRate = false;
    }
  }
  return measureFrameRate;
}

/** Turns the measurement on or off, and saves the setting. */
export function setFrameRateMeasurement(isOn: boolean): void {
  measureFrameRate = isOn;
  try {
    localStorage.setItem(MEASURE_FRAME_RATE_KEY, String(isOn));
  } catch {
    // Blocked or full storage: the setting holds for this page only.
  }
}

let prevVideoWidth: number;
// YouTube's stats rate for the rendition playing, read once per rendition (width), and per source
// as the frame timing decides.
let youTubeStatsFps: number | null = null;
let isNewSourceLoaded = true;

/** Notes a new source on the video (`emptied`): YouTube reuses the element on navigation, and the
 *  new video has its own stats rate. */
export function noteNewSource(): void {
  youTubeStatsFps = frameTiming.rateCacheAtNewSource(youTubeStatsFps);
  isNewSourceLoaded = false;
}

/** Notes the new source's metadata loaded (`loadedmetadata`). */
export function noteSourceLoaded(): void {
  isNewSourceLoaded = true;
}

/** The video's frame rates now. The platform's is read first, which keeps YouTube's stats rate for
 *  the rendition. */
export function readFrameRates(defaultFPS = 60): Rates {
  let platform: number | null = null;
  let measured: Rates['measured'] = null;
  try {
    const isYouTube = getPlatform() === VideoPlatforms.youtube;
    if (isYouTube) {
      const { rate, cached } = frameTiming.platformRate({
        cached: youTubeStatsFps,
        widthChanged: prevVideoWidth !== appState.video.videoWidth,
        isNewSourceLoaded,
        readStats: () =>
          parseFloat(
            /@(\d+)/.exec((appState.player as YTPlayer).getStatsForNerds().resolution)?.[1] ?? '60'
          ),
      });
      youTubeStatsFps = cached;
      platform = rate;
    }
    const rate = isFrameRateMeasured() ? getMeasuredFrameRate(appState.video) : null;
    if (rate != null) {
      const confirmed = platform == null || Math.abs(rate - platform) <= platform * 0.005;
      measured = { rate, confirmed };
    }
  } catch (e) {
    console.log('Could not detect fps', e);
  }
  prevVideoWidth = appState.video.videoWidth;
  return { legacy: platform ?? defaultFPS, platform, measured };
}
