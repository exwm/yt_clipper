import { createDraft } from 'immer';
import cloneDeep from 'lodash.clonedeep';
import { ChartLoop, MarkerConfig, MarkerPair, MarkerPairHistory } from './@types/yt_clipper';
import { appState } from './appState';
import { initAutoSave } from './auto-save';
import { chartState, cropChartSectionLoop, renderSpeedAndCropUI } from './charts';
import { isDrawingCrop, isMouseManipulatingCrop } from './crop-overlay';
import { getCropMultiples, getDefaultCropRes, multiplyMarkerPairCrops } from './crop-utils';
import { toggleOffGlobalSettingsEditor } from './features/settings/global-settings-editor';
import {
  markerPairNumberInput,
  toggleMarkerPairEditor,
  toggleMarkerPairEditorHandler,
  toggleOffMarkerPairEditor,
  toggleOnMarkerPairEditor,
} from './features/settings/marker-settings-editor';
import { VideoPlatforms } from './platforms/platforms';
import { addMarkerPairs, isVariableSpeed } from './save-load';
import { arrowKeyCropAdjustmentEnabled } from './features/settings/settings-editor';
import {
  getIsMarkerLoopPreviewOn,
  isMarkerSeekPending,
  markerSeekDebounceTimeout,
  setIsMarkerSeekPending,
  setMarkerSeekDebounceTimeout,
} from './speed';
import { shrinkPointMap, stretchPointMap } from './ui/chart/chartutil';
import {
  getMarkerPairHistory,
  peekLastState,
  redo,
  saveMarkerPairHistory,
  undo,
} from './util/undoredo';
import {
  assertDefined,
  blockEvent,
  clampNumber,
  deleteElement,
  flashMessage,
  getOutputDuration,
  getVideoDuration,
  seekToSafe,
  setAttributes,
  toHHMMSSTrimmed,
} from './util/util';
import { html, render, svg } from 'lit-html';
import { getFPS, refreshPlayerControlsAutoHideTimer } from './util/videoUtil';
import { platform } from './yt_clipper';
import { registerActiveDragCleanup } from './util/drag-recovery';

export function togglePrevSelectedMarkerPair() {
  if (enableMarkerHotkeysData.endMarker) {
    toggleMarkerPairEditor(enableMarkerHotkeysData.endMarker);
  } else if (appState.prevSelectedEndMarker) {
    toggleMarkerPairEditor(appState.prevSelectedEndMarker);
  } else {
    const firstEndMarker = appState.markersSvg.firstElementChild
      ? (appState.markersSvg.firstElementChild.nextElementSibling as SVGRectElement)
      : null;
    if (firstEndMarker) toggleMarkerPairEditor(firstEndMarker);
  }
}
// The one way to open a marker pair's settings editor by its position. Marker
// pair number == DOM position (renumberMarkerPairs derives numbers from order),
// so the pair at 0-based `index` has its end marker at children[index*2+1].
// Switches from whatever pair/editor is currently open, optionally seeking to
// the pair's start, and refreshes the player controls auto-hide. Returns false
// when the index is out of range (e.g. navigating past the first/last pair).
export function openMarkerPairEditorByIndex(index: number, { seek = false } = {}): boolean {
  if (index < 0 || index >= appState.markerPairs.length) return false;
  const endMarker = appState.markersSvg.children.item(index * 2 + 1) as SVGRectElement | null;
  if (!endMarker) return false;
  if (endMarker !== appState.prevSelectedEndMarker) {
    toggleMarkerPairEditor(endMarker);
  }
  if (seek) seekToSafe(appState.video, appState.markerPairs[index].start);
  refreshPlayerControlsAutoHideTimer();
  return true;
}
// Select the marker pair adjacent to the currently selected one (direction -1
// = previous, +1 = next), opening its editor and seeking to its start. Used by
// the Prev/Next buttons in the settings editor.
export function selectAdjacentMarkerPair(direction: -1 | 1) {
  const currentIndex = appState.prevSelectedMarkerPairIndex;
  if (currentIndex == null) return;
  openMarkerPairEditorByIndex(currentIndex + direction, { seek: true });
}
// Move the marker pair at `fromIdx` to `toIdx`, keeping the markerPairs array,
// the marker rects, and both numbering collections in lockstep, then renumber.
// Removing the pair's nodes before reinserting at the destination makes a
// single "insert before children[toIdx]" correct for moves in either direction;
// when toIdx is the last slot the reference is null and insertBefore appends.
export function moveMarkerPairToIndex(fromIdx: number, toIdx: number) {
  if (fromIdx === toIdx) return;
  const markerPair = appState.markerPairs[fromIdx];
  const startMarker = appState.markersSvg.children.item(fromIdx * 2);
  const endMarker = appState.markersSvg.children.item(fromIdx * 2 + 1);
  assertDefined(startMarker, 'Expected start marker rect at fromIdx');
  assertDefined(endMarker, 'Expected end marker rect at fromIdx');

  const [movedPair] = appState.markerPairs.splice(fromIdx, 1);
  appState.markerPairs.splice(toIdx, 0, movedPair);

  startMarker.remove();
  endMarker.remove();
  const refMarker = appState.markersSvg.children.item(toIdx * 2);
  appState.markersSvg.insertBefore(startMarker, refMarker);
  appState.markersSvg.insertBefore(endMarker, refMarker);

  const { startNumbering, endNumbering } = markerPair;
  startNumbering.remove();
  appState.startMarkerNumberings.insertBefore(
    startNumbering,
    appState.startMarkerNumberings.children.item(toIdx)
  );
  endNumbering.remove();
  appState.endMarkerNumberings.insertBefore(
    endNumbering,
    appState.endMarkerNumberings.children.item(toIdx)
  );

  renumberMarkerPairs();
}
export function moveMarkerByFrameHandler(event: WheelEvent) {
  if (
    appState.isHotkeysEnabled &&
    !event.ctrlKey &&
    event.altKey &&
    event.shiftKey &&
    Math.abs(event.deltaY) > 0 &&
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedEndMarker &&
    !appState.video.seeking
  ) {
    if (!appState.video.paused) {
      appState.video.pause();
    }
    setIsMarkerSeekPending(true);
    if (markerSeekDebounceTimeout !== null) {
      clearTimeout(markerSeekDebounceTimeout);
    }
    setMarkerSeekDebounceTimeout(
      setTimeout(() => {
        setMarkerSeekDebounceTimeout(null);
        setIsMarkerSeekPending(false);
      }, 500)
    );

    const fps = getFPS();
    let targetMarker = appState.prevSelectedEndMarker;
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    let targetMarkerTime = markerPair.end;
    if (event.pageX < window.innerWidth / 2) {
      targetMarker = appState.prevSelectedEndMarker.previousElementSibling as SVGRectElement;
      targetMarkerTime = markerPair.start;
    }

    let newMarkerTime: number;
    if (event.deltaY > 0) {
      newMarkerTime = targetMarkerTime - 1 / fps;
      moveMarker(targetMarker, Math.max(0, newMarkerTime));
    } else {
      newMarkerTime = targetMarkerTime + 1 / fps;
      moveMarker(targetMarker, Math.min(getVideoDuration(platform, appState.video), newMarkerTime));
    }

    seekToSafe(appState.video, newMarkerTime);
  }
}

