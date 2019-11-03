import { ChartOptions, ChartFontOptions } from 'chart.js';
import { createRounder, toHHMMSSTrimmed } from '../../util';
export const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

export const lightgrey = (opacity: number) => `rgba(120, 120, 120, ${opacity})`;
export const medgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
export const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

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

export const roundX = createRounder(0.05, 2);
export const roundY = createRounder(0.05, 2);

export function getSpeedPointColor(context) {
  var index = context.dataIndex;
  var value = context.dataset.data[index];
  return value.y <= 1
    ? `rgba(255, ${100 * value.y}, 100, 0.9)`
    : `rgba(${130 - 90 * (value.y - 1)}, 100, 245, 0.9)`;
}

export function updateSpeedInput(newSpeed?: number) {
  const speedInput = document.getElementById('speed-input') as HTMLInputElement;
  if (speedInput) {
    if (newSpeed) speedInput.value = newSpeed.toString();
    speedInput.dispatchEvent(new Event('change'));
  }
}

export function getSpeedChartBounds(chartInstance) {
  const speedChartBounds = {
    XMinBound: chartInstance.options.scales.xAxes[0].ticks.min,
    XMaxBound: chartInstance.options.scales.xAxes[0].ticks.max,
    YMinBound: 0.05,
    YMaxBound: 2,
  };
  return speedChartBounds;
}

export const display = function(context) {
  return context.active ? true : 'auto';
};

export const align = function(context) {
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
};

export const onHover = (event, chartElement) => {
  event.target.style.cursor = chartElement[0] ? 'grab' : 'default';
};

export const onDragStart = function(e, chartInstance, element) {
  // console.log(e, element);
  chartInstance.options.plugins.zoom.pan.enabled = false;
  event.target.style.cursor = 'grabbing';
  chartInstance.update();
};

export const onDrag = function(
  e,
  chartInstance,
  datasetIndex,
  index,
  fromValue,
  toValue
) {
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
  if (toValue.y < speedChartBounds.YMinBound || toValue.y > speedChartBounds.YMaxBound) {
    shouldDrag.dragY = false;
  }

  return shouldDrag;
};

export const onDragEnd = function(e, chartInstance, datasetIndex, index, value) {
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
};

export const onClick = function(event, dataAtClick) {
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
};
