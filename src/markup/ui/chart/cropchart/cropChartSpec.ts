import Chart, { ChartConfiguration, ChartPoint } from 'chart.js';
import { CropPoint } from '../../../@types/yt_clipper';
import { appState } from '../../../appState';
import { assertDefined, clampNumber } from '../../../util/util';
import { medgrey } from '../chartPrimitives';
import { scatterChartSpec } from '../scatterChartSpec';
import { isReframeEnabled } from '../../../crop/video-zoom-controller';
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

export const cropPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nC:${point.crop}`;
};

export const cropPointXYFormatter = (point, ctx) => {
  const [x, y, w, h] = point.crop.split(':');
  const index = ctx.dataIndex;

  const label =
    index === 0
      ? `T:${point.x.toFixed(2)}\nC:${x}:${y}:${w}:${h}`
      : `T:${point.x.toFixed(2)}\nC:${x}:${y}`;
  return label;
};

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
    scales: {
      yAxes: [{ display: false }],
    },
    plugins: {
      datalabels: {
        formatter: cropPointFormatter,
        font: {
          size: 10,
          weight: 'normal',
        },
      },
    },
    dragY: false,
    dragX: true,
  },
};

export function getCropChartConfig(isCropChartPanOnly: boolean): ChartConfiguration {
  let cropChartConfigOverrides: ChartConfiguration = {}; // eslint-disable-line no-useless-assignment
  if (isCropChartPanOnly) {
    cropChartConfigOverrides = {
      options: { plugins: { datalabels: { formatter: cropPointXYFormatter } } },
    };
  } else {
    cropChartConfigOverrides = {
      options: { plugins: { datalabels: { formatter: cropPointFormatter } } },
    };
  }

  const cropChartConfigOverridden = Chart.helpers.merge(cropChartConfig, cropChartConfigOverrides);
  return Chart.helpers.merge(scatterChartSpec('crop', inputId), cropChartConfigOverridden);
}
