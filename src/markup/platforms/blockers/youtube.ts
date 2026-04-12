import { hideElements, showElements } from './common';

const hiddenOnActivation = ['.ytp-overlays-container'];

export function enableYTBlockers() {
  enablePreventSideBarPull();
  enablePreventAltDefault();
  hideElements(...hiddenOnActivation);
}
export function disableYTBlockers() {
  disablePreventSideBarPull();
  disablePreventAltDefault();
  showElements(...hiddenOnActivation);
}

function enablePreventAltDefault() {
  window.addEventListener('keyup', preventAltDefaultHandler, true);
}

function disablePreventAltDefault() {
  window.removeEventListener('keyup', preventAltDefaultHandler, true);
}

function enablePreventSideBarPull() {
  const sideBar = document.getElementById('contentContainer');
  const sideBarContent = document.getElementById('guide-content');
  if (sideBarContent) sideBarContent.style.pointerEvents = 'auto';
  if (sideBar != null) sideBar.style.pointerEvents = 'none';
}
function disablePreventSideBarPull() {
  const sideBar = document.getElementById('contentContainer');
  if (sideBar != null) sideBar.style.removeProperty('pointer-events');
}

function preventAltDefaultHandler(e: KeyboardEvent) {
  if (e.code === 'AltLeft' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
  }
}
