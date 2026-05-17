import { readFileSync } from 'fs';
import { html, nothing, render, TemplateResult } from 'lit-html';
import { HintContext, ShortcutDefinition, ShortcutRegistry } from '../../../command-palette';
import { injectCSS } from '../../util/util';
import {
  renderArrowGlyph,
  renderModifierGlyph,
  renderMouseGlyph,
  renderUIIcon,
  type ArrowDir,
  type ModifierKey,
  type MouseToken,
} from '../icons/glyphs';
import {
  getCurrentHintContext,
  getCurrentHoverContexts,
  shouldApplyHoverLayer,
} from './hint-context';
import { freezeHover, unfreezeHover } from './hover-region';
import { startInputFocusTracker } from './input-focus';
import { getModifierState, startModifierTracker } from './modifier-tracker';

const hintsBarCSS = readFileSync(__dirname + '/hints-bar.css', 'utf8');

type HintsBarMode = 'pinned-bottom' | 'pinned-top';

const VALID_MODES: readonly HintsBarMode[] = ['pinned-bottom', 'pinned-top'];

interface HintsBarRuntimeState {
  visible: boolean;
  mode: HintsBarMode;
}

interface PersistedHintsBar {
  visible: boolean;
  mode?: HintsBarMode; // optional for backwards-compat with older persisted state
}

const STORAGE_KEY = 'yt_clipper:hintsBar';

let host: HTMLDivElement | null = null;
let shell: HTMLDivElement | null = null;
let state: HintsBarRuntimeState | null = null;
let activeRegistry: ShortcutRegistry | null = null;
let cssInjected = false;

function loadPersistedState(): HintsBarRuntimeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedHintsBar>;
      if (typeof parsed.visible === 'boolean') {
        // Older persisted state may have carried a `floating` mode plus
        // x/y coordinates; only `pinned-top` / `pinned-bottom` survive.
        // Anything else falls back to pinned-bottom.
        const mode: HintsBarMode =
          parsed.mode !== undefined && VALID_MODES.includes(parsed.mode)
            ? parsed.mode
            : 'pinned-bottom';
        return { visible: parsed.visible, mode };
      }
    }
  } catch {
    // ignore: fall through to default
  }
  return { visible: false, mode: 'pinned-bottom' };
}

function persistState(): void {
  if (!state) return;
  try {
    const payload: PersistedHintsBar = { visible: state.visible, mode: state.mode };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore: best-effort persistence
  }
}

/** Sets `data-pin` so the shell's CSS positions it at top or bottom of
 *  the viewport. The shell is always full-width-pinned now — no floating
 *  / drag / transform pipeline. */
function applyMode(): void {
  if (!shell || !state) return;
  shell.setAttribute('data-pin', state.mode === 'pinned-top' ? 'top' : 'bottom');
  updatePopoverDirection();
}

/** Picks popover direction based on whether the bar is pinned to the top
 *  half of the viewport — when at the top, the chord popovers flow
 *  downward so they don't clip; otherwise upward. */
function updatePopoverDirection(): void {
  if (!shell || !state) return;
  shell.setAttribute('data-popover-dir', state.mode === 'pinned-top' ? 'below' : 'above');
}

/** Flip the bar between pinned-top and pinned-bottom. The chevron button
 *  in the bar's leading edge invokes this. */
function flipPin(): void {
  if (!state || !shell) return;
  state.mode = state.mode === 'pinned-top' ? 'pinned-bottom' : 'pinned-top';
  applyMode();
  persistState();
  rerender();
}

/** Single resize handler — recomputes everything that depends on the
 *  viewport: scrollbar inset, current scroll offset, fade-overlay flags,
 *  and chord-popover flow direction. Wired up once in `mountHintsBar`. */
function onWindowResize(): void {
  updateViewportOffsets();
  applyScroll();
  updateScrollIndicators();
  updatePopoverDirection();
}

let lastRenderedContext: HintContext | null = null;
let lastRenderedHoverKey = '';

