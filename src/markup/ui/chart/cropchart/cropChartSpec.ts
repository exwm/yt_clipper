import Chart, { ChartConfiguration, ChartPoint } from 'chart.js';
import { CropPoint } from '../../../@types/yt_clipper';
import { appState } from '../../../appState';
import { assertDefined, clampNumber } from '../../../util/util';
import { medgrey } from '../chartPrimitives';
import { scatterChartSpec } from '../scatterChartSpec';
import { isReframeEnabled } from '../../../crop/video-zoom-controller';
import { getCropPointMainLabel } from './crop-point-labels';
import { cropSectionColor, cropZoomWidth, getCropSectionInfo } from './crop-section';
import isEqual from 'lodash.isequal';

const inputId = 'crop-input';
export enum cropChartMode {
  Start,
  End,
}
export let currentCropChartMode = cropChartMode.Start;

export function setCropChartMode(mode: cropChartMode) {
  currentCropChartMode = mode;
}

// Whether the selected crop point shows its highlight. Reframe hides it between keyframes, where a
// manipulation creates a NEW point rather than editing the selected one, so no existing point is the
// target. Any explicit selection (setCurrentCropPoint) turns it back on.
let cropPointHighlightVisible = true;
export function setCropPointHighlightVisible(visible: boolean) {
  cropPointHighlightVisible = visible;
}
export function isCropPointHighlightVisible(): boolean {
  return cropPointHighlightVisible;
}
function isSelectedCropPoint(index: number): boolean {
  return cropPointHighlightVisible && index === appState.currentCropPointIndex;
}

export function setCurrentCropPoint(
  cropChart: Chart | null,
  cropPointIndex: number,
  mode?: cropChartMode,
  // The reframe per-frame loop selects the keyframe under the playhead. A full
  // renderSpeedAndCropUI per frame is a heavy synchronous re-render that stutters the
  // preview (output is unaffected — it has no chart). Pass `false` to update only the
  // selection STATE (index/section) and skip the chart entirely — even a light
  // chart.update glitched point rendering under frame-stepping's rapid updates. The
  // chart's highlight refreshes on the next full render; the video keyframe indicator
  // already shows on/between state live.
  rerender = true
) {
  // An explicit selection always shows its highlight (reframe hides it between keyframes elsewhere).
  cropPointHighlightVisible = true;
  const maxIndex = cropChart?.data.datasets?.[0].data
    ? cropChart.data.datasets[0].data.length - 1
    : 1;
  const newCropPointIndex = clampNumber(cropPointIndex, 0, maxIndex);
  const cropPointIndexChanged = appState.currentCropPointIndex !== newCropPointIndex;
  appState.currentCropPointIndex = newCropPointIndex;

  const oldCropChartSection = currentCropChartSection;

  if (appState.currentCropPointIndex <= 0) {
    setCropChartMode(cropChartMode.Start);
    setCurrentCropChartSection(cropChart, [0, 1]);
  } else if (appState.currentCropPointIndex >= maxIndex) {
    setCropChartMode(cropChartMode.End);
    setCurrentCropChartSection(cropChart, [maxIndex - 1, maxIndex]);
  } else {
    if (mode != null) currentCropChartMode = mode;
    currentCropChartMode === cropChartMode.Start
      ? setCurrentCropChartSection(cropChart, [
          appState.currentCropPointIndex,
          appState.currentCropPointIndex + 1,
        ])
      : setCurrentCropChartSection(cropChart, [
          appState.currentCropPointIndex - 1,
          appState.currentCropPointIndex,
        ]);
  }
  const cropChartSectionChanged = !isEqual(currentCropChartSection, oldCropChartSection);
  if (rerender && (cropPointIndexChanged || cropChartSectionChanged) && cropChart) {
    cropChart.renderSpeedAndCropUI(true, false);
  }
}

export let currentCropChartSection: [number, number] = [0, 1];
export function setCurrentCropChartSection(
  cropChart: Chart | null,
  [left, right]: [number, number]
) {
  const maxIndex = cropChart?.data.datasets?.[0].data
    ? cropChart.data.datasets[0].data.length - 1
    : 1;

  if (left <= 0) {
    currentCropChartSection = [0, 1];
  } else if (left >= maxIndex) {
    currentCropChartSection = [maxIndex - 1, maxIndex];
  } else if (left === right) {
    currentCropChartSection = [left, left + 1];
  } else {
    currentCropChartSection = [left, right];
  }
}

