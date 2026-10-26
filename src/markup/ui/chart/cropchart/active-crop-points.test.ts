import type Chart from 'chart.js';
import { CropPoint, MarkerPair } from '../../../@types/yt_clipper';
import { activeCropPoints } from './active-crop-points';

const pairPoints: CropPoint[] = [
  { x: 0, y: 0, crop: '0:0:100:100' },
  { x: 5, y: 0, crop: '0:0:100:100' },
];
const chartPoints: CropPoint[] = [...pairPoints, { x: 9, y: 0, crop: '0:0:100:100' }];
const chartShowing = (points: CropPoint[]) =>
  ({ data: { datasets: [{ data: points }] } }) as unknown as Chart;

const editor = (open: 'pair' | 'global' | 'none', pairs = [{ cropMap: pairPoints }]) => ({
  isSettingsEditorOpen: open !== 'none',
  wasGlobalSettingsEditorOpen: open === 'global',
  markerPairs: pairs as MarkerPair[],
  prevSelectedMarkerPairIndex: 0,
});

describe('activeCropPoints', () => {
  it.each([
    ['the chart shows the pair', chartShowing(chartPoints), editor('pair'), chartPoints],
    ['the pair editor is open before the chart is shown', null, editor('pair'), pairPoints],
    ['the global editor is open with no chart', null, editor('global'), null],
    ['no editor is open with no chart', null, editor('none'), null],
    ['the selected pair is gone', null, editor('pair', []), null],
  ])('%s', (_case, chart, state, expected) => {
    expect(activeCropPoints(chart, state)).toBe(expected);
  });
});
