export const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

export const lightgrey = (opacity: number) => `rgba(120, 120, 120, ${opacity})`;
export const medgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
export const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

// Crop chart section base colors (RGB), from yt_clipper's accent palette: rose (pan), amber (zoom),
// purple (pan+zoom). cropSectionColor lerps from grey toward these by speed and sets the opacity, so a
// slow section looks grey and faint, fading into the "no movement" line.
export const cropSectionStaticRgb: readonly [number, number, number] = [120, 120, 120];
export const cropSectionPanRgb: readonly [number, number, number] = [214, 80, 160];
export const cropSectionZoomRgb: readonly [number, number, number] = [245, 166, 35];
export const cropSectionPanZoomRgb: readonly [number, number, number] = [160, 0, 255];

export const cubicInOutTension = 0.6;

function getRounder(multiple: number, precision: number) {
  return (value: number) => {
    const roundedValue = Math.round(value / multiple) * multiple;
    return +roundedValue.toFixed(precision);
  };
}

export const roundX = getRounder(0.01, 2);
export const roundY = getRounder(0.05, 2);

export function getInputUpdater(inputId) {
  return function (newValue?: string | number) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    if (input) {
      if (newValue != null) {
        input.value = newValue.toString();
      }
    } else {
      console.log(`Input with Id ${inputId} not found.`);
    }
  };
}
