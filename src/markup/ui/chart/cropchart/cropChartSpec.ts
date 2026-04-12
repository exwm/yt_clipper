import Chart, { ChartConfiguration, ChartPoint } from 'chart.js';
import { CropPoint } from '../../../@types/yt_clipper';
import { appState } from '../../../appState';
import { assertDefined, clampNumber } from '../../../util/util';
import { medgrey } from '../chartPrimitives';
import { scatterChartSpec } from '../scatterChartSpec';
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

export function setCurrentCropPoint(
  cropChart: Chart | null,
  cropPointIndex: number,
  mode?: cropChartMode
) {
  const maxIndex = cropChart?.data.datasets?.[0].data ? cropChart.data.datasets[0].data.length - 1 : 1;
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
  if ((cropPointIndexChanged || cropChartSectionChanged) && cropChart) {
    cropChart.renderSpeedAndCropUI(true, false);
  }
}

export let currentCropChartSection: [number, number] = [0, 1];
export function setCurrentCropChartSection(
  cropChart: Chart | null,
  [left, right]: [number, number]
) {
  const maxIndex = cropChart?.data.datasets?.[0].data ? cropChart.data.datasets[0].data.length - 1 : 1;

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
  return index === appState.currentCropPointIndex ? 'rectRounded' : 'circle';
}

function getCropPointColor(ctx) {
  const index = ctx.dataIndex;
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
  return index === appState.currentCropPointIndex ? 'black' : medgrey(0.9);
}

function getCropPointBorderWidth(ctx) {
  const index = ctx.dataIndex;
  return index === appState.currentCropPointIndex ? 2 : 1;
}

function getCropPointRadius(ctx) {
  const index = ctx.dataIndex;
  return index === appState.currentCropPointIndex ? 6 : 4;
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
