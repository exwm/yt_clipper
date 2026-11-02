import type { VideoElement } from '../../appState';
import { featureFlags } from '../../feature-flags';
import { VideoPlatforms } from '../../platforms/platforms';

// The player's current-time readout. The players redraw its text on every update, so the
// milliseconds are an element of their own placed after it.
const READOUT_SELECTORS: Partial<Record<VideoPlatforms, string>> = {
  [VideoPlatforms.youtube]: '.ytp-time-current',
  [VideoPlatforms.yt_clipper]: '.vjs-current-time-display',
};

/** `.456` for 12.456 s: the milliseconds a readout in whole seconds leaves out. */
export function millisecondsOf(seconds: number): string {
  // Rounded to the microsecond first, so 1.001 s doesn't read as 1.000 from float error.
  const milliseconds = Math.floor(Math.round(seconds * 1e6) / 1e3) % 1000;
  return `.${String(milliseconds).padStart(3, '0')}`;
}

/** Whether a readout's text is the remaining time (`-10:05`), which YouTube shows in the same
 *  element after a click on the time. */
export function isRemainingTime(readoutText: string): boolean {
  return readoutText.trim().startsWith('-');
}

/** Shows the playhead's milliseconds after the player's current-time readout. */
export function installMillisecondsReadout(
  video: VideoElement,
  platform: VideoPlatforms,
  playerContainer: HTMLElement
): void {
  const selector = READOUT_SELECTORS[platform];
  if (!selector) return;
  const milliseconds = document.createElement('span');
  milliseconds.className = 'ytc-time-ms';
  // A change of the readout's text with no video event (toggling to the remaining time while paused).
  const readoutObserver = new MutationObserver(() => update());
  let observedReadout: Element | null = null;
  const update = () => {
    const readout = playerContainer.querySelector(selector);
    if (!featureFlags.millisecondsInTimeReadout || !readout) {
      milliseconds.remove();
      readoutObserver.disconnect();
      observedReadout = null;
      return;
    }
    // The player can rebuild its controls (a new video, an ad), which drops the element.
    if (milliseconds.previousElementSibling !== readout) {
      readout.insertAdjacentElement('afterend', milliseconds);
    }
    if (observedReadout !== readout) {
      readoutObserver.disconnect();
      readoutObserver.observe(readout, { childList: true, characterData: true, subtree: true });
      observedReadout = readout;
    }
    milliseconds.textContent = isRemainingTime(readout.textContent ?? '')
      ? ''
      : // eslint-disable-next-line no-restricted-syntax -- the playhead, as the player's own readout shows it
        millisecondsOf(video.getCurrentTime());
  };
  for (const type of ['timeupdate', 'seeked', 'pause', 'loadedmetadata']) {
    video.addEventListener(type, update);
  }
  update();
}
