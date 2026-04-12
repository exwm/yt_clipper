import { Draft } from 'immer';
import { createDraft } from 'immer';
import { CropPoint, MarkerPair } from './@types/yt_clipper';
import { Crop } from './crop/crop';
import { appState } from './appState';
import { clampNumber, flashMessage, getCropString } from './util/util';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import { cropInput } from './settings-editor';
import { cropInputLabel } from './settings-editor';
import { getCropMapProperties, renderSpeedAndCropUI } from './charts';
import { transformCropWithPushBack } from './crop-overlay';

export function getCropComponents(cropString?: string): number[] {
  if (!cropString && appState.isSettingsEditorOpen) {
    if (!appState.wasGlobalSettingsEditorOpen && appState.prevSelectedMarkerPairIndex != null) {
      cropString = appState.markerPairs[appState.prevSelectedMarkerPairIndex].crop;
    } else {
      cropString = appState.settings.newMarkerCrop;
    }
  }

  if (!cropString) {
    console.error('No valid crop string to extract components from.');
    cropString = '0:0:iw:ih';
  }

  const cropArray = cropString.split(':').map((cropStringComponent, i) => {
    let cropComponent: number;
    if (cropStringComponent === 'iw') {
      cropComponent = appState.settings.cropResWidth;
    } else if (cropStringComponent === 'ih') {
      cropComponent = appState.settings.cropResHeight;
    } else if (i % 2 == 0) {
      cropComponent = parseFloat(cropStringComponent);
      cropComponent = Math.min(Math.round(cropComponent), appState.settings.cropResWidth);
    } else {
      cropComponent = parseFloat(cropStringComponent);
      cropComponent = Math.min(Math.round(cropComponent), appState.settings.cropResHeight);
    }
    return cropComponent;
  });
  return cropArray;
}

export function getVideoScaledCropComponentsFromCropString(cropString?: string) {
  const cropComponents = getCropComponents(cropString);
  return getVideoScaledCropComponents(cropComponents);
}

export function getVideoScaledCropComponents(cropComponents): [number, number, number, number] {
  const [x, y, w, h] = cropComponents;

  const videoWidth = appState.video.videoWidth;
  const videoHeight = appState.video.videoHeight;

  return [
    videoWidth * (x / appState.settings.cropResWidth),
    videoHeight * (y / appState.settings.cropResHeight),
    videoWidth * (w / appState.settings.cropResWidth),
    videoHeight * (h / appState.settings.cropResHeight),
  ];
}

export function rotateCropComponentsClockWise(cropComponents: number[], maxHeight?: number) {
  maxHeight ??= appState.settings.cropResHeight;

  let [x, y, w, h] = cropComponents;
  y = maxHeight - (y + h);
  [x, y, w, h] = [y, x, h, w];
  return [x, y, w, h];
}

export function rotateCropComponentsCounterClockWise(cropComponents: number[], maxWidth?: number) {
  maxWidth ??= appState.settings.cropResWidth;

  let [x, y, w, h] = cropComponents;
  x = maxWidth - (x + w);
  [x, y, w, h] = [y, x, h, w];
  return [x, y, w, h];
}

export function getRotatedCropComponents(
  cropComponents: number[],
  maxWidth?: number,
  maxHeight?: number
): number[] {
  let [x, y, w, h] = cropComponents;

  if (appState.rotation === 90) {
    [x, y, w, h] = rotateCropComponentsClockWise([x, y, w, h], maxWidth);
  } else if (appState.rotation === -90) {
    [x, y, w, h] = rotateCropComponentsCounterClockWise([x, y, w, h], maxHeight);
  }

  return [x, y, w, h];
}

export function getRotatedCropString(cropString: string): string {
  let [x, y, w, h] = getCropComponents(cropString);

  [x, y, w, h] = getRotatedCropComponents([x, y, w, h]);

  return getCropString(x, y, w, h);
}

export function getNumericCropString(cropString: string) {
  const [x, y, w, h] = getCropComponents(cropString);
  return getCropString(x, y, w, h);
}

export function isStaticCrop(cropMap: CropPoint[]) {
  return cropMap.length === 2 && cropStringsEqual(cropMap[0].crop, cropMap[1].crop);
}

export function cropStringsEqual(a: string, b: string): boolean {
  const [ax, ay, aw, ah] = getCropComponents(a);
  const [bx, by, bw, bh] = getCropComponents(b);
  return ax === bx && ay === by && aw === bw && ah === bh;
}

export function getCropMultiples(oldCropRes: string, newCropRes: string) {
  const [oldWidth, oldHeight] = oldCropRes.split('x').map((str) => parseInt(str), 10);
  const [newWidth, newHeight] = newCropRes.split('x').map((str) => parseInt(str), 10);
  const cropMultipleX = newWidth / oldWidth;
  const cropMultipleY = newHeight / oldHeight;
  return { cropMultipleX, cropMultipleY, newWidth, newHeight };
}

