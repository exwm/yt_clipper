export interface PlatformNavObserver {
  start(onNavigate: () => void): void;
  stop(): void;
}

export function createYouTubeNavObserver(): PlatformNavObserver {
  let handler: EventListener | null = null;
  return {
    start(onNavigate) {
      handler = () => onNavigate();
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
    const ret = origPushState.apply(this, args as Parameters<typeof origPushState>);
    dispatchIfChanged();
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = origReplaceState.apply(this, args as Parameters<typeof origReplaceState>);
    dispatchIfChanged();
    return ret;
  };
}
