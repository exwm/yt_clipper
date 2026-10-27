import { createDraft, finishDraft } from 'immer';
import { ChartInput, CropPath, CropPoint, MarkerPair } from './@types/yt_clipper';
import { appState, VideoElement } from './appState';
import {
  currentCropChartMode,
  cropChartMode,
  setCurrentCropPoint,
  getCropChartConfig,
  currentCropChartSection,
  isCropPointHighlightVisible,
  setCropPointHighlightVisible,
} from './ui/chart/cropchart/cropChartSpec';
import { activeCropPoints } from './ui/chart/cropchart/active-crop-points';
import {
  assertDefined,
  blockEvent,
  bsearch,
  clampNumber,
  deleteElement,
  flashMessage,
  getCropString,
  injectCSS,
  pauseSafe,
  seekToSafe,
  timeRounder,
} from './util/util';
import { cropChartActiveVideoHeightCSS } from './ui/css/css';
import { platform } from './yt_clipper';
import { VideoPlatforms } from './platforms/platforms';
import { html, render } from 'lit-html';
import { getRotatedCropString, updateCropString } from './crop-utils';
import { setHoveredRegion } from './features/hints-bar/hover-region';
import {
  cropInput,
  cropInputLabel,
  interpCropSpan,
  highlightSpeedAndCropInputs,
  renderCropForm,
  enableZoomPanInput,
} from './features/settings/settings-editor';
import {
  cropCrossHairEnabled,
  cropOverlayElements,
  END_CROP_SECTION_COLOR,
  forceRerenderCrop,
  getCropDimOpacity,
  isDrawingCrop,
  isMouseManipulatingCrop,
  renderStaticCropOverlay,
  resizeCropOverlay,
  resolveCropEditConflict,
  setCropCrossHair,
  setCropOverlay,
  setCropOverlayDimensions,
  setCurrentCropRectVisible,
} from './crop-overlay';
import { getCropComponents, isStaticCrop, setCropInputValue } from './crop-utils';
import { Crop } from './crop/crop';
import { ownCropToRelease, toggleHold, toggleInstant } from './crop/crop-point-holds';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import {
  bakeCinematicPath,
  CinematicMargins,
  cinematicCropMap,
  cinematicMarginsFromPercent,
  cropPathSignature,
  evalCropPathAtTime,
  isCropPathFresh,
} from './crop/cinematic-path';
import {
  CinematicSolveEvent,
  CinematicSolveInputs,
  initialCinematicSolveSchedule,
  stepCinematicSolve,
} from './crop/cinematic-solve-schedule';
import { pairSettings } from './features/settings/pair-settings';
import {
  CINEMATIC_PATH_SOLVED_EVENT,
  CinematicPlotInput,
  isCinematicPathPlotShown,
} from './crop/cinematic-path-plot';
import {
  CropKeyframeMatch,
  CropPointEasing,
  findCropKeyframeAtTime,
  nextKeyframeIndex,
  cropSectionAt,
  cropSectionAtTime,
  sectionCropAt,
} from './crop/crop-keyframe-math';
import { isReframeEnabled, syncReframe } from './crop/video-zoom-controller';
import { featureFlags } from './feature-flags';
import { renderMarkerPair } from './markers';
import { isDraggingChartPoint } from './ui/chart/chart.js-drag-data-plugin';
import { sortX } from './ui/chart/chartPrimitives';
import { updateCharts } from './ui/chart/chartutil';
import { createTimeLineLayer, TimeLineLayer, TimeLinePosition } from './ui/chart/chart-time-line';
import { speedChartSpec } from './ui/chart/speedchart/speedChartSpec';
import { registerActiveDragCleanup } from './util/drag-recovery';
import { Chart, ChartConfiguration } from 'chart.js';
import { scatterChartDefaults } from './ui/chart/scatterChartSpec';
import { getFPS, getFrameGrid, loopPlaybackOver, seekToFrameAt } from './util/videoUtil';
import { frameAt } from './util/frame-grid';
import { getPresentedFrameTime } from './util/presented-frame-clock';
import { onVideoFrames, VideoFrameSubscription } from './util/video-frame-loop';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import type { HoveredRegion } from './features/hints-bar/hover-region';

/** Wires up hover-region tracking on a chart canvas. The mousemove handler
 *  uses Chart.js's hit-test to flip between `{type}-chart` (cursor over the
 *  empty canvas) and `{type}-chart-point` (cursor over a data point) so the
 *  hints bar can show point-manipulation chips only when relevant. */
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
    chartSpec: getCropChartConfig(),
    minBound: 0,
    maxBound: 0,
    chartLoopKey: 'cropChartLoop',
    dataMapKey: 'cropMap',
  } as ChartInput,
  currentChartInput: null as ChartInput | null,
  shouldTriggerCropChartUpdates: false,
};

