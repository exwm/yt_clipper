import { ChartConfiguration, ChartFontOptions, ChartOptions } from 'chart.js';
import { createDraft } from 'immer';
import { getMarkerPairHistory, saveMarkerPairHistory } from '../../util/undoredo';
import { seekToSafe, timeRounder } from '../../util/util';
import { triggerCropChartUpdates } from '../../charts';
import { appState } from '../../appState';
import {
  getInputUpdater,
  grey,
  lightgrey,
  medgrey,
  roundX,
  roundY,
  sortX,
} from './chartPrimitives';
import { cropChartMode, setCurrentCropPoint } from './cropchart/cropChartSpec';
import { isReframeEnabled } from '../../crop/video-zoom-controller';
import {
  cropDragStartCropString,
  cropManipulationKind,
  isMouseManipulatingCrop,
  refreshCropDragInitState,
  setCropDragStartCropString,
  suppressNextAltLock,
} from '../../crop-overlay';

export const scatterChartDefaults: ChartOptions & ChartFontOptions = {
  defaultColor: 'rgba(255, 255, 255, 1)',
  defaultFontSize: 16,
  defaultFontStyle: 'bold',
  defaultFontColor: 'rgba(120, 120, 120, 1)', // lightgrey(1) — inlined to break circular init dependency
  maintainAspectRatio: false,
  hover: { mode: 'nearest' },
  animation: { duration: 0 },
};

