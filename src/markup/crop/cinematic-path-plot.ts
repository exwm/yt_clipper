import { CropPath, CropPoint } from '../@types/yt_clipper';
import {
  CinematicMargins,
  CinematicRunTarget,
  cinematicRunTarget,
  evalCropPathAtTime,
  firmHeldSpans,
  firmHoldAllowance,
  heldSpans,
  parseCropToComponents,
  splitAtInstantCuts,
} from './cinematic-path';
import {
  cropInterpolationSectionAtTime,
  EasingCropPoint,
  getSectionEasedCropComponents,
} from './crop-keyframe-math';

// The crop center's two axes, and the zoom: the widest crop the frame fits at the crop's aspect ratio
// over the crop's width, so 1x is the full frame.
export type CinematicPlotAxis = 'x' | 'y' | 'zoom';
export const CINEMATIC_PLOT_AXES: readonly CinematicPlotAxis[] = ['x', 'y', 'zoom'];

// Dispatched on the document after the preview solves a Cinematic path.
export const CINEMATIC_PATH_SOLVED_EVENT = 'ytc-cinematic-path-solved';

// The class of the plot's container in the Cinematic settings.
export const CINEMATIC_PATH_PLOT_CLASS = 'ytc-cinematic-plot';

// While the plot is open, the path is solved in Smooth Track too, so the plot can compare them.
export function isCinematicPathPlotShown(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.querySelector(`.${CINEMATIC_PATH_PLOT_CLASS}`) != null
  );
}

export interface CinematicPlotInput {
  cropMap: readonly CropPoint[];
  margins: CinematicMargins;
  cropResWidth: number;
  cropResHeight: number;
  fps: number;
  // Only a zoompan pair's crop size changes, so only it has a zoom to plot.
  enableZoomPan: boolean;
  // The solved path, or null while it is being solved.
  path: CropPath | null;
}

// One axis over the pair's time: the crop center in crop resolution px, or the zoom. Times are seconds
// from the first crop point.
export interface CinematicPlotSeries {
  axis: CinematicPlotAxis;
  duration: number;
  // The values the axis can take (the frame for the crop center), so the plot shows no more.
  limits: [number, number];
  // Each point's value, and how much of the plot to show around it.
  points: { t: number; value: number; plotMargin: number }[];
  // Where the margin lets the value go: the solver's own bounds once the path is solved, else an
  // estimate from the crop points and the margin.
  band: { t: number[]; low: number[]; high: number[]; solved: boolean };
  sampleTimes: number[];
  smoothTrack: number[];
  easeInOut: number[];
  cinematic: number[] | null;
}

const PLOT_SAMPLES = 240;

// This share of each point's plotted scale shows around it (the Strong preset's margin), whatever the
// margin, so changing the margin keeps the scale. A wider band is clipped at the plot's edges.
const PLOTTED_MARGIN_SHARE = 0.2;

interface AxisScale {
  value: (components: readonly number[]) => number;
  // The scale of a point's margin in the axis's units.
  marginScale: (components: readonly number[]) => number;
  limits: [number, number];
}

// The zoom of a crop width: the widest crop the frame fits at the crop's aspect ratio over the width.
// The solver keeps each run's first aspect ratio, and the crops share one but in a hand-edited file,
// so the first crop's ratio bounds the width as solveRun's maxW does (kept in sync with it).
function zoomOfWidth(input: CinematicPlotInput): (w: number) => number {
  const { cropResWidth, cropResHeight } = input;
  const [, , w, h] = parseCropToComponents(input.cropMap[0].crop, cropResWidth, cropResHeight);
  const ratio = w > 0 ? h / w : cropResHeight / cropResWidth;
  const widest = Math.min(cropResWidth, cropResHeight / ratio);
  return (width) => widest / Math.max(1, width);
}