export function selectCropPointWithMouseWheel(e: WheelEvent) {
  if (appState.isHotkeysEnabled && !e.ctrlKey && e.altKey && !e.shiftKey) {
    blockEvent(e);
  } else {
    return;
  }
  if (!resolveCropEditConflict('selectCropPoint')) return;

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
      // The frame on screen: after the last step the playhead is just past its point's time, which
      // can be in the next grid frame.
      const nextIndex = nextKeyframeIndex(
        points,
        getPresentedFrameTime(appState.video),
        getFrameGrid(),
        e.deltaY < 0 ? 1 : -1
      );
      setCurrentCropPoint(cropChart, nextIndex);
      pauseSafe(appState.video);
      seekToFrameAt(points[nextIndex].x);
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
    chartState.cropChartInput.chart &&
    resolveCropEditConflict('copyNeighborCrop')
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
      // The crop section band is drawn by a chart plugin, so it only refreshes on a crop chart draw.
      // While paused the video frame loop is idle, and in reframe the crop chart is often not the
      // "current" chart that updateCharts redraws, so a crop edit would leave the band stale. Redraw
      // the crop chart directly on a settled paused edit (skip mid-drag to avoid the rapid-update
      // point glitch; the drag release re-renders).
      const cropChartAlreadyRerendered =
        rerenderCharts &&
        appState.isCurrentChartVisible &&
        chartState.currentChartInput?.type === 'crop';
      if (
        chartState.cropChartInput.chart &&
        appState.video.paused &&
        !isMouseManipulatingCrop &&
        !isDrawingCrop &&
        !cropChartAlreadyRerendered
      ) {
        chartState.cropChartInput.chart.update();
      }
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
    } else {
      const crop = appState.settings.newMarkerCrop;
      renderCropForm(crop);
      renderStaticCropOverlay(crop);
    }
    highlightSpeedAndCropInputs();
    triggerCropPreviewRedraw();
    // Crop points changed: rebake the cinematic path if that mode is active (debounced, freshness-
    // gated, so this is a no-op otherwise).
    scheduleCinematicRecompute();
    // Drive the reframe preview from the crop when it's edited (drag-release, arrow
    // keys, point switch), not just when scrubbing, so it tracks a static crop too.
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

      initializeChartData(chartInput);
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
      startCropPreviewLoop();
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
// Right-click and drag on the canvas to seek. By default its width spans the marker pair.
export function getCropPreviewMouseTimeSetter(
  modalContainer: HTMLCanvasElement,
  getSeekTime: (e: MouseEvent) => number = (e) => {
    const rect = modalContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scaledX = x / rect.width;

    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const duration = markerPair.end - markerPair.start;
    const seekTime = markerPair.start + scaledX * duration;
    return seekTime;
  }
) {
  return function seekHandler(e) {
    if (e.buttons !== 2) return;
    blockEvent(e);
    const pointerId = e.pointerId;
    // shift+right-click context menu opens screenshot tool in firefox 67.0.2
    function seekDragHandler(e) {
      // Self-defending end check: pointermove always reports the
      // currently-held buttons bitmask. If the right button is no longer
      // held but we're still receiving pointermove, the browser dropped
      // our `pointerup`: known to happen in Vivaldi (mouse gestures
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
    // implicitly releases capture: right-click drags were particularly
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
      // Self-defending end check: see the matching seekDragHandler
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
      if (Math.abs(appState.video.getCurrentTime() - time) >= 0.01) {
        seekToSafe(appState.video, time);
      }
      if (!e.ctrlKey && !e.altKey && e.shiftKey) {
        chartOpts.annotation.annotations[0].value = time;
        chartLoop.start = time;
        chart.update();
      } else if (!e.ctrlKey && e.altKey && !e.shiftKey) {
        chartOpts.annotation.annotations[1].value = time;
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
      chartOpts.annotation.annotations[0].borderColor = 'rgba(0, 255, 0, 0.4)';
      chartOpts.annotation.annotations[1].borderColor = 'rgba(255, 215, 0, 0.4)';
      flashMessage('Speed chart looping disabled', 'red');
    } else {
      chartLoop.enabled = true;
      chartOpts.annotation.annotations[0].borderColor = 'rgba(0, 255, 0, 0.9)';
      chartOpts.annotation.annotations[1].borderColor = 'rgba(255, 215, 0, 0.9)';
      flashMessage('Speed chart looping enabled', 'green');
    }
    chart.update();
  }
}
export function initializeChartData(chartInput: ChartInput) {
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const dataMap = markerPair[chartInput.dataMapKey];
    const chartData = chartInput.chartSpec.data;
    assertDefined(chartData);
    const datasets = chartData.datasets;
    assertDefined(datasets);
    datasets[0].data = dataMap;
    updateChartBounds(chartInput, markerPair.start, markerPair.end);
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
      updateChartBounds(chartInput, markerPair.start, markerPair.end);
      if (appState.isCurrentChartVisible && chartState.currentChartInput === chartInput)
        chart.update();
    }
  }
}
export function updateChartBounds(chartInput: ChartInput, start, end) {
  // ticks.min/max is also the zoom plugin's current view; only reset it when this chart's bounds
  // moved, so unrelated actions (selecting/adding/deleting a point) don't snap a zoomed-in
  // chart back to the full clip. Tracked per chart: each chart applies the bounds to its own config,
  // so one chart having recorded them must not skip the other chart's write.
  const boundsChanged = chartInput.minBound !== start || chartInput.maxBound !== end;
  chartInput.minBound = start;
  chartInput.maxBound = end;

  // The chart mutates its config in place, so before creation the spec and after creation
  // chart.config address the same options object.
  const chartConfig: ChartConfiguration = chartInput.chart
    ? chartInput.chart.config
    : chartInput.chartSpec;
  const opts = chartConfig.options;
  assertDefined(opts);
  const scales = opts.scales;
  assertDefined(scales);
  const xAxes = scales.xAxes;
  assertDefined(xAxes);
  const ticks = xAxes[0].ticks;
  assertDefined(ticks);
  if (boundsChanged) {
    ticks.min = start;
    ticks.max = end;
  }
  const plugins = opts.plugins;
  assertDefined(plugins);
  plugins.zoom.pan.rangeMin.x = start;
  plugins.zoom.pan.rangeMax.x = end;
  plugins.zoom.zoom.rangeMin.x = start;
  plugins.zoom.zoom.rangeMax.x = end;
}
// Each chart's time line layer, made on its first frame shown.
const timeLineLayers = new WeakMap<HTMLCanvasElement, TimeLineLayer>();
const TIME_LINE_STYLE = { color: 'rgba(255, 0, 0, 0.9)', width: 1 };

