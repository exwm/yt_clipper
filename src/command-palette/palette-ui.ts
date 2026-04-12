import { paletteCss } from './palette.css';
import { ShortcutRegistry } from './registry';
import { CommandPaletteOptions, MatchKind, SearchResult, ShortcutDefinition } from './types';

const STYLE_ELEMENT_ID = 'cmdp-styles';
const DISPLAY_KEY_SEPARATOR_RE = /(\s*\+\s*|\s*\/\s*|\s*,\s*|\s+or\s+)/g;
const LAST_SEARCHES_STORAGE_KEY = 'cmdp-last-searches';
const DEFAULT_MAX_LAST_SEARCHES = 3;
const SORT_MODE_STORAGE_KEY = 'cmdp-sort-mode';
const RECENT_COMMANDS_STORAGE_KEY = 'cmdp-recent-commands';
const DEFAULT_MAX_RECENT_COMMANDS = 3;
const RECENT_SECTION_LABEL = 'Recently used';
const DISABLED_CATEGORIES_STORAGE_KEY = 'cmdp-disabled-categories';
const ESSENTIAL_ONLY_STORAGE_KEY = 'cmdp-essential-only';
const EXECUTABLE_ONLY_STORAGE_KEY = 'cmdp-executable-only';
const EXPANDED_SECTIONS_STORAGE_KEY = 'cmdp-expanded-sections';
const AUTO_PAUSE_STORAGE_KEY = 'cmdp-auto-pause';
const CATEGORY_SHORT_LABELS: Record<string, string> = {
  'General Shortcuts': 'General',
  'Marker Editing Shortcuts': 'Editing',
  'Marker Timing Shortcuts': 'Timing',
  'Marker Navigation Shortcuts': 'Navigation',
  'Cropping Shortcuts': 'Cropping',
  'Global Settings Editor Shortcuts': 'Settings',
  'Playback Shortcuts': 'Playback',
  'Preview Shortcuts': 'Preview',
  'Saving and Loading Shortcuts': 'Save/Load',
  'Frame Capturer Shortcuts': 'Frames',
  'Miscellaneous Shortcuts': 'Misc',
  'General Chart Shortcuts': 'Charts',
  'Speed Chart Shortcuts': 'Speed Chart',
  'Crop Chart Shortcuts': 'Crop Chart',
  'ZoomPan Mode Crop Chart Shortcuts': 'ZoomPan',
};

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
  disabled?: boolean;
}

type VisibleEntry = VisibleItem | VisibleSection | VisibleCategory;

export class CommandPalette {
  private container: HTMLElement;
  private zIndex: number;
  private overlay: HTMLDivElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private resultsEl: HTMLDivElement | null = null;
  private essentialFilterEl: HTMLInputElement | null = null;
  private executableFilterEl: HTMLInputElement | null = null;
  private disabledCategories = new Set<string>();
  private essentialOnly = false;
  private executableOnly = false;
  private counterEl: HTMLSpanElement | null = null;
  private itemNumber = 0;
  private categoryPillCounts = new Map<string, HTMLSpanElement>();
  private categoryFiltersEl: HTMLDivElement | null = null;
  private allCategories: string[] = [];
  private updateTabCounts: (() => void) | null = null;

