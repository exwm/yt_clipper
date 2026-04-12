import { appState } from './appState';
import { resolvePlayerAndVideo } from './bootstrap';
import { disableCommonBlockers, enableCommonBlockers } from './platforms/blockers/common';
import { disableYTBlockers, enableYTBlockers } from './platforms/blockers/youtube';
import { isStaleVideo, setIsStaleVideo, PlatformNavObserver } from './platforms/navigation';
import { videoPlatformDataRecords, VideoPlatforms } from './platforms/platforms';
import { platform, initOnceCalled } from './yt_clipper';
import { getCurrentPageVideoID } from './platforms/navigation';
import { htmlToElement } from './util/util';

export let navObserver: PlatformNavObserver | null = null;
export function startNavigationWatcher() {
  if (navObserver) return;
  navObserver = videoPlatformDataRecords[platform].createNavObserver();
  navObserver.start(() => {
    void handleNavigation();
  });
}
export async function handleNavigation() {
  if (!initOnceCalled) {
    if (navResolveInFlight) return;
    navResolveInFlight = true;
    appState.isReady = false;
    try {
      await resolvePlayerAndVideo();
      appState.isReady = true;
    } catch (e) {
      console.error('yt_clipper: failed to re-resolve player/video after navigation', e);
    } finally {
      navResolveInFlight = false;
    }
    return;
  }

  const loadedVideoID = appState.settings?.videoID ?? null;
  const currentPageVideoID = getCurrentPageVideoID();

  if (isStaleVideo) {
    if (
      loadedVideoID != null &&
      currentPageVideoID != null &&
      currentPageVideoID === loadedVideoID
    ) {
      clearStaleVideoState();
    }
    return;
  }

  if (loadedVideoID != null && currentPageVideoID != null && currentPageVideoID === loadedVideoID) {
    return;
  }

  setIsStaleVideo(true);
  disableCommonBlockers();
  if (platform === VideoPlatforms.youtube) {
    disableYTBlockers();
  }
  showStaleVideoBanner();
}
export let navResolveInFlight = false;
export function clearStaleVideoState() {
  setIsStaleVideo(false);
  hideStaleVideoBanner();
  if (appState.isHotkeysEnabled) {
    enableCommonBlockers();
    if (platform === VideoPlatforms.youtube) {
      enableYTBlockers();
    }
  }
}
export function showStaleVideoBanner() {
  if (staleVideoBannerEl) return;
  const loadedVideoID = appState.settings?.videoID ?? 'unknown';
  staleVideoBannerEl = htmlToElement(`
    <div id="ytc-stale-video-banner">
      <span class="ytc-stale-banner-icon">!</span>
      <div class="ytc-stale-banner-text">
        <strong>Video changed</strong>
        <span>yt_clipper was loaded from appState.video with id <code class="ytc-stale-banner-videoid">${loadedVideoID}</code> and may behave unexpectedly on other videos. Navigate back to resume, or refresh the page to reload yt_clipper.</span>
      </div>
    </div>
  `) as HTMLDivElement;

  appState.hooks.flashMessage.insertAdjacentElement('afterbegin', staleVideoBannerEl);
}
export function hideStaleVideoBanner() {
  if (staleVideoBannerEl) {
    staleVideoBannerEl.remove();
    staleVideoBannerEl = null;
  }
}
export let staleVideoBannerEl: HTMLDivElement | null = null;