export function multiplyCropString(
  cropMultipleX: number,
  cropMultipleY: number,
  cropString: string
) {
  const [xs, ys, ws, hs] = cropString.split(':');
  const mx: string | number = String(Math.round(parseFloat(xs) * cropMultipleX));
  const my: string | number = String(Math.round(parseFloat(ys) * cropMultipleY));
  const mw: string | number = ws !== 'iw' ? String(Math.round(parseFloat(ws) * cropMultipleX)) : ws;
  const mh: string | number = hs !== 'ih' ? String(Math.round(parseFloat(hs) * cropMultipleY)) : hs;
  return [mx, my, mw, mh].join(':');
}

export function multiplyMarkerPairCrops(
  markerPair: MarkerPair,
  cropMultipleX: number,
  cropMultipleY: number
) {
  markerPair.cropRes = appState.settings.cropRes;
  const draft = createDraft(getMarkerPairHistory(markerPair));
  draft.cropMap.forEach((cropPoint, idx) => {
    const multipliedCropString = multiplyCropString(cropMultipleX, cropMultipleY, cropPoint.crop);
    cropPoint.crop = multipliedCropString;
    if (idx === 0) draft.crop = multipliedCropString;
  });
  saveMarkerPairHistory(draft, markerPair, false);
}

export function setCropComponentForAllPoints(
  newCrop: { x?: number; y?: number; w?: number; h?: number },
  draftCropMap: Draft<CropPoint[]>,
  initialCropMap: CropPoint[]
) {
  draftCropMap.forEach((cropPoint, i) => {
    if (i === appState.currentCropPointIndex) return;
    const initCrop = initialCropMap[i].crop;
    const [ix, iy, iw, ih] = getCropComponents(initCrop ?? cropPoint.crop);
    const nw = newCrop.w ?? iw;
    const nh = newCrop.h ?? ih;
    const nx = newCrop.x ?? clampNumber(ix, 0, appState.settings.cropResWidth - nw);
    const ny = newCrop.y ?? clampNumber(iy, 0, appState.settings.cropResHeight - nh);
    cropPoint.crop = `${nx}:${ny}:${nw}:${nh}`;
  });
}

