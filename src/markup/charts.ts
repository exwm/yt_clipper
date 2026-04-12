import { createDraft, finishDraft } from 'immer';
import { ChartInput, CropPoint } from './@types/yt_clipper';
import { appState } from './appState';
import { currentCropChartMode, cropChartMode, setCurrentCropPoint, cropPointFormatter, cropPointXYFormatter, getCropChartConfig, currentCropChartSection } from './ui/chart/cropchart/cropChartSpec';
import { assertDefined, blockEvent, bsearch, clampNumber, flashMessage, getCropString, getEasedValue, htmlToElement, safeSetInnerHtml, seekToSafe, timeRounder } from './util/util';
import { updateCropString } from './crop-utils';
import { cropInputLabel, highlightSpeedAndCropInputs, renderCropForm, enableZoomPanInput } from './settings-editor';
import { cropCrossHairEnabled, cropOverlayElements, finishDrawingCrop, isDrawingCrop, isMouseManipulatingCrop, renderStaticCropOverlay, setCropCrossHair, setCropOverlay, setCropOverlayDimensions } from './crop-overlay';
import { getCropComponents, isStaticCrop, setCropInputValue } from './crop-utils';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { renderMarkerPair } from './markers';
import { sortX } from './ui/chart/chartPrimitives';
import { updateCharts } from './ui/chart/chartutil';
import { speedChartSpec } from './ui/chart/speedchart/speedChartSpec';
import { Chart, ChartConfiguration } from 'chart.js';
import { scatterChartDefaults } from './ui/chart/scatterChartSpec';
import { easeSinInOut } from 'd3-ease';
import { getFrameTimeBetweenLeftFrames } from './util/videoUtil';

export const chartState = {
  speedChartInput: {
    chart: null,
    type: 'speed',
    chartContainer: null,
    chartContainerId: 'speedChartContainer',
    chartContainerHook: null,
    chartContainerHookPosition: 'afterend',
    chartContainerStyle: 'width: 100%; height: calc(100% - 20px); position: relative; z-index: 55; opacity:0.8;',
    chartCanvasHTML: `<canvas id="speedChartCanvas" width="1600px" height="900px"></canvas>`,
    chartSpec: speedChartSpec,
    chartCanvasId: 'speedChartCanvas',
    minBound: 0,
    maxBound: 0,
    chartLoopKey: 'speedChartLoop',
    dataMapKey: 'speedMap',
  } as ChartInput,
  cropChartInput: {
    chart: null,
    type: 'crop',
    chartContainer: null,
    chartContainerId: 'cropChartContainer',
    chartContainerHook: null,
    chartContainerHookPosition: 'beforebegin',
    chartContainerStyle: 'display:flex',
    chartCanvasHTML: `<canvas id="cropChartCanvas" width="1600px" height="87px"></canvas>`,
    chartCanvasId: 'cropChartCanvas',
    chartSpec: getCropChartConfig(false),
    minBound: 0,
    maxBound: 0,
    chartLoopKey: 'cropChartLoop',
    dataMapKey: 'cropMap',
  } as ChartInput,
  currentChartInput: null as ChartInput | null,
  prevChartTime: undefined as number | undefined,
  shouldTriggerCropChartUpdates: false,
};

