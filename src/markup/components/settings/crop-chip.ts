import { html, nothing, TemplateResult } from 'lit-html';
import { renderToggleIcon } from '../../features/icons/glyphs';

export interface CropChipProps {
  // id for the value span, so the carried crop can be updated live without re-rendering the chip.
  valueId?: string;
  crop: string;
  tooltip?: string;
  onCopy: () => void;
}

// A lone copy button beside the crop label: the label row has no room for the full crop string, so
// the value span is hidden and doubles as the copy source. On hover, CSS shows that same span as a
// custom tooltip bubble (with the data-tooltip hint below the value), so the tooltip updates live as
// the value updates. A native title cannot do this: browsers snapshot it once and Chromium resets
// the pending tooltip whenever the attribute changes, so per-frame updates keep it from ever showing.
export function CropChip(p: CropChipProps): TemplateResult {
  // Copy, then swap the icon to a green checkmark briefly (the standard copied cue).
  const onClick = (e: Event) => {
    p.onCopy();
    const btn = e.currentTarget as HTMLElement;
    btn.classList.add('crop-chip-copied');
    setTimeout(() => btn.classList.remove('crop-chip-copied'), 1500);
  };
  return html`
    <span class="crop-chip">
      <span class="crop-chip-value" id=${p.valueId ?? nothing} data-tooltip=${p.tooltip ?? nothing}
        >${p.crop}</span
      >
      <button type="button" class="crop-chip-copy" aria-label="Copy crop" @click=${onClick}>
        <span class="crop-chip-icon-copy">${renderToggleIcon('copy', 13)}</span>
        <span class="crop-chip-icon-check">${renderToggleIcon('check', 13)}</span>
      </button>
    </span>
  `;
}