  private lastSearchesContainerEl: HTMLDivElement | null = null;
  private lastSearches: string[] = [];
  private maxLastSearches: number;
  private maxRecentCommands: number;
  private recentCommandIds: string[] = [];
  private preserveOrder = false;
  private autoPause = false;
  private onOpenReference: (() => void) | null = null;
  private onOpenCallback: (() => void) | null = null;
  private onCloseCallback: (() => void) | null = null;
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
    this.onOpenCallback = options.onOpen ?? null;
    this.onCloseCallback = options.onClose ?? null;
    this.keydownHandler = (e) => {
      this.handleKeydown(e);
    };
    this.lastSearches = loadLastSearches(this.maxLastSearches);
    this.recentCommandIds = loadRecentCommands(this.maxRecentCommands);
    this.preserveOrder = loadPreserveOrder();
    this.autoPause = loadBooleanPref(AUTO_PAUSE_STORAGE_KEY);
    this.disabledCategories = loadDisabledCategories();
    this.essentialOnly = loadBooleanPref(ESSENTIAL_ONLY_STORAGE_KEY);
    this.executableOnly = loadBooleanPref(EXECUTABLE_ONLY_STORAGE_KEY);
    ensureStyles();
  }

  open(): void {
    if (this.overlay) return;
    if (this.autoPause) this.onOpenCallback?.();
    this.build();
    this.refreshResults('');
    this.searchInput?.focus();
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  close(): void {
    if (!this.overlay) return;
    const query = this.searchInput?.value.trim() ?? '';
    if (query) this.saveSearch(query);
    if (this.autoPause) this.onCloseCallback?.();
    document.removeEventListener('keydown', this.keydownHandler, true);
    this.overlay.remove();
    this.overlay = null;
    this.searchInput = null;
    this.resultsEl = null;
    this.essentialFilterEl = null;
    this.executableFilterEl = null;
    this.counterEl = null;

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
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'cmdp-search-clear';
    clearBtn.textContent = '\u00D7';
    clearBtn.title = 'Clear search';
    clearBtn.style.display = 'none';
    clearBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      search.value = '';
      clearBtn.style.display = 'none';
      search.focus();
      this.refreshResults('');
    });
    search.addEventListener('input', () => {
      clearBtn.style.display = search.value ? '' : 'none';
      this.refreshResults(search.value);
    });
    const counter = document.createElement('span');
    counter.className = 'cmdp-counter';
    searchRow.appendChild(search);
    searchRow.appendChild(clearBtn);
    searchRow.appendChild(counter);
    palette.appendChild(searchRow);

    const lastSearchesRow = document.createElement('div');
    lastSearchesRow.className = 'cmdp-last-searches-row';
    const lastSearchesLabel = document.createElement('span');
    lastSearchesLabel.className = 'cmdp-region-label cmdp-help-text';
    lastSearchesLabel.textContent = 'Recent';
    lastSearchesRow.appendChild(lastSearchesLabel);
    const lastSearches = document.createElement('div');
    lastSearches.className = 'cmdp-last-searches';
    lastSearchesRow.appendChild(lastSearches);
    palette.appendChild(lastSearchesRow);

    const filters = document.createElement('div');
    filters.className = 'cmdp-filters';
    const filtersLabel = document.createElement('span');
    filtersLabel.className = 'cmdp-region-label cmdp-help-text';
    filtersLabel.textContent = 'Options';
    filters.appendChild(filtersLabel);
    const essentialLabel = document.createElement('label');
    essentialLabel.className = 'cmdp-essential-filter';
    const essentialCheckbox = document.createElement('input');
    essentialCheckbox.type = 'checkbox';
    essentialCheckbox.className = 'cmdp-essential-checkbox';
    essentialCheckbox.checked = this.essentialOnly;
    essentialCheckbox.addEventListener('change', () => {
      this.essentialOnly = essentialCheckbox.checked;
      saveBooleanPref(ESSENTIAL_ONLY_STORAGE_KEY, this.essentialOnly);
      this.refreshResults(search.value);
    });
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

    const executableLabel = document.createElement('label');
    executableLabel.className = 'cmdp-executable-filter';
    executableLabel.title = 'Show only shortcuts that can be executed from the palette.';
    const executableCheckbox = document.createElement('input');
    executableCheckbox.type = 'checkbox';
    executableCheckbox.className = 'cmdp-executable-checkbox';
    executableCheckbox.checked = this.executableOnly;
    executableCheckbox.addEventListener('change', () => {
      this.executableOnly = executableCheckbox.checked;
      saveBooleanPref(EXECUTABLE_ONLY_STORAGE_KEY, this.executableOnly);
      this.refreshResults(search.value);
    });
    const executableText = document.createElement('span');
    executableText.className = 'cmdp-executable-filter-text';
    executableText.textContent = 'executable only';
    executableLabel.appendChild(executableCheckbox);
    executableLabel.appendChild(executableText);
    filters.appendChild(executableLabel);

    const autoPauseLabel = document.createElement('label');
    autoPauseLabel.className = 'cmdp-autopause-filter';
    autoPauseLabel.title =
      'Automatically pause the video when the palette opens and resume on close.';
    const autoPauseCheckbox = document.createElement('input');
    autoPauseCheckbox.type = 'checkbox';
    autoPauseCheckbox.className = 'cmdp-autopause-checkbox';
    autoPauseCheckbox.checked = this.autoPause;
    autoPauseCheckbox.addEventListener('change', () => {
      this.autoPause = autoPauseCheckbox.checked;
      saveBooleanPref(AUTO_PAUSE_STORAGE_KEY, this.autoPause);
    });
    const autoPauseText = document.createElement('span');
    autoPauseText.className = 'cmdp-autopause-filter-text';
    autoPauseText.textContent = 'auto pause';
    autoPauseLabel.appendChild(autoPauseCheckbox);
    autoPauseLabel.appendChild(autoPauseText);
    filters.appendChild(autoPauseLabel);

    const optionsResetBtn = document.createElement('button');
    optionsResetBtn.type = 'button';
    optionsResetBtn.className = 'cmdp-reset-settings';
    optionsResetBtn.textContent = 'reset';
    optionsResetBtn.title = 'Reset options to defaults';
    optionsResetBtn.addEventListener('click', () => {
      this.essentialOnly = false;
      this.executableOnly = false;
      this.preserveOrder = false;
      this.autoPause = false;
      saveBooleanPref(ESSENTIAL_ONLY_STORAGE_KEY, false);
      saveBooleanPref(EXECUTABLE_ONLY_STORAGE_KEY, false);
      saveBooleanPref(AUTO_PAUSE_STORAGE_KEY, false);
      savePreserveOrder(false);
      essentialCheckbox.checked = false;
      executableCheckbox.checked = false;
      sortCheckbox.checked = false;
      autoPauseCheckbox.checked = false;
      this.refreshResults(search.value);
    });
    filters.appendChild(optionsResetBtn);

    palette.appendChild(filters);

    const categoryFilters = document.createElement('div');
    categoryFilters.className = 'cmdp-category-filters';

    const allCategories: string[] = [];
    const seenCategories = new Set<string>();
    for (const def of this.registry.getAll()) {
      if (!seenCategories.has(def.category)) {
        seenCategories.add(def.category);
        allCategories.push(def.category);
      }
    }

    const grouped = this.registry.getGrouped();
    const sectionEntries = [...grouped.entries()];

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.className = 'cmdp-tab-bar';

    // Tab panel (shows active tab's category pills)
    const tabPanel = document.createElement('div');
    tabPanel.className = 'cmdp-tab-panel';

    const tabs: HTMLElement[] = [];
    const panels: HTMLElement[] = [];
    let activeTabIdx = 0;
    try {
      const saved = localStorage.getItem(EXPANDED_SECTIONS_STORAGE_KEY);
      if (saved) {
        const idx = sectionEntries.findIndex(([name]) => name === saved);
        if (idx >= 0) activeTabIdx = idx;
      }
    } catch {
      // ignore
    }

    const updateTabCount = (tab: HTMLElement, sectionCats: string[]): void => {
      const enabled = sectionCats.filter((c) => !this.disabledCategories.has(c)).length;
      const badge = tab.querySelector('.cmdp-tab-count');
      if (badge) badge.textContent = `${enabled}/${sectionCats.length}`;
    };

    sectionEntries.forEach(([sectionName, categories], idx) => {
      const sectionCats = [...categories.keys()];

      // Tab button
      const tab = document.createElement('div');
      tab.className = 'cmdp-tab';
      if (idx === activeTabIdx) tab.classList.add('cmdp-tab-active');
      tab.dataset.section = sectionName;

      const tabText = document.createElement('span');
      tabText.textContent = sectionName;
      tab.appendChild(tabText);

      const tabCount = document.createElement('span');
      tabCount.className = 'cmdp-tab-count';
      const enabled = sectionCats.filter((c) => !this.disabledCategories.has(c)).length;
      tabCount.textContent = `${enabled}/${sectionCats.length}`;
      tab.appendChild(tabCount);

      tabs.push(tab);
      tabBar.appendChild(tab);

      // Panel content
      const panel = document.createElement('div');
      panel.className = 'cmdp-tab-content';
      if (idx !== activeTabIdx) panel.style.display = 'none';

      for (const cat of sectionCats) {
        const pill = document.createElement('div');
        pill.className = 'cmdp-category-pill';
        pill.dataset.category = cat;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'cmdp-category-checkbox';
        checkbox.checked = !this.disabledCategories.has(cat);

        const text = document.createElement('span');
        text.textContent = CATEGORY_SHORT_LABELS[cat] ?? cat;

        const jumpBtn = document.createElement('button');
        jumpBtn.type = 'button';
        jumpBtn.className = 'cmdp-category-jump';
        jumpBtn.title = 'Jump to ' + (CATEGORY_SHORT_LABELS[cat] ?? cat);

        const soloBtn = document.createElement('button');
        soloBtn.type = 'button';
        soloBtn.className = 'cmdp-category-solo';
        soloBtn.title =
          'Solo — show only ' + (CATEGORY_SHORT_LABELS[cat] ?? cat) + '. Click again to unsolo.';

        pill.addEventListener('click', (e) => {
          if (jumpBtn.contains(e.target as Node)) return;
          if (soloBtn.contains(e.target as Node)) return;
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) {
            this.disabledCategories.delete(cat);
          } else {
            this.disabledCategories.add(cat);
          }
          saveDisabledCategories(this.disabledCategories);
          this.refreshResults(search.value);
          this.syncCategoryCheckboxes(categoryFilters);
        });

        jumpBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.disabledCategories.has(cat)) {
            this.disabledCategories.delete(cat);
            checkbox.checked = true;
            saveDisabledCategories(this.disabledCategories);
            this.refreshResults(search.value);
          }
          setTimeout(() => {
            if (!this.resultsEl) return;
            const anchor = this.resultsEl.querySelector<HTMLElement>(
              `.cmdp-category-anchor[data-category="${CSS.escape(cat)}"]`
            );
            if (anchor) {
              const sectionHeader = anchor.previousElementSibling?.classList.contains(
                'cmdp-section'
              )
                ? (anchor.previousElementSibling as HTMLElement)
                : this.resultsEl.querySelector<HTMLElement>('.cmdp-section');
              const stickyOffset = sectionHeader?.offsetHeight ?? 0;
              this.resultsEl.scrollTop = anchor.offsetTop - stickyOffset;
            }
            const header = this.resultsEl.querySelector<HTMLElement>(
              `.cmdp-category[data-category="${CSS.escape(cat)}"]`
            );
            if (header) {
              header.classList.remove('cmdp-flash');
              void header.offsetWidth;
              header.classList.add('cmdp-flash');
              let sibling = header.nextElementSibling;
              while (
                sibling &&
                !sibling.classList.contains('cmdp-category') &&
                !sibling.classList.contains('cmdp-category-anchor') &&
                !sibling.classList.contains('cmdp-section')
              ) {
                if (sibling.classList.contains('cmdp-item')) {
                  sibling.classList.remove('cmdp-flash');
                  void (sibling as HTMLElement).offsetWidth;
                  sibling.classList.add('cmdp-flash');
                }
                sibling = sibling.nextElementSibling;
              }
            }
          }, 0);
        });

        soloBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleSolo(cat);
        });

        const countSpan = document.createElement('span');
        countSpan.className = 'cmdp-pill-count';
        this.categoryPillCounts.set(cat, countSpan);

        pill.appendChild(jumpBtn);
        pill.appendChild(checkbox);
        pill.appendChild(text);
        pill.appendChild(countSpan);
        pill.appendChild(soloBtn);
        panel.appendChild(pill);
      }

      panels.push(panel);
      tabPanel.appendChild(panel);

      // Tab click: switch active tab
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('cmdp-tab-active'));
        panels.forEach((p) => (p.style.display = 'none'));
        tab.classList.add('cmdp-tab-active');
        panel.style.display = '';
        try {
          localStorage.setItem(EXPANDED_SECTIONS_STORAGE_KEY, sectionName);
        } catch {
          // ignore
        }
      });
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'cmdp-reset-settings';
    resetBtn.textContent = 'reset';
    resetBtn.title = 'Reset category filters to defaults';
    resetBtn.addEventListener('click', () => {
      this.disabledCategories.clear();
      saveDisabledCategories(this.disabledCategories);
      this.syncCategoryCheckboxes(categoryFilters);
      this.refreshResults(search.value);
    });
    tabBar.appendChild(resetBtn);

    categoryFilters.appendChild(tabBar);
    categoryFilters.appendChild(tabPanel);

    this.categoryFiltersEl = categoryFilters;
    this.allCategories = allCategories;
    this.updateTabCounts = () => {
      sectionEntries.forEach(([, categories], idx) => {
        updateTabCount(tabs[idx], [...categories.keys()]);
      });
    };
    palette.appendChild(categoryFilters);

    const results = document.createElement('div');
    results.className = 'cmdp-results';
    palette.appendChild(results);

    const footer = document.createElement('div');
    footer.className = 'cmdp-footer';
    const hints = document.createElement('div');
    hints.className = 'cmdp-footer-hints cmdp-help-text';
    hints.appendChild(makeFooterHint('\u2191\u2193', 'navigate'));
    hints.appendChild(makeFooterHint('\u21b5', 'execute'));
    hints.appendChild(makeFooterHint('esc', 'close'));
    footer.appendChild(hints);
    const footerLinks = document.createElement('div');
    footerLinks.className = 'cmdp-footer-links';
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
      footerLinks.appendChild(refLink);
    }
    const homeLink = document.createElement('a');
    homeLink.className = 'cmdp-footer-reference';
    homeLink.href = 'https://github.com/exwm/yt_clipper';
    homeLink.target = '_blank';
    homeLink.rel = 'noopener noreferrer';
    homeLink.title = 'yt_clipper on GitHub';
    homeLink.textContent = 'GitHub';
    footerLinks.appendChild(homeLink);
    footer.appendChild(footerLinks);
    palette.appendChild(footer);

    overlay.appendChild(palette);
    this.container.appendChild(overlay);

    this.overlay = overlay;
    this.searchInput = search;
    this.resultsEl = results;
    this.essentialFilterEl = essentialCheckbox;
    this.executableFilterEl = executableCheckbox;
    this.counterEl = counter;

    this.lastSearchesContainerEl = lastSearches;
    this.renderLastSearches();
  }

  private saveSearch(query: string): void {
    if (this.maxLastSearches === 0) return;
    const existingIdx = this.lastSearches.indexOf(query);
    if (existingIdx >= 0) this.lastSearches.splice(existingIdx, 1);
    this.lastSearches.unshift(query);
    if (this.lastSearches.length > this.maxLastSearches) {
      this.lastSearches.length = this.maxLastSearches;
    }
    saveLastSearches(this.lastSearches);
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
    const executableOnly = !!this.executableFilterEl?.checked;
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

    if (executableOnly) {
      candidates = candidates.filter((r) => r.shortcut.executable && !!r.shortcut.handler);
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
    const realItemCount = candidates.filter(
      (r) => !this.disabledCategories.has(r.shortcut.category)
    ).length;
    this.updateCounter(realItemCount);
    this.updateCategoryPillCounts(candidates);
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
        const sectionCategories = categoriesBySection.get(section);
        if (sectionCategories == null) throw new Error(`Missing section: ${section}`);
        sectionCategories.push(category);
        bucket = [];
        bucketByKey.set(key, bucket);
      }
      bucket.push(candidate);
    }

    for (const section of sectionOrder) {
      this.visibleEntries.push({ kind: 'section', label: section });
      const sectionCategories = categoriesBySection.get(section);
      if (sectionCategories == null) throw new Error(`Missing section: ${section}`);
      for (const category of sectionCategories) {
        const disabled = this.disabledCategories.has(category);
        this.visibleEntries.push({ kind: 'category', label: category, disabled });
        if (!disabled) {
          const bucket = bucketByKey.get(section + '\u0000' + category);
          if (bucket == null) throw new Error(`Missing bucket: ${section}/${category}`);
          for (const result of bucket) {
            this.pushItem(result);
          }
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
        const disabled = this.disabledCategories.has(category);
        this.visibleEntries.push({ kind: 'category', label: category, disabled });
        if (!disabled) {
          for (const result of items) {
            this.pushItem(result);
          }
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
    this.itemNumber = 0;
    while (this.resultsEl.firstChild) this.resultsEl.removeChild(this.resultsEl.firstChild);

    if (this.visibleEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdp-empty cmdp-help-text';
      empty.textContent = 'No shortcuts match your search.';
      this.resultsEl.appendChild(empty);
      return;
    }

    // Pre-compute item counts per section and category for display
    const sectionCounts = new Map<number, number>();
    const categoryCounts = new Map<number, number>();
    let lastSectionIdx = -1;
    let lastCategoryIdx = -1;
    for (let i = 0; i < this.visibleEntries.length; i++) {
      const e = this.visibleEntries[i];
      if (e.kind === 'section') lastSectionIdx = i;
      else if (e.kind === 'category') lastCategoryIdx = i;
      else if (e.kind === 'item') {
        if (lastSectionIdx >= 0)
          sectionCounts.set(lastSectionIdx, (sectionCounts.get(lastSectionIdx) ?? 0) + 1);
        if (lastCategoryIdx >= 0)
          categoryCounts.set(lastCategoryIdx, (categoryCounts.get(lastCategoryIdx) ?? 0) + 1);
      }
    }

    // Pre-compute total counts per section and category from full registry
    const totalBySection = new Map<string, number>();
    const totalByCategory = new Map<string, number>();
    for (const def of this.registry.getAll()) {
      totalBySection.set(def.section, (totalBySection.get(def.section) ?? 0) + 1);
      totalByCategory.set(def.category, (totalByCategory.get(def.category) ?? 0) + 1);
    }

    const resultsEl = this.resultsEl;
    let sectionNumber = 0;
    let categoryNumber = 0;

    this.visibleEntries.forEach((entry, idx) => {
      if (entry.kind === 'section') {
        categoryNumber = 0;
        const el = document.createElement('div');
        el.className = 'cmdp-section';
        const isRealSection = totalBySection.has(entry.label);
        if (isRealSection) {
          sectionNumber++;
          this.itemNumber = 0;
          const filtered = sectionCounts.get(idx) ?? 0;
          const total = totalBySection.get(entry.label) ?? 0;
          const countStr = filtered === total ? String(total) : `${filtered}/${total}`;
          el.textContent = `${toRoman(sectionNumber)}. ${entry.label}`;
          const countEl = document.createElement('span');
          countEl.className = 'cmdp-header-count';
          countEl.textContent = countStr;
          el.appendChild(countEl);
        } else {
          el.textContent = entry.label;
        }
        resultsEl.appendChild(el);
        return;
      }
      if (entry.kind === 'category') {
        categoryNumber++;
        const anchor = document.createElement('div');
        anchor.className = 'cmdp-category-anchor';
        anchor.dataset.category = entry.label;
        resultsEl.appendChild(anchor);
        const el = document.createElement('div');
        el.className = 'cmdp-category';
        el.dataset.category = entry.label;
        if (entry.disabled) el.classList.add('cmdp-category-disabled');
        const filtered = categoryCounts.get(idx) ?? 0;
        const total = totalByCategory.get(entry.label) ?? 0;
        const countStr = filtered === total ? String(total) : `${filtered}/${total}`;
        el.textContent = `${categoryNumber}. ${entry.label}`;
        const countEl = document.createElement('span');
        countEl.className = 'cmdp-header-count';
        countEl.textContent = entry.disabled ? `hidden \u2022 ${total}` : countStr;
        el.appendChild(countEl);
        const catToggle = document.createElement('input');
        catToggle.type = 'checkbox';
        catToggle.className = 'cmdp-category-header-toggle';
        catToggle.checked = !entry.disabled;
        catToggle.title = 'Toggle category visibility';
        catToggle.addEventListener('change', (e) => {
          e.stopPropagation();
          if (catToggle.checked) {
            this.disabledCategories.delete(entry.label);
          } else {
            this.disabledCategories.add(entry.label);
          }
          saveDisabledCategories(this.disabledCategories);
          if (this.categoryFiltersEl) this.syncCategoryCheckboxes(this.categoryFiltersEl);
          this.refreshResults(this.searchInput?.value ?? '');
        });
        el.appendChild(catToggle);
        const catSoloBtn = document.createElement('button');
        catSoloBtn.type = 'button';
        catSoloBtn.className = 'cmdp-category-solo cmdp-category-header-solo';
        catSoloBtn.title =
          'Solo — show only ' +
          (CATEGORY_SHORT_LABELS[entry.label] ?? entry.label) +
          '. Click again to unsolo.';
        catSoloBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleSolo(entry.label);
        });
        el.appendChild(catSoloBtn);
        resultsEl.appendChild(el);
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

      this.itemNumber++;
      const num = document.createElement('span');
      num.className = 'cmdp-item-num';
      num.textContent = String(this.itemNumber);
      item.appendChild(num);

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

      resultsEl.appendChild(item);
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
    if (entry?.kind !== 'item') return;
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

  private toggleSolo(category: string): void {
    const isSoloed =
      !this.disabledCategories.has(category) &&
      this.disabledCategories.size === this.allCategories.length - 1;
    this.disabledCategories.clear();
    if (!isSoloed) {
      for (const other of this.allCategories) {
        if (other !== category) this.disabledCategories.add(other);
      }
    }
    saveDisabledCategories(this.disabledCategories);
    if (this.categoryFiltersEl) this.syncCategoryCheckboxes(this.categoryFiltersEl);
    this.refreshResults(this.searchInput?.value ?? '');

    if (this.resultsEl) {
      if (!isSoloed) {
        const anchor = this.resultsEl.querySelector<HTMLElement>(
          `.cmdp-category-anchor[data-category="${CSS.escape(category)}"]`
        );
        if (anchor) {
          const sectionHeader = anchor.previousElementSibling?.classList.contains('cmdp-section')
            ? (anchor.previousElementSibling as HTMLElement)
            : this.resultsEl.querySelector<HTMLElement>('.cmdp-section');
          const stickyOffset = sectionHeader?.offsetHeight ?? 0;
          this.resultsEl.scrollTop = anchor.offsetTop - stickyOffset;
        }
      } else {
        this.resultsEl.scrollTop = 0;
      }
    }

    if (!isSoloed && this.resultsEl) {
      let pastFirstCategory = false;
      let inEnabledCategory = false;
      for (const el of this.resultsEl.children) {
        if (el.classList.contains('cmdp-category')) {
          pastFirstCategory = true;
          inEnabledCategory = !el.classList.contains('cmdp-category-disabled');
        }
        if (
          pastFirstCategory &&
          inEnabledCategory &&
          (el.classList.contains('cmdp-category') || el.classList.contains('cmdp-item'))
        ) {
          el.classList.remove('cmdp-flash');
          void (el as HTMLElement).offsetWidth;
          el.classList.add('cmdp-flash');
        }
      }
    }
  }

  private syncCategoryCheckboxes(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>('.cmdp-category-pill').forEach((pill) => {
      const cat = pill.dataset.category ?? '';
      const cb = pill.querySelector<HTMLInputElement>('.cmdp-category-checkbox');
      if (cb) cb.checked = !this.disabledCategories.has(cat);
    });
    if (this.updateTabCounts) this.updateTabCounts();
  }

  private updateCounter(filtered: number): void {
    if (!this.counterEl) return;
    const total = this.registry.getAll().length;
    this.counterEl.textContent = filtered === total ? String(total) : `${filtered}/${total}`;
  }

  private updateCategoryPillCounts(candidates: SearchResult[]): void {
    if (this.categoryPillCounts.size === 0) return;

    const filteredCounts = new Map<string, number>();
    for (const c of candidates) {
      const cat = c.shortcut.category;
      filteredCounts.set(cat, (filteredCounts.get(cat) ?? 0) + 1);
    }

    const totalCounts = new Map<string, number>();
    for (const def of this.registry.getAll()) {
      totalCounts.set(def.category, (totalCounts.get(def.category) ?? 0) + 1);
    }

    for (const [cat, el] of this.categoryPillCounts) {
      const filtered = filteredCounts.get(cat) ?? 0;
      const total = totalCounts.get(cat) ?? 0;
      el.textContent = filtered === total ? String(total) : `${filtered}/${total}`;
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

function toRoman(n: number): string {
  const numerals: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  for (const [value, symbol] of numerals) {
    while (n >= value) {
      result += symbol;
      n -= value;
    }
  }
  return result;
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

function appendDisplayKey(parent: HTMLElement, displayKey: string, query = ''): void {
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
  const origins: { partIdx: number; charIdx: number }[] = [];
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

function loadBooleanPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function saveBooleanPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch {
    // storage disabled or quota exceeded; silently skip
  }
}

function loadDisabledCategories(): Set<string> {
  try {
    const raw = localStorage.getItem(DISABLED_CATEGORIES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v !== ''));
  } catch {
    return new Set();
  }
}

function saveDisabledCategories(categories: Set<string>): void {
  try {
    localStorage.setItem(DISABLED_CATEGORIES_STORAGE_KEY, JSON.stringify([...categories]));
  } catch {
    // storage disabled or quota exceeded; silently skip
  }
}
