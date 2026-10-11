// How a marker pair looks on a timeline. Shared by the real progress bar (markers.ts) and the
// timeline zoom, so both draw pairs the same way and any difference between them is deliberate.

export type MarkerKind = 'start' | 'end';

export const MARKER_WIDTH_PX = 1;
export const MARKER_HEIGHT_PX = 14;

// The selected pair's black tick inside each of its marker lines (selected-marker-overlay).
export const SELECTED_TICK_Y_PX = 3.5;
export const SELECTED_TICK_HEIGHT_PX = 8;

// Baseline of a marker number inside its numbering lane on the real bar.
export const MARKER_NUMBER_BASELINE_PX = 11.5;

/** Class list of a marker line: its kind's colour, plus the selected-pair styling. */
export function markerClassName(kind: MarkerKind, isSelected = false): string {
  return `marker ${kind}-marker${isSelected ? ' selected-marker' : ''}`;
}

/** Class list of a marker number: its kind's colour, plus the selected-pair styling. */
export function markerNumberClassName(kind: MarkerKind, isSelected = false): string {
  return `markerNumbering ${kind}MarkerNumbering${isSelected ? ' selectedMarkerNumbering' : ''}`;
}
