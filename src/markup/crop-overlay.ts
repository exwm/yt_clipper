import { appState } from './appState';
import { getCropComponents, getRotatedCropComponents, rotateCropComponentsClockWise, rotateCropComponentsCounterClockWise } from './crop-utils';
import { resetCropPreviewAnchor } from './crop/crop-preview';
import { assertDefined, deleteElement, flashMessage, getCropString, safeSetInnerHtml, setAttributes } from './util/util';
import { updateCropString } from './crop-utils';
import { chartState, renderSpeedAndCropUI, getCropMapProperties } from './charts';
import { updateCropStringWithCrop } from './crop-utils';
import { blockVideoPause } from './util/videoUtil';
import { getRelevantCropString } from './crop-utils';
import { showPlayerControls } from './util/videoUtil';
import { hidePlayerControls } from './util/videoUtil';
import { createDraft } from 'immer';
import { Crop } from './crop/crop';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import { CropPoint } from './@types/yt_clipper';

export function addCropHoverListener(e: KeyboardEvent) {
  const isCropBlockingChartVisible = appState.isCurrentChartVisible && chartState.currentChartInput && chartState.currentChartInput.type !== 'crop';
  if ((e.key === 'Control' || e.key === 'Meta') &&
    appState.isHotkeysEnabled &&
    !e.repeat &&
    appState.isCropOverlayVisible &&
    !isDrawingCrop &&
    !isCropBlockingChartVisible) {
    document.addEventListener('pointermove', cropHoverHandler, true);
  }
}export function removeCropHoverListener(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') {
    document.removeEventListener('pointermove', cropHoverHandler, true);
    if (cropHoverRafId) {
      cancelAnimationFrame(cropHoverRafId);
      cropHoverRafId = 0;
      pendingCropHoverEvent = null;
    }
    showPlayerControls();
    appState.hooks.cropMouseManipulation.style.removeProperty('cursor');
    // Reset anchor to default (top-left) for the next crop modification session
    resetCropPreviewAnchor();
  }
}
export function cropHoverHandler(e: PointerEvent) {
  if (appState.isSettingsEditorOpen && appState.isCropOverlayVisible && !isDrawingCrop) {
    pendingCropHoverEvent = e;
    if (!cropHoverRafId) {
      cropHoverRafId = requestAnimationFrame(processCropHover);
    }
  }
}
export function processCropHover() {
  cropHoverRafId = 0;
  const e = pendingCropHoverEvent;
  pendingCropHoverEvent = null;
  if (e && appState.isSettingsEditorOpen && appState.isCropOverlayVisible && !isDrawingCrop) {
    updateCropHoverCursor(e);
  }
}
export function updateCropHoverCursor(e) {
  const cursor = getMouseCropHoverRegion(e);

  if (cursor) {
    hidePlayerControls();
    appState.hooks.cropMouseManipulation.style.cursor = cursor;
  } else {
    showPlayerControls();
    appState.hooks.cropMouseManipulation.style.removeProperty('cursor');
  }
}
export let cropHoverRafId = 0;
export let pendingCropHoverEvent: PointerEvent | null = null;


let cropDiv: HTMLDivElement;
let cropSvg: SVGSVGElement;
let cropDim: SVGRectElement;

