import { paletteCss } from './palette.css';
import { ShortcutRegistry } from './registry';
import { CommandPaletteOptions, MatchKind, SearchResult, ShortcutDefinition } from './types';

const STYLE_ELEMENT_ID = 'cmdp-styles';
const DISPLAY_KEY_SEPARATOR_RE = /(\s*\+\s*|\s*\/\s*|\s*,\s*|\s+or\s+)/g;
const LAST_SEARCHES_STORAGE_KEY = 'cmdp-last-searches';
const DEFAULT_MAX_LAST_SEARCHES = 1;
const SORT_MODE_STORAGE_KEY = 'cmdp-sort-mode';
const RECENT_COMMANDS_STORAGE_KEY = 'cmdp-recent-commands';
const DEFAULT_MAX_RECENT_COMMANDS = 3;
const RECENT_SECTION_LABEL = 'Recently used';

type SelectCallback = (shortcut: ShortcutDefinition) => void;

interface VisibleItem {
  kind: 'item';
  shortcut: ShortcutDefinition;
  highlightRanges: number[];
  matchKind?: MatchKind;
}

interface VisibleSection {
  kind: 'section';
  label: string;
}

interface VisibleCategory {
  kind: 'category';
  label: string;
}

type VisibleEntry = VisibleItem | VisibleSection | VisibleCategory;

export class CommandPalette {
  private container: HTMLElement;
  private zIndex: number;
  private overlay: HTMLDivElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resultsEl: HTMLDivElement | null = null;
  private essentialFilterEl: HTMLInputElement | null = null;
  private sortFilterEl: HTMLInputElement | null = null;
  private lastSearchesContainerEl: HTMLDivElement | null = null;
  private lastSearches: string[] = [];
  private maxLastSearches: number;
  private maxRecentCommands: number;
  private recentCommandIds: string[] = [];
  private preserveOrder: boolean = false;
  private onOpenReference: (() => void) | null = null;
  private selectCallback: SelectCallback | null = null;
  private highlightIndex = 0;
  private visibleEntries: VisibleEntry[] = [];
  private executableIndexes: number[] = [];
  private currentQuery = '';
  private keydownHandler: (e: KeyboardEvent) => void;

  constructor(
    private registry: ShortcutRegistry,
    options: CommandPaletteOptions = {}
  ) {
    this.container = options.container ?? document.body;
    this.zIndex = options.zIndex ?? 99999;
    this.maxLastSearches = Math.max(0, options.maxLastSearches ?? DEFAULT_MAX_LAST_SEARCHES);
    this.maxRecentCommands = Math.max(0, options.maxRecentCommands ?? DEFAULT_MAX_RECENT_COMMANDS);
    this.onOpenReference = options.onOpenReference ?? null;
    this.keydownHandler = (e) => this.handleKeydown(e);
    this.lastSearches = loadLastSearches(this.maxLastSearches);
    this.recentCommandIds = loadRecentCommands(this.maxRecentCommands);
    this.preserveOrder = loadPreserveOrder();
    ensureStyles();
  }

  open(): void {
    if (this.overlay) return;
    this.build();
    this.refreshResults('');
    this.searchInput?.focus();
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  close(): void {
    if (!this.overlay) return;
    document.removeEventListener('keydown', this.keydownHandler, true);
    this.overlay.remove();
    this.overlay = null;
    this.searchInput = null;
    this.resultsEl = null;
    this.essentialFilterEl = null;
    this.sortFilterEl = null;
    this.lastSearchesContainerEl = null;
    this.visibleEntries = [];
    this.executableIndexes = [];
    this.highlightIndex = 0;
  }

  toggle(): void {
    if (this.overlay) this.close();
    else this.open();
  }

  isOpen(): boolean {
    return this.overlay !== null;
  }

  onSelect(callback: SelectCallback): void {
    this.selectCallback = callback;
  }

  private build(): void {
    const overlay = document.createElement('div');
    overlay.className = 'cmdp-overlay';
    overlay.style.zIndex = String(this.zIndex);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });

    const palette = document.createElement('div');
    palette.className = 'cmdp-palette';

    const searchRow = document.createElement('div');
    searchRow.className = 'cmdp-search-row';
    const search = document.createElement('input');
    search.className = 'cmdp-search';
    search.type = 'text';
    search.placeholder = 'Search shortcuts...';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.addEventListener('input', () => {
      this.recordSearch(search.value);
      this.refreshResults(search.value);
    });
    searchRow.appendChild(search);
    palette.appendChild(searchRow);