/** Where the time line goes on a chart: the only charting library code the time line needs. */
function timeLinePosition(chart: Chart, time: number): TimeLinePosition {
  const { left, right, top, bottom } = chart.chartArea;
  return { x: chart.scales['x-axis-1'].getPixelForValue(time), left, right, top, bottom };
}

export function updateChartTimeAnnotation() {
  const chart = chartState.currentChartInput?.chart;
  if (appState.isCurrentChartVisible && chart?.canvas) {
    const currentInput = chartState.currentChartInput;
    assertDefined(currentInput);
    // The playhead, so the line lands where a click seeks to. Its position is read every frame, so a
    // chart zoom, pan or resize moves it too; the layer skips unchanged lines.
    const time = clampNumber(
      appState.video.getCurrentTime(),
      currentInput.minBound,
      currentInput.maxBound
    );
    let layer = timeLineLayers.get(chart.canvas);
    if (!layer) {
      layer = createTimeLineLayer(chart.canvas, TIME_LINE_STYLE);
      timeLineLayers.set(chart.canvas, layer);
    }
    layer.draw(timeLinePosition(chart, time));
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
  cropChartPreviewHandler();
  triggerCropPreviewRedraw();
}
// During the video frame loop the crop is computed for the
// EXACT media timestamp of the frame being presented (frame.mediaTime), not the
// wall-clock getCurrentTime() which advances between presented frames and makes the
// reframe jitter a fraction of a frame ahead of the video. Null outside the loop
// (scrub/edit) → fall back to the last presented frame, which a sub-frame seek doesn't change.
let presentedFrameTime: number | null = null;
function currentCropTime(): number {
  return presentedFrameTime ?? getPresentedFrameTime(appState.video);
}

let cropPreviewSubscription: { video: VideoElement; frames: VideoFrameSubscription } | null = null;

// Follows appState.video, which Afreeca TV replaces.
function subscribeCropPreviewToFrames(): void {
  if (cropPreviewSubscription?.video === appState.video) return;
  cropPreviewSubscription?.frames.stop();
  const video = appState.video;
  cropPreviewSubscription = {
    video,
    frames: onVideoFrames(video, (frame) => cropChartPreviewHandler(frame.mediaTime), {
      phase: 'update',
      label: 'crop chart preview',
    }),
  };
}

// Starts the per-frame crop preview once: when a marker pair editor opens, so a dynamic crop previews
// its eased crop before the crop chart is ever shown, and when the chart is first created.
export function startCropPreviewLoop(): void {
  subscribeCropPreviewToFrames();
  cropChartPreviewHandler();
}

export function cropChartPreviewHandler(frameTime?: number) {
  presentedFrameTime = frameTime ?? null;
  try {
    const chart = chartState.cropChartInput.chart;
    const chartData = activeCropPoints(chart, appState);
    if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen && chartData) {
      const time = currentCropTime();
      const isDynamicCrop = !isStaticCrop(chartData);
      const isCropChartVisible =
        chartState.currentChartInput?.type == 'crop' && appState.isCurrentChartVisible;
      const isManipulatingOrDrawing = isMouseManipulatingCrop || isDrawingCrop;
      if (isReframeEnabled()) {
        // Reframe auto-key is playhead-driven: never auto-seek to a section start
        // (cropChartSectionLoop), which would yank the playhead while editing. The
        // selection is the keyframe at the current time (or the section's left point
        // between keyframes); during manipulation it's already the auto-keyed point.
        chartState.shouldTriggerCropChartUpdates = false;
        // Update the highlight on EVERY presented frame, exactly like the canvas keyframe border
        // (reframeKeyframeColor), so the two never disagree: both read isPlayheadOnCropKeyframe at the
        // same frame. Do NOT gate on video.seeking: a frame-step presents its frame while seeking is
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

      const cropLabel =
        isDynamicCrop || appState.currentCropPointIndex > 0
          ? `Crop Point ${appState.currentCropPointIndex + 1}`
          : 'Crop';
      // Writing the same text still replaces the text node and dirties layout every frame.
      if (cropInputLabel.textContent !== cropLabel) cropInputLabel.textContent = cropLabel;

      // Keep the crop input value in sync with the selected point as the playhead crosses points, so
      // it shows the current point's crop during playback (the label updated before, the value did
      // not). Skip while the field is focused or the crop is being manipulated, to never clobber an
      // active edit. Value-only write, no re-render or seek, so it is safe in the per-frame loop.
      if (!isManipulatingOrDrawing && cropInput && document.activeElement !== cropInput) {
        const selectedCrop = chartData[appState.currentCropPointIndex]?.crop;
        if (selectedCrop != null && cropInput.value !== selectedCrop) {
          cropInput.value = selectedCrop;
        }
      }

      updateInterpCropSpan();

      updateDynamicCropOverlays(chartData, time, isDynamicCrop);
      // The reframe canvas loop refreshes the transform every frame, so no syncReframe needed here.
    }
  } finally {
    // Always clear the pinned frame time even if the body threw, otherwise a stale
    // presentedFrameTime would skew every later currentCropTime() read.
    presentedFrameTime = null;
    if (cropPreviewSubscription) subscribeCropPreviewToFrames();
  }
}
// Show the live interpolated crop at the playhead next to the point, copyable. textContent only, so
// it is safe in the per-frame loop.
function updateInterpCropSpan(): void {
  if (!interpCropSpan) return;
  const cc = getCurrentCropComponents();
  if (!cc) return;
  // Round to integer pixels so it matches the crop input (which stores integer crops), and show
  // rotated coordinates while previewing a rotation, matching setCropInputValue.
  let interpCropString = getCropString(
    Math.round(cc[0]),
    Math.round(cc[1]),
    Math.round(cc[2]),
    Math.round(cc[3])
  );
  if (appState.rotation !== 0) interpCropString = getRotatedCropString(interpCropString);
  if (interpCropSpan.textContent !== interpCropString) {
    interpCropSpan.textContent = interpCropString;
  }
}
export function setCurrentCropPointWithCurrentTime() {
  const cropChart = chartState.cropChartInput.chart;
  const chartData = activeCropPoints(cropChart, appState);
  if (chartData) {
    const time = currentCropTime();
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

    return getEasedCropComponents(cropSectionAt(chartData, currentCropChartSection[0]));
  }

  return null;
}

// The crop point easing the active marker pair uses, defaulting to smoothTrack: it tracks a moving
// subject without stalling at points and without overshooting one on a reversal. Smooth track needs
// the section's neighbors, which the callers below pass in.
function getActiveCropPointEasing(): CropPointEasing {
  return getCropPointEasing(appState.markerPairs[appState.prevSelectedMarkerPairIndex]);
}

function getCropPointEasing(markerPair: MarkerPair | undefined): CropPointEasing {
  return pairSettings(markerPair, appState.settings).cropPointEasing;
}

// The cinematic margins for the active pair: per-pair override, else global, else default.
function getActiveCinematicMargins(): CinematicMargins {
  return getCinematicMargins(appState.markerPairs[appState.prevSelectedMarkerPairIndex]);
}

function getCinematicMargins(mp: MarkerPair | undefined): CinematicMargins {
  const settings = pairSettings(mp, appState.settings);
  return cinematicMarginsFromPercent(
    settings.cropPointEasingCinematicMargin,
    settings.cropPointEasingCinematicZoomMargin
  );
}

// The crop points the pair's Cinematic solve reads, with its hold points as the holds setting says.
function getCinematicCropMap(mp: MarkerPair): readonly CropPoint[] {
  return cinematicCropMap(
    mp.cropMap,
    pairSettings(mp, appState.settings).cropPointEasingCinematicHolds
  );
}

// The preview's solved cinematic path per marker pair. Not saved: the clipper solves its own.
const cinematicPaths = new WeakMap<MarkerPair, CropPath>();

// The active pair's crop points and solved path, for the plot in the Cinematic settings.
export function getActiveCinematicPlotInput(): CinematicPlotInput | null {
  const mp = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!mp) return null;
  const { cropResWidth, cropResHeight } = appState.settings;
  const margins = getActiveCinematicMargins();
  const fps = getFPS();
  const path = cinematicPaths.get(mp);
  const cropMap = getCinematicCropMap(mp);
  const fresh = isCropPathFresh(path, cropMap, margins, cropResWidth, cropResHeight, fps);
  return {
    cropMap,
    margins,
    cropResWidth,
    cropResHeight,
    fps,
    enableZoomPan: mp.enableZoomPan,
    path: fresh && path ? path : null,
  };
}

