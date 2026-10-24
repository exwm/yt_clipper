/** The sizes to shrink a frame through, halving each time, until it is at most twice the size it
 *  will be drawn at. `scaleDown` is frame pixels per drawn pixel. Each step averages 2x2 pixels, while
 *  a single draw from a large frame samples only a few of its pixels per drawn pixel, which shimmers
 *  on fine detail. */
export function halvingSteps(
  width: number,
  height: number,
  scaleDown: number
): { width: number; height: number }[] {
  const steps: { width: number; height: number }[] = [];
  for (; scaleDown > 2; scaleDown /= 2) {
    width = Math.max(1, Math.round(width / 2));
    height = Math.max(1, Math.round(height / 2));
    steps.push({ width, height });
  }
  return steps;
}