    const filters = document.createElement('div');
    filters.className = 'cmdp-filters';
    const essentialLabel = document.createElement('label');
    essentialLabel.className = 'cmdp-essential-filter';
    const essentialCheckbox = document.createElement('input');
    essentialCheckbox.type = 'checkbox';
    essentialCheckbox.className = 'cmdp-essential-checkbox';
    essentialCheckbox.addEventListener('change', () => this.refreshResults(search.value));
    const essentialText = document.createElement('span');
    essentialText.className = 'cmdp-essential-filter-text';
    essentialText.textContent = 'essential only';
    essentialLabel.appendChild(essentialCheckbox);
    essentialLabel.appendChild(essentialText);
    filters.appendChild(essentialLabel);

    const sortLabel = document.createElement('label');
    sortLabel.className = 'cmdp-sort-filter';
    sortLabel.title =
      'Keep matches in their stable registration order. When off, results are ranked by match quality.';
    const sortCheckbox = document.createElement('input');
    sortCheckbox.type = 'checkbox';
    sortCheckbox.className = 'cmdp-sort-checkbox';
    sortCheckbox.checked = this.preserveOrder;
    sortCheckbox.addEventListener('change', () => {
      this.preserveOrder = sortCheckbox.checked;
      savePreserveOrder(this.preserveOrder);
      this.refreshResults(search.value);
    });
    const sortText = document.createElement('span');
    sortText.className = 'cmdp-sort-filter-text';
    sortText.textContent = 'preserve order';
    sortLabel.appendChild(sortCheckbox);
    sortLabel.appendChild(sortText);
    filters.appendChild(sortLabel);

    const lastSearches = document.createElement('div');
    lastSearches.className = 'cmdp-last-searches';
    filters.appendChild(lastSearches);

    palette.appendChild(filters);

    const results = document.createElement('div');
    results.className = 'cmdp-results';
    palette.appendChild(results);