const markersSvgTemplate = html`
  <svg id="markers-svg"></svg>
  <svg id="selected-marker-pair-overlay" style="display:none">
    <rect
      id="selected-start-marker-overlay"
      class="selected-marker-overlay"
      width="1px"
      height="8px"
      y="3.5px"
      shape-rendering="crispEdges"
    ></rect>
    <rect
      id="selected-end-marker-overlay"
      class="selected-marker-overlay"
      width="1px"
      height="8px"
      y="3.5px"
      shape-rendering="crispEdges"
    ></rect>
  </svg>
`;

const markerNumberingsTemplate = html`
  <svg id="start-marker-numberings"></svg>
  <svg id="end-marker-numberings"></svg>
`;

export function initMarkersContainer() {
  appState.settings = {
    platform: platform,
    videoID: appState.videoInfo.id,
    videoTitle: appState.videoInfo.title,
    videoUrl: appState.videoInfo.videoUrl,
    newMarkerSpeed: 1.0,
    newMarkerCrop: '0:0:iw:ih',
    videoTag: `[${platform}@${appState.videoInfo.id}]`,
    titleSuffix: `[${platform}@${appState.videoInfo.id}]`,
    isVerticalVideo: appState.videoInfo.isVerticalVideo,
    markerPairMergeList: '',
    ...getDefaultCropRes(),
  };
  appState.markersDiv = document.createElement('div');
  appState.markersDiv.setAttribute('id', 'markers-div');
  render(markersSvgTemplate, appState.markersDiv);

  appState.markersSvg = appState.markersDiv.children[0] as SVGSVGElement;
  appState.selectedMarkerPairOverlay = appState.markersDiv.children[1] as SVGSVGElement;

  appState.markerNumberingsDiv = document.createElement('div');
  appState.markerNumberingsDiv.setAttribute('id', 'marker-numberings-div');
  render(markerNumberingsTemplate, appState.markerNumberingsDiv);
  appState.startMarkerNumberings = appState.markerNumberingsDiv.children[0] as SVGSVGElement;
  appState.endMarkerNumberings = appState.markerNumberingsDiv.children[1] as SVGSVGElement;

  if (
    [VideoPlatforms.weverse, VideoPlatforms.naver_tv, VideoPlatforms.yt_clipper].includes(platform)
  ) {
    appState.hooks.markerNumberingsDiv.prepend(appState.markerNumberingsDiv);
    appState.hooks.markersDiv.prepend(appState.markersDiv);
  } else {
    appState.hooks.markersDiv.appendChild(appState.markersDiv);
    appState.hooks.markerNumberingsDiv.appendChild(appState.markerNumberingsDiv);
  }

  appState.videoInfo.fps = getFPS();
}
export function loopMarkerPair() {
  requestAnimationFrame(loopMarkerPair);

  if (!getIsMarkerLoopPreviewOn() && !appState.isCropChartLoopingOn) {
    return;
  }

  if (!appState.isSettingsEditorOpen || appState.wasGlobalSettingsEditorOpen) {
    return;
  }
  if (appState.prevSelectedMarkerPairIndex == null) {
    return;
  }
  if (appState.video.seeking) {
    return;
  }

  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  const chartLoop: ChartLoop | null = chartState.currentChartInput
    ? markerPair[chartState.currentChartInput.chartLoopKey]
    : null;

  if (
    chartLoop &&
    chartLoop.enabled &&
    chartLoop.start &&
    chartLoop.end &&
    chartLoop.start > markerPair.start &&
    chartLoop.end < markerPair.end &&
    chartLoop.start < chartLoop.end
  ) {
    const isTimeBetweenChartLoop =
      chartLoop.start <= appState.video.getCurrentTime() &&
      appState.video.getCurrentTime() <= chartLoop.end;
    if (!isTimeBetweenChartLoop) {
      seekToSafe(appState.video, chartLoop.start);
    }
  } else if (
    (appState.isCropChartLoopingOn &&
      appState.isCurrentChartVisible &&
      chartState.currentChartInput?.type === 'crop') ||
    (chartState.cropChartInput.chart && (isMouseManipulatingCrop || isDrawingCrop))
  ) {
    chartState.shouldTriggerCropChartUpdates = false;
    cropChartSectionLoop();
  } else if (getIsMarkerLoopPreviewOn() && !isMarkerSeekPending) {
    const isTimeBetweenMarkerPair =
      markerPair.start <= appState.video.getCurrentTime() &&
      appState.video.getCurrentTime() <= markerPair.end;
    if (!isTimeBetweenMarkerPair) {
      seekToSafe(appState.video, markerPair.start);
    }
  }
}
export function jumpToNearestMarkerOrPair(e: KeyboardEvent, keyCode: string) {
  refreshPlayerControlsAutoHideTimer();
  if (!arrowKeyCropAdjustmentEnabled) {
    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      jumpToNearestMarker(e, appState.video.getCurrentTime(), keyCode);
    } else if (e.altKey && !e.shiftKey) {
      if (!e.ctrlKey && !(appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen)) {
        blockEvent(e);
        togglePrevSelectedMarkerPair();
      }
      if (enableMarkerHotkeysData.endMarker) {
        jumpToNearestMarkerPair(e, enableMarkerHotkeysData.endMarker, keyCode);
      }
    }
  }
}
export function jumpToNearestMarkerPair(
  e: KeyboardEvent,
  targetEndMarker: SVGRectElement,
  keyCode: string
) {
  blockEvent(e);
  const idx = targetEndMarker.getAttribute('data-idx');
  assertDefined(idx, 'Expected data-idx attribute on end marker');
  const currentIndex = parseInt(idx) - 1;
  const direction = keyCode === 'ArrowLeft' ? -1 : keyCode === 'ArrowRight' ? 1 : 0;
  if (direction === 0) return;
  // Without ctrl the alt+arrow hotkey only switches the open editor; ctrl also
  // seeks to the pair. Out-of-range moves (past first/last) are a no-op.
  openMarkerPairEditorByIndex(currentIndex + direction, { seek: e.ctrlKey });
}
export let dblJump = 0;
export let prevJumpKeyCode: 'ArrowLeft' | 'ArrowRight';
export let prevTime: number | null;
export function jumpToNearestMarker(e: KeyboardEvent, currentTime: number, keyCode: string) {
  blockEvent(e);
  let minTime: number = currentTime;
  currentTime = prevTime ?? currentTime;
  let markerTimes: number[] = [];
  appState.markerPairs.forEach((markerPair) => {
    markerTimes.push(markerPair.start);
    markerTimes.push(markerPair.end);
  });

  if (!appState.isNextMarkerStart) {
    markerTimes.push(appState.startTime);
  }
  markerTimes = markerTimes.map((markerTime) => parseFloat(markerTime.toFixed(6)));
  if (keyCode === 'ArrowLeft') {
    markerTimes = markerTimes.filter((markerTime) => markerTime < currentTime);
    minTime = Math.max(...markerTimes);
    if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowLeft') {
      markerTimes = markerTimes.filter((markerTime) => markerTime < minTime);
      minTime = Math.max(...markerTimes);
    }
    prevJumpKeyCode = 'ArrowLeft';
  } else if (keyCode === 'ArrowRight') {
    markerTimes = markerTimes.filter((markerTime) => markerTime > currentTime);
    minTime = Math.min(...markerTimes);
    if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowRight') {
      markerTimes = markerTimes.filter((markerTime) => markerTime > minTime);
      minTime = Math.min(...markerTimes);
    }
    prevJumpKeyCode = 'ArrowRight';
  }

  if (dblJump !== 0) {
    clearTimeout(dblJump);
    dblJump = 0;
    prevTime = null;
    if (minTime !== currentTime && minTime != Infinity && minTime != -Infinity)
      seekToSafe(appState.video, minTime);
  } else {
    prevTime = currentTime;
    if (minTime !== currentTime && minTime != Infinity && minTime != -Infinity)
      seekToSafe(appState.video, minTime);
    dblJump = setTimeout(() => {
      dblJump = 0;
      prevTime = null;
    }, 150) as unknown as number;
  }
}
// set width and height attributes for browsers not supporting svg 2
export const marker_attrs = {
  class: 'marker',
  width: '1px',
  height: '14px',
  'shape-rendering': 'crispEdges',
};
export function addMarker(markerConfig: MarkerConfig = {}) {
  const preciseCurrentTime = markerConfig.time ?? appState.video.getCurrentTime();
  // TODO: Calculate appState.video fps precisely so current frame time
  // is accurately determined.
  // const currentFrameTime = getCurrentFrameTime(roughCurrentTime);
  const currentFrameTime = preciseCurrentTime;
  const progressPos = (currentFrameTime / getVideoDuration(platform, appState.video)) * 100;

  if (!appState.isNextMarkerStart && currentFrameTime <= appState.startTime) {
    flashMessage('End marker must be after start marker.', 'red');
    return;
  }

  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  appState.markersSvg.appendChild(marker);

  setAttributes(marker, marker_attrs);
  marker.setAttribute('x', `${progressPos}%`);
  const rectIdx = appState.markerPairs.length + 1;
  marker.setAttribute('data-idx', rectIdx.toString());

  if (appState.isNextMarkerStart) {
    marker.classList.add('start-marker');
    marker.setAttribute('type', 'start');
    marker.setAttribute('z-index', '1');
    appState.startTime = currentFrameTime;
  } else {
    marker.addEventListener('pointerover', toggleMarkerPairEditorHandler, false);
    marker.classList.add('end-marker');
    marker.setAttribute('type', 'end');
    marker.setAttribute('z-index', '2');
    const startProgressPos =
      (appState.startTime / getVideoDuration(platform, appState.video)) * 100;
    const [startNumbering, endNumbering] = addMarkerPairNumberings(
      rectIdx,
      startProgressPos,
      progressPos,
      marker
    );
    pushMarkerPairsArray(currentFrameTime, {
      ...markerConfig,
      ...{ startNumbering, endNumbering },
    });
    updateMarkerPairEditor();
  }

  appState.isNextMarkerStart = !appState.isNextMarkerStart;
  console.log(appState.markerPairs);
}
export function pushMarkerPairsArray(currentTime: number, markerPairConfig: MarkerConfig) {
  const speed = markerPairConfig.speed ?? appState.settings.newMarkerSpeed;
  const crop = markerPairConfig.crop ?? appState.settings.newMarkerCrop;
  assertDefined(markerPairConfig.startNumbering, 'Expected startNumbering in markerPairConfig');
  assertDefined(markerPairConfig.endNumbering, 'Expected endNumbering in markerPairConfig');
  const newMarkerPair: MarkerPair = {
    start: appState.startTime,
    end: currentTime,
    speed,
    speedMap: markerPairConfig.speedMap ?? [
      { x: appState.startTime, y: speed },
      { x: currentTime, y: speed },
    ],
    speedChartLoop: markerPairConfig.speedChartLoop ?? { enabled: true },
    crop,
    cropMap: markerPairConfig.cropMap ?? [
      { x: appState.startTime, y: 0, crop: crop },
      { x: currentTime, y: 0, crop: crop },
    ],
    cropChartLoop: markerPairConfig.cropChartLoop ?? { enabled: true },
    enableZoomPan: markerPairConfig.enableZoomPan ?? false,
    cropRes: appState.settings.cropRes,
    outputDuration: markerPairConfig.outputDuration ?? currentTime - appState.startTime,
    startNumbering: markerPairConfig.startNumbering,
    endNumbering: markerPairConfig.endNumbering,
    overrides: markerPairConfig.overrides ?? {},
    undoredo: markerPairConfig.undoredo ?? { history: [], index: -1 },
  };
  if (newMarkerPair.undoredo.history.length === 0) {
    const draft = createDraft(getMarkerPairHistory(newMarkerPair));
    saveMarkerPairHistory(draft, newMarkerPair);
  }
  appState.markerPairs.push(newMarkerPair);
  initAutoSave();
}
export function updateMarkerPairEditor() {
  if (appState.isSettingsEditorOpen) {
    const markerPairCountLabel = document.getElementById('marker-pair-count-label');
    if (markerPairCountLabel) {
      markerPairCountLabel.textContent = appState.markerPairs.length.toString();
      markerPairNumberInput.setAttribute('max', appState.markerPairs.length.toString());
    }
    refreshMarkerPairNavButtonsDisabledState();
  }
}
// Adding/removing pairs changes which pair is first/last, so the Prev/Next
// buttons' disabled state must be recomputed without re-rendering the editor.
export function refreshMarkerPairNavButtonsDisabledState() {
  const selectedIndex = appState.prevSelectedMarkerPairIndex;
  const prevButton = document.getElementById('select-prev-marker-pair') as HTMLButtonElement | null;
  const nextButton = document.getElementById('select-next-marker-pair') as HTMLButtonElement | null;
  if (selectedIndex == null || !prevButton || !nextButton) return;
  prevButton.disabled = selectedIndex <= 0;
  nextButton.disabled = selectedIndex >= appState.markerPairs.length - 1;
}
function renderNumberingText(
  parent: SVGSVGElement,
  cls: 'startMarkerNumbering' | 'endMarkerNumbering',
  idx: number,
  progressPos: number
): SVGTextElement {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(
    svg`<text class="markerNumbering ${cls}" data-idx=${idx} x="${progressPos}%" y="11.5px" text-anchor="middle">${idx}</text>`,
    container
  );
  const numbering = container.children[0] as SVGTextElement;
  parent.appendChild(numbering);
  return numbering;
}

