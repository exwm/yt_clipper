import Chart from 'chart.js';
import { ChartConfiguration, ChartPoint } from 'chart.js';
import { medgrey, lightgrey } from '../chartutil';
import {
  scatterChartSpec,
  getScatterPointColor as getCropPointColor,
} from '../scatterChartSpec';
import { CropPoint } from '../../../@types/yt_clipper';

const inputId = 'crop-input';
const cropPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nC:${point.crop}`;
};
export let currentCropPointIndex: number = 0;
export function setCurrentCropPointIndex(cropPointIndex: number) {
  currentCropPointIndex = cropPointIndex;
  console.log(currentCropPointIndex);
}
export const updateCurrentCropPoint = function(cropChart: Chart, cropString: string) {
  const cropChartData = cropChart.data.datasets[0].data;
  const cropPoint = cropChartData[currentCropPointIndex] as CropPoint;
  cropPoint.crop = cropString;
  cropChart.update();
};

function getCropPointColor(ctx) {
  const index = ctx.dataIndex;
  return index === currentCropPointIndex ? 'green' : 'red';
}

function getCropPointRadius(ctx) {
  const index = ctx.dataIndex;
  return index === currentCropPointIndex ? 6 : 5;
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
        pointBorderColor: medgrey(0.7),
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