    const footer = document.createElement('div');
    footer.className = 'cmdp-footer';
    const hints = document.createElement('div');
    hints.className = 'cmdp-footer-hints';
    hints.appendChild(makeFooterHint('\u2191\u2193', 'navigate'));
    hints.appendChild(makeFooterHint('\u21b5', 'execute'));
    hints.appendChild(makeFooterHint('esc', 'close'));
    footer.appendChild(hints);
    if (this.onOpenReference) {
      const refLink = document.createElement('button');
      refLink.type = 'button';
      refLink.className = 'cmdp-footer-reference';
      refLink.title = 'Open the full shortcuts reference table';
      refLink.textContent = '? full reference';
      refLink.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cb = this.onOpenReference;
        this.close();
        cb?.();
      });
      footer.appendChild(refLink);
    }
    palette.appendChild(footer);

    overlay.appendChild(palette);
    this.container.appendChild(overlay);

    this.overlay = overlay;
    this.searchInput = search;
    this.resultsEl = results;
    this.essentialFilterEl = essentialCheckbox;
    this.sortFilterEl = sortCheckbox;
    this.lastSearchesContainerEl = lastSearches;
    this.renderLastSearches();
  }

  private recordSearch(value: string): void {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.renderLastSearches();
      return;
    }
    if (this.maxLastSearches === 0) return;
    const existingIdx = this.lastSearches.indexOf(trimmed);
    if (existingIdx >= 0) this.lastSearches.splice(existingIdx, 1);
    this.lastSearches.unshift(trimmed);
    if (this.lastSearches.length > this.maxLastSearches) {
      this.lastSearches.length = this.maxLastSearches;
    }
    saveLastSearches(this.lastSearches);
    this.renderLastSearches();
  }

  private renderLastSearches(): void {
    const container = this.lastSearchesContainerEl;
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    const currentValue = this.searchInput?.value.trim() ?? '';
    if (this.maxLastSearches === 0 || this.lastSearches.length === 0) return;
    for (const query of this.lastSearches) {
      if (query === currentValue) continue;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'cmdp-last-search-pill';
      pill.title = 'Reuse search: ' + query;
      pill.textContent = query;
      pill.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.searchInput) return;
        this.searchInput.value = query;
        this.searchInput.focus();
        this.refreshResults(query);
      });
      container.appendChild(pill);
    }
  }

  private refreshResults(query: string): void {
    if (!this.resultsEl) return;
    const essentialOnly = !!this.essentialFilterEl?.checked;
    const trimmed = query.trim();
    this.currentQuery = trimmed;

    let candidates: SearchResult[];
    if (trimmed === '') {
      candidates = this.registry.getAll().map((shortcut) => ({
        shortcut,
        score: 0,
        highlightRanges: [],
      }));
    } else {
      candidates = this.registry.search(trimmed);
    }

    if (essentialOnly) {
      candidates = candidates.filter((r) => r.shortcut.essential);
    }

    this.visibleEntries = [];
    this.executableIndexes = [];

    if (trimmed === '') {
      this.buildRecentEntries(essentialOnly);
    }

    if (!this.preserveOrder && trimmed !== '') {
      this.buildRankedEntries(candidates);
    } else {
      this.buildGroupedEntries(candidates);
    }

    this.highlightIndex = this.pickInitialHighlight();
    this.paintResults();
    this.renderLastSearches();
  }

  private buildRecentEntries(essentialOnly: boolean): void {
    if (this.maxRecentCommands <= 0 || this.recentCommandIds.length === 0) return;

    const recent: ShortcutDefinition[] = [];
    for (const id of this.recentCommandIds) {
      const def = this.registry.getById(id);
      if (!def) continue;
      if (essentialOnly && !def.essential) continue;
      recent.push(def);
    }
    if (recent.length === 0) return;

    this.visibleEntries.push({ kind: 'section', label: RECENT_SECTION_LABEL });
    for (const def of recent) {
      this.pushItem({ shortcut: def, score: 0, highlightRanges: [] });
    }
  }

  private buildRankedEntries(candidates: SearchResult[]): void {
    const sectionOrder: string[] = [];
    const categoriesBySection = new Map<string, string[]>();
    const bucketByKey = new Map<string, SearchResult[]>();

    for (const candidate of candidates) {
      const def = candidate.shortcut;
      const { section, category } = def;
      const key = section + '\u0000' + category;

      if (!categoriesBySection.has(section)) {
        sectionOrder.push(section);
        categoriesBySection.set(section, []);
      }
      let bucket = bucketByKey.get(key);
      if (!bucket) {
        categoriesBySection.get(section)!.push(category);
        bucket = [];
        bucketByKey.set(key, bucket);
      }
      bucket.push(candidate);
    }

    for (const section of sectionOrder) {
      this.visibleEntries.push({ kind: 'section', label: section });
      for (const category of categoriesBySection.get(section)!) {
        this.visibleEntries.push({ kind: 'category', label: category });
        const bucket = bucketByKey.get(section + '\u0000' + category)!;
        for (const result of bucket) {
          this.pushItem(result);
        }
      }
    }
  }

  private buildGroupedEntries(candidates: SearchResult[]): void {
    const byId = new Map<string, SearchResult>();
    for (const c of candidates) byId.set(c.shortcut.id, c);

    const bySection = new Map<string, Map<string, SearchResult[]>>();
    for (const def of this.registry.getAll()) {
      const match = byId.get(def.id);
      if (!match) continue;
      let byCategory = bySection.get(def.section);
      if (!byCategory) {
        byCategory = new Map();
        bySection.set(def.section, byCategory);
      }
      let bucket = byCategory.get(def.category);
      if (!bucket) {
        bucket = [];
        byCategory.set(def.category, bucket);
      }
      bucket.push(match);
    }

    for (const [section, categories] of bySection) {
      this.visibleEntries.push({ kind: 'section', label: section });
      for (const [category, items] of categories) {
        this.visibleEntries.push({ kind: 'category', label: category });
        for (const result of items) {
          this.pushItem(result);
        }
      }
    }
  }

  private pickInitialHighlight(): number {
    for (const idx of this.executableIndexes) {
      const entry = this.visibleEntries[idx];
      if (entry.kind === 'item' && entry.matchKind === 'exactKey') return idx;
    }
    for (const idx of this.executableIndexes) {
      const entry = this.visibleEntries[idx];
      if (entry.kind === 'item' && entry.matchKind === 'partialKey') return idx;
    }
    return this.executableIndexes[0] ?? -1;
  }

  private pushItem(result: SearchResult): void {
    this.visibleEntries.push({
      kind: 'item',
      shortcut: result.shortcut,
      highlightRanges: result.highlightRanges,
      matchKind: result.matchKind,
    });
    const idx = this.visibleEntries.length - 1;
    if (result.shortcut.executable && result.shortcut.handler) {
      this.executableIndexes.push(idx);
    }
  }

  private paintResults(): void {
    if (!this.resultsEl) return;
    while (this.resultsEl.firstChild) this.resultsEl.removeChild(this.resultsEl.firstChild);

    if (this.visibleEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdp-empty';
      empty.textContent = 'No shortcuts match your search.';
      this.resultsEl.appendChild(empty);
      return;
    }

    this.visibleEntries.forEach((entry, idx) => {
      if (entry.kind === 'section') {
        const el = document.createElement('div');
        el.className = 'cmdp-section';
        el.textContent = entry.label;
        this.resultsEl!.appendChild(el);
        return;
      }
      if (entry.kind === 'category') {
        const el = document.createElement('div');
        el.className = 'cmdp-category';
        el.textContent = entry.label;
        this.resultsEl!.appendChild(el);
        return;
      }
      const item = document.createElement('div');
      item.className = 'cmdp-item';
      if (idx === this.highlightIndex) item.classList.add('cmdp-highlighted');
      const nonExecutable = !entry.shortcut.executable || !entry.shortcut.handler;
      if (nonExecutable) item.classList.add('cmdp-non-executable');
      if (entry.shortcut.essential) item.classList.add('cmdp-essential');
      if (entry.matchKind === 'exactKey') item.classList.add('cmdp-key-match-exact');
      else if (entry.matchKind === 'partialKey') item.classList.add('cmdp-key-match-partial');

      const desc = document.createElement('div');
      desc.className = 'cmdp-item-desc';
      appendHighlightedText(desc, entry.shortcut.description, entry.highlightRanges);
      item.appendChild(desc);

      const keys = document.createElement('div');
      keys.className = 'cmdp-item-keys';
      if (entry.shortcut.displayNote) {
        const note = document.createElement('span');
        note.className = 'cmdp-non-executable-badge';
        note.textContent = entry.shortcut.displayNote;
        keys.appendChild(note);
      } else if (entry.shortcut.displayKey) {
        const highlightQuery =
          entry.matchKind === 'exactKey' || entry.matchKind === 'partialKey'
            ? this.currentQuery
            : '';
        appendDisplayKey(keys, entry.shortcut.displayKey, highlightQuery);
      } else if (nonExecutable) {
        const badge = document.createElement('span');
        badge.className = 'cmdp-non-executable-badge';
        badge.textContent = 'mouse';
        keys.appendChild(badge);
      }
      item.appendChild(keys);

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'cmdp-item-run';
      runBtn.textContent = '\u25B6';
      if (nonExecutable) {
        runBtn.disabled = true;
        runBtn.title = 'Not executable from palette';
        runBtn.setAttribute('aria-label', 'Not executable: ' + entry.shortcut.description);
      } else {
        runBtn.title = 'Run';
        runBtn.setAttribute('aria-label', 'Run ' + entry.shortcut.description);
        runBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.executeAt(idx);
        });
      }
      item.appendChild(runBtn);

      item.addEventListener('mouseenter', () => {
        if (!nonExecutable && this.highlightIndex !== idx) {
          this.highlightIndex = idx;
          this.paintResults();
        }
      });

      this.resultsEl!.appendChild(item);
    });

    const highlighted = this.resultsEl.querySelector('.cmdp-highlighted');
    if (highlighted && 'scrollIntoView' in highlighted) {
      (highlighted as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.moveHighlight(1);
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.moveHighlight(-1);
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.executeAt(this.highlightIndex);
      return;
    }
    e.stopImmediatePropagation();
  }

  private moveHighlight(delta: number): void {
    if (this.executableIndexes.length === 0) return;
    const currentPos = this.executableIndexes.indexOf(this.highlightIndex);
    let next = currentPos + delta;
    if (currentPos < 0) next = delta > 0 ? 0 : this.executableIndexes.length - 1;
    if (next < 0) next = this.executableIndexes.length - 1;
    if (next >= this.executableIndexes.length) next = 0;
    this.highlightIndex = this.executableIndexes[next];
    this.paintResults();
  }

  private executeAt(idx: number): void {
    const entry = this.visibleEntries[idx];
    if (!entry || entry.kind !== 'item') return;
    const def = entry.shortcut;
    if (!def.executable || !def.handler) return;
    this.recordExecution(def.id);
    this.close();
    if (this.selectCallback) {
      this.selectCallback(def);
    } else {
      const fake = new KeyboardEvent('keydown', { code: def.binding?.code ?? '' });
      def.handler(fake);
    }
  }

  private recordExecution(id: string): void {
    if (this.maxRecentCommands <= 0) return;
    const existingIdx = this.recentCommandIds.indexOf(id);
    if (existingIdx >= 0) this.recentCommandIds.splice(existingIdx, 1);
    this.recentCommandIds.unshift(id);
    if (this.recentCommandIds.length > this.maxRecentCommands) {
      this.recentCommandIds.length = this.maxRecentCommands;
    }
    saveRecentCommands(this.recentCommandIds);
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = paletteCss;
  document.head.appendChild(style);
}

