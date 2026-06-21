import { html, nothing, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { styleMap, StyleInfo } from 'lit-html/directives/style-map.js';
import { gateHotkeys } from '../../features/settings/settings-editor';

// The native number stepper ignores the placeholder: stepping an empty input starts from the browser
// default, not the (often dynamic) default shown as the placeholder. Copy a numeric placeholder into
// the value so the up/down arrows nudge from it. Returns the seeded string, or null if not seeded.
// Number('') is 0, so an absent placeholder must be excluded explicitly.
function seedNumberInputFromPlaceholder(input: HTMLInputElement): string | null {
  if (input.value !== '' || input.placeholder === '') return null;
  const placeholderValue = Number(input.placeholder);
  if (!Number.isFinite(placeholderValue)) return null;
  input.value = String(placeholderValue);
  return input.value;
}

function onStepKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    seedNumberInputFromPlaceholder(e.currentTarget as HTMLInputElement);
  }
}

function onStepPointerdown(e: PointerEvent): void {
  const input = e.currentTarget as HTMLInputElement;
  const seeded = seedNumberInputFromPlaceholder(input);
  if (seeded == null) return;
  // Only a spinner click steps the value; a plain focus click (to type a value) does not. If nothing
  // stepped by the next frame, clear the seed so typing starts empty. Both writes land before paint,
  // so an idle click shows no flicker.
  requestAnimationFrame(() => {
    if (input.value === seeded) input.value = '';
  });
}

export interface NumberInputRowProps {
  id: string;
  label: string;
  labelId?: string;
  value: number | string | null | undefined;
  tooltip?: string;
  min?: number;
  max?: number | string;
  step?: number | string;
  placeholder?: string;
  styleInfo?: Readonly<StyleInfo>;
  required?: boolean;
  compact?: boolean;
  onChange?: (e: Event) => void;
}

export function NumberInputRow(p: NumberInputRowProps): TemplateResult {
  const wrapperClass = p.compact ? nothing : 'settings-editor-input-div';
  return html`
    <div class=${wrapperClass} title=${p.tooltip ?? nothing}>
      <span id=${p.labelId ?? nothing}>${p.label}</span>
      <input
        id=${p.id}
        type="number"
        min=${p.min ?? nothing}
        max=${p.max ?? nothing}
        step=${p.step ?? nothing}
        placeholder=${p.placeholder ?? nothing}
        style=${p.styleInfo ? styleMap(p.styleInfo) : nothing}
        ?required=${p.required ?? false}
        .value=${p.value ?? ''}
        @change=${p.onChange ?? nothing}
        @keydown=${onStepKeydown}
        @pointerdown=${onStepPointerdown}
        ${ref(gateHotkeys)}
      />
    </div>
  `;
}
