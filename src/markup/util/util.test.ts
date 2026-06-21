import { getEasedValue } from './util';

const linear = (t: number) => t;
const instant = (t: number) => (t >= 1 ? 1 : 0);

describe('getEasedValue', () => {
  it('interpolates within the section', () => {
    expect(getEasedValue(linear, 0, 100, 0, 10, 5)).toBe(50);
  });

  it('returns the start value at the section start', () => {
    expect(getEasedValue(linear, 0, 100, 0, 10, 0)).toBe(0);
  });

  it('returns the end value at the section end', () => {
    expect(getEasedValue(linear, 0, 100, 0, 10, 10)).toBe(100);
  });

  it('clamps the eased percentage to 1 past the end', () => {
    // Mirrors the clipper's clip(...,0,1). The frame-adjusted end is before the real keyframe, so
    // the playhead can sit past it; without clamping a d3 ease dips back below the target there.
    expect(getEasedValue(linear, 0, 100, 0, 10, 12)).toBe(100);
  });

  it('clamps the eased percentage to 0 before the start', () => {
    expect(getEasedValue(linear, 0, 100, 0, 10, -2)).toBe(0);
  });

  it('instant ease holds the start value until the end', () => {
    expect(getEasedValue(instant, 0, 100, 0, 10, 9.9)).toBe(0);
    expect(getEasedValue(instant, 0, 100, 0, 10, 10)).toBe(100);
  });
});
