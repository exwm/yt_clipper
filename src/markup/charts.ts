import { createDraft, finishDraft } from 'immer';
import { ChartInput, CropPoint } from './@types/yt_clipper';
import { appState } from './appState';
import {
  currentCropChartMode,
  cropChartMode,
  setCurrentCropPoint,
  cropPointFormatter,
  cropPointXYFormatter,
  getCropChartConfig,
  currentCropChartSection,
  isCropPointHighlightVisible,
  setCropPointHighlightVisible,
} from './ui/chart/cropchart/cropChartSpec';
import {
  assertDefined,
  blockEvent,
  bsearch,
  clampNumber,
  deleteElement,
  flashMessage,
  getCropString,
  injectCSS,
  isWithinSameFrame,
  pauseSafe,
  seekToSafe,
  timeRounder,
} from './util/util';
import { cropChartActiveVideoHeightCSS } from './ui/css/css';
import { platform } from './yt_clipper';
import { VideoPlatforms } from './platforms/platforms';
import { html, render } from 'lit-html';
import { updateCropString } from './crop-utils';
import { setHoveredRegion } from './features/hints-bar/hover-region';
import {
  cropInputLabel,
  highlightSpeedAndCropInputs,
  renderCropForm,
  enableZoomPanInput,
} from './features/settings/settings-editor';
import {
  cropCrossHairEnabled,
  cropOverlayElements,
  END_CROP_SECTION_COLOR,
  finishDrawingCrop,
  getCropDimOpacity,
  isDrawingCrop,
  isMouseManipulatingCrop,
  renderStaticCropOverlay,
  resizeCropOverlay,
  setCropCrossHair,
  setCropOverlay,
  setCropOverlayDimensions,
  setCurrentCropRectVisible,
} from './crop-overlay';
import { getCropComponents, isStaticCrop, setCropInputValue } from './crop-utils';
import { Crop } from './crop/crop';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import {
  CropKeyframeMatch,
  cropInterpolationSectionAtTime,
  findCropKeyframeAtTime,
  getEasedCropComponentsAtTime,
  nextKeyframeIndex,
} from './crop/crop-keyframe-math';
import { isReframeEnabled, syncReframe } from './crop/video-zoom-controller';
import { renderMarkerPair } from './markers';
import { roundX, sortX } from './ui/chart/chartPrimitives';
import { updateCharts } from './ui/chart/chartutil';
import { speedChartSpec } from './ui/chart/speedchart/speedChartSpec';
import { registerActiveDragCleanup } from './util/drag-recovery';
import { Chart, ChartConfiguration } from 'chart.js';
import { scatterChartDefaults } from './ui/chart/scatterChartSpec';
import { getFPS } from './util/videoUtil';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import type { HoveredRegion } from './features/hints-bar/hover-region';

/** Wires up hover-region tracking on a chart canvas. The mousemove handler
 *  uses Chart.js's hit-test to flip between `{type}-chart` (cursor over the
 *  empty canvas) and `{type}-chart-point` (cursor over a data point) so the
 *  hints bar can surface point-manipulation chips only when relevant. */
function attachChartHoverDetector(canvas: HTMLCanvasElement, chartInput: ChartInput): void {
  const base: Exclude<HoveredRegion, null> =
    chartInput.type === 'crop' ? 'crop-chart' : 'speed-chart';
  const pointRegion: Exclude<HoveredRegion, null> =
    chartInput.type === 'crop' ? 'crop-chart-point' : 'speed-chart-point';

  let inside = false;
  let overPoint = false;

  const sync = (): void => {
    setHoveredRegion(inside ? (overPoint ? pointRegion : base) : null);
  };

  canvas.addEventListener('mouseenter', () => {
    inside = true;
    sync();
  });
  canvas.addEventListener('mouseleave', () => {
    inside = false;
    overPoint = false;
    sync();
  });
  canvas.addEventListener('mousemove', (e) => {
    const chart = chartInput.chart;
    if (!chart) return;
    const elements = chart.getElementAtEvent(e);
    const newOverPoint = elements.length > 0;
    if (newOverPoint !== overPoint) {
      overPoint = newOverPoint;
      sync();
    }
  });
}

