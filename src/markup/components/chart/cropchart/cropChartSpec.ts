import Chart, { ChartConfiguration, ChartPoint } from 'chart.js';
import { CropPoint } from '../../../@types/yt_clipper';
import { clampNumber } from '../../../util';
import { lightgrey, medgrey } from '../chartutil';
import { scatterChartSpec } from '../scatterChartSpec';

const inputId = 'crop-input';
export let currentCropPointIndex: number = 0;
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
  const maxIndex = cropChart ? cropChart.data.datasets[0].data.length - 1 : 1;
  currentCropPointIndex = clampNumber(cropPointIndex, 0, maxIndex);

  if (cropPointIndex <= 0) {
    setCropChartMode(cropChartMode.Start);
    setCurrentCropChartSection(cropChart, [0, 1]);
  } else if (cropPointIndex >= maxIndex) {
    setCropChartMode(cropChartMode.End);
    setCurrentCropChartSection(cropChart, [maxIndex - 1, maxIndex]);
  } else {
    if (mode != null) currentCropChartMode = mode;
    currentCropChartMode === cropChartMode.Start
      ? setCurrentCropChartSection(cropChart, [
          currentCropPointIndex,
          currentCropPointIndex + 1,
        ])
      : setCurrentCropChartSection(cropChart, [
          currentCropPointIndex - 1,
          currentCropPointIndex,
        ]);
  }
}

export let currentCropChartSection: [number, number] = [0, 1];
export function setCurrentCropChartSection(
  cropChart: Chart,
  [left, right]: [number, number]
) {
  const maxIndex = cropChart ? cropChart.data.datasets[0].data.length - 1 : 1;

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

export const updateCurrentCropPoint = function(cropChart: Chart, cropString: string) {
  const cropChartData = cropChart.data.datasets[0].data;
  const cropPoint = cropChartData[currentCropPointIndex] as CropPoint;
  cropPoint.crop = cropString;
  cropChart.update();
};

const cropPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nC:${point.crop}`;
};

const cropPointXYFormatter = (point, ctx) => {
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
  return index === currentCropPointIndex ? 'rectRounded' : 'circle';
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

function getCropPointBorderColor(ctx) {
  const index = ctx.dataIndex;
  return index === currentCropPointIndex ? 'black' : medgrey(0.9);
}

function getCropPointBorderWidth(ctx) {
  const index = ctx.dataIndex;
  return index === currentCropPointIndex ? 2 : 1;
}

function getCropPointRadius(ctx) {
  const index = ctx.dataIndex;
  return index === currentCropPointIndex ? 8 : 5;
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
        pointHoverRadius: 4,
        pointHoverBorderWidth: 1.5,
        pointHoverBorderColor: lightgrey(0.8),
        pointHitRadius: 4,
      },
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
  let cropChartConfigOverrides: ChartConfiguration = {};
  if (isCropChartPanOnly) {
    cropChartConfigOverrides = {
      options: { plugins: { datalabels: { formatter: cropPointXYFormatter } } },
    };
  }

  const cropChartConfigOverridden = Chart.helpers.merge(
    cropChartConfig,
    cropChartConfigOverrides
  );
  return Chart.helpers.merge(
    scatterChartSpec('crop', inputId),
    cropChartConfigOverridden
  );
}