function axisScale(input: CinematicPlotInput, axis: CinematicPlotAxis): AxisScale {
  const { cropResWidth, cropResHeight } = input;
  if (axis === 'zoom') {
    const ofWidth = zoomOfWidth(input);
    const zoom = (c: readonly number[]) => ofWidth(c[2]);
    // Down to 0, so a point at 1x is not cut off at the lane's edge.
    return { value: zoom, marginScale: zoom, limits: [0, Infinity] };
  }
  const i = axis === 'x' ? 0 : 1;
  return {
    value: (c) => c[i] + c[i + 2] / 2,
    marginScale: (c) => Math.min(c[2], c[3]),
    limits: [0, axis === 'x' ? cropResWidth : cropResHeight],
  };
}

export function cinematicPlotSeries(
  input: CinematicPlotInput,
  axis: CinematicPlotAxis
): CinematicPlotSeries | null {
  const { cropMap, cropResWidth, cropResHeight, fps } = input;
  if (cropMap.length < 2) return null;
  if (axis === 'zoom' && !input.enableZoomPan) return null;
  const firstTime = cropMap[0].x;
  const duration = cropMap[cropMap.length - 1].x - firstTime;
  if (!(duration > 0)) return null;

  const scale = axisScale(input, axis);
  const easingPoints: EasingCropPoint[] = cropMap.map((p) => ({
    time: p.x,
    components: parseCropToComponents(p.crop, cropResWidth, cropResHeight),
    easeIn: p.easeIn,
  }));
  const points = easingPoints.map((p) => ({
    t: p.time - firstTime,
    value: scale.value(p.components),
    plotMargin: scale.marginScale(p.components) * PLOTTED_MARGIN_SHARE,
  }));

  const sampleTimes = Array.from(
    { length: PLOT_SAMPLES },
    (_, i) => (duration * i) / (PLOT_SAMPLES - 1)
  );
  const frame = { width: cropResWidth, height: cropResHeight };
  // Through the same easing dispatch the preview uses.
  const eased = (easing: 'smoothTrack' | 'smoothInOut') =>
    sampleTimes.map((t) => {
      const time = firstTime + t;
      const [left, right] = cropInterpolationSectionAtTime(cropMap, time);
      const crop = getSectionEasedCropComponents(
        easing,
        easingPoints[left],
        easingPoints[right],
        easingPoints[left - 1] ?? null,
        easingPoints[right + 1] ?? null,
        time,
        fps,
        frame
      );
      return scale.value(crop);
    });
  const smoothTrack = eased('smoothTrack');
  const easeInOut = eased('smoothInOut');
  const path = input.path;
  const cinematic = path
    ? sampleTimes.map((t) => scale.value(evalCropPathAtTime(path, t)))
    : null;
  const bounds = path?.centerBounds;
  const band = bounds
    ? solvedBand(input, bounds, axis, sampleTimes)
    : estimatedBand(input, axis, scale, sampleTimes);

  return {
    axis,
    duration,
    limits: scale.limits,
    points,
    band,
    sampleTimes,
    smoothTrack,
    easeInOut,
    cinematic,
  };
}

// The bounds at time t, linear between the solver's samples as its box is.
function boundAt(t: number, times: readonly number[], values: readonly number[]): number {
  const i = Math.max(1, times.findIndex((bt) => bt >= t));
  if (i >= times.length) return values[values.length - 1];
  const span = times[i] - times[i - 1];
  const s = span > 0 ? Math.min(1, Math.max(0, (t - times[i - 1]) / span)) : 1;
  return values[i - 1] + (values[i] - values[i - 1]) * s;
}

function solvedBand(
  input: CinematicPlotInput,
  bounds: NonNullable<CropPath['centerBounds']>,
  axis: CinematicPlotAxis,
  sampleTimes: number[]
): CinematicPlotSeries['band'] {
  if (axis === 'zoom') {
    // The solver's width box is straight between its samples, which the zoom (its inverse) is not,
    // so the band is sampled as finely as the paths. A wider crop is less zoom, so the widest width
    // is the band's low edge.
    const zoom = zoomOfWidth(input);
    return {
      t: sampleTimes,
      low: sampleTimes.map((t) => zoom(boundAt(t, bounds.t, bounds.wHigh))),
      high: sampleTimes.map((t) => zoom(boundAt(t, bounds.t, bounds.wLow))),
      solved: true,
    };
  }
  return {
    t: bounds.t,
    low: axis === 'x' ? bounds.xLow : bounds.yLow,
    high: axis === 'x' ? bounds.xHigh : bounds.yHigh,
    solved: true,
  };
}