export const cropOverlayElements = {
  cropRect: null as Element | null,
  cropRectBorder: null as Element | null,
  cropRectBorderBlack: null as Element | null,
  cropRectBorderWhite: null as Element | null,

  cropCrossHair: null as Element | null,
  cropCrossHairXBlack: null as Element | null,
  cropCrossHairXWhite: null as Element | null,
  cropCrossHairYBlack: null as Element | null,
  cropCrossHairYWhite: null as Element | null,
  cropCrossHairs: [] as Element[],

  cropChartSectionStart: null as Element | null,
  cropChartSectionStartBorderGreen: null as Element | null,
  cropChartSectionStartBorderWhite: null as Element | null,
  cropChartSectionEnd: null as Element | null,
  cropChartSectionEndBorderYellow: null as Element | null,
  cropChartSectionEndBorderWhite: null as Element | null,
};export function createCropOverlay(cropString: string) {
  deleteCropOverlay();

  cropDiv = document.createElement('div');
  cropDiv.setAttribute('id', 'crop-div');
  safeSetInnerHtml(
    cropDiv,
    `
        <svg id="crop-svg">
          <defs>
            <mask id="cropMask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect id="cropRect" x="0" y="0" width="100%" height="100%" fill="black" />
            </mask>
          </defs>
          <rect id="cropDim" mask="url(#cropMask)" x="0" y="0" width="100%" height="100%"
            fill="black" fill-opacity="${cropDims[cropDimIndex]}"
          />

          <g id="cropChartSectionStart" opacity="0.7" shape-rendering="geometricPrecision">
            <rect id="cropChartSectionStartBorderGreen" x="0" y="0" width="0%" height="0%" fill="none"
              stroke="lime" stroke-width="1px"
            />
            <rect id="cropChartSectionStartBorderWhite" x="0" y="0" width="0%" height="0%" fill="none"
              stroke="black" stroke-width="1px" stroke-dasharray="5 10"
            />
          </g>
          <g id="cropChartSectionEnd" opacity="0.7" shape-rendering="geometricPrecision">
            <rect id="cropChartSectionEndBorderYellow" x="0" y="0" width="0%" height="0%" fill="none"
              stroke="yellow" stroke-width="1px"
            />
            <rect id="cropChartSectionEndBorderWhite" x="0" y="0" width="0%" height="0%" fill="none"
              stroke="black" stroke-width="1px" stroke-dasharray="5 10"
            />
          </g>

          <g id="cropRectBorder" opacity="1" shape-rendering="geometricPrecision">
            <rect id="cropRectBorderBlack" x="0" y="0" width="100%" height="100%" fill="none"
              stroke="black" stroke-width="1px" stroke-opacity="0.8"
            />
            <rect id="cropRectBorderWhite" x="0" y="0" width="100%" height="100%" fill="none"
            stroke="white" stroke-width="1px" stroke-dasharray="5 5" stroke-opacity="0.8"
            >
            </rect>
            <g id="cropCrossHair" opacity="0.9" stroke="white" display="${cropCrossHairEnabled ? 'block' : 'none'}">
              <line id="cropCrossHairXBlack" x1="0" y1="50%" x2="100%" y2="50%" stroke="black" stroke-width="1px" type="x"/>
              <line id="cropCrossHairXWhite" x1="0" y1="50%" x2="100%" y2="50%" stroke-width="1px" stroke-dasharray="5 5" type="x"/>

              <line id="cropCrossHairYBlack" x1="50%" y1="0" x2="50%" y2="100%" stroke="black" stroke-width="1px" type="y"/>
              <line id="cropCrossHairYWhite" x1="50%" y1="0" x2="50%" y2="100%" stroke-width="1px" stroke-dasharray="5 5" type="y"/>
            </g>
          </g>
        </svg>
      `
  );
  resizeCropOverlay();
  appState.hooks.cropOverlay.insertAdjacentElement('afterend', cropDiv);
  cropSvg = cropDiv.firstElementChild as SVGSVGElement;
  cropDim = document.getElementById('cropDim') as unknown as SVGRectElement;
  cropOverlayElements.cropRect = document.getElementById('cropRect') as unknown as SVGRectElement;
  cropOverlayElements.cropRectBorder = document.getElementById('cropRectBorder');
  cropOverlayElements.cropRectBorderBlack = document.getElementById('cropRectBorderBlack');
  cropOverlayElements.cropRectBorderWhite = document.getElementById('cropRectBorderWhite');

  cropOverlayElements.cropChartSectionStart = document.getElementById('cropChartSectionStart');
  cropOverlayElements.cropChartSectionStartBorderGreen = document.getElementById('cropChartSectionStartBorderGreen');
  cropOverlayElements.cropChartSectionStartBorderWhite = document.getElementById('cropChartSectionStartBorderWhite');
  cropOverlayElements.cropChartSectionEnd = document.getElementById('cropChartSectionEnd');
  cropOverlayElements.cropChartSectionEndBorderYellow = document.getElementById('cropChartSectionEndBorderYellow');
  cropOverlayElements.cropChartSectionEndBorderWhite = document.getElementById('cropChartSectionEndBorderWhite');

  cropOverlayElements.cropCrossHair = document.getElementById('cropCrossHair');
  cropOverlayElements.cropCrossHairXBlack = document.getElementById('cropCrossHairXBlack');
  cropOverlayElements.cropCrossHairXWhite = document.getElementById('cropCrossHairXWhite');
  cropOverlayElements.cropCrossHairYBlack = document.getElementById('cropCrossHairYBlack');
  cropOverlayElements.cropCrossHairYWhite = document.getElementById('cropCrossHairYWhite');
  assertDefined(cropOverlayElements.cropCrossHairXBlack);
  assertDefined(cropOverlayElements.cropCrossHairXWhite);
  assertDefined(cropOverlayElements.cropCrossHairYBlack);
  assertDefined(cropOverlayElements.cropCrossHairYWhite);
  cropOverlayElements.cropCrossHairs = [
    cropOverlayElements.cropCrossHairXBlack,
    cropOverlayElements.cropCrossHairXWhite,
    cropOverlayElements.cropCrossHairYBlack,
    cropOverlayElements.cropCrossHairYWhite,
  ];

  assertDefined(cropOverlayElements.cropRect);
  assertDefined(cropOverlayElements.cropRectBorderBlack);
  assertDefined(cropOverlayElements.cropRectBorderWhite);
  [cropOverlayElements.cropRect, cropOverlayElements.cropRectBorderBlack, cropOverlayElements.cropRectBorderWhite].map((cropRect) => { setCropOverlay(cropRect, cropString); }
  );
  cropOverlayElements.cropCrossHairs.map((cropCrossHair) => { setCropCrossHair(cropCrossHair, cropString); });
  appState.isCropOverlayVisible = true;
}
export let rerenderCropRafId = 0;
export function resizeCropOverlay() {
  if (!rerenderCropRafId) {
    rerenderCropRafId = requestAnimationFrame(forceRerenderCrop);
  }
}
export function forceRerenderCrop() {
  rerenderCropRafId = 0;
  centerVideo();
  if (cropDiv) {
    const videoRect = appState.video.getBoundingClientRect();
    const videoContainerRect = appState.hooks.videoContainer.getBoundingClientRect();
    const { width, height } = videoRect;
    const top = videoRect.top - videoContainerRect.top;
    const left = videoRect.left - videoContainerRect.left;
    const styles = [width, height, top, left].map((e) => `${Math.floor(e)}px`);

    Object.assign(cropDiv.style, { width: styles[0], height: styles[1], top: styles[2], left: styles[3], position: 'absolute' });
    if (cropSvg) {
      cropSvg.setAttribute('width', '0');
    }
    const cropString = getRelevantCropString();
    const [cx, cy, cw, ch] = getCropComponents(cropString);
    assertDefined(cropOverlayElements.cropRect);
    assertDefined(cropOverlayElements.cropRectBorder);
    assertDefined(cropOverlayElements.cropRectBorderBlack);
    assertDefined(cropOverlayElements.cropRectBorderWhite);
    setCropOverlayDimensions(cropOverlayElements.cropRect, cx, cy, cw, ch);
    setCropOverlayDimensions(cropOverlayElements.cropRectBorder, cx, cy, cw, ch);
    setCropOverlayDimensions(cropOverlayElements.cropRectBorderBlack, cx, cy, cw, ch);
    setCropOverlayDimensions(cropOverlayElements.cropRectBorderWhite, cx, cy, cw, ch);
  }
}
export function centerVideo() {
  const videoContainerRect = appState.hooks.videoContainer.getBoundingClientRect();
  let width, height;
  if (appState.rotation === 0) {
    height = videoContainerRect.height;
    width = height * appState.videoInfo.aspectRatio;
    width = Math.floor(Math.min(width, videoContainerRect.width));
    height = Math.floor(width / appState.videoInfo.aspectRatio);
  } else {
    width = videoContainerRect.height;
    height = width / appState.videoInfo.aspectRatio;
    height = Math.floor(Math.min(height, videoContainerRect.width));
    width = Math.floor(height * appState.videoInfo.aspectRatio);
  }

  const left = videoContainerRect.width / 2 - width / 2;
  const top = videoContainerRect.height / 2 - height / 2;

  const videoStyles = [width, height, top, left].map((e) => `${Math.round(e)}px`);
  Object.assign(appState.video.style, { width: videoStyles[0], height: videoStyles[1], top: videoStyles[2], left: videoStyles[3], position: 'absolute' });
}
export function setCropOverlay(cropRect: Element, cropString: string) {
  const [x, y, w, h] = getCropComponents(cropString);
  setCropOverlayDimensions(cropRect, x, y, w, h);
}
export function setCropOverlayDimensions(
  cropRect: Element,
  inX: number,
  inY: number,
  inW: number,
  inH: number
) {
  if (cropRect) {
    let x = (inX / appState.settings.cropResWidth) * 100;
    let y = (inY / appState.settings.cropResHeight) * 100;
    let w = (inW / appState.settings.cropResWidth) * 100;
    let h = (inH / appState.settings.cropResHeight) * 100;

    [x, y, w, h] = getRotatedCropComponents([x, y, w, h], 100, 100);

    const cropRectAttrs = {
      x: `${x}%`,
      y: `${y}%`,
      width: `${w}%`,
      height: `${h}%`,
    };

    setAttributes(cropRect, cropRectAttrs);
  }
}
export function setCropCrossHair(cropCrossHair: Element, cropString: string) {
  const [x, y, w, h] = getRotatedCropComponents(getCropComponents(cropString));

  if (cropCrossHair) {
    const [x1M, x2M, y1M, y2M] = cropCrossHair.getAttribute('type') === 'x' ? [0, 1, 0.5, 0.5] : [0.5, 0.5, 0, 1];

    let cropCrossHairAttrs = {
      x1: `${((x + x1M * w) / appState.settings.cropResWidth) * 100}%`,
      x2: `${((x + x2M * w) / appState.settings.cropResWidth) * 100}%`,
      y1: `${((y + y1M * h) / appState.settings.cropResHeight) * 100}%`,
      y2: `${((y + y2M * h) / appState.settings.cropResHeight) * 100}%`,
    };
    if (appState.rotation === 90 || appState.rotation === -90) {
      cropCrossHairAttrs = {
        x1: `${((x + x1M * w) / appState.settings.cropResHeight) * 100}%`,
        x2: `${((x + x2M * w) / appState.settings.cropResHeight) * 100}%`,
        y1: `${((y + y1M * h) / appState.settings.cropResWidth) * 100}%`,
        y2: `${((y + y2M * h) / appState.settings.cropResWidth) * 100}%`,
      };
    }
    setAttributes(cropCrossHair, cropCrossHairAttrs);
  }
}
export const cropDims = [0, 0.25, 0.5, 0.75, 0.9, 1];
export let cropDimIndex = 2;
export function cycleCropDimOpacity() {
  cropDimIndex = (cropDimIndex + 1) % cropDims.length;
  cropDim.setAttribute('fill-opacity', cropDims[cropDimIndex].toString());
}
export function showCropOverlay() {
  if (cropSvg) {
    cropSvg.style.display = 'block';
    appState.isCropOverlayVisible = true;
  }
}
export function hideCropOverlay() {
  if (isDrawingCrop) {
    finishDrawingCrop(true);
  }
  if (isMouseManipulatingCrop) {
    endCropMouseManipulation(null, true);
  }
  if (cropSvg) {
    cropSvg.style.display = 'none';
    appState.isCropOverlayVisible = false;
  }
}
export function deleteCropOverlay() {
  const cropDiv = document.getElementById('crop-div');
  if (cropDiv) deleteElement(cropDiv);
  appState.isCropOverlayVisible = false;
}
export let isMouseManipulatingCrop = false;
export let endCropMouseManipulation: (e, forceEndDrag?: boolean) => void;
export function ctrlOrCommand(e: PointerEvent) {
  return e.ctrlKey || e.metaKey;
}
export function addCropMouseManipulationListener() {
  appState.hooks.cropMouseManipulation.addEventListener(
    'pointerdown',
    cropMouseManipulationHandler,
    {
      capture: true,
    }
  );
  function cropMouseManipulationHandler(e: PointerEvent) {
    const isCropBlockingChartVisible = appState.isCurrentChartVisible && chartState.currentChartInput && chartState.currentChartInput.type !== 'crop';
    if (ctrlOrCommand(e) &&
      appState.isSettingsEditorOpen &&
      appState.isCropOverlayVisible &&
      !isDrawingCrop &&
      !isCropBlockingChartVisible) {
      const cropString = getRelevantCropString();
      const [ix, iy, iw, ih] = getCropComponents(cropString);
      const cropResWidth = appState.settings.cropResWidth;
      const cropResHeight = appState.settings.cropResHeight;
      const videoRect = appState.video.getBoundingClientRect();
      const clickPosX = e.clientX - videoRect.left;
      const clickPosY = e.clientY - videoRect.top;
      const cursor = getMouseCropHoverRegion(e, cropString);
      const pointerId = e.pointerId;

      const { isDynamicCrop, enableZoomPan, initCropMap } = getCropMapProperties();

      let pendingCropDragEvent: PointerEvent | null = null;
      let cropDragRafId = 0;
      let pendingCropResizeEvent: PointerEvent | null = null;
      let cropResizeRafId = 0;

      endCropMouseManipulation = (e: PointerEvent, forceEnd = false) => {
        if (forceEnd) {
          document.removeEventListener('pointerup', endCropMouseManipulation, {
            capture: true,
          });
        }
        isMouseManipulatingCrop = false;
        if (cropDragRafId) {
          cancelAnimationFrame(cropDragRafId);
          cropDragRafId = 0;
          processDragCrop();
        }
        if (cropResizeRafId) {
          cancelAnimationFrame(cropResizeRafId);
          cropResizeRafId = 0;
          processResizeCrop();
        }

        appState.hooks.cropMouseManipulation.releasePointerCapture(pointerId);

        if (!appState.wasGlobalSettingsEditorOpen) {
          const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
          const draft = createDraft(getMarkerPairHistory(markerPair));
          saveMarkerPairHistory(draft, markerPair);
        }

        renderSpeedAndCropUI();

        document.removeEventListener('pointermove', dragCropHandler);
        document.removeEventListener('pointermove', cropResizeHandler);

        showPlayerControls();
        if (!forceEnd && ctrlOrCommand(e)) {
          if (cursor) appState.hooks.cropMouseManipulation.style.cursor = cursor;
          updateCropHoverCursor(e);
          document.addEventListener('pointermove', cropHoverHandler, true);
        } else {
          appState.hooks.cropMouseManipulation.style.removeProperty('cursor');
        }
        document.addEventListener('keyup', removeCropHoverListener, true);
        document.addEventListener('keydown', addCropHoverListener, true);
      };

      if (!cursor) {
        return;
      }

      let cropResizeHandler;

      document.addEventListener('click', blockVideoPause, {
        once: true,
        capture: true,
      });
      document.removeEventListener('pointermove', cropHoverHandler, true);
      document.removeEventListener('keydown', addCropHoverListener, true);
      document.removeEventListener('keyup', removeCropHoverListener, true);

      e.preventDefault();
      appState.hooks.cropMouseManipulation.setPointerCapture(pointerId);

      if (cursor === 'grab') {
        appState.hooks.cropMouseManipulation.style.cursor = 'grabbing';
        document.addEventListener('pointermove', dragCropHandler);
      } else {
        cropResizeHandler = (e: PointerEvent) => {
          pendingCropResizeEvent = e;
          if (!cropResizeRafId) {
            cropResizeRafId = requestAnimationFrame(processResizeCrop);
          }
        };
        document.addEventListener('pointermove', cropResizeHandler);
      }

      document.addEventListener('pointerup', endCropMouseManipulation, {
        once: true,
        capture: true,
      });

      hidePlayerControls();
      isMouseManipulatingCrop = true;

      function dragCropHandler(e: PointerEvent) {
        pendingCropDragEvent = e;
        if (!cropDragRafId) {
          cropDragRafId = requestAnimationFrame(processDragCrop);
        }
      }

      function processDragCrop() {
        cropDragRafId = 0;
        const e = pendingCropDragEvent;
        pendingCropDragEvent = null;
        if (!e) return;

        const shouldMaintainCropX = e.shiftKey;
        const shouldMaintainCropY = e.altKey;

        const dragPosX = e.clientX - videoRect.left;
        const dragPosY = e.clientY - videoRect.top;
        const changeX = dragPosX - clickPosX;
        const changeY = dragPosY - clickPosY;
        let changeXScaled = Math.round((changeX / videoRect.width) * cropResWidth);
        let changeYScaled = Math.round((changeY / videoRect.height) * cropResHeight);
        let crop = new Crop(ix, iy, iw, ih, cropResWidth, cropResHeight);

        if (appState.rotation === 90) {
          changeXScaled = Math.round((changeX / videoRect.width) * cropResHeight);
          changeYScaled = Math.round((changeY / videoRect.height) * cropResWidth);
          crop = new Crop(cropResHeight - iy - ih, ix, ih, iw, cropResHeight, cropResWidth);
        } else if (appState.rotation === -90) {
          changeXScaled = Math.round((changeX / videoRect.width) * cropResHeight);
          changeYScaled = Math.round((changeY / videoRect.height) * cropResWidth);
          crop = new Crop(iy, cropResWidth - ix - iw, ih, iw, cropResHeight, cropResWidth);
        }

        if (shouldMaintainCropX) changeXScaled = 0;
        if (shouldMaintainCropY) changeYScaled = 0;
        crop.panX(changeXScaled);
        crop.panY(changeYScaled);

        updateCropStringWithCrop(crop, false, false, initCropMap ?? undefined);
      }

      function getCropResizeHandler(e: PointerEvent, cursor: string) {
        const shouldMaintainCropAspectRatio = ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
          (enableZoomPan && isDynamicCrop && !e.altKey);

        const dragPosX = e.clientX - videoRect.left;
        const changeX = dragPosX - clickPosX;
        const dragPosY = e.clientY - videoRect.top;
        const changeY = dragPosY - clickPosY;
        let changeXScaled = (changeX / videoRect.width) * appState.settings.cropResWidth;
        let changeYScaled = (changeY / videoRect.height) * appState.settings.cropResHeight;

        const shouldResizeCenterOut = e.shiftKey;
        let crop = new Crop(ix, iy, iw, ih, cropResWidth, cropResHeight);

        if (appState.rotation === 90) {
          changeXScaled = (changeX / videoRect.width) * cropResHeight;
          changeYScaled = (changeY / videoRect.height) * cropResWidth;
          crop = new Crop(cropResHeight - iy - ih, ix, ih, iw, cropResHeight, cropResWidth);
        } else if (appState.rotation === -90) {
          changeXScaled = Math.round((changeX / videoRect.width) * cropResHeight);
          changeYScaled = Math.round((changeY / videoRect.height) * cropResWidth);
          crop = new Crop(iy, cropResWidth - ix - iw, ih, iw, cropResHeight, cropResWidth);
        }

        resizeCrop(
          crop,
          cursor,
          changeXScaled,
          changeYScaled,
          shouldMaintainCropAspectRatio,
          shouldResizeCenterOut
        );
        updateCropStringWithCrop(crop, false, false, initCropMap ?? undefined);
      }

      function processResizeCrop() {
        cropResizeRafId = 0;
        const e = pendingCropResizeEvent;
        pendingCropResizeEvent = null;
        if (e) getCropResizeHandler(e, cursor);
      }
    }
  }
}
// mutates crop


