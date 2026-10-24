import { createTimeLineLayer, TimeLinePosition } from './chart-time-line';

// A 2d context that records the calls the time line makes.
function recordingContext() {
  const calls: { name: string; args: number[] }[] = [];
  const record =
    (name: string) =>
    (...args: number[]) =>
      calls.push({ name, args });
  return {
    calls,
    ctx: {
      setTransform: record('setTransform'),
      clearRect: record('clearRect'),
      save: record('save'),
      restore: record('restore'),
      beginPath: record('beginPath'),
      rect: record('rect'),
      clip: record('clip'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      lineWidth: 0,
      strokeStyle: '',
    },
  };
}

let resize: () => void = () => {};

function chartWithLayer(clientWidth = 200, scale = 2) {
  const { calls, ctx } = recordingContext();
  const layer = { className: '', style: {}, width: 0, height: 0, getContext: () => ctx };
  Object.assign(globalThis, {
    document: { createElement: () => layer },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
    },
  });
  const chartCanvas = {
    parentElement: { style: {} },
    insertAdjacentElement: () => {},
    offsetLeft: 0,
    offsetTop: 0,
    clientWidth,
    clientHeight: 100,
    width: clientWidth * scale,
    height: 100 * scale,
  };
  const timeLine = createTimeLineLayer(chartCanvas as unknown as HTMLCanvasElement, {
    color: 'red',
    width: 2,
  });
  return { timeLine, calls, chartCanvas };
}

const at = (x: number): TimeLinePosition => ({ x, left: 10, right: 190, top: 5, bottom: 95 });
const named = (calls: { name: string; args: number[] }[], name: string) =>
  calls.filter((c) => c.name === name).map((c) => c.args);

describe('createTimeLineLayer', () => {
  it('strokes the line across the plot area, clipped to it, in device pixels', () => {
    const { timeLine, calls } = chartWithLayer();
    timeLine.draw(at(50));
    expect(named(calls, 'rect')).toEqual([[10, 5, 180, 90]]);
    expect(named(calls, 'moveTo')).toEqual([[50, 5]]);
    expect(named(calls, 'lineTo')).toEqual([[50, 95]]);
    expect(named(calls, 'setTransform')).toContainEqual([2, 0, 0, 2, 0, 0]);
    expect(named(calls, 'clearRect')).toEqual([]);
  });

  it('does nothing when the line has not moved', () => {
    const { timeLine, calls } = chartWithLayer();
    timeLine.draw(at(50));
    const before = calls.length;
    timeLine.draw(at(50));
    expect(calls).toHaveLength(before);
  });

  it("clears the last line's pixels, with its antialiased edges, before drawing the next", () => {
    const { timeLine, calls } = chartWithLayer();
    timeLine.draw(at(50));
    timeLine.draw(at(60));
    const [[x, y, width, height]] = named(calls, 'clearRect');
    // The old line is 2 CSS px wide at 2x: device px 98 to 102, plus a pixel each side.
    expect(x).toBeLessThanOrEqual(97);
    expect(x + width).toBeGreaterThanOrEqual(103);
    expect(y).toBeLessThanOrEqual(5 * 2 - 1);
    expect(y + height).toBeGreaterThanOrEqual(95 * 2 + 1);
  });

  it('draws afresh after a resize, which clears the layer, at the new scale', () => {
    const { timeLine, calls, chartCanvas } = chartWithLayer();
    timeLine.draw(at(50));
    chartCanvas.width = 600;
    resize();
    calls.length = 0;
    timeLine.draw(at(50));
    expect(named(calls, 'clearRect')).toEqual([]);
    expect(named(calls, 'setTransform')).toContainEqual([3, 0, 0, 3, 0, 0]);
  });

  it('draws nothing while the chart has no size', () => {
    const { timeLine, calls } = chartWithLayer(0);
    timeLine.draw(at(50));
    expect(named(calls, 'stroke')).toEqual([]);
  });
});
