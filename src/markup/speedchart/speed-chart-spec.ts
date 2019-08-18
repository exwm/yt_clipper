import { ChartConfiguration, ChartOptions, ChartFontOptions, ChartPoint } from 'chart.js';
import { createRounder, toHHMMSSTrimmed } from '../util';
const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

const lightgrey = (opacity: number) => `rgba(120, 120, 120, ${opacity})`;
const medgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

export const speedPointRawSecondsFormatter = (point) => {
  return `T:${point.x.toFixed(2)}\nS:${+point.y.toFixed(2)}`;
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

const roundX = createRounder(0.05, 2);
const roundY = createRounder(0.05, 2);

function getSpeedPointColor(context) {
  var index = context.dataIndex;
  var value = context.dataset.data[index];
  return value.y <= 1
    ? `rgba(255, ${100 * value.y}, 100, 0.9)`
    : `rgba(${130 - 90 * (value.y - 1)}, 100, 245, 0.9)`;
}

function updateSpeedInput(newSpeed?: number) {
  const speedInput = document.getElementById('speed-input') as HTMLInputElement;
  if (speedInput) {
    if (newSpeed) speedInput.value = newSpeed.toString();
    speedInput.dispatchEvent(new Event('change'));
  }
}

function getSpeedChartBounds(chartInstance) {
  const speedChartBounds = {
    XMinBound: chartInstance.options.scales.xAxes[0].ticks.min,
    XMaxBound: chartInstance.options.scales.xAxes[0].ticks.max,
    YMinBound: 0.05,
    YMaxBound: 2,
  };
  return speedChartBounds;
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
    onHover: (event, chartElement) => {
      event.target.style.cursor = chartElement[0] ? 'grab' : 'default';
    },
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
    onDragStart: function(e, chartInstance, element) {
      // console.log(e, element);
      chartInstance.options.plugins.zoom.pan.enabled = false;
      event.target.style.cursor = 'grabbing';
      chartInstance.update();
    },
    onDrag: function(e, chartInstance, datasetIndex, index, fromValue, toValue) {
      // console.log(datasetIndex, index, fromValue, toValue);
      const shouldDrag = {
        dragX: true,
        dragY: true,
      };
      const speedChartBounds = getSpeedChartBounds(chartInstance);
      if (
        fromValue.x <= speedChartBounds.XMinBound ||
        fromValue.x >= speedChartBounds.XMaxBound ||
        toValue.x <= speedChartBounds.XMinBound ||
        toValue.x >= speedChartBounds.XMaxBound
      ) {
        shouldDrag.dragX = false;
      }
      if (
        toValue.y < speedChartBounds.YMinBound ||
        toValue.y > speedChartBounds.YMaxBound
      ) {
        shouldDrag.dragY = false;
      }

      return shouldDrag;
    },
    onDragEnd: function(e, chartInstance, datasetIndex, index, value) {
      // console.log(datasetIndex, index, value);
      if (index === 0) {
        updateSpeedInput(value.y);
      } else {
        updateSpeedInput();
      }
      chartInstance.data.datasets[datasetIndex].data.sort(sortX);
      chartInstance.options.plugins.zoom.pan.enabled = true;
      event.target.style.cursor = 'default';
      chartInstance.update({ duration: 0 });
    },
    onClick: function(event, dataAtClick) {
      if (
        event.button === 0 &&
        !event.ctrlKey &&
        !event.altKey &&
        event.shiftKey &&
        dataAtClick.length === 0
      ) {
        // console.log(element, dataAtClick);

        let valueX, valueY;
        valueX = this.scales['x-axis-1'].getValueForPixel(event.offsetX);
        valueY = this.scales['y-axis-1'].getValueForPixel(event.offsetY);

        if (valueX && valueY) {
          const speedChartBounds = getSpeedChartBounds(this);
          if (
            valueX <= speedChartBounds.XMinBound ||
            valueX >= speedChartBounds.XMaxBound ||
            valueY < speedChartBounds.YMinBound ||
            valueY > speedChartBounds.YMaxBound
          ) {
            return;
          }
          valueX = roundX(valueX);
          valueY = roundY(valueY);

          this.data.datasets[0].data.push({
            x: valueX,
            y: valueY,
          });

          this.data.datasets[0].data.sort(sortX);
          updateSpeedInput();
          this.update();
        }
      }

      if (
        event.button === 0 &&
        !event.ctrlKey &&
        event.altKey &&
        event.shiftKey &&
        dataAtClick.length === 1
      ) {
        const datum = dataAtClick[0];
        if (datum) {
          const datasetIndex = datum['_datasetIndex'];
          const index = datum['_index'];
          let speedChartMinBound = this.options.scales.xAxes[0].ticks.min;
          let speedChartMaxBound = this.options.scales.xAxes[0].ticks.max;
          let dataRef = this.data.datasets[datasetIndex].data;
          if (
            dataRef[index].x !== speedChartMinBound &&
            dataRef[index].x !== speedChartMaxBound
          ) {
            dataRef.splice(index, 1);
            updateSpeedInput();
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