export function setAspectRatioForAllPoints(
  aspectRatio: number,
  draftCropMap: Draft<CropPoint[]>,
  initialCropMap: CropPoint[],
  referencePointIndex = appState.currentCropPointIndex
) {
  Crop.shouldConstrainMinDimensions = false;
  const cropResWidth = appState.settings.cropResWidth;
  const cropResHeight = appState.settings.cropResHeight;
  draftCropMap.forEach((cropPoint, i) => {
    if (i === referencePointIndex) return;
    const initCrop = initialCropMap[i].crop;

    const [ix, iy, iw, ih] = getCropComponents(initCrop ?? cropPoint.crop);
    const crop = new Crop(0, 0, 0, 0, cropResWidth, cropResHeight);
    crop.defaultAspectRatio = aspectRatio;
    if (ih >= iw) {
      crop.resizeSAspectRatioLocked(ih);
    } else {
      crop.resizeEAspectRatioLocked(iw);
    }
    crop.panX(ix);
    crop.panY(iy);
    cropPoint.crop = crop.cropString;
  });
  Crop.shouldConstrainMinDimensions = true;
}
export function getDefaultCropRes() {
  const cropResWidth = appState.videoInfo.isVerticalVideo
    ? Math.round(1920 * appState.videoInfo.aspectRatio)
    : 1920;
  const cropResHeight = appState.videoInfo.isVerticalVideo
    ? 1920
    : Math.round(1920 / appState.videoInfo.aspectRatio);
  const cropRes = `${cropResWidth}x${cropResHeight}`;
  return {
    cropResWidth,
    cropResHeight,
    cropRes,
  };
}
export function setCropInputValue(cropString: string) {
  if (!cropInput) return;
  const rotatedCropString = getRotatedCropString(cropString);
  if (rotatedCropString !== cropString && cropInputLabel) {
    cropInputLabel.textContent = `Crop (Rotated: ${rotatedCropString})`;
  }
  cropInput.value = cropString;
}
export function setCropString(
  markerPair: MarkerPair,
  newCrop: string,
  forceCropConstraints = false
) {
  const prevCrop = markerPair.cropMap[appState.currentCropPointIndex].crop;
  const { isDynamicCrop, enableZoomPan, initCropMap } = getCropMapProperties();
  const shouldMaintainCropAspectRatio = enableZoomPan && isDynamicCrop;
  const crop = transformCropWithPushBack(prevCrop, newCrop, shouldMaintainCropAspectRatio);

  updateCropString(crop, true, forceCropConstraints, initCropMap ?? undefined);
}
export function multiplyAllCrops(cropMultipleX: number, cropMultipleY: number) {
  const cropString = appState.settings.newMarkerCrop;
  const multipliedCropString = multiplyCropString(cropMultipleX, cropMultipleY, cropString);
  appState.settings.newMarkerCrop = multipliedCropString;
  setCropInputValue(multipliedCropString);

  appState.markerPairs.forEach((markerPair) => {
    multiplyMarkerPairCrops(markerPair, cropMultipleX, cropMultipleY);
  });
}
export function getRelevantCropString() {
  if (!appState.isSettingsEditorOpen) return appState.settings.newMarkerCrop;
  if (!appState.wasGlobalSettingsEditorOpen) {
    return appState.markerPairs[appState.prevSelectedMarkerPairIndex].cropMap[
      appState.currentCropPointIndex
    ].crop;
  } else {
    return appState.settings.newMarkerCrop;
  }
}
export function updateCropStringWithCrop(
  crop: Crop,
  shouldRerenderCharts = false,
  forceCropConstraints = false,
  initCropMap?: CropPoint[]
) {
  let newCropString: string;
  if (appState.rotation === 90) {
    newCropString = crop.rotatedCropStringCounterClockWise;
  } else if (appState.rotation === -90) {
    newCropString = crop.rotatedCropStringClockWise;
  } else {
    newCropString = crop.cropString;
  }

  updateCropString(newCropString, shouldRerenderCharts, forceCropConstraints, initCropMap);
}
export let lastRenderedCropString: string | null = null;
export function updateAllMarkerPairCrops(newCrop: string) {
  appState.markerPairs.forEach((markerPair) => {
    const draft = createDraft(getMarkerPairHistory(markerPair));
    const cropMap = draft.cropMap;
    if (isStaticCrop(cropMap)) {
      draft.crop = newCrop;
      cropMap[0].crop = newCrop;
      cropMap[1].crop = newCrop;
    }
    saveMarkerPairHistory(draft, markerPair);
  });

  if (appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    if (isStaticCrop(cropMap)) {
      setCropInputValue(newCrop);
      renderSpeedAndCropUI();
    }
  }

  flashMessage(`All static marker crops updated to ${newCrop}`, 'olive');
}
export function updateCropString(
  cropString: string,
  shouldRerenderCharts = false,
  forceCropConstraints = false,
  initCropMap?: CropPoint[]
) {
  if (!appState.isSettingsEditorOpen)
    throw new Error('No editor was open when trying to update crop.');

  let draft;
  const [nx, ny, nw, nh] = getCropComponents(cropString);
  cropString = getCropString(nx, ny, nw, nh);

  let wasDynamicCrop = false; // eslint-disable-line no-useless-assignment
  let enableZoomPan = false; // eslint-disable-line no-useless-assignment
  if (!appState.wasGlobalSettingsEditorOpen) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    enableZoomPan = markerPair.enableZoomPan;

    const initState = getMarkerPairHistory(markerPair);
    draft = createDraft(initState);
    if (initCropMap == null)
      throw new Error('No initial crop map given when modifying marker pair crop.');

    const draftCropMap: CropPoint[] = draft.cropMap;
    wasDynamicCrop =
      !isStaticCrop(initCropMap) ||
      (initCropMap.length === 2 && appState.currentCropPointIndex === 1);

    const draftCropPoint = draftCropMap[appState.currentCropPointIndex];
    const initCrop = initCropMap[appState.currentCropPointIndex].crop;
    if (initCrop == null) throw new Error('Init crop undefined.');

    draftCropPoint.crop = cropString;

    if (wasDynamicCrop) {
      if (!enableZoomPan || forceCropConstraints) {
        setCropComponentForAllPoints({ w: nw, h: nh }, draftCropMap, initCropMap);
      } else if (enableZoomPan || forceCropConstraints) {
        const aspectRatio = nw / nh;
        setAspectRatioForAllPoints(aspectRatio, draftCropMap, initCropMap);
      }
    }

    const maxIndex = draftCropMap.length - 1;
    const isSecondLastPoint = appState.currentCropPointIndex === maxIndex - 1;
    const isLastSectionStatic = cropStringsEqual(initCrop, initCropMap[maxIndex].crop);
    if (isSecondLastPoint && isLastSectionStatic) {
      draftCropMap[maxIndex].crop = cropString;
    }

    draft.crop = draftCropMap[0].crop;
  } else {
    appState.settings.newMarkerCrop = cropString;
  }

  if (!appState.wasGlobalSettingsEditorOpen) {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    saveMarkerPairHistory(draft, markerPair, shouldRerenderCharts);
  }

  if (cropString !== lastRenderedCropString || shouldRerenderCharts) {
    lastRenderedCropString = cropString;
    renderSpeedAndCropUI(shouldRerenderCharts);
  }
}
