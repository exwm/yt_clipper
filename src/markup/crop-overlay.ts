import { appState } from './appState';
import {
  getCropComponents,
  getRotatedCropComponents,
  rotateCropComponentsClockWise,
  rotateCropComponentsCounterClockWise,
} from './crop-utils';
import { resetCropPreviewAnchor } from './crop/crop-preview';
import { isReframeCanvasActive } from './crop/video-reframe-canvas';
import { applyVideoTransform, getTransformedVideoBox } from './crop/video-transform';
import { isReframeEnabled, syncReframe } from './crop/video-zoom-controller';
import { html, render } from 'lit-html';
import {
  assertDefined,
  clampNumber,
  deleteElement,
  flashMessage,
  getCropString,
  setAttributes,
} from './util/util';
import { updateCropString } from './crop-utils';
import {
  chartState,
  renderSpeedAndCropUI,
  getCropMapProperties,
  getCurrentCropComponents,
  refreshDynamicCropOverlays,
  autoKeyCurrentCropPoint,
} from './charts';
import { updateCropStringWithCrop } from './crop-utils';
import { blockVideoPause } from './util/videoUtil';
import { getRelevantCropString } from './crop-utils';
import { showPlayerControls } from './util/videoUtil';
import { hidePlayerControls } from './util/videoUtil';
import { createDraft } from 'immer';
import { Crop } from './crop/crop';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import { CropPoint } from './@types/yt_clipper';
import { cropChartMode, currentCropChartMode } from './ui/chart/cropchart/cropChartSpec';
import { registerActiveDragCleanup } from './util/drag-recovery';

export function addCropHoverListener(e: KeyboardEvent) {
  const isCropBlockingChartVisible =
    appState.isCurrentChartVisible &&
    chartState.currentChartInput &&
    chartState.currentChartInput.type !== 'crop';
  if (
    (e.key === 'Control' || e.key === 'Meta') &&
    appState.isHotkeysEnabled &&
    !e.repeat &&
    appState.isCropOverlayVisible &&
    !isDrawingCrop &&
    !isCropBlockingChartVisible
  ) {
    document.addEventListener('pointermove', cropHoverHandler, true);
  }
}
export function removeCropHoverListener(e: KeyboardEvent) {
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

/** Returns true when the given client coords fall inside the visible crop
 *  rectangle. Used by the hints bar to scope crop-manipulation hints to
 *  "cursor over the crop" rather than "cursor anywhere on the video".
 *
 *  In dynamic-crop mode the user is manipulating ONE specific crop point
 *  at a time — the chart mode (Start/End) tells us which one. The green
 *  rect previews the section's start point; the yellow rect previews the
 *  end point. Whichever matches the current chart mode is what the user's
 *  edits actually affect, so that's the rect we hit-test against. The
 *  time-based interpolated `cropRectBorder` (dimmed in this mode) would
 *  give "cursor over the crop" hints for a region the user isn't editing,
 *  which is misleading. */
export function isMouseInsideCrop(clientX: number, clientY: number): boolean {
  const border = getActiveCropHitRect();
  if (!border) return false;
  const bbox = (border as SVGGraphicsElement).getBoundingClientRect();
  if (bbox.width === 0 || bbox.height === 0) return false;
  return (
    clientX >= bbox.left && clientX <= bbox.right && clientY >= bbox.top && clientY <= bbox.bottom
  );
}

/** Picks which crop rectangle currently represents the "active" crop for
 *  hit-testing — the time-interpolated one for static crops, or the
 *  selected point's preview (green/yellow) when dynamic-crop overlays are
 *  visible. Falls back to the time-based border if the chart-section
 *  rects haven't been laid out (e.g. before first render). */
function getActiveCropHitRect(): Element | null {
  const start = cropOverlayElements.cropChartSectionStartBorderGreen;
  const end = cropOverlayElements.cropChartSectionEndBorderYellow;
  const sectionGroup = cropOverlayElements.cropChartSectionStart as HTMLElement | null;
  const isDynamicOverlayVisible = sectionGroup?.style.display === 'block';
  if (isDynamicOverlayVisible) {
    const selected = currentCropChartMode === cropChartMode.Start ? start : end;
    if (selected) return selected;
  }
  return cropOverlayElements.cropRectBorder;
}

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
};
// Gold for the end crop section's rect border and matching crosshair, picked to stand out from the
// grey current-crop rect (plain yellow read too close to it). The start section stays lime.
export const END_CROP_SECTION_COLOR = 'rgb(241, 196, 27)';
function CropOverlayTemplate(fillOpacity: number, crossHairDisplay: string) {
  return html`
    <svg id="crop-svg">
      <defs>
        <mask id="cropMask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect id="cropRect" x="0" y="0" width="100%" height="100%" fill="black" />
        </mask>
      </defs>
      <rect
        id="cropDim"
        mask="url(#cropMask)"
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="black"
        fill-opacity=${fillOpacity}
      />

      <g id="cropChartSectionStart" opacity="0.7" shape-rendering="geometricPrecision">
        <rect
          id="cropChartSectionStartBorderGreen"
          x="0"
          y="0"
          width="0%"
          height="0%"
          fill="none"
          stroke="lime"
          stroke-width="1px"
        />
        <rect
          id="cropChartSectionStartBorderWhite"
          x="0"
          y="0"
          width="0%"
          height="0%"
          fill="none"
          stroke="black"
          stroke-width="1px"
          stroke-dasharray="5 10"
        />
      </g>
      <g id="cropChartSectionEnd" opacity="0.7" shape-rendering="geometricPrecision">
        <rect
          id="cropChartSectionEndBorderYellow"
          x="0"
          y="0"
          width="0%"
          height="0%"
          fill="none"
          stroke=${END_CROP_SECTION_COLOR}
          stroke-width="1px"
        />
        <rect
          id="cropChartSectionEndBorderWhite"
          x="0"
          y="0"
          width="0%"
          height="0%"
          fill="none"
          stroke="black"
          stroke-width="1px"
          stroke-dasharray="5 10"
        />
      </g>

      <g id="cropRectBorder" opacity="1" shape-rendering="geometricPrecision">
        <rect
          id="cropRectBorderBlack"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="none"
          stroke="black"
          stroke-width="1px"
        />
        <rect
          id="cropRectBorderWhite"
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="none"
          stroke="white"
          stroke-width="1px"
          stroke-dasharray="5 5"
        ></rect>
        <g id="cropCrossHair" opacity="0.9" stroke="white" display=${crossHairDisplay}>
          <line
            id="cropCrossHairXBlack"
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            stroke="black"
            stroke-width="1px"
            type="x"
          />
          <line
            id="cropCrossHairXWhite"
            x1="0"
            y1="50%"
            x2="100%"
            y2="50%"
            stroke-width="1px"
            stroke-dasharray="5 5"
            type="x"
          />

          <line
            id="cropCrossHairYBlack"
            x1="50%"
            y1="0"
            x2="50%"
            y2="100%"
            stroke="black"
            stroke-width="1px"
            type="y"
          />
          <line
            id="cropCrossHairYWhite"
            x1="50%"
            y1="0"
            x2="50%"
            y2="100%"
            stroke-width="1px"
            stroke-dasharray="5 5"
            type="y"
          />
        </g>
      </g>
    </svg>
  `;
}

