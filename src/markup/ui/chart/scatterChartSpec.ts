import { ChartConfiguration, ChartFontOptions, ChartOptions } from 'chart.js';
import { createDraft } from 'immer';
import { CropPoint } from '../../@types/yt_clipper';
import { getMarkerPairHistory, saveMarkerPairHistory } from '../../util/undoredo';
import { seekToSafe, timeRounder } from '../../util/util';
import {
  markerPairs,
  prevSelectedMarkerPairIndex,
  triggerCropChartLoop,
  video,
} from '../../yt_clipper';
import { getInputUpdater, grey, lightgrey, medgrey, roundX, roundY, sortX } from './chartutil';
import {
  cropChartMode,
  currentCropPointIndex,
  setCurrentCropPoint,
} from './cropchart/cropChartSpec';

export const scatterChartDefaults: ChartOptions & ChartFontOptions = {
  defaultColor: 'rgba(255, 255, 255, 1)',
  defaultFontSize: 16,
  defaultFontStyle: 'bold',
  defaultFontColor: lightgrey(1),
  maintainAspectRatio: false,
  hover: { mode: 'nearest' },
  animation: { duration: 0 },
};

export function getScatterPointColor(context) {
  var index = context.dataIndex;
  var value = context.dataset.data[index];
  return value.y <= 1
    ? `rgba(255, ${100 * value.y}, 100, 0.9)`
    : `rgba(${130 - 90 * (value.y - 1)}, 100, 245, 0.9)`;
}

function getScatterChartBounds(chartInstance) {
  const scatterChartBounds = {
    XMinBound: chartInstance.options.scales.xAxes[0].ticks.min,
    XMaxBound: chartInstance.options.scales.xAxes[0].ticks.max,
    YMinBound: 0.05,
    YMaxBound: 2,
  };
  return scatterChartBounds;
}

function displayDataLabel(context) {
  return context.active ? true : 'auto';
}

function alignDataLabel(context) {
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
}

export const addSpeedPoint = function (time, speed) {
  // console.log(element, dataAtClick);

  if (time && speed) {
    const scatterChartBounds = getScatterChartBounds(this);
    if (
      time <= scatterChartBounds.XMinBound ||
      time >= scatterChartBounds.XMaxBound ||
      speed < scatterChartBounds.YMinBound ||
      speed > scatterChartBounds.YMaxBound
    ) {
      return;
    }

    time = roundX(time);
    speed = roundY(speed);

    const markerPair = markerPairs[prevSelectedMarkerPairIndex];
    const initialState = getMarkerPairHistory(markerPair);
    const draft = createDraft(initialState);

    draft.speedMap.push({
      x: time,
      y: speed,
    });

    draft.speedMap.sort(sortX);

    saveMarkerPairHistory(draft, markerPair);
    this.renderSpeedAndCropUI(true);
  }
};

export const addCropPoint = function (time: number) {
  // console.log(element, dataAtClick);

  if (time) {
    const scatterChartBounds = getScatterChartBounds(this);
    if (time <= scatterChartBounds.XMinBound || time >= scatterChartBounds.XMaxBound) {
      return;
    }
    time = roundX(time);

    const markerPair = markerPairs[prevSelectedMarkerPairIndex];
    const initialState = getMarkerPairHistory(markerPair);
    const draft = createDraft(initialState);

    draft.cropMap.push({
      x: time,
      y: 0,
      crop: '0:0:iw:ih',
    });
    draft.cropMap.sort(sortX);

    const cropPointIndex = draft.cropMap.map((cropPoint) => cropPoint.x).indexOf(time);

    // console.log(currentCropPointIndex, cropPointIndex);
    if (currentCropPointIndex >= cropPointIndex) {
      setCurrentCropPoint(this, currentCropPointIndex + 1);
    }

    if (cropPointIndex > 0) {
      const prevCropPointIndex = cropPointIndex - 1;
      draft.cropMap[cropPointIndex].crop = draft.cropMap[prevCropPointIndex].crop;
    }

    saveMarkerPairHistory(draft, markerPair);
    this.renderSpeedAndCropUI(true);
  }
};

