import { easeCubicInOut } from 'd3-ease';
import { createDraft } from 'immer';
import { MarkerPair, SpeedPoint } from './@types/yt_clipper';
import { appState } from './appState';
import { isVariableSpeed } from './save-load';
import { flashMessage, roundValue } from './util/util';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';

let isSpeedPreviewOn = false;
let prevSpeed = 1;
const defaultRoundSpeedMapEasing = 0.05;
const defaultSpeedRoundPrecision = 2;

export function getShortestActiveMarkerPair(currentTime?: number): MarkerPair {
  currentTime ??= appState.video.getCurrentTime();

  if (
    appState.isSettingsEditorOpen &&
    !appState.wasGlobalSettingsEditorOpen &&
    appState.prevSelectedMarkerPairIndex != null
  ) {
    const selectedMarkerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    if (
      currentTime >= Math.floor(selectedMarkerPair.start * 1e6) / 1e6 &&
      currentTime <= Math.ceil(selectedMarkerPair.end * 1e6) / 1e6
    ) {
      return selectedMarkerPair;
    }
  }
  const activeMarkerPairs = appState.markerPairs.filter((markerPair) => {
    if (
      currentTime >= Math.floor(markerPair.start * 1e6) / 1e6 &&
      currentTime <= Math.ceil(markerPair.end * 1e6) / 1e6
    ) {
      return true;
    }
    return false;
  });

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
      markerPairSpeed = getSpeedMapping(
        shortestActiveMarkerPair.speedMap,
        appState.video.getCurrentTime()
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
  const n = mul > 0 ? Math.round(mul / speed) : 0;
  return n >= 1 && Math.abs(mul / speed - n) < 1e-9 ? ` (${n}x)` : '';
}

export function updateMinterpFpsMulLabel(markerPair) {
  if (!appState.isSettingsEditorOpen || appState.minterpFpsMulLabelSpan == null) return;
  const mul = (markerPair.overrides.minterpFpsMultiplier ??
    appState.settings.minterpFpsMultiplier ??
    0) as number;
  appState.minterpFpsMulLabelSpan.textContent = `FPS Multiplier${getMinterpFpsMulSuffix(mul, markerPair.speed)}`;
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
  flashMessage(
    `Force set appState.video speed value set to ${appState.forceSetSpeedValue}`,
    'green'
  );
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
