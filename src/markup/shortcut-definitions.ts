import { ShortcutDefinition } from '../command-palette';

export interface ShortcutDeps {
  showShortcutsReference: () => void;
  addMarker: () => void;
  moveMarkerToCurrentTime: (which: 'start' | 'end') => void;
  addChartPoint: () => void;
  duplicateSelectedMarkerPair: () => void;
  saveMarkersAndSettings: () => void;
  copyMarkersToClipboard: () => void;
  toggleForceSetSpeed: () => void;
  cycleForceSetSpeedValueDown: () => void;
  updateAllMarkerPairSpeedsToDefault: () => void;
  captureFrame: () => void;
  saveCapturedFrames: () => void;
  toggleGlobalSettingsEditor: () => void;
  toggleMarkerPairOverridesEditor: () => void;
  toggleMarkerPairSpeedPreview: () => void;
  toggleMarkerPairLoop: () => void;
  toggleGammaPreview: () => void;
  toggleFadeLoopPreview: () => void;
  toggleCropChartLooping: () => void;
  toggleAllPreviews: () => void;
  toggleMarkersDataCommands: () => void;
  toggleSpeedChart: () => void;
  toggleChartLoop: () => void;
  toggleCropChart: () => void;
  undoMarker: () => void;
  redoMarker: () => void;
  undoMarkerPairChange: () => void;
  redoMarkerPairChange: () => void;
  deleteMarkerPair: () => void;
  drawCrop: () => void;
  toggleArrowKeyCropAdjustment: () => void;
  updateAllMarkerPairCropsToDefault: () => void;
  cycleCropDimOpacity: () => void;
  toggleCropCrossHair: () => void;
  toggleCropPreviewModal: () => void;
  toggleCropPreviewPopOut: () => void;
  rotateVideoClock: () => void;
  rotateVideoCClock: () => void;
  toggleBigVideoPreviews: () => void;
  flashNotTheatreMode: () => void;
  flattenVRVideo: () => void;
  openSubsEditor: () => void;
  jumpToNearestMarkerOrPair: (e: KeyboardEvent) => void;
  togglePrevSelectedMarkerPair: () => void;
  toggleAutoHideUnselectedMarkerPairs: (e: KeyboardEvent) => void;

  isMarkerHotkeysEnabled: () => boolean;
  isTheatreMode: () => boolean;
  isArrowKeyCropAdjustmentDisabled: () => boolean;
}

