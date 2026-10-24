/**
 * A chart's time line, drawn on its own canvas layered over the chart canvas. Moving the line each
 * frame then clears and strokes one thin line, instead of redrawing the whole chart. It takes only
 * plain positions (CSS px from the chart canvas's top left), so it holds no charting library code.
 */

export interface TimeLineStyle {
  color: string;
  width: number;
}

export interface TimeLinePosition {
  /** The line's x, CSS px. */
  x: number;
  /** The plot area, CSS px. The line is clipped to it. */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TimeLineLayer {
  draw(position: TimeLinePosition): void;
}

export function createTimeLineLayer(
  chartCanvas: HTMLCanvasElement,
  style: TimeLineStyle
): TimeLineLayer {
  const layer = document.createElement('canvas');
  layer.className = 'ytc-chart-time-line';
  Object.assign(layer.style, { position: 'absolute', pointerEvents: 'none' });
  const container = chartCanvas.parentElement;
  if (container) {
    container.style.position = 'relative';
    chartCanvas.insertAdjacentElement('afterend', layer);
  }
  const ctx = layer.getContext('2d');
  let drawn: TimeLinePosition | null = null;
  // Device pixels per CSS px, read on resize so drawing never reads layout.
  let scale = 0;

  // Match the chart canvas's box and backing store, so the line lands on the same device pixels the
  // chart would draw it on. Resizing clears the layer, so redraw on the next frame.
  const fit = (): void => {
    Object.assign(layer.style, {
      left: `${chartCanvas.offsetLeft}px`,
      top: `${chartCanvas.offsetTop}px`,
      width: `${chartCanvas.clientWidth}px`,
      height: `${chartCanvas.clientHeight}px`,
    });
    layer.width = chartCanvas.width;
    layer.height = chartCanvas.height;
    scale = chartCanvas.clientWidth ? chartCanvas.width / chartCanvas.clientWidth : 0;
    drawn = null;
  };
  new ResizeObserver(fit).observe(chartCanvas);
  fit();

  function draw(position: TimeLinePosition): void {
    if (!ctx || !scale) return;
    if (
      drawn?.x === position.x &&
      drawn.left === position.left &&
      drawn.right === position.right &&
      drawn.top === position.top &&
      drawn.bottom === position.bottom
    ) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (drawn) {
      // Clear the previous line's pixels, with a pixel of margin for its antialiased edges.
      const half = (style.width * scale) / 2 + 1;
      ctx.clearRect(
        Math.floor(drawn.x * scale - half),
        Math.floor(drawn.top * scale) - 1,
        Math.ceil(2 * half) + 1,
        Math.ceil((drawn.bottom - drawn.top) * scale) + 2
      );
    }
    const { x, left, right, top, bottom } = position;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.lineWidth = style.width;
    ctx.strokeStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
    drawn = position;
  }

  return { draw };
}
