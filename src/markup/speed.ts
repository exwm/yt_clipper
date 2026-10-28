import { easeCubicInOut } from 'd3-ease';
import { createDraft } from 'immer';
import { MarkerPair, SpeedPoint } from './@types/yt_clipper';
import { appState } from './appState';
import { pairSettings } from './features/settings/pair-settings';
import { isVariableSpeed } from './save-load';
import { flashMessage, roundValue } from './util/util';
import { isInFrameSpan } from './util/frame-grid';
import { getFrameGrid, getFrameTime } from './util/videoUtil';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';

let isSpeedPreviewOn = false;
let prevSpeed = 1;
const defaultRoundSpeedMapEasing = 0.05;
const defaultSpeedRoundPrecision = 2;

export function getShortestActiveMarkerPair(currentTime?: number): MarkerPair {
  // The frame on screen: on the end marker's frame it is the marker's own time, on any grid, where
  // the playhead mid-frame can fall in the next grid frame before the rate is measured.
  currentTime ??= getFrameTime();

  // A pair is active on its frames, its end marker's frame included, as the clipper clips them: a
  // time test against the end marker's time (the start of its frame) leaves out the rest of that frame.
  const grid = getFrameGrid();
  const isActive = (markerPair: MarkerPair) =>
    isInFrameSpan(grid, markerPair.start, markerPair.end, currentTime);
  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    const selectedMarkerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    if (isActive(selectedMarkerPair)) return selectedMarkerPair;
  }
  const activeMarkerPairs = appState.markerPairs.filter(isActive);
  if (activeMarkerPairs.length === 0) {
    return null as unknown as MarkerPair;
  }

  const shortestActiveMarkerPair = activeMarkerPairs.reduce((prev, cur) => {
    if (cur.end - cur.start < prev.end - prev.start) {
      return cur;
    }
    return prev;
  });

  return shortestActiveMarkerPair;
}

export const toggleMarkerPairSpeedPreview = () => {
  if (isSpeedPreviewOn) {
    isSpeedPreviewOn = false;
    flashMessage('Marker pair speed preview disabled', 'red');
  } else {
    isSpeedPreviewOn = true;
    if (!appState.isForceSetSpeedOn) requestAnimationFrame(updateSpeed);
    flashMessage('Marker pair speed preview enabled', 'green');
  }
};

export function getIsSpeedPreviewOn() {
  return isSpeedPreviewOn;
}

export function updateSpeed() {
  if (!isSpeedPreviewOn && !appState.isForceSetSpeedOn) {
    appState.video.playbackRate = 1;
    prevSpeed = 1;
    updateSpeedInputLabel('Speed');

    return;
  }

  if (appState.isForceSetSpeedOn) {
    if (prevSpeed !== appState.forceSetSpeedValue) {
      appState.video.playbackRate = appState.forceSetSpeedValue;
      prevSpeed = appState.forceSetSpeedValue;
      updateSpeedInputLabel(`Speed (${appState.forceSetSpeedValue.toFixed(2)})`);
    }

    requestAnimationFrame(updateSpeed);
    return;
  }

  const shortestActiveMarkerPair = getShortestActiveMarkerPair();
  let newSpeed = prevSpeed;
  if (shortestActiveMarkerPair) {
    let markerPairSpeed: number;

    if (isVariableSpeed(shortestActiveMarkerPair.speedMap)) {
      const { start, end } = shortestActiveMarkerPair;
      markerPairSpeed = getSpeedMapping(
        shortestActiveMarkerPair.speedMap,
        // On the end marker's frame, past the end point's time, the clip plays at the end speed.
        // eslint-disable-next-line no-restricted-syntax -- the speed preview follows playback
        Math.min(Math.max(appState.video.getCurrentTime(), start), end)
      );
    } else {
      markerPairSpeed = shortestActiveMarkerPair.speed;
    }
    // console.log(markerPairSpeed);
    if (prevSpeed !== markerPairSpeed) {
      newSpeed = markerPairSpeed;
    }
  } else {
    newSpeed = 1;
  }

  if (prevSpeed !== newSpeed) {
    appState.video.playbackRate = newSpeed;
    prevSpeed = newSpeed;
    updateSpeedInputLabel('Speed');
  }

  requestAnimationFrame(updateSpeed);
}

export function updateSpeedInputLabel(text: string) {
  if (appState.isSettingsEditorOpen && appState.speedInputLabel != null) {
    appState.speedInputLabel.textContent = text;
  }
}

export function getMinterpFpsMulSuffix(mul: number, speed: number) {
  if (mul <= 0 || speed <= 0) return '';
  const ratio = mul / speed;
  return ` → ${ratio.toFixed(2)}× clip`;
}

export function updateMinterpFpsMulLabel(markerPair) {
  if (!appState.isSettingsEditorOpen || appState.minterpFpsMulSuffixSpan == null) return;
  const { minterpFpsMultiplier } = pairSettings(markerPair, appState.settings);
  appState.minterpFpsMulSuffixSpan.textContent = getMinterpFpsMulSuffix(
    minterpFpsMultiplier,
    markerPair.speed
  );
}

