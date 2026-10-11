import { markerClassName, markerNumberClassName } from './marker-appearance';

describe('marker class names', () => {
  it.each([
    ['start', false, 'marker start-marker', 'markerNumbering startMarkerNumbering'],
    ['end', false, 'marker end-marker', 'markerNumbering endMarkerNumbering'],
    [
      'end',
      true,
      'marker end-marker selected-marker',
      'markerNumbering endMarkerNumbering selectedMarkerNumbering',
    ],
  ] as const)('%s marker (selected: %s)', (kind, isSelected, line, number) => {
    expect(markerClassName(kind, isSelected)).toBe(line);
    expect(markerNumberClassName(kind, isSelected)).toBe(number);
  });
});
