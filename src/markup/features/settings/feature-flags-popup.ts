import { html, render, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { toggleSettingsGearPopover } from '../../components/settings/settings-gear-button';
import {
  FEATURE_FLAG_NAMES,
  FeatureFlagName,
  featureFlags,
  getFeatureFlagDefinition,
  isFeatureFlagOverridden,
  resetFeatureFlags,
  setFeatureFlag,
} from '../../feature-flags';
import { gateHotkeys } from './settings-editor';

const POPOVER_ID = 'ytc-feature-flags-popover';
const ROWS_CLASS = 'ytc-feature-flags';

// Rows re-render after each change, so the changed flags stay marked.
function rerender(e: Event): void {
  const rows = (e.currentTarget as HTMLElement).closest<HTMLElement>(`.${ROWS_CLASS}`);
  if (rows) render(featureFlagRows(), rows);
}

function onFlagChange(name: FeatureFlagName) {
  return (e: Event): void => {
    const input = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
    setFeatureFlag(name, value as never);
    rerender(e);
  };
}

function flagControl(name: FeatureFlagName): TemplateResult {
  const definition = getFeatureFlagDefinition(name);
  const value = featureFlags[name];
  if (definition.options) {
    return html`<select @change=${onFlagChange(name)} ${ref(gateHotkeys)}>
      ${definition.options.map(
        (option) =>
          html`<option value=${String(option)} ?selected=${option === value}>
            ${String(option)}${option === definition.default ? ' (default)' : ''}
          </option>`
      )}
    </select>`;
  }
  return html`<input
    type="checkbox"
    .checked=${Boolean(value)}
    @change=${onFlagChange(name)}
    ${ref(gateHotkeys)}
  />`;
}

function featureFlagRow(name: FeatureFlagName): TemplateResult {
  const definition = getFeatureFlagDefinition(name);
  const changed = isFeatureFlagOverridden(name) ? ' changed' : '';
  return html`<label class=${`ytc-feature-flag${changed}`} title=${definition.description}>
    <span>${name}${definition.appliesOnReload ? ' (after a reload)' : ''}</span>
    ${flagControl(name)}
  </label>`;
}

function featureFlagRows(): TemplateResult {
  const names = FEATURE_FLAG_NAMES.filter((name) => !getFeatureFlagDefinition(name).hidden);
  return html`${names.map(featureFlagRow)}
    <button
      type="button"
      class="settings-toggle ytc-feature-flags-reset"
      @click=${(e: Event) => {
        resetFeatureFlags();
        rerender(e);
      }}
    >
      Reset all
    </button>`;
}

/** Opens or closes the feature flags popup under `button`. Changes are kept in this browser. */
export function toggleFeatureFlagsPopup(button: HTMLElement): void {
  toggleSettingsGearPopover(
    button,
    POPOVER_ID,
    'Feature Flags (local build)',
    html`<div
      class=${ROWS_CLASS}
      ${ref((el) => {
        if (el instanceof HTMLElement) render(featureFlagRows(), el);
      })}
    ></div>`,
    undefined
  );
}
