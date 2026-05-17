export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBinding {
  code: string;
  modifiers: KeyModifiers;
}

export type HintContext =
  | 'always'
  | 'default'
  | 'crop-drawing'
  | 'crop-dragging'
  | 'crop-resizing'
  | 'global-editor'
  | 'marker-editor'
  | 'hover-video'
  | 'hover-crop'
  | 'hover-progress-bar'
  | 'hover-speed-chart'
  | 'hover-speed-chart-point'
  | 'hover-crop-chart'
  | 'hover-crop-chart-point'
  | 'hover-crop-chart-zoompan'
  | 'marker-selected'
  /** Input-focus contexts behave like hover contexts (additive to the
   *  primary) but are driven by which form element currently has keyboard
   *  focus, not by cursor position. Surfaces shortcuts that only make
   *  sense while typing into that field. */
  | 'crop-input-focused';

export interface HintModifierRequirement {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: string;
  description: string;
  displayKey: string;
  section: string;
  category: string;
  essential: boolean;
  binding: KeyBinding | null;
  handler: ((e: KeyboardEvent) => void) | null;
  guard?: () => boolean;
  displayNote?: string;
  executable: boolean;
  hintLabel?: string;
  hintContexts?: HintContext[];
  whenModifiers?: HintModifierRequirement;
  hintOrder?: number;
  /** Overrides `displayKey` for hint-bar rendering only. Lets a single chip
   *  render multiple keys (e.g. "Alt + Left + Right" for a "select pair" chip
   *  bound to two real shortcuts). The underlying `displayKey`/`binding` are
   *  unchanged. */
  hintDisplayKey?: string;
  /** When set, the chip renders a compact primary chord (the shortcut's own
   *  displayKey or hintDisplayKey) with a small "+" indicator. Hovering reveals
   *  a popover listing every variant in this array. Use for tightly related
   *  shortcut families (e.g. preview toggles all bound to `C` with stacked
   *  modifiers). */
  hintExpandedHelp?: { key: string; label: string }[];
  /** Visual group label rendered in the hints bar before this chip when it's
   *  the first chip in a group (or when the previous chip is in a different
   *  group / ungrouped). Lets related chips share a small all-caps header so
   *  individual labels can drop redundant context ("Add" instead of "Add
   *  Marker" inside a `MARKERS` group). */
  hintGroup?: string;
}

export interface CommandPaletteOptions {
  container?: HTMLElement;
  cssPrefix?: string;
  cssVariables?: Record<string, string>;
  zIndex?: number;
  maxLastSearches?: number;
  maxRecentCommands?: number;
  onOpenReference?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export type MatchKind = 'exactKey' | 'partialKey' | 'fuzzy';

export interface SearchResult {
  shortcut: ShortcutDefinition;
  score: number;
  highlightRanges: number[];
  matchKind?: MatchKind;
}