type ChipKind = 'always' | 'hover' | 'state' | null;

function classifyChip(
  def: ShortcutDefinition,
  primary: HintContext,
  hovers: HintContext[]
): ChipKind {
  const c = def.hintContexts;
  if (!c || c.length === 0) return null;
  // Modifier gate: if the chip declares a `whenModifiers` requirement and the
  // currently-held modifiers don't satisfy it, suppress entirely.
  if (def.whenModifiers && !modifiersSatisfy(def.whenModifiers)) return null;
  // `always` wins because those chips should appear in every context.
  if (c.includes('always')) return 'always';
  if (hovers.some((h) => c.includes(h))) return 'hover';
  if (c.includes(primary)) return 'state';
  return null;
}

function modifiersSatisfy(req: { ctrl?: boolean; shift?: boolean; alt?: boolean }): boolean {
  const held = getModifierState();
  if (req.ctrl !== undefined && req.ctrl !== held.ctrl) return false;
  if (req.shift !== undefined && req.shift !== held.shift) return false;
  if (req.alt !== undefined && req.alt !== held.alt) return false;
  return true;
}

/**
 * Returns the chips visible right now, applying the focus rule:
 *  - `always` chips are always shown.
 *  - If any hover-matching chip exists, `state` chips are SUPPRESSED so the
 *    user sees a narrow, focused set tied to where the cursor is.
 *  - Otherwise the broader state chips show as usual.
 */
function getVisibleShortcuts(primary: HintContext, hovers: HintContext[]): ShortcutDefinition[] {
  const reg = activeRegistry;
  if (!reg) return [];

  const candidates: { def: ShortcutDefinition; kind: ChipKind }[] = [];
  for (const def of reg.getAll()) {
    if (!def.hintLabel) continue;
    if (def.guard && !def.guard()) continue;
    const kind = classifyChip(def, primary, hovers);
    if (kind == null) continue;
    candidates.push({ def, kind });
  }

  const hasHoverFocus = candidates.some((c) => c.kind === 'hover');

  const visible = candidates
    .filter(
      (c) => c.kind === 'always' || c.kind === 'hover' || (!hasHoverFocus && c.kind === 'state')
    )
    .map((c) => c.def);

  return visible.sort((a, b) => {
    const ao = a.hintOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.hintOrder ?? Number.POSITIVE_INFINITY;
    return ao - bo;
  });
}

function resolveContexts(): { primary: HintContext; hovers: HintContext[] } {
  const primary = getCurrentHintContext();
  const hovers = shouldApplyHoverLayer(primary) ? getCurrentHoverContexts() : [];
  return { primary, hovers };
}

/**
 * Chord-string parser. Splits "Ctrl + Shift + Q" into modifiers and key
 * tokens, then dispatches to render helpers in `../icons/glyphs`. The icon
 * artwork lives there; this file handles the chord-grammar parsing
 * (modifier aliases, optional-modifier parens, alternative-key `/` notation).
 */

const MODIFIER_LOOKUP: Record<string, ModifierKey> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
};

/** Canonical render order for chord modifiers — applied regardless of the
 *  source `displayKey`'s ordering so chip pills read consistently. Ctrl
 *  comes first as the most common modifier; Meta last since it's rare
 *  enough to feel "extra". */
const MODIFIER_RENDER_ORDER: Record<ModifierKey, number> = {
  ctrl: 0,
  alt: 1,
  shift: 2,
  meta: 3,
};

function resolveModifier(part: string): ModifierKey | null {
  const key = part.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODIFIER_LOOKUP, key) ? MODIFIER_LOOKUP[key] : null;
}

const ARROW_DIR_LOOKUP: Record<string, ArrowDir> = {
  left: 'left',
  arrowleft: 'left',
  right: 'right',
  arrowright: 'right',
  up: 'up',
  arrowup: 'up',
  down: 'down',
  arrowdown: 'down',
};

