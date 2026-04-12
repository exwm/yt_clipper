import { createDraft } from 'immer';
import { renderShortcutsTable } from '../command-palette';
import { MarkerPair, MarkerPairOverrides, Settings } from './@types/yt_clipper';
import { appState } from './appState';
import { getCropMapProperties, renderSpeedAndCropUI } from './charts';
import { hideCropOverlay, resizeCrop, transformCropWithPushBack } from './crop-overlay';
import {
  cropStringsEqual,
  getCropComponents,
  getCropMultiples,
  isStaticCrop,
  multiplyAllCrops,
  setCropInputValue,
  setCropString,
  updateCropString,
} from './crop-utils';
import { Crop, getMinMaxAvgCropPoint, isVariableSize } from './crop/crop';
import { triggerCropPreviewRedraw } from './crop/crop-preview';
import { VideoPlatforms } from './platforms/platforms';
import { updateMarkerPairSpeed } from './speed';
import { Tooltips } from './ui/tooltips';
import { getMarkerPairHistory, saveMarkerPairHistory } from './util/undoredo';
import {
  assertDefined,
  blockEvent,
  deleteElement,
  flashMessage,
  getCropString,
  htmlToElement,
  injectCSS,
  safeSetInnerHtml,
} from './util/util';
import {
  commandPalette,
  initShortcutSystem,
  platform,
  shortcutRegistry,
  shortcutsTableStyle,
  shortcutsTableToggleButtonHTML,
} from './yt_clipper';

export function addSettingsInputListeners(inputs: string[][], target, highlightable = false) {
  inputs.forEach((input) => {
    const id = input[0];
    const targetProperty = input[1];
    const valueType = input[2] || 'string';
    const inputElem = document.getElementById(id);
    assertDefined(inputElem, `Settings input element not found: ${id}`);

    inputElem.addEventListener('focus', () => (appState.isHotkeysEnabled = false), false);
    inputElem.addEventListener('blur', () => (appState.isHotkeysEnabled = true), false);
    inputElem.addEventListener(
      'change',
      (e) => { updateSettingsValue(e, id, target, targetProperty, valueType, highlightable); },
      false
    );
  });
}
export function deleteSettingsEditor() {
  const settingsEditorDiv = document.getElementById('settings-editor-div');
  assertDefined(settingsEditorDiv, 'Settings editor div not found');
  deleteElement(settingsEditorDiv);
  appState.isSettingsEditorOpen = false;
  appState.wasGlobalSettingsEditorOpen = false;
  appState.markerHotkeysEnabled = false;

  hideCropOverlay();
  triggerCropPreviewRedraw();
}
export let isExtraSettingsEditorEnabled = false;
export function toggleMarkerPairOverridesEditor() {
  if (appState.isSettingsEditorOpen) {
    const markerPairOverridesEditor = document.getElementById('marker-pair-overrides');
    if (markerPairOverridesEditor) {
      if (markerPairOverridesEditor.style.display === 'none') {
        markerPairOverridesEditor.style.display = 'block';
        isExtraSettingsEditorEnabled = true;
      } else {
        markerPairOverridesEditor.style.display = 'none';
        isExtraSettingsEditorEnabled = false;
      }
    }

    const globalEncodeSettingsEditor = document.getElementById('global-encode-settings');
    if (globalEncodeSettingsEditor) {
      if (globalEncodeSettingsEditor.style.display === 'none') {
        globalEncodeSettingsEditor.style.display = 'block';
        isExtraSettingsEditorEnabled = true;
      } else if (globalEncodeSettingsEditor.style.display === 'block') {
        globalEncodeSettingsEditor.style.display = 'none';
        isExtraSettingsEditorEnabled = false;
      }
    }
  }
}

