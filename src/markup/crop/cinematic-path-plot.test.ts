import { CropPoint } from '../@types/yt_clipper';
import { bakeCinematicPath, cinematicMarginsFromPercent } from './cinematic-path';
import {
  CinematicPlotAxis,
  CinematicPlotInput,
  cinematicPlotRange,
  CinematicPlotSeries,
  cinematicPlotSeries,
} from './cinematic-path-plot';

const W = 1920;
const H = 1080;

// A 960x540 crop panning right with jitter, starting at video time 100.
const panningCropMap: CropPoint[] = [0, 400, 300, 700, 650, 900].map((x, i) => ({
  x: 100 + i,
  y: 0,
  crop: `${x}:200:960:540`,
}));

// Holds, then cuts to the other side of the frame at 4 s.
const cutCropMap: CropPoint[] = [
  { x: 0, y: 0, crop: '0:0:640:360' },
  { x: 2, y: 0, crop: '20:0:640:360' },
  { x: 4, y: 0, crop: '900:0:640:360', easeIn: 'instant' },
  { x: 6, y: 0, crop: '920:0:640:360' },
];

// Zooms in and out while panning, every half second.
const zoomPanCropMap: CropPoint[] = Array.from({ length: 9 }, (_, i) => ({
  x: i / 2,
  y: 0,
  crop: i % 2 === 0 ? '0:0:1920:1080' : '600:300:640:360',
}));

function plotInput(cropMap: CropPoint[], solved: boolean, enableZoomPan = true): CinematicPlotInput {
  const margins = cinematicMarginsFromPercent(12, 8);
  return {
    cropMap,
    margins,
    cropResWidth: W,
    cropResHeight: H,
    fps: 30,
    enableZoomPan,
    path: solved ? bakeCinematicPath(cropMap, margins, W, H, 30) : null,
  };
}

// The band at time t, linear between its own samples, as it is drawn.
function bandAt(band: CinematicPlotSeries['band'], t: number): [number, number] {
  const i = Math.max(
    1,
    band.t.findIndex((bt) => bt >= t)
  );
  const [t0, t1] = [band.t[i - 1], band.t[i]];
  const s = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 1;
  return [
    band.low[i - 1] + (band.low[i] - band.low[i - 1]) * s,
    band.high[i - 1] + (band.high[i] - band.high[i - 1]) * s,
  ];
}