function resolveArrow(part: string): ArrowDir | null {
  const key = part.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ARROW_DIR_LOOKUP, key) ? ARROW_DIR_LOOKUP[key] : null;
}

const MOUSE_TOKEN_LOOKUP: Record<string, MouseToken> = {
  click: 'click',
  'left-click': 'click',
  leftclick: 'click',
  'right-click': 'right-click',
  rightclick: 'right-click',
  mouseover: 'mouseover',
  hover: 'mouseover',
  mousehover: 'mouseover',
  drag: 'drag',
  mousewheel: 'mousewheel',
  wheel: 'mousewheel',
  scroll: 'mousewheel',
  // Wheel-click is a distinct gesture: clicking the wheel button (a.k.a.
  // middle-click), as opposed to rolling the wheel for scroll input.
  'middle-click': 'wheel-click',
  middleclick: 'wheel-click',
  'wheel-click': 'wheel-click',
  wheelclick: 'wheel-click',
  'mousewheel-click': 'wheel-click',
  mousewheelclick: 'wheel-click',
};

function resolveMouseToken(part: string): MouseToken | null {
  const key = part.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MOUSE_TOKEN_LOOKUP, key)
    ? MOUSE_TOKEN_LOOKUP[key]
    : null;
}

function renderKey(part: string): TemplateResult {
  const arrow = resolveArrow(part);
  if (arrow) return renderArrowGlyph(arrow);
  const mouse = resolveMouseToken(part);
  if (mouse) return renderMouseGlyph(mouse);
  // `X/Y` notation inside a single chord part — "this chord works with
  // either key X or Y" (e.g., `Shift + Q/A` for start/end). Split on `/`
  // and render the alternatives separated by a slash glyph, just like the
  // existing arrow-key separator.
  if (part.includes('/') && part.length > 1) {
    const subs = part
      .split('/')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (subs.length > 1) {
      return html`${subs.map(
        (s, i) =>
          html`${i > 0
            ? html`<span class="hints-bar-key-sep" aria-hidden="true">/</span>`
            : nothing}${renderKey(s)}`
      )}`;
    }
  }
  return html`<span class="hints-bar-key">${part}</span>`;
}

