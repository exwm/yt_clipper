import { ChartOptions, ChartFontOptions, ChartConfiguration } from 'chart.js';
import {
  getSpeedPointColor,
  speedPointRawSecondsFormatter,
  medgrey,
  lightgrey,
  grey,
  sortX,
  display,
  align,
  onHover,
  onDragStart,
  onDrag,
  onDragEnd,
  onClick,
} from './chartutil';

export const scatterChartDefaults: ChartOptions & ChartFontOptions = {
  defaultColor: 'rgba(255, 255, 255, 1)',
  defaultFontSize: 16,
  defaultFontStyle: 'bold',
  defaultFontColor: lightgrey(1),
  maintainAspectRatio: false,
  hover: { mode: 'nearest' },
  animation: { duration: 0 },
};

export const scatterChartSpec: ChartConfiguration = {
  type: 'scatter',
  options: {
    elements: {
      line: {
        fill: true,
        backgroundColor: 'rgba(160,0, 255, 0.1)',
        borderColor: lightgrey(0.8),
        borderWidth: 2,
        borderDash: [5, 2],
      },
    },
    legend: { display: false },
    layout: {
      padding: {
        left: 0,
        right: 0,
        top: 15,
        bottom: 0,
      },
    },
    tooltips: { enabled: false },
    scales: {
      xAxes: [
        {
          scaleLabel: {
            display: true,
            labelString: 'Time (s)',
            fontSize: 12,
            padding: 0,
          },
          position: 'bottom',
          gridLines: {
            color: medgrey(0.6),
            lineWidth: 1,
          },
          ticks: {
            min: 0,
            max: 10,
            maxTicksLimit: 100,
            autoSkip: false,
            maxRotation: 60,
            minRotation: 0,
            major: { fontColor: 'red' },
            minor: {},
          },
        },
      ],
    },

    plugins: {
      datalabels: {
        clip: false,
        clamp: true,
        font: {
          size: 14,
          weight: 'bold',
        },
        textStrokeWidth: 2,
        textStrokeColor: grey(0.9),
        textAlign: 'center',
        formatter: speedPointRawSecondsFormatter,
        display: display,
        align: align,
        color: getSpeedPointColor,
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
          rangeMin: {
            x: 0,
            y: 0,
          },
          rangeMax: {
            x: 10,
            y: 2,
          },
        },
        zoom: {
          enabled: true,
          mode: 'x',
          drag: false,
          speed: 0.1,
          rangeMin: {
            x: 0,
            y: 0,
          },
          rangeMax: {
            x: 10,
            y: 2,
          },
        },
      },
    },
    annotation: {
      drawTime: 'afterDraw',
      annotations: [
        {
          label: 'time',
          type: 'line',
          mode: 'vertical',
          scaleID: 'x-axis-1',
          value: 2,
          borderColor: 'rgba(255, 0, 0, 0.9)',
          borderWidth: 1,
        },
        {
          label: 'start',
          type: 'line',
          display: true,
          mode: 'vertical',
          scaleID: 'x-axis-1',
          value: -1,
          borderColor: 'rgba(0, 255, 0, 0.9)',
          borderWidth: 1,
        },
        {
          label: 'end',
          type: 'line',
          display: true,
          mode: 'vertical',
          scaleID: 'x-axis-1',
          value: -1,
          borderColor: 'rgba(255, 215, 0, 0.9)',
          borderWidth: 1,
        },
      ],
    },
    onHover: onHover,
    dragData: true,
    dragY: true,
    dragX: true,
    dragDataRound: 0.5,
    dragDataRoundMultipleX: 0.05,
    dragDataRoundPrecisionX: 2,
    dragDataRoundMultipleY: 0.05,
    dragDataRoundPrecisionY: 2,
    dragDataSort: false,
    dragDataSortFunction: sortX,
    onDragStart: onDragStart,
    onDrag: onDrag,
    onDragEnd: onDragEnd,
    onClick: onClick,
  },
};
