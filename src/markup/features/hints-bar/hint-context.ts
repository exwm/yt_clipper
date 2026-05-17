import { HintContext } from '../../../command-palette';
import { appState } from '../../appState';
import { cropManipulationKind, isDrawingCrop } from '../../crop-overlay';
import { getHoveredRegion, HoveredRegion } from './hover-region';
import { getFocusedInputContext } from './input-focus';

/**
 * Read-only observers of app state. The hints bar combines two signals:
 *
 *  1. `getCurrentHintContext()` — the single "primary context" derived from
 *     a priority cascade over app state (mid-action > modal > selection >
 *     default). This represents the user's PRIMARY MODE.
 *  2. `getCurrentHoverContext()` — which page region the mouse is over,
 *     translated to a hover-* context tag. ADDITIVE on top of the primary:
 *     hovered region adds region-specific chips to the visible set.
 *
 * When the primary context is mid-action (e.g. drawing a crop) or a modal
 * editor is open, the hover layer is SUPPRESSED — the user's attention is
 * focused and we don't want hover-driven swaps to add noise.
 */
export function getCurrentHintContext(): HintContext {
  // Mid-action modes take priority — they describe what the user is doing
  // RIGHT NOW, and the chip set should change to "what comes next" in that
  // workflow rather than the broader selection-level shortcuts.
  if (isDrawingCrop) return 'crop-drawing';
  if (cropManipulationKind === 'drag') return 'crop-dragging';
  if (cropManipulationKind === 'resize') return 'crop-resizing';
  // Editor panels — global editor edits the new-marker defaults; the pair
  // editor edits the currently-selected pair. Both surface a distinct chip
  // set but unlike the mid-action primaries they DON'T suppress the hover
  // layer (the user can still hover the crop, charts, etc. and get the
  // usual region-specific chips).
  if (appState.isSettingsEditorOpen && appState.wasGlobalSettingsEditorOpen) {
    return 'global-editor';
  }
  // 'marker-selected' fires only while the pair editor panel is actually
  // open. `appState.prevSelectedMarkerPairIndex` is preserved across editor
  // toggles (so re-toggling reopens the same pair) and would otherwise
  // strand the bar in marker-selected after the user has deselected.
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    return 'marker-selected';
  }
  return 'default';
}

const HOVER_SUPPRESSING_PRIMARIES: ReadonlySet<HintContext> = new Set<HintContext>([
  'crop-drawing',
  'crop-dragging',
  'crop-resizing',
  // Editor primaries deliberately omitted — opening the global or pair
  // editor doesn't narrow the user's focus the way a mid-action does, so
  // hover chips (crop / chart / video) remain useful.
]);

export function shouldApplyHoverLayer(primary: HintContext): boolean {
  return !HOVER_SUPPRESSING_PRIMARIES.has(primary);
}

/**
 * Translates the raw hovered region into HintContext tags. Point-hover REPLACES
 * (does not stack on top of) canvas-hover — when the cursor is over an existing
 * chart point, only the `-point` context fires, so chips advertising
 * canvas-level actions (add a new point, draw a new crop in zoompan mode)
 * don't clutter the point-focused chip set. Canvas-level chips that DO remain
 * useful while over a point — e.g. zoom / reset zoom — must tag the point
 * context explicitly.
 *
 * The `crop` region still stacks `hover-video` underneath because the crop
 * overlay is a child of the video region and the user's mental model is
 * "I'm hovering both" — unlike a chart point, where "I'm interacting with this
 * point" supersedes "I'm somewhere in the chart".
 *
 * Also folds in any active "focused input" context (additive layer driven
 * by which form element has keyboard focus, not by cursor position).
 */
export function getCurrentHoverContexts(): HintContext[] {
  const contexts = regionHoverContexts();
  const focused = getFocusedInputContext();
  if (focused) contexts.push(focused);
  return contexts;
}

function regionHoverContexts(): HintContext[] {
  const region: HoveredRegion = getHoveredRegion();
  if (region == null) return [];
  switch (region) {
    case 'video':
      return ['hover-video'];
    case 'crop':
      return ['hover-video', 'hover-crop'];
    case 'progress-bar':
      return ['hover-progress-bar'];
    case 'speed-chart':
      return ['hover-speed-chart'];
    case 'speed-chart-point':
      return ['hover-speed-chart-point'];
    case 'crop-chart':
      return [isCropChartZoomPanActive() ? 'hover-crop-chart-zoompan' : 'hover-crop-chart'];
    case 'crop-chart-point':
      return ['hover-crop-chart-point'];
  }
}

function isCropChartZoomPanActive(): boolean {
  const idx = appState.prevSelectedMarkerPairIndex;
  if (idx == null) return false;
  const pair = appState.markerPairs[idx];
  if (!pair) return false;
  return pair.enableZoomPan;
}