export function addMarkerPairNumberings(
  idx: number,
  startProgressPos: number,
  endProgressPos: number,
  endMarker: SVGRectElement
) {
  const startNumberingText = renderNumberingText(
    appState.startMarkerNumberings,
    'startMarkerNumbering',
    idx,
    startProgressPos
  );
  const endNumberingText = renderNumberingText(
    appState.endMarkerNumberings,
    'endMarkerNumbering',
    idx,
    endProgressPos
  );

  (endNumberingText as any).marker = endMarker;
  (startNumberingText as any).marker = endMarker;
  endNumberingText.addEventListener('pointerover', markerNumberingMouseOverHandler, false);
  startNumberingText.addEventListener('pointerdown', markerNumberingMouseDownHandler, true);
  endNumberingText.addEventListener('pointerdown', markerNumberingMouseDownHandler, true);

  return [startNumberingText, endNumberingText];
}
export function undoMarker() {
  const targetMarker = appState.markersSvg.lastElementChild;
  if (!targetMarker) return;

  const targetMarkerType = targetMarker.getAttribute('type');
  // toggle off marker pair editor before undoing a selected marker pair
  if (
    targetMarkerType === 'end' &&
    appState.prevSelectedMarkerPairIndex >= appState.markerPairs.length - 1
  ) {
    if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen) {
      toggleOffMarkerPairEditor(true);
    } else {
      hideSelectedMarkerPairOverlay(true);
    }
    clearPrevSelectedMarkerPairReferences();
  }

  deleteElement(targetMarker);
  if (targetMarkerType === 'end') {
    const markerPair = appState.markerPairs[appState.markerPairs.length - 1];
    deleteElement(markerPair.startNumbering);
    deleteElement(markerPair.endNumbering);
    appState.startTime = markerPair.start;
    const removedPair = appState.markerPairs.pop();
    assertDefined(removedPair, 'Expected marker pair to exist when undoing');
    appState.markerPairsHistory.push(removedPair);
    console.log(appState.markerPairs);
    updateMarkerPairEditor();
  }
  appState.isNextMarkerStart = !appState.isNextMarkerStart;
}
export function redoMarker() {
  if (appState.markerPairsHistory.length > 0) {
    const markerPairToRestore = appState.markerPairsHistory[appState.markerPairsHistory.length - 1];
    if (appState.isNextMarkerStart) {
      addMarker({ time: markerPairToRestore.start });
    } else {
      appState.markerPairsHistory.pop();
      addMarker({ ...markerPairToRestore, time: markerPairToRestore.end });
    }
  }
}
export function duplicateSelectedMarkerPair() {
  const markerPairIndex = appState.prevSelectedMarkerPairIndex;
  if (markerPairIndex != null) {
    const markerPair = cloneDeep(appState.markerPairs[markerPairIndex]);
    addMarkerPairs([markerPair]);
    flashMessage(`Duplicated marker pair ${markerPairIndex + 1}.`, 'green');
  } else {
    flashMessage(`No selected or previously selected marker pair to duplicate.`, 'red');
  }
}
export function markerNumberingMouseOverHandler(e: PointerEvent) {
  const targetMarker = (e.target as any).marker as SVGRectElement;
  toggleMarkerPairEditorHandler(e, targetMarker);
}
export function markerNumberingMouseDownHandler(e: PointerEvent) {
  if (!(e.button === 0)) return;
  blockEvent(e);
  const numbering = e.target as SVGTextElement;
  const numberingType = numbering.classList.contains('startMarkerNumbering') ? 'start' : 'end';
  const targetEndMarker = (numbering as any).marker as SVGRectElement;
  const targetStartMarker = targetEndMarker.previousSibling as SVGRectElement;
  const targetMarker = numberingType === 'start' ? targetStartMarker : targetEndMarker;

  const dataIdx = numbering.getAttribute('data-idx');
  assertDefined(dataIdx, 'Expected data-idx attribute on numbering');
  const markerPairIndex = parseInt(dataIdx) - 1;
  const markerPair = appState.markerPairs[markerPairIndex];
  const markerTime = numberingType === 'start' ? markerPair.start : markerPair.end;

  // open editor of target marker corresponding to clicked numbering
  if (!appState.isSettingsEditorOpen) {
    toggleOnMarkerPairEditor(targetEndMarker);
  } else {
    if (appState.wasGlobalSettingsEditorOpen) {
      toggleOffGlobalSettingsEditor();
      toggleOnMarkerPairEditor(targetEndMarker);
    } else if (appState.prevSelectedEndMarker != targetEndMarker) {
      toggleOffMarkerPairEditor();
      toggleOnMarkerPairEditor(targetEndMarker);
    }
  }

  seekToSafe(appState.video, markerTime);

  if (!e.altKey) return;

  const pointerId = e.pointerId;
  numbering.setPointerCapture(pointerId);
  // The element that owns pointer capture is the same element that will
  // receive the implicit `pointercancel` if the browser releases capture
  // out from under us (devtools focus, alt-tab, OS pointer reassignment).
  // Attaching all subsequent listeners here — rather than to `document` —
  // is the spec-correct way to be sure the cleanup path runs.
  const captureTarget = numbering;

  const numberingRect = numbering.getBoundingClientRect();
  const progressBarRect = appState.hooks.progressBar.getBoundingClientRect();
  // `offsetX` preserves the grip point: wherever on the numbering label
  // the user clicked, that point stays under the cursor for the duration
  // of the drag. Subtracting it from `e.pageX` recovers the time-equivalent
  // of the numbering's centre.
  const offsetX = e.pageX - numberingRect.left - numberingRect.width / 2;
  /** Absolute positioning — the marker's time tracks the cursor's
   *  horizontal position on the progress bar 1:1, mirroring how
   *  `scrubVideoHandler` handles Alt+Drag on the video itself. The
   *  previous implementation modulated motion by vertical cursor
   *  position (precision-scaling) and short-circuited on any vertical
   *  movement, which together produced visible jitter and rubber-band
   *  during normal horizontal drags. */
  function getDragTime(e: PointerEvent): number {
    const duration = getVideoDuration(platform, appState.video);
    const x = e.pageX - offsetX - progressBarRect.left;
    const time = (duration * x) / progressBarRect.width;
    return numberingType === 'start'
      ? clampNumber(time, 0, markerPair.end - 1e-3)
      : clampNumber(time, markerPair.start + 1e-3, duration);
  }

  // Coalesce pointermove events with requestAnimationFrame so the marker
  // visual updates at the screen refresh rate (~60 Hz) instead of the
  // raw pointer event rate (often 100–250 Hz). Same pattern as the crop
  // drag/hover handlers in crop-overlay.ts — without it `moveMarker`
  // (which re-renders markers + crops) and `seekToSafe` get called 2-4×
  // per frame and the marker visibly lags the cursor.
  let dragRafId = 0;
  let pendingDragEvent: PointerEvent | null = null;

  function processDragNumbering(): void {
    dragRafId = 0;
    const e = pendingDragEvent;
    pendingDragEvent = null;
    if (!e) return;
    const time = getDragTime(e);
    if (Math.abs(time - appState.video.getCurrentTime()) < 0.01) return;
    moveMarker(targetMarker, time, false, false);
    seekToSafe(appState.video, time);
  }

  function dragNumbering(e: PointerEvent): void {
    pendingDragEvent = e;
    if (!dragRafId) {
      dragRafId = requestAnimationFrame(processDragNumbering);
    }
  }

  captureTarget.addEventListener('pointermove', dragNumbering);

  let unregisterDragRecovery: () => void = () => {};

  /** Idempotent cleanup — detaches every listener this handler attached,
   *  releases the captured pointer, cancels any pending RAF. Safe to call
   *  multiple times because each step checks first. */
  function cleanup(): void {
    if (dragRafId) {
      cancelAnimationFrame(dragRafId);
      dragRafId = 0;
      pendingDragEvent = null;
    }
    captureTarget.removeEventListener('pointermove', dragNumbering);
    captureTarget.removeEventListener('pointerup', onPointerUp, { capture: true });
    captureTarget.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    if (captureTarget.hasPointerCapture(pointerId)) {
      captureTarget.releasePointerCapture(pointerId);
    }
    unregisterDragRecovery();
  }

  function onPointerUp(e: PointerEvent): void {
    cleanup();
    const time = getDragTime(e);
    if (Math.abs(time - markerTime) < 0.001) return;
    moveMarker(targetMarker, time, true, true);
  }

  function onPointerCancel(): void {
    // Browser-initiated release (devtools, alt-tab, OS pointer
    // reassignment). Revert to the marker's original time rather than
    // committing the in-progress drag — the user didn't choose to land.
    cleanup();
  }

  captureTarget.addEventListener('pointerup', onPointerUp, { once: true, capture: true });
  captureTarget.addEventListener('pointercancel', onPointerCancel, { once: true, capture: true });
  // Belt-and-suspenders: window.blur / tab-hidden recovery covers cases
  // where neither pointerup nor pointercancel fires for the captured
  // target (rapid alt-tab on Windows, certain devtools docking moves).
  unregisterDragRecovery = registerActiveDragCleanup(cleanup);
}

