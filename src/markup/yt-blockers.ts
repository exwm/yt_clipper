export function enablePreventAltDefault() {
  window.addEventListener('keyup', preventAltDefaultHandler, true);
}

export function disablePreventAltDefault() {
  window.removeEventListener('keyup', preventAltDefaultHandler, true);
}

export function enablePreventSideBarPull() {
  const sideBar = document.getElementById('contentContainer');
  const sideBarContent = document.getElementById('guide-content');
  sideBarContent.style.pointerEvents = 'auto';
  if (sideBar != null) sideBar.style.pointerEvents = 'none';
}
export function disablePreventSideBarPull() {
  const sideBar = document.getElementById('contentContainer');
  if (sideBar != null) sideBar.style.removeProperty('pointer-events');
}

export function preventAltDefaultHandler(e: KeyboardEvent) {
  if (e.code === 'AltLeft' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault();
  }
}

export function enablePreventMouseZoom() {
  window.addEventListener('mousewheel', stopWheelZoom, { passive: false });
  window.addEventListener('DOMMouseScroll', stopWheelZoom, { passive: false });
}

export function disablePreventMouseZoom() {
  window.removeEventListener('mousewheel', stopWheelZoom);
  window.removeEventListener('DOMMouseScroll', stopWheelZoom);
}

export function stopWheelZoom(e: MouseEvent) {
  if (e.ctrlKey) {
    e.preventDefault();
  }
}