export let cropInputLabel: HTMLInputElement;
export let cropInput: HTMLInputElement;
export function setCropInput(el: HTMLInputElement) { cropInput = el; }
export let enableZoomPanInput: HTMLInputElement;
export let cropAspectRatioSpan: HTMLSpanElement;
export function setCropAspectRatioSpan(el: HTMLSpanElement) { cropAspectRatioSpan = el; }
export function highlightModifiedSettings(inputs: string[][], target) {
  if (appState.isSettingsEditorOpen) {
    const markerPairSettingsLabelHighlight = 'marker-pair-settings-editor-highlighted-label';
    const globalSettingsLabelHighlight = 'global-settings-editor-highlighted-label';
    const inheritedSettingsLabelHighlight = 'inherited-settings-highlighted-label';
    let markerPair: MarkerPair;
    if (!appState.wasGlobalSettingsEditorOpen && appState.prevSelectedMarkerPairIndex != null) {
      markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    }
    inputs.forEach((input) => {
      const [id, targetProperty, valueType] = input;
      const inputElem = document.getElementById(id);
      if (!inputElem) return;
      const storedTargetValue = target[targetProperty];

      let label = inputElem.previousElementSibling;
      if (id === 'rotate-90-clock' || id === 'rotate-90-counterclock')
        label = inputElem.parentElement?.getElementsByTagName('span')[0] ?? null;
      if (id === 'minterp-fps-multiplier-input')
        label = inputElem.closest('.fps-mul-stepper')?.parentElement?.querySelector('span') ?? null;

      if (storedTargetValue == null) {
        inputElem.classList.add(inheritedSettingsLabelHighlight);
      } else {
        inputElem.classList.remove(inheritedSettingsLabelHighlight);
      }

      let shouldRemoveHighlight =
        storedTargetValue == null ||
        storedTargetValue === '' ||
        (valueType === 'bool' && storedTargetValue === false);

      if (target === appState.settings) {
        shouldRemoveHighlight ||=
          (id === 'title-suffix-input' && storedTargetValue == `[${appState.settings.videoID}]`) ||
          (id === 'speed-input' && storedTargetValue === 1) ||
          (id === 'crop-input' &&
            (storedTargetValue === '0:0:iw:ih' ||
              storedTargetValue ===
                `0:0:${appState.settings.cropResWidth}:${appState.settings.cropResHeight}`)) ||
          id === 'rotate-0';
      }

      if (shouldRemoveHighlight) {
        label?.classList.remove(globalSettingsLabelHighlight);
        label?.classList.remove(markerPairSettingsLabelHighlight);
        return;
      }

      if (target === appState.settings) {
        label?.classList.add(globalSettingsLabelHighlight);
      } else {
        let settingsProperty = targetProperty;
        if (targetProperty === 'speed') settingsProperty = 'newMarkerSpeed';
        if (targetProperty === 'crop') settingsProperty = 'newMarkerCrop';
        const globalValue = appState.settings[settingsProperty];
        let shouldApplyGlobalHighlight = storedTargetValue === globalValue;
        if (targetProperty === 'crop') {
          shouldApplyGlobalHighlight = cropStringsEqual(storedTargetValue, globalValue);
          shouldApplyGlobalHighlight =
            shouldApplyGlobalHighlight && isStaticCrop(markerPair.cropMap);
        }
        if (shouldApplyGlobalHighlight) {
          label?.classList.add(globalSettingsLabelHighlight);
          label?.classList.remove(markerPairSettingsLabelHighlight);
        } else {
          label?.classList.add(markerPairSettingsLabelHighlight);
          label?.classList.remove(globalSettingsLabelHighlight);
        }
      }
    });
  }
}
export const presetsMap = {
  videoStabilization: {
    Disabled: { desc: 'Disabled', enabled: false },
    'Very Weak': {
      desc: 'Very Weak',
      enabled: true,
      shakiness: 2,
      smoothing: 2,
      zoomspeed: 0.05,
    },
    Weak: {
      desc: 'Weak',
      enabled: true,
      shakiness: 4,
      smoothing: 4,
      zoomspeed: 0.1,
    },
    Medium: {
      desc: 'Medium',
      enabled: true,
      shakiness: 6,
      smoothing: 6,
      zoomspeed: 0.2,
    },
    Strong: {
      desc: 'Strong',
      enabled: true,
      shakiness: 8,
      smoothing: 10,
      zoomspeed: 0.3,
    },
    'Very Strong': {
      desc: 'Very Strong',
      enabled: true,
      shakiness: 10,
      smoothing: 16,
      zoomspeed: 0.4,
    },
    Strongest: {
      desc: 'Strongest',
      enabled: true,
      shakiness: 10,
      smoothing: 22,
      zoomspeed: 0.5,
    },
  },
  denoise: {
    Disabled: { enabled: false, desc: 'Disabled' },
    'Very Weak': { enabled: true, lumaSpatial: 1, desc: 'Very Weak' },
    Weak: { enabled: true, lumaSpatial: 2, desc: 'Weak' },
    Medium: { enabled: true, lumaSpatial: 4, desc: 'Medium' },
    Strong: { enabled: true, lumaSpatial: 6, desc: 'Strong' },
    'Very Strong': { enabled: true, lumaSpatial: 8, desc: 'Very Strong' },
  },
};
export function updateSettingsValue(
  e: Event,
  id: string,
  target: Settings | MarkerPair | MarkerPairOverrides,
  targetProperty: string,
  valueType: string,
  highlightable: boolean
) {
  const inputTarget = e.target as HTMLInputElement;
  if (inputTarget.reportValidity()) {
    const prevValue = inputTarget.value;
    let newValue: any = inputTarget.value;
    if (newValue != null) {
      if (
        targetProperty !== 'titleSuffix' &&
        targetProperty !== 'markerPairMergeList' &&
        newValue === ''
      ) {
        delete target[targetProperty];
        newValue = undefined;
      } else if (valueType === 'number') {
        newValue = parseFloat(newValue);
      } else if (valueType === 'bool') {
        if (newValue === 'Enabled') {
          newValue = true;
        } else if (newValue === 'Disabled') {
          newValue = false;
        }
      } else if (valueType === 'ternary' || valueType === 'inheritableString') {
        if (newValue === 'Default' || newValue === 'Inherit') {
          delete target[targetProperty];
          newValue = undefined;
        } else if (newValue === 'Enabled') {
          newValue = true;
        } else if (newValue === 'Disabled') {
          newValue = false;
        }
      } else if (valueType === 'preset') {
        if (newValue === 'Inherit') {
          delete target[targetProperty];
          newValue = undefined;
        } else {
          newValue = presetsMap[targetProperty][newValue];
        }
      }
    }

    if (!['crop', 'enableZoomPan', 'cropRes'].includes(targetProperty)) {
      target[targetProperty] = newValue;
    }

    if (targetProperty === 'newMarkerCrop') {
      const newCrop = transformCropWithPushBack(prevValue, newValue);
      updateCropString(newCrop, true);
    }

    if (targetProperty === 'cropRes') {
      const { cropMultipleX, cropMultipleY, newWidth, newHeight } = getCropMultiples(
        appState.settings.cropRes,
        newValue
      );
      appState.settings.cropRes = newValue;
      appState.settings.cropResWidth = newWidth;
      appState.settings.cropResHeight = newHeight;
      Crop._minW = Math.round(Crop.minW * cropMultipleX);
      Crop._minH = Math.round(Crop.minH * cropMultipleY);
      multiplyAllCrops(cropMultipleX, cropMultipleY);
    }

    if (targetProperty === 'crop') {
      const markerPair = target as MarkerPair;
      setCropString(markerPair, newValue);
    }

    if (targetProperty === 'speed') {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      updateMarkerPairSpeed(markerPair, newValue);
      renderSpeedAndCropUI();
    }

    if (targetProperty === 'enableZoomPan') {
      const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
      const cropMap = markerPair.cropMap;
      const draft = createDraft(getMarkerPairHistory(markerPair));

      const cropString = cropMap[appState.currentCropPointIndex].crop;
      const enableZoomPan = newValue;
      const cropRes = appState.settings.cropRes;
      if (!enableZoomPan && isVariableSize(cropMap, cropRes)) {
        appState.video.pause();
        const { minSizeW, minSizeH, maxSizeW, maxSizeH, avgSizeW, avgSizeH } =
          getMinMaxAvgCropPoint(cropMap, cropRes);
        const crop = Crop.fromCropString(cropString, appState.settings.cropRes);
        const tooltip = Tooltips.zoomPanToPanOnlyTooltip(
          minSizeW,
          minSizeH,
          maxSizeW,
          maxSizeH,
          avgSizeW,
          avgSizeH
        );
        const desiredSize = prompt(tooltip, 's');
        let w: number;
        let h: number;
        switch (desiredSize) {
          case 's':
            [w, h] = [minSizeW, minSizeH];
            break;
          case 'l':
            [w, h] = [maxSizeW, maxSizeH];
            break;
          case 'a':
            [w, h] = [avgSizeW, avgSizeH];
            break;
          case null:
            flashMessage('Zoompan not disabled (canceled).', 'olive');
            (e.target as HTMLInputElement).value = 'Enabled';
            return;
          default:
            flashMessage(
              "Zoompan not disabled. Please enter 's' for smallest, 'l' for largest, or 'a' for average.",
              'red'
            );
            (e.target as HTMLInputElement).value = 'Enabled';
            return;
        }
        draft.enableZoomPan = false;
        saveMarkerPairHistory(draft, markerPair, false);
        crop.setCropStringSafe(getCropString(crop.x, crop.y, w, h));
        setCropString(markerPair, crop.cropString, true);
        flashMessage(`Zoompan disabled. All crop points set to size ${w}x${h}.`, 'green');
      } else {
        draft.enableZoomPan = enableZoomPan;
        saveMarkerPairHistory(draft, markerPair);
        renderSpeedAndCropUI();
      }
    }
  }

  if (highlightable) highlightModifiedSettings([[id, targetProperty, valueType]], target);
}
export function addCropInputHotkeys() {
  cropInput.addEventListener('keydown', (ke: KeyboardEvent) => {
    if (
      ke.code === 'Space' ||
      (!ke.ctrlKey &&
        !ke.altKey &&
        ke.code.startsWith('Key') &&
        ke.code >= 'KeyB' &&
        ke.code <= 'KeyZ' &&
        !(ke.code === 'KeyI' || ke.code === 'KeyW' || ke.code === 'KeyH')) ||
      (ke.code === 'KeyA' && (ke.ctrlKey || ke.altKey)) // blur on KeyA with ctrl or alt modifiers
    ) {
      blockEvent(ke);
      cropInput.blur();
      flashMessage('Auto blurred crop input focus', 'olive');
      return;
    }

    if (
      ke.code === 'ArrowUp' ||
      ke.code === 'ArrowDown' ||
      (ke.code === 'KeyA' && !ke.ctrlKey && !ke.altKey)
    ) {
      blockEvent(ke);
      const cropString = cropInput.value;
      const cropStringArray = cropString.split(':');
      const initialCropArray = getCropComponents(cropString);
      const cropArray = [...initialCropArray];
      const cropStringCursorPos = (ke.target as HTMLInputElement).selectionStart ?? 0;
      let cropComponentCursorPos = cropStringCursorPos;
      let cropTarget = 0;
      while (cropComponentCursorPos - (cropStringArray[cropTarget].length + 1) >= 0) {
        cropComponentCursorPos -= cropStringArray[cropTarget].length + 1;
        cropTarget++;
      }

      const isValidCropTarget =
        cropTarget >= 0 &&
        cropTarget <= cropArray.length - 1 &&
        typeof cropArray[cropTarget] === 'number';
      if (!isValidCropTarget) return;

      if (ke.code === 'KeyA' && !appState.wasGlobalSettingsEditorOpen) {
        const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
        const initState = getMarkerPairHistory(markerPair);
        const draft = createDraft(initState);
        const draftCropMap = draft.cropMap;

        const { enableZoomPan } = getCropMapProperties();
        const [ix, iy, iw, ih] = initialCropArray;
        if (
          cropTarget === 0 ||
          cropTarget === 1 ||
          (enableZoomPan && (cropTarget === 2 || cropTarget === 3))
        ) {
          draftCropMap.forEach((cropPoint, idx) => {
            if (
              (!ke.shiftKey && idx <= appState.currentCropPointIndex) ||
              (ke.shiftKey && idx >= appState.currentCropPointIndex)
            ) {
              return;
            }
            let [x, y, w, h] = getCropComponents(cropPoint.crop);
            if (cropTarget === 0) x = ix;
            if (cropTarget === 1) y = iy;
            if (cropTarget === 2 || cropTarget === 3) {
              w = iw;
              h = ih;
            }
            cropPoint.crop = [x, y, w, h].join(':');
            if (idx === 0) draft.crop = cropPoint.crop;
          });
          saveMarkerPairHistory(draft, markerPair);
          renderSpeedAndCropUI();
        }

        const targetPointsMsg = `${ke.shiftKey ? 'preceding' : 'following'} point ${appState.currentCropPointIndex + 1}`;
        if (cropTarget === 0)
          flashMessage(`Updated X values of crop points ${targetPointsMsg} to ${ix}`, 'green');
        if (cropTarget === 1)
          flashMessage(
            `Updated Y values crop points ${targetPointsMsg} Y values to ${iy}`,
            'green'
          );
        if (enableZoomPan && (cropTarget === 2 || cropTarget === 3))
          flashMessage(
            `Updated size of all crop points ${targetPointsMsg} to ${iw}x${ih}`,
            'green'
          );
        if (!enableZoomPan && (cropTarget === 2 || cropTarget === 3)) {
          flashMessage(`All crop points have the same size in pan-only mode`, 'olive');
        }
      } else if (ke.code === 'ArrowUp' || ke.code === 'ArrowDown') {
        let changeAmount = 0;
        const [ix, iy, iw, ih] = getCropComponents(cropInput.value);
        if (!ke.altKey && !ke.shiftKey) {
          changeAmount = 10;
        } else if (ke.altKey && !ke.shiftKey) {
          changeAmount = 1;
        } else if (!ke.altKey && ke.shiftKey) {
          changeAmount = 50;
        } else if (ke.altKey && ke.shiftKey) {
          changeAmount = 100;
        }

        const { isDynamicCrop, enableZoomPan } = getCropMapProperties();
        const shouldMaintainCropAspectRatio = enableZoomPan && isDynamicCrop;
        const cropResWidth = appState.settings.cropResWidth;
        const cropResHeight = appState.settings.cropResHeight;
        const crop = new Crop(ix, iy, iw, ih, cropResWidth, cropResHeight);

        // without modifiers move crop x/y offset
        // with ctrl key modifier expand/shrink crop width/height
        if (cropTarget === 0) {
          ke.code === 'ArrowUp' ? crop.panX(changeAmount) : crop.panX(-changeAmount);
        } else if (cropTarget === 1) {
          ke.code === 'ArrowUp' ? crop.panY(changeAmount) : crop.panY(-changeAmount);
        } else {
          let cursor = 'e-resize';
          if (cropTarget === 2) cursor = 'e-resize';
          if (cropTarget === 3) cursor = 's-resize';
          if (ke.code === 'ArrowDown') changeAmount = -changeAmount;
          resizeCrop(crop, cursor, changeAmount, changeAmount, shouldMaintainCropAspectRatio);
        }

        const { initCropMap } = getCropMapProperties();

        updateCropString(crop.cropString, true, false, initCropMap ?? undefined);

        const updatedCropString = cropInput.value;
        let newCursorPos = cropStringCursorPos - cropComponentCursorPos;
        if (cropTarget === 3 && cropStringArray[3] === 'ih') {
          const cropStringLengthDelta = updatedCropString.length - cropString.length;
          const cursorPosAdjustment = cropStringLengthDelta - cropComponentCursorPos;
          newCursorPos += cursorPosAdjustment;
        }
        cropInput.selectionStart = newCursorPos;
        cropInput.selectionEnd = newCursorPos;
      }
    }
  });
}
export let commandPaletteToggleButton: HTMLButtonElement;
export function injectToggleCommandPaletteButton() {
  commandPaletteToggleButton = htmlToElement(shortcutsTableToggleButtonHTML) as HTMLButtonElement;
  commandPaletteToggleButton.classList.add('yt-clipper-palette-button');
  commandPaletteToggleButton.title = 'Open yt_clipper Command Palette (Ctrl+Shift+P)';
  commandPaletteToggleButton.onclick = () => commandPalette?.toggle();

  if ([VideoPlatforms.weverse, VideoPlatforms.naver_tv].includes(platform)) {
    commandPaletteToggleButton.classList.add(
      'pzp-button',
      'pzp-subtitle-button',
      'pzp-pc-subtitle-button',
      'pzp-pc__subtitle-button'
    );
  }
  if ([VideoPlatforms.afreecatv].includes(platform)) {
    commandPaletteToggleButton.classList.add('btn_statistics');
  }

  if (platform === VideoPlatforms.yt_clipper) {
    const shortcutsTableButtonParent = appState.hooks.shortcutsTableButton.parentElement;
    assertDefined(shortcutsTableButtonParent, 'shortcutsTableButton has no parentElement');
    shortcutsTableButtonParent.insertBefore(
      commandPaletteToggleButton,
      appState.hooks.shortcutsTableButton
    );
  } else {
    appState.hooks.shortcutsTableButton.insertAdjacentElement(
      'afterbegin',
      commandPaletteToggleButton
    );
  }
}
export function showCommandPaletteToggleButton() {
  if (commandPaletteToggleButton) {
    commandPaletteToggleButton.style.display = 'inline-block';
  }
}
export function hideCommandPaletteToggleButton() {
  if (commandPaletteToggleButton) {
    commandPaletteToggleButton.style.display = 'none';
  }
}
export let shortcutsTableContainer: HTMLDivElement;
export function toggleShortcutsTable() {
  if (!shortcutsTableContainer) {
    initShortcutSystem();
    assertDefined(shortcutRegistry, 'shortcutRegistry must be initialized before rendering shortcuts table');
    injectCSS(shortcutsTableStyle, 'shortcutsTableStyle');
    shortcutsTableContainer = document.createElement('div');
    shortcutsTableContainer.setAttribute('id', 'shortcutsTableContainer');
    safeSetInnerHtml(shortcutsTableContainer, renderShortcutsTable(shortcutRegistry));
    appState.hooks.shortcutsTable.insertAdjacentElement('beforebegin', shortcutsTableContainer);
  } else if (shortcutsTableContainer.style.display !== 'none') {
    shortcutsTableContainer.style.display = 'none';
  } else {
    shortcutsTableContainer.style.display = 'block';
  }
}
export let arrowKeyCropAdjustmentEnabled = false;
export function toggleArrowKeyCropAdjustment() {
  if (arrowKeyCropAdjustmentEnabled) {
    document.removeEventListener('keydown', arrowKeyCropAdjustmentHandler, true);
    flashMessage('Disabled crop adjustment with arrow keys', 'red');
    arrowKeyCropAdjustmentEnabled = false;
  } else {
    document.addEventListener('keydown', arrowKeyCropAdjustmentHandler, true);
    flashMessage('Enabled crop adjustment with arrow keys', 'green');
    arrowKeyCropAdjustmentEnabled = true;
  }
}
export function arrowKeyCropAdjustmentHandler(ke: KeyboardEvent) {
  if (appState.isSettingsEditorOpen) {
    if (
      cropInput !== document.activeElement &&
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ke.code)
    ) {
      blockEvent(ke);
      const [ix, iy, iw, ih] = getCropComponents(cropInput.value);
      let changeAmount = 0;
      if (!ke.altKey && !ke.shiftKey) {
        changeAmount = 10;
      } else if (ke.altKey && !ke.shiftKey) {
        changeAmount = 1;
      } else if (!ke.altKey && ke.shiftKey) {
        changeAmount = 50;
      } else if (ke.altKey && ke.shiftKey) {
        changeAmount = 100;
      }

      const { isDynamicCrop, enableZoomPan, initCropMap } = getCropMapProperties();

      const shouldMaintainCropAspectRatio = enableZoomPan && isDynamicCrop;
      const cropResWidth = appState.settings.cropResWidth;
      const cropResHeight = appState.settings.cropResHeight;
      const crop = new Crop(ix, iy, iw, ih, cropResWidth, cropResHeight);

      // without modifiers move crop x/y offset
      // with ctrl key modifier expand/shrink crop width/height
      if (!ke.ctrlKey) {
        switch (ke.code) {
          case 'ArrowUp':
            crop.panY(-changeAmount);
            break;
          case 'ArrowDown':
            crop.panY(changeAmount);
            break;
          case 'ArrowLeft':
            crop.panX(-changeAmount);
            break;
          case 'ArrowRight':
            crop.panX(changeAmount);
            break;
        }
      } else {
        let cursor = 'e-resize';
        switch (ke.code) {
          case 'ArrowUp':
            cursor = 's-resize';
            changeAmount = -changeAmount;
            break;
          case 'ArrowDown':
            cursor = 's-resize';
            break;
          case 'ArrowLeft':
            cursor = 'e-resize';
            changeAmount = -changeAmount;
            break;
          case 'ArrowRight':
            cursor = 'e-resize';
            break;
        }
        resizeCrop(crop, cursor, changeAmount, changeAmount, shouldMaintainCropAspectRatio);
      }

      updateCropString(crop.cropString, true, false, initCropMap ?? undefined);
    }
  }
}
export function renderCropForm(crop) {
  const [, , w, h] = getCropComponents(crop);

  setCropInputValue(crop);

  const cropAspectRatio = (w / h).toFixed(13);
  cropAspectRatioSpan && (cropAspectRatioSpan.textContent = cropAspectRatio);
}
export function highlightSpeedAndCropInputs() {
  if (appState.wasGlobalSettingsEditorOpen) {
    highlightModifiedSettings(
      [
        ['crop-input', 'newMarkerCrop', 'string'],
        ['speed-input', 'newMarkerSpeed', 'number'],
      ],
      appState.settings
    );
  } else {
    const markerPair = appState.markerPairs[appState.prevSelectedMarkerPairIndex];
    highlightModifiedSettings(
      [
        ['crop-input', 'crop', 'string'],
        ['speed-input', 'speed', 'number'],
        ['enable-zoom-pan-input', 'enableZoomPan', 'bool'],
      ],
      markerPair
    );
  }
}
