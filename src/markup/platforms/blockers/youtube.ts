export function enableYTBlockers() {
  enablePreventSideBarPull();
  enablePreventAltDefault();
}
export function disableYTBlockers() {
  disablePreventSideBarPull();
  disablePreventAltDefault();
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
  sideBarContent.style.pointerEvents = 'auto';
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
