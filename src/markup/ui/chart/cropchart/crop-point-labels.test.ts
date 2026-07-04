import { getCropPointMainLabel } from './crop-point-labels';

const points = (...crops: string[]) => crops.map((crop) => ({ crop }));

describe('getCropPointMainLabel', () => {
  test.each([
    {
      name: 'pan-only shows the size once, at the first point',
      crops: ['0:0:400:300', '100:0:400:300', '200:0:400:300'],
      zoomPan: false,
      labels: ['0:0\n400x300', '100:0\n ', '200:0\n '],
    },
    {
      // The last point holds its position from its only neighbor, so only its size shows.
      name: 'zoom/pan shows the size only where it changes',
      crops: ['0:0:400:300', '100:0:400:300', '100:0:200:150'],
      zoomPan: true,
      labels: ['0:0\n ', '100:0\n400x300', ' \n200x150'],
    },
    {
      name: 'a hold from every neighbor hides both lines',
      crops: ['0:0:400:300', '0:0:400:300', '0:0:400:300'],
      zoomPan: true,
      labels: ['', '', ''],
    },
    {
      name: 'a lone point, with no neighbor to hold from, shows both lines',
      crops: ['0:0:400:300'],
      zoomPan: true,
      labels: ['0:0\n400x300'],
    },
    {
      name: 'no selected pair hides the size',
      crops: ['0:0:400:300', '100:0:400:300'],
      zoomPan: undefined,
      labels: ['0:0\n ', '100:0\n '],
    },
  ])('$name', ({ crops, zoomPan, labels }) => {
    const pts = points(...crops);
    expect(pts.map((_p, i) => getCropPointMainLabel(pts, i, zoomPan))).toEqual(labels);
  });
});