function renderChordContents(displayKey: string): TemplateResult | typeof nothing {
  if (!displayKey) return nothing;
  const parts = displayKey
    .split(/\s*\+\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return nothing;

  // A part wrapped in parens — e.g. `(Shift)` — is treated as an OPTIONAL
  // modifier. The chord renders it with literal parens around the glyph so
  // the user reads "this key is the same chord with or without (X)".
  // Useful for paired actions like undo / redo (Z / Shift+Z).
  const modifiers: { kind: ModifierKey; optional: boolean }[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const optional = part.startsWith('(') && part.endsWith(')');
    const cleanPart = optional ? part.slice(1, -1).trim() : part;
    const mod = resolveModifier(cleanPart);
    if (mod) modifiers.push({ kind: mod, optional });
    else keys.push(part);
  }
  // Normalize modifier order to `Ctrl + Alt + Shift + Meta` regardless of
  // the source displayKey's order — chord pills should read consistently
  // across the bar even if shortcut definitions write modifiers in
  // different orders.
  modifiers.sort((a, b) => MODIFIER_RENDER_ORDER[a.kind] - MODIFIER_RENDER_ORDER[b.kind]);

  const keyNodes: TemplateResult[] = [];
  keys.forEach((k, idx) => {
    if (idx > 0 && resolveArrow(k) && resolveArrow(keys[idx - 1])) {
      keyNodes.push(html`<span class="hints-bar-key-sep" aria-hidden="true">/</span>`);
    }
    keyNodes.push(renderKey(k));
  });

  return html`${modifiers.map((m) =>
    m.optional ? renderOptionalModifier(m.kind) : renderModifierGlyph(m.kind)
  )}
  ${keyNodes}`;
}

function renderOptionalModifier(mod: ModifierKey): TemplateResult {
  return html`<span class="hints-bar-mod-optional">
    <span class="hints-bar-paren" aria-hidden="true">(</span>
    ${renderModifierGlyph(mod)}
    <span class="hints-bar-paren" aria-hidden="true">)</span>
  </span>`;
}

function renderChord(displayKey: string): TemplateResult | typeof nothing {
  const contents = renderChordContents(displayKey);
  if (contents === nothing) return nothing;
  return html`<kbd class="hints-bar-chord">${contents}</kbd>`;
}

function isHoverChip(def: ShortcutDefinition): boolean {
  return def.hintContexts?.some((c) => c.startsWith('hover-')) ?? false;
}

function chipClasses(def: ShortcutDefinition, extra = ''): string {
  const hoverClass = isHoverChip(def) ? ' hints-bar-chip--hover' : '';
  return `hints-bar-chip${extra}${hoverClass}`;
}

function renderChip(def: ShortcutDefinition): TemplateResult {
  const primaryKey = def.hintDisplayKey ?? def.displayKey;

  if (def.hintExpandedHelp && def.hintExpandedHelp.length > 0) {
    return html`
      <span
        class=${chipClasses(def, ' hints-bar-chip--expandable')}
        title=${def.description}
        tabindex="0"
      >
        <kbd class="hints-bar-chord">
          ${renderChordContents(primaryKey)}
          <span class="hints-bar-chord-suffix" aria-hidden="true">+</span>
        </kbd>
        <span class="hints-bar-label">${def.hintLabel}</span>
        <span class="hints-bar-popover" role="tooltip">
          <span class="hints-bar-popover-header">${def.hintLabel}</span>
          ${def.hintExpandedHelp.map(
            (item) => html`
              <span class="hints-bar-popover-row">
                ${renderChord(item.key)}
                <span class="hints-bar-popover-name">${item.label}</span>
              </span>
            `
          )}
        </span>
      </span>
    `;
  }

  return html`
    <span class=${chipClasses(def)} title=${def.description}>
      ${renderChord(primaryKey)}
      <span class="hints-bar-label">${def.hintLabel}</span>
    </span>
  `;
}

/** Walks the state-chip list and bundles each contiguous run of same-
 *  `hintGroup` chips into a visible wrapper carrying the group's label and a
 *  thin accent underline. The wrapper is `inline-flex` so the group floats
 *  as one atomic unit in the bar's flex layout — chips inside never wrap
 *  away from their label. Ungrouped chips render bare.
 *
 *  When a group's name matches the active mode badge (case-insensitive),
 *  the label text is suppressed — the badge already conveys "MARKERS" /
 *  "CROP" / etc., so repeating it inside the lane wastes space. The
 *  wrapper + underline still render, preserving the visual grouping. */
function renderGroupedChips(
  chips: ShortcutDefinition[],
  suppressedGroupLabel?: string
): TemplateResult[] {
  const suppressed = suppressedGroupLabel?.toLowerCase();
  const nodes: TemplateResult[] = [];
  let i = 0;
  while (i < chips.length) {
    const chip = chips[i];
    const group = chip.hintGroup;
    if (!group) {
      nodes.push(renderChip(chip));
      i += 1;
      continue;
    }
    const groupChips: ShortcutDefinition[] = [];
    while (i < chips.length && chips[i].hintGroup === group) {
      groupChips.push(chips[i]);
      i += 1;
    }
    const hideLabel = suppressed != null && group.toLowerCase() === suppressed;
    nodes.push(html`
      <span class="hints-bar-chip-group" role="group" aria-label=${group}>
        ${hideLabel
          ? nothing
          : html`<span class="hints-bar-badge-text hints-bar-group-label" aria-hidden="true"
              >${group}</span
            >`}
        ${groupChips.map(renderChip)}
      </span>
    `);
  }
  return nodes;
}

/** Maps the current context to a short, all-caps badge label that surfaces
 *  "you're in this mode right now". Uniform styling across all modes so the
 *  badge consistently stands out from the hotkey chips — the label itself
 *  tells the user what state they're in.
 *
 *  Hover contexts over charts take precedence over the resting primary
 *  (default / marker-selected) because hovering a chart is the user's
 *  active focus — same reason chart-specific hover chips replace the
 *  state chips. Mid-action primaries (drawing/dragging/resizing/editors)
 *  always win because the hover layer is suppressed during them anyway. */
function getModeBadgeLabel(primary: HintContext, hovers: HintContext[]): string {
  // Mid-action primaries override hover — they suppress the hover layer
  // anyway (see HOVER_SUPPRESSING_PRIMARIES), so badge follows suit.
  switch (primary) {
    case 'crop-drawing':
      return 'Draw';
    case 'crop-dragging':
      return 'Drag';
    case 'crop-resizing':
      return 'Resize';
  }
  // Chart hovers — point variants take precedence over their canvas parent.
  if (hovers.includes('hover-speed-chart-point')) return 'Speed Pt';
  if (hovers.includes('hover-crop-chart-point')) return 'Crop Pt';
  if (hovers.includes('hover-speed-chart')) return 'Speed';
  if (hovers.includes('hover-crop-chart-zoompan')) return 'Zoom/Pan';
  if (hovers.includes('hover-crop-chart')) return 'Crop Chart';
  // Video region — crop is a SUB-region inside video, so when both fire
  // (cursor over the crop overlay) prefer the more specific "Video: Crop"
  // label so the user can tell which sub-context they're in.
  if (hovers.includes('crop-input-focused')) return 'Crop Input';
  if (hovers.includes('hover-crop')) return 'Crop';
  if (hovers.includes('hover-video')) return 'Video';
  // Timeline — the progress-bar hover surfaces marker operations on the
  // time axis. Distinct from the resting `marker-selected` ("MARKERS")
  // primary so the user isn't seeing the same badge for two genuinely
  // different contexts.
  if (hovers.includes('hover-progress-bar')) return 'Timeline';
  // Editor primaries surface only when no hover overrides them — they
  // don't suppress hover (the user can still interact with video / crop /
  // charts), so the more-specific hover label wins when applicable.
  if (primary === 'global-editor') return 'Global';
  if (primary === 'marker-editor') return 'Pair Edit';
  // Resting fallback.
  if (primary === 'marker-selected') return 'Markers';
  return 'Default';
}

function renderBar(): TemplateResult {
  const { primary, hovers } = resolveContexts();
  lastRenderedContext = primary;
  lastRenderedHoverKey = hovers.join(',');
  const shortcuts = getVisibleShortcuts(primary, hovers);
  const hoverChips = shortcuts.filter(isHoverChip);
  const stateChips = shortcuts.filter(
    (s) => !isHoverChip(s) && !s.hintContexts?.includes('always')
  );
  const persistent = shortcuts.filter((s) => s.hintContexts?.includes('always'));
  const atTop = state?.mode === 'pinned-top';
  const modeBadgeLabel = getModeBadgeLabel(primary, hovers);
  return html`
    <span class="hints-bar-controls" aria-hidden="false">
      <button
        type="button"
        class="hints-bar-flip"
        title=${atTop ? 'Move hints bar to bottom' : 'Move hints bar to top'}
        aria-label=${atTop ? 'Move hints bar to bottom' : 'Move hints bar to top'}
        @click=${onFlipClick}
      >
        ${renderUIIcon(atTop ? 'chevronDown' : 'chevronUp', 14)}
      </button>
      <button
        type="button"
        class="hints-bar-close"
        title="Hide hints bar (Alt+F)"
        aria-label="Hide hints bar"
        @click=${onCloseClick}
      >
        ${renderUIIcon('close', 14)}
      </button>
    </span>
    <span
      class="hints-bar-badge-text hints-bar-mode-badge"
      role="status"
      aria-label=${`Current mode: ${modeBadgeLabel}`}
      >${modeBadgeLabel}</span
    >
    <div class="hints-bar-scroller">
      <div class="hints-bar-scroller-inner">
        ${hoverChips.length > 0
          ? html`<span
              class="hints-bar-chips hints-bar-chips--hover"
              role="toolbar"
              aria-label="Hover shortcuts"
            >
              ${renderGroupedChips(hoverChips, modeBadgeLabel)}
            </span>`
          : nothing}
        ${hoverChips.length > 0 && stateChips.length > 0
          ? html`<span class="hints-bar-divider" aria-hidden="true"></span>`
          : nothing}
        <span
          class="hints-bar-chips hints-bar-chips--contextual"
          role="toolbar"
          aria-label="Contextual shortcuts"
        >
          ${renderGroupedChips(stateChips, modeBadgeLabel)}
        </span>
        ${persistent.length > 0
          ? html`<span class="hints-bar-divider" aria-hidden="true"></span>
              <span
                class="hints-bar-chips hints-bar-chips--persistent"
                role="toolbar"
                aria-label="Persistent shortcuts"
              >
                ${persistent.map(renderChip)}
              </span>`
          : nothing}
      </div>
    </div>
  `;
}

function onCloseClick(e: MouseEvent): void {
  e.stopPropagation();
  if (handle) handle.setVisible(false);
}

function onFlipClick(e: MouseEvent): void {
  e.stopPropagation();
  flipPin();
}

function rerender(): void {
  if (!shell) return;
  render(renderBar(), shell);
  // Chip set just changed — overflow state may have changed and the inner
  // wrapper was just re-templated, so re-apply the current scroll offset
  // (clamped to new bounds) and refresh fade indicators.
  applyScroll();
  updateScrollIndicators();
}

/** Manual horizontal "scrolling" implemented as `transform: translateX()`
 *  on the inner chip-wrapper. We can't use native `overflow-x: auto` on the
 *  shell because that would coerce `overflow-y` to `auto` per CSS spec and
 *  clip chord-popovers extending above/below the shell. */
let scrollX = 0;

function getScroller(): { scroller: HTMLDivElement; inner: HTMLDivElement } | null {
  if (!shell) return null;
  const scroller = shell.querySelector<HTMLDivElement>('.hints-bar-scroller');
  const inner = scroller?.querySelector<HTMLDivElement>('.hints-bar-scroller-inner');
  if (!scroller || !inner) return null;
  return { scroller, inner };
}

function getMaxScroll(): number {
  const els = getScroller();
  if (!els) return 0;
  return Math.max(0, els.inner.offsetWidth - els.scroller.clientWidth);
}

function applyScroll(): void {
  const els = getScroller();
  if (!els) return;
  const max = getMaxScroll();
  if (scrollX > max) scrollX = max;
  if (scrollX < 0) scrollX = 0;
  els.inner.style.transform = `translateX(${-scrollX}px)`;
}

function setScrollX(x: number): void {
  scrollX = x;
  applyScroll();
  updateScrollIndicators();
}

let rafId: number | null = null;
let lastRenderedModifierKey = '';

function tick(): void {
  if (state?.visible && shell) {
    const { primary, hovers } = resolveContexts();
    const hoverKey = hovers.join(',');
    const mods = getModifierState();
    const modKey = `${mods.ctrl ? 'C' : ''}${mods.shift ? 'S' : ''}${mods.alt ? 'A' : ''}`;
    if (
      primary !== lastRenderedContext ||
      hoverKey !== lastRenderedHoverKey ||
      modKey !== lastRenderedModifierKey
    ) {
      lastRenderedModifierKey = modKey;
      rerender();
    }
  }
  rafId = requestAnimationFrame(tick);
}

function startTicking(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/** Wires the mouse wheel to horizontally scroll the bar via the
 *  transform-based scroller. Mouse wheels default to vertical, so
 *  `deltaY` is converted to horizontal scroll. */
function attachWheelScroll(target: HTMLDivElement): void {
  target.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (getMaxScroll() <= 0) return; // nothing to scroll
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Touchpad horizontal swipe — honor it directly.
        e.preventDefault();
        setScrollX(scrollX + e.deltaX);
        return;
      }
      e.preventDefault();
      setScrollX(scrollX + e.deltaY);
    },
    { passive: false }
  );
}

