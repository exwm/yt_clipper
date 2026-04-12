export interface KeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface KeyBinding {
  code: string;
  modifiers: KeyModifiers;
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
