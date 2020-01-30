import Chart from 'chart.js';
import { drag } from 'd3-drag';
import { select, event } from 'd3-selection';

let element, scale, scaleX, radar;

function getElement(chartInstance, callback) {
  return () => {
    if (event) {
      const e = event.sourceEvent;
      element = chartInstance.getElementAtEvent(e)[0];
      radar = chartInstance.config.type == 'radar';
      let scaleName = radar ? '_scale' : '_yScale';

      if (element) {
        if (
          chartInstance.data.datasets[element['_datasetIndex']].dragData === false ||
          element[scaleName].options.dragData === false
        ) {
          element = null;
          return;
        }

        scale = element[scaleName].id;
        if (element['_xScale']) {
          scaleX = element['_xScale'].id;
        }

        if (typeof callback === 'function' && element) {
          const datasetIndex = element['_datasetIndex'];
          const index = element['_index'];
          const value = chartInstance.data.datasets[datasetIndex].data[index];
          if (callback(e, chartInstance, element, value) === false) {
            element = null;
          }
        }
      }
    }
  };
}

export function createRounder(multiple, precision) {
  return (value) => {
    const roundedValue = Math.round(value / multiple) * multiple;
    const roundedValueFixedPrecision = +roundedValue.toFixed(precision);
    return roundedValueFixedPrecision;
  };
}

export function roundValue(value, multiple, precision) {
  return createRounder(multiple, precision)(value);
}

function updateData(chartInstance, callback) {
  return () => {
    if (element && event) {
      const e = event.sourceEvent;
      const datasetIndex = element['_datasetIndex'];
      const index = element['_index'];
      const roundMultipleX = chartInstance.options.dragDataRoundMultipleX;
      const roundPrecisionX = chartInstance.options.dragDataRoundPrecisionX;
      const roundMultipleY = chartInstance.options.dragDataRoundMultipleY;
      const roundPrecisionY = chartInstance.options.dragDataRoundPrecisionY;

      const roundX = createRounder(roundMultipleX, roundPrecisionX);
      const roundY = createRounder(roundMultipleY, roundPrecisionY);

      let x;
      let y;
      const dataRef = chartInstance.data.datasets[datasetIndex].data;
      let datumRef = dataRef[index];
      let proposedDatum = { x: datumRef.x, y: datumRef.y };

      if (radar) {
        let v;
        if (e.touches) {
          x = e.touches[0].clientX - chartInstance.canvas.getBoundingClientRect().left;
          y = e.touches[0].clientY - chartInstance.canvas.getBoundingClientRect().top;
        } else {
          x = e.clientX - chartInstance.canvas.getBoundingClientRect().left;
          y = e.clientY - chartInstance.canvas.getBoundingClientRect().top;
        }
        let rScale = chartInstance.scales[scale];
        let d = Math.sqrt(
          Math.pow(x - rScale.xCenter, 2) + Math.pow(y - rScale.yCenter, 2)
        );
        let scalingFactor = rScale.drawingArea / (rScale.max - rScale.min);
        if (rScale.options.ticks.reverse) {
          v = rScale.max - d / scalingFactor;
        } else {
          v = rScale.min + d / scalingFactor;
        }

        v = roundValue(chartInstance.options.dragDataRound, 2)(v);

        v = Math.min(v, chartInstance.scale.max);
        v = Math.max(v, chartInstance.scale.min);

        proposedDatum = v;
      } else {
        if (e.touches) {
          x = chartInstance.scales[scaleX].getValueForPixel(
            e.touches[0].clientX - chartInstance.canvas.getBoundingClientRect().left
          );
          y = chartInstance.scales[scale].getValueForPixel(
            e.touches[0].clientY - chartInstance.canvas.getBoundingClientRect().top
          );
        } else {
          x = chartInstance.scales[scaleX].getValueForPixel(
            e.clientX - chartInstance.canvas.getBoundingClientRect().left
          );
          y = chartInstance.scales[scale].getValueForPixel(
            e.clientY - chartInstance.canvas.getBoundingClientRect().top
          );
        }

        x = roundX(x);
        y = roundY(y);

        x = Math.min(x, chartInstance.scales[scaleX].max);
        x = Math.max(x, chartInstance.scales[scaleX].min);

        y = Math.min(y, chartInstance.scales[scale].max);
        y = Math.max(y, chartInstance.scales[scale].min);

        proposedDatum.x = x;
        if (datumRef.y !== undefined) {
          proposedDatum.y = y;
        } else {
          proposedDatum = y;
        }
      }

      let shouldChartUpdateX = chartInstance.options.dragX && datumRef.x !== undefined;
      let shouldChartUpdateY = chartInstance.options.dragY;
      let shouldChartUpdate;
      if (typeof callback === 'function') {
        shouldChartUpdate = callback(
          e,
          chartInstance,
          datasetIndex,
          index,
          datumRef,
          proposedDatum
        );
        shouldChartUpdateX = shouldChartUpdateX && shouldChartUpdate.dragX;
        shouldChartUpdateY = shouldChartUpdateY && shouldChartUpdate.dragY;
      }
      if (shouldChartUpdateX !== false) {
        datumRef.x = proposedDatum.x;
      }
      if (shouldChartUpdateY !== false) {
        if (datumRef.y !== undefined) {
          datumRef.y = proposedDatum.y;
        } else {
          datumRef = proposedDatum;
        }
      }
      if (shouldChartUpdateX !== false || shouldChartUpdateY !== false) {
        chartInstance.update(0);
      }
    }
  };
}

function dragEndCallback(chartInstance, callback) {
  return () => {
    if (typeof callback === 'function' && element) {
      const e = event.sourceEvent;
      const datasetIndex = element['_datasetIndex'];
      const index = element['_index'];
      const value = chartInstance.data.datasets[datasetIndex].data[index];
      return callback(e, chartInstance, datasetIndex, index, value);
    }
  };
}
const ChartJSdragDataPlugin = {
  afterInit: function(chartInstance) {
    if (chartInstance.options.dragData) {
      select(chartInstance.chart.canvas).call(
        drag()
          .container(chartInstance.chart.canvas)
          .on('start', getElement(chartInstance, chartInstance.options.onDragStart))
          .on('drag', updateData(chartInstance, chartInstance.options.onDrag))
          .on('end', dragEndCallback(chartInstance, chartInstance.options.onDragEnd))
      );
    }
  },
};

Chart.pluginService.register(ChartJSdragDataPlugin);

export default ChartJSdragDataPlugin;
