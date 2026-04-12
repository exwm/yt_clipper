import { easeCubicInOut } from 'd3-ease';
import { MarkerPair } from './@types/yt_clipper';
import { appState } from './appState';
import { toggleCropPreviewGammaPreview } from './crop/crop-preview';
import {
  getShortestActiveMarkerPair,
  toggleMarkerPairSpeedPreview,
  getIsSpeedPreviewOn,
  getIsMarkerLoopPreviewOn,
  toggleMarkerPairLoop,
} from './speed';
import { flashMessage, safeSetInnerHtml } from './util/util';
import { prevGammaVal, setPrevGammaVal } from './util/previewGamma';

let gammaFilterDiv: HTMLDivElement;
let gammaR: SVGFEFuncRElement;
let gammaG: SVGFEFuncGElement;
let gammaB: SVGFEFuncBElement;
let gammaFilterSvg: SVGSVGElement;

export function toggleGammaPreview() {
  if (!gammaFilterDiv) {
    gammaFilterDiv = document.createElement('div');
    gammaFilterDiv.setAttribute('id', 'gamma-filter-div');
    safeSetInnerHtml(
      gammaFilterDiv,
      `
      <svg id="gamma-filter-svg" xmlns="http://www.w3.org/2000/svg" width="0" height="0">
        <defs>
          <filter id="gamma-filter">
            <feComponentTransfer id="gamma-filter-comp-transfer">
              <feFuncR id="gamma-r" type="gamma" offset="0" amplitude="1"></feFuncR>
              <feFuncG id="gamma-g" type="gamma" offset="0" amplitude="1"></feFuncG>
              <feFuncB id="gamma-b" type="gamma" offset="0" amplitude="1"></feFuncB>
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      `
    );
    document.body.appendChild(gammaFilterDiv);
    gammaFilterSvg = gammaFilterDiv.firstElementChild as SVGSVGElement;
    gammaR = document.getElementById('gamma-r') as unknown as SVGFEFuncRElement;
    gammaG = document.getElementById('gamma-g') as unknown as SVGFEFuncGElement;
    gammaB = document.getElementById('gamma-b') as unknown as SVGFEFuncBElement;
  }
  if (!appState.isGammaPreviewOn) {
    appState.video.style.filter = 'url(#gamma-filter)';
    appState.isGammaPreviewOn = true;
    requestAnimationFrame(gammaPreviewHandler);
    flashMessage('Gamma preview enabled', 'green');
  } else {
    appState.video.style.filter = null as any;
    appState.isGammaPreviewOn = false;
    flashMessage('Gamma preview disabled', 'red');
  }
  toggleCropPreviewGammaPreview();
}

function gammaPreviewHandler() {
  const shortestActiveMarkerPair = getShortestActiveMarkerPair();

  const markerPairGamma =
    (shortestActiveMarkerPair?.overrides.gamma) ||
    appState.settings.gamma ||
    1;

  if (markerPairGamma == 1) {
    if (appState.video.style.filter) appState.video.style.filter = null as any;
    setPrevGammaVal(1);
  } else if (prevGammaVal !== markerPairGamma) {
    // console.log(`Updating gamma from ${prevGammaVal} to ${markerPairGamma}`);
    gammaR.exponent.baseVal = markerPairGamma;
    gammaG.exponent.baseVal = markerPairGamma;
    gammaB.exponent.baseVal = markerPairGamma;
    // force re-render of filter (possible bug with chrome and other browsers?)
    if (!appState.video.style.filter) appState.video.style.filter = 'url(#gamma-filter)';
    gammaFilterSvg.setAttribute('width', '0');
    setPrevGammaVal(markerPairGamma);
  }

  if (appState.isGammaPreviewOn) {
    requestAnimationFrame(gammaPreviewHandler);
  }
}

let isFadeLoopPreviewOn = false;
export function toggleFadeLoopPreview() {
  if (!isFadeLoopPreviewOn) {
    isFadeLoopPreviewOn = true;
    requestAnimationFrame(fadeLoopPreviewHandler);
    flashMessage('Fade loop preview enabled', 'green');
  } else {
    isFadeLoopPreviewOn = false;
    appState.video.style.opacity = '1';
    flashMessage('Fade loop preview disabled', 'red');
  }
}

export function getIsFadeLoopPreviewOn() {
  return isFadeLoopPreviewOn;
}

function fadeLoopPreviewHandler() {
  const currentTime = appState.video.getCurrentTime();
  const shortestActiveMarkerPair = getShortestActiveMarkerPair();
  if (
    shortestActiveMarkerPair &&
    (shortestActiveMarkerPair.overrides.loop === 'fade' ||
      (shortestActiveMarkerPair.overrides.loop == null && appState.settings.loop === 'fade'))
  ) {
    const currentTimeP = getFadeBounds(shortestActiveMarkerPair, currentTime);
    if (currentTimeP == null) {
      appState.video.style.opacity = '1';
    } else {
      const currentTimeEased = Math.max(0.1, easeCubicInOut(currentTimeP));
      appState.video.style.opacity = currentTimeEased.toString();
    }
  } else {
    appState.video.style.opacity = '1';
  }
  isFadeLoopPreviewOn
    ? requestAnimationFrame(fadeLoopPreviewHandler)
    : (appState.video.style.opacity = '1');
}

export function getFadeBounds(markerPair: MarkerPair, currentTime: number): number | null {
  const start = Math.floor(markerPair.start * 1e6) / 1e6;
  const end = Math.ceil(markerPair.end * 1e6) / 1e6;
  const inputDuration = end - start;
  const outputDuration = markerPair.outputDuration;
  let fadeDuration = markerPair.overrides.fadeDuration || appState.settings.fadeDuration || 0.5;
  fadeDuration = Math.min(fadeDuration, 0.4 * outputDuration);
  const fadeInStartP = 0;
  const fadeInEndP = fadeDuration / outputDuration;
  const fadeOutStartP = (outputDuration - fadeDuration) / outputDuration;
  const fadeOutEndP = outputDuration / outputDuration;

  let currentTimeP = (currentTime - start) / inputDuration;

  if (currentTimeP >= fadeInStartP && currentTimeP <= fadeInEndP) {
    currentTimeP = (currentTime - start) / fadeDuration;
    return currentTimeP;
  } else if (currentTimeP >= fadeOutStartP && currentTimeP <= fadeOutEndP) {
    currentTimeP = 1 - (currentTime - start - (inputDuration - fadeDuration)) / fadeDuration;
    return currentTimeP;
  } else {
    return null;
  }
}

export function toggleAllPreviews() {
  appState.isAllPreviewsOn =
    getIsSpeedPreviewOn() &&
    getIsMarkerLoopPreviewOn() &&
    appState.isGammaPreviewOn &&
    isFadeLoopPreviewOn &&
    appState.isCropChartLoopingOn;
  if (!appState.isAllPreviewsOn) {
    !getIsSpeedPreviewOn() && toggleMarkerPairSpeedPreview();
    !getIsMarkerLoopPreviewOn() && toggleMarkerPairLoop();
    !appState.isGammaPreviewOn && toggleGammaPreview();
    !isFadeLoopPreviewOn && toggleFadeLoopPreview();
    appState.isAllPreviewsOn = true;
  } else {
    getIsSpeedPreviewOn() && toggleMarkerPairSpeedPreview();
    getIsMarkerLoopPreviewOn() && toggleMarkerPairLoop();
    appState.isGammaPreviewOn && toggleGammaPreview();
    isFadeLoopPreviewOn && toggleFadeLoopPreview();
    appState.isAllPreviewsOn = false;
  }
}