export function selectCropPointWithMouseWheel(e: WheelEvent) {
  if (appState.isHotkeysEnabled && !e.ctrlKey && e.altKey && !e.shiftKey) {
    blockEvent(e);
  } else {
    return;
  }

  const cropChart = chartState.cropChartInput.chart;
  if (!cropChart) return;
  const datasets = cropChart.data.datasets;
  assertDefined(datasets);
  const cropChartData = datasets[0].data;

  if (Math.abs(e.deltaY) > 0 &&
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedEndMarker &&
    chartState.cropChartInput.chart) {
    if (e.deltaY < 0) {
      if (currentCropChartMode === cropChartMode.Start) {
        setCurrentCropPoint(cropChart, appState.currentCropPointIndex + 1, cropChartMode.End);
      } else {
        setCurrentCropPoint(cropChart, appState.currentCropPointIndex, cropChartMode.Start);
      }
    } else if (e.deltaY > 0) {
      if (currentCropChartMode === cropChartMode.End) {
        setCurrentCropPoint(cropChart, appState.currentCropPointIndex - 1, cropChartMode.Start);
      } else {
        setCurrentCropPoint(cropChart, appState.currentCropPointIndex, cropChartMode.End);
      }
    }
  }

  if (!appState.isCropChartLoopingOn) {
    triggerCropChartUpdates();
  }

  assertDefined(cropChartData);
  const cropPoint = cropChartData[appState.currentCropPointIndex] as CropPoint;
  setCropInputValue(cropPoint.crop);

  highlightSpeedAndCropInputs();
  if (appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop') {
    chartState.currentChartInput.chart?.update();
  }
}
export function inheritCropPointCrop(e: WheelEvent) {
  if (appState.isHotkeysEnabled &&
    e.ctrlKey &&
    e.altKey &&
    e.shiftKey &&
    Math.abs(e.deltaY) > 0 &&
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedEndMarker &&
    chartState.cropChartInput.chart) {
    blockEvent(e);
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    const cropPoint = cropMap[appState.currentCropPointIndex];
    const oldCrop = cropPoint.crop;

    let newCrop: string = oldCrop;
    if (e.deltaY < 0) {
      const nextCropPoint = cropMap[Math.min(appState.currentCropPointIndex + 1, cropMap.length - 1)];
      newCrop = nextCropPoint.crop;
    } else if (e.deltaY > 0) {
      const prevCropPoint = cropMap[Math.max(appState.currentCropPointIndex - 1, 0)];
      newCrop = prevCropPoint.crop;
    }

    const draftCropMap = createDraft(cropMap);
    const initCropMap = finishDraft(draftCropMap);

    const shouldUpdateCropChart = oldCrop !== newCrop;
    updateCropString(newCrop, shouldUpdateCropChart, false, initCropMap);
  }
}
export function getCropMapProperties() {
  let isDynamicCrop = false;
  let enableZoomPan = false;
  let initCropMap: CropPoint[] | null = null;
  if (!appState.wasGlobalSettingsEditorOpen) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    const draftCropMap = createDraft(cropMap);
    initCropMap = finishDraft(draftCropMap);
    isDynamicCrop =
      !isStaticCrop(cropMap) || (cropMap.length === 2 && appState.currentCropPointIndex === 1);
    enableZoomPan = markerPair.enableZoomPan;
  }
  return { isDynamicCrop, enableZoomPan, initCropMap };
}
export function renderSpeedAndCropUI(rerenderCharts = true, updateCurrentCropPoint = false) {
  if (appState.isSettingsEditorOpen) {
    if (!appState.wasGlobalSettingsEditorOpen) {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      updateCharts(markerPair, rerenderCharts);
      // avoid updating current crop point unless crop map times have changed
      if (updateCurrentCropPoint) setCurrentCropPointWithCurrentTime();
      renderMarkerPair(markerPair, appState.prevSelectedMarkerPairIndex);

      assertDefined(appState.speedInput);
      appState.speedInput.value = markerPair.speed.toString();

      const cropMap = markerPair.cropMap;
      const crop = cropMap[appState.currentCropPointIndex].crop;
      const isDynamicCrop = !isStaticCrop(cropMap);

      renderCropForm(crop);

      if (!isDynamicCrop) {
        renderStaticCropOverlay(crop);
      } else {
        updateDynamicCropOverlays(cropMap, appState.video.getCurrentTime(), isDynamicCrop);
      }

      const enableZoomPan = markerPair.enableZoomPan;
      enableZoomPanInput.value = enableZoomPan ? 'Enabled' : 'Disabled';

      const formatter = enableZoomPan ? cropPointFormatter : cropPointXYFormatter;
      if (chartState.cropChartInput.chart) {
        const plugins = chartState.cropChartInput.chart.options.plugins;
        assertDefined(plugins);
        plugins.datalabels.formatter = formatter;
      } else {
        chartState.cropChartInput.chartSpec = getCropChartConfig(enableZoomPan);
      }
    } else {
      const crop = appState.settings.newMarkerCrop;
      renderCropForm(crop);
      renderStaticCropOverlay(crop);
    }
    highlightSpeedAndCropInputs();
    triggerCropPreviewRedraw();
  }
}
export function initChartHooks() {
  chartState.speedChartInput.chartContainerHook = appState.hooks.speedChartContainer;
  chartState.cropChartInput.chartContainerHook = appState.hooks.cropChartContainer;
}
Chart.helpers.merge(Chart.defaults.global, scatterChartDefaults);
export function toggleChart(chartInput: ChartInput) {
  if (appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null) {
    if (!chartInput.chart) {
      if (chartState.currentChartInput && appState.isCurrentChartVisible) {
        hideChart();
      }

      chartState.currentChartInput = chartInput;

      initializeChartData(chartInput.chartSpec, chartInput.dataMapKey);
      chartInput.chartContainer = htmlToElement(
        `
            <div
              id="${chartInput.chartContainerId}"
              style="${chartInput.chartContainerStyle}"
            ></div>
          `
      ) as HTMLDivElement;
      safeSetInnerHtml(chartInput.chartContainer, chartInput.chartCanvasHTML);
      assertDefined(chartInput.chartContainerHook);
      chartInput.chartContainerHook.insertAdjacentElement(
        chartInput.chartContainerHookPosition,
        chartInput.chartContainer
      );
      chartInput.chart = new Chart(chartInput.chartCanvasId, chartInput.chartSpec);
      chartInput.chart.renderSpeedAndCropUI = renderSpeedAndCropUI;

      const chartCanvas = chartInput.chart.canvas;
      assertDefined(chartCanvas);
      chartCanvas.removeEventListener('wheel', chartInput.chart.$zoom._wheelHandler);
      const wheelHandler = chartInput.chart.$zoom._wheelHandler;
      chartInput.chart.$zoom._wheelHandler = (e: MouseEvent) => {
        if (e.ctrlKey && !e.altKey && !e.shiftKey) {
          wheelHandler(e);
        }
      };

      const ctx = chartInput.chart.ctx;
      assertDefined(ctx);
      ctx.canvas.addEventListener('wheel', chartInput.chart.$zoom._wheelHandler);

      ctx.canvas.addEventListener(
        'contextmenu',
        (e) => {
          blockEvent(e);
        },
        true
      );

      ctx.canvas.addEventListener(
        'pointerdown',
        getMouseChartTimeAnnotationSetter(chartInput),
        true
      );

      appState.isCurrentChartVisible = true;
      appState.isChartEnabled = true;

      updateChartTimeAnnotation();
      cropChartPreviewHandler();
      // console.log(chartInput.chart);
    } else {
      assertDefined(chartState.currentChartInput);
      if (chartState.currentChartInput.type !== chartInput.type) {
        hideChart();
        chartState.currentChartInput = chartInput;
      }
      toggleCurrentChartVisibility();
      appState.isChartEnabled = appState.isCurrentChartVisible;
    }
  } else {
    flashMessage('Please open a marker pair editor before toggling a chart input.', 'olive');
  }
}
export function getCropPreviewMouseTimeSetter(modalContainer: HTMLCanvasElement) {
  function getSeekTime(e: MouseEvent) {
    const rect = modalContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scaledX = x / rect.width;

    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const duration = markerPair.end - markerPair.start;
    const seekTime = markerPair.start + scaledX * duration;
    return seekTime;
  }

  return function seekHandler(e) {
    if (e.buttons !== 2) return;
    blockEvent(e);
    // shift+right-click context menu opens screenshot tool in firefox 67.0.2
    function seekDragHandler(e) {
      const seekTime = timeRounder(getSeekTime(e));

      if (Math.abs(appState.video.getCurrentTime() - seekTime) >= 0.01) {
        seekToSafe(appState.video, seekTime);
      }
    }

    seekDragHandler(e);

    function seekDragEnd(e) {
      blockEvent(e);
      modalContainer.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', seekDragHandler);
    }

    modalContainer.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', seekDragHandler);
    document.addEventListener('pointerup', seekDragEnd, { once: true });
    document.addEventListener('contextmenu', blockEvent, {
      once: true,
      capture: true,
    });
  };
}
export function getMouseChartTimeAnnotationSetter(chartInput: ChartInput) {
  return function mouseChartTimeAnnotationSetter(e) {
    if (e.buttons !== 2) return;
    blockEvent(e);
    if (!chartInput.chart) return;
    const chart = chartInput.chart;
    const configOptions = chart.config.options;
    assertDefined(configOptions);
    const chartOpts = configOptions;
    const chartLoop = appState.markerPairs[appState.prevSelectedMarkerPairIndex][chartInput.chartLoopKey];
    assertDefined(chart.ctx);
    const chartCtx: CanvasRenderingContext2D = chart.ctx;
    // shift+right-click context menu opens screenshot tool in firefox 67.0.2
    function chartTimeAnnotationDragHandler(e) {
      const time = timeRounder(chart.scales['x-axis-1'].getValueForPixel(e.offsetX));
      chartOpts.annotation.annotations[0].value = time;
      if (Math.abs(appState.video.getCurrentTime() - time) >= 0.01) {
        seekToSafe(appState.video, time);
      }
      if (!e.ctrlKey && !e.altKey && e.shiftKey) {
        chartOpts.annotation.annotations[1].value = time;
        chartLoop.start = time;
        chart.update();
      } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
        chartOpts.annotation.annotations[2].value = time;
        chartLoop.end = time;
        chart.update();
      }
    }

    chartTimeAnnotationDragHandler(e);

    function chartTimeAnnotationDragEnd(e) {
      blockEvent(e);
      chartCtx.canvas.releasePointerCapture(e.pointerId);
      document.removeEventListener('pointermove', chartTimeAnnotationDragHandler);
    }

    chartCtx.canvas.setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', chartTimeAnnotationDragHandler);
    document.addEventListener('pointerup', chartTimeAnnotationDragEnd, { once: true });
    document.addEventListener('contextmenu', blockEvent, {
      once: true,
      capture: true,
    });
  };
}
export function toggleChartLoop() {
  if (chartState.currentChartInput &&
    appState.isCurrentChartVisible &&
    appState.prevSelectedMarkerPairIndex != null) {
    const chart = chartState.currentChartInput.chart;
    if (!chart) return;
    const chartConfigOptions = chart.config.options;
    assertDefined(chartConfigOptions);
    const chartOpts = chartConfigOptions;
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const chartLoop = markerPair[chartState.currentChartInput.chartLoopKey];
    if (chartLoop.enabled) {
      chartLoop.enabled = false;
      chartOpts.annotation.annotations[1].borderColor = 'rgba(0, 255, 0, 0.4)';
      chartOpts.annotation.annotations[2].borderColor = 'rgba(255, 215, 0, 0.4)';
      flashMessage('Speed chart looping disabled', 'red');
    } else {
      chartLoop.enabled = true;
      chartOpts.annotation.annotations[1].borderColor = 'rgba(0, 255, 0, 0.9)';
      chartOpts.annotation.annotations[2].borderColor = 'rgba(255, 215, 0, 0.9)';
      flashMessage('Speed chart looping enabled', 'green');
    }
    chart.update();
  }
}
export function initializeChartData(chartConfig: ChartConfiguration, dataMapKey: string) {
  if (appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const dataMap = markerPair[dataMapKey];
    const chartData = chartConfig.data;
    assertDefined(chartData);
    const datasets = chartData.datasets;
    assertDefined(datasets);
    datasets[0].data = dataMap;
    updateChartBounds(chartConfig, markerPair.start, markerPair.end);
  }
}
export function loadChartData(chartInput: ChartInput) {
  if (chartInput?.chart) {
    if (appState.isSettingsEditorOpen &&
      !appState.wasGlobalSettingsEditorOpen &&
      appState.prevSelectedMarkerPairIndex != null) {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      const dataMapKey = chartInput.dataMapKey;
      const dataMap = markerPair[dataMapKey];
      const chart = chartInput.chart;
      const chartDatasets = chart.data.datasets;
      assertDefined(chartDatasets);
      chartDatasets[0].data = dataMap;
      updateChartBounds(chart.config, markerPair.start, markerPair.end);
      if (appState.isCurrentChartVisible && chartState.currentChartInput === chartInput) chart.update();
    }
  }
}
export function updateChartBounds(chartConfig: ChartConfiguration, start, end) {
  if (chartState.cropChartInput) {
    chartState.cropChartInput.minBound = start;
    chartState.cropChartInput.maxBound = end;
  }
  if (chartState.speedChartInput) {
    chartState.speedChartInput.minBound = start;
    chartState.speedChartInput.maxBound = end;
  }
  const opts = chartConfig.options;
  assertDefined(opts);
  const scales = opts.scales;
  assertDefined(scales);
  const xAxes = scales.xAxes;
  assertDefined(xAxes);
  const ticks = xAxes[0].ticks;
  assertDefined(ticks);
  ticks.min = start;
  ticks.max = end;
  const plugins = opts.plugins;
  assertDefined(plugins);
  plugins.zoom.pan.rangeMin.x = start;
  plugins.zoom.pan.rangeMax.x = end;
  plugins.zoom.zoom.rangeMin.x = start;
  plugins.zoom.zoom.rangeMax.x = end;
}
export function updateChartTimeAnnotation() {
  if (appState.isCurrentChartVisible) {
    if (chartState.prevChartTime !== appState.video.getCurrentTime()) {
      const time = appState.video.getCurrentTime();
      chartState.prevChartTime = time;
      const currentInput = chartState.currentChartInput;
      assertDefined(currentInput);
      const chart = currentInput.chart;
      assertDefined(chart);
      const configOptions = chart.config.options;
      assertDefined(configOptions);
      configOptions.annotation.annotations[0].value = clampNumber(
        time,
        currentInput.minBound,
        currentInput.maxBound
      );

      const timeAnnotation = Object.values(chart.annotation.elements)[0] as any;
      timeAnnotation.options.value = clampNumber(
        time,
        currentInput.minBound,
        currentInput.maxBound
      );
      (timeAnnotation).configure();
      chart.render();
    }
  }
  requestAnimationFrame(updateChartTimeAnnotation);
}
export function toggleCropChartLooping() {
  if (!appState.isCropChartLoopingOn) {
    appState.isCropChartLoopingOn = true;
    flashMessage('Dynamic crop looping enabled', 'green');
  } else {
    appState.isCropChartLoopingOn = false;
    flashMessage('Dynamic crop looping  disabled', 'red');
  }
}
export function triggerCropChartUpdates() {
  chartState.shouldTriggerCropChartUpdates = true;
  cropChartPreviewHandler(false);
  triggerCropPreviewRedraw();
}
export function cropChartPreviewHandler(loop = true) {
  const chart = chartState.cropChartInput.chart;
  if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen && chart) {
    const datasets = chart.data.datasets;
    assertDefined(datasets);
    const chartData = datasets[0].data as CropPoint[];
    const time = appState.video.getCurrentTime();
    const isDynamicCrop = !isStaticCrop(chartData);
    const isCropChartVisible = chartState.currentChartInput?.type == 'crop' && appState.isCurrentChartVisible;
    if (chartState.shouldTriggerCropChartUpdates ||
      // assume auto time-based update not required for crop chart section if looping section
      (appState.isCropChartLoopingOn && isCropChartVisible) ||
      (chartState.cropChartInput.chart && (isMouseManipulatingCrop || isDrawingCrop))) {
      chartState.shouldTriggerCropChartUpdates = false;
      cropChartSectionLoop();
    } else if (isDynamicCrop) {
      setCurrentCropPointWithCurrentTime();
    }

    if (isDynamicCrop || appState.currentCropPointIndex > 0) {
      cropInputLabel.textContent = `Crop Point ${appState.currentCropPointIndex + 1}`;
    } else {
      cropInputLabel.textContent = `Crop`;
    }

    updateDynamicCropOverlays(chartData, time, isDynamicCrop);
  }

  if (loop) {
    appState.video.requestVideoFrameCallback(() => { cropChartPreviewHandler(loop); });
  }
}
export function setCurrentCropPointWithCurrentTime() {
  const cropChart = chartState.cropChartInput.chart;
  if (cropChart) {
    const cropDatasets = cropChart.data.datasets;
    assertDefined(cropDatasets);
    const chartData = cropDatasets[0].data as CropPoint[];
    const time = appState.video.getCurrentTime();
    const searchCropPoint = { x: time, y: 0, crop: '' };
    const [istart, iend] = currentCropChartSection;
    let [start, end] = bsearch(chartData, searchCropPoint, sortX);
    if (currentCropChartMode === cropChartMode.Start) {
      if (start === end && end === iend) start--;
      setCurrentCropPoint(cropChart, Math.min(start, chartData.length - 2));
    } else if (currentCropChartMode === cropChartMode.End) {
      if (start === end && start === istart) end++;
      setCurrentCropPoint(cropChart, Math.max(end, 1));
    }
  }
}
export function getDynamicCropComponents(): [number, number, number, number] | null {
  if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    const chartData = cropMap;
    const isDynamicCrop = !isStaticCrop(cropMap);
    if (!isDynamicCrop) {
      return null;
    }

    const sectStart = chartData[currentCropChartSection[0]];
    const sectEnd = chartData[currentCropChartSection[1]];

    return getEasedCropComponents(sectStart, sectEnd);
  }

  return null;
}