export const chartState = {
  speedChartInput: {
    chart: null,
    type: 'speed',
    chartContainer: null,
    chartContainerId: 'speedChartContainer',
    chartContainerHook: null,
    chartContainerHookPosition: 'afterend',
    chartContainerStyle:
      'width: 100%; height: calc(100% - 20px); position: relative; z-index: 55; opacity:0.8;',
    chartCanvasTemplate: html`<canvas
      id="speedChartCanvas"
      width="1600px"
      height="900px"
    ></canvas>`,
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
    chartCanvasTemplate: html`<canvas id="cropChartCanvas" width="1600px" height="87px"></canvas>`,
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

  if (
    Math.abs(e.deltaY) > 0 &&
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedEndMarker &&
    chartState.cropChartInput.chart
  ) {
    if (isReframeEnabled()) {
      // Reframe steps keyframe-to-keyframe by the current TIME, not the last selection: wheel up
      // (deltaY < 0) lands on the nearest keyframe to the right, wheel down the nearest to the left.
      // Seek straight to the point's time (same as clicking it) so the browser snaps to the real
      // frame and the playhead lands centred on it; pause so the user lands there to edit it.
      assertDefined(cropChartData);
      const points = cropChartData as CropPoint[];
      const nextIndex = nextKeyframeIndex(
        points,
        appState.video.getCurrentTime(),
        getFPS(),
        e.deltaY < 0 ? 1 : -1
      );
      setCurrentCropPoint(cropChart, nextIndex);
      pauseSafe(appState.video);
      seekToSafe(appState.video, points[nextIndex].x);
    } else if (e.deltaY < 0) {
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
  if (
    appState.isHotkeysEnabled &&
    e.ctrlKey &&
    e.altKey &&
    e.shiftKey &&
    Math.abs(e.deltaY) > 0 &&
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedEndMarker &&
    chartState.cropChartInput.chart
  ) {
    blockEvent(e);
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    const cropPoint = cropMap[appState.currentCropPointIndex];
    const oldCrop = cropPoint.crop;

    let newCrop: string = oldCrop;
    if (e.deltaY < 0) {
      const nextCropPoint =
        cropMap[Math.min(appState.currentCropPointIndex + 1, cropMap.length - 1)];
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
    // Drive the reframe preview from the crop when it's edited (drag-release, arrow
    // keys, point switch), not just when scrubbing — so it tracks a static crop too.
    if (isReframeEnabled()) {
      syncReframe(getCurrentCropComponents());
    }
  }
}
export function initChartHooks() {
  chartState.speedChartInput.chartContainerHook = appState.hooks.speedChartContainer;
  chartState.cropChartInput.chartContainerHook = appState.hooks.cropChartContainer;
}
Chart.helpers.merge(Chart.defaults.global, scatterChartDefaults);
export function toggleChart(chartInput: ChartInput) {
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    if (!chartInput.chart) {
      if (chartState.currentChartInput && appState.isCurrentChartVisible) {
        hideChart();
      }

      chartState.currentChartInput = chartInput;

      initializeChartData(chartInput.chartSpec, chartInput.dataMapKey);
      chartInput.chartContainer = document.createElement('div');
      chartInput.chartContainer.id = chartInput.chartContainerId;
      chartInput.chartContainer.setAttribute('style', chartInput.chartContainerStyle);
      render(chartInput.chartCanvasTemplate, chartInput.chartContainer);
      assertDefined(chartInput.chartContainerHook);
      chartInput.chartContainerHook.insertAdjacentElement(
        chartInput.chartContainerHookPosition,
        chartInput.chartContainer
      );
      chartInput.chart = new Chart(chartInput.chartCanvasId, chartInput.chartSpec);
      chartInput.chart.renderSpeedAndCropUI = renderSpeedAndCropUI;

      const chartCanvas = chartInput.chart.canvas;
      assertDefined(chartCanvas);
      attachChartHoverDetector(chartCanvas, chartInput);
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
      syncCropChartVideoHeightLimit();

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
    const pointerId = e.pointerId;
    // shift+right-click context menu opens screenshot tool in firefox 67.0.2
    function seekDragHandler(e) {
      // Self-defending end check: pointermove always reports the
      // currently-held buttons bitmask. If the right button is no longer
      // held but we're still receiving pointermove, the browser dropped
      // our `pointerup` — known to happen in Vivaldi (mouse gestures
      // suppress the up event), Chrome with certain devtools docking
      // configurations, and after a suppressed contextmenu. End the
      // drag immediately so the cursor stops scrubbing the video.
      if ((e.buttons & 2) === 0) {
        cleanup();
        return;
      }
      const seekTime = timeRounder(getSeekTime(e));

      if (Math.abs(appState.video.getCurrentTime() - seekTime) >= 0.01) {
        seekToSafe(appState.video, seekTime);
      }
    }

    seekDragHandler(e);

    let unregisterDragRecovery: () => void = () => {};

    function cleanup() {
      modalContainer.removeEventListener('pointermove', seekDragHandler);
      modalContainer.removeEventListener('pointerup', seekDragEnd, { capture: true });
      modalContainer.removeEventListener('pointercancel', seekDragCancel, { capture: true });
      if (modalContainer.hasPointerCapture(pointerId)) {
        modalContainer.releasePointerCapture(pointerId);
      }
      unregisterDragRecovery();
    }

    function seekDragEnd(e) {
      blockEvent(e);
      cleanup();
    }

    function seekDragCancel() {
      cleanup();
    }

    modalContainer.setPointerCapture(pointerId);
    // Attach to the captured target rather than `document` so the
    // spec-mandated `pointercancel` reaches us when the browser
    // implicitly releases capture — right-click drags were particularly
    // prone to stuck-seeking because some browsers swallow `pointerup`
    // when the user releases over a focused devtools panel or after a
    // suppressed contextmenu.
    modalContainer.addEventListener('pointermove', seekDragHandler);
    modalContainer.addEventListener('pointerup', seekDragEnd, { once: true, capture: true });
    modalContainer.addEventListener('pointercancel', seekDragCancel, {
      once: true,
      capture: true,
    });
    document.addEventListener('contextmenu', blockEvent, {
      once: true,
      capture: true,
    });
    unregisterDragRecovery = registerActiveDragCleanup(cleanup);
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
    const chartLoop =
      appState.markerPairs[appState.prevSelectedMarkerPairIndex][chartInput.chartLoopKey];
    assertDefined(chart.ctx);
    const chartCtx: CanvasRenderingContext2D = chart.ctx;
    const captureTarget = chartCtx.canvas;
    const pointerId = e.pointerId;
    // shift+right-click context menu opens screenshot tool in firefox 67.0.2
    function chartTimeAnnotationDragHandler(e) {
      // Self-defending end check — see the matching seekDragHandler
      // above for the rationale. Vivaldi and some Chromium-based browser
      // configurations occasionally drop `pointerup` for right-button
      // releases, leaving the seek tracking the cursor indefinitely.
      // Treat a pointermove without the right button held as the
      // implicit drag end.
      if ((e.buttons & 2) === 0) {
        cleanup();
        return;
      }
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

    let unregisterDragRecovery: () => void = () => {};

    function cleanup() {
      captureTarget.removeEventListener('pointermove', chartTimeAnnotationDragHandler);
      captureTarget.removeEventListener('pointerup', chartTimeAnnotationDragEnd, {
        capture: true,
      });
      captureTarget.removeEventListener('pointercancel', chartTimeAnnotationDragCancel, {
        capture: true,
      });
      if (captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
      unregisterDragRecovery();
    }

    function chartTimeAnnotationDragEnd(e) {
      blockEvent(e);
      cleanup();
    }

    function chartTimeAnnotationDragCancel() {
      cleanup();
    }

    captureTarget.setPointerCapture(pointerId);
    // Attach to the captured canvas so `pointercancel` reaches us when
    // the browser implicitly releases capture. Right-click drags were
    // particularly prone to stuck-seeking because some browsers don't
    // dispatch `pointerup` to `document` after a suppressed contextmenu
    // or when the user releases over a focused devtools panel.
    captureTarget.addEventListener('pointermove', chartTimeAnnotationDragHandler);
    captureTarget.addEventListener('pointerup', chartTimeAnnotationDragEnd, {
      once: true,
      capture: true,
    });
    captureTarget.addEventListener('pointercancel', chartTimeAnnotationDragCancel, {
      once: true,
      capture: true,
    });
    document.addEventListener('contextmenu', blockEvent, {
      once: true,
      capture: true,
    });
    unregisterDragRecovery = registerActiveDragCleanup(cleanup);
  };
}
export function toggleChartLoop() {
  if (
    chartState.currentChartInput &&
    appState.isCurrentChartVisible &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
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
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
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
    if (
      appState.isSettingsEditorOpen &&
      !appState.wasGlobalSettingsEditorOpen &&
      appState.prevSelectedMarkerPairIndex != null
    ) {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      const dataMapKey = chartInput.dataMapKey;
      const dataMap = markerPair[dataMapKey];
      const chart = chartInput.chart;
      const chartDatasets = chart.data.datasets;
      assertDefined(chartDatasets);
      chartDatasets[0].data = dataMap;
      updateChartBounds(chart.config, markerPair.start, markerPair.end);
      if (appState.isCurrentChartVisible && chartState.currentChartInput === chartInput)
        chart.update();
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
      timeAnnotation.configure();
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
// During the requestVideoFrameCallback playback loop the crop is computed for the
// EXACT media timestamp of the frame being presented (metadata.mediaTime), not the
// wall-clock getCurrentTime() which advances between presented frames and makes the
// reframe jitter a fraction of a frame ahead of the video. Null outside the loop
// (scrub/edit) → fall back to the live current time.
let presentedFrameTime: number | null = null;
function currentCropTime(): number {
  return presentedFrameTime ?? appState.video.getCurrentTime();
}

export function cropChartPreviewHandler(loop = true, frameTime?: number) {
  presentedFrameTime = frameTime ?? null;
  try {
    const chart = chartState.cropChartInput.chart;
    if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen && chart) {
      const datasets = chart.data.datasets;
      assertDefined(datasets);
      const chartData = datasets[0].data as CropPoint[];
      const time = currentCropTime();
      const isDynamicCrop = !isStaticCrop(chartData);
      const isCropChartVisible =
        chartState.currentChartInput?.type == 'crop' && appState.isCurrentChartVisible;
      const isManipulatingOrDrawing =
        chartState.cropChartInput.chart && (isMouseManipulatingCrop || isDrawingCrop);
      if (isReframeEnabled()) {
        // Reframe auto-key is playhead-driven: never auto-seek to a section start
        // (cropChartSectionLoop), which would yank the playhead while editing. The
        // selection is the keyframe at the current time (or the section's left point
        // between keyframes); during manipulation it's already the auto-keyed point.
        chartState.shouldTriggerCropChartUpdates = false;
        // Update the highlight on EVERY presented frame, exactly like the canvas keyframe border
        // (reframeKeyframeColor), so the two never disagree: both read isPlayheadOnCropKeyframe at the
        // same frame. Do NOT gate on video.seeking — a frame-step presents its frame while seeking is
        // still true, and skipping it left the point stale (border green, point not) with no later
        // frame to fix it. The full-frame on-keyframe tolerance keeps a seek-to-point landing green.
        if (isDynamicCrop && !isManipulatingOrDrawing) {
          // On a keyframe, select & highlight it (the edit target). Between keyframes a manipulation
          // creates a NEW point, so no existing point is the target: clear the highlight. Re-render
          // only when the displayed selection changes AND playback is paused (a click or scrub), so
          // the chart matches the live video border; during playback skip it to avoid stutter.
          const { onKeyframe, index } = isPlayheadOnCropKeyframe(chartData, time);
          const wasHighlighted = isCropPointHighlightVisible();
          const prevIndex = appState.currentCropPointIndex;
          if (onKeyframe) {
            setCurrentCropPoint(chart, index, undefined, false); // updates index + re-shows highlight
          } else {
            setCropPointHighlightVisible(false);
          }
          const displayChanged =
            wasHighlighted !== isCropPointHighlightVisible() ||
            prevIndex !== appState.currentCropPointIndex;
          if (displayChanged && appState.video.paused) renderSpeedAndCropUI(true, false);
        }
      } else if (
        chartState.shouldTriggerCropChartUpdates ||
        // assume auto time-based update not required for crop chart section if looping section
        (appState.isCropChartLoopingOn && isCropChartVisible) ||
        isManipulatingOrDrawing
      ) {
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
      // The reframe canvas loop refreshes the transform every frame, so no syncReframe needed here.
    }
  } finally {
    // Always clear the pinned frame time and keep the loop alive even if the body threw — otherwise
    // a stale presentedFrameTime would skew every later currentCropTime() read.
    presentedFrameTime = null;
    if (loop) {
      appState.video.requestVideoFrameCallback((_now, metadata) => {
        cropChartPreviewHandler(loop, metadata?.mediaTime);
      });
    }
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

export function getEasedCropComponents(
  sectStart: CropPoint,
  sectEnd: CropPoint
): [number, number, number, number] {
  const start = getCropComponents(sectStart.crop);
  const eased = getEasedCropComponentsAtTime(
    start,
    getCropComponents(sectEnd.crop),
    sectStart.x,
    sectEnd.x,
    sectEnd.easeIn,
    currentCropTime(),
    getFPS()
  );
  // A zero-duration section has nothing to ease: hold the start crop.
  return eased ?? [start[0], start[1], start[2], start[3]];
}
// The current crop in cropRes coords — the eased/interpolated crop for a dynamic
// crop, or the static/current-point crop otherwise. Null only when no editor is open.
// Used by the editor zoom to frame/follow the crop (the subject).
export function getCurrentCropComponents(): [number, number, number, number] | null {
  if (!appState.isSettingsEditorOpen) return null;
  if (appState.wasGlobalSettingsEditorOpen) {
    // Global settings has no marker pair: the editable crop is the single static new-marker crop.
    const [gx, gy, gw, gh] = getCropComponents(appState.settings.newMarkerCrop);
    return [gx, gy, gw, gh];
  }
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!markerPair) return null;
  const cropMap = markerPair.cropMap;
  // While editing a dynamic crop, follow the crop POINT being manipulated (which may
  // be off the current time) rather than the interpolated crop — otherwise the view
  // only tracks the edit when the playhead happens to sit near that point. When just
  // scrubbing, follow the interpolated crop so a moving subject stays framed.
  const editing = isMouseManipulatingCrop || isDrawingCrop;
  if (!isStaticCrop(cropMap) && !editing) {
    const time = currentCropTime();
    // On a keyframe, return it exactly: it's what the edit set and what the canvas drew while
    // manipulating. Auto-key inserts at roundX(time), so interpolating at the playhead's sub-frame
    // offset would blend toward the neighbor and snap the crop on release.
    const { onKeyframe, index } = isPlayheadOnCropKeyframe(cropMap, time);
    if (onKeyframe && cropMap[index]) {
      const [kx, ky, kw, kh] = getCropComponents(cropMap[index].crop);
      return [kx, ky, kw, kh];
    }
    // Otherwise interpolate within the section that brackets the CURRENT TIME, not the chart
    // selection: in reframe the selection snaps to the nearest keyframe (flipping at the
    // section midpoint), so keying off it clamps the time outside the section and makes
    // the preview jump to the next keyframe instead of easing smoothly across it.
    const [left, right] = cropInterpolationSectionAtTime(cropMap, time);
    if (cropMap[left] && cropMap[right]) {
      return getEasedCropComponents(cropMap[left], cropMap[right]);
    }
  }
  const point = cropMap[appState.currentCropPointIndex] ?? cropMap[0];
  const [x, y, w, h] = getCropComponents(point.crop);
  return [x, y, w, h];
}

/** The interpolated crop at a presented-frame mediaTime, for the reframe canvas. mediaTime is
 *  frame-exact, unlike wall-clock getCurrentTime, which drifts between presented frames. */
export function reframeCropAtFrameTime(mediaTime: number): [number, number, number, number] | null {
  const prev = presentedFrameTime;
  presentedFrameTime = mediaTime;
  try {
    return getCurrentCropComponents();
  } finally {
    presentedFrameTime = prev;
  }
}

/** Run `fn` with the crop clock pinned to `mediaTime`, so any overlay re-layout it triggers
 *  (forceRerenderCrop) resolves the crop at the frame the canvas drew, not wall-clock
 *  getCurrentTime, which drifts within a frame and leaves the overlay a hair off. */
export function withPresentedFrameTime<T>(mediaTime: number, fn: () => T): T {
  const prev = presentedFrameTime;
  presentedFrameTime = mediaTime;
  try {
    return fn();
  } finally {
    presentedFrameTime = prev;
  }
}

// Is the playhead sitting on a crop keyframe (within a frame)? Drives the
// reframe auto-key model: on a keyframe an edit updates it, between keyframes
// an edit creates one. Thin wrapper supplying the detected fps to the pure math.
export function isPlayheadOnCropKeyframe(cropMap: CropPoint[], time: number): CropKeyframeMatch {
  return findCropKeyframeAtTime(cropMap, time, getFPS());
}

// Select a crop point for editing. Set the index directly (works even when the
// crop chart was never opened, leaving its instance null) and only sync the
// chart's section/selection state when an instance exists — `setCurrentCropPoint`
// clamps to maxIndex=1 against a null chart, which would mis-select on a
// JSON-loaded dynamic crop.
function selectCropPoint(index: number): void {
  appState.currentCropPointIndex = index;
  const cropChart = chartState.cropChartInput.chart;
  if (cropChart) setCurrentCropPoint(cropChart, index);
}

// Reframe auto-key: editing the crop is playhead-driven — the current time IS
// the current keyframe. On a keyframe we edit it; between keyframes we create one
// at the current time capturing the interpolated crop the reframe is already
// showing (no visual jump). Pauses playback (stays paused; manual resume) so the
// user manipulates a still frame. Called at crop-manipulation start, before the
// drag reads `currentCropPointIndex`, so the drag edits the right point.
export function autoKeyCurrentCropPoint(): void {
  if (!appState.isSettingsEditorOpen || appState.wasGlobalSettingsEditorOpen) return;
  const pair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!pair) return;
  const cropMap = pair.cropMap;

  const cropChartOpen =
    appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop';
  // A static crop with the chart closed edits as a whole (no keyframing); only
  // turn it dynamic when the user has opened the crop chart. Already-dynamic
  // crops always auto-key.
  if (isStaticCrop(cropMap) && !cropChartOpen) return;

  // Ctrl+wheel zoom calls this per wheel tick; pauseSafe avoids re-pausing (it churns the player).
  pauseSafe(appState.video);
  const time = appState.video.getCurrentTime();

  const { onKeyframe, index } = isPlayheadOnCropKeyframe(cropMap, time);
  if (onKeyframe) {
    selectCropPoint(index);
    return;
  }

  // Between keyframes: insert one at the current time holding the interpolated
  // crop. `storeHistory: false` mutates live state without a checkpoint so the
  // drag's release-time push collapses insert + move into a single undo step.
  const cc = getCurrentCropComponents();
  if (!cc) return;
  // cc is the interpolated crop (float); snap it to a valid stored crop (whole pixels, clamped,
  // shared AR) via setCropStringSafe, the same path the chart keyframe edits use.
  const safeCrop = new Crop(
    cc[0],
    cc[1],
    cc[2],
    cc[3],
    appState.settings.cropResWidth,
    appState.settings.cropResHeight
  );
  safeCrop.setCropStringSafe(getCropString(cc[0], cc[1], cc[2], cc[3]), pair.enableZoomPan);
  const crop = safeCrop.cropString;
  const x = roundX(time);
  const existingIndex = cropMap.findIndex((p) => p.x === x);
  if (existingIndex !== -1) {
    // The keyframe check above uses a full-frame tolerance, but keyframe times live on roundX's
    // 0.01s grid. Above ~100fps a frame is finer than that grid, so the check can miss a point
    // already at this quantized time. Edit it rather than push a duplicate x.
    selectCropPoint(existingIndex);
    return;
  }
  const draft = createDraft(getMarkerPairHistory(pair));
  draft.cropMap.push({ x, y: 0, crop });
  draft.cropMap.sort(sortX);
  const newIndex = draft.cropMap.findIndex((p) => p.x === x);
  saveMarkerPairHistory(draft, pair, false);
  // Render before selecting so setCurrentCropPoint's bounds-clamp reads the post-insert length,
  // else the new index is clamped down and the previous point is selected. Mirrors addCropPoint.
  renderSpeedAndCropUI();
  selectCropPoint(newIndex);
}

// Recolor the current-time crop rect border to signal the reframe auto-key
// state (AE keyframe-navigator convention): solid green when the playhead is on a
// keyframe (an edit updates it), dashed amber between keyframes (an edit creates
// one). `null` restores the default white dashed border outside reframe mode.
// Reframe keyframe-state colours, shared by the rect border and the crosshair so
// they can't drift: green when the playhead is on a keyframe (an edit updates it),
// amber between keyframes (an edit creates one).
const ON_KEYFRAME_COLOR = '#3ac36a';
const BETWEEN_KEYFRAME_COLOR = '#f5a623';
function applyCropKeyframeIndicator(onKeyframe: boolean | null): void {
  const border = cropOverlayElements.cropRectBorderWhite as SVGElement | null;
  if (!border) return;
  if (onKeyframe == null) {
    // Classic non-reframe styling.
    border.setAttribute('stroke', 'white');
    border.setAttribute('stroke-dasharray', '5 5');
    return;
  }
  // Reframe: solid rect either way; the colour alone carries the create-vs-edit
  // state (green = on a keyframe, amber = between).
  border.setAttribute('stroke', onKeyframe ? ON_KEYFRAME_COLOR : BETWEEN_KEYFRAME_COLOR);
  border.setAttribute('stroke-dasharray', '0');
}

/** The reframe crop-border colour for the crop at `time`: green on a keyframe (an edit updates
 *  it), amber between (an edit creates one). The reframe canvas border uses this. */
export function reframeKeyframeColor(time: number): string {
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!markerPair) return BETWEEN_KEYFRAME_COLOR;
  return isPlayheadOnCropKeyframe(markerPair.cropMap, time).onKeyframe
    ? ON_KEYFRAME_COLOR
    : BETWEEN_KEYFRAME_COLOR;
}
export function updateDynamicCropOverlays(
  chartData: CropPoint[],
  _currentTime: number,
  isDynamicCrop: boolean
) {
  if (isDynamicCrop || appState.currentCropPointIndex > 0) {
    // The reframe preview focuses on the current-time crop only, so hide the
    // start/end section keyframe overlays (the main crop rect still updates below).
    const sectionDisplay = isReframeEnabled() ? 'none' : 'block';
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = sectionDisplay;
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = sectionDisplay;
    // With the start/end section rects shown (non-reframe dynamic crop), the current-time rect is a
    // third overlapping rect that just adds noise, so hide it — the outside-crop dim already marks
    // the current crop region. Keep it when the dim is off (nothing else cues the current crop), and
    // in reframe where it's the preview (the canvas draws its own border, this SVG one display-hidden).
    setCurrentCropRectVisible(isReframeEnabled() || getCropDimOpacity() === 0);
  } else {
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = 'none';
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = 'none';
    // Single crop rect here (no section rects), so show it.
    setCurrentCropRectVisible(true);
    applyCropKeyframeIndicator(null);
    return;
  }
  const sectStart = chartData[currentCropChartSection[0]];
  const sectEnd = chartData[currentCropChartSection[1]];

  // The current crop that the main rect + crosshair track. In reframe this is the
  // exact crop the video transform is driven from (getCurrentCropComponents — the
  // edited point while manipulating, the interpolated crop while scrubbing); otherwise
  // the section interpolation.
  let [curX, curY, curW, curH] = getEasedCropComponents(sectStart, sectEnd);
  if (isReframeEnabled()) {
    const cc = getCurrentCropComponents();
    if (cc) [curX, curY, curW, curH] = cc;
  }

  // In reframe: on a keyframe (edit) vs between (auto-key) — drives the rect border
  // and crosshair colour. null outside reframe (keeps the classic styling).
  const keyframeState = isReframeEnabled()
    ? isPlayheadOnCropKeyframe(chartData, _currentTime).onKeyframe
    : null;

  [
    cropOverlayElements.cropChartSectionStartBorderGreen,
    cropOverlayElements.cropChartSectionStartBorderWhite,
  ].map((cropRect) => {
    assertDefined(cropRect);
    setCropOverlay(cropRect, sectStart.crop);
  });
  [
    cropOverlayElements.cropChartSectionEndBorderYellow,
    cropOverlayElements.cropChartSectionEndBorderWhite,
  ].map((cropRect) => {
    assertDefined(cropRect);
    setCropOverlay(cropRect, sectEnd.crop);
  });

  const currentCropPoint = chartData[appState.currentCropPointIndex];
  if (cropCrossHairEnabled && cropOverlayElements.cropCrossHair) {
    // In reframe the crosshair centres on the current crop (same as the rect), not
    // the selected keyframe.
    const crossHairCrop = isReframeEnabled()
      ? getCropString(curX, curY, curW, curH)
      : currentCropPoint.crop;
    cropOverlayElements.cropCrossHairs.map((cropCrossHair) => {
      setCropCrossHair(cropCrossHair, crossHairCrop);
    });
    (cropOverlayElements.cropCrossHair as HTMLElement).style.stroke = isReframeEnabled()
      ? keyframeState
        ? ON_KEYFRAME_COLOR
        : BETWEEN_KEYFRAME_COLOR
      : currentCropChartMode === cropChartMode.Start
        ? 'lime'
        : END_CROP_SECTION_COLOR;
  }

  const sectionStartEl = cropOverlayElements.cropChartSectionStart;
  assertDefined(sectionStartEl);
  const sectionEndEl = cropOverlayElements.cropChartSectionEnd;
  assertDefined(sectionEndEl);
  if (currentCropChartMode === cropChartMode.Start) {
    sectionStartEl.setAttribute('opacity', '0.9');
    sectionEndEl.setAttribute('opacity', '0.5');
  } else if (currentCropChartMode === cropChartMode.End) {
    sectionStartEl.setAttribute('opacity', '0.5');
    sectionEndEl.setAttribute('opacity', '0.9');
  }

  // Draw the current-time crop rect from the same crop the crosshair + video
  // transform use, so they stay pixel-locked instead of drifting by the section
  // interpolation.
  [
    cropOverlayElements.cropRect,
    cropOverlayElements.cropRectBorderBlack,
    cropOverlayElements.cropRectBorderWhite,
  ].map((cropRect) => {
    assertDefined(cropRect);
    setCropOverlayDimensions(cropRect, curX, curY, curW, curH);
  });

  applyCropKeyframeIndicator(keyframeState);
}
// Re-position the dynamic crop section (start/end) overlays for the current crop
// map and time without re-rendering the chart. Called when the crop overlay is
// re-laid-out (e.g. on video rotation or resize) so the section crops track the
// main crop immediately instead of lagging until the next frame-driven update.
export function refreshDynamicCropOverlays() {
  if (!appState.isSettingsEditorOpen || appState.wasGlobalSettingsEditorOpen) return;
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!markerPair) return;
  const cropMap = markerPair.cropMap;
  updateDynamicCropOverlays(cropMap, appState.video.getCurrentTime(), !isStaticCrop(cropMap));
}
export function getInterpolatedCrop(sectStart: CropPoint, sectEnd: CropPoint, time: number) {
  const start = getCropComponents(sectStart.crop);
  // A zero-duration section has nothing to ease: hold the start crop.
  const [x, y, w, h] =
    getEasedCropComponentsAtTime(
      start,
      getCropComponents(sectEnd.crop),
      sectStart.x,
      sectEnd.x,
      sectEnd.easeIn,
      time,
      getFPS()
    ) ?? start;
  return getCropString(x, y, w, h);
}
export function cropChartSectionLoop() {
  // Seek back to keep the playhead inside the selected crop-chart section (opt-in looping).
  // loopMarkerPair skips this while manipulating a crop in reframe, where a seek-back would yank
  // the frame being edited.
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
      const isTimeBetweenCropChartSection =
        sectStart <= appState.video.getCurrentTime() && appState.video.getCurrentTime() <= sectEnd;

      // A hair before the section start still counts as inside it: the frame-rounded target lands
      // sub-frame off, and an exact re-seek every frame would storm the player.
      if (
        !isTimeBetweenCropChartSection &&
        !isWithinSameFrame(appState.video.getCurrentTime(), sectStart, appState.videoInfo.fps)
      ) {
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
    syncCropChartVideoHeightLimit();
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
    syncCropChartVideoHeightLimit();
  }
}

let cropChartVideoHeightStyle: HTMLStyleElement | null = null;
// Caps the YouTube video's vertical real estate while the crop chart is open
// so tall sources don't push the chart out of the viewport. YouTube-only —
// other platforms either fix the player height in their own CSS or place the
// chart in a separately scrolling region, so the cap isn't needed there.
export function syncCropChartVideoHeightLimit() {
  if (platform !== VideoPlatforms.youtube) return;
  const shouldCap = appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop';
  if (shouldCap && cropChartVideoHeightStyle == null) {
    cropChartVideoHeightStyle = injectCSS(
      cropChartActiveVideoHeightCSS,
      'yt-clipper-crop-chart-video-height-css'
    );
  } else if (!shouldCap && cropChartVideoHeightStyle != null) {
    deleteElement(cropChartVideoHeightStyle);
    cropChartVideoHeightStyle = null;
  } else {
    return;
  }
  // The cap resizes the player; re-fit the video to it so centerVideo (which
  // measures the player container) shrinks the video and crop overlay to match.
  resizeCropOverlay();
}
export function toggleCurrentChartVisibility() {
  if (!appState.isCurrentChartVisible) {
    showChart();
  } else {
    hideChart();
  }
}
