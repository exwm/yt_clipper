import { ShortcutDefinition } from '../command-palette';
import { featureFlags } from './feature-flags';

export interface ShortcutDeps {
  showShortcutsReference: () => void;
  addMarker: () => void;
  moveMarkerToCurrentTime: (which: 'start' | 'end') => void;
  addChartPoint: () => void;
  duplicateSelectedMarkerPair: () => void;
  saveMarkersAndSettings: () => void;
  copyMarkersToClipboard: () => void;
  copyShareableUrl: () => void;
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
  jumpToNearestMarkerOrPair: (e: KeyboardEvent) => void;
  togglePrevSelectedMarkerPair: () => void;
  toggleAutoHideUnselectedMarkerPairs: (e: KeyboardEvent) => void;
  toggleHintsBar: () => void;

  isMarkerHotkeysEnabled: () => boolean;
  isTheatreMode: () => boolean;
  isArrowKeyCropAdjustmentDisabled: () => boolean;
  hasMarkerPairs: () => boolean;
}

export function createShortcutDefinitions(deps: ShortcutDeps): ShortcutDefinition[] {
  const markerGuard = deps.isMarkerHotkeysEnabled;
  const theatre = deps.isTheatreMode;
  const cropAdjDisabled = deps.isArrowKeyCropAdjustmentDisabled;
  const hasMarkerPairs = deps.hasMarkerPairs;

  return [
    // ===== Markup / General Shortcuts =====
    {
      id: 'toggleShortcuts',
      description: 'Toggle shortcuts on/off',
      displayKey: 'Alt + Shift + A',
      section: 'Markup',
      category: 'General Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
    },
    {
      id: 'toggleCommandPalette',
      description: 'Open command palette (search all shortcuts)',
      displayKey: 'Shift + E',
      section: 'Markup',
      category: 'General Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Cmds',
      hintContexts: ['always'],
      hintOrder: 10,
    },
    {
      id: 'toggleHintsBar',
      description: 'Toggle contextual shortcut hints bar',
      displayKey: 'Alt + F',
      section: 'Markup',
      category: 'General Shortcuts',
      essential: true,
      binding: { code: 'KeyF', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.toggleHintsBar();
      },
      executable: true,
    },
    {
      id: 'showShortcutsReference',
      description: 'Toggle full shortcuts reference table',
      displayKey: '',
      section: 'Markup',
      category: 'General Shortcuts',
      essential: false,
      binding: null,
      handler: () => {
        deps.showShortcutsReference();
      },
      executable: true,
    },

    // ===== Markup / Marker Editing Shortcuts =====
    {
      id: 'addMarker',
      description: 'Add marker at current time',
      displayKey: 'A',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.addMarker();
      },
      executable: true,
      hintLabel: 'Add',
      hintContexts: ['default', 'marker-selected'],
      hintOrder: 100,
      hintGroup: 'Markers',
    },
    {
      id: 'toggleEndMarkerEditor',
      description: "Hold Shift while hovering a marker's number to open its pair editor (no seek)",
      displayKey: 'Shift + Mouseover',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Open Pair (No Seek)',
      hintContexts: ['hover-progress-bar'],
      hintOrder: 20,
    },
    {
      id: 'openMarkerPairEditor',
      description:
        "Click a marker pair's number on the progress bar to seek to it and open the pair editor",
      displayKey: 'Click',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Seek + Open Pair',
      hintContexts: ['hover-progress-bar'],
      hintOrder: 10,
      guard: hasMarkerPairs,
    },
    {
      id: 'toggleMarkerPairOverridesEditor',
      description: 'Toggle marker pair overrides editor',
      displayKey: 'Shift + W',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: false,
      binding: { code: 'KeyW', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleMarkerPairOverridesEditor();
      },
      executable: true,
      hintLabel: 'Edit',
      hintContexts: ['marker-selected'],
      hintOrder: 130,
      hintGroup: 'Markers',
    },
    {
      id: 'duplicateSelectedMarkerPair',
      description: 'Duplicate selected or previously selected marker pair',
      displayKey: 'Ctrl + Shift + A',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: false,
      binding: { code: 'KeyA', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.duplicateSelectedMarkerPair();
      },
      executable: true,
    },
    {
      id: 'undoMarker',
      description:
        'Undo / redo history: pair add/remove (Z, Shift+Z) and pair edits (Alt+Z, Alt+Shift+Z)',
      displayKey: 'Z',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.undoMarker();
      },
      executable: true,
      // Pair history undo/redo. Shift is the optional modifier — render
      // it parenthesized so one chord communicates both Z (undo) and
      // Shift+Z (redo) without doubling the chip width.
      hintLabel: 'Pair',
      hintDisplayKey: '(Shift) + Z',
      hintContexts: ['default', 'marker-selected', 'global-editor'],
      hintOrder: 172,
      hintGroup: 'Undo/Redo',
    },
    {
      id: 'redoMarker',
      description: 'Redo last marker',
      displayKey: 'Shift + Z',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
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
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: true, shift: true, alt: true } },
      handler: () => {
        deps.deleteMarkerPair();
      },
      guard: markerGuard,
      executable: true,
    },
    {
      id: 'undoMarkerPairChange',
      description: 'Undo time, speed, and crop changes of selected pair',
      displayKey: 'Alt + Z',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.undoMarkerPairChange();
      },
      executable: true,
      // Edit history undo/redo. Only meaningful while a pair is open —
      // kept off the bar in default / global-editor. Same parenthesized
      // Shift treatment as the Pair chip.
      hintLabel: 'Edit',
      hintDisplayKey: '(Shift) + Alt + Z',
      hintContexts: ['marker-selected'],
      hintOrder: 174,
      hintGroup: 'Undo/Redo',
    },
    {
      id: 'redoMarkerPairChange',
      description: 'Redo time, speed, and crop changes of selected pair',
      displayKey: 'Alt + Shift + Z',
      section: 'Markup',
      category: 'Marker Editing Shortcuts',
      essential: true,
      binding: { code: 'KeyZ', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.redoMarkerPairChange();
      },
      executable: true,
    },

    // ===== Markup / Marker Timing Shortcuts =====
    {
      id: 'moveStartMarkerToCurrentTime',
      description: "Snap the selected pair's start or end marker to the current playhead",
      displayKey: 'Shift + Q',
      section: 'Markup',
      category: 'Marker Timing Shortcuts',
      essential: true,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.moveMarkerToCurrentTime('start');
      },
      guard: markerGuard,
      executable: true,
      // Single chip for both Shift+Q (snap start) and Shift+A (snap end).
      // `Q/A` chord-key notation (rendered as `Q / A` with a slash glyph)
      // communicates the two-key pair under one Shift modifier so the chip
      // stays compact while indicating both bindings.
      hintLabel: 'Set start/end',
      hintDisplayKey: 'Shift + Q/A',
      hintContexts: ['marker-selected'],
      hintOrder: 110,
      hintGroup: 'Markers',
    },
    {
      id: 'moveEndMarkerToCurrentTime',
      description: 'Move end marker to current time',
      displayKey: 'Shift + A',
      section: 'Markup',
      category: 'Marker Timing Shortcuts',
      essential: true,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.moveMarkerToCurrentTime('end');
      },
      guard: markerGuard,
      executable: true,
      // No standalone chip — folded into `moveStartMarkerToCurrentTime`'s
      // `Set start/end` chip via the `Q/A` chord notation.
    },
    {
      id: 'dragMarkerNumbering',
      description: 'Drag start/end marker numbering to new time',
      displayKey: 'Alt + Drag',
      section: 'Markup',
      category: 'Marker Timing Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Drag Marker to Time',
      hintContexts: ['hover-progress-bar'],
      hintOrder: 30,
    },
    {
      id: 'moveMarkerByFrame',
      description: 'Move start/end marker a frame when on left/right half of window',
      displayKey: 'Alt + Shift + Mousewheel',
      section: 'Markup',
      category: 'Marker Timing Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Nudge Marker by Frame',
      hintContexts: ['hover-progress-bar'],
      hintOrder: 40,
    },

    // ===== Markup / Marker Navigation Shortcuts =====
    {
      id: 'togglePrevSelectedMarkerPair',
      description: 'Toggle marker pair selection',
      displayKey: 'Ctrl + Up',
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
      essential: true,
      binding: { code: 'ArrowLeft', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
      // Anchor chip for the Nav expandable. Renders both arrows on the chord
      // so users see they can navigate either direction; the popover details
      // the three modes (jump-only / select-only / select+jump).
      hintLabel: 'Nav',
      hintDisplayKey: 'Ctrl + Left + Right',
      // Only surfaced in `default` (no pair selected yet) — once a pair is
      // open, navigation is less central than the pair-scoped chips, and
      // the user already knows pairs exist.
      hintContexts: ['default'],
      hintOrder: 135,
      hintGroup: 'Markers',
      hintExpandedHelp: [
        { key: 'Ctrl + Left + Right', label: 'Jump to nearest marker' },
        { key: 'Alt + Left + Right', label: 'Select prev / next pair' },
        { key: 'Ctrl + Alt + Left + Right', label: 'Select pair + jump' },
      ],
    },
    {
      id: 'jumpToNearestNextMarker',
      description: 'Jump to nearest next marker',
      displayKey: 'Ctrl + Right',
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
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
      section: 'Markup',
      category: 'Marker Navigation Shortcuts',
      essential: false,
      binding: { code: 'ArrowRight', modifiers: { ctrl: true, shift: false, alt: true } },
      handler: (e) => {
        deps.jumpToNearestMarkerOrPair(e);
      },
      guard: cropAdjDisabled,
      executable: true,
    },

    // ===== Markup / Global Settings Editor =====
    {
      id: 'toggleGlobalSettingsEditor',
      description: 'Toggle global settings editor',
      displayKey: 'W',
      section: 'Markup',
      category: 'Global Settings Editor Shortcuts',
      essential: true,
      binding: { code: 'KeyW', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleGlobalSettingsEditor();
      },
      executable: true,
      hintLabel: 'Settings',
      hintContexts: ['default'],
      hintOrder: 200,
    },
    {
      id: 'toggleEncodingSettingsEditor',
      description: 'Toggle encoding settings editor',
      displayKey: 'Shift + W',
      section: 'Markup',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Encoding',
      hintContexts: ['global-editor'],
      // Ordered after Data group so it doesn't lead the global-editor lane;
      // sits at the end as a related-but-distinct editor toggle.
      hintOrder: 195,
    },
    {
      id: 'updateAllMarkersSpeed',
      description: 'Update all markers to default new marker speed',
      displayKey: 'Alt + Shift + Q',
      section: 'Markup',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.updateAllMarkerPairSpeedsToDefault();
      },
      executable: true,
      hintLabel: 'Speed',
      hintContexts: ['global-editor'],
      hintOrder: 150,
      hintGroup: 'Apply',
    },
    {
      id: 'updateAllMarkersCrop',
      description: 'Update all markers to default new marker crop',
      displayKey: 'Alt + Shift + X',
      section: 'Markup',
      category: 'Global Settings Editor Shortcuts',
      essential: false,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: true, alt: true } },
      handler: () => {
        deps.updateAllMarkerPairCropsToDefault();
      },
      executable: true,
      hintLabel: 'Crop',
      hintContexts: ['global-editor'],
      hintOrder: 160,
      hintGroup: 'Apply',
    },

    // ===== Markup / Cropping Shortcuts =====
    {
      id: 'beginDrawingCrop',
      description: 'Begin drawing crop',
      displayKey: 'X',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.drawCrop();
      },
      executable: true,
      hintLabel: 'Draw',
      // Intentionally not in `hover-crop`: Draw is a "start a new crop"
      // action, and surfacing it on crop-hover would split the CROP group
      // across the hover and state lanes (Draw classifies as `hover`,
      // Preview stays in state), creating two visible CROP groups when only
      // one belongs. State-lane visibility via marker-selected/global-editor
      // is enough — the user is one glance away from the chip regardless.
      hintContexts: ['marker-selected', 'global-editor'],
      hintOrder: 140,
      hintGroup: 'Crop',
    },
    {
      id: 'drawCropMouse',
      description: 'Draw crop',
      displayKey: 'Click + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Drag to draw',
      hintDisplayKey: 'Drag',
      hintContexts: ['crop-drawing'],
      hintOrder: 10,
    },
    {
      id: 'drawCropLockAR',
      description: 'Lock aspect ratio while drawing crop',
      displayKey: 'Alt + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Lock AR',
      hintContexts: ['crop-drawing'],
      hintOrder: 20,
    },
    {
      id: 'drawCropFromCenter',
      description: 'Resize from center while drawing crop',
      displayKey: 'Shift + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'From Center',
      hintContexts: ['crop-drawing'],
      hintOrder: 30,
    },
    {
      id: 'cancelDrawingCrop',
      description: 'Cancel drawing crop',
      displayKey: 'X',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Cancel',
      hintContexts: ['crop-drawing'],
      hintOrder: 40,
    },
    // ===== Mid-manipulation chips (crop-dragging / crop-resizing) =====
    // These mirror the modifier behaviors evaluated inside the active
    // pointermove handlers. They are pure hints — no binding — surfaced
    // once Ctrl+click has already begun a manipulation.
    {
      id: 'dragCropMove',
      description: 'Drag to move crop',
      displayKey: 'Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Drag to move',
      hintContexts: ['crop-dragging'],
      hintOrder: 10,
    },
    {
      id: 'dragCropVerticalOnly',
      description: 'Constrain drag to vertical axis (X locked)',
      displayKey: 'Shift + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Vertical only',
      hintContexts: ['crop-dragging'],
      hintOrder: 20,
    },
    {
      id: 'dragCropHorizontalOnly',
      description: 'Constrain drag to horizontal axis (Y locked)',
      displayKey: 'Alt + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Horizontal only',
      hintContexts: ['crop-dragging'],
      hintOrder: 30,
    },
    {
      id: 'resizeCropDrag',
      description: 'Drag to resize crop',
      displayKey: 'Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Drag to resize',
      hintContexts: ['crop-resizing'],
      hintOrder: 10,
    },
    {
      id: 'resizeCropLockAR',
      description: 'Lock aspect ratio while resizing crop',
      displayKey: 'Alt + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Lock AR',
      hintContexts: ['crop-resizing'],
      hintOrder: 20,
    },
    {
      id: 'resizeCropFromCenter',
      description: 'Resize crop from center',
      displayKey: 'Shift + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'From Center',
      hintContexts: ['crop-resizing'],
      hintOrder: 30,
    },
    {
      id: 'moveOrResizeCrop',
      description: 'Move or resize crop',
      displayKey: 'Ctrl + Click + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Move/Resize',
      hintContexts: ['hover-crop'],
      hintOrder: 10,
      hintGroup: 'Resize',
    },
    {
      id: 'cycleCropDimOpacity',
      description: 'Cycle crop dim opacity up by 0.25',
      displayKey: 'Ctrl + X',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: false, alt: false } },
      handler: () => {
        deps.cycleCropDimOpacity();
      },
      executable: true,
      hintLabel: 'Dim',
      hintContexts: ['hover-crop'],
      hintOrder: 40,
      hintGroup: 'Display',
    },
    {
      id: 'toggleCropCrossHair',
      description: 'Toggle crop crosshair',
      displayKey: 'Ctrl + Shift + X',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.toggleCropCrossHair();
      },
      executable: true,
      hintLabel: 'Crosshair',
      hintContexts: ['hover-crop'],
      hintOrder: 50,
      hintGroup: 'Display',
    },
    {
      id: 'cropArLockedResize',
      description: 'Crop-aspect-ratio-locked resize/draw of crop',
      displayKey: 'Ctrl + Alt + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Lock AR',
      hintContexts: ['hover-crop'],
      hintOrder: 20,
      hintGroup: 'Resize',
    },
    {
      id: 'cropCenterOutResize',
      description: 'Center-out resize/draw of crop',
      displayKey: 'Ctrl + Shift + Drag',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'From Center',
      hintContexts: ['hover-crop'],
      hintOrder: 30,
      hintGroup: 'Resize',
    },
    {
      id: 'cropYOnlyDrag',
      description: 'Horizontally-fixed (Y-only) drag of crop',
      displayKey: 'Ctrl + Shift + Drag',
      section: 'Markup',
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
      section: 'Markup',
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
      section: 'Markup',
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
      description: 'Adjust crop input value at the text cursor with Up/Down arrows',
      displayKey: '',
      displayNote: 'Place cursor on target value',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Up/Down adjust the crop component the text cursor is on
      // (x | y | w | h separated by `:` in the crop string). Left/Right
      // are NOT intercepted — they're just standard text-cursor movement
      // used to position over the target component. The popover documents
      // the step-size modifiers from `cropChangeAmount`.
      hintLabel: 'Adjust at cursor',
      hintDisplayKey: 'Up + Down',
      hintContexts: ['crop-input-focused'],
      hintOrder: 10,
      hintGroup: 'Crop Input',
      hintExpandedHelp: [
        { key: 'Up + Down', label: 'Adjust the component under the text cursor (±10)' },
        { key: 'Alt + Arrow', label: 'Fine step (±1)' },
        { key: 'Shift + Arrow', label: 'Coarse step (±50)' },
        { key: 'Alt + Shift + Arrow', label: 'Coarsest step (±100)' },
      ],
    },
    {
      id: 'cropChangeAmount',
      description: 'Change crop change amount from 10 to 1/50/100',
      displayKey: 'Alt / Shift / Alt + Shift',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Folded into `cropInputArrowAdjust`'s Adjust chip popover above.
    },
    {
      id: 'cropWidthHeightModify',
      description: 'Modify crop width/height instead of x/y offset',
      displayKey: 'Ctrl + ArrowKey',
      section: 'Markup',
      category: 'Cropping Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Note: this applies to the arrow-key crop adjustment MODE on the
      // video overlay (toggled via Alt+X / `toggleArrowKeyCropAdjustment`),
      // NOT to the crop input field. Left off-bar pending the wiring of
      // an "arrow-key-crop-adjust active" hint context.
    },

    // ===== Playback & Export / Playback Shortcuts =====
    {
      id: 'seekFrameByFrame',
      description: 'Seek video frame by frame',
      displayKey: '< / > or Shift + Mousewheel',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Seek',
      hintDisplayKey: 'Shift + Wheel',
      hintContexts: ['hover-video'],
      // hintOrder placed in the 210+ range so the VIDEO group renders AFTER
      // the more specific CROP group when both fire (cursor over the crop
      // overlay, which is a sub-region of the video). Same applies to all
      // other Video group chips.
      hintOrder: 210,
      hintGroup: 'Video',
      hintExpandedHelp: [
        { key: 'Shift + Wheel', label: 'Seek one frame' },
        { key: '< / >', label: 'Seek one frame (keyboard)' },
      ],
    },
    {
      id: 'cycleSeekRate',
      description: 'Cycle seek rate (1-3 frames)',
      displayKey: 'Shift + Mousewheel-click',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Seek Rate',
      hintDisplayKey: 'Shift + Middle-Click',
      hintContexts: ['hover-video'],
      hintOrder: 220,
      hintGroup: 'Video',
    },
    {
      id: 'scrubVideo',
      description: 'Scrub video time left or right',
      displayKey: 'Alt + Click + Drag',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Scrub',
      hintDisplayKey: 'Alt + Drag',
      hintContexts: ['hover-video'],
      hintOrder: 230,
      hintGroup: 'Video',
    },
    {
      id: 'toggleMarkerPairSpeedPreview',
      description: 'Toggle previewing speed',
      displayKey: 'C',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
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
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: true,
      binding: { code: 'KeyC', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleMarkerPairLoop();
      },
      executable: true,
    },
    {
      id: 'toggleCropChartLooping',
      description: 'Toggle auto crop chart section looping',
      displayKey: 'Ctrl + Shift + C',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: false,
      binding: { code: 'KeyC', modifiers: { ctrl: true, shift: true, alt: false } },
      handler: () => {
        deps.toggleCropChartLooping();
      },
      executable: true,
      // Folded into the `toggleAllPreviews` Previews chip popover — sits
      // next to the other C-family preview/loop toggles.
    },
    {
      id: 'toggleForceSetSpeed',
      description: 'Toggle force setting video speed',
      displayKey: 'Q',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleForceSetSpeed();
      },
      executable: true,
      // Anchor chip for the Q-key playback-speed-override family. The
      // `cycleForceSetSpeedValueDown` entry below folds into this chip's
      // popover. Hover-video context groups it with the other playback
      // overrides (Seek / Seek Rate / Scrub).
      hintLabel: 'Force Speed',
      hintDisplayKey: 'Q',
      hintContexts: ['hover-video'],
      hintOrder: 225,
      hintGroup: 'Video',
      hintExpandedHelp: [
        { key: 'Q', label: 'Toggle force-set video speed' },
        { key: 'Alt + Q', label: 'Cycle force-set value down 0.25' },
      ],
    },
    {
      id: 'cycleForceSetSpeedValueDown',
      description: 'Cycle force set video speed value down by 0.25',
      displayKey: 'Alt + Q',
      section: 'Playback & Export',
      category: 'Playback Shortcuts',
      essential: false,
      binding: { code: 'KeyQ', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.cycleForceSetSpeedValueDown();
      },
      executable: true,
      // Folded into `toggleForceSetSpeed`'s Force Speed chip popover.
    },

    // ===== Playback & Export / Preview Shortcuts =====
    {
      id: 'toggleCropPreviewPopOut',
      description: 'Toggle previewing crop in pop-out window',
      displayKey: 'Shift + X',
      section: 'Playback & Export',
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
      description: 'Crop preview: modal window (Ctrl+Alt+X) or pop-out (Shift+X)',
      displayKey: 'Ctrl + Alt + X',
      section: 'Playback & Export',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyX', modifiers: { ctrl: true, shift: false, alt: true } },
      handler: () => {
        deps.toggleCropPreviewModal();
      },
      executable: true,
      hintLabel: 'Preview',
      hintContexts: ['marker-selected'],
      hintOrder: 145,
      hintGroup: 'Crop',
      hintExpandedHelp: [
        { key: 'Ctrl + Alt + X', label: 'Modal window' },
        { key: 'Shift + X', label: 'Pop-out window' },
      ],
    },
    {
      id: 'toggleGammaPreview',
      description: 'Toggle previewing gamma',
      displayKey: 'Alt + C',
      section: 'Playback & Export',
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
      section: 'Playback & Export',
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
      description:
        'Preview toggles: speed (C), loop (Shift+C), gamma (Alt+C), fade loop (Alt+Shift+C), all (Ctrl+Alt+Shift+C)',
      displayKey: 'Ctrl + Alt + Shift + C',
      section: 'Playback & Export',
      category: 'Preview Shortcuts',
      essential: true,
      binding: { code: 'KeyC', modifiers: { ctrl: true, shift: true, alt: true } },
      handler: () => {
        deps.toggleAllPreviews();
      },
      executable: true,
      hintLabel: 'Previews',
      hintContexts: ['marker-selected'],
      // Joins the Markers group (whose label is suppressed in marker-
      // selected mode because it matches the MARKERS mode badge, so the
      // group reads as "unnamed" visually). Sits between Edit (130, the
      // pair overrides editor) and Nav (135) so the per-pair preview
      // toggles cluster with the other per-pair editing actions.
      hintOrder: 132,
      hintGroup: 'Markers',
      hintExpandedHelp: [
        { key: 'Ctrl + Alt + Shift + C', label: 'All Previews' },
        { key: 'C', label: 'Speed' },
        { key: 'Shift + C', label: 'Loop' },
        { key: 'Ctrl + Shift + C', label: 'Crop Chart Loop' },
        { key: 'Alt + C', label: 'Gamma' },
        { key: 'Alt + Shift + C', label: 'Fade Loop' },
        { key: 'Shift + R', label: 'Big video preview thumbnails' },
      ],
    },
    {
      id: 'rotateVideoClock',
      description: 'Toggle previewing rotation 90 degrees clockwise',
      displayKey: 'R',
      section: 'Playback & Export',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        if (theatre()) deps.rotateVideoClock();
        else deps.flashNotTheatreMode();
      },
      executable: true,
      // Anchor chip for the R-key rotation family. The counter-clockwise
      // variant folds into this chip's popover. Hover-video because
      // rotation toggles apply to the player preview directly — no marker
      // pair required.
      hintLabel: 'Rotate',
      hintDisplayKey: 'R',
      hintContexts: ['hover-video'],
      hintOrder: 245,
      hintGroup: 'Video',
      hintExpandedHelp: [
        { key: 'R', label: 'Rotate preview 90° clockwise' },
        { key: 'Alt + R', label: 'Rotate preview 90° counter-clockwise' },
      ],
    },
    {
      id: 'rotateVideoCClock',
      description: 'Toggle previewing rotation 90 degrees anti-clockwise',
      displayKey: 'Alt + R',
      section: 'Playback & Export',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        if (theatre()) deps.rotateVideoCClock();
      },
      executable: true,
      // Folded into `rotateVideoClock`'s Rotate chip popover.
    },
    {
      id: 'toggleBigVideoPreviews',
      description: 'Toggle big video preview thumbnails',
      displayKey: 'Shift + R',
      section: 'Playback & Export',
      category: 'Preview Shortcuts',
      essential: false,
      binding: { code: 'KeyR', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleBigVideoPreviews();
      },
      executable: true,
      // Folded into the `toggleAllPreviews` Previews chip popover — it's
      // a preview-rendering toggle, even though it shares the R key with
      // the rotation family rather than the C-family preview toggles.
    },

    // ===== Playback & Export / Frame Capturer =====
    {
      id: 'captureFrame',
      description: 'Capture frame',
      displayKey: 'E',
      section: 'Playback & Export',
      category: 'Frame Capturer Shortcuts',
      essential: false,
      binding: { code: 'KeyE', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.captureFrame();
      },
      executable: true,
      // Anchor chip for the E-key frame-capture family. The Alt+E zip+
      // download variant (`saveCapturedFrames` below) folds into this
      // chip's popover so both ends of the capture workflow are reachable
      // from one hover.
      hintLabel: 'Capture',
      hintContexts: ['hover-video'],
      hintOrder: 240,
      hintGroup: 'Video',
      hintExpandedHelp: [
        { key: 'E', label: 'Capture current frame' },
        { key: 'Alt + E', label: 'Zip + download captured frames' },
      ],
    },
    {
      id: 'saveCapturedFrames',
      description: 'Zip and download captured frames',
      displayKey: 'Alt + E',
      section: 'Playback & Export',
      category: 'Frame Capturer Shortcuts',
      essential: false,
      binding: { code: 'KeyE', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.saveCapturedFrames();
      },
      executable: true,
      // Folded into `captureFrame`'s Capture chip popover.
    },

    // ===== Playback & Export / Saving and Loading =====
    // DATA group: Save, Load, Copy, Share — visible in resting primaries
    // (default + marker-selected). Save loses its `always` persistence so
    // it can group cohesively with its siblings; the bar's mid-action modes
    // are short-lived enough that this is an acceptable tradeoff.
    {
      id: 'saveMarkersAndSettings',
      description: 'Save markers data as json',
      displayKey: 'S',
      section: 'Playback & Export',
      category: 'Saving and Loading Shortcuts',
      essential: true,
      binding: { code: 'KeyS', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.saveMarkersAndSettings();
      },
      executable: true,
      hintLabel: 'Save',
      hintContexts: ['default', 'marker-selected', 'global-editor'],
      hintOrder: 178,
      hintGroup: 'Data',
    },
    {
      id: 'copyMarkersToClipboard',
      description: 'Copy markers data to clipboard',
      displayKey: 'Alt + S',
      section: 'Playback & Export',
      category: 'Saving and Loading Shortcuts',
      essential: false,
      binding: { code: 'KeyS', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.copyMarkersToClipboard();
      },
      executable: true,
      hintLabel: 'Copy',
      hintContexts: ['default', 'marker-selected', 'global-editor'],
      hintOrder: 186,
      hintGroup: 'Data',
    },
    {
      id: 'copyShareableUrl',
      description: 'Copy shareable URL with embedded markers to clipboard',
      displayKey: 'Shift + S',
      section: 'Playback & Export',
      category: 'Saving and Loading Shortcuts',
      essential: false,
      binding: { code: 'KeyS', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.copyShareableUrl();
      },
      executable: true,
      // Gated by the `shareLink` flag — when off, both the Share chip
      // in the Data group AND the Shift+S key binding skip via the
      // shared guard check in `hints-bar.ts` and `hotkey-engine.ts`.
      // Flip in `feature-flags.ts` to re-enable.
      guard: () => featureFlags.shareLink,
      hintLabel: 'Share',
      hintContexts: ['default', 'marker-selected', 'global-editor'],
      hintOrder: 190,
      hintGroup: 'Data',
    },
    // Order summary now: Previews(170) → Undo/Redo Pair(172) → Undo/Redo
    // Edit(174) → Data Save(178) → Load(182) → Copy(186) → Share(190).
    {
      id: 'toggleMarkersDataCommands',
      description: 'Toggle markers data commands (loading, restoring, and clearing)',
      displayKey: 'G',
      section: 'Playback & Export',
      category: 'Saving and Loading Shortcuts',
      essential: false,
      binding: { code: 'KeyG', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleMarkersDataCommands();
      },
      executable: true,
      hintLabel: 'Load',
      hintContexts: ['default', 'marker-selected', 'global-editor'],
      hintOrder: 182,
      hintGroup: 'Data',
    },

    // ===== Playback & Export / Miscellaneous =====
    {
      id: 'flattenVRVideo',
      description: 'Flatten VR Video',
      displayKey: 'Shift + F',
      section: 'Playback & Export',
      category: 'Miscellaneous Shortcuts',
      essential: false,
      binding: { code: 'KeyF', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.flattenVRVideo();
      },
      executable: true,
    },

    // ===== Dynamic Effects / General Chart Shortcuts =====
    {
      id: 'chartAddPoint',
      description: 'Add chart point',
      displayKey: 'Shift + Click',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Add at Cursor',
      hintContexts: ['hover-speed-chart', 'hover-crop-chart', 'hover-crop-chart-zoompan'],
      hintOrder: 10,
      hintGroup: 'Points',
    },
    {
      id: 'chartAddPointAtCurrentTime',
      description: 'Add chart point at current time',
      displayKey: 'Alt + A',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: { code: 'KeyA', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.addChartPoint();
      },
      guard: markerGuard,
      executable: true,
      hintLabel: 'Add at Time',
      hintContexts: ['hover-speed-chart', 'hover-crop-chart', 'hover-crop-chart-zoompan'],
      hintOrder: 11,
      hintGroup: 'Points',
    },
    {
      id: 'chartDeletePoint',
      description: 'Delete chart point',
      displayKey: 'Alt + Shift + Click',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Delete',
      hintContexts: [
        'hover-speed-chart',
        'hover-speed-chart-point',
        'hover-crop-chart',
        'hover-crop-chart-point',
        'hover-crop-chart-zoompan',
      ],
      hintOrder: 20,
      hintGroup: 'Points',
    },
    {
      id: 'chartMovePointOrPan',
      description: 'Move chart point or pan chart',
      displayKey: 'Click + Drag',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Move',
      hintContexts: ['hover-speed-chart-point', 'hover-crop-chart-point'],
      hintOrder: 5,
      hintGroup: 'Points',
    },
    {
      id: 'chartZoom',
      description: 'Zoom in and out of chart',
      displayKey: 'Ctrl + Mousewheel',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Zoom',
      hintContexts: [
        'hover-speed-chart',
        'hover-speed-chart-point',
        'hover-crop-chart',
        'hover-crop-chart-point',
        'hover-crop-chart-zoompan',
      ],
      hintOrder: 55,
      hintGroup: 'View',
    },
    {
      id: 'chartResetZoom',
      description: 'Reset chart zoom',
      displayKey: 'Ctrl + Click',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Reset',
      hintContexts: [
        'hover-speed-chart',
        'hover-speed-chart-point',
        'hover-crop-chart',
        'hover-crop-chart-point',
        'hover-crop-chart-zoompan',
      ],
      hintOrder: 60,
      hintGroup: 'View',
    },
    {
      id: 'chartSeekToTime',
      description: 'Seek to time on chart time-axis',
      displayKey: 'Right-Click',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Seek',
      hintContexts: [
        'hover-speed-chart',
        'hover-speed-chart-point',
        'hover-crop-chart',
        'hover-crop-chart-point',
        'hover-crop-chart-zoompan',
      ],
      hintOrder: 65,
      hintGroup: 'Playback',
    },
    {
      id: 'chartSetLoopMarker',
      description: 'Set chart loop start/end marker',
      displayKey: 'Shift/Alt + Right-click',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // No standalone chip — folded into the `toggleChartLoop` "Loop"
      // expandable popover below, where it sits beside the toggle binding.
    },
    {
      id: 'toggleChartLoop',
      description: 'Toggle chart marker looping',
      displayKey: 'Shift + D',
      section: 'Dynamic Effects',
      category: 'General Chart Shortcuts',
      essential: false,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: true, alt: false } },
      handler: () => {
        deps.toggleChartLoop();
      },
      executable: true,
      hintLabel: 'Loop',
      hintContexts: [
        'hover-speed-chart',
        'hover-speed-chart-point',
        'hover-crop-chart',
        'hover-crop-chart-point',
        'hover-crop-chart-zoompan',
      ],
      hintOrder: 70,
      hintGroup: 'Playback',
      hintExpandedHelp: [
        { key: 'Shift + D', label: 'Toggle loop playback' },
        { key: 'Shift + Right-Click', label: 'Set loop start' },
        { key: 'Alt + Right-Click', label: 'Set loop end' },
      ],
    },

    // ===== Dynamic Effects / Speed Chart =====
    {
      id: 'toggleSpeedChart',
      description: 'Toggle speed chart',
      displayKey: 'D',
      section: 'Dynamic Effects',
      category: 'Speed Chart Shortcuts',
      essential: true,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: false, alt: false } },
      handler: () => {
        deps.toggleSpeedChart();
      },
      executable: true,
      hintLabel: 'Speed',
      hintContexts: ['marker-selected'],
      hintOrder: 150,
      hintGroup: 'Charts',
    },

    // ===== Dynamic Effects / Crop Chart =====
    {
      id: 'toggleCropChart',
      description: 'Toggle crop chart',
      displayKey: 'Alt + D',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: true,
      binding: { code: 'KeyD', modifiers: { ctrl: false, shift: false, alt: true } },
      handler: () => {
        deps.toggleCropChart();
      },
      executable: true,
      hintLabel: 'Crop',
      hintContexts: ['marker-selected'],
      hintOrder: 160,
      hintGroup: 'Charts',
    },
    {
      id: 'cropChartSelectPoint',
      description: 'Select point as start/end of crop section',
      displayKey: 'Ctrl/Alt + Mouseover',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: true,
      binding: null,
      handler: null,
      executable: false,
      // Anchor chip for the section-selection action. The `Ctrl + Hover`
      // primary chord shows the start variant; the popover documents the
      // matching `Alt + Hover` "set as end" variant alongside.
      hintLabel: 'Set Start',
      hintDisplayKey: 'Ctrl + Mouseover',
      hintContexts: ['hover-crop-chart-point'],
      hintOrder: 40,
      hintGroup: 'Section',
      hintExpandedHelp: [
        { key: 'Ctrl + Mouseover', label: 'Set Start' },
        { key: 'Alt + Mouseover', label: 'Set End' },
      ],
    },
    {
      id: 'cropChartToggleModeSelectPrev',
      description: 'Toggle start/end mode. If in end mode also select prev point',
      displayKey: 'Alt + Mousewheel Down',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Anchor chip for the wheel-driven step action (both Up and Down).
      // Each tick is a half-step — flipping start/end mode in place or
      // advancing/retreating to the next/prev point — so two ticks add up
      // to one full point of section movement.
      hintLabel: 'Step Pt',
      hintDisplayKey: 'Alt + Wheel',
      hintContexts: ['hover-crop-chart-point'],
      hintOrder: 45,
      hintGroup: 'Section',
      hintExpandedHelp: [
        { key: 'Alt + Mousewheel Up', label: 'Step forward' },
        { key: 'Alt + Mousewheel Down', label: 'Step backward' },
      ],
    },
    {
      id: 'cropChartToggleModeSelectNext',
      description: 'Toggle start/end mode. If in start mode also select next point',
      displayKey: 'Alt + Mousewheel Up',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Folded into `cropChartToggleModeSelectPrev`'s Step Pt chip.
    },
    {
      id: 'cropChartInheritCrop',
      description: "Set current point's crop to next/prev point's crop",
      displayKey: 'Ctrl + Alt + Shift + Mousewheel Up/Down',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Copy Crop',
      hintDisplayKey: 'Ctrl + Alt + Shift + Wheel',
      hintContexts: ['hover-crop-chart-point'],
      hintOrder: 50,
      hintGroup: 'Section',
      hintExpandedHelp: [
        { key: 'Ctrl + Alt + Shift + Mousewheel Up', label: 'Copy from next point' },
        { key: 'Ctrl + Alt + Shift + Mousewheel Down', label: 'Copy from previous point' },
      ],
    },
    {
      id: 'cropChartToggleEase',
      description: 'Toggle crop point ease in between auto and instant',
      displayKey: 'Ctrl + Shift + Click',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Ease',
      hintContexts: ['hover-crop-chart-point'],
      hintOrder: 30,
      hintGroup: 'Points',
    },
    {
      id: 'cropChartSetTargetComponent',
      description:
        'Set target crop component of all points following/preceding selected point. Select crop component with cursor in crop input field',
      displayKey: '',
      displayNote: 'a / Shift + A',
      section: 'Dynamic Effects',
      category: 'Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      // Surfaced in the crop-input-focused context — the action depends on
      // the text cursor's position inside the crop input (which component
      // is targeted is read from where the caret sits in `x:y:w:h`).
      hintLabel: 'Propagate Component',
      hintDisplayKey: '(Shift) + A',
      hintContexts: ['crop-input-focused'],
      hintOrder: 30,
      hintGroup: 'Crop Input',
      hintExpandedHelp: [
        { key: 'A', label: 'Apply component under cursor to all FOLLOWING crop points' },
        { key: 'Shift + A', label: 'Apply component under cursor to all PRECEDING crop points' },
      ],
    },

    // ===== Dynamic Effects / ZoomPan Mode Crop Chart =====
    {
      id: 'zoomPanArLockedResize',
      description: 'Crop-aspect-ratio-locked resize of crop',
      displayKey: 'Ctrl + Drag',
      section: 'Dynamic Effects',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'AR Resize',
      hintContexts: ['hover-crop-chart-zoompan'],
      hintOrder: 10,
    },
    {
      id: 'zoomPanFreelyResize',
      description: 'Freely resize crop',
      displayKey: 'Ctrl + Alt + Drag',
      section: 'Dynamic Effects',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Free Resize',
      hintContexts: ['hover-crop-chart-zoompan'],
      hintOrder: 20,
    },
    {
      id: 'zoomPanArLockedDraw',
      description: 'Crop-aspect-ratio-locked draw crop',
      displayKey: 'X, Click + Drag',
      section: 'Dynamic Effects',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Draw AR',
      hintContexts: ['hover-crop-chart-zoompan'],
      hintOrder: 30,
    },
    {
      id: 'zoomPanFreelyDraw',
      description: 'Freely draw crop',
      displayKey: 'X, Alt + Click + Drag',
      section: 'Dynamic Effects',
      category: 'ZoomPan Mode Crop Chart Shortcuts',
      essential: false,
      binding: null,
      handler: null,
      executable: false,
      hintLabel: 'Free Draw',
      hintContexts: ['hover-crop-chart-zoompan'],
      hintOrder: 40,
    },
  ];
}
