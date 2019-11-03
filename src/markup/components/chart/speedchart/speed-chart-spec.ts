import { ChartConfiguration, ChartPoint } from 'chart.js';
import { medgrey, getSpeedPointColor, lightgrey } from '../chartutil';
import { scatterChartSpec } from '../scatterChartSpec';
import Chart from 'chart.js';
const speedChartConfig: ChartConfiguration = {
  data: {
    datasets: [
      {
        label: 'Speed',
        lineTension: 0,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: getSpeedPointColor,
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
  },
};

export const speedChartSpec = Chart.helpers.merge(scatterChartSpec, speedChartConfig);
