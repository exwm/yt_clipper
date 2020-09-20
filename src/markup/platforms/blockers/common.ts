export function enableCommonBlockers() {
  enablePreventMouseZoom();
  enablePreventSpaceScroll();
}
export function disableCommonBlockers() {
  disablePreventMouseZoom();
  disablePreventSpaceScroll();
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
  if (e.ctrlKey || e.shiftKey) {
    e.preventDefault();
  }
}

function enablePreventSpaceScroll() {
  window.addEventListener('keydown', preventSpaceScrollHandler);
}
function disablePreventSpaceScroll() {
  window.removeEventListener('keydown', preventSpaceScrollHandler);
}
function preventSpaceScrollHandler(e: KeyboardEvent) {
  if (e.code === 'Space' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
  }
}