export function resizeCrop(
  crop: Crop,
  cursor: string,
  deltaX: number,
  deltaY: number,
  shouldMaintainCropAspectRatio = false,
  shouldResizeCenterOut = false
): void {
  const isWResize = ['w-resize', 'nw-resize', 'sw-resize'].includes(cursor);
  const isNResize = ['n-resize', 'nw-resize', 'ne-resize'].includes(cursor);
  if (isWResize) deltaX = -deltaX;
  if (isNResize) deltaY = -deltaY;

  const isDiagonalResize = ['ne-resize', 'se-resize', 'sw-resize', 'nw-resize'].includes(cursor);
  if (shouldMaintainCropAspectRatio && shouldResizeCenterOut) {
    crop.resizeNESWAspectRatioLocked(deltaY, deltaX);
  } else if (shouldResizeCenterOut && isDiagonalResize) {
    crop.resizeNESW(deltaY, deltaX);
  } else {
    switch (cursor) {
      case 'n-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeNAspectRatioLocked(deltaY)
          : shouldResizeCenterOut
            ? crop.resizeNS(deltaY)
            : crop.resizeN(deltaY);
        break;
      case 'ne-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeNEAspectRatioLocked(deltaY, deltaX)
          : crop.resizeNE(deltaY, deltaX);
        break;
      case 'e-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeEAspectRatioLocked(deltaX)
          : shouldResizeCenterOut
            ? crop.resizeEW(deltaX)
            : crop.resizeE(deltaX);
        break;
      case 'se-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeSEAspectRatioLocked(deltaY, deltaX)
          : crop.resizeSE(deltaY, deltaX);
        break;
      case 's-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeSAspectRatioLocked(deltaY)
          : shouldResizeCenterOut
            ? crop.resizeNS(deltaY)
            : crop.resizeS(deltaY);
        break;
      case 'sw-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeSWAspectRatioLocked(deltaY, deltaX)
          : crop.resizeSW(deltaY, deltaX);
        break;
      case 'w-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeWAspectRatioLocked(deltaX)
          : shouldResizeCenterOut
            ? crop.resizeEW(deltaX)
            : crop.resizeW(deltaX);
        break;
      case 'nw-resize':
        shouldMaintainCropAspectRatio
          ? crop.resizeNWAspectRatioLocked(deltaY, deltaX)
          : crop.resizeNW(deltaY, deltaX);
        break;
    }
  }
}
export function getClickPosScaled(e: PointerEvent): number[] {
  const videoRect = appState.video.getBoundingClientRect();
  const { width, height, top, left } = videoRect;

  const clickPosX = e.clientX - left;
  const clickPosY = e.clientY - top;

  let clickPosXScaled = (clickPosX / width) * appState.settings.cropResWidth;
  let clickPosYScaled = (clickPosY / height) * appState.settings.cropResHeight;

  if (appState.rotation === 90 || appState.rotation === -90) {
    clickPosXScaled = (clickPosX / width) * appState.settings.cropResHeight;
    clickPosYScaled = (clickPosY / height) * appState.settings.cropResWidth;
  }

  return [clickPosXScaled, clickPosYScaled];
}
export function getMouseCropHoverRegion(e: PointerEvent, cropString?: string): string {
  cropString = cropString ?? getRelevantCropString();
  let [x, y, w, h] = getCropComponents(cropString);

  const [clickPosXScaled, clickPosYScaled] = getClickPosScaled(e);

  if (appState.rotation === 90) {
    [x, y, w, h] = rotateCropComponentsClockWise([x, y, w, h]);
  } else if (appState.rotation === -90) {
    [x, y, w, h] = rotateCropComponentsCounterClockWise([x, y, w, h]);
  }

  const slMultiplier = Math.min(appState.settings.cropResWidth, appState.settings.cropResHeight) / 1080;
  const sl = Math.ceil(Math.min(w, h) * slMultiplier * 0.1);
  const edgeOffset = 30 * slMultiplier;
  let cursor = '';
  let mouseCropColumn: 1 | 2 | 3 | 0 = 0;
  if (x - edgeOffset < clickPosXScaled && clickPosXScaled < x + sl) {
    mouseCropColumn = 1;
  } else if (x + sl < clickPosXScaled && clickPosXScaled < x + w - sl) {
    mouseCropColumn = 2;
  } else if (x + w - sl < clickPosXScaled && clickPosXScaled < x + w + edgeOffset) {
    mouseCropColumn = 3;
  }
  let mouseCropRow: 1 | 2 | 3 | 0 = 0;
  if (y - edgeOffset < clickPosYScaled && clickPosYScaled < y + sl) {
    mouseCropRow = 1;
  } else if (y + sl < clickPosYScaled && clickPosYScaled < y + h - sl) {
    mouseCropRow = 2;
  } else if (y + h - sl < clickPosYScaled && clickPosYScaled < y + h + edgeOffset) {
    mouseCropRow = 3;
  }

  const isMouseInCropCenter = mouseCropColumn === 2 && mouseCropRow === 2;
  const isMouseInCropN = mouseCropColumn === 2 && mouseCropRow === 1;
  const isMouseInCropNE = mouseCropColumn === 3 && mouseCropRow === 1;
  const isMouseInCropE = mouseCropColumn === 3 && mouseCropRow === 2;
  const isMouseInCropSE = mouseCropColumn === 3 && mouseCropRow === 3;
  const isMouseInCropS = mouseCropColumn === 2 && mouseCropRow === 3;
  const isMouseInCropSW = mouseCropColumn === 1 && mouseCropRow === 3;
  const isMouseInCropW = mouseCropColumn === 1 && mouseCropRow === 2;
  const isMouseInCropNW = mouseCropColumn === 1 && mouseCropRow === 1;

  if (isMouseInCropCenter) cursor = 'grab';
  if (isMouseInCropN) cursor = 'n-resize';
  if (isMouseInCropNE) cursor = 'ne-resize';
  if (isMouseInCropE) cursor = 'e-resize';
  if (isMouseInCropSE) cursor = 'se-resize';
  if (isMouseInCropS) cursor = 's-resize';
  if (isMouseInCropSW) cursor = 'sw-resize';
  if (isMouseInCropW) cursor = 'w-resize';
  if (isMouseInCropNW) cursor = 'nw-resize';

  return cursor;
}
export let isDrawingCrop = false;
export let prevNewMarkerCrop = '0:0:iw:ih';
export let initDrawCropMap: CropPoint[] | null;
export let beginDrawHandler: (e: PointerEvent) => void;
export function drawCrop() {
  if (isDrawingCrop) {
    finishDrawingCrop(true);
  } else if (appState.isCurrentChartVisible &&
    chartState.currentChartInput &&
    chartState.currentChartInput.type !== 'crop') {
    flashMessage('Please toggle off the speed chart before drawing crop', 'olive');
  } else if (isMouseManipulatingCrop) {
    flashMessage('Please finish dragging or resizing before drawing crop', 'olive');
  } else if (appState.isSettingsEditorOpen && appState.isCropOverlayVisible) {
    isDrawingCrop = true;

    ({ initCropMap: initDrawCropMap } = getCropMapProperties());
    prevNewMarkerCrop = appState.settings.newMarkerCrop;

    Crop.shouldConstrainMinDimensions = false;
    document.removeEventListener('keydown', addCropHoverListener, true);
    document.removeEventListener('pointermove', cropHoverHandler, true);
    hidePlayerControls();
    appState.hooks.cropMouseManipulation.style.removeProperty('cursor');
    appState.hooks.cropMouseManipulation.style.cursor = 'crosshair';
    beginDrawHandler = (e: PointerEvent) => { beginDraw(e); };
    appState.hooks.cropMouseManipulation.addEventListener('pointerdown', beginDrawHandler, {
      once: true,
      capture: true,
    });
    flashMessage('Begin drawing crop', 'green');
  } else {
    flashMessage(
      'Please open the global settings or a marker pair editor before drawing crop',
      'olive'
    );
  }
}
export let drawCropHandler: EventListener | null;
export let shouldFinishDrawMaintainAspectRatio = false;
export function beginDraw(e: PointerEvent) {
  if (e.button === 0 && !drawCropHandler) {
    e.preventDefault();
    appState.hooks.cropMouseManipulation.setPointerCapture(e.pointerId);

    const cropResWidth = appState.settings.cropResWidth;
    const cropResHeight = appState.settings.cropResHeight;

    const videoRect = appState.video.getBoundingClientRect();
    const clickPosX = e.clientX - videoRect.left;
    const clickPosY = e.clientY - videoRect.top;

    const [clickPosXScaled, clickPosYScaled] = getClickPosScaled(e);

    const { isDynamicCrop, enableZoomPan } = getCropMapProperties();

    let prevCrop: string;
    if (!appState.wasGlobalSettingsEditorOpen) {
      assertDefined(initDrawCropMap);
      prevCrop = initDrawCropMap[appState.currentCropPointIndex].crop;
    } else {
      prevCrop = prevNewMarkerCrop;
    }
    const shouldMaintainCropAspectRatio = ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
      (enableZoomPan && isDynamicCrop && !e.altKey);
    shouldFinishDrawMaintainAspectRatio = shouldMaintainCropAspectRatio;

    // rotate aspect ratio in rotated mode?
    let [, , prevCropW, prevCropH] = getCropComponents(prevCrop);
    if (appState.rotation === 90 || appState.rotation === -90) {
      [prevCropW, prevCropH] = [prevCropH, prevCropW];
    }

    const prevCropAspectRatio = prevCropW <= 0 || prevCropH <= 0 ? 1 : prevCropW / prevCropH;

    let crop = new Crop(
      clickPosXScaled,
      clickPosYScaled,
      Crop.minW,
      Crop.minH,
      cropResWidth,
      cropResHeight
    );

    if (appState.rotation === 90 || appState.rotation === -90) {
      // We already rotated clickPosXScaled and clickPosYScaled, so we don't need to do it again here
      crop = new Crop(
        clickPosXScaled,
        clickPosYScaled,
        Crop.minH,
        Crop.minW,
        cropResHeight,
        cropResWidth
      );
    }

    updateCropStringWithCrop(crop, false, false, initDrawCropMap ?? undefined);

    const { initCropMap: zeroCropMap } = getCropMapProperties();

    drawCropHandler = ((e: PointerEvent) => {
      const shouldMaintainCropAspectRatio = ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
        (enableZoomPan && isDynamicCrop && !e.altKey);
      shouldFinishDrawMaintainAspectRatio = shouldMaintainCropAspectRatio;
      const shouldResizeCenterOut = e.shiftKey;

      const dragPosX = e.clientX - videoRect.left;
      const changeX = dragPosX - clickPosX;
      const dragPosY = e.clientY - videoRect.top;
      const changeY = dragPosY - clickPosY;

      let changeXScaled = (changeX / videoRect.width) * cropResWidth;
      let changeYScaled = (changeY / videoRect.height) * cropResHeight;

      let crop = new Crop(
        clickPosXScaled,
        clickPosYScaled,
        Crop.minW,
        Crop.minH,
        cropResWidth,
        cropResHeight
      );

      if (appState.rotation === 90 || appState.rotation === -90) {
        changeXScaled = (changeX / videoRect.width) * cropResHeight;
        changeYScaled = (changeY / videoRect.height) * cropResWidth;
        crop = new Crop(
          clickPosXScaled,
          clickPosYScaled,
          Crop.minH,
          Crop.minW,
          cropResHeight,
          cropResWidth
        );
      }

      crop.defaultAspectRatio = prevCropAspectRatio;

      let cursor = 'default';
      if (changeXScaled >= 0 && changeYScaled < 0) cursor = 'ne-resize';
      if (changeXScaled >= 0 && changeYScaled >= 0) cursor = 'se-resize';
      if (changeXScaled < 0 && changeYScaled >= 0) cursor = 'sw-resize';
      if (changeXScaled < 0 && changeYScaled < 0) cursor = 'nw-resize';

      resizeCrop(
        crop,
        cursor,
        changeXScaled,
        changeYScaled,
        shouldMaintainCropAspectRatio,
        shouldResizeCenterOut
      );

      updateCropStringWithCrop(crop, false, false, zeroCropMap ?? undefined);
    }) as EventListener;

    document.addEventListener('pointermove', drawCropHandler);

    document.addEventListener('pointerup', endDraw, {
      once: true,
      capture: true,
    });

    // exact event listener reference only added once so remove not required
    document.addEventListener('click', blockVideoPause, {
      once: true,
      capture: true,
    });
  } else {
    finishDrawingCrop(true);
  }
}
export function endDraw(e: PointerEvent) {
  if (e.button === 0) {
    finishDrawingCrop(false, e.pointerId);
  } else {
    finishDrawingCrop(true, e.pointerId);
  }
  if (ctrlOrCommand(e)) {
    document.addEventListener('pointermove', cropHoverHandler, true);
  }
}
export function finishDrawingCrop(shouldRevertCrop: boolean, pointerId?: number) {
  Crop.shouldConstrainMinDimensions = true;

  if (pointerId != null) appState.hooks.cropMouseManipulation.releasePointerCapture(pointerId);
  appState.hooks.cropMouseManipulation.style.cursor = 'auto';
  appState.hooks.cropMouseManipulation.removeEventListener('pointerdown', beginDrawHandler, true);
  if (drawCropHandler) {
    document.removeEventListener('pointermove', drawCropHandler);
  }
  document.removeEventListener('pointerup', endDraw, true);
  drawCropHandler = null;
  isDrawingCrop = false;
  showPlayerControls();
  document.addEventListener('keydown', addCropHoverListener, true);

  if (appState.wasGlobalSettingsEditorOpen) {
    if (shouldRevertCrop) {
      appState.settings.newMarkerCrop = prevNewMarkerCrop;
    } else {
      const newCrop = transformCropWithPushBack(
        prevNewMarkerCrop,
        appState.settings.newMarkerCrop,
        shouldFinishDrawMaintainAspectRatio
      );
      appState.settings.newMarkerCrop = newCrop;
    }
    updateCropString(appState.settings.newMarkerCrop, true);
  }

  if (!appState.wasGlobalSettingsEditorOpen) {
    assertDefined(initDrawCropMap);
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    const cropMap = markerPair.cropMap;
    if (shouldRevertCrop) {
      const draft = createDraft(getMarkerPairHistory(markerPair));
      draft.cropMap = initDrawCropMap;
      saveMarkerPairHistory(draft, markerPair, false);
      renderSpeedAndCropUI();
    } else {
      const newCrop = transformCropWithPushBack(
        initDrawCropMap[appState.currentCropPointIndex].crop,
        cropMap[appState.currentCropPointIndex].crop,
        shouldFinishDrawMaintainAspectRatio
      );
      updateCropString(newCrop, true, false, initDrawCropMap);
    }
  }
  shouldRevertCrop
    ? flashMessage('Drawing crop canceled', 'red')
    : flashMessage('Finished drawing crop', 'green');
}
export function transformCropWithPushBack(
  oldCrop: string,
  newCrop: string,
  shouldMaintainCropAspectRatio = false
) {
  const [, , iw, ih] = getCropComponents(oldCrop);
  const [nx, ny, nw, nh] = getCropComponents(newCrop);
  const dw = nw - iw;
  const dh = nh - ih;
  const crop = Crop.fromCropString(getCropString(0, 0, iw, ih), appState.settings.cropRes);
  shouldMaintainCropAspectRatio ? crop.resizeSEAspectRatioLocked(dh, dw) : crop.resizeSE(dh, dw);
  crop.panX(nx);
  crop.panY(ny);
  return crop.cropString;
}
export let cropCrossHairEnabled = false;
export function toggleCropCrossHair() {
  if (cropCrossHairEnabled) {
    flashMessage('Disabled crop crosshair', 'red');
    cropCrossHairEnabled = false;
    cropOverlayElements.cropCrossHair && ((cropOverlayElements.cropCrossHair as HTMLElement).style.display = 'none');
  } else {
    flashMessage('Enabled crop crosshair', 'green');
    cropCrossHairEnabled = true;
    cropOverlayElements.cropCrossHair && ((cropOverlayElements.cropCrossHair as HTMLElement).style.display = 'block');
    renderSpeedAndCropUI(false, false);
  }
}
export function renderStaticCropOverlay(crop) {
  const [x, y, w, h] = getCropComponents(crop);

  [cropOverlayElements.cropRect, cropOverlayElements.cropRectBorderBlack, cropOverlayElements.cropRectBorderWhite].map((cropRect) => { if (cropRect) setCropOverlayDimensions(cropRect, x, y, w, h); }
  );
  if (cropCrossHairEnabled && cropOverlayElements.cropCrossHair) {
    cropOverlayElements.cropCrossHairs.map((cropCrossHair) => { setCropCrossHair(cropCrossHair, getCropString(x, y, w, h)); }
    );
    (cropOverlayElements.cropCrossHair as HTMLElement).style.stroke = 'white';
  }
}

