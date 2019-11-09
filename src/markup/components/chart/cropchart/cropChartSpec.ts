import { ChartConfiguration, ChartPoint } from 'chart.js';
import { medgrey, lightgrey } from '../chartutil';
import { scatterChartSpec, getScatterPointColor } from '../scatterChartSpec';
import Chart from 'chart.js';

const inputId = 'crop-input';
const cropPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nC:${point.crop}`;
};
const cropChartConfig: ChartConfiguration = {
  data: {
    datasets: [
      {
        label: 'Crop',
        lineTension: 0,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: getScatterPointColor,
        pointBorderColor: medgrey(0.7),
        pointRadius: 5,
        pointHoverRadius: 4,
        pointHoverBorderWidth: 1.5,
        pointHoverBorderColor: lightgrey(0.8),
        pointHitRadius: 4,
      },
    ],
  },
  options: {
    scales: {
      yAxes: [
        {
          scaleLabel: {
            display: false,
            padding: 0,
          },
        },
      ],
    },
    plugins: {
      datalabels: {
        formatter: cropPointFormatter,
      },
    },
    dragY: false,
    dragX: true,
  },
};

export const cropChartSpec: ChartConfiguration = Chart.helpers.merge(
  scatterChartSpec(inputId),
  cropChartConfig
);