function makeFooterHint(key: string, label: string): HTMLElement {
  const hint = document.createElement('span');
  const k = document.createElement('kbd');
  k.textContent = key;
  hint.appendChild(k);
  hint.appendChild(document.createTextNode(' ' + label));
  return hint;
}

function appendHighlightedText(parent: HTMLElement, text: string, indexes: number[]): void {
  if (!indexes || indexes.length === 0) {
    parent.appendChild(document.createTextNode(text));
    return;
  }
  const sorted = indexes.slice().sort((a, b) => a - b);
  let cursor = 0;
  let i = 0;
  let buffer = '';
  const flush = () => {
    if (buffer.length > 0) {
      parent.appendChild(document.createTextNode(buffer));
      buffer = '';
    }
  };
  while (cursor < text.length) {
    if (i < sorted.length && sorted[i] === cursor) {
      flush();
      const mark = document.createElement('mark');
      while (i < sorted.length && sorted[i] === cursor) {
        mark.appendChild(document.createTextNode(text[cursor]));
        cursor++;
        i++;
      }
      parent.appendChild(mark);
    } else {
      buffer += text[cursor];
      cursor++;
    }
  }
  flush();
}

function appendDisplayKey(parent: HTMLElement, displayKey: string, query: string = ''): void {
  if (displayKey === '') return;
  const parts = displayKey.split(DISPLAY_KEY_SEPARATOR_RE);
  const matchedPositions = computeKeyMatchPositions(parts, query);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      parent.appendChild(document.createTextNode(part));
    } else if (part !== '') {
      const kbd = document.createElement('kbd');
      const partMatches = matchedPositions.get(idx);
      if (!partMatches || partMatches.size === 0) {
        kbd.textContent = part;
      } else {
        let buffer = '';
        const flush = () => {
          if (buffer.length > 0) {
            kbd.appendChild(document.createTextNode(buffer));
            buffer = '';
          }
        };
        for (let i = 0; i < part.length; i++) {
          if (partMatches.has(i)) {
            flush();
            const mark = document.createElement('mark');
            mark.textContent = part[i];
            kbd.appendChild(mark);
          } else {
            buffer += part[i];
          }
        }
        flush();
      }
      parent.appendChild(kbd);
    }
  });
}

