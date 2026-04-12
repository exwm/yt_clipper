export const paletteCss = `
.cmdp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  opacity: 90%;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --cmdp-accent: var(--bright-red, rgb(237, 28, 63));
  --cmdp-bg: #222;
  --cmdp-bg-alt: #2c2c2c;
  --cmdp-bg-highlight: #3a3a3a;
  --cmdp-fg: #ddd;
  --cmdp-fg-dim: #888;
  --cmdp-border: #666;
}

.cmdp-palette {
  width: min(871px, 95vw);
  max-height: 72vh;
  background: var(--cmdp-bg);
  color: var(--cmdp-fg);
  border: 2px solid var(--cmdp-accent);
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cmdp-search-row {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--cmdp-border);
  gap: 10px;
}

.cmdp-search {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--cmdp-fg);
  font-size: 16px;
  font-weight: 500;
}

.cmdp-search::placeholder {
  color: var(--cmdp-fg-dim);
}

.cmdp-search-clear {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--cmdp-border);
  border-radius: 50%;
  color: var(--cmdp-fg-dim);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}

.cmdp-search-clear:hover {
  color: #fff;
  border-color: var(--cmdp-accent);
  background: rgba(237, 28, 63, 0.15);
}

.cmdp-help-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

.cmdp-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--cmdp-border);
  background: rgba(0, 0, 0, 0.25);
  font-size: 12px;
  color: var(--cmdp-fg-dim);
}

.cmdp-essential-filter,
.cmdp-sort-filter,
.cmdp-executable-filter,
.cmdp-autopause-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 10px;
  border: 1px solid var(--cmdp-border);
  border-radius: 999px;
  background: var(--cmdp-bg-alt);
  color: var(--cmdp-fg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.cmdp-essential-filter::before,
.cmdp-sort-filter::before,
.cmdp-executable-filter::before,
.cmdp-autopause-filter::before {
  color: var(--cmdp-fg-dim);
  font-size: 15px;
  line-height: 1;
  transition: color 0.12s, text-shadow 0.12s;
}

.cmdp-essential-filter::before { content: '\u2605'; }
.cmdp-sort-filter::before { content: '\u21C5'; }
.cmdp-executable-filter::before { content: '\u25B6'; }
.cmdp-autopause-filter::before { content: '\u23F8'; }

.cmdp-essential-filter:hover,
.cmdp-sort-filter:hover,
.cmdp-executable-filter:hover,
.cmdp-autopause-filter:hover {
  border-color: var(--cmdp-accent);
  color: #fff;
}

.cmdp-essential-filter:hover::before,
.cmdp-sort-filter:hover::before,
.cmdp-executable-filter:hover::before,
.cmdp-autopause-filter:hover::before {
  color: var(--cmdp-accent);
}

.cmdp-essential-filter:has(.cmdp-essential-checkbox:checked),
.cmdp-sort-filter:has(.cmdp-sort-checkbox:checked),
.cmdp-executable-filter:has(.cmdp-executable-checkbox:checked),
.cmdp-autopause-filter:has(.cmdp-autopause-checkbox:checked) {
  background: linear-gradient(to right, rgba(237, 28, 63, 0.25), var(--cmdp-bg-alt) 85%);
  border-color: var(--cmdp-accent);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(237, 28, 63, 0.35);
}

.cmdp-essential-filter:has(.cmdp-essential-checkbox:checked)::before,
.cmdp-sort-filter:has(.cmdp-sort-checkbox:checked)::before,
.cmdp-executable-filter:has(.cmdp-executable-checkbox:checked)::before,
.cmdp-autopause-filter:has(.cmdp-autopause-checkbox:checked)::before {
  color: var(--cmdp-accent);
  text-shadow: 0 0 6px rgba(237, 28, 63, 0.6);
}

.cmdp-essential-checkbox,
.cmdp-sort-checkbox,
.cmdp-executable-checkbox,
.cmdp-autopause-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--cmdp-border);
  border-radius: 2px;
  background: var(--cmdp-bg);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.cmdp-essential-checkbox:checked,
.cmdp-sort-checkbox:checked,
.cmdp-executable-checkbox:checked,
.cmdp-autopause-checkbox:checked {
  background: var(--cmdp-accent);
  border-color: var(--cmdp-accent);
}

.cmdp-essential-checkbox:checked::after,
.cmdp-sort-checkbox:checked::after,
.cmdp-executable-checkbox:checked::after,
.cmdp-autopause-checkbox:checked::after {
  content: '\u2713';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
}

.cmdp-last-searches-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--cmdp-border);
  background: rgba(0, 0, 0, 0.25);
}

.cmdp-last-searches-row:not(:has(.cmdp-last-search-pill)) {
  display: none;
}

.cmdp-last-searches {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.cmdp-last-search-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 2px 10px;
  font-family: inherit;
  font-size: 12px;
  color: var(--cmdp-fg);
  background: var(--cmdp-bg-alt);
  border: 1px solid var(--cmdp-border);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.cmdp-last-search-pill::before {
  content: '\u21BA';
  color: var(--cmdp-fg-dim);
  font-size: 12px;
}

.cmdp-last-search-pill:hover {
  background: var(--cmdp-bg-highlight);
  border-color: var(--cmdp-accent);
  color: #fff;
}

.cmdp-last-search-pill:hover::before {
  color: var(--cmdp-accent);
}

.cmdp-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  position: relative;
}

.cmdp-category-anchor {
  height: 0;
  overflow: hidden;
}

.cmdp-section {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #fff;
  margin: 12px 6px 6px;
  padding: 6px 14px;
  background: linear-gradient(135deg, var(--cmdp-accent), rgb(140, 10, 35));
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  position: sticky;
  top: 0;
  z-index: 2;
}

.cmdp-category {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #ff8a9e;
  margin: 0;
  padding: 6px 14px 4px 20px;
  background: linear-gradient(to right, rgba(255, 138, 158, 0.1), var(--cmdp-bg) 70%), var(--cmdp-bg);
  border-bottom: 1px solid rgba(255, 138, 158, 0.15);
  border-left: 3px solid rgba(255, 138, 158, 0.4);
  position: sticky;
  top: 33px;
  z-index: 1;
}

.cmdp-category-header-toggle {
  margin-left: 8px;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: var(--cmdp-accent);
}

.cmdp-category-header-solo {
  margin-left: 4px;
  flex-shrink: 0;
}

.cmdp-category.cmdp-category-disabled {
  color: rgba(255, 138, 158, 0.35);
  background: var(--cmdp-bg);
  border-left-color: transparent;
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

.cmdp-category.cmdp-category-disabled .cmdp-header-count {
  color: var(--cmdp-fg-dim);
  opacity: 1;
}

.cmdp-item {
  display: grid;
  grid-template-columns: 24px 1fr auto 26px;
  align-items: center;
  margin-left: 16px;
  padding: 8px 14px 8px 12px;
  cursor: default;
  gap: 12px;
  transition: background 0.08s;
  background: rgba(255, 255, 255, 0.02);
  border-left: 3px solid rgba(255, 138, 158, 0.12);
}

.cmdp-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.cmdp-item.cmdp-highlighted {
  background: linear-gradient(to right, rgba(237, 28, 63, 0.3), var(--cmdp-bg-highlight) 80%);
  box-shadow: inset 4px 0 0 var(--cmdp-accent), inset 0 0 0 1px rgba(237, 28, 63, 0.45);
  color: #fff;
}

.cmdp-item.cmdp-highlighted .cmdp-item-desc {
  color: #fff;
  font-weight: 600;
}

.cmdp-item.cmdp-non-executable {
  opacity: 0.7;
}

.cmdp-item.cmdp-non-executable:hover {
  opacity: 0.9;
}

.cmdp-item.cmdp-essential {
  background: linear-gradient(to right, rgba(237, 28, 63, 0.12), transparent 60%);
}

.cmdp-item.cmdp-key-match-exact .cmdp-item-keys kbd,
.cmdp-item.cmdp-key-match-partial .cmdp-item-keys kbd {
  border-color: var(--cmdp-accent);
  box-shadow: 0 0 0 1px rgba(237, 28, 63, 0.45);
}

.cmdp-item.cmdp-key-match-exact .cmdp-item-keys kbd {
  background-color: #fff;
  color: #111;
}

.cmdp-item.cmdp-essential.cmdp-highlighted {
  background: linear-gradient(to right, rgba(237, 28, 63, 0.38), var(--cmdp-bg-highlight) 80%);
}

.cmdp-item.cmdp-essential .cmdp-item-desc {
  color: #fff;
  font-weight: 600;
}

.cmdp-item .cmdp-item-desc::before {
  content: '\u2605';
  margin-right: 6px;
  font-size: 12px;
  visibility: hidden;
}

.cmdp-item.cmdp-essential .cmdp-item-desc::before {
  visibility: visible;
  color: var(--cmdp-accent);
}

.cmdp-item.cmdp-essential kbd {
  background-color: #fff;
  color: #111;
}

.cmdp-item-desc {
  font-size: 13px;
  line-height: 1.35;
  min-width: 0;
}

.cmdp-item-desc mark {
  background: transparent;
  color: var(--cmdp-accent);
  font-weight: 700;
}

.cmdp-item-keys {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  justify-self: end;
}

.cmdp-item-run {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--cmdp-border);
  border-radius: 50%;
  color: var(--cmdp-fg-dim);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  padding-left: 2px;
  transition: background 0.12s, color 0.12s, border-color 0.12s, transform 0.12s;
}

.cmdp-item-run:hover:not(:disabled),
.cmdp-item.cmdp-highlighted .cmdp-item-run:not(:disabled) {
  background: var(--cmdp-accent);
  border-color: var(--cmdp-accent);
  color: #fff;
  transform: scale(1.08);
}

.cmdp-item-run:disabled {
  cursor: default;
  opacity: 0.35;
  background: transparent;
  border-color: var(--cmdp-border);
  color: var(--cmdp-fg-dim);
  transform: none;
}

.cmdp-item-run:focus {
  outline: none;
}

.cmdp-item kbd {
  border: 1px solid #999;
  border-radius: 2px;
  font-weight: bold;
  padding: 2px 4px;
  margin: 1px;
  background-color: #e0e0e0;
  color: #333;
  font-family: inherit;
  font-size: 11px;
}

.cmdp-item kbd mark {
  background: transparent;
  color: var(--cmdp-accent);
}

.cmdp-empty {
  padding: 20px 14px;
  text-align: center;
}

.cmdp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 14px;
  border-top: 1px solid var(--cmdp-border);
}

.cmdp-footer-hints {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.cmdp-footer kbd {
  padding: 1px 3px;
  font-size: 10px;
}

.cmdp-footer-links {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cmdp-footer-reference {
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--cmdp-fg-dim);
  background: transparent;
  border: 1px solid var(--cmdp-border);
  border-radius: 999px;
  padding: 2px 10px;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}

.cmdp-footer-reference:hover {
  color: #fff;
  border-color: var(--cmdp-accent);
  background: rgba(237, 28, 63, 0.15);
}

.cmdp-non-executable-badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--cmdp-fg-dim);
  border: 1px solid var(--cmdp-border);
  border-radius: 2px;
  padding: 1px 4px;
}

.cmdp-counter {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--cmdp-fg-dim);
  white-space: nowrap;
}

.cmdp-item-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--cmdp-accent);
  text-align: right;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.cmdp-category-filters {
  border-bottom: 1px solid var(--cmdp-border);
  background: rgba(0, 0, 0, 0.15);
}

.cmdp-tab-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding-right: 14px;
  border-bottom: 1px solid var(--cmdp-border);
}

.cmdp-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--cmdp-fg-dim);
  cursor: pointer;
  user-select: none;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}

.cmdp-tab:hover {
  color: var(--cmdp-fg);
  background: rgba(255, 255, 255, 0.04);
}

.cmdp-tab.cmdp-tab-active {
  color: #fff;
  border-bottom-color: var(--cmdp-accent);
  background: rgba(237, 28, 63, 0.08);
}

.cmdp-tab-count {
  font-size: 9px;
  font-weight: 700;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.cmdp-tab.cmdp-tab-active .cmdp-tab-count {
  opacity: 0.9;
  color: var(--cmdp-accent);
}

.cmdp-tab-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
}

.cmdp-tab-content {
  display: contents;
}

.cmdp-category-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 4px;
  border: 1px solid var(--cmdp-border);
  border-radius: 999px;
  background: var(--cmdp-bg-alt);
  color: var(--cmdp-fg-dim);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s;
}

.cmdp-category-pill:hover {
  border-color: var(--cmdp-accent);
  color: var(--cmdp-fg);
}

.cmdp-category-pill:has(.cmdp-category-checkbox:checked) {
  background: linear-gradient(to right, rgba(237, 28, 63, 0.2), var(--cmdp-bg-alt) 85%);
  border-color: var(--cmdp-accent);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(237, 28, 63, 0.3);
}

.cmdp-category-checkbox {
  display: none;
}

.cmdp-category-jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  font-size: 0;
  font-family: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--cmdp-border);
  border-radius: 50%;
  color: inherit;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s;
  line-height: 1;
  flex-shrink: 0;
}

.cmdp-category-jump::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid currentColor;
  margin-top: 1px;
}

.cmdp-category-jump:hover {
  background: var(--cmdp-accent);
  border-color: var(--cmdp-accent);
  color: #fff;
  transform: scale(1.1);
  box-shadow: 0 0 6px rgba(237, 28, 63, 0.5);
}

.cmdp-category-solo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  font-family: inherit;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: -0.5px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--cmdp-border);
  border-radius: 50%;
  color: var(--cmdp-fg-dim);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s, box-shadow 0.12s;
  line-height: 1;
}

.cmdp-category-solo::after {
  content: 'S';
  font-size: 9px;
  font-weight: 800;
}

.cmdp-category-solo:hover {
  background: #d4a017;
  border-color: #d4a017;
  color: #000;
  transform: scale(1.1);
  box-shadow: 0 0 6px rgba(212, 160, 23, 0.5);
}

.cmdp-header-count {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  opacity: 0.7;
  letter-spacing: 0;
  text-transform: none;
}

.cmdp-section .cmdp-header-count {
  font-size: 11px;
}

.cmdp-pill-count {
  font-size: 9px;
  font-weight: 700;
  opacity: 0.6;
  min-width: 12px;
  text-align: center;
}

.cmdp-region-label {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  width: 62px;
  flex-shrink: 0;
}

@keyframes cmdp-flash {
  0% { box-shadow: inset 0 0 0 200px rgba(212, 160, 23, 0.3); }
  100% { box-shadow: inset 0 0 0 200px transparent; }
}

.cmdp-flash {
  animation: cmdp-flash 0.6s ease-out;
}

.cmdp-reset-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  align-self: center;
  padding: 2px 10px;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  color: var(--cmdp-fg);
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}

.cmdp-reset-settings:hover {
  color: #fff;
  border-color: var(--cmdp-accent);
  background: rgba(237, 28, 63, 0.15);
}
`;