/** Click-and-drag horizontal scrolling — same effect as wheel scrolling
 *  but pointer-driven. Skipped when the pointerdown landed on an
 *  interactive element (button, expandable chip) so chip clicks /
 *  popovers still work. */
function attachDragToScroll(target: HTMLDivElement): void {
  const DRAG_THRESHOLD_PX = 4;
  let pointerId: number | null = null;
  let startClientX = 0;
  let startScrollX = 0;
  let crossedThreshold = false;

  target.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, [tabindex]')) return;
    pointerId = e.pointerId;
    startClientX = e.clientX;
    startScrollX = scrollX;
    crossedThreshold = false;
  });

  target.addEventListener('pointermove', (e: PointerEvent) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - startClientX;
    if (!crossedThreshold && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!crossedThreshold) {
      target.setPointerCapture(e.pointerId);
      crossedThreshold = true;
    }
    setScrollX(startScrollX - dx);
  });

  const end = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    if (crossedThreshold && target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    pointerId = null;
    crossedThreshold = false;
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

/** Sets `is-scrolled-x` / `can-scroll-right` classes on the shell so the
 *  left/right fade overlays appear only when there's actually content
 *  scrolled off-screen on that side. */
function updateScrollIndicators(): void {
  if (!shell) return;
  const max = getMaxScroll();
  shell.classList.toggle('is-scrolled-x', scrollX > 0);
  shell.classList.toggle('can-scroll-right', scrollX < max - 1);
}

/** Push the shell's right edge inboard of the page's vertical scrollbar.
 *  The host is `position: fixed; inset: 0`, which in Chromium extends to
 *  the viewport edges *including* the scrollbar — so without this offset
 *  the rightmost slice of the bar (last chip, fade overlay) renders under
 *  the scrollbar and is visibly clipped. `window.innerWidth -
 *  documentElement.clientWidth` is the canonical scrollbar-width probe;
 *  it returns 0 when no scrollbar is shown (overlay scrollbars, full-screen,
 *  etc.) so the offset auto-disables on platforms that don't need it. */
function updateViewportOffsets(): void {
  if (!host) return;
  const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  host.style.setProperty('--scrollbar-offset', `${scrollbarWidth}px`);
}

function ensureMounted(): void {
  if (host && shell) return;

  if (!cssInjected) {
    injectCSS(hintsBarCSS, 'hints-bar-css');
    cssInjected = true;
  }

  host = document.createElement('div');
  host.className = 'hints-bar-host';

  shell = document.createElement('div');
  shell.className = 'hints-bar-shell';

  host.appendChild(shell);
  document.body.appendChild(host);

  updateViewportOffsets();
  attachWheelScroll(shell);
  attachDragToScroll(shell);
  attachInspectionFreeze(shell);
  attachFocusGuard(shell);
  attachPopoverPositioner(shell);
}

/** Prevent the bar from stealing focus on click. Without this, clicking any
 *  button or focusable chip inside the bar blurs whatever element (e.g.,
 *  the crop input) was previously focused — and `crop-input-focused`
 *  hover-layer context drops out, so the user-visible chip set flips
 *  context just because they clicked on the bar. `mousedown.preventDefault()`
 *  is the canonical way to suppress the focus shift while still letting the
 *  click event fire on `mouseup`, so button onclick handlers continue to
 *  work normally. */
function attachFocusGuard(target: HTMLDivElement): void {
  target.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
}

/** Adjusts the `--popover-shift-x` CSS variable on an expandable chip's
 *  popover so it stays inside the scroller's horizontal bounds. The
 *  scroller has `overflow-x: clip`, so a centered popover near the left
 *  or right edge of the visible scrollport would be cut off — shifting
 *  it horizontally keeps the whole popover inside. The chip's tip pointer
 *  counter-shifts via the same variable (see hints-bar.css) so it still
 *  points at the chip. */
function adjustPopoverPosition(chip: HTMLElement): void {
  const popover = chip.querySelector<HTMLElement>('.hints-bar-popover');
  if (!popover) return;
  const scrollerEl = chip.closest<HTMLElement>('.hints-bar-scroller');
  if (!scrollerEl) return;

  const popoverRect = popover.getBoundingClientRect();
  if (popoverRect.width === 0) return; // not yet laid out

  const chipRect = chip.getBoundingClientRect();
  const scrollerRect = scrollerEl.getBoundingClientRect();

  const PADDING = 6;
  const chipCenter = chipRect.left + chipRect.width / 2;
  const desiredLeft = chipCenter - popoverRect.width / 2;
  const minLeft = scrollerRect.left + PADDING;
  const maxLeft = scrollerRect.right - popoverRect.width - PADDING;
  const clampedLeft = Math.max(minLeft, Math.min(desiredLeft, maxLeft));
  const shiftX = clampedLeft - desiredLeft;

  popover.style.setProperty('--popover-shift-x', `${shiftX}px`);
}

function attachPopoverPositioner(target: HTMLDivElement): void {
  const handler = (e: Event): void => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.hints-bar-chip--expandable');
    if (chip) adjustPopoverPosition(chip);
  };
  target.addEventListener('mouseover', handler);
  target.addEventListener('focusin', handler);
}

