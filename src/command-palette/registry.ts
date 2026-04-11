import fuzzysort from 'fuzzysort';
import { KeyModifiers, MatchKind, SearchResult, ShortcutDefinition } from './types';

export class ShortcutRegistry {
  private shortcuts: ShortcutDefinition[] = [];
  private byId = new Map<string, ShortcutDefinition>();

  register(def: ShortcutDefinition): void {
    if (this.byId.has(def.id)) {
      throw new Error(`ShortcutRegistry: duplicate id "${def.id}"`);
    }
    (def as any)._prepared = fuzzysort.prepare(def.description);
    this.byId.set(def.id, def);
    this.shortcuts.push(def);
  }

  registerAll(defs: ShortcutDefinition[]): void {
    for (const def of defs) this.register(def);
  }

  unregister(id: string): void {
    const def = this.byId.get(id);
    if (!def) return;
    this.byId.delete(id);
    const idx = this.shortcuts.indexOf(def);
    if (idx >= 0) this.shortcuts.splice(idx, 1);
  }

  getAll(): ShortcutDefinition[] {
    return this.shortcuts.slice();
  }

  getById(id: string): ShortcutDefinition | undefined {
    return this.byId.get(id);
  }

  getGrouped(): Map<string, Map<string, ShortcutDefinition[]>> {
    const result = new Map<string, Map<string, ShortcutDefinition[]>>();
    for (const def of this.shortcuts) {
      let byCategory = result.get(def.section);
      if (!byCategory) {
        byCategory = new Map<string, ShortcutDefinition[]>();
        result.set(def.section, byCategory);
      }
      let bucket = byCategory.get(def.category);
      if (!bucket) {
        bucket = [];
        byCategory.set(def.category, bucket);
      }
      bucket.push(def);
    }
    return result;
  }

  getByBinding(code: string, modifiers: KeyModifiers): ShortcutDefinition[] {
    const matches: ShortcutDefinition[] = [];
    for (const def of this.shortcuts) {
      if (!def.binding) continue;
      if (def.binding.code !== code) continue;
      if (!modifiersMatch(def.binding.modifiers, modifiers)) continue;
      matches.push(def);
    }
    return matches;
  }

  search(query: string): SearchResult[] {
    const trimmed = query.trim();
    if (trimmed === '') {
      return this.shortcuts.map((shortcut) => ({
        shortcut,
        score: 0,
        highlightRanges: [],
      }));
    }

    const normalizedQuery = normalizeDisplayKey(trimmed);
    const seen = new Set<string>();
    const matches: SearchResult[] = [];

    if (normalizedQuery !== '') {
      const exactKeyMatches: SearchResult[] = [];
      const partialKeyMatches: SearchResult[] = [];
      for (const shortcut of this.shortcuts) {
        if (!shortcut.displayKey) continue;
        const parts = splitDisplayKeyAlternatives(shortcut.displayKey);
        let kind: MatchKind | null = null;
        for (const part of parts) {
          const normalizedPart = normalizeDisplayKey(part);
          if (normalizedPart === '') continue;
          if (normalizedPart === normalizedQuery) {
            kind = 'exactKey';
            break;
          }
          if (kind == null && normalizedPart.includes(normalizedQuery)) {
            kind = 'partialKey';
          }
        }
        if (kind === 'exactKey') {
          exactKeyMatches.push({ shortcut, score: 0, highlightRanges: [], matchKind: 'exactKey' });
          seen.add(shortcut.id);
        } else if (kind === 'partialKey') {
          partialKeyMatches.push({
            shortcut,
            score: 0,
            highlightRanges: [],
            matchKind: 'partialKey',
          });
          seen.add(shortcut.id);
        }
      }
      matches.push(...exactKeyMatches, ...partialKeyMatches);
    }

    const fuzzy = fuzzysort.go(trimmed, this.shortcuts, {
      key: '_prepared',
      limit: 100,
    });
    for (const r of fuzzy) {
      if (seen.has(r.obj.id)) continue;
      matches.push({
        shortcut: r.obj,
        score: r.score,
        highlightRanges: r.indexes.slice(),
        matchKind: 'fuzzy',
      });
      seen.add(r.obj.id);
    }
    return matches;
  }
}

function normalizeDisplayKey(s: string): string {
  return s.toLowerCase().replace(/[\s+]/g, '');
}

function splitDisplayKeyAlternatives(displayKey: string): string[] {
  return displayKey.split(/\s*\/\s*|\s+or\s+/i);
}

function modifiersMatch(binding: KeyModifiers, event: KeyModifiers): boolean {
  if (binding.ctrl !== undefined && binding.ctrl !== !!event.ctrl) return false;
  if (binding.shift !== undefined && binding.shift !== !!event.shift) return false;
  if (binding.alt !== undefined && binding.alt !== !!event.alt) return false;
  return true;
}