const enableMarkerHotkeysData: {
  startMarker: SVGRectElement | null;
  endMarker: SVGRectElement | null;
} = {
  startMarker: null,
  endMarker: null,
};

export function enableMarkerHotkeys(endMarker: SVGRectElement) {
  appState.markerHotkeysEnabled = true;
  enableMarkerHotkeysData.endMarker = endMarker;
  enableMarkerHotkeysData.startMarker = endMarker.previousSibling as SVGRectElement;
}

export function getActiveStartMarker() {
  return enableMarkerHotkeysData.startMarker;
}
export function getActiveEndMarker() {
  return enableMarkerHotkeysData.endMarker;
}

export function moveMarker(
  marker: SVGRectElement,
  newTime?: number,
  storeHistory = true,
  adjustCharts = true
) {
  const type = marker.getAttribute('type') as 'start' | 'end';
  const dataIdx = marker.getAttribute('data-idx');
  assertDefined(dataIdx, 'Expected data-idx attribute on marker');
  const idx = parseInt(dataIdx) - 1;
  const markerPair = appState.markerPairs[idx];

  const toTime = newTime ?? appState.video.getCurrentTime();

  if (type === 'start' && toTime >= markerPair.end) {
    flashMessage('Start marker cannot be placed after or at end marker', 'red');
    return;
  }
  if (type === 'end' && toTime <= markerPair.start) {
    flashMessage('End marker cannot be placed before or at start marker', 'red');
    return;
  }

  const initialState: MarkerPairHistory = getMarkerPairHistory(markerPair);
  const draft = createDraft(initialState);
  const lastState = peekLastState(markerPair.undoredo);
  const isStretch = type === 'start' ? toTime <= lastState.start : toTime >= lastState.end;

  draft[type] = toTime;
  if (adjustCharts) {
    if (isStretch) {
      draft.speedMap = stretchPointMap(draft, draft.speedMap, 'speed', toTime, type);
      draft.cropMap = stretchPointMap(draft, draft.cropMap, 'crop', toTime, type);
    } else {
      draft.speedMap = shrinkPointMap(draft, draft.speedMap, 'speed', toTime, type);
      draft.cropMap = shrinkPointMap(draft, draft.cropMap, 'crop', toTime, type);
    }
  }
  saveMarkerPairHistory(draft, markerPair, storeHistory);

  renderSpeedAndCropUI(adjustCharts, adjustCharts);
}
export function renderMarkerPair(markerPair, markerPairIndex) {
  const startMarker = appState.markersSvg.querySelector(
    `.start-marker[data-idx="${markerPairIndex + 1}"]`
  );
  const endMarker = appState.markersSvg.querySelector(
    `.end-marker[data-idx="${markerPairIndex + 1}"]`
  );
  const startMarkerNumbering = appState.startMarkerNumberings.children[markerPairIndex];
  const endMarkerNumbering = appState.endMarkerNumberings.children[markerPairIndex];
  const startProgressPos = (markerPair.start / getVideoDuration(platform, appState.video)) * 100;
  const endProgressPos = (markerPair.end / getVideoDuration(platform, appState.video)) * 100;

  assertDefined(startMarker, 'Expected start marker element');
  assertDefined(endMarker, 'Expected end marker element');
  startMarker.setAttribute('x', `${startProgressPos}%`);
  startMarkerNumbering.setAttribute('x', `${startProgressPos}%`);
  selectedStartMarkerOverlay.setAttribute('x', `${startProgressPos}%`);
  endMarker.setAttribute('x', `${endProgressPos}%`);
  endMarkerNumbering.setAttribute('x', `${endProgressPos}%`);
  selectedEndMarkerOverlay.setAttribute('x', `${endProgressPos}%`);

  const startMarkerTimeSpan = document.getElementById(`start-time`);
  const endMarkerTimeSpan = document.getElementById(`end-time`);
  assertDefined(startMarkerTimeSpan, 'Expected start-time element');
  assertDefined(endMarkerTimeSpan, 'Expected end-time element');
  startMarkerTimeSpan.textContent = toHHMMSSTrimmed(markerPair.start);
  endMarkerTimeSpan.textContent = toHHMMSSTrimmed(markerPair.end);
  updateMarkerPairDuration(markerPair);
}
export function undoRedoMarkerPairChange(dir: 'undo' | 'redo') {
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const newState =
      dir === 'undo'
        ? undo(markerPair.undoredo, () => null)
        : redo(markerPair.undoredo, () => null);
    if (newState == null) {
      flashMessage(`Nothing left to ${dir}.`, 'red');
    } else {
      Object.assign(markerPair, newState);

      if (markerPair.cropRes !== appState.settings.cropRes) {
        const { cropMultipleX, cropMultipleY } = getCropMultiples(
          markerPair.cropRes,
          appState.settings.cropRes
        );
        multiplyMarkerPairCrops(markerPair, cropMultipleX, cropMultipleY);
      }

      renderSpeedAndCropUI(true, true);

      flashMessage(`Applied ${dir}.`, 'green');
    }
  } else {
    flashMessage('Please select a marker pair editor for undo/redo.', 'olive');
  }
}
export function deleteMarkerPair(idx?: number) {
  idx ??= appState.prevSelectedMarkerPairIndex;
  const markerPair = appState.markerPairs[idx];

  const me = new PointerEvent('pointerover', { shiftKey: true });
  if (enableMarkerHotkeysData.endMarker) {
    enableMarkerHotkeysData.endMarker.dispatchEvent(me);
    deleteElement(enableMarkerHotkeysData.endMarker);
  }
  if (enableMarkerHotkeysData.startMarker) {
    deleteElement(enableMarkerHotkeysData.startMarker);
  }
  deleteElement(markerPair.startNumbering);
  deleteElement(markerPair.endNumbering);
  hideSelectedMarkerPairOverlay(true);
  renumberMarkerPairs();

  appState.markerPairs.splice(idx, 1);
  clearPrevSelectedMarkerPairReferences();
}
export function clearPrevSelectedMarkerPairReferences() {
  appState.prevSelectedMarkerPairIndex = null as any;
  appState.prevSelectedEndMarker = null as any;
  enableMarkerHotkeysData.startMarker = null;
  enableMarkerHotkeysData.endMarker = null;
  appState.markerHotkeysEnabled = false;
}
export let selectedStartMarkerOverlay: HTMLElement;
export let selectedEndMarkerOverlay: HTMLElement;
export function highlightSelectedMarkerPair(currentMarker: SVGRectElement) {
  if (!selectedStartMarkerOverlay) {
    const el = document.getElementById('selected-start-marker-overlay');
    assertDefined(el, 'Expected selected-start-marker-overlay element');
    selectedStartMarkerOverlay = el;
  }
  if (!selectedEndMarkerOverlay) {
    const el = document.getElementById('selected-end-marker-overlay');
    assertDefined(el, 'Expected selected-end-marker-overlay element');
    selectedEndMarkerOverlay = el;
  }
  const startMarker = currentMarker.previousSibling as SVGRectElement;
  const startX = startMarker.getAttribute('x');
  assertDefined(startX, 'Expected x attribute on start marker');
  const endX = currentMarker.getAttribute('x');
  assertDefined(endX, 'Expected x attribute on current marker');
  selectedStartMarkerOverlay.setAttribute('x', startX);
  selectedEndMarkerOverlay.setAttribute('x', endX);
  selectedStartMarkerOverlay.classList.remove('selected-marker-overlay-hidden');
  selectedEndMarkerOverlay.classList.remove('selected-marker-overlay-hidden');
  appState.selectedMarkerPairOverlay.style.display = 'block';
}
export function updateMarkerPairDuration(markerPair: MarkerPair) {
  const speedAdjustedDurationSpan = document.getElementById('duration');
  const duration = markerPair.end - markerPair.start;
  const durationHHMMSS = toHHMMSSTrimmed(duration);
  const speed = markerPair.speed;
  const speedMap = markerPair.speedMap;
  if (isVariableSpeed(speedMap)) {
    const outputDuration = getOutputDuration(markerPair.speedMap, getFPS());
    const outputDurationHHMMSS = toHHMMSSTrimmed(outputDuration);
    if (speedAdjustedDurationSpan)
      speedAdjustedDurationSpan.textContent = `${durationHHMMSS} (${outputDurationHHMMSS})`;
    markerPair.outputDuration = outputDuration;
  } else {
    const outputDuration = duration / speed;
    const outputDurationHHMMSS = toHHMMSSTrimmed(outputDuration);
    if (speedAdjustedDurationSpan)
      speedAdjustedDurationSpan.textContent = `${durationHHMMSS}/${speed} = ${outputDurationHHMMSS}`;
    markerPair.outputDuration = outputDuration;
  }
}
export function renumberMarkerPairs() {
  const markersSvg = document.getElementById('markers-svg');
  assertDefined(markersSvg, 'Expected markers-svg element');
  Array.from(markersSvg.children).forEach((markerRect, idx) => {
    // renumber markers by pair starting with index 1
    const newIdx = Math.floor((idx + 2) / 2);
    markerRect.setAttribute('data-idx', newIdx.toString());
  });

  Array.from(appState.startMarkerNumberings.children).forEach((startNumbering, idx) => {
    const newIdx = idx + 1;
    startNumbering.setAttribute('data-idx', newIdx.toString());
    startNumbering.textContent = newIdx.toString();
  });

  Array.from(appState.endMarkerNumberings.children).forEach((endNumbering, idx) => {
    const newIdx = idx + 1;
    endNumbering.setAttribute('data-idx', newIdx.toString());
    endNumbering.textContent = newIdx.toString();
  });
}
export function hideSelectedMarkerPairOverlay(hardHide = false) {
  if (hardHide) {
    appState.selectedMarkerPairOverlay.style.display = 'none';
  } else {
    selectedStartMarkerOverlay.classList.add('selected-marker-overlay-hidden');
    selectedEndMarkerOverlay.classList.add('selected-marker-overlay-hidden');
  }
}