/** Wired in `ensureMounted()`. When the cursor actually enters the bar we
 *  freeze the hover region so the chip set locks while the user inspects
 *  it; leaving the bar unfreezes. The longer `HOVER_GRACE_MS` in
 *  `hover-region.ts` gives the user time to transit from a region toward
 *  the bar without losing the contextual chips on the way. */
function attachInspectionFreeze(target: HTMLDivElement): void {
  target.addEventListener('mouseenter', freezeHover);
  target.addEventListener('mouseleave', unfreezeHover);
}

let barEnabled = true;

function applyVisibility(): void {
  if (!shell || !state) return;
  const shouldShow = state.visible && barEnabled;
  if (shouldShow) {
    shell.classList.remove('is-hidden');
    applyMode();
    rerender();
  } else {
    shell.classList.add('is-hidden');
    // Bar's about to be invisible — if the cursor happens to be on it,
    // its `mouseleave` won't necessarily fire before the next region
    // change, so release any active freeze proactively.
    unfreezeHover();
  }
}

function setVisible(visible: boolean): void {
  if (!shell || !state) return;
  state.visible = visible;
  persistState();
  applyVisibility();
}

export function setHintsBarEnabled(enabled: boolean): void {
  if (barEnabled === enabled) return;
  barEnabled = enabled;
  applyVisibility();
}

export interface HintsBarHandle {
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  rerender(): void;
  getState(): Readonly<HintsBarRuntimeState>;
}

let handle: HintsBarHandle | null = null;

export function mountHintsBar(registry: ShortcutRegistry): HintsBarHandle {
  activeRegistry = registry;
  if (handle) return handle;

  state = loadPersistedState();
  ensureMounted();
  applyMode();
  rerender();
  setVisible(state.visible);
  startModifierTracker();
  startInputFocusTracker();
  startTicking();
  window.addEventListener('resize', onWindowResize, { passive: true });

  handle = {
    setVisible,
    isVisible: () => state?.visible ?? false,
    rerender,
    getState: () => state as Readonly<HintsBarRuntimeState>,
  };
  return handle;
}

export function getHintsBarHandle(): HintsBarHandle | null {
  return handle;
}

export function toggleHintsBar(): void {
  if (!handle) return;
  handle.setVisible(!handle.isVisible());
}