describe('cinematicPlotSeries', () => {
  it('plots the crop centers and both paths over the time from the first point', () => {
    const series = cinematicPlotSeries(plotInput(panningCropMap, true), 'x');
    expect(series).not.toBeNull();
    if (!series) return;
    expect(series.duration).toBe(5);
    expect(series.limits).toEqual([0, W]);
    expect(series.points.map((p) => p.t)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(series.points[0].value).toBe(480);
    expect(series.sampleTimes[0]).toBe(0);
    expect(series.sampleTimes[series.sampleTimes.length - 1]).toBe(5);
    expect(series.smoothTrack).toHaveLength(series.sampleTimes.length);
    // Smooth Track passes through the crop points.
    expect(series.smoothTrack[0]).toBeCloseTo(480);
    expect(series.smoothTrack[series.smoothTrack.length - 1]).toBeCloseTo(1380);
    expect(series.cinematic).toHaveLength(series.sampleTimes.length);
    expect(series.band.solved).toBe(true);
  });

  it('plots EaseInOut through each crop point, coming to a stop there', () => {
    // Checked at the sample nearest each inner point.
    const steady = cutCropMap.map((p) => ({ ...p, easeIn: undefined }));
    const series = cinematicPlotSeries(plotInput(steady, false), 'x')!;
    const step = series.sampleTimes[1];
    for (const point of series.points.slice(1, -1)) {
      const i = Math.round(point.t / step);
      expect(series.easeInOut[i]).toBeCloseTo(point.value, 0);
      // Flat at the point, where a crop moving on to the next point would cover about 20 px.
      expect(Math.abs(series.easeInOut[i + 1] - series.easeInOut[i - 1])).toBeLessThan(2);
    }
  });

  it.each([
    ['a jittery pan', panningCropMap, 'x'],
    ['a cut', cutCropMap, 'x'],
    ['a zoom while panning', zoomPanCropMap, 'x'],
    ['a zoom while panning', zoomPanCropMap, 'y'],
    ['a zoom while panning', zoomPanCropMap, 'zoom'],
  ] as const)(
    'draws the Cinematic path inside the band the solver kept it in: %s on %s',
    (_name, cropMap, axis) => {
      const series = cinematicPlotSeries(plotInput([...cropMap], true), axis as CinematicPlotAxis)!;
      const cinematic = series.cinematic!;
      // The band is linear between the solver's samples and the path quadratic, so allow a pixel. On
      // this fast zoom the width bulges up to 4 px between samples: allow that, in zoom units.
      series.sampleTimes.forEach((t, i) => {
        const slack = axis === 'zoom' ? (cinematic[i] ** 2 * 4) / W : 1;
        const [low, high] = bandAt(series.band, t);
        expect(cinematic[i]).toBeGreaterThanOrEqual(low - slack);
        expect(cinematic[i]).toBeLessThanOrEqual(high + slack);
      });
    }
  );

  it('plots the zoom, 1x at the full frame, with the zoom margin around each point', () => {
    // 1920 px is the full frame and 640 px three times zoomed in. The 8% zoom margin lets the width
    // grow or shrink by 8%, and the frame stops a full-frame crop from zooming out. Read during holds,
    // where the band is flat.
    const holds = ['0:0:1920:1080', '0:0:1920:1080', '600:300:640:360', '600:300:640:360'];
    const series = cinematicPlotSeries(
      plotInput(holds.map((crop, i) => ({ x: 2 * i, y: 0, crop })), false),
      'zoom'
    )!;
    expect(series.points.map((p) => p.value)).toEqual([1, 1, 3, 3]);
    expect(series.limits).toEqual([0, Infinity]);
    const [fullLow, fullHigh] = bandAt(series.band, 1);
    expect(fullLow).toBe(1);
    expect(fullHigh).toBeCloseTo(1 / 0.92, 6);
    const [low, high] = bandAt(series.band, 5);
    expect(low).toBeCloseTo(3 / 1.08, 6);
    expect(high).toBeCloseTo(3 / 0.92, 6);
  });

  it('has no zoom to plot for a pan-only pair', () => {
    expect(cinematicPlotSeries(plotInput(zoomPanCropMap, false, false), 'zoom')).toBeNull();
    expect(cinematicPlotSeries(plotInput(zoomPanCropMap, false, false), 'x')).not.toBeNull();
  });

  it('holds the band until a cut, before and after the solve', () => {
    // The crop at 2 s (center 340) holds until the cut at 4 s, where it jumps to center 1220. A band
    // ramping between the points would be near 1176 at 3.9 s. The margin is 12% of 360 px, and the
    // frame edge keeps the center at half the crop width or more.
    for (const solved of [false, true]) {
      const series = cinematicPlotSeries(plotInput(cutCropMap, solved), 'x')!;
      const [low, high] = bandAt(series.band, 3.9);
      expect(low).toBeGreaterThanOrEqual(320 - 1e-9);
      expect(high).toBeLessThan(340 + 43.2 + 1);
      expect(high).toBeGreaterThan(340);
      const [lowAfter, highAfter] = bandAt(series.band, 4.5);
      expect((lowAfter + highAfter) / 2).toBeGreaterThan(1200);
    }
  });

  it('keeps the band where the crop fits in the frame', () => {
    // A 960 px crop at the left edge cannot move its center below 480.
    const atEdge = panningCropMap.map((p) => ({ ...p, crop: '0:200:960:540' }));
    for (const solved of [false, true]) {
      const series = cinematicPlotSeries(plotInput(atEdge, solved), 'x')!;
      expect(Math.min(...series.band.low)).toBeGreaterThanOrEqual(480 - 1e-9);
    }
  });

  it('has no Cinematic line while the path is unsolved, and nothing to plot for fewer than two points', () => {
    const unsolved = cinematicPlotSeries(plotInput(panningCropMap, false), 'x');
    expect(unsolved?.cinematic).toBeNull();
    expect(unsolved?.band.solved).toBe(false);
    expect(cinematicPlotSeries(plotInput(panningCropMap.slice(0, 1), false), 'x')).toBeNull();
    const sameTime = panningCropMap.slice(0, 2).map((p) => ({ ...p, x: 100 }));
    expect(cinematicPlotSeries(plotInput(sameTime, false), 'x')).toBeNull();
  });

  it('plots the vertical crop center', () => {
    const tilting = panningCropMap.map((p, i) => ({ ...p, crop: `100:${i * 100}:960:540` }));
    expect(cinematicPlotSeries(plotInput(tilting, false), 'y')?.points[1].value).toBe(370);
  });

  it('keeps one scale across margins: the points with a 20% margin, within the frame', () => {
    const rangeAt = (marginPercent: number, solved: boolean, axis: 'x' | 'y') => {
      const margins = cinematicMarginsFromPercent(marginPercent, 8);
      const input = { ...plotInput(panningCropMap, false), margins };
      const path = solved ? bakeCinematicPath(panningCropMap, margins, W, H, 30) : null;
      return cinematicPlotRange(cinematicPlotSeries({ ...input, path }, axis)!);
    };
    const [lo, hi] = rangeAt(12, true, 'x');
    // 20% of the 540 px shorter side around the first and last centers.
    expect(lo).toBeLessThanOrEqual(480 - 108);
    expect(hi).toBeGreaterThanOrEqual(1380 + 108);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(W);
    for (const marginPercent of [0, 6, 20, 30, 50]) {
      expect(rangeAt(marginPercent, false, 'x')).toEqual([lo, hi]);
      expect(rangeAt(marginPercent, false, 'y')).toEqual(rangeAt(12, false, 'y'));
    }
    // A path within 20% of the points leaves the scale as it is.
    expect(rangeAt(20, true, 'x')).toEqual([lo, hi]);
    // A still crop gets a band to show.
    const still = panningCropMap.map((p) => ({ ...p, crop: '0:0:960:540' }));
    const [stillLo, stillHi] = cinematicPlotRange(
      cinematicPlotSeries(plotInput(still, false), 'x')!
    );
    expect(stillHi).toBeGreaterThan(stillLo);
  });
});
