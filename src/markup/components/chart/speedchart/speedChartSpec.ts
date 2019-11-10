import Chart from 'chart.js';
import { ChartConfiguration, ChartPoint } from 'chart.js';
import { medgrey, lightgrey } from '../chartutil';
import { scatterChartSpec, getScatterPointColor } from '../scatterChartSpec';

const inputId = 'speed-input';

const speedPointFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nS:${+point.y.toFixed(2)}`;
};

const speedChartConfig: ChartConfiguration = {
  data: {
    datasets: [
      {
        label: 'Speed',
        lineTension: 0,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: getScatterPointColor,
        pointBorderColor: medgrey(0.9),
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
            display: true,
            labelString: 'Speed',
            fontSize: 12,
            padding: 0,
          },
          gridLines: {
            color: medgrey(0.6),
            lineWidth: 1,
          },
          ticks: {
            stepSize: 0.1,
            min: 0,
            max: 2,
          },
        },
      ],
    },
    plugins: {
      datalabels: {
        formatter: speedPointFormatter,
        font: {
          size: 10,
          weight: 'normal',
        },
      },
    },
  },
};

export const speedChartSpec: ChartConfiguration = Chart.helpers.merge(
  scatterChartSpec('speed', inputId),
  speedChartConfig
);