export function getEasedCropComponents(sectStart: CropPoint, sectEnd: CropPoint) {
  const [startX, startY, startW, startH] = getCropComponents(sectStart.crop);
  const [endX, endY, endW, endH] = getCropComponents(sectEnd.crop);

  const currentTime = appState.video.getCurrentTime();

  const clampedCurrentTime = clampNumber(currentTime, sectStart.x, sectEnd.x);
  const easingFunc = sectEnd.easeIn == 'instant' ? easeInInstant : easeSinInOut;

  const startTime = sectStart.x;
  const endTime = getFrameTimeBetweenLeftFrames(sectEnd.x);

  const [easedX, easedY, easedW, easedH] = [
    [startX, endX],
    [startY, endY],
    [startW, endW],
    [startH, endH],
  ].map((pair) => getEasedValue(easingFunc, pair[0], pair[1], startTime, endTime, clampedCurrentTime)
  );

  return [easedX, easedY, easedW, easedH] as [number, number, number, number];
}
// Hold the left point and then instantly transition to the right point once we reach it

export const easeInInstant = (timePercentage: number) => {
  return timePercentage >= 1 ? 1 : 0;
};


export function updateDynamicCropOverlays(
  chartData: CropPoint[],
  _currentTime: number,
  isDynamicCrop: boolean
) {
  if (isDynamicCrop || appState.currentCropPointIndex > 0) {
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = 'block';
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = 'block';
    (cropOverlayElements.cropRectBorder as HTMLElement).style.opacity = '0.6';
  } else {
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = 'none';
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = 'none';
    (cropOverlayElements.cropRectBorder as HTMLElement).style.opacity = '1';
    return;
  }
  const sectStart = chartData[currentCropChartSection[0]];
  const sectEnd = chartData[currentCropChartSection[1]];

  [cropOverlayElements.cropChartSectionStartBorderGreen, cropOverlayElements.cropChartSectionStartBorderWhite].map((cropRect) => { assertDefined(cropRect); setCropOverlay(cropRect, sectStart.crop); }
  );
  [cropOverlayElements.cropChartSectionEndBorderYellow, cropOverlayElements.cropChartSectionEndBorderWhite].map((cropRect) => { assertDefined(cropRect); setCropOverlay(cropRect, sectEnd.crop); }
  );

  const currentCropPoint = chartData[appState.currentCropPointIndex];
  if (cropCrossHairEnabled && cropOverlayElements.cropCrossHair) {
    cropOverlayElements.cropCrossHairs.map((cropCrossHair) => { setCropCrossHair(cropCrossHair, currentCropPoint.crop); });
    (cropOverlayElements.cropCrossHair as HTMLElement).style.stroke = currentCropChartMode === cropChartMode.Start ? 'lime' : 'yellow';
  }

  const sectionStartEl = cropOverlayElements.cropChartSectionStart;
  assertDefined(sectionStartEl);
  const sectionEndEl = cropOverlayElements.cropChartSectionEnd;
  assertDefined(sectionEndEl);
  if (currentCropChartMode === cropChartMode.Start) {
    sectionStartEl.setAttribute('opacity', '0.8');
    sectionEndEl.setAttribute('opacity', '0.3');
  } else if (currentCropChartMode === cropChartMode.End) {
    sectionStartEl.setAttribute('opacity', '0.3');
    sectionEndEl.setAttribute('opacity', '0.8');
  }

  const [easedX, easedY, easedW, easedH] = getEasedCropComponents(sectStart, sectEnd);

  [cropOverlayElements.cropRect, cropOverlayElements.cropRectBorderBlack, cropOverlayElements.cropRectBorderWhite].map((cropRect) => { assertDefined(cropRect); setCropOverlayDimensions(cropRect, easedX, easedY, easedW, easedH); }
  );
}
export function getInterpolatedCrop(sectStart: CropPoint, sectEnd: CropPoint, time: number) {
  const [startX, startY, startW, startH] = getCropComponents(sectStart.crop);
  const [endX, endY, endW, endH] = getCropComponents(sectEnd.crop);

  const clampedTime = clampNumber(time, sectStart.x, sectEnd.x);
  const easingFunc = sectEnd.easeIn == 'instant' ? easeInInstant : easeSinInOut;

  const startTime = sectStart.x;
  const endTime = getFrameTimeBetweenLeftFrames(sectEnd.x);

  const [x, y, w, h] = [
    [startX, endX],
    [startY, endY],
    [startW, endW],
    [startH, endH],
  ].map(([startValue, endValue]) => {
    const eased = getEasedValue(easingFunc, startValue, endValue, startTime, endTime, clampedTime);
    return eased;
  });
  // return [x, y, w, h];
  return getCropString(x, y, w, h);
}
export function cropChartSectionLoop() {
  if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen) {
    if (appState.prevSelectedMarkerPairIndex != null) {
      const chart = chartState.cropChartInput.chart;
      if (chart == null) return;
      const loopDatasets = chart.data.datasets;
      assertDefined(loopDatasets);
      const chartData = loopDatasets[0].data;
      assertDefined(chartData);
      const [start, end] = currentCropChartSection;
      const sectStart = (chartData[start] as any).x;
      const sectEnd = (chartData[end] as any).x;
      const isTimeBetweenCropChartSection = sectStart <= appState.video.getCurrentTime() && appState.video.getCurrentTime() <= sectEnd;

      if (!isTimeBetweenCropChartSection) {
        seekToSafe(appState.video, sectStart);
      }
    }
  }
}
export function showChart() {
  if (chartState.currentChartInput?.chartContainer) {
    if (isDrawingCrop) {
      finishDrawingCrop(true);
    }
    chartState.currentChartInput.chartContainer.style.display = 'block';
    appState.isCurrentChartVisible = true;
    const chartToUpdate = chartState.currentChartInput.chart;
    assertDefined(chartToUpdate);
    chartToUpdate.update();
    // force chart time annotation to update
    chartState.prevChartTime = -1;
  }
}
export function hideChart() {
  if (chartState.currentChartInput?.chartContainer) {
    chartState.currentChartInput.chartContainer.style.display = 'none';
    appState.isCurrentChartVisible = false;
  }
}
export function toggleCurrentChartVisibility() {
  if (!appState.isCurrentChartVisible) {
    showChart();
  } else {
    hideChart();
  }
}