// The cinematic crop at the current time, or null when there is no fresh path yet (mid-edit or
// mid-recompute), in which case the caller falls back to a smooth interpolation.
function getActiveCinematicCrop(): [number, number, number, number] | null {
  const mp = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  const path = mp && cinematicPaths.get(mp);
  if (!path) {
    // After a failed solve, a frame rate change is new input, as below.
    if (mp && failedCinematicSignatures.has(mp)) stepCinematicSolveSchedule({ type: 'frame' });
    return null;
  }
  const { cropResWidth, cropResHeight } = appState.settings;
  if (
    !isCropPathFresh(
      path,
      getCinematicCropMap(mp),
      getActiveCinematicMargins(),
      cropResWidth,
      cropResHeight,
      getFPS()
    )
  ) {
    // Stale without an edit (the video's frame rate changed with its quality): nothing else would
    // solve it again.
    stepCinematicSolveSchedule({ type: 'frame' });
    return null;
  }
  return evalCinematicCrop(mp, path, currentCropTime());
}

// The fitted x and w (or y and h) can each be a fraction of a pixel off, so between samples the crop
// can pass the frame edge by a pixel or so. ffmpeg's crop and zoompan clamp the render there.
function evalCinematicCrop(
  mp: MarkerPair,
  path: CropPath,
  time: number
): [number, number, number, number] {
  // The path's times start at the first crop point, which the holds setting leaves where it is.
  const [x, y, w, h] = evalCropPathAtTime(path, time - (mp.cropMap[0]?.x ?? 0));
  const { cropResWidth, cropResHeight } = appState.settings;
  return [clampNumber(x, 0, cropResWidth - w), clampNumber(y, 0, cropResHeight - h), w, h];
}