export const updateCurrentCropPoint = function (cropChart: Chart, cropString: string) {
  const cropChartDatasets = cropChart.data.datasets;
  assertDefined(cropChartDatasets, 'Expected crop chart datasets');
  const cropChartData = cropChartDatasets[0].data;
  assertDefined(cropChartData, 'Expected crop chart data');
  const cropPoint = cropChartData[appState.currentCropPointIndex] as CropPoint;
  cropPoint.crop = cropString;
  cropChart.update();
};

// Position and size share one label (positioned per alignDataLabel, inherited from the shared scatter
// spec); time gets its own label pinned below the point instead.
function formatCropPointMainLabel(_point, ctx) {
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  return getCropPointMainLabel(
    ctx.dataset.data as CropPoint[],
    ctx.dataIndex,
    markerPair?.enableZoomPan
  );
}

function formatCropPointTimeLabel(point) {
  return `${point.x.toFixed(2)}`;
}

function getCropPointStyle(ctx) {
  const index = ctx.dataIndex;
  return isSelectedCropPoint(index) ? 'rectRounded' : 'circle';
}

function getCropPointColor(ctx) {
  const index = ctx.dataIndex;
  // Reframe auto-key shows a single playhead-driven selection (the current-time
  // point), not the start/end section pair.
  if (isReframeEnabled()) {
    return isSelectedCropPoint(index) ? 'green' : 'red';
  }
  if (index === currentCropChartSection[0]) {
    return 'green';
  } else if (index === currentCropChartSection[1]) {
    return 'yellow';
  } else {
    return 'red';
  }
}

function getCropPointBackgroundOverlayColor(ctx) {
  const cropPoint = ctx.dataset.data[ctx.dataIndex] as CropPoint;
  return cropPoint.easeIn === 'instant' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)';
}

function getCropPointBorderColor(ctx) {
  const index = ctx.dataIndex;
  return isSelectedCropPoint(index) ? 'black' : medgrey(0.9);
}

function getCropPointBorderWidth(ctx) {
  const index = ctx.dataIndex;
  return isSelectedCropPoint(index) ? 2 : 1;
}

function getCropPointRadius(ctx) {
  const index = ctx.dataIndex;
  return isSelectedCropPoint(index) ? 6 : 4;
}

const cropChartConfig: ChartConfiguration = {
  data: {
    datasets: [
      {
        label: 'Crop',
        lineTension: 0,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: getCropPointColor,
        pointBorderColor: getCropPointBorderColor,
        pointBorderWidth: getCropPointBorderWidth,
        pointStyle: getCropPointStyle,
        pointRadius: getCropPointRadius,
        backgroundOverlayColor: getCropPointBackgroundOverlayColor,
        backgroundOverlayMode: 'multiply',
        pointHitRadius: 3,
      } as any,
    ],
  },
  options: {
    // Colored per-section segments are drawn by cropSectionPlugin; hide the default single-color
    // connecting line so it does not sit under them.
    elements: { line: { borderColor: 'rgba(0,0,0,0)' } },
    scales: {
      yAxes: [{ display: false }],
    },
    plugins: {
      datalabels: {
        font: {
          size: 10,
          weight: 'normal',
        },
        // A bit more room than the plugin's 4px default; inherited by both labels below.
        offset: 6,
        labels: {
          main: {
            formatter: formatCropPointMainLabel,
          },
          time: {
            formatter: formatCropPointTimeLabel,
            align: 'bottom',
            anchor: 'center',
          },
        },
      },
    },
    dragY: false,
    dragX: true,
  },
};