export function getSpeedMapping(
  speedMap: SpeedPoint[],
  time: number,
  roundMultiple = defaultRoundSpeedMapEasing,
  roundPrecision = defaultSpeedRoundPrecision
) {
  let len = speedMap.length;
  if (len === 2 && speedMap[0].y === speedMap[1].y) {
    return speedMap[0].y;
  }

  len--;
  let left: SpeedPoint | undefined;
  let right: SpeedPoint | undefined;
  for (let i = 0; i < len; ++i) {
    // eslint-disable-next-line local/no-timeline-time-comparison -- the speed curve at a time
    if (speedMap[i].x <= time && time <= speedMap[i + 1].x) {
      left = speedMap[i];
      right = speedMap[i + 1];
      break;
    }
  }

  if (left && right) {
    if (left.y === right.y) {
      return left.y;
    }
    const speed = getInterpolatedSpeed(
      left,
      right,
      // eslint-disable-next-line no-restricted-syntax -- the speed preview follows playback
      appState.video.getCurrentTime(),
      roundMultiple,
      roundPrecision
    );
    return speed;
  } else {
    return 1;
  }
}

export function getInterpolatedSpeed(
  left: SpeedPoint,
  right: SpeedPoint,
  time: number,
  roundMultiple = defaultRoundSpeedMapEasing,
  roundPrecision = defaultSpeedRoundPrecision
) {
  const elapsed = time - left.x;
  const duration = right.x - left.x;
  let easedTimePercentage = 0;
  if (appState.easingMode === 'cubicInOut') {
    easedTimePercentage = easeCubicInOut(elapsed / duration);
  } else if (appState.easingMode === 'linear') {
    easedTimePercentage = elapsed / duration;
  }
  const change = right.y - left.y;
  const rawSpeed = left.y + change * easedTimePercentage || right.y;
  const roundedSpeed =
    roundMultiple > 0 ? roundValue(rawSpeed, roundMultiple, roundPrecision) : rawSpeed;
  return roundedSpeed;
}

let isMarkerLoopPreviewOn = false;
export let isMarkerSeekPending = false;
export let markerSeekDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

export function setIsMarkerSeekPending(val: boolean) {
  isMarkerSeekPending = val;
}

export function setMarkerSeekDebounceTimeout(val: ReturnType<typeof setTimeout> | null) {
  markerSeekDebounceTimeout = val;
}

export function toggleMarkerPairLoop() {
  if (isMarkerLoopPreviewOn) {
    isMarkerLoopPreviewOn = false;
    flashMessage('Auto marker looping disabled', 'red');
  } else {
    isMarkerLoopPreviewOn = true;
    flashMessage('Auto marker looping enabled', 'green');
  }
}

export function getIsMarkerLoopPreviewOn() {
  return isMarkerLoopPreviewOn;
}

export function cycleForceSetSpeedValueDown() {
  appState.forceSetSpeedValue = appState.forceSetSpeedValue - 0.25;
  if (appState.forceSetSpeedValue <= 0) appState.forceSetSpeedValue = 1;
  flashMessage(`Force set video speed value set to ${appState.forceSetSpeedValue}`, 'green');
}

export function toggleForceSetSpeed() {
  if (appState.isForceSetSpeedOn) {
    appState.isForceSetSpeedOn = false;
    updateSpeedInputLabel(`Speed`);
    flashMessage('Force set speed disabled', 'red');
  } else {
    appState.isForceSetSpeedOn = true;
    updateSpeedInputLabel(`Speed (${appState.forceSetSpeedValue.toFixed(2)})`);
    if (!isSpeedPreviewOn) requestAnimationFrame(updateSpeed);
    flashMessage('Force set speed enabled', 'green');
  }
}

export function updateAllMarkerPairSpeeds(newSpeed: number, renderSpeedAndCropUI: () => void) {
  appState.markerPairs.forEach((markerPair) => {
    updateMarkerPairSpeed(markerPair, newSpeed);
  });

  if (appState.isSettingsEditorOpen) {
    if (appState.wasGlobalSettingsEditorOpen) {
      const markerPairMergeListInput = document.getElementById('merge-list-input');
      markerPairMergeListInput?.dispatchEvent(new Event('change'));
    } else {
      if (appState.speedInput) appState.speedInput.value = newSpeed.toString();
      renderSpeedAndCropUI();
    }
  }

  flashMessage(`All marker speeds updated to ${newSpeed}`, 'olive');
}

export function updateMarkerPairSpeed(markerPair: MarkerPair, newSpeed: number) {
  const draft = createDraft(getMarkerPairHistory(markerPair));
  draft.speed = newSpeed;
  const speedMap = draft.speedMap;
  if (speedMap.length === 2 && speedMap[0].y === speedMap[1].y) {
    speedMap[1].y = newSpeed;
  }
  speedMap[0].y = newSpeed;

  saveMarkerPairHistory(draft, markerPair);
}
