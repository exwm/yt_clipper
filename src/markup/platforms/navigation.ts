import { appState } from '../appState';
import { getPlatform, VideoPlatforms } from './platforms';

export interface PlatformNavObserver {
  start(onNavigate: () => void): void;
  stop(): void;
}

export function createYouTubeNavObserver(): PlatformNavObserver {
  let handler: EventListener | null = null;
  return {
    start(onNavigate) {
      handler = () => {
        onNavigate();
      };
      document.addEventListener('yt-navigate-finish', handler);
    },
    stop() {
      if (handler) {
        document.removeEventListener('yt-navigate-finish', handler);
        handler = null;
      }
    },
  };
}

export function createHistoryApiNavObserver(): PlatformNavObserver {
  let userHandler: (() => void) | null = null;
  let eventHandler: EventListener | null = null;
  let popstateHandler: EventListener | null = null;

  return {
    start(onNavigate) {
      userHandler = onNavigate;
      installHistoryApiHook();
      eventHandler = () => userHandler?.();
      popstateHandler = () => userHandler?.();
      window.addEventListener(LOCATION_CHANGE_EVENT, eventHandler);
      window.addEventListener('popstate', popstateHandler);
    },
    stop() {
      if (eventHandler) window.removeEventListener(LOCATION_CHANGE_EVENT, eventHandler);
      if (popstateHandler) window.removeEventListener('popstate', popstateHandler);
      eventHandler = null;
      popstateHandler = null;
      userHandler = null;
    },
  };
}

export function createNoopNavObserver(): PlatformNavObserver {
  return {
    start() {},
    stop() {},
  };
}

const LOCATION_CHANGE_EVENT = 'ytc-locationchange';
let historyApiHookInstalled = false;

function installHistoryApiHook() {
  if (historyApiHookInstalled) return;
  historyApiHookInstalled = true;

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  let lastHref = location.href;

  const dispatchIfChanged = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
    }
  };

  history.pushState = function (...args) {
    const ret = origPushState.apply(this, args);
    dispatchIfChanged();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = origReplaceState.apply(this, args);
    dispatchIfChanged();
    return ret;
  };
}
export let isStaleVideo = false;
export function setIsStaleVideo(value: boolean) {
  isStaleVideo = value;
}
export function getCurrentPageVideoID(): string | null {
  const platform = getPlatform();
  try {
    if (platform === VideoPlatforms.youtube) {
      const data = (appState.player as any)?.getVideoData?.();
      return data?.video_id ?? null;
    } else if (platform === VideoPlatforms.vlive) {
      const preloadedState = (window as any).unsafeWindow?.__PRELOADED_STATE__;
      const videoParams = preloadedState?.postDetail?.post?.officialVideo;
      let id = videoParams?.videoSeq;
      if (id == null && location.pathname.includes('video')) {
        id = location.pathname.split('/')[2];
      }
      return id ?? null;
    } else if (platform === VideoPlatforms.naver_tv) {
      return location.pathname.split('/')[2] ?? null;
    } else if (platform === VideoPlatforms.weverse) {
      if (location.pathname.includes('media') || location.pathname.includes('live')) {
        return location.pathname.split('/')[3] ?? null;
      }
      return null;
    } else if (platform === VideoPlatforms.yt_clipper) {
      return 'unknown';
    } else if (platform === VideoPlatforms.afreecatv) {
      return location.pathname.split('/')[2] ?? null;
    }
  } catch (e) {
    console.error('yt_clipper: failed to read current page video id', e);
  }
  return null;
}
