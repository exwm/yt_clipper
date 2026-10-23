import { html, render, TemplateResult } from 'lit-html';
import { renderToggleIcon } from '../../features/icons/glyphs';
import { assertDefined } from '../../util/util';

const POPOVER_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

let closeOpenPopover: (() => void) | null = null;

// A popover's controls write to the editor that opened it, so it closes with that editor
// (switching editors, deleting its marker pair).
export function closeSettingsGearPopovers(): void {
  closeOpenPopover?.();
}

// Below the gear, or above it when there is no room below (the editors sit low on the page).
function placePopover(popover: HTMLElement, button: HTMLElement): void {
  const anchor = button.getBoundingClientRect();
  const below = anchor.bottom + POPOVER_GAP_PX;
  const fitsBelow = below + popover.offsetHeight <= window.innerHeight - VIEWPORT_MARGIN_PX;
  const top = fitsBelow ? below : anchor.top - POPOVER_GAP_PX - popover.offsetHeight;
  const left = Math.min(anchor.left, window.innerWidth - VIEWPORT_MARGIN_PX - popover.offsetWidth);
  popover.style.top = `${Math.max(VIEWPORT_MARGIN_PX, top)}px`;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN_PX, left)}px`;
}

// No backdrop, so the video and the preview stay visible while the settings change them.
function toggleSettingsGearPopover(
  button: HTMLElement,
  id: string,
  title: string,
  content: TemplateResult
): void {
  const wasOpen = document.getElementById(id) != null;
  closeSettingsGearPopovers();
  if (wasOpen) return;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const popoverTemplate = html`<div
    id=${id}
    class="ytc-settings-popover"
    role="dialog"
    aria-label=${title}
  >
    <div class="ytc-settings-popover-title">${title}</div>
    ${content}
  </div>`;
  render(popoverTemplate, host);
  const popover = host.querySelector<HTMLElement>('.ytc-settings-popover');
  assertDefined(popover);

  // A gear that left the page or was hidden (its settings collapsed) has no box to anchor to.
  const reposition = (): void => {
    if (button.isConnected && button.getClientRects().length > 0) placePopover(popover, button);
    else close();
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  };
  // The gear's own click toggles the popover, so a press on it is not an outside press.
  const onPointerdown = (e: PointerEvent): void => {
    const target = e.target as Node;
    if (!popover.contains(target) && !button.contains(target)) close();
  };
  // Its content can grow while open (a taller plot), which must not push it off the page.
  const resizeObserver = new ResizeObserver(reposition);
  const close = (): void => {
    closeOpenPopover = null;
    resizeObserver.disconnect();
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('pointerdown', onPointerdown, true);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    // Blur first: a focused input gates the hotkeys until it blurs, and removing it does not blur
    // it in every browser.
    if (popover.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    host.remove();
  };

  closeOpenPopover = close;
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerdown, true);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  reposition();
  resizeObserver.observe(popover);
}

export interface SettingsGearButtonProps {
  // Unique per gear button: the popover's id, and the button's with a `-button` suffix.
  id: string;
  // Popover title and button tooltip.
  title: string;
  // Builds the popover's settings controls on each open, so they show the current values. The
  // caller owns their bind wiring.
  content: () => TemplateResult;
}

// A gear button that opens a popover with a widget's secondary settings, so they don't take up row
// space inline.
export function SettingsGearButton(p: SettingsGearButtonProps): TemplateResult {
  return html`
    <button
      type="button"
      id=${`${p.id}-button`}
      class="settings-toggle settings-gear-button"
      title=${p.title}
      @click=${(e: MouseEvent) =>
        toggleSettingsGearPopover(e.currentTarget as HTMLElement, p.id, p.title, p.content())}
    >
      ${renderToggleIcon('overrides', 12)}
    </button>
  `;
}
