import Chart from 'chart.js';
import { ChartConfiguration, ChartPoint } from 'chart.js';
import { medgrey, lightgrey } from '../chartutil';
import { scatterChartSpec } from '../scatterChartSpec';
import { CropPoint } from '../../../@types/yt_clipper';

const inputId = 'crop-input';
const cropPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nC:${point.crop}`;
};
export let currentCropPointIndex: number = 0;
export let currentCropPointType: 'start' | 'end' = 'start';
export function setCurrentCropPoint(
  cropChart: Chart,
  cropPointIndex: number,
  type?: 'start' | 'end'
) {
  currentCropPointIndex = cropPointIndex;
  if (cropChart) {
    const cropChartDataLength = cropChart.data.datasets[0].data.length;
    if (cropPointIndex === 0) {
      currentCropPointType = 'start';
    } else if (cropPointIndex === cropChartDataLength - 1) {
      currentCropPointType = 'end';
    } else if (type) {
      currentCropPointType = type;
    }
  }
}

export let currentCropChartSection: [number, number] = [0, 1];
export function setCurrentCropChartSection(
  cropChart: Chart,
  [left, right]: [number, number]
) {
  const cropChartData = cropChart.data.datasets[0].data;

  if (left <= 0) {
    currentCropChartSection = [0, 1];
  } else if (left >= cropChartData.length - 1) {
    currentCropChartSection = [cropChartData.length - 2, cropChartData.length - 1];
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

export const cropChartSpec: ChartConfiguration = Chart.helpers.merge(
  scatterChartSpec('crop', inputId),
  cropChartConfig
);