let cinematicSolveSchedule = initialCinematicSolveSchedule;
let cinematicSolveTimer: ReturnType<typeof setTimeout> | undefined;

export function isCinematicSolvePending(): boolean {
  return cinematicSolveSchedule.pendingSignature !== null;
}

// Per pair, the inputs of its last solve if that solve failed.
const failedCinematicSignatures = new WeakMap<MarkerPair, string>();
// How long the crop points must sit unchanged before the (heavy, global) L1 solve runs. Every edit
// resets this, so the solve runs once, after editing settles, not during it.
const CINEMATIC_RECOMPUTE_DEBOUNCE_MS = 350;

// The inputs the schedule decides on, read from the active pair now.
function cinematicSolveInputs(): CinematicSolveInputs {
  const mp = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  // The plot in the Cinematic settings also shows the path in Smooth Track, to compare the two.
  const needed = getActiveCropPointEasing() === 'cinematic' || isCinematicPathPlotShown();
  const manipulating = isMouseManipulatingCrop || isDrawingCrop || isDraggingChartPoint();
  if (!mp || !needed) {
    return { signature: null, fresh: false, failedSignature: undefined, manipulating };
  }
  const { cropResWidth, cropResHeight } = appState.settings;
  const cropMap = getCinematicCropMap(mp);
  const margins = getActiveCinematicMargins();
  // The cuts land on frame boundaries, as the render's do.
  const fps = getFPS();
  return {
    signature: cropPathSignature(cropMap, margins, cropResWidth, cropResHeight, fps),
    fresh: isCropPathFresh(
      cinematicPaths.get(mp),
      cropMap,
      margins,
      cropResWidth,
      cropResHeight,
      fps
    ),
    failedSignature: failedCinematicSignatures.get(mp),
    manipulating,
  };
}

function stepCinematicSolveSchedule(event: CinematicSolveEvent): void {
  const step = stepCinematicSolve(cinematicSolveSchedule, event, cinematicSolveInputs());
  cinematicSolveSchedule = step.state;
  for (const action of step.actions) {
    if (action.type === 'solve') {
      solveActiveCinematicPath();
      continue;
    }
    clearTimeout(cinematicSolveTimer);
    cinematicSolveTimer =
      action.type === 'startTimer'
        ? setTimeout(
            () => stepCinematicSolveSchedule({ type: 'timerFired' }),
            CINEMATIC_RECOMPUTE_DEBOUNCE_MS
          )
        : undefined;
  }
}

// Recompute the active pair's cinematic path after edits settle (cinematic-solve-schedule.ts
// decides when), and keep the crop chip's count of the shown path's segments up to date.
export function scheduleCinematicRecompute(): void {
  if (typeof window === 'undefined') return;
  const previewed = getActiveCropPointEasing() === 'cinematic';
  const mp = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  const path = mp && cinematicPaths.get(mp);
  const { cropResWidth, cropResHeight } = appState.settings;
  const fresh =
    mp &&
    path &&
    isCropPathFresh(
      path,
      getCinematicCropMap(mp),
      getActiveCinematicMargins(),
      cropResWidth,
      cropResHeight,
      getFPS()
    );
  // A reopened editor has a new crop chip, without the count of the path it still shows. A stale
  // count is for a path that no longer applies.
  const shownSegments = previewed && fresh && path ? path.segments.length : 0;
  interpCropSpan?.setAttribute('data-cinematic-segments', String(shownSegments));
  stepCinematicSolveSchedule({ type: 'request' });
}

function solveActiveCinematicPath(): void {
  const mp = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!mp) return;
  const previewed = getActiveCropPointEasing() === 'cinematic';
  const { cropResWidth, cropResHeight } = appState.settings;
  const margins = getActiveCinematicMargins();
  const fps = getFPS();
  const startMs = performance.now();
  let path: ReturnType<typeof bakeCinematicPath>;
  try {
    path = bakeCinematicPath(getCinematicCropMap(mp), margins, cropResWidth, cropResHeight, fps);
  } catch (error) {
    // Without a path the preview uses Smooth Track, as the clipper does when it cannot solve.
    console.error('Cinematic path solve failed', error);
    cinematicPaths.delete(mp);
    failedCinematicSignatures.set(
      mp,
      cropPathSignature(getCinematicCropMap(mp), margins, cropResWidth, cropResHeight, fps)
    );
    interpCropSpan?.setAttribute('data-cinematic-segments', '0');
    refreshCropPreview();
    document.dispatchEvent(new Event(CINEMATIC_PATH_SOLVED_EVENT));
    if (previewed) {
      flashMessage(
        'Could not compute the Cinematic path, so the preview uses Smooth Track.',
        'red'
      );
    }
    return;
  }
  const elapsedMs = Math.round(performance.now() - startMs);
  if (path) cinematicPaths.set(mp, path);
  else cinematicPaths.delete(mp);
  failedCinematicSignatures.delete(mp);
  // The UI tests wait on this. It counts the path the preview shows.
  if (previewed) {
    interpCropSpan?.setAttribute('data-cinematic-segments', String(path?.segments.length ?? 0));
  }
  refreshCropPreview();
  document.dispatchEvent(new Event(CINEMATIC_PATH_SOLVED_EVENT));
  if (path && featureFlags.cinematicSolveStats) {
    flashMessage(`Cinematic path: ${path.segments.length} segments in ${elapsedMs}ms`, 'green');
  }
}