export function createCropOverlay(cropString: string) {
  deleteCropOverlay();

  cropDiv = document.createElement('div');
  cropDiv.setAttribute('id', 'crop-div');
  render(
    CropOverlayTemplate(cropDims[cropDimIndex], cropCrossHairEnabled ? 'block' : 'none'),
    cropDiv
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
  cropOverlayElements.cropChartSectionStartBorderGreen = document.getElementById(
    'cropChartSectionStartBorderGreen'
  );
  cropOverlayElements.cropChartSectionStartBorderWhite = document.getElementById(
    'cropChartSectionStartBorderWhite'
  );
  cropOverlayElements.cropChartSectionEnd = document.getElementById('cropChartSectionEnd');
  cropOverlayElements.cropChartSectionEndBorderYellow = document.getElementById(
    'cropChartSectionEndBorderYellow'
  );
  cropOverlayElements.cropChartSectionEndBorderWhite = document.getElementById(
    'cropChartSectionEndBorderWhite'
  );

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
  [
    cropOverlayElements.cropRect,
    cropOverlayElements.cropRectBorderBlack,
    cropOverlayElements.cropRectBorderWhite,
  ].map((cropRect) => {
    setCropOverlay(cropRect, cropString);
  });
  cropOverlayElements.cropCrossHairs.map((cropCrossHair) => {
    setCropCrossHair(cropCrossHair, cropString);
  });
  appState.isCropOverlayVisible = true;
  // The overlay was just rebuilt fresh and visible; if the reframe canvas owns the display, re-hide
  // the SVG border/dim so they don't show on top of the canvas's own border and bars.
  syncCropOverlayReframeVisibility();
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
    const reframe = isReframeEnabled();
    let width: number, height: number, top: number, left: number;
    if (reframe) {
      // Use the exact transform, not getBoundingClientRect: the browser snaps a transformed
      // element's measured box to device pixels, so the outline jitters as the scaled video pans.
      ({ left, top, width, height } = getTransformedVideoBox());
    } else {
      const videoRect = appState.video.getBoundingClientRect();
      const videoContainerRect = appState.hooks.videoContainer.getBoundingClientRect();
      width = videoRect.width;
      height = videoRect.height;
      top = videoRect.top - videoContainerRect.top;
      left = videoRect.left - videoContainerRect.left;
    }
    // Keep cropDiv exact in reframe so the outline holds still; round otherwise for a crisp border.
    const styles = [width, height, top, left].map((e) => `${reframe ? e : Math.round(e)}px`);

    Object.assign(cropDiv.style, {
      width: styles[0],
      height: styles[1],
      top: styles[2],
      left: styles[3],
      position: 'absolute',
    });
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
    if (cropCrossHairEnabled && cropOverlayElements.cropCrossHair) {
      cropOverlayElements.cropCrossHairs.map((crossHair) => {
        setCropCrossHair(crossHair, cropString);
      });
    }
    // Track the section start/end overlays in dynamic crop mode through the same
    // re-layout, so they rotate/resize with the main crop instead of lagging.
    refreshDynamicCropOverlays();
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

  const [widthPx, heightPx, topPx, leftPx] = [width, height, top, left].map(
    (e) => `${Math.round(e)}px`
  );
  // The fit only changes on resize/rotation/theater, but this runs every frame via the
  // reframe overlay re-layout. Writing these layout properties dirties layout, which
  // turns the surrounding getBoundingClientRect/offsetWidth reads into full reflows
  // (layout thrash) and stutters the per-frame crop preview. Skip the write when nothing
  // changed — comparing the already-applied inline styles is a cheap string read, not a
  // layout read.
  const style = appState.video.style;
  if (
    style.width !== widthPx ||
    style.height !== heightPx ||
    style.top !== topPx ||
    style.left !== leftPx ||
    style.position !== 'absolute'
  ) {
    Object.assign(style, {
      width: widthPx,
      height: heightPx,
      top: topPx,
      left: leftPx,
      position: 'absolute',
    });
  }
  // Re-apply the composed rotation+zoom transform against the (possibly unchanged) fit.
  applyVideoTransform();
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
    const [x1M, x2M, y1M, y2M] =
      cropCrossHair.getAttribute('type') === 'x' ? [0, 1, 0.5, 0.5] : [0.5, 0.5, 0, 1];

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
export const cropDims = [0, 0.25, 0.5, 0.75, 1];
export let cropDimIndex = 2;
// Reframe keeps its own dim preference: the area outside the crop is the black
// reframe, so it defaults to fully opaque (100%) and only offers near-opaque steps —
// below 100% the surrounding video shows faintly through the bars (see syncReframe).
export const reframeCropDims = [0.8, 0.9, 1];
export let reframeCropDimIndex = 2;

/** Outside-crop dim opacity (0..1) for the active mode. */
export function getCropDimOpacity(): number {
  return isReframeEnabled() ? reframeCropDims[reframeCropDimIndex] : cropDims[cropDimIndex];
}
/** Push the active mode's dim onto the overlay rect (clip handling lives in reframe). */
export function applyActiveCropDimOpacity(): void {
  if (cropDim) cropDim.setAttribute('fill-opacity', getCropDimOpacity().toString());
}
/** Show/hide the SVG dim rect. Hidden while the reframe canvas is active (it draws its own bars). */
export function setCropDimVisible(visible: boolean): void {
  if (cropDim) (cropDim as unknown as SVGElement).style.display = visible ? '' : 'none';
}
/** Show/hide the SVG crop-rect border group (border lines + crosshair). The reframe canvas draws
 *  the border itself, so the SVG one is hidden; otherwise it tracks the snapped element box and
 *  shimmers as the video pans. */
export function setSvgCropBorderHidden(hidden: boolean): void {
  const el = cropOverlayElements.cropRectBorder as unknown as SVGElement | null;
  if (el) el.style.display = hidden ? 'none' : '';
}
/** Show/hide just the current-time crop rect's border lines, not the whole cropRectBorder group, so
 *  the crosshair stays visible: in a dynamic crop the crosshair tracks the selected start/end point
 *  and should remain even when the redundant current-time rect is hidden. */
export function setCurrentCropRectVisible(visible: boolean): void {
  const opacity = visible ? '1' : '0';
  for (const line of [
    cropOverlayElements.cropRectBorderBlack,
    cropOverlayElements.cropRectBorderWhite,
  ]) {
    if (line) (line as HTMLElement).style.opacity = opacity;
  }
}
/** Re-assert reframe-driven overlay visibility after the SVG overlay is (re)built. The reframe
 *  canvas draws its own border and black bars, so the SVG border + dim must stay hidden while it
 *  owns the display. createCropOverlay rebuilds them fresh and visible (on pair switch / global
 *  settings), so this has to run after each rebuild or a stale border and dim show over the canvas.
 *  Outside reframe it just restores the normal visible border/dim the template already produces. */
export function syncCropOverlayReframeVisibility(): void {
  const reframeCanvasOwnsDisplay = isReframeCanvasActive();
  setSvgCropBorderHidden(reframeCanvasOwnsDisplay);
  setCropDimVisible(!reframeCanvasOwnsDisplay);
  applyActiveCropDimOpacity();
}
export function cycleCropDimOpacity() {
  if (isReframeEnabled()) {
    reframeCropDimIndex = (reframeCropDimIndex + 1) % reframeCropDims.length;
  } else {
    cropDimIndex = (cropDimIndex + 1) % cropDims.length;
  }
  applyActiveCropDimOpacity();
  if (isReframeEnabled()) {
    // In reframe the dim level also decides whether the video is clipped to the crop
    // (100% = solid black) or left visible behind the dim (<100%), so re-sync the preview.
    syncReframe(getCurrentCropComponents());
  } else {
    // The current-time crop rect shows only when the dim is off (otherwise the dim cut-out already
    // marks the current crop), so re-evaluate its visibility for the new dim. Paused, nothing else would.
    refreshDynamicCropOverlays();
  }
}
/** Active crop dim opacity as a whole percent for the bar badge. */
export function getCropDimOpacityPercent(): number {
  return Math.round(getCropDimOpacity() * 100);
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
/** Discriminates the current manipulation mode so the hints bar can show
 *  drag-specific vs resize-specific modifier chips. Set when manipulation
 *  begins, cleared on end. Null when not manipulating. */
export let cropManipulationKind: 'drag' | 'resize' | null = null;
/** Setters so an alternate manipulation surface (the zoom minimap in reframe
 *  mode) can flag a crop manipulation, making the overlays/preview follow the
 *  edited point exactly like a manipulation on the video itself. */
export function setIsMouseManipulatingCrop(value: boolean): void {
  isMouseManipulatingCrop = value;
}
export function setCropManipulationKind(kind: 'drag' | 'resize' | null): void {
  cropManipulationKind = kind;
}
/** The crop string the currently-edited point should be reverted to if a
 *  mid-drag `Alt + A` adds a new keyframe. Initially set to the
 *  dragged point's crop at drag start, then *re-set on each Alt + A* to
 *  the live crop value the new keyframe inherits — so a subsequent
 *  Alt + A reverts the just-added point to *its* drop position rather
 *  than all the way back to the drag's original point. Without this
 *  per-keyframe update, every prior keyframe except the very last would
 *  collapse to the original p0 crop. `null` when no drag is active. */
export let cropDragStartCropString: string | null = null;
export function setCropDragStartCropString(value: string | null): void {
  cropDragStartCropString = value;
}
/** True for the brief window between a mid-drag `Alt + A` keypress and
 *  the user actually releasing Alt. While set, `processDragCrop` ignores
 *  `e.altKey` for the Y-axis lock — without this, the Alt held to fire
 *  the Alt + A hotkey accidentally engages "horizontal-only panning"
 *  for a frame or two and the drag visibly stutters. Auto-clears on the
 *  first pointermove that arrives without Alt held, so an intentional
 *  Alt re-press after the hotkey window still engages the lock. */
let suppressAltLockUntilRelease = false;
export function suppressNextAltLock(): void {
  suppressAltLockUntilRelease = true;
}
/** Callback installed at drag-start that re-fetches the drag's
 *  `initCropMap` snapshot from the current marker pair state. Called
 *  from `addCropPoint` after a mid-drag insertion so subsequent
 *  pointermove ticks see a snapshot that includes the new point —
 *  otherwise `updateCropString` looks up the new point's index in the
 *  pre-insert snapshot and throws "Init crop undefined" silently inside
 *  requestAnimationFrame, freezing the drag. `null` when no drag is
 *  active. */
export let refreshCropDragInitState: (() => void) | null = null;
export let endCropMouseManipulation: (e, forceEndDrag?: boolean) => void;
export function ctrlOrCommand(e: PointerEvent) {
  return e.ctrlKey || e.metaKey;
}

/** Lazy-enable zoompan for the current pair the first time a per-keyframe zoom happens in
 *  reframe on a dynamic crop. Without it a size change propagates to every keyframe
 *  (the pan-only invariant), so the auto-keyed zoom wouldn't stick to just this moment.
 *  Turning zoompan ON is lossless (no size collapse); applied with `storeHistory: false`
 *  so it folds into the gesture's own undo step. No-op outside reframe, on a static
 *  crop, or once already enabled. */
export function ensureReframeZoomPan(): void {
  if (!isReframeEnabled() || appState.wasGlobalSettingsEditorOpen) return;
  const { isDynamicCrop, enableZoomPan } = getCropMapProperties();
  if (!isDynamicCrop || enableZoomPan) return;
  const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
  if (!markerPair) return;
  const draft = createDraft(getMarkerPairHistory(markerPair));
  draft.enableZoomPan = true;
  saveMarkerPairHistory(draft, markerPair, false);
  flashMessage('Zoompan on: each keyframe keeps its own zoom in reframe', 'olive');
}

const CROP_SCALE_MIN_DIM = 16;
/**
 * Scale the current crop around its centre by `factor`, AR-preserving and clamped to the crop
 * resolution. Reads and writes the stored crop directly in source coords (undo-aware): scaling
 * about the centre is rotation-agnostic, so it must NOT go through `updateCropStringWithCrop`,
 * whose write rotates the crop (a double-transform under a rotated preview). Shared by the reframe
 * Ctrl+wheel zoom and the mid-pan wheel-zoom. Returns the new [x, y, w, h] in cropRes coords.
 */
export function scaleCropAroundCenter(
  factor: number,
  initCropMap?: CropPoint[]
): [number, number, number, number] {
  // A reframe wheel-zoom is a per-keyframe zoom, so switch to zoompan before writing through.
  ensureReframeZoomPan();
  const cropResWidth = appState.settings.cropResWidth;
  const cropResHeight = appState.settings.cropResHeight;
  const [curX, curY, curW, curH] = getCropComponents(getRelevantCropString());

  const aspectRatio = curW / curH;
  let newW = Math.round(curW * factor);
  newW = clampNumber(newW, CROP_SCALE_MIN_DIM, cropResWidth);
  let newH = Math.round(newW / aspectRatio);
  newH = clampNumber(newH, CROP_SCALE_MIN_DIM, cropResHeight);
  // If H clamp forced an AR drift, pull W back so AR is preserved.
  if (Math.abs(newW / newH - aspectRatio) > 1e-3) {
    newW = Math.round(newH * aspectRatio);
    newW = clampNumber(newW, CROP_SCALE_MIN_DIM, cropResWidth);
  }

  const centerX = curX + curW / 2;
  const centerY = curY + curH / 2;
  let newX = Math.round(centerX - newW / 2);
  let newY = Math.round(centerY - newH / 2);
  newX = clampNumber(newX, 0, Math.max(0, cropResWidth - newW));
  newY = clampNumber(newY, 0, Math.max(0, cropResHeight - newH));

  const crop = new Crop(newX, newY, newW, newH, cropResWidth, cropResHeight);
  // Write directly in source coords, not updateCropStringWithCrop, which rotates on write.
  updateCropString(crop.cropString, false, false, initCropMap ?? undefined);
  return [newX, newY, newW, newH];
}

// Reframe Ctrl+wheel crop zoom: a small per-tick scale, with the wheel burst committed
// as a single undo step once the wheel goes idle.
const CROP_WHEEL_ZOOM_STEP = 1.06;
let cropWheelCommitTimer = 0;
/** Reframe: zoom the crop (scale around its centre) with Ctrl+wheel, without grabbing
 *  it. Auto-keys at the current time like a manipulation; the scales mutate live state
 *  (no per-tick history) and a short idle debounce commits the whole burst as one undo. */
export function reframeWheelZoomCrop(deltaY: number): void {
  autoKeyCurrentCropPoint();
  const initCropMap = getCropMapProperties().initCropMap ?? undefined;
  if (!initCropMap) return;
  // Wheel up (deltaY < 0) zooms IN → tighter crop; wheel down zooms out.
  const factor = deltaY < 0 ? 1 / CROP_WHEEL_ZOOM_STEP : CROP_WHEEL_ZOOM_STEP;
  scaleCropAroundCenter(factor, initCropMap);
  if (cropWheelCommitTimer) clearTimeout(cropWheelCommitTimer);
  cropWheelCommitTimer = window.setTimeout(() => {
    cropWheelCommitTimer = 0;
    if (appState.wasGlobalSettingsEditorOpen) return;
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    if (markerPair) {
      saveMarkerPairHistory(createDraft(getMarkerPairHistory(markerPair)), markerPair);
    }
  }, 300);
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
    const isCropBlockingChartVisible =
      appState.isCurrentChartVisible &&
      chartState.currentChartInput &&
      chartState.currentChartInput.type !== 'crop';
    if (
      ctrlOrCommand(e) &&
      appState.isSettingsEditorOpen &&
      appState.isCropOverlayVisible &&
      !isDrawingCrop &&
      !isCropBlockingChartVisible
    ) {
      // Reframe auto-key: the playhead is the selection. Pause and select (or
      // create) the keyframe at the current time BEFORE reading the crop below,
      // so the drag edits that point.
      if (isReframeEnabled()) autoKeyCurrentCropPoint();
      const cropString = getRelevantCropString();
      // Mutable so the wheel-zoom-during-pan handler can re-baseline
      // them on each tick — the pan formula computes
      // `crop = Crop(ix, iy, iw, ih) + cursor_delta_from_clickPos`, so
      // after a zoom updates the crop's origin/size the pan must
      // continue from the new state instead of jumping back.
      let [ix, iy, iw, ih] = getCropComponents(cropString);
      const cropResWidth = appState.settings.cropResWidth;
      const cropResHeight = appState.settings.cropResHeight;
      const videoRect = appState.video.getBoundingClientRect();
      let clickPosX = e.clientX - videoRect.left;
      let clickPosY = e.clientY - videoRect.top;
      const cursor = getMouseCropHoverRegion(e, cropString);
      const pointerId = e.pointerId;

      // Reframe: an edge-resize on a dynamic crop is a per-keyframe zoom — switch the
      // pair to zoompan before the `enableZoomPan` capture below (which drives the resize
      // AR math) so the size lands on this keyframe, not every keyframe. Pans are mode-
      // agnostic, so leave a plain drag alone.
      if (cursor !== 'grab') ensureReframeZoomPan();

      const { isDynamicCrop, enableZoomPan } = getCropMapProperties();
      // Mutable so a mid-drag `Alt + A` (rapid-keyframe workflow in
      // `addCropPoint`) can refresh it to the post-insert snapshot via
      // `refreshCropDragInitState` below — otherwise `updateCropString`
      // looks up the new point's index in a stale snapshot and throws,
      // which silently breaks the drag from that frame on.
      let initCropMap = getCropMapProperties().initCropMap;

      let pendingCropDragEvent: PointerEvent | null = null;
      let cropDragRafId = 0;
      let pendingCropResizeEvent: PointerEvent | null = null;
      let cropResizeRafId = 0;
      // Edge auto-pan (reframe): when the cursor pins against a monitor edge, a rAF
      // loop keeps advancing a virtual cursor (`autoPanOffset`) at the cursor's last
      // in-screen speed, so the crop keeps moving/resizing past where the real cursor
      // can reach and the reframe view follows. The offset is folded into every drag
      // delta.
      let autoPanOffsetX = 0;
      let autoPanOffsetY = 0;
      let autoPanRafId = 0;
      let lastManipEvent: PointerEvent | null = null;
      let autoPanPrevClientX = 0; // cursor position last tick, to derive its velocity
      let autoPanPrevClientY = 0;
      let autoPanVelX = 0; // last per-frame velocity while actually moving (px/frame)
      let autoPanVelY = 0;
      // The captured-target element receives every pointer event for this
      // drag while capture is held — including the spec-mandated
      // `pointercancel` if the browser implicitly releases capture
      // (devtools, alt-tab, OS pointer reassignment, etc.). Stash it as a
      // local const so `endCropMouseManipulation` removes listeners from the
      // exact element they were attached to even if the appState hook were
      // swapped out mid-drag (defensive — shouldn't happen, but cheap).
      const captureTarget = appState.hooks.cropMouseManipulation;
      let unregisterDragRecovery: () => void = () => {};

      endCropMouseManipulation = (e: PointerEvent, forceEnd = false) => {
        if (forceEnd) {
          captureTarget.removeEventListener('pointerup', endCropMouseManipulation, {
            capture: true,
          });
          captureTarget.removeEventListener('pointercancel', endCropMouseManipulation, {
            capture: true,
          });
        }
        unregisterDragRecovery();
        isMouseManipulatingCrop = false;
        cropManipulationKind = null;
        cropDragStartCropString = null;
        refreshCropDragInitState = null;
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
        if (autoPanRafId) cancelAnimationFrame(autoPanRafId);
        autoPanRafId = 0;
        autoPanOffsetX = 0;
        autoPanOffsetY = 0;
        autoPanVelX = 0;
        autoPanVelY = 0;
        lastManipEvent = null;

        if (captureTarget.hasPointerCapture(pointerId)) {
          captureTarget.releasePointerCapture(pointerId);
        }

        if (!appState.wasGlobalSettingsEditorOpen) {
          const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
          const draft = createDraft(getMarkerPairHistory(markerPair));
          saveMarkerPairHistory(draft, markerPair);
        }

        renderSpeedAndCropUI();

        captureTarget.removeEventListener('pointermove', dragCropHandler);
        captureTarget.removeEventListener('pointermove', cropResizeHandler);
        captureTarget.removeEventListener('wheel', cropPanZoomHandler);

        showPlayerControls();
        if (!forceEnd && e && ctrlOrCommand(e)) {
          if (cursor) captureTarget.style.cursor = cursor;
          updateCropHoverCursor(e);
          document.addEventListener('pointermove', cropHoverHandler, true);
        } else {
          captureTarget.style.removeProperty('cursor');
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

      // Rapid-keyframe workflow setup, shared by both pan (drag) and
      // resize. Snapshot the manipulated point's crop at the start so a
      // mid-manipulation `Alt + A` can revert it while assigning the
      // live-moved value to the new keyframe. Install the init-map
      // refresh callback so the next pointermove after an Alt + A sees
      // a snapshot that includes the new point. Both are cleared in
      // endCropMouseManipulation. For resize the resulting per-keyframe
      // variation only shows up in zoompan mode (pan-only mode keeps
      // W/H equal across all points by mode invariant, so the revert is
      // harmless but doesn't add per-keyframe variation).
      cropDragStartCropString = cropString;
      refreshCropDragInitState = () => {
        initCropMap = getCropMapProperties().initCropMap;
      };

      if (cursor === 'grab') {
        cropManipulationKind = 'drag';
        captureTarget.style.cursor = 'grabbing';
        captureTarget.addEventListener('pointermove', dragCropHandler);
        // Wheel zoom during pan-drag: scale the crop around the cursor.
        // `passive: false` lets us preventDefault to suppress page
        // scroll while the user is mid-gesture. Rotation isn't handled
        // (cursor coords would need rotation-mapping); the gesture is a
        // no-op in that mode so it can't produce a wrong crop.
        captureTarget.addEventListener('wheel', cropPanZoomHandler, { passive: false });
      } else {
        cropManipulationKind = 'resize';
        cropResizeHandler = (e: PointerEvent) => {
          pendingCropResizeEvent = e;
          lastManipEvent = e;
          if (!cropResizeRafId) {
            cropResizeRafId = requestAnimationFrame(processResizeCrop);
          }
        };
        captureTarget.addEventListener('pointermove', cropResizeHandler);
      }

      captureTarget.addEventListener('pointerup', endCropMouseManipulation, {
        once: true,
        capture: true,
      });
      // Mirror pointerup with pointercancel: when the browser implicitly
      // releases pointer capture (devtools panel grabbing focus, OS
      // reassigning pointer ownership), pointerup will not fire on the
      // captured target but pointercancel will. Both must run the same
      // teardown so the user never gets stuck in a manipulating state.
      captureTarget.addEventListener(
        'pointercancel',
        (ev: Event) => endCropMouseManipulation(ev as PointerEvent, true),
        {
          once: true,
          capture: true,
        }
      );
      // Belt-and-suspenders: window.blur / tab-hidden recovery. Some
      // sequences (rapid alt-tab on Windows, certain devtools docking
      // transitions) drop both pointerup and pointercancel for the
      // captured target — this is the last-resort cleanup so the state
      // can never permanently stick.
      unregisterDragRecovery = registerActiveDragCleanup(() => {
        endCropMouseManipulation(null as unknown as PointerEvent, true);
      });

      hidePlayerControls();
      isMouseManipulatingCrop = true;

      // In reframe the view follows the crop, so auto-panning the crop also scrolls
      // the view — letting the user reach the frame extremes without re-grabbing when
      // the cursor hits the window edge.
      if (isReframeEnabled()) {
        autoPanPrevClientX = e.clientX;
        autoPanPrevClientY = e.clientY;
        autoPanRafId = requestAnimationFrame(autoPanTick);
      }

      // Auto-pan only continues a drag that has pinned (stopped) against a monitor
      // edge it was travelling toward, carrying its last in-screen speed — so it
      // moves at the same rate as when the cursor was inside the screen.
      function autoPanTick() {
        autoPanRafId = 0;
        if (!isMouseManipulatingCrop) return; // stop only when the drag ends
        if (lastManipEvent) {
          const ev = lastManipEvent;
          const frameVelX = ev.clientX - autoPanPrevClientX;
          const frameVelY = ev.clientY - autoPanPrevClientY;
          autoPanPrevClientX = ev.clientX;
          autoPanPrevClientY = ev.clientY;
          // Remember the live drag speed while the cursor is actually moving.
          if (Math.abs(frameVelX) >= 1) autoPanVelX = frameVelX;
          if (Math.abs(frameVelY) >= 1) autoPanVelY = frameVelY;

          // Edge of the browser viewport, not the monitor: clientX/innerWidth share one coordinate
          // frame, so this is robust to multi-monitor and OS display scaling (screenX vs availWidth
          // would auto-pan across an entire secondary monitor).
          const EDGE = 4; // px from the viewport edge
          const viewportW = window.innerWidth;
          const viewportH = window.innerHeight;
          let panX = 0;
          let panY = 0;
          if (Math.abs(frameVelX) < 1) {
            if (ev.clientX <= EDGE && autoPanVelX < 0) panX = autoPanVelX;
            else if (ev.clientX >= viewportW - EDGE && autoPanVelX > 0) panX = autoPanVelX;
          }
          if (Math.abs(frameVelY) < 1) {
            if (ev.clientY <= EDGE && autoPanVelY < 0) panY = autoPanVelY;
            else if (ev.clientY >= viewportH - EDGE && autoPanVelY > 0) panY = autoPanVelY;
          }
          if (panX !== 0 || panY !== 0) {
            const before = getRelevantCropString();
            autoPanOffsetX += panX;
            autoPanOffsetY += panY;
            // Re-run the active handler with the advanced virtual cursor.
            if (cropManipulationKind === 'drag') {
              pendingCropDragEvent = ev;
              processDragCrop();
            } else {
              pendingCropResizeEvent = ev;
              processResizeCrop();
            }
            // If the crop didn't change (clamped at the frame bound), don't keep
            // growing the offset — otherwise it overshoots and reversing wouldn't
            // respond until that overshoot is burned off.
            if (getRelevantCropString() === before) {
              autoPanOffsetX -= panX;
              autoPanOffsetY -= panY;
            }
          }
        }
        autoPanRafId = requestAnimationFrame(autoPanTick); // keep ticking the whole drag
      }

      function dragCropHandler(e: PointerEvent) {
        pendingCropDragEvent = e;
        lastManipEvent = e;
        if (!cropDragRafId) {
          cropDragRafId = requestAnimationFrame(processDragCrop);
        }
      }

      /** Cursor-anchored wheel-zoom during a pan-drag. Scales the crop
       *  so the pixel under the cursor keeps the same relative position
       *  within the box — mirroring how image viewers, Figma, and maps
       *  handle wheel-zoom, and preserving the "grip" the user
       *  established when they started the pan-drag. Each tick rewrites
       *  `ix/iy/iw/ih` + `clickPosX/Y` so subsequent pointermoves
       *  continue panning from the new state instead of jumping back to
       *  the original size. In pan-only mode the new W/H propagates to
       *  every other point via `setCropComponentForAllPoints`
       *  (mode invariant); in zoompan mode only the current point's
       *  dimensions change. */
      function cropPanZoomHandler(e: WheelEvent) {
        if (e.deltaY === 0) return;
        e.preventDefault();
        // Rotation handling would require mapping cursor coords
        // through the rotation matrix on every tick; skip to avoid
        // delivering a subtly wrong crop in those modes.
        if (appState.rotation !== 0) return;

        const ZOOM_STEP = 1.05;
        const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;

        const cursorX = e.clientX - videoRect.left;
        const cursorY = e.clientY - videoRect.top;

        // Reads the CURRENT crop (mid-pan), AR-preserving center-out scale,
        // writes through `updateCropStringWithCrop`. Using the closure
        // `ix/iy/iw/ih` would anchor the zoom to the drag-start crop and snap
        // back on the first wheel tick, so the helper reads live state instead.
        const [newX, newY, newW, newH] = scaleCropAroundCenter(factor, initCropMap ?? undefined);

        // Re-baseline the pan formula so subsequent pointermoves
        // continue from the just-zoomed crop, and snap the click anchor
        // to the current cursor so accumulated pan delta is zero at
        // this instant. (`ix/iy/iw/ih` are the pan formula's origin —
        // pan computes `crop = Crop(ix..ih) + (cursor - clickPos)`.)
        ix = newX;
        iy = newY;
        iw = newW;
        ih = newH;
        clickPosX = cursorX;
        clickPosY = cursorY;
      }

      function processDragCrop() {
        cropDragRafId = 0;
        const e = pendingCropDragEvent;
        pendingCropDragEvent = null;
        if (!e) return;

        // The Alt key briefly stays held while the user finishes the
        // Alt + A hotkey, so honour `suppressAltLockUntilRelease`: skip
        // the Y-axis lock until the user releases Alt at least once,
        // then resume normal modifier semantics for any later re-press.
        if (!e.altKey) suppressAltLockUntilRelease = false;
        const shouldMaintainCropX = e.shiftKey;
        const shouldMaintainCropY = e.altKey && !suppressAltLockUntilRelease;

        const dragPosX = e.clientX + autoPanOffsetX - videoRect.left;
        const dragPosY = e.clientY + autoPanOffsetY - videoRect.top;
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
        const shouldMaintainCropAspectRatio =
          ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
          (enableZoomPan && isDynamicCrop && !e.altKey);

        // The screen delta is pan-independent (the grab-time `videoRect.left/top`
        // cancels in `dragPos - clickPos`), but scale it by the LIVE video size so
        // the crop edge keeps tracking the cursor when the view zooms mid-resize
        // (reframe). When the view is static this equals `videoRect`.
        const liveRect = appState.video.getBoundingClientRect();
        const dragPosX = e.clientX + autoPanOffsetX - videoRect.left;
        const changeX = dragPosX - clickPosX;
        const dragPosY = e.clientY + autoPanOffsetY - videoRect.top;
        const changeY = dragPosY - clickPosY;
        let changeXScaled = (changeX / liveRect.width) * appState.settings.cropResWidth;
        let changeYScaled = (changeY / liveRect.height) * appState.settings.cropResHeight;

        const shouldResizeCenterOut = e.shiftKey;
        let crop = new Crop(ix, iy, iw, ih, cropResWidth, cropResHeight);

        if (appState.rotation === 90) {
          changeXScaled = (changeX / liveRect.width) * cropResHeight;
          changeYScaled = (changeY / liveRect.height) * cropResWidth;
          crop = new Crop(cropResHeight - iy - ih, ix, ih, iw, cropResHeight, cropResWidth);
        } else if (appState.rotation === -90) {
          changeXScaled = Math.round((changeX / liveRect.width) * cropResHeight);
          changeYScaled = Math.round((changeY / liveRect.height) * cropResWidth);
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

  // Resize-edge bands (cropRes units). `inner` is how far inside the edge still
  // resizes; `outer` how far outside still resizes (so you can grab from just past the
  // edge). Normal mode: a fraction of the crop with a small outer margin. Reframe:
  // the crop is blown up to fill the player, so a crop-fraction band reads as a huge
  // on-screen strip — instead use a fixed ~12px on-screen handle, converted to cropRes
  // via the live display scale and split evenly inside/outside each edge so it stays a
  // thin handle grabbable from just inside or just outside (e.g. into a reframe bar).
  let innerX: number, outerX: number, innerY: number, outerY: number;
  if (isReframeEnabled()) {
    const REFRAME_EDGE_BAND_PX = 12;
    const videoRect = appState.video.getBoundingClientRect();
    const rotated = appState.rotation === 90 || appState.rotation === -90;
    const cropResX = rotated ? appState.settings.cropResHeight : appState.settings.cropResWidth;
    const cropResY = rotated ? appState.settings.cropResWidth : appState.settings.cropResHeight;
    innerX = outerX = (REFRAME_EDGE_BAND_PX / Math.max(videoRect.width, 1)) * cropResX;
    innerY = outerY = (REFRAME_EDGE_BAND_PX / Math.max(videoRect.height, 1)) * cropResY;
  } else {
    const slMultiplier =
      Math.min(appState.settings.cropResWidth, appState.settings.cropResHeight) / 1080;
    innerX = innerY = Math.ceil(Math.min(w, h) * slMultiplier * 0.1);
    outerX = outerY = 30 * slMultiplier;
  }

  let cursor = '';
  let mouseCropColumn: 1 | 2 | 3 | 0 = 0;
  if (x - outerX < clickPosXScaled && clickPosXScaled < x + innerX) {
    mouseCropColumn = 1;
  } else if (x + innerX < clickPosXScaled && clickPosXScaled < x + w - innerX) {
    mouseCropColumn = 2;
  } else if (x + w - innerX < clickPosXScaled && clickPosXScaled < x + w + outerX) {
    mouseCropColumn = 3;
  }
  let mouseCropRow: 1 | 2 | 3 | 0 = 0;
  if (y - outerY < clickPosYScaled && clickPosYScaled < y + innerY) {
    mouseCropRow = 1;
  } else if (y + innerY < clickPosYScaled && clickPosYScaled < y + h - innerY) {
    mouseCropRow = 2;
  } else if (y + h - innerY < clickPosYScaled && clickPosYScaled < y + h + outerY) {
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
/** Active drag-recovery unregister for the in-flight draw, if any. Reset
 *  to a noop after `finishDrawingCrop` runs so multiple finish-calls are
 *  idempotent. */
let unregisterDrawRecovery: () => void = () => {};
export function drawCrop() {
  if (isDrawingCrop) {
    finishDrawingCrop(true);
  } else if (
    appState.isCurrentChartVisible &&
    chartState.currentChartInput &&
    chartState.currentChartInput.type !== 'crop'
  ) {
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
    beginDrawHandler = (e: PointerEvent) => {
      beginDraw(e);
    };
    appState.hooks.cropMouseManipulation.addEventListener('pointerdown', beginDrawHandler, {
      once: true,
      capture: true,
    });
    // Cover both the "armed but pre-click" window and the active-drag
    // window with the same recovery cleanup. If the user alt-tabs while
    // the cursor is the crosshair but no draw has started, or alt-tabs
    // mid-drag, `finishDrawingCrop(true)` reverts to the previous crop
    // and detaches every listener this code path attached.
    unregisterDrawRecovery = registerActiveDragCleanup(() => {
      finishDrawingCrop(true);
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
    const shouldMaintainCropAspectRatio =
      ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
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
      const shouldMaintainCropAspectRatio =
        ((!enableZoomPan || !isDynamicCrop) && e.altKey) ||
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

    // Attach to the captured target so the browser-implicit
    // `pointercancel` (devtools focus, alt-tab, OS pointer reassignment)
    // is reliably delivered to the same element our listeners live on.
    // The earlier `setPointerCapture` call routes every subsequent
    // pointer event for this pointer here regardless of cursor position.
    appState.hooks.cropMouseManipulation.addEventListener('pointermove', drawCropHandler);

    appState.hooks.cropMouseManipulation.addEventListener('pointerup', endDraw, {
      once: true,
      capture: true,
    });
    // Mirror pointerup with pointercancel — see the matching drag/resize
    // handler for the rationale.
    appState.hooks.cropMouseManipulation.addEventListener('pointercancel', endDrawOnCancel, {
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
/** Pointercancel companion for `endDraw`. The browser fires this when it
 *  releases pointer capture without a normal pointerup — we revert the
 *  in-progress draw rather than committing it (the user didn't choose to
 *  finalize). */
function endDrawOnCancel(e: Event): void {
  finishDrawingCrop(true, (e as PointerEvent).pointerId);
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

  unregisterDrawRecovery();
  unregisterDrawRecovery = () => {};
  if (pointerId != null && appState.hooks.cropMouseManipulation.hasPointerCapture?.(pointerId)) {
    appState.hooks.cropMouseManipulation.releasePointerCapture(pointerId);
  }
  appState.hooks.cropMouseManipulation.style.cursor = 'auto';
  appState.hooks.cropMouseManipulation.removeEventListener('pointerdown', beginDrawHandler, true);
  if (drawCropHandler) {
    appState.hooks.cropMouseManipulation.removeEventListener('pointermove', drawCropHandler);
  }
  appState.hooks.cropMouseManipulation.removeEventListener('pointerup', endDraw, true);
  appState.hooks.cropMouseManipulation.removeEventListener('pointercancel', endDrawOnCancel, true);
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
  cropCrossHairEnabled = !cropCrossHairEnabled;
  flashMessage(
    cropCrossHairEnabled ? 'Enabled crop crosshair' : 'Disabled crop crosshair',
    cropCrossHairEnabled ? 'green' : 'red'
  );
  if (cropOverlayElements.cropCrossHair) {
    (cropOverlayElements.cropCrossHair as HTMLElement).style.display = cropCrossHairEnabled
      ? 'block'
      : 'none';
  }
  if (cropCrossHairEnabled) {
    // Position the SVG crosshair on the current crop; this also redraws the reframe canvas via the
    // syncReframe at the end of renderSpeedAndCropUI.
    renderSpeedAndCropUI(false, false);
  } else if (isReframeEnabled()) {
    // In reframe the crosshair is drawn on the canvas, not the SVG; paused, the rVFC loop is idle, so
    // redraw now or disabling it wouldn't take effect until playback.
    syncReframe(getCurrentCropComponents());
  }
}
export function renderStaticCropOverlay(crop) {
  const [x, y, w, h] = getCropComponents(crop);

  // A static crop has only this one rect, so restore its visibility in case a prior dynamic crop hid
  // it (the current-time rect is dropped while the start/end section rects are up).
  setCurrentCropRectVisible(true);

  [
    cropOverlayElements.cropRect,
    cropOverlayElements.cropRectBorderBlack,
    cropOverlayElements.cropRectBorderWhite,
  ].map((cropRect) => {
    if (cropRect) setCropOverlayDimensions(cropRect, x, y, w, h);
  });
  if (cropCrossHairEnabled && cropOverlayElements.cropCrossHair) {
    cropOverlayElements.cropCrossHairs.map((cropCrossHair) => {
      setCropCrossHair(cropCrossHair, getCropString(x, y, w, h));
    });
    (cropOverlayElements.cropCrossHair as HTMLElement).style.stroke = 'white';
  }
}
