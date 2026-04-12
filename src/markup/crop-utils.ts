import { Draft } from 'immer';
import { createDraft } from 'immer';
import { CropPoint, MarkerPair } from './@types/yt_clipper';
import { Crop } from './crop/crop';
import { appState } from './appState';
import { clampNumber, getCropString } from './util/util';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';

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

export function getVideoScaledCropComponents(cropComponents) {
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
  if (maxHeight == null) {
    maxHeight = appState.settings.cropResHeight;
  }

  let [x, y, w, h] = cropComponents;
  y = maxHeight - (y + h);
  [x, y, w, h] = [y, x, h, w];
  return [x, y, w, h];
}

export function rotateCropComponentsCounterClockWise(cropComponents: number[], maxWidth?: number) {
  if (maxWidth == null) {
    maxWidth = appState.settings.cropResWidth;
  }

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