// The frame loops redraw the crop only when a frame is presented, so after a solve or an easing
// change while paused, redraw it at the current time. Without a seek, unlike triggerCropChartUpdates.
export function refreshCropPreview(): void {
  updateInterpCropSpan();
  refreshDynamicCropOverlays();
  if (isReframeEnabled()) syncReframe(getCurrentCropComponents());
  triggerCropPreviewRedraw();
}

export function getEasedCropComponents(
  section: ReturnType<typeof cropSectionAt>
): [number, number, number, number] {
  const easing = getActiveCropPointEasing();
  // Cinematic mode replaces interpolation with the baked L1 path (a function of time, not the
  // section). Before the path is baked (mid-edit or mid-recompute) fall through to a smooth-track
  // interpolation so the preview never stalls.
  if (easing === 'cinematic') {
    const baked = getActiveCinematicCrop();
    if (baked) return baked;
  }
  return sectionCropAt(
    easing,
    section,
    currentCropTime(),
    getFPS(),
    { width: appState.settings.cropResWidth, height: appState.settings.cropResHeight },
    getCropComponents
  );
}
// The current crop in cropRes coords: the eased/interpolated crop for a dynamic
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
  // be off the current time) rather than the interpolated crop, otherwise the view
  // only tracks the edit when the playhead happens to sit near that point. When just
  // scrubbing, follow the interpolated crop so a moving subject stays framed.
  const editing = isMouseManipulatingCrop || isDrawingCrop;
  if (!isStaticCrop(cropMap) && !editing) {
    const time = currentCropTime();
    // Snap to the exact crop point only while parked on its own frame (video paused). Right after an
    // edit the playhead sits a sub-frame off the auto-keyed point (inserted at its frame's start), so
    // interpolating there would blend toward a neighbor and shift a fast smoothTrack crop a few
    // pixels off what was drawn; the snap holds it. We must NOT snap during playback, nor when
    // frame-stepping PAST a point (a full frame away), or the crop freezes for the ~3 frames within
    // a frame of the point and looks like a jump when crossing it. The paused gate plus the same-frame
    // (half-frame) test restricts the snap to exactly the parked-on-a-point cases.
    const { index } = isPlayheadOnCropKeyframe(cropMap, time);
    const parkedPoint = cropMap[index];
    // Cinematic mode approximates points rather than passing through them, so snapping to the exact
    // keyframe crop would jump off the path; let it interpolate (eval the baked path) instead.
    if (
      parkedPoint &&
      appState.video.paused &&
      frameAt(getFrameGrid(), time) === frameAt(getFrameGrid(), parkedPoint.x) &&
      getActiveCropPointEasing() !== 'cinematic'
    ) {
      const [kx, ky, kw, kh] = getCropComponents(parkedPoint.crop);
      return [kx, ky, kw, kh];
    }
    // Otherwise interpolate within the section that brackets the CURRENT TIME, not the chart
    // selection: in reframe the selection snaps to the nearest keyframe (flipping at the
    // section midpoint), so keying off it clamps the time outside the section and makes
    // the preview jump to the next keyframe instead of easing smoothly across it.
    const section = cropSectionAtTime(cropMap, time);
    if (section.start && section.end) return getEasedCropComponents(section);
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

/** Run `fn` with the crop clock pinned to `mediaTime`, so anything it reads resolves the crop at the
 *  frame the canvas drew, not wall-clock getCurrentTime, which drifts within a frame. */
export function withPresentedFrameTime<T>(mediaTime: number, fn: () => T): T {
  const prev = presentedFrameTime;
  presentedFrameTime = mediaTime;
  try {
    return fn();
  } finally {
    presentedFrameTime = prev;
  }
}

// Is the playhead sitting on a crop keyframe's frame? Drives the reframe auto-key model: on a
// keyframe an edit updates it, between keyframes an edit creates one. Thin wrapper supplying the
// frame grid to the pure math.
export function isPlayheadOnCropKeyframe(cropMap: CropPoint[], time: number): CropKeyframeMatch {
  return findCropKeyframeAtTime(cropMap, time, getFrameGrid());
}

// Select a crop point for editing. Set the index directly (works even when the
// crop chart was never opened, leaving its instance null) and only sync the
// chart's section/selection state when an instance exists: `setCurrentCropPoint`
// clamps to maxIndex=1 against a null chart, which would mis-select on a
// JSON-loaded dynamic crop.
function selectCropPoint(index: number): void {
  appState.currentCropPointIndex = index;
  const cropChart = chartState.cropChartInput.chart;
  if (cropChart) setCurrentCropPoint(cropChart, index);
}

// Reframe auto-key: editing the crop is playhead-driven, the current time IS
// the current keyframe. On a keyframe we edit it; between keyframes we create one
// at the current time capturing the interpolated crop the reframe is already
// showing (no visual jump). Pauses playback (stays paused; manual resume) so the
// user manipulates a still frame. Called at crop-manipulation start, before the
// drag reads `currentCropPointIndex`, so the drag edits the right point. Returns false, refusing the
// edit, when the playhead is outside the pair, where a new point would land outside it.
export function autoKeyCurrentCropPoint(): boolean {
  if (!appState.isSettingsEditorOpen || appState.wasGlobalSettingsEditorOpen) return true;
  const pair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!pair) return true;
  const cropMap = pair.cropMap;

  const cropChartOpen =
    appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop';
  // A static crop with the chart closed edits as a whole (no keyframing); only
  // turn it dynamic when the user has opened the crop chart. Already-dynamic
  // crops always auto-key.
  if (isStaticCrop(cropMap) && !cropChartOpen) return true;

  // The frame on screen: right after a seek to the end marker the playhead is just past its time.
  const frameTime = getPresentedFrameTime(appState.video);
  if (
    !isPlayheadOnCropKeyframe(cropMap, frameTime).onKeyframe &&
    (frameTime < pair.start || frameTime > pair.end)
  ) {
    flashMessage('Seek into the marker pair to edit its crop.', 'olive');
    return false;
  }

  // Ctrl+wheel zoom calls this per wheel tick; pauseSafe avoids re-pausing (it churns the player).
  pauseSafe(appState.video);
  // The frame on screen is the one being edited.
  const time = getPresentedFrameTime(appState.video);

  const { onKeyframe, index } = isPlayheadOnCropKeyframe(cropMap, time);
  if (onKeyframe) {
    selectCropPoint(index);
    return true;
  }

  // Between keyframes: insert one at the current time holding the interpolated
  // crop. `storeHistory: false` mutates live state without a checkpoint so the
  // drag's release-time push collapses insert + move into a single undo step.
  const cc = getCurrentCropComponents();
  if (!cc) return true;
  // cc is the interpolated crop (float); snap it to a valid stored crop (whole pixels, clamped,
  // shared AR) via setCropStringSafe, the same path the chart keyframe edits use. Round first:
  // setCropStringSafe truncates, and an eased size can land a hair under the integer (99.999...),
  // which would shrink the point by a pixel and make a pan a zoom.
  const [cx, cy, cw, ch] = cc.map(Math.round);
  const safeCrop = new Crop(
    cx,
    cy,
    cw,
    ch,
    appState.settings.cropResWidth,
    appState.settings.cropResHeight
  );
  safeCrop.setCropStringSafe(getCropString(cx, cy, cw, ch), pair.enableZoomPan);
  const crop = safeCrop.cropString;
  const draft = createDraft(getMarkerPairHistory(pair));
  draft.cropMap.push({ x: time, y: 0, crop });
  draft.cropMap.sort(sortX);
  const newIndex = draft.cropMap.findIndex((p) => p.x === time);
  saveMarkerPairHistory(draft, pair, false);
  // Render before selecting so setCurrentCropPoint's bounds-clamp reads the post-insert length,
  // else the new index is clamped down and the previous point is selected. Mirrors addCropPoint.
  renderSpeedAndCropUI();
  selectCropPoint(newIndex);
  return true;
}