// The crop at `time` within one run of the solver's: the target the solve tracks there.
function runCropAt(
  run: readonly CropPoint[],
  target: CinematicRunTarget | null,
  time: number,
  input: CinematicPlotInput
): number[] {
  if (!target) return parseCropToComponents(run[0].crop, input.cropResWidth, input.cropResHeight);
  const [x, y, w] = target.at(time - input.cropMap[0].x);
  return [x, y, w, w * target.ratio];
}

// The band before the solve, from the solver's own runs: the crop holds until a cut, the center
// stays far enough from the frame edge for the crop to fit, and the width stays within the frame.
// Only the zoom margin's effect on the center waits for the solve.
function estimatedBand(
  input: CinematicPlotInput,
  axis: CinematicPlotAxis,
  scale: AxisScale,
  sampleTimes: number[]
): CinematicPlotSeries['band'] {
  const firstTime = input.cropMap[0].x;
  // Latest first: at a cut both runs hold that time, and the later one shows.
  const runs = splitAtInstantCuts(input.cropMap, input.fps);
  const runsLatestFirst = [...runs].reverse().map((run) => ({
    run,
    target: cinematicRunTarget(run, firstTime, input.cropResWidth, input.cropResHeight),
  }));
  // Hold points hold still, as the solve pins them.
  const held = runs.flatMap((run) => heldSpans(run, input.cropResWidth, input.cropResHeight));
  const firmHeld = runs.flatMap((run) =>
    firmHeldSpans(run, input.cropResWidth, input.cropResHeight)
  );
  const zoom = zoomOfWidth(input);
  const low: number[] = [];
  const high: number[] = [];
  for (const t of sampleTimes) {
    const time = firstTime + t;
    const { run, target } =
      runsLatestFirst.find((r) => r.run[0].x <= time) ??
      runsLatestFirst[runsLatestFirst.length - 1];
    const crop = runCropAt(run, target, time, input);
    const v = scale.value(crop);
    if (held.some((span) => span.start <= time && time <= span.end)) {
      low.push(v);
      high.push(v);
      continue;
    }
    // Over a Firm hold the band is only what the crop needs to brake and settle, as in the solve.
    const firmSpans = firmHeld.filter((span) => span.start <= time && time <= span.end);
    const posMargin = input.margins.pos * Math.min(crop[2], crop[3]);
    const firmMargin = (full: number) =>
      firmSpans.length === 0
        ? full
        : Math.min(
            full,
            Math.max(...firmSpans.map((span) => firmHoldAllowance(span, time, posMargin)))
          );
    if (axis === 'zoom') {
      const half = firmMargin(input.margins.zoom * crop[2]);
      // The frame stops the crop from zooming out past 1x.
      low.push(Math.max(1, zoom(crop[2] + half)));
      high.push(zoom(crop[2] - half));
    } else {
      const size = axis === 'x' ? crop[2] : crop[3];
      const side = Math.min(crop[2], crop[3]);
      const margin = firmMargin(input.margins.pos * side);
      low.push(Math.min(v, Math.max(size / 2, v - margin)));
      high.push(Math.max(v, Math.min(scale.limits[1] - size / 2, v + margin)));
    }
  }
  return { t: sampleTimes, low, high, solved: false };
}

// The value range to plot, padded and within the axis's limits: the points with the plotted margin,
// and the paths. The Cinematic path widens it only where it leaves that range, which takes a margin
// over 20%.
export function cinematicPlotRange(series: CinematicPlotSeries): [number, number] {
  const values = [
    ...series.points.flatMap((p) => [p.value - p.plotMargin, p.value + p.plotMargin]),
    ...series.smoothTrack,
    ...series.easeInOut,
    ...(series.cinematic ?? []),
  ];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // A still crop still gets a readable band.
  const pad = Math.max((hi - lo) * 0.08, series.axis === 'zoom' ? 0.02 : 4);
  lo = Math.max(series.limits[0], lo - pad);
  hi = Math.min(series.limits[1], hi + pad);
  return lo < hi ? [lo, hi] : [lo - 1, hi + 1];
}