function computeKeyMatchPositions(parts: string[], query: string): Map<number, Set<number>> {
  const result = new Map<number, Set<number>>();
  const normalizedQuery = query.toLowerCase().replace(/[\s+]/g, '');
  if (normalizedQuery === '') return result;

  let normalized = '';
  const origins: Array<{ partIdx: number; charIdx: number }> = [];
  parts.forEach((part, partIdx) => {
    if (partIdx % 2 === 1) return;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (/[\s+]/.test(ch)) continue;
      normalized += ch.toLowerCase();
      origins.push({ partIdx, charIdx: i });
    }
  });

  let from = 0;
  while (from <= normalized.length - normalizedQuery.length) {
    const found = normalized.indexOf(normalizedQuery, from);
    if (found < 0) break;
    for (let k = 0; k < normalizedQuery.length; k++) {
      const o = origins[found + k];
      let set = result.get(o.partIdx);
      if (!set) {
        set = new Set();
        result.set(o.partIdx, set);
      }
      set.add(o.charIdx);
    }
    from = found + 1;
  }
  return result;
}

function loadLastSearches(max: number): string[] {
  if (max <= 0) return [];
  try {
    const raw = localStorage.getItem(LAST_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned: string[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && v !== '' && !cleaned.includes(v)) cleaned.push(v);
      if (cleaned.length >= max) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

function saveLastSearches(searches: string[]): void {
  try {
    localStorage.setItem(LAST_SEARCHES_STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // storage disabled or quota exceeded; silently skip
  }
}

function loadPreserveOrder(): boolean {
  try {
    const raw = localStorage.getItem(SORT_MODE_STORAGE_KEY);
    if (raw === 'preserve') return true;
    if (raw === 'rank') return false;
  } catch {
    // storage disabled
  }
  return false;
}

function savePreserveOrder(preserve: boolean): void {
  try {
    localStorage.setItem(SORT_MODE_STORAGE_KEY, preserve ? 'preserve' : 'rank');
  } catch {
    // storage disabled or quota exceeded; silently skip
  }
}

function loadRecentCommands(max: number): string[] {
  if (max <= 0) return [];
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cleaned: string[] = [];
    for (const v of parsed) {
      if (typeof v === 'string' && v !== '' && !cleaned.includes(v)) cleaned.push(v);
      if (cleaned.length >= max) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

function saveRecentCommands(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage disabled or quota exceeded; silently skip
  }
}