// Ctrl+Alt+A: add a hold point at the current time, or toggle hold on the crop point under the
// playhead. Same rule as auto-keying: the crop must be dynamic or the crop chart open.
export function addHoldCropPointAtCurrentTime(): void {
  if (!appState.isSettingsEditorOpen || appState.wasGlobalSettingsEditorOpen) return;
  const pair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!pair) return;
  if (!resolveCropEditConflict('addHoldCropPoint')) return;
  const cropMap = pair.cropMap;
  const cropChartOpen =
    appState.isCurrentChartVisible && chartState.currentChartInput?.type === 'crop';
  if (isStaticCrop(cropMap) && !cropChartOpen) {
    flashMessage('Open the crop chart to add a hold crop point.', 'olive');
    return;
  }

  const x = getPresentedFrameTime(appState.video);
  const { onKeyframe, index } = isPlayheadOnCropKeyframe(cropMap, x);
  const pointIndex = onKeyframe ? index : cropMap.findIndex((p) => p.x === x);
  let selectedIndex: number;
  if (pointIndex !== -1) {
    if (!toggleCropPointType(pair, pointIndex, 'hold')) return;
    selectedIndex = pointIndex;
  } else {
    if (x <= pair.start || x >= pair.end) return;
    selectedIndex = cropMap.findIndex((p) => p.x > x);
    const draft = createDraft(getMarkerPairHistory(pair));
    draft.cropMap.splice(selectedIndex, 0, {
      x,
      y: 0,
      crop: cropMap[selectedIndex - 1].crop,
      hold: true,
    });
    saveMarkerPairHistory(draft, pair);
  }
  renderSpeedAndCropUI();
  selectCropPoint(selectedIndex);
}

/** Toggle a crop point's hold or its instant easing, and save it. A released hold point gets back its
 *  own crop. Returns false, with a flash and nothing saved, for hold on the first point. */