export function scatterChartSpec(chartType: 'speed' | 'crop', inputId): ChartConfiguration {
  const updateInput = getInputUpdater(inputId);

  const onDragStart = function (e, chartInstance, element, value) {
    // console.log(arguments);
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      chartInstance.options.plugins.zoom.pan.enabled = false;
      e.target.style.cursor = 'grabbing';
      if (chartType === 'crop') {
        seekToSafe(video, timeRounder(value.x));
      }
      chartInstance.update();
    }
  };

  const onDrag = function (e, chartInstance, datasetIndex, index, fromValue, toValue) {
    // console.log(datasetIndex, index, fromValue, toValue);
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      const shouldDrag = {
        dragX: true,
        dragY: true,
        chartType,
      };

      const scatterChartBounds = getScatterChartBounds(chartInstance);
      if (
        fromValue.x <= scatterChartBounds.XMinBound ||
        fromValue.x >= scatterChartBounds.XMaxBound ||
        toValue.x <= scatterChartBounds.XMinBound ||
        toValue.x >= scatterChartBounds.XMaxBound
      ) {
        shouldDrag.dragX = false;
      }
      if (
        chartType === 'crop' ||
        toValue.y < scatterChartBounds.YMinBound ||
        toValue.y > scatterChartBounds.YMaxBound
      ) {
        shouldDrag.dragY = false;
      }

      if (chartType === 'crop' && shouldDrag.dragX && fromValue.x != toValue.x) {
        seekToSafe(video, timeRounder(toValue.x));
      }
      return shouldDrag;
    } else {
      return {
        dragX: false,
        dragY: false,
        chartType,
      };
    }
  };

  const onDragEnd = function (e, chartInstance, datasetIndex, index, value) {
    // console.log(datasetIndex, index, value);
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      const markerPair = markerPairs[prevSelectedMarkerPairIndex];
      const draft = createDraft(getMarkerPairHistory(markerPair));
      const draftMap = chartType === 'crop' ? draft.cropMap : draft.speedMap;

      let currentCropPointXPreSort =
        chartType === 'crop' ? draftMap[currentCropPointIndex].x : null;

      draftMap.sort(sortX);

      if (index === 0 && chartType === 'speed') {
        draft.speed = value.y;
      }

      if (chartType === 'crop') {
        const newCurrentCropPointIndex = draftMap
          .map((cropPoint) => cropPoint.x)
          .indexOf(currentCropPointXPreSort);
        setCurrentCropPoint(chartInstance, newCurrentCropPointIndex);
      }
      chartInstance.options.plugins.zoom.pan.enabled = true;
      e.target.style.cursor = 'default';

      saveMarkerPairHistory(draft, markerPair);
      chartInstance.renderSpeedAndCropUI(true);
    }
  };

  const onClick = function (event: MouseEvent, dataAtClick) {
    event.stopImmediatePropagation();
    // add chart points on shift+left-click
    if (
      event.button === 0 &&
      !event.ctrlKey &&
      !event.altKey &&
      event.shiftKey &&
      dataAtClick.length === 0
    ) {
      const time = this.scales['x-axis-1'].getValueForPixel(event.offsetX);
      if (chartType === 'speed') {
        const speed = this.scales['y-axis-1'].getValueForPixel(event.offsetY);
        addSpeedPoint.call(this, time, speed);
      } else if (chartType === 'crop') {
        addCropPoint.call(this, time);
      }
    }

    // delete chart points on alt+shift+left-click
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
        let scatterChartMinBound = this.options.scales.xAxes[0].ticks.min;
        let scatterChartMaxBound = this.options.scales.xAxes[0].ticks.max;

        const markerPair = markerPairs[prevSelectedMarkerPairIndex];
        const initialState = getMarkerPairHistory(markerPair);
        const draft = createDraft(initialState);

        let dataRef: any[];
        if (chartType === 'crop') {
          dataRef = draft.cropMap;
        } else {
          dataRef = draft.speedMap;
        }

        if (
          dataRef[index].x !== scatterChartMinBound &&
          dataRef[index].x !== scatterChartMaxBound
        ) {
          dataRef.splice(index, 1);
          if (chartType === 'crop') {
            saveMarkerPairHistory(draft, markerPair);
            this.data.datasets[0].data = markerPair.cropMap;

            if (currentCropPointIndex >= index) {
              setCurrentCropPoint(this, currentCropPointIndex - 1);
            }

            updateInput(markerPair.cropMap[currentCropPointIndex].crop);
          } else {
            saveMarkerPairHistory(draft, markerPair);
            this.data.datasets[0].data = markerPair.speedMap;
            updateInput();
          }
          this.renderSpeedAndCropUI(true);
        }
      }
    }

    // change crop point ease in function
    if (
      event.button === 0 &&
      event.ctrlKey &&
      !event.altKey &&
      event.shiftKey &&
      dataAtClick.length === 1
    ) {
      if (chartType === 'crop') {
        const datum = dataAtClick[0];
        if (datum) {
          const datasetIndex = datum['_datasetIndex'];
          const index = datum['_index'];

          const markerPair = markerPairs[prevSelectedMarkerPairIndex];
          const initialState = getMarkerPairHistory(markerPair);
          const draft = createDraft(initialState);

          if (draft.cropMap[index].easeIn == null) {
            draft.cropMap[index].easeIn = 'instant';
          } else {
            delete draft.cropMap[index].easeIn;
          }

          saveMarkerPairHistory(draft, markerPair);
          this.renderSpeedAndCropUI(true);
        }
      }
    }

    if (event.ctrlKey && !event.altKey && !event.shiftKey) {
      this.resetZoom();
    }
  };

  function onHover(e: MouseEvent, chartElements) {
    e.target.style.cursor = chartElements[0] ? 'grab' : 'default';
    if (chartType === 'crop' && !e.shiftKey && chartElements.length === 1) {
      let mode: cropChartMode;
      if (e.ctrlKey && !e.altKey) {
        mode = cropChartMode.Start;
      } else if (!e.ctrlKey && e.altKey) {
        mode = cropChartMode.End;
      } else {
        return;
      }
      const datum = chartElements[0];
      if (datum) {
        const index = datum['_index'];
        setCurrentCropPoint(this, index, mode);
        triggerCropChartLoop();
      }
    }
  }

  return {
    type: 'scatter',
    options: {
      elements: {
        line: {
          fill: true,
          backgroundColor: 'rgba(160,0, 255, 0.05)',
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
              padding: -4,
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
              major: {},
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
          display: displayDataLabel,
          align: alignDataLabel,
          color: getScatterPointColor,
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
            value: -1,
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
      dragDataRoundMultipleX: 0.01,
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
}