export function createShortcutDefinitions(deps: ShortcutDeps): ShortcutDefinition[] {
  const markerGuard = deps.isMarkerHotkeysEnabled;
  const theatre = deps.isTheatreMode;
  const cropAdjDisabled = deps.isArrowKeyCropAdjustmentDisabled;

  return [
    // ===== Basic Features / Marker Shortcuts =====
    {
      id: 'toggleShortcuts',
      description: 'Toggle shortcuts on/off',
      displayKey: 'Alt + Shift + A',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleCommandPalette',
      description: 'Open command palette (search all shortcuts)',
      displayKey: 'Shift + E',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'showShortcutsReference',
      description: 'Toggle full shortcuts reference table',
      displayKey: '',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: null,
      handler: () => {
        deps.showShortcutsReference();
      },
      executable: true,
    },
    {
      id: 'addMarker',
      description: 'Add marker at current time',
      displayKey: 'A',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.addMarker();
      },
      executable: true,
    },
    {
      id: 'toggleEndMarkerEditor',
      description: "Toggle targeted end marker's editor",
      displayKey: 'Shift + Mouseover',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'openMarkerPairEditor',
      description: "Jump to marker numbering and open marker pair's editor",
      displayKey: 'Click',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleMarkerPairOverridesEditor',
      description: 'Toggle marker pair overrides editor',
      displayKey: 'Shift + W',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'KeyW', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleMarkerPairOverridesEditor();
      },
      executable: true,
    },
    {
      id: 'duplicateSelectedMarkerPair',
      description: 'Duplicate selected or previously selected marker pair',
      displayKey: 'Ctrl + Shift + A',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'KeyA', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.duplicateSelectedMarkerPair();
      },
      executable: true,
    },
    {
      id: 'undoMarker',
      description: 'Undo last marker',
      displayKey: 'Z',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.undoMarker();
      },
      executable: true,
    },
    {
      id: 'redoMarker',
      description: 'Redo last marker',
      displayKey: 'Shift + Z',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.redoMarker();
      },
      executable: true,
    },
    {
      id: 'deleteSelectedMarkerPair',
      description: 'Delete selected marker pair',
      displayKey: 'Ctrl + Alt + Shift + Z',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: true, shift: true, alt: true } },
      handler: () => {
        deps.deleteMarkerPair();
      },
      guard: markerGuard,
      executable: true,
    },
    {
      id: 'moveStartMarkerToCurrentTime',
      description: 'Move start marker to current time',
      displayKey: 'Shift + Q',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.moveMarkerToCurrentTime('start');
      },
      guard: markerGuard,
      executable: true,
    },
    {
      id: 'moveEndMarkerToCurrentTime',
      description: 'Move end marker to current time',
      displayKey: 'Shift + A',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.moveMarkerToCurrentTime('end');
      },
      guard: markerGuard,
      executable: true,
    },
    {
      id: 'dragMarkerNumbering',
      description: 'Drag start/end marker numbering to new time',
      displayKey: 'Alt + Drag',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'moveMarkerByFrame',
      description: 'Move start/end marker a frame when on left/right half of window',
      displayKey: 'Alt + Shift + Mousewheel',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'undoMarkerPairChange',
      description: 'Undo time, speed, and crop changes of selected pair',
      displayKey: 'Alt + Z',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.undoMarkerPairChange();
      },
      executable: true,
    },
    {
      id: 'redoMarkerPairChange',
      description: 'Redo time, speed, and crop changes of selected pair',
      displayKey: 'Alt + Shift + Z',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.redoMarkerPairChange();
      },
      executable: true,
    },
    {
      id: 'togglePrevSelectedMarkerPair',
      description: 'Toggle marker pair selection',
      displayKey: 'Ctrl + Up',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowUp', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: () => {
        deps.togglePrevSelectedMarkerPair();
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'toggleAutoHideUnselectedMarkerPairs',
      description: 'Toggle auto-hiding unselected marker pairs',
      displayKey: 'Ctrl + Down',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowDown', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: (e) => {
        deps.toggleAutoHideUnselectedMarkerPairs(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'jumpToNearestPrevMarker',
      description: 'Jump to nearest previous marker',
      displayKey: 'Ctrl + Left',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'ArrowLeft', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'jumpToNearestNextMarker',
      description: 'Jump to nearest next marker',
      displayKey: 'Ctrl + Right',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: true,
      binding: { code: 'ArrowRight', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'selectPrevMarkerPair',
      description: 'Select previous marker pair',
      displayKey: 'Alt + Left',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowLeft', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'selectNextMarkerPair',
      description: 'Select next marker pair',
      displayKey: 'Alt + Right',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowRight', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'selectPrevMarkerPairAndJump',
      description: 'Select previous marker pair and jump to start marker',
      displayKey: 'Ctrl + Alt + Left',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowLeft', modifiers: { ctrl: true, shift: false, alt: true } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },
    {
      id: 'selectNextMarkerPairAndJump',
      description: 'Select next marker pair and jump to start marker',
      displayKey: 'Ctrl + Alt + Right',
      section: 'Basic Features',
      category: 'Marker Shortcuts',
      essential: false,
      binding: { code: 'ArrowRight', modifiers: { ctrl: true, shift: false, alt: true } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },

    // ===== Basic Features / Global Settings Editor =====
    {
      id: 'toggleGlobalSettingsEditor',
      description: 'Toggle global settings editor',
      displayKey: 'W',
      section: 'Basic Features',
      category: 'Global Settings Editor Shortcuts',
      essential: true,
      binding: { code: 'KeyW', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleGlobalSettingsEditor();
      },
      executable: true,
    },
    {
      id: 'toggleEncodingSettingsEditor',
      description: 'Toggle encoding settings editor',
      displayKey: 'Shift + W',
      section: 'Basic Features',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'updateAllMarkersSpeed',
      description: 'Update all markers to default new marker speed',
      displayKey: 'Alt + Shift + Q',
      section: 'Basic Features',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.updateAllMarkerPairSpeedsToDefault();
      },
      executable: true,
    },
    {
      id: 'updateAllMarkersCrop',
      description: 'Update all markers to default new marker crop',
      displayKey: 'Alt + Shift + X',
      section: 'Basic Features',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.updateAllMarkerPairCropsToDefault();
      },
      executable: true,
    },

    // ===== Basic Features / Cropping Shortcuts =====
    {
      id: 'beginDrawingCrop',
      description: 'Begin drawing crop',
      displayKey: 'X',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.drawCrop();
      },
      executable: true,
    },
    {
      id: 'drawCropMouse',
      description: 'Draw crop',
      displayKey: 'Click + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'moveOrResizeCrop',
      description: 'Move or resize crop',
      displayKey: 'Ctrl + Click + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cycleCropDimOpacity',
      description: 'Cycle crop dim opacity up by 0.25',
      displayKey: 'Ctrl + X',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: () => {
        deps.cycleCropDimOpacity();
      },
      executable: true,
    },
    {
      id: 'toggleCropCrossHair',
      description: 'Toggle crop crosshair',
      displayKey: 'Ctrl + Shift + X',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.toggleCropCrossHair();
      },
      executable: true,
    },
    {
      id: 'cropArLockedResize',
      description: 'Crop-aspect-ratio-locked resize/draw of crop',
      displayKey: 'Ctrl + Alt + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropCenterOutResize',
      description: 'Center-out resize/draw of crop',
      displayKey: 'Ctrl + Shift + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropYOnlyDrag',
      description: 'Horizontally-fixed (Y-only) drag of crop',
      displayKey: 'Ctrl + Shift + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropXOnlyDrag',
      description: 'Vertically-fixed (X-only) drag of crop',
      displayKey: 'Ctrl + Alt + Drag',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleArrowKeyCropAdjustment',
      description: 'Toggle crop adjustment with arrow keys',
      displayKey: 'Alt + X',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.toggleArrowKeyCropAdjustment();
      },
      executable: true,
    },
    {
      id: 'cropInputArrowAdjust',
      description: 'Adjust crop input string with arrow keys',
      displayKey: '',
      displayNote: 'Place cursor on target value',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChangeAmount',
      description: 'Change crop change amount from 10 to 1/50/100',
      displayKey: 'Alt / Shift / Alt + Shift',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropWidthHeightModify',
      description: 'Modify crop width/height instead of x/y offset',
      displayKey: 'Ctrl + ArrowKey',
      section: 'Basic Features',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },

    // ===== Basic Features / Preview Shortcuts =====
    {
      id: 'seekFrameByFrame',
      description: 'Seek video frame by frame',
      displayKey: '< / > or Shift + Mousewheel',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cycleSeekRate',
      description: 'Cycle seek rate (1-3 frames)',
      displayKey: 'Shift + Mousewheel-click',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'scrubVideo',
      description: 'Scrub video time left or right',
      displayKey: 'Alt + Click + Drag',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleMarkerPairSpeedPreview',
      description: 'Toggle previewing speed',
      displayKey: 'C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyC', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleMarkerPairSpeedPreview();
      },
      executable: true,
    },
    {
      id: 'toggleMarkerPairLoop',
      description: 'Toggle auto marker pair looping',
      displayKey: 'Shift + C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyC', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleMarkerPairLoop();
      },
      executable: true,
    },
    {
      id: 'toggleCropPreviewPopOut',
      description: 'Toggle previewing crop in pop-out window',
      displayKey: 'Shift + X',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleCropPreviewPopOut();
      },
      executable: true,
    },
    {
      id: 'toggleCropPreviewModal',
      description: 'Toggle previewing crop in modal window',
      displayKey: 'Ctrl + Alt + X',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: false, alt: true } },
      handler: () => {
        deps.toggleCropPreviewModal();
      },
      executable: true,
    },
    {
      id: 'toggleCropChartLooping',
      description: 'Toggle auto crop chart section looping',
      displayKey: 'Ctrl + Shift + C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyC', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.toggleCropChartLooping();
      },
      executable: true,
    },
    {
      id: 'toggleGammaPreview',
      description: 'Toggle previewing gamma',
      displayKey: 'Alt + C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyC', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.toggleGammaPreview();
      },
      executable: true,
    },
    {
      id: 'toggleFadeLoopPreview',
      description: 'Toggle previewing fade loop',
      displayKey: 'Alt + Shift + C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyC', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.toggleFadeLoopPreview();
      },
      executable: true,
    },
    {
      id: 'toggleAllPreviews',
      description: 'Toggle essential previews',
      displayKey: 'Ctrl + Alt + Shift + C',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyC', modifiers: { ctrl: true, shift: true, alt: true } },
      handler: () => {
        deps.toggleAllPreviews();
      },
      executable: true,
    },
    {
      id: 'toggleForceSetSpeed',
      description: 'Toggle force setting video speed',
      displayKey: 'Q',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleForceSetSpeed();
      },
      executable: true,
    },
    {
      id: 'cycleForceSetSpeedValueDown',
      description: 'Cycle force set video speed value down by 0.25',
      displayKey: 'Alt + Q',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.cycleForceSetSpeedValueDown();
      },
      executable: true,
    },
    {
      id: 'rotateVideoClock',
      description: 'Toggle previewing rotation 90 degrees clockwise',
      displayKey: 'R',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        if (theatre()) deps.rotateVideoClock();
        else deps.flashNotTheatreMode();
      },
      executable: true,
    },
    {
      id: 'rotateVideoCClock',
      description: 'Toggle previewing rotation 90 degrees anti-clockwise',
      displayKey: 'Alt + R',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        if (theatre()) deps.rotateVideoCClock();
      },
      executable: true,
    },
    {
      id: 'toggleBigVideoPreviews',
      description: 'Toggle big video preview thumbnails',
      displayKey: 'Shift + R',
      section: 'Basic Features',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleBigVideoPreviews();
      },
      executable: true,
    },

    // ===== Basic Features / Frame Capturer =====
    {
      id: 'captureFrame',
      description: 'Capture frame',
      displayKey: 'E',
      section: 'Basic Features',
      category: 'Frame Capturer Shortcuts',
      essential: false,
      binding: { code: 'KeyE', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.captureFrame();
      },
      executable: true,
    },
    {
      id: 'saveCapturedFrames',
      description: 'Zip and download captured frames',
      displayKey: 'Alt + E',
      section: 'Basic Features',
      category: 'Frame Capturer Shortcuts',
      essential: false,
      binding: { code: 'KeyE', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.saveCapturedFrames();
      },
      executable: true,
    },

    // ===== Basic Features / Saving and Loading =====
    {
      id: 'saveMarkersAndSettings',
      description: 'Save markers data as json',
      displayKey: 'S',
      section: 'Basic Features',
      category: 'Saving and Loading Shortcuts',
      essential: true,
      binding: { code: 'KeyS', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.saveMarkersAndSettings();
      },
      executable: true,
    },
    {
      id: 'copyMarkersToClipboard',
      description: 'Copy markers data to clipboard',
      displayKey: 'Alt + S',
      section: 'Basic Features',
      category: 'Saving and Loading Shortcuts',
      essential: false,
      binding: { code: 'KeyS', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.copyMarkersToClipboard();
      },
      executable: true,
    },
    {
      id: 'toggleMarkersDataCommands',
      description: 'Toggle markers data commands (loading, restoring, and clearing)',
      displayKey: 'G',
      section: 'Basic Features',
      category: 'Saving and Loading Shortcuts',
      essential: false,
      binding: { code: 'KeyG', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleMarkersDataCommands();
      },
      executable: true,
    },

    // ===== Basic Features / Miscellaneous =====
    {
      id: 'flattenVRVideo',
      description: 'Flatten VR Video',
      displayKey: 'Shift + F',
      section: 'Basic Features',
      category: 'Miscellaneous Shortcuts',
      essential: false,
      binding: { code: 'KeyF', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.flattenVRVideo();
      },
      executable: true,
    },
    {
      id: 'openSubsEditor',
      description: 'Open YouTube subtitles editor',
      displayKey: 'Alt + F',
      section: 'Basic Features',
      category: 'Miscellaneous Shortcuts',
      essential: false,
      binding: { code: 'KeyF', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.openSubsEditor();
      },
      executable: true,
    },

    // ===== Advanced Features / General Chart Shortcuts =====
    {
      id: 'chartAddPoint',
      description: 'Add chart point',
      displayKey: 'Shift + Click',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartAddPointAtCurrentTime',
      description: 'Add chart point at current time',
      displayKey: 'Alt + A',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.addChartPoint();
      },
      guard: markerGuard,
      executable: true,
    },
    {
      id: 'chartDeletePoint',
      description: 'Delete chart point',
      displayKey: 'Alt + Shift + Click',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartMovePointOrPan',
      description: 'Move chart point or pan chart',
      displayKey: 'Click + Drag',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartZoom',
      description: 'Zoom in and out of chart',
      displayKey: 'Ctrl + Mousewheel',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartResetZoom',
      description: 'Reset chart zoom',
      displayKey: 'Ctrl + Click',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartSeekToTime',
      description: 'Seek to time on chart time-axis',
      displayKey: 'Right-Click',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'chartSetLoopMarker',
      description: 'Set chart loop start/end marker',
      displayKey: 'Shift/Alt + Right-click',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleChartLoop',
      description: 'Toggle chart marker looping',
      displayKey: 'Shift + D',
      section: 'Advanced Features',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleChartLoop();
      },
      executable: true,
    },

    // ===== Advanced Features / Speed Chart =====
    {
      id: 'toggleSpeedChart',
      description: 'Toggle speed chart',
      displayKey: 'D',
      section: 'Advanced Features',
      category: 'Speed Chart Shortcuts',
      essential: true,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleSpeedChart();
      },
      executable: true,
    },

    // ===== Advanced Features / Crop Chart =====
    {
      id: 'toggleCropChart',
      description: 'Toggle crop chart',
      displayKey: 'Alt + D',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: true,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.toggleCropChart();
      },
      executable: true,
    },
    {
      id: 'cropChartSelectPoint',
      description: 'Select point as start/end of crop section',
      displayKey: 'Ctrl/Alt + Mouseover',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChartToggleModeSelectPrev',
      description: 'Toggle start/end mode. If in end mode also select prev point',
      displayKey: 'Alt + Mousewheel Down',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChartToggleModeSelectNext',
      description: 'Toggle start/end mode. If in start mode also select next point',
      displayKey: 'Alt + Mousewheel Up',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChartInheritCrop',
      description: "Set current point's crop to next/prev point's crop",
      displayKey: 'Ctrl + Alt + Shift + Mousewheel Up/Down',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChartToggleEase',
      description: 'Toggle crop point ease in between auto and instant',
      displayKey: 'Ctrl + Shift + Click',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'cropChartSetTargetComponent',
      description:
        'Set target crop component of all points following/preceding selected point. Select crop component with cursor in crop input field',
      displayKey: '',
      displayNote: 'a / Shift + A',
      section: 'Advanced Features',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },

    // ===== Advanced Features / ZoomPan Mode Crop Chart =====
    {
      id: 'zoomPanArLockedResize',
      description: 'Crop-aspect-ratio-locked resize of crop',
      displayKey: 'Ctrl + Drag',
      section: 'Advanced Features',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'zoomPanFreelyResize',
      description: 'Freely resize crop',
      displayKey: 'Ctrl + Alt + Drag',
      section: 'Advanced Features',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'zoomPanArLockedDraw',
      description: 'Crop-aspect-ratio-locked draw crop',
      displayKey: 'X, Click + Drag',
      section: 'Advanced Features',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'zoomPanFreelyDraw',
      description: 'Freely draw crop',
      displayKey: 'X, Alt + Click + Drag',
      section: 'Advanced Features',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
    },
  ];
}