export function getScatterPointColor(context) {
  const index = context.dataIndex;
  const value = context.dataset.data[index];
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

export const addSpeedPoint = function (this: any, time, speed) {
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

    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
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

export const addCropPoint = function (this: any, time: number) {
  // console.log(element, dataAtClick);

  if (time) {
    const scatterChartBounds = getScatterChartBounds(this);
    if (time <= scatterChartBounds.XMinBound || time >= scatterChartBounds.XMaxBound) {
      return;
    }
    time = roundX(time);

    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const initialState = getMarkerPairHistory(markerPair);
    const draft = createDraft(initialState);

    // Rapid keyframe workflow: if the user hits `Alt + A` mid-drag OR
    // mid-resize of a crop point, snapshot the current (live-moved)
    // crop value, revert the manipulated point back to where it
    // started, and assign the live value to the new keyframe. The
    // pointermove closure keeps writing to `currentCropPointIndex`
    // (which moves to the new point below via setCurrentCropPoint), so
    // the user can keep sweeping the cursor and dropping keyframes
    // without releasing the mouse — the previously-held point stays
    // anchored at its original crop and the new point becomes the
    // live-edit target. For resize the per-keyframe variation only
    // shows up in zoompan mode; pan-only mode keeps W/H equal across
    // all points by mode invariant, so the revert is harmless but
    // doesn't add per-keyframe size differences.
    const isLiveCropManipulation =
      isMouseManipulatingCrop && cropManipulationKind != null && cropDragStartCropString != null;
    const draggedPointRef = isLiveCropManipulation
      ? draft.cropMap[appState.currentCropPointIndex]
      : null;
    const liveCropAtAddTime = draggedPointRef ? draggedPointRef.crop : null;
    if (draggedPointRef && cropDragStartCropString != null) {
      draggedPointRef.crop = cropDragStartCropString;
    }

    draft.cropMap.push({
      x: time,
      y: 0,
      crop: liveCropAtAddTime ?? '0:0:iw:ih',
    });
    draft.cropMap.sort(sortX);

    const cropPointIndex = draft.cropMap.map((cropPoint) => cropPoint.x).indexOf(time);

    // Skip prev-inheritance when the new point already carries the
    // live-manipulation crop — that value IS what the user visually
    // placed here, and inheriting from prev would discard it.
    if (cropPointIndex > 0 && !isLiveCropManipulation) {
      const prevCropPointIndex = cropPointIndex - 1;
      draft.cropMap[cropPointIndex].crop = draft.cropMap[prevCropPointIndex].crop;
    }

    saveMarkerPairHistory(draft, markerPair);
    this.renderSpeedAndCropUI(true);

    // Auto-select the just-added point in Start mode so the user can
    // immediately operate on it (e.g. set its crop via the input, or
    // wheel forward to step the section through). Called after the
    // render so `setCurrentCropPoint`'s bounds-clamp reads the chart's
    // new data length, not the pre-insert length. For an insertion at
    // the very end the helper auto-falls back to End mode (Start mode
    // would place the section out of range).
    setCurrentCropPoint(this, cropPointIndex, cropChartMode.Start);

    // Reframe is playhead-driven: the chart selection alone doesn't move the playhead, so a new
    // point reads as selected (green) while the playhead sits between keyframes (amber border) and
    // edits/playback target there instead. Seek onto the new point so it's the actual edit target.
    if (isReframeEnabled() && !isLiveCropManipulation) {
      seekToSafe(appState.video, time);
    }

    if (isLiveCropManipulation) {
      // Refresh the in-progress drag's `initCropMap` snapshot so the
      // next pointermove sees a snapshot that includes the new point —
      // without this, `updateCropString` looks up the new point's
      // index in the pre-insert snapshot and throws silently inside
      // requestAnimationFrame, freezing the drag from that frame on.
      refreshCropDragInitState?.();
      // Re-baseline the "drag-start crop" to the value the new
      // keyframe was just dropped at. Without this, every subsequent
      // Alt + A would revert the just-added keyframe back to the
      // ORIGINAL p0 crop — collapsing all intermediate keyframes to
      // one value and leaving only the very last point usable.
      if (liveCropAtAddTime != null) setCropDragStartCropString(liveCropAtAddTime);
      // The Alt held to fire `Alt + A` would otherwise engage the
      // pan handler's Y-axis lock on the next frame; tell the drag to
      // ignore Alt until the user releases it.
      suppressNextAltLock();
    }
  }
};

export function scatterChartSpec(chartType: 'speed' | 'crop', inputId): ChartConfiguration {
  const updateInput = getInputUpdater(inputId);
  // Whether the current drag actually moved a point. A plain click (zero-distance drag) only seeks
  // and selects, so it must not push an undo entry.
  let didDragMovePoint = false;

  const onDragStart = function (e, chartInstance, element, value) {
    // console.log(arguments);
    didDragMovePoint = false;
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      chartInstance.options.plugins.zoom.pan.enabled = false;
      e.target.style.cursor = 'grabbing';
      if (chartType === 'crop') {
        seekToSafe(appState.video, timeRounder(value.x));
        // Reframe suppresses the per-frame chart re-render, and the seek that would refresh the
        // selection is async, so select the grabbed point now to highlight it immediately.
        if (element && isReframeEnabled()) setCurrentCropPoint(chartInstance, element._index);
      }
      chartInstance.update();
    }
  };

  const onDrag = function (e, chartInstance, _datasetIndex, _index, fromValue, toValue) {
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
        seekToSafe(appState.video, timeRounder(toValue.x));
      }
      if (
        (shouldDrag.dragX && fromValue.x !== toValue.x) ||
        (shouldDrag.dragY && fromValue.y !== toValue.y)
      ) {
        didDragMovePoint = true;
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

  const onDragEnd = function (e, chartInstance, _datasetIndex, index, value) {
    // console.log(datasetIndex, index, value);
    if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      const draft = createDraft(getMarkerPairHistory(markerPair));
      const draftMap = chartType === 'crop' ? draft.cropMap : draft.speedMap;

      const currentCropPointXPreSort =
        chartType === 'crop' ? draftMap[appState.currentCropPointIndex].x : null;

      draftMap.sort(sortX);

      if (index === 0 && chartType === 'speed') {
        draft.speed = value.y;
      }

      if (chartType === 'crop') {
        const newCurrentCropPointIndex = draftMap
          .map((cropPoint) => cropPoint.x)
          .indexOf(currentCropPointXPreSort ?? -1);
        setCurrentCropPoint(chartInstance, newCurrentCropPointIndex);
      }
      chartInstance.options.plugins.zoom.pan.enabled = true;
      e.target.style.cursor = 'default';

      // A plain click (zero-distance drag) only seeks and selects, so it has nothing to undo; the
      // draft's no-op sort would otherwise push a redundant history entry. Only commit a real move.
      if (didDragMovePoint) {
        saveMarkerPairHistory(draft, markerPair);
      }
      chartInstance.renderSpeedAndCropUI(true);
    }
  };

  const onClick = function (this: any, event: MouseEvent, dataAtClick) {
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
        const index = datum._index;
        const scatterChartMinBound = this.options.scales.xAxes[0].ticks.min;
        const scatterChartMaxBound = this.options.scales.xAxes[0].ticks.max;

        const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
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

            if (appState.currentCropPointIndex >= index) {
              setCurrentCropPoint(this, appState.currentCropPointIndex - 1);
            }

            updateInput(markerPair.cropMap[appState.currentCropPointIndex].crop);
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
          const index = datum._index;

          const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
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

  function onHover(this: any, e: MouseEvent, chartElements) {
    (e.target as HTMLElement).style.cursor = chartElements[0] ? 'grab' : 'default';
    const datum = chartElements[0];
    if (chartType !== 'crop' || chartElements.length !== 1 || !datum) return;
    const index = datum._index;
    if (isReframeEnabled()) {
      // Reframe: alt + hover seeks to and selects the point like clicking it, so the playhead-driven
      // highlight lands on it. Shift is left alone here so shift+click can create a point without
      // hover stealing the seek/select. Plain hover stays passive.
      if (e.altKey && !e.shiftKey) {
        seekToSafe(appState.video, this.data.datasets[0].data[index].x);
        setCurrentCropPoint(this, index);
      }
      return;
    }
    // Non-reframe (unchanged): ctrl hover selects the point as the section start, alt hover as end.
    if (e.shiftKey) return;
    let mode: cropChartMode;
    if (e.ctrlKey && !e.altKey) {
      mode = cropChartMode.Start;
    } else if (!e.ctrlKey && e.altKey) {
      mode = cropChartMode.End;
    } else {
      return;
    }
    setCurrentCropPoint(this, index, mode);
    triggerCropChartUpdates();
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
