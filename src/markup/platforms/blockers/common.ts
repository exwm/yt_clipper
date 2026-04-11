export function hideElements(...selectors: string[]) {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.style.display = 'none';
  }
}

export function showElements(...selectors: string[]) {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.style.removeProperty('display');
  }
}

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
  if (e.ctrlKey || e.shiftKey || e.altKey) {
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
  if (e.code === 'Space' && e.target == document.body && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
  }
}
