import { html, TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import {
  CINEMATIC_PATH_PLOT_CLASS,
  CINEMATIC_PATH_SOLVED_EVENT,
  CINEMATIC_PLOT_AXES,
  CinematicPlotAxis,
  CinematicPlotInput,
  cinematicPlotRange,
  CinematicPlotSeries,
  cinematicPlotSeries,
} from '../../crop/cinematic-path-plot';
import type { CropEasingMode } from '../../components/settings/crop-easing-select';
import { CinematicMargins, cropPathSignature } from '../../crop/cinematic-path';

export interface CinematicPathPlotProps {
  // The marker pair's crop points and Cinematic path now, or null without a marker pair.
  input: () => CinematicPlotInput | null;
  // The video time, for the playhead.
  currentTime: () => number;
  // Solves the path if it is out of date, as in Smooth Track nothing else does.
  requestPath: () => void;
  // Whether a solve is scheduled, so the last path can show faded until it lands.
  isSolvePending: () => boolean;
  // The marker pair's crop easing, whose path the plot draws on top.
  activeEasing: () => CropEasingMode;
  // A pointerdown handler that seeks on a right-click drag, given the video time under the pointer.
  seekOnRightDrag: (
    canvas: HTMLCanvasElement,
    seekTimeAt: (e: MouseEvent) => number
  ) => (e: PointerEvent) => void;
}

const WIDTH_PX = 260;
// Each lane's height with every lane the pair has shown. Fewer lanes share the same height, so
// toggling one does not resize the popover.
const LANE_HEIGHT_PX = 71;
const PAD = { left: 4, right: 4, top: 6, bottom: 14 };
const PANEL_GAP_PX = 8;
const AXIS_LABELS: Record<CinematicPlotAxis, string> = { x: 'X', y: 'Y', zoom: 'Zoom' };
const COLORS = {
  band: 'rgba(210, 210, 210, 0.22)',
  points: 'rgb(235, 235, 235)',
  playhead: 'rgba(235, 235, 235, 0.55)',
  label: 'rgb(160, 160, 160)',
};

// One path per crop easing, each with its own color and dash so they stay apart where they overlap.
const EASING_LINES = [
  { easing: 'smoothTrack', layer: 'smoothTrack', color: 'rgb(120, 175, 255)', dash: [5, 3] },
  { easing: 'smoothInOut', layer: 'easeInOut', color: 'rgb(205, 160, 255)', dash: [2, 2.5] },
  { easing: 'cinematic', layer: 'cinematic', color: 'rgb(255, 160, 70)', dash: [] },
] as const;

type PlotLayer = 'points' | 'band' | (typeof EASING_LINES)[number]['layer'];

// The layers hidden from the legend, and the axes plotted, shared by every plot for the page session.
const hiddenLayers = new Set<PlotLayer>();
const shownAxes = new Set<CinematicPlotAxis>(CINEMATIC_PLOT_AXES);

interface PlotState {
  props: CinematicPathPlotProps;
  // The last solved path's line per axis, shown faded while a new one is being solved or previewed.
  lastCinematic: Partial<Record<CinematicPlotAxis, { duration: number; values: number[] }>>;
  showingLastPath: boolean;
  // The inputs a solve was last requested for, so a solve that cannot help is not requested again.
  requestedSignature: string | null;
  // For the playhead, which runs every frame and must not rebuild the plot's input.
  firstCropTime: number | null;
  // One per plotted axis, top to bottom.
  series: CinematicPlotSeries[];
  // How many lanes the pair has, which sets the plot's height.
  laneSlots: number;
  // The plot without the playhead, so the playhead redraws without sampling again.
  base: HTMLCanvasElement;
  drawnPlayhead: number | null;
}

interface Panel {
  series: CinematicPlotSeries;
  top: number;
  height: number;
}

const plots = new WeakMap<HTMLElement, PlotState>();

function lanesHeight(state: PlotState): number {
  const slots = Math.max(1, state.laneSlots);
  return slots * LANE_HEIGHT_PX + (slots - 1) * PANEL_GAP_PX;
}

function laneHeight(state: PlotState): number {
  const n = Math.max(1, state.series.length);
  return (lanesHeight(state) - (n - 1) * PANEL_GAP_PX) / n;
}

function canvasHeight(state: PlotState): number {
  return PAD.top + PAD.bottom + lanesHeight(state);
}

function panelsFor(state: PlotState): Panel[] {
  const height = laneHeight(state);
  return state.series.map((series, i) => ({
    series,
    top: PAD.top + i * (height + PANEL_GAP_PX),
    height,
  }));
}

function timeToX(t: number, duration: number): number {
  return PAD.left + (t / duration) * (WIDTH_PX - PAD.left - PAD.right);
}

function scaleFor({ series, top, height }: Panel) {
  const [lo, hi] = cinematicPlotRange(series);
  const px = (t: number) => timeToX(t, series.duration);
  // Down the plot is down the video for y, so the line moves as the crop does. Up is zoomed in.
  const py = (v: number) =>
    series.axis === 'y'
      ? top + ((v - lo) / (hi - lo)) * height
      : top + height - ((v - lo) / (hi - lo)) * height;
  return { px, py, lo, hi };
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  times: readonly number[],
  values: readonly number[],
  { px, py }: ReturnType<typeof scaleFor>
): void {
  ctx.beginPath();
  values.forEach((v, i) =>
    i === 0 ? ctx.moveTo(px(times[i]), py(v)) : ctx.lineTo(px(times[i]), py(v))
  );
  ctx.stroke();
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  state: PlotState,
  panel: Panel,
  labelled: boolean
): void {
  const { series } = panel;
  const scale = scaleFor(panel);
  const { px, py } = scale;
  ctx.save();
  // A margin wider than the plotted range is clipped, so it never rescales the plot.
  ctx.beginPath();
  ctx.rect(0, panel.top, WIDTH_PX, panel.height);
  ctx.clip();

  const { band } = series;
  if (!hiddenLayers.has('band')) {
    ctx.fillStyle = COLORS.band;
    ctx.beginPath();
    band.t.forEach((t, i) =>
      i === 0 ? ctx.moveTo(px(t), py(band.high[i])) : ctx.lineTo(px(t), py(band.high[i]))
    );
    for (let i = band.t.length - 1; i >= 0; i--) ctx.lineTo(px(band.t[i]), py(band.low[i]));
    ctx.closePath();
    ctx.fill();
  }

  const last = state.lastCinematic[series.axis];
  const lastCinematic =
    state.showingLastPath && last?.duration === series.duration ? last.values : null;
  const values = {
    smoothTrack: series.smoothTrack,
    easeInOut: series.easeInOut,
    cinematic: series.cinematic ?? lastCinematic,
  };
  // The pair's own easing is drawn last, so it lies on top, and stronger than the others.
  const active = state.props.activeEasing();
  const lines = [...EASING_LINES].sort(
    (a, b) => Number(a.easing === active) - Number(b.easing === active)
  );
  ctx.lineJoin = 'round';
  for (const line of lines) {
    const lineValues = values[line.layer];
    if (!lineValues || hiddenLayers.has(line.layer)) continue;
    const isActive = line.easing === active;
    // A faded line is the last solved path, while the next one is being solved.
    const faded = line.layer === 'cinematic' && !series.cinematic;
    ctx.strokeStyle = line.color;
    ctx.setLineDash([...line.dash]);
    ctx.lineWidth = isActive ? 2.25 : 1.25;
    ctx.globalAlpha = (isActive ? 1 : 0.55) * (faded ? 0.4 : 1);
    strokeLine(ctx, series.sampleTimes, lineValues, scale);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  if (!hiddenLayers.has('points')) {
    ctx.fillStyle = COLORS.points;
    for (const p of series.points) {
      ctx.beginPath();
      ctx.arc(px(p.t), py(p.value), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.fillStyle = COLORS.label;
  ctx.font = '9px sans-serif';
  if (labelled) {
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(AXIS_LABELS[series.axis], PAD.left + 2, panel.top + 1);
  }
  // The zoom has a scale people read, so its lane shows the zoom at its top and bottom.
  if (series.axis === 'zoom') {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${scale.hi.toFixed(2)}x`, WIDTH_PX - PAD.right - 2, panel.top + 1);
    ctx.textBaseline = 'bottom';
    // The lane pads below 1x so a full-frame point shows whole, and then labels 1x where it is.
    const bottom = Math.max(1, scale.lo);
    ctx.fillText(
      `${bottom.toFixed(2)}x`,
      WIDTH_PX - PAD.right - 2,
      Math.min(panel.top + panel.height, scale.py(bottom))
    );
  }
}

function drawBase(state: PlotState, dpr: number): void {
  const { base, series } = state;
  const height = canvasHeight(state);
  base.width = WIDTH_PX * dpr;
  base.height = height * dpr;
  const ctx = base.getContext('2d');
  if (!ctx || series.length === 0) return;
  ctx.scale(dpr, dpr);
  const panels = panelsFor(state);
  for (const panel of panels) drawPanel(ctx, state, panel, panels.length > 1);

  ctx.fillStyle = COLORS.label;
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('0s', PAD.left, height);
  ctx.textAlign = 'right';
  ctx.fillText(`${series[0].duration.toFixed(1)}s`, WIDTH_PX - PAD.right, height);
}

function drawPlayhead(canvas: HTMLCanvasElement, state: PlotState, dpr: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.base, 0, 0);
  const duration = state.series[0]?.duration;
  const t = state.drawnPlayhead;
  if (duration == null || t == null || t < 0 || t > duration) return;
  ctx.scale(dpr, dpr);
  const x = timeToX(t, duration);
  ctx.strokeStyle = COLORS.playhead;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, PAD.top);
  ctx.lineTo(x, canvasHeight(state) - PAD.bottom);
  ctx.stroke();
}

// The axes there is something to plot for: no zoom for a pair whose crop size can't change.
function availableAxes(input: CinematicPlotInput | null): CinematicPlotAxis[] {
  return CINEMATIC_PLOT_AXES.filter((axis) => axis !== 'zoom' || input?.enableZoomPan);
}

// The lanes shown: the ones turned on that the pair has, or all it has when none of them is on (Zoom
// alone, turned on for a zoompan pair, on a pan-only pair).
function shownLanes(input: CinematicPlotInput | null): CinematicPlotAxis[] {
  const available = availableAxes(input);
  const shown = available.filter((axis) => shownAxes.has(axis));
  return shown.length > 0 ? shown : available;
}

// Samples the plot again from the current crop points, margins and path, and redraws it. A previewed
// margin (a slider mid-drag) draws its band with the last path faded, as it is not solved yet.
function redraw(container: HTMLElement, previewMargins?: Partial<CinematicMargins>): void {
  const state = plots.get(container);
  const canvas = container.querySelector('canvas');
  if (!state || !canvas) return;
  const current = state.props.input();
  const input =
    current && previewMargins
      ? { ...current, margins: { ...current.margins, ...previewMargins }, path: null }
      : current;
  const available = availableAxes(current);
  const axes = shownLanes(current);
  state.series = input ? axes.flatMap((axis) => cinematicPlotSeries(input, axis) ?? []) : [];
  state.laneSlots = available.length;
  for (const series of state.series) {
    if (series.cinematic)
      state.lastCinematic[series.axis] = { duration: series.duration, values: series.cinematic };
  }
  state.firstCropTime = current?.cropMap[0]?.x ?? null;
  const pending = state.props.isSolvePending();
  state.showingLastPath = previewMargins != null || pending;
  // Nothing else solves an out-of-date path in Smooth Track (after a frame rate change, say). Asked
  // once per inputs, so a solve that fails or finds no path is not retried.
  if (current && !current.path && previewMargins == null && !pending && state.series.length > 0) {
    const { cropMap, margins, cropResWidth, cropResHeight, fps } = current;
    const signature = cropPathSignature(cropMap, margins, cropResWidth, cropResHeight, fps);
    if (signature !== state.requestedSignature) {
      state.requestedSignature = signature;
      state.props.requestPath();
    }
  }
  container.querySelectorAll<HTMLButtonElement>('[data-cinematic-plot-axis]').forEach((button) => {
    const axis = button.dataset.cinematicPlotAxis as CinematicPlotAxis;
    button.hidden = !available.includes(axis);
    button.classList.toggle('active', axes.includes(axis));
    button.setAttribute('aria-pressed', String(axes.includes(axis)));
  });
  const activeLayer = EASING_LINES.find(
    (line) => line.easing === state.props.activeEasing()
  )?.layer;
  container.querySelectorAll<HTMLButtonElement>('[data-plot-layer]').forEach((button) => {
    const layer = button.dataset.plotLayer as PlotLayer;
    button.setAttribute('aria-pressed', String(!hiddenLayers.has(layer)));
    button.classList.toggle('active', layer === activeLayer);
  });
  // The UI tests read these.
  canvas.dataset.cinematicPlotted = String(
    state.series.length > 0 && state.series.every((s) => s.cinematic)
  );
  canvas.dataset.cinematicPlotAxes = state.series.map((s) => s.axis).join(',');
  container.classList.toggle('empty', state.series.length === 0);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH_PX * dpr;
  canvas.height = canvasHeight(state) * dpr;
  canvas.style.height = `${canvasHeight(state)}px`;
  drawBase(state, dpr);
  drawPlayhead(canvas, state, dpr);
}

// Redraws the plot in a Cinematic settings popover, after a margin change.
export function redrawCinematicPathPlot(
  popover: HTMLElement,
  previewMargins?: Partial<CinematicMargins>
): void {
  const container = popover.querySelector<HTMLElement>(`.${CINEMATIC_PATH_PLOT_CLASS}`);
  if (container) redraw(container, previewMargins);
}

function mount(container: HTMLElement, props: CinematicPathPlotProps): void {
  if (plots.has(container)) return;
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  plots.set(container, {
    props,
    lastCinematic: {},
    showingLastPath: false,
    requestedSignature: null,
    firstCropTime: null,
    series: [],
    laneSlots: 0,
    base: document.createElement('canvas'),
    drawnPlayhead: null,
  });
  // The ref fires before lit renders the view buttons, which the first draw highlights.
  queueMicrotask(() => redraw(container));

  // The time axis spans the crop points, inside the plot's padding.
  const seekTimeAt = (e: MouseEvent): number => {
    const input = props.input();
    const duration = plots.get(container)?.series[0]?.duration;
    if (!input || duration == null) return props.currentTime();
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH_PX;
    const t = ((x - PAD.left) / (WIDTH_PX - PAD.left - PAD.right)) * duration;
    return input.cropMap[0].x + Math.min(Math.max(t, 0), duration);
  };
  canvas.addEventListener('pointerdown', props.seekOnRightDrag(canvas, seekTimeAt), true);
  // The right-click menu would cover the plot.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // A solve finishes after the margins settle, so the plot redraws when it does.
  const onSolved = (): void => redraw(container);
  document.addEventListener(CINEMATIC_PATH_SOLVED_EVENT, onSolved);
  // Runs while the popover is open, and redraws only when the playhead moves.
  const followPlayhead = (): void => {
    const state = plots.get(container);
    if (!container.isConnected || !state) {
      document.removeEventListener(CINEMATIC_PATH_SOLVED_EVENT, onSolved);
      return;
    }
    const t = state.firstCropTime != null ? props.currentTime() - state.firstCropTime : null;
    if (t !== state.drawnPlayhead) {
      state.drawnPlayhead = t;
      drawPlayhead(canvas, state, window.devicePixelRatio || 1);
    }
    requestAnimationFrame(followPlayhead);
  };
  requestAnimationFrame(followPlayhead);
}

// Shows or hides an axis's lane. The last lane shown stays, so the plot is never empty.
function toggleAxis(e: Event, axis: CinematicPlotAxis): void {
  const container = (e.currentTarget as HTMLElement).closest<HTMLElement>(
    `.${CINEMATIC_PATH_PLOT_CLASS}`
  );
  const state = container && plots.get(container);
  if (!container || !state) return;
  // A click acts on the lanes as shown, even when they are shown because none was on.
  const shown = shownLanes(state.props.input());
  shown.forEach((lane) => shownAxes.add(lane));
  if (!shown.includes(axis)) shownAxes.add(axis);
  else if (shown.length > 1) shownAxes.delete(axis);
  redraw(container);
}

const axisToggle = (axis: CinematicPlotAxis, title: string) =>
  html`<button
    type="button"
    class="settings-toggle ytc-cinematic-plot-axis-button"
    data-cinematic-plot-axis=${axis}
    title=${title}
    @click=${(e: Event) => toggleAxis(e, axis)}
  >
    ${AXIS_LABELS[axis]}
  </button>`;

function toggleLayer(e: Event, layer: PlotLayer): void {
  const container = (e.currentTarget as HTMLElement).closest<HTMLElement>(
    `.${CINEMATIC_PATH_PLOT_CLASS}`
  );
  if (hiddenLayers.has(layer)) hiddenLayers.delete(layer);
  else hiddenLayers.add(layer);
  if (container) redraw(container);
}

// Click a layer to hide it or show it again.
const legendItem = (layer: PlotLayer, label: string) =>
  html`<button
    type="button"
    class="ytc-cinematic-plot-legend-item"
    data-plot-layer=${layer}
    title="Show or hide ${label}"
    @click=${(e: Event) => toggleLayer(e, layer)}
  >
    <i class=${layer}></i>${label}
  </button>`;

// The marker pair's crop center and zoom over time: the crop points with their margins and the path
// of each crop easing, so the margins can be tuned by eye.
export function CinematicPathPlot(p: CinematicPathPlotProps): TemplateResult {
  return html`
    <div
      class=${CINEMATIC_PATH_PLOT_CLASS}
      ${ref((el) => {
        if (el instanceof HTMLElement) mount(el, p);
      })}
    >
      <div class="ytc-cinematic-plot-header">
        <span>Crop Path</span>
        <span class="ytc-cinematic-plot-axes" role="group" aria-label="Plotted axes">
          ${axisToggle('x', 'Show or hide the horizontal crop center')}
          ${axisToggle('y', 'Show or hide the vertical crop center')}
          ${axisToggle('zoom', 'Show or hide the zoom, with the zoom margin')}
        </span>
      </div>
      <canvas
        class="ytc-cinematic-plot-canvas"
        role="img"
        aria-label="The crop center and zoom over the marker pair's time, with the crop points, margins, and the Cinematic, Smooth Track and EaseInOut paths"
      ></canvas>
      <div class="ytc-cinematic-plot-legend" role="group" aria-label="Plotted layers">
        ${legendItem('points', 'Crop Points')} ${legendItem('band', 'Margin')}
        ${legendItem('cinematic', 'Cinematic')} ${legendItem('smoothTrack', 'Smooth Track')}
        ${legendItem('easeInOut', 'EaseInOut')}
      </div>
    </div>
  `;
}