// A small filled triangle (arrowhead) just outside a point, pointing in the unit direction (ux, uy)
// of the pan to the next point. Shows which way the crop center is moving; the band carries magnitude.
function drawPanArrowhead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  pointRadius: number,
  color: string
) {
  const baseDist = pointRadius + 1;
  const tipDist = baseDist + 6;
  const halfWidth = 3.5;
  const px = -uy; // perpendicular to the direction, for the base corners
  const py = ux;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx + ux * tipDist, cy + uy * tipDist);
  ctx.lineTo(cx + ux * baseDist + px * halfWidth, cy + uy * baseDist + py * halfWidth);
  ctx.lineTo(cx + ux * baseDist - px * halfWidth, cy + uy * baseDist - py * halfWidth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'black';
  ctx.stroke();
  ctx.restore();
}

// Chart.js v2 has no scriptable per-segment line styling, so draw each section (the span between
// consecutive crop points) here: colored by type (static / pan / pan+zoom) with width and opacity
// scaled by the average velocity of change. Drawn before the dataset so the points sit on top (the
// default connecting line is disabled in the config above). A pan arrowhead per point is drawn after,
// extruded from the point perimeter toward the next point.
const cropSectionPlugin = {
  beforeDatasetsDraw(chart: Chart) {
    const data = chart.data.datasets?.[0]?.data as CropPoint[] | undefined;
    const meta = chart.getDatasetMeta(0);
    const ctx = chart.ctx;
    if (!data || !meta?.data || !ctx) return;
    const { cropResWidth, cropResHeight } = appState.settings;
    const count = Math.min(data.length, meta.data.length);
    for (let i = 0; i < count - 1; i++) {
      const v0 = (meta.data[i] as any)?._view;
      const v1 = (meta.data[i + 1] as any)?._view;
      if (!v0 || !v1) continue;
      const info = getCropSectionInfo(
        data[i].crop,
        data[i + 1].crop,
        data[i].x,
        data[i + 1].x,
        cropResWidth,
        cropResHeight
      );
      // Draw the segment as a tapered band: each endpoint's width is its crop's zoom level (narrower
      // when zoomed in), so the band tapers toward the zoom and joins smoothly at shared points. nx/ny
      // is the unit perpendicular used to offset the two edges.
      const w0 = cropZoomWidth(info.leftSize);
      const w1 = cropZoomWidth(info.rightSize);
      const dx = v1.x - v0.x;
      const dy = v1.y - v0.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(v0.x + (nx * w0) / 2, v0.y + (ny * w0) / 2);
      ctx.lineTo(v1.x + (nx * w1) / 2, v1.y + (ny * w1) / 2);
      ctx.lineTo(v1.x - (nx * w1) / 2, v1.y - (ny * w1) / 2);
      ctx.lineTo(v0.x - (nx * w0) / 2, v0.y - (ny * w0) / 2);
      ctx.closePath();
      ctx.fillStyle = cropSectionColor(info.type, info.velocity);
      ctx.fill();
      ctx.restore();
    }
  },
  afterDatasetsDraw(chart: Chart) {
    const data = chart.data.datasets?.[0]?.data as CropPoint[] | undefined;
    const meta = chart.getDatasetMeta(0);
    const ctx = chart.ctx;
    if (!data || !meta?.data || !ctx) return;
    const { cropResWidth, cropResHeight } = appState.settings;
    const count = Math.min(data.length, meta.data.length);
    for (let i = 0; i < count - 1; i++) {
      const v = (meta.data[i] as any)?._view;
      if (!v) continue;
      const info = getCropSectionInfo(
        data[i].crop,
        data[i + 1].crop,
        data[i].x,
        data[i + 1].x,
        cropResWidth,
        cropResHeight
      );
      if (info.type !== 'pan' && info.type !== 'panzoom') continue;
      const mag = Math.hypot(info.panX, info.panY);
      if (mag < 1e-6) continue;
      // Constant red, matching the default crop point color, so the direction reads at any speed.
      drawPanArrowhead(ctx, v.x, v.y, info.panX / mag, info.panY / mag, v.radius ?? 4, 'red');
    }
  },
};

export function getCropChartConfig(): ChartConfiguration {
  const config: ChartConfiguration = Chart.helpers.merge(
    scatterChartSpec('crop', inputId),
    cropChartConfig
  );
  // Attach after the merge: Chart.helpers.merge would mangle the plugin's function members.
  config.plugins = [cropSectionPlugin];
  return config;
}