export function toggleCropPointType(
  pair: MarkerPair,
  index: number,
  type: 'hold' | 'instant'
): boolean {
  const draft = createDraft(getMarkerPairHistory(pair));
  const point = draft.cropMap[index];
  const ownCrop = point.hold ? ownCropToRelease(point, pair) : undefined;
  if (type === 'instant') {
    toggleInstant(draft.cropMap, index, ownCrop);
  } else if (!toggleHold(draft.cropMap, index, ownCrop)) {
    flashMessage("The first crop point can't be a hold point.", 'red');
    return false;
  }
  saveMarkerPairHistory(draft, pair);
  return true;
}

// Reframe keyframe-state colours (AE keyframe-navigator convention): green when the playhead is on
// a keyframe (an edit updates it), amber between keyframes (an edit creates one).
const ON_KEYFRAME_COLOR = '#3ac36a';
const BETWEEN_KEYFRAME_COLOR = '#f5a623';

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
    // start/end section keyframe overlays.
    const sectionDisplay = isReframeEnabled() ? 'none' : 'block';
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = sectionDisplay;
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = sectionDisplay;
    // The reframe canvas draws the crop and hides the rest of the SVG overlay, so skip its per-frame
    // layout. Leaving reframe re-renders the overlay (renderSpeedAndCropUI).
    if (isReframeEnabled()) return;
    // With the start/end section rects shown, the current-time rect is a third overlapping rect
    // that just adds noise, so hide it: the outside-crop dim already marks the current crop region.
    // Keep it when the dim is off (nothing else cues the current crop).
    setCurrentCropRectVisible(getCropDimOpacity() === 0);
  } else {
    (cropOverlayElements.cropChartSectionStart as HTMLElement).style.display = 'none';
    (cropOverlayElements.cropChartSectionEnd as HTMLElement).style.display = 'none';
    // Single crop rect here (no section rects), so show it.
    setCurrentCropRectVisible(true);
    return;
  }
  const section = cropSectionAt(chartData, currentCropChartSection[0]);
  const { start: sectStart, end: sectEnd } = section;
  const [curX, curY, curW, curH] = getEasedCropComponents(section);

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
    cropOverlayElements.cropCrossHairs.map((cropCrossHair) => {
      setCropCrossHair(cropCrossHair, currentCropPoint.crop);
    });
    (cropOverlayElements.cropCrossHair as HTMLElement).style.stroke =
      currentCropChartMode === cropChartMode.Start ? 'lime' : END_CROP_SECTION_COLOR;
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

  [
    cropOverlayElements.cropRect,
    cropOverlayElements.cropRectBorderBlack,
    cropOverlayElements.cropRectBorderWhite,
  ].map((cropRect) => {
    assertDefined(cropRect);
    setCropOverlayDimensions(cropRect, curX, curY, curW, curH);
  });
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
// The crop the preview shows at a time in the section from cropMap[start] to cropMap[start + 1],
// with the marker pair's easing.
export function getInterpolatedCrop(
  markerPair: MarkerPair,
  cropMap: CropPoint[],
  start: number,
  time: number
) {
  const easing = getCropPointEasing(markerPair);
  const { cropResWidth, cropResHeight } = appState.settings;
  const fps = getFPS();
  const path = cinematicPaths.get(markerPair);
  const solved =
    easing === 'cinematic' &&
    path &&
    isCropPathFresh(
      path,
      getCinematicCropMap(markerPair),
      getCinematicMargins(markerPair),
      cropResWidth,
      cropResHeight,
      fps
    )
      ? evalCinematicCrop(markerPair, path, time)
      : null;
  const [x, y, w, h] =
    solved ??
    sectionCropAt(
      easing,
      cropSectionAt(cropMap, start),
      time,
      fps,
      { width: cropResWidth, height: cropResHeight },
      getCropComponents
    );
  // Whole pixels, as stored crops are: see autoKeyCurrentCropPoint.
  return getCropString(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
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
      loopPlaybackOver(sectStart, sectEnd);
    }
  }
}
export function showChart() {
  if (chartState.currentChartInput?.chartContainer) {
    resolveCropEditConflict('showChart');
    chartState.currentChartInput.chartContainer.style.display = 'block';
    appState.isCurrentChartVisible = true;
    syncCropChartVideoHeightLimit();
    const chartToUpdate = chartState.currentChartInput.chart;
    assertDefined(chartToUpdate);
    chartToUpdate.update();
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
// so tall sources don't push the chart out of the viewport. YouTube-only:
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
  if (isReframeEnabled()) {
    // Reframe locks the overlay to the transform, so re-render it synchronously once (the per-frame
    // sync no longer lays it out) instead of the debounced resizeCropOverlay, then resync the reframe
    // viewport/canvas against the now-current video box. Without this, hiding/showing the
    // masthead (this CSS's own effect) resized the video but left the canvas and its cached
    // crop rect (the hover hit-test reads it) at the old layout, most visibly at the top
    // where the masthead's height disappeared.
    forceRerenderCrop();
    syncReframe(getCurrentCropComponents());
  } else {
    resizeCropOverlay();
  }
}
export function toggleCurrentChartVisibility() {
  if (!appState.isCurrentChartVisible) {
    showChart();
  } else {
    hideChart();
  }
}
