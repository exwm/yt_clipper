import { ChartConfiguration, ChartOptions, ChartFontOptions, ChartPoint } from 'chart.js';
import { toHHMMSSTrimmed } from './util';

const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

const roundValue = function(multiple: number, precision: number) {
  return (value: number) => {
    if (!isNaN(precision)) {
      let roundedValue = Math.round(value / multiple) * multiple;
      roundedValue =
        Math.round(roundedValue * Math.pow(10, precision)) / Math.pow(10, precision);
      return roundedValue;
    }
    return value;
  };
};

const lightgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

export const speedPointRawSecondsFormatter = (point) => {
  return `T:${point.x.toFixed(1)}\nS:${+point.y.toFixed(2)}`;
};
export const speedPointHHMMSSFormatter = (point) => {
  return `T:${+toHHMMSSTrimmed(point.x)}\nS:${+point.y.toFixed(2)}`;
};

export const global: ChartOptions & ChartFontOptions = {
  defaultColor: 'rgba(255, 255, 255, 1)',
  defaultFontSize: 16,
  defaultFontStyle: 'bold',
  defaultFontColor: lightgrey(1),
  maintainAspectRatio: false,
  hover: { mode: 'nearest' },
};

export const options: ChartConfiguration = {
  type: 'scatter',
  data: {
    datasets: [
      {
        label: 'Speed',
        lineTension: 1,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: 'rgba(255, 0, 0, 0.7)',
        pointBorderColor: lightgrey(0.5),
        pointRadius: 5,
        pointHoverRadius: 6,
        pointHoverBorderWidth: 1.5,
        pointHoverBorderColor: lightgrey(0.7),
        pointHitRadius: 5,
      },
    ],
  },
  options: {
    elements: {
      line: {
        fill: true,
        cubicInterpolationMode: 'monotone',
        backgroundColor: 'rgba(160,0, 255, 0.2)',
        borderColor: lightgrey(0.9),
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
            color: lightgrey(0.7),
            lineWidth: 1,
          },
          ticks: {
            min: 0,
            max: 10,
            maxTicksLimit: 100,
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            major: { fontColor: 'red' },
            minor: {},
          },
        },
      ],
      yAxes: [
        {
          scaleLabel: {
            display: true,
            labelString: 'Speed',
            fontSize: 12,
            padding: 0,
          },
          gridLines: {
            color: lightgrey(0.7),
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
        display: function(context) {
          return context.active ? true : 'auto';
        },
        align: function(context) {
          const idx = context.dataIndex;
          if (idx === 0) {
            return 'right';
          } else if (idx === context.dataset.data.length - 1) {
            return 'left';
          } else {
            return 'end';
          }
        },
        color: function(context) {
          var index = context.dataIndex;
          var value = context.dataset.data[index];
          return `rgba(255,0,0, 0.9)`;
        },
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
          type: 'line',
          mode: 'vertical',
          scaleID: 'x-axis-1',
          value: 2,
          borderColor: 'red',
          borderWidth: 1,
        },
      ],
    },
    onHover: (event, chartElement) => {
      event.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
    },
    dragData: true,
    dragY: true,
    dragX: true,
    dragDataRound: 0.5,
    dragDataRoundMultipleX: 0.1,
    dragDataRoundPrecisionX: 1,
    dragDataRoundMultipleY: 0.05,
    dragDataRoundPrecisionY: 2,
    dragDataSort: false,
    dragDataSortFunction: sortX,
    onDragStart: function(e, chartInstance, element) {
      // console.log(e, element);
      chartInstance.options.plugins.zoom.pan.enabled = false;
      chartInstance.update({ duration: 0 });
    },
    onDrag: function(e, chartInstance, datasetIndex, index, fromValue, toValue) {
      // console.log(datasetIndex, index, fromValue, toValue);
      const shouldDrag = {
        dragX: true,
        dragY: true,
      };
      if (
        fromValue.x <= chartInstance.options.scales.xAxes[0].ticks.min ||
        fromValue.x >= chartInstance.options.scales.xAxes[0].ticks.max ||
        toValue.x <= chartInstance.options.scales.xAxes[0].ticks.min ||
        toValue.x >= chartInstance.options.scales.xAxes[0].ticks.max
      ) {
        shouldDrag.dragX = false;
      }
      if (toValue.y < 0.05 || toValue.y > 2) {
        shouldDrag.dragY = false;
      }

      return shouldDrag;
    },
    onDragEnd: function(e, chartInstance, datasetIndex, index, value) {
      // console.log(datasetIndex, index, value);
      chartInstance.data.datasets[datasetIndex].data.sort(sortX);
      chartInstance.options.plugins.zoom.pan.enabled = true;
      chartInstance.update({ duration: 0 });
    },

    onClick: function(element, dataAtClick) {
      if (element.shiftKey) {
        // console.log(element, dataAtClick);

        let scaleRef, valueX, valueY;
        for (var scaleKey in this.scales) {
          scaleRef = this.scales[scaleKey];
          if (scaleRef.isHorizontal() && scaleKey == 'x-axis-1') {
            valueX = scaleRef.getValueForPixel(element.offsetX);
          } else if (scaleKey == 'y-axis-1') {
            valueY = scaleRef.getValueForPixel(element.offsetY);
          }
        }

        if (valueX && valueY) {
          valueX = roundValue(0.1, 1)(valueX);
          valueY = roundValue(0.05, 2)(valueY);

          this.data.datasets[0].data.push({
            x: valueX,
            y: valueY,
          });

          this.data.datasets[0].data.sort(sortX);
          this.update({ duration: 0 });
        }
      }

      if (element.altKey) {
        const datum = this.getElementAtEvent(element)[0];
        if (datum) {
          const datasetIndex = datum['_datasetIndex'];
          const index = datum['_index'];
          let dataRef = this.data.datasets[datasetIndex].data;
          if (dataRef[index].x !== 0 && dataRef[index].x !== 10) {
            dataRef.splice(index, 1);
            this.update({ duration: 0 });
          }
        }
      }
    },
  },
};
