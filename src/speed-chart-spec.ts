import { ChartConfiguration, ChartOptions, ChartFontOptions, ChartPoint } from 'chart.js';
import { createRounder, toHHMMSSTrimmed } from './util';
import { player } from './yt_clipper';
const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

const lightgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

export const speedPointRawSecondsFormatter = (point) => {
  return `T:${point.x.toFixed(1)}\nS:${+point.y.toFixed(2)}`;
};
export const speedPointHHMMSSFormatter = (point) => {
  return `T:${+toHHMMSSTrimmed(point.x)}\nS:${+point.y.toFixed(2)}`;
};

export const cubicInOutTension = 0.6;

export const global: ChartOptions & ChartFontOptions = {
  defaultColor: 'rgba(255, 255, 255, 1)',
  defaultFontSize: 16,
  defaultFontStyle: 'bold',
  defaultFontColor: lightgrey(1),
  maintainAspectRatio: false,
  hover: { mode: 'nearest' },
  animation: { duration: 0 },
};

const roundX = createRounder(0.1, 1);
const roundY = createRounder(0.05, 2);

function getSpeedPointColor(context) {
  var index = context.dataIndex;
  var value = context.dataset.data[index];
  return value.y <= 1
    ? `rgba(255, ${100 * value.y}, 100, 0.9)`
    : `rgba(${130 - 90 * (value.y - 1)}, 100, 245, 0.9)`;
}

export const options: ChartConfiguration = {
  type: 'scatter',
  data: {
    datasets: [
      {
        label: 'Speed',
        lineTension: 0,
        data: [] as ChartPoint[],
        showLine: true,
        pointBackgroundColor: getSpeedPointColor,
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
          const index = context.dataIndex;
          // const value = context.dataset.data[index];
          if (index === 0) {
            return 'right';
          } else if (index === context.dataset.data.length - 1) {
            return 'left';
          } else if (context.dataset.data[context.dataIndex].y > 1.85) {
            return 'start';
          } else {
            return 'end';
          }
        },
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
      chartInstance.update();
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
      if (index === 0) {
        const speedInput = document.getElementById('speed-input') as HTMLInputElement;
        if (speedInput) {
          speedInput.value = value.y.toString();
          speedInput.dispatchEvent(new Event('change'));
        }
      }
      chartInstance.data.datasets[datasetIndex].data.sort(sortX);
      chartInstance.options.plugins.zoom.pan.enabled = true;
      chartInstance.update({ duration: 0 });
    },

    onClick: function(event, dataAtClick) {
      if (!event.ctrlKey && !event.altKey && event.shiftKey && dataAtClick.length === 0) {
        // console.log(element, dataAtClick);

        let valueX, valueY;
        valueX = this.scales['x-axis-1'].getValueForPixel(event.offsetX);
        valueY = this.scales['y-axis-1'].getValueForPixel(event.offsetY);

        if (valueX && valueY) {
          valueX = roundX(valueX);
          valueY = roundY(valueY);

          this.data.datasets[0].data.push({
            x: valueX,
            y: valueY,
          });

          this.data.datasets[0].data.sort(sortX);
          this.update();
        }
      }

      if (!event.ctrlKey && event.altKey && !event.shiftKey) {
        player.seekTo(this.scales['x-axis-1'].getValueForPixel(event.offsetX));
      }

      if (!event.ctrlKey && event.altKey && event.shiftKey && dataAtClick.length === 1) {
        const datum = dataAtClick[0];
        if (datum) {
          const datasetIndex = datum['_datasetIndex'];
          const index = datum['_index'];
          let dataRef = this.data.datasets[datasetIndex].data;
          if (dataRef[index].x !== 0 && dataRef[index].x !== 10) {
            dataRef.splice(index, 1);
            this.update();
          }
        }
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey) {
        this.resetZoom();
      }
    },
  },
};
