// Pure rules for the crop chart point labels, so they unit-test in node like crop-section.ts. The
// chart spec (cropChartSpec.ts) passes in the points and the pair's zoom/pan mode.

interface LabeledCropPoint {
  crop: string;
}

function getCropSize(cropString: string): string {
  const [, , w, h] = cropString.split(':');
  return `${w}:${h}`;
}

function getCropPosition(cropString: string): string {
  const [x, y] = cropString.split(':');
  return `${x}:${y}`;
}

// True when the point's crop, read through extractField, matches every existing neighbor: a hold
// with no visible change here.
function matchesEveryNeighbor(
  points: readonly LabeledCropPoint[],
  index: number,
  extractField: (cropString: string) => string
): boolean {
  const value = extractField(points[index].crop);
  const neighbors = [points[index - 1], points[index + 1]].filter((point) => point != null);
  return neighbors.length > 0 && neighbors.every((point) => extractField(point.crop) === value);
}

function shouldShowSize(
  points: readonly LabeledCropPoint[],
  index: number,
  enableZoomPan: boolean | undefined
): boolean {
  if (enableZoomPan === undefined) return false;
  if (!enableZoomPan) return index === 0;
  return !matchesEveryNeighbor(points, index, getCropSize);
}

/**
 * The position/size label of the point at `index`. Position shows unless it holds from every
 * neighbor. Size shows once, at the first point, in pan-only mode (one size for the whole clip), and
 * at each zoom change in zoom/pan mode. `enableZoomPan` is undefined when no pair is selected, which
 * hides the size. A hidden line is padded blank rather than dropped, since Chart.js positions a
 * multi-line label as one block: dropping a line would shift the other one.
 */
export function getCropPointMainLabel(
  points: readonly LabeledCropPoint[],
  index: number,
  enableZoomPan: boolean | undefined
): string {
  const showPosition = !matchesEveryNeighbor(points, index, getCropPosition);
  const showSize = shouldShowSize(points, index, enableZoomPan);
  if (!showPosition && !showSize) return '';
  const [x, y, w, h] = points[index].crop.split(':');
  const positionLine = showPosition ? `${x}:${y}` : ' ';
  const sizeLine = showSize ? `${w}x${h}` : ' ';
  return `${positionLine}\n${sizeLine}`;
}
