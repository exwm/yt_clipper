export function enableYTBlockers() {
  enablePreventSideBarPull();
  enablePreventAltDefault();
  enablePreventMouseZoom();
}
export function disableYTBlockers() {
  disablePreventSideBarPull();
  disablePreventAltDefault();
  disablePreventMouseZoom();
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

function enablePreventMouseZoom() {
  window.addEventListener('mousewheel', stopWheelZoom, { passive: false });
  window.addEventListener('DOMMouseScroll', stopWheelZoom, { passive: false });
}

function disablePreventMouseZoom() {
  window.removeEventListener('mousewheel', stopWheelZoom);
  window.removeEventListener('DOMMouseScroll', stopWheelZoom);
}

function stopWheelZoom(e: MouseEvent) {
  if (e.ctrlKey) {
    e.preventDefault();
  }
}
