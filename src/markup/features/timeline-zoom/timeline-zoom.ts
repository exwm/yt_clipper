/**
 * Timeline zoom (Shift+F): a focus + context view of the timeline. The zoomed bar (focus) is a
 * magnified copy of the progress bar (context), floating just above it, for reading and selecting
 * marker pairs that crowd together on long videos. The progress bar is left untouched so the
 * platform's own seeking, chapters, and previews keep working: CSS-zooming YouTube's bar breaks its
 * seeking, which maps the pointer from untransformed layout.
 *
 * Glossary (use these names in code, comments, and docs):
 * - zoom range: the span of time the zoomed bar shows.
 * - brush: the outline on the progress bar marking the zoom range.
 * - edge handles: the grips at the brush's ends, which resize it.
 * - center handle: the dotted grip on top of the brush, which moves it.
 * - callout: the short border line and arrow under the zoomed bar, pointing at the brush.
 * - leader line: the dotted line from the callout's arrow down to the center handle.
 * - edge fade: the fade at a zoomed bar end where the video continues.
 *
 * The progress bar is dimmed while the zoom is open so the zoomed bar stands out, and the zoom
 * range's start and end times label the zoomed bar's ends.
 *
 * The zoomed bar mimics the progress bar (track, buffered, played, and hover fills, scrubber knob and
 * time tooltip on hover) and draws the marker pairs with the real markers' classes, so they look the
 * same and follow auto-hide. Click or drag it to scrub, click a number to open its pair, scroll to
 * zoom around the middle of the range (Shift+scroll pans).
 *
 * The range math lives in timeline-zoom-math.ts. While shown, a requestAnimationFrame loop aligns
 * the panel to the progress bar, follows the playhead, eases the shown range toward the chosen one, fades
 * with the player's controls, and re-renders (lit-html only patches what changed).
 */
import { html, render, svg } from 'lit-html';
import { appState } from '../../appState';
import { platform } from '../../yt_clipper';
import { getActiveLoop, markerElementFor, pressMarkerNumber, TimelineMapping } from '../../markers';
import { toggleMarkerPairEditorHandler } from '../settings/marker-settings-editor';
import {
  MARKER_HEIGHT_PX,
  MARKER_WIDTH_PX,
  MarkerKind,
  markerClassName,
  markerNumberClassName,
  SELECTED_TICK_HEIGHT_PX,
  SELECTED_TICK_Y_PX,
} from '../../marker-appearance';
import { loopSafeSeekTime } from '../../loop-seek-guard';
import { coalescePerAnimationFrame } from '../../util/frame-coalescer';
import {
  flashMessage,
  getVideoDuration,
  injectCSS,
  OWN_OVERLAY_ATTRIBUTE,
  pauseSafe,
  seekToSafe,
} from '../../util/util';
import { isAnyDragActive, registerActiveDragCleanup } from '../../util/drag-recovery';
import { refreshPlayerControlsAutoHideTimer } from '../../util/videoUtil';
import { registerHoverRegion } from '../hints-bar/hover-region';
import {
  clampRange,
  defaultRange,
  easeRangeToward,
  followPlayhead,
  formatTimelineTime,
  fractionToTime,
  rangeFittingSpan,
  MIN_RANGE_SECONDS,
  panRange,
  resizeRangeEdge,
  ZoomRange,
  timeToFraction,
  visibleLabelIndices,
  wheelNotches,
  zoomRangeAround,
} from './timeline-zoom-math';

// Zoomed bar layout, top to bottom: start numbers, markers (track centred), end numbers. Mirrors the
// progress bar's lanes so the zoomed bar reads as the same control.
const LANE_H = 10;
// Marker lines match the progress bar's (marker-appearance.ts). The number lanes are deliberately more
// compact than the progress bar's, to keep the zoomed bar short.
const MARKER_H = MARKER_HEIGHT_PX;
const ROW_H = LANE_H + MARKER_H + LANE_H;
const TRACK_Y = LANE_H + MARKER_H / 2;
const TRACK_H = 3;
const TRACK_HOVER_H = 5;
const KNOB_R = 6;
const NUMBER_BASELINE = 8;
// Where more timeline continues past an edge of the zoomed bar, its contents fade out over this width.
const EDGE_FADE_PX = 28;
// Invisible hover target around each end marker, for Shift+hover to open its pair like the progress bar.
const END_MARKER_HIT_W = 6;
// Gap between the zoomed bar and the progress bar: room for the callout and the progress bar's
// start numbers.
const PROGRESS_BAR_NUMBERS_CLEARANCE = 24;
// The callout, the only chrome on the zoomed bar: a short stretch of bottom border with an arrow
// pointing down at the brush, just enough to tie the two bars together.
const CALLOUT_GAP_Y = 3;
const CALLOUT_ARROW_W = 10;
const CALLOUT_ARROW_H = 5;
const CALLOUT_LINE_HALF_W = 24;
// Height of the shadow rising from the callout into the zoomed bar.
const CALLOUT_SHADOW_H = 16;
// Rough per-character width of the range time labels, and the clearance kept around them.
const RANGE_TIME_CHAR_PX = 5.5;
const RANGE_TIME_GAP_PX = 4;
// The brush on the progress bar (as in chart navigators and video trimmers): an outline around the
// zoom range, slim edge handles just outside its ends to resize, and a center handle on top to move
// it. The hit areas meet the WCAG 2.2 24px target size even though the drawn shapes stay slim.
const BRUSH_PAD_Y = 1;
const EDGE_HANDLE_W = 5;
const TARGET_MIN = 24;
const CENTER_HANDLE_W = 15;
const CENTER_HANDLE_H = 6;
const CENTER_HANDLE_HIT_W = 28;
// A second press on the center handle within this long refits the zoom range (see fittedRange).
const DOUBLE_CLICK_MS = 350;
// A press on an edge handle that moves less than this is a click, which seeks.
const DRAG_THRESHOLD_PX = 4;
// The drag label floats this far above the center handle, clear of the pointer.
const DRAG_LABEL_LIFT = 20;
// Rough width of one digit of the 6.5pt numbers, for label thinning.
const LABEL_DIGIT_PX = 6;
const LABEL_PADDING_PX = 4;
const WHEEL_ZOOM_FACTOR = 0.8;
const WHEEL_PAN_FRACTION = 0.1;
// Fraction of the remaining distance the shown range covers each frame when the chosen range jumps
// (wheel zoom, paging during playback), for a quick ease instead of a snap.
const EASE_PER_FRAME = 0.3;
// A selected pair is fitted into the zoom range with the playhead (on open, or double-clicking the
// center handle) with at least this much of the pair's length as margin on each side, and the
// range is never narrower than FIT_MIN_SECONDS.
const PAIR_FIT_MARGIN = 1;
const FIT_MIN_SECONDS = 10;
// How often hovering the panel nudges the player so its controls (and this panel) stay shown.
const KEEP_CONTROLS_AWAKE_MS = 500;

// YouTube's own player text (measured from its progress-bar hover time and time display), so the
// zoomed bar's times read like the player's. Other platforms fall back to Roboto/Arial.
const YOUTUBE_PLAYER_FONT = '"YouTube Noto", Roboto, Arial, Helvetica, sans-serif';
const YOUTUBE_TOOLTIP_TEXT = `font: 500 12.98px/15px ${YOUTUBE_PLAYER_FONT};
  color: rgb(238, 238, 238);
  text-shadow: 0 0 2px rgb(0, 0, 0);`;

const TIMELINE_ZOOM_CSS = `
/* Inside the player, above its controls (YouTube: 60) but below its hover thumbnail, popups, and
   settings menu (YouTube: 1001+), so those draw over the zoomed bar. */
.ytc-tz {
  position: absolute;
  z-index: 100;
  pointer-events: none;
  /* No opacity transition: the loop copies the controls' opacity every frame, fade included. */
  animation: ytc-tz-in 0.18s ease-out;
}
@keyframes ytc-tz-in {
  from { opacity: 0; transform: translateY(4px); }
}
.ytc-tz-svg {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
/* Marker numbers take their halo from the shared .markerNumbering class (yt-clipper.css), as on the
   progress bar, and stay out of the content's drop shadow, which would darken them further. */
.ytc-tz text {
  font-size: 6.5pt;
  user-select: none;
}
/* No background, so the video stays visible behind the zoomed bar (like the platform's own bar);
   halos keep its contents legible. */
.ytc-tz-leader-line {
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 1px;
  stroke-dasharray: 2 2;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
}
/* Hovering or dragging the center handle lights the callout and leader line with it, as one control. */
.ytc-tz.center-handle-hover .ytc-tz-callout,
.ytc-tz.center-handle-hover .ytc-tz-leader-line,
.ytc-tz.panning .ytc-tz-callout,
.ytc-tz.panning .ytc-tz-leader-line { stroke: white; }
.ytc-tz.center-handle-hover .ytc-tz-center-handle { fill: white; }
.ytc-tz-callout {
  fill: none;
  stroke: rgba(255, 255, 255, 0.55);
  stroke-width: 1px;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.8));
}
.ytc-tz-callout-shadow { fill: url(#ytc-tz-callout-shadow-fill); pointer-events: none; }
.ytc-tz-row-hit, .ytc-tz-end-hit { fill: transparent; pointer-events: all; cursor: pointer; }
.ytc-tz-track { fill: rgba(255, 255, 255, 0.35); }
/* One shadow for the zoomed track, fills, and marker lines instead of a filter per element, which is
   much cheaper to paint every frame. */
.ytc-tz-content { filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)); }
.ytc-tz-buffered { fill: rgba(255, 255, 255, 0.4); }
.ytc-tz-hover-fill { fill: rgba(255, 255, 255, 0.5); }
.ytc-tz-played { fill: #f00; }
/* Like YouTube's scrubber: always shown while the bar is, and enlarged while the bar is hovered. */
.ytc-tz-knob {
  fill: #f00;
  transform: scale(0.65);
  transform-box: fill-box;
  transform-origin: center;
  transition: transform 0.1s;
}
.ytc-tz.hovering .ytc-tz-knob { transform: scale(1); }
.ytc-tz .marker { pointer-events: none; }
/* The real bar steps back while the zoom is open, so the zoomed bar reads as the focus. */
.ytc-tz-dimmed { opacity: 0.8; transition: opacity 0.15s; }
.ytc-tz-brush {
  fill: none;
  stroke: rgba(255, 255, 255, 0.9);
  stroke-width: 1px;
  shape-rendering: crispEdges;
}
/* Shades the progress bar outside the zoom range, so the range stands out at a glance. The shade
   fades toward its top and bottom edges, so it has no hard edge over bright video. */
.ytc-tz-outside { fill: url(#ytc-tz-outside-fill); pointer-events: none; }
/* A 1px dark line on each side of the white one, so it reads on any frame without a blurred shadow. */
.ytc-tz-brush-edge {
  fill: none;
  stroke: rgba(0, 0, 0, 0.5);
  stroke-width: 3px;
  shape-rendering: crispEdges;
}
.ytc-tz-grip { shape-rendering: crispEdges; }
/* Light grey at rest and white on hover or drag, edged like the brush. */
.ytc-tz-edge-handle, .ytc-tz-center-handle {
  fill: rgb(210, 210, 210);
  stroke: rgba(0, 0, 0, 0.5);
  stroke-width: 1px;
  shape-rendering: crispEdges;
  transition: fill 0.1s;
}
.ytc-tz-grip { stroke: rgba(0, 0, 0, 0.6); stroke-width: 1px; }
.ytc-tz-grip-dot { fill: rgba(0, 0, 0, 0.6); shape-rendering: crispEdges; }
.ytc-tz-hit { fill: transparent; pointer-events: all; }
.ytc-tz.pressed-elsewhere * { pointer-events: none !important; }
.ytc-tz-hit.edge-handle { cursor: ew-resize; }
.ytc-tz-hit.center-handle { cursor: grab; }
.ytc-tz.panning .ytc-tz-hit.center-handle { cursor: grabbing; }
.ytc-tz-edge-handle-group:hover .ytc-tz-edge-handle,
.ytc-tz-center-handle-group:hover .ytc-tz-center-handle,
.ytc-tz.resizing .ytc-tz-edge-handle,
.ytc-tz.panning .ytc-tz-center-handle { fill: white; }
.ytc-tz-time {
  position: absolute;
  font: 500 11px/12px ${YOUTUBE_PLAYER_FONT};
  color: rgb(238, 238, 238);
  /* A crisp 1px outline on four sides; a blurred shadow fades out over bright video. */
  text-shadow: 1px 0 #000, -1px 0 #000, 0 1px #000, 0 -1px #000;
  white-space: nowrap;
  pointer-events: none;
  transition: opacity 0.15s, color 0.15s;
}
.ytc-tz-time.end { transform: translateX(-100%); }
.ytc-tz.hovering .ytc-tz-time { opacity: 0.6; }
.ytc-tz.resizing .ytc-tz-time,
.ytc-tz.panning .ytc-tz-time { color: white; }
.ytc-tz-drag-label {
  position: absolute;
  transform: translateX(-50%);
  ${YOUTUBE_TOOLTIP_TEXT}
  white-space: nowrap;
  pointer-events: none;
  display: none;
}
.ytc-tz.resizing .ytc-tz-drag-label,
.ytc-tz.panning .ytc-tz-drag-label { display: block; }
.ytc-tz-tooltip {
  position: absolute;
  transform: translateX(-50%);
  ${YOUTUBE_TOOLTIP_TEXT}
  white-space: nowrap;
  pointer-events: none;
  display: none;
}
.ytc-tz.hovering .ytc-tz-tooltip { display: block; }`;

interface PairSpan {
  index: number;
  start: number;
  end: number;
}

interface TimelineSnapshot {
  duration: number;
  playhead: number;
  pairs: PairSpan[];
  selectedIndex: number | null;
  // A start marker placed but not yet closed by an end marker.
  pendingStart: number | null;
  buffered: [number, number][];
}

/** Panel-local geometry, measured from the progress bar each frame. */
interface PanelLayout {
  width: number;
  progressBarTop: number;
  progressBarHeight: number;
  // The real markers' band. Platform CSS places it to straddle the visible track, which can be much
  // thinner than the bar element (as on the video.js player), so the brush follows it.
  markersBandTop: number;
  markersBandHeight: number;
}

let cssInjected = false;
let panel: HTMLDivElement | null = null;
let svgEl: SVGSVGElement | null = null;
let timesEl: HTMLDivElement | null = null;
let tooltipEl: HTMLDivElement | null = null;
// The range the user chose, and the range on screen, which eases toward it.
let zoomRange: ZoomRange | null = null;
let shownRange: ZoomRange | null = null;
let layout: PanelLayout | null = null;
let loopId = 0;
let hoverX: number | null = null;
let lastKeepAwake = 0;
// True while a drag on the panel (brush or scrub) is in progress.
let dragging = false;
// What a brush drag is changing, for the live drag label: one edge, or the whole range.
let brushDrag: 'start' | 'end' | 'move' | null = null;
// Where a scrub on the zoomed bar is seeking to. The knob shows it until the seeks catch up, as the
// platform's bar does, rather than stepping along as each seek lands.
let scrubTime: number | null = null;
let lastCenterHandlePress = 0;
let disposeHoverRegion: (() => void) | null = null;
// Ends the drag in progress, if any (see beginDrag).
let endActiveDrag: (() => void) | null = null;
// Whether the range pages to keep the playhead in view. A user move that leaves the playhead
// outside turns it off, or the next frame would page straight back and undo the move. It turns
// back on once the playhead is inside the range again, or after any seek (e.g. a click on the
// platform's progress bar), so the range still follows a deliberate jump.
let followingPlayhead = true;
// True while any registered drag is held (a marker number, crop, chart or speed point drag), and
// until its last seek lands. Its seeks don't page the range: an Alt+dragged number maps the pointer
// through the range shown at the press, so paging would pull the marker off the pointer. After a
// drag begun off the panel, the range catches up on release (see pressBeganOnPanel).
let holdingForDrag = false;
// Whether the last press began on the panel. A drag there that ends outside the range leaves the
// range where it is; one elsewhere (scrubbing the video) is a jump the range follows.
let pressBeganOnPanel = false;

export function toggleTimelineZoom(): void {
  if (panel) {
    destroyPanel();
    flashMessage('Timeline zoom: off', 'grey');
    return;
  }
  const duration = getVideoDuration(platform, appState.video);
  if (!(duration > 0)) {
    flashMessage('Timeline zoom needs the video duration, which is not available yet', 'grey');
    return;
  }
  zoomRange = fittedRange(duration);
  shownRange = zoomRange;
  createPanel();
  flashMessage('Timeline zoom: on (Shift+F to close)', 'olive');
}

/** A zoom range fitting the playhead and the selected pair, if any (with a margin of the pair's
 *  length each side, and at least FIT_MIN_SECONDS), or else the playhead's default range. */
function fittedRange(duration: number): ZoomRange {
  // eslint-disable-next-line no-restricted-syntax -- a view range around the playhead, not a frame decision
  const playhead = appState.video.getCurrentTime();
  const isPairEditorOpen = appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen;
  const pair = isPairEditorOpen ? appState.markerPairs[appState.prevSelectedMarkerPairIndex] : null;
  if (!pair) return defaultRange(playhead, duration);
  return rangeFittingSpan(
    Math.min(pair.start, playhead),
    Math.max(pair.end, playhead),
    (pair.end - pair.start) * PAIR_FIT_MARGIN,
    FIT_MIN_SECONDS,
    duration
  );
}

/** Apply a range the user chose. Direct manipulation (drags) shows it at once; jumps (wheel) ease. */
function setRangeByUser(next: ZoomRange, { animate = false } = {}): void {
  // The panel fades with the player's controls, so keep them up while the range is being changed
  // (a wheel zoom moves no pointer).
  keepPlayerControlsAwake();
  zoomRange = next;
  if (!animate) shownRange = next;
  // eslint-disable-next-line no-restricted-syntax -- whether the view shows the playhead, not a frame decision
  const playhead = appState.video.getCurrentTime();
  followingPlayhead = playhead >= next.start && playhead <= next.end;
}

function onVideoSeeked(): void {
  if (!holdingForDrag) followingPlayhead = true;
}

function readSnapshot(): TimelineSnapshot {
  const video = appState.video;
  const isPairEditorOpen = appState.isSettingsEditorOpen && !appState.wasGlobalSettingsEditorOpen;
  const buffered: [number, number][] = [];
  for (let i = 0; i < video.buffered.length; i++) {
    buffered.push([video.buffered.start(i), video.buffered.end(i)]);
  }
  if (scrubTime != null && !dragging && !video.seeking) scrubTime = null;
  return {
    duration: getVideoDuration(platform, video),
    // eslint-disable-next-line no-restricted-syntax -- the zoomed bar's playhead line, as the progress bar draws it
    playhead: scrubTime ?? video.getCurrentTime(),
    pairs: appState.markerPairs.map((pair, index) => ({ index, start: pair.start, end: pair.end })),
    selectedIndex: isPairEditorOpen ? appState.prevSelectedMarkerPairIndex : null,
    pendingStart: appState.isNextMarkerStart ? null : appState.startTime,
    buffered,
  };
}

const panelTemplate = () => html`
  <svg class="ytc-tz-svg"></svg>
  <div class="ytc-tz-times"></div>
  <div class="ytc-tz-tooltip"></div>
  <div class="ytc-tz-drag-label"></div>
`;

/** The progress bar and yt_clipper's markers and numbers on it, outermost only: opacity compounds, so a
 *  nested element dimmed with its parent would fade twice. */
function progressBarElements(): Element[] {
  const elements = [
    appState.hooks.progressBar,
    appState.markersDiv,
    appState.markerNumberingsDiv,
  ].filter((element): element is HTMLElement => element != null);
  return elements.filter(
    (element) => !elements.some((other) => other !== element && other.contains(element))
  );
}
function setProgressBarDimmed(isDimmed: boolean): void {
  for (const element of progressBarElements()) element.classList.toggle('ytc-tz-dimmed', isDimmed);
}

// While a press that began elsewhere is held (dragging the platform's playhead), the panel ignores the
// pointer, so its handles don't light up or show their cursors as the drag passes over them.
function onDocumentPointerDown(e: PointerEvent): void {
  pressBeganOnPanel = !!panel?.contains(e.target as Node);
  if (panel && !pressBeganOnPanel) panel.classList.add('pressed-elsewhere');
}
function onDocumentPointerUp(): void {
  panel?.classList.remove('pressed-elsewhere');
}

// While the pointer is on the progress bar it returns to full strength.
function onProgressBarEnter(): void {
  setProgressBarDimmed(false);
}
function onProgressBarLeave(): void {
  setProgressBarDimmed(true);
}

function createPanel(): void {
  if (!cssInjected) {
    injectCSS(TIMELINE_ZOOM_CSS, 'yt-clipper-timeline-zoom-css');
    cssInjected = true;
  }
  panel = document.createElement('div');
  panel.className = 'ytc-tz';
  panel.setAttribute(OWN_OVERLAY_ATTRIBUTE, '');
  render(panelTemplate(), panel);
  svgEl = panel.querySelector('svg');
  timesEl = panel.querySelector('.ytc-tz-times');
  tooltipEl = panel.querySelector('.ytc-tz-tooltip');
  panel.addEventListener('pointerdown', onPointerDown);
  panel.addEventListener('pointermove', onPointerMove);
  panel.addEventListener('pointerover', onPointerOver);
  panel.addEventListener('pointerleave', onPointerLeave);
  // Not passive: the wheel zooms the timeline instead of reaching the page's frame-skip handlers.
  panel.addEventListener('wheel', onWheel, { passive: false });
  panelParent().appendChild(panel);
  disposeHoverRegion = registerHoverRegion(panel, 'timeline-zoom');
  appState.hooks.progressBar.addEventListener('pointerenter', onProgressBarEnter);
  appState.hooks.progressBar.addEventListener('pointerleave', onProgressBarLeave);
  setProgressBarDimmed(true);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('pointerup', onDocumentPointerUp, true);
  window.addEventListener('pointercancel', onDocumentPointerUp, true);
  window.addEventListener('blur', onDocumentPointerUp);
  appState.video.addEventListener('seeked', onVideoSeeked);
  followingPlayhead = true;
  holdingForDrag = false;
  // The panel fades with the player's controls, so wake them: otherwise opening it while they are
  // auto-hidden (pointer off the player) shows nothing.
  refreshPlayerControlsAutoHideTimer();
  loop();
}

function destroyPanel(): void {
  // Finish a drag in progress first, so a scrub resumes playback and its pending seek lands.
  endActiveDrag?.();
  cancelAnimationFrame(loopId);
  loopId = 0;
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('pointerup', onDocumentPointerUp, true);
  window.removeEventListener('pointercancel', onDocumentPointerUp, true);
  window.removeEventListener('blur', onDocumentPointerUp);
  appState.video.removeEventListener('seeked', onVideoSeeked);
  appState.hooks.progressBar.removeEventListener('pointerenter', onProgressBarEnter);
  appState.hooks.progressBar.removeEventListener('pointerleave', onProgressBarLeave);
  setProgressBarDimmed(false);
  disposeHoverRegion?.();
  disposeHoverRegion = null;
  if (panel) {
    render(null, panel);
    panel.remove();
  }
  panel = null;
  svgEl = null;
  timesEl = null;
  tooltipEl = null;
  layout = null;
  hoverX = null;
  dragging = false;
  brushDrag = null;
  scrubTime = null;
}

/** The player, so the panel shares its stacking context (see the z-index note in the CSS). Being
 *  absolutely positioned inside it, the panel also scrolls with the page natively: a fixed panel
 *  re-placed each frame lags the compositor's scroll and visibly trails the bar. In fullscreen the
 *  player is normally inside the fullscreen element; if not, the panel moves into that element. */
function panelParent(): HTMLElement {
  let parent: HTMLElement = appState.hooks.player ?? document.documentElement;
  // yt_clipper's capture listeners for Alt+drag scrub, Ctrl+drag crop, and click-to-play sit on
  // these hooks. Nested inside one (on the generic site the player is that hook), the panel's
  // presses would reach them first, so step out past it.
  const listeningHooks = [appState.hooks.cropMouseManipulation, appState.hooks.playerClickZone];
  while (parent.parentElement && listeningHooks.some((hook) => hook?.contains(parent))) {
    parent = parent.parentElement;
  }
  const fullscreen = document.fullscreenElement as HTMLElement | null;
  return fullscreen && !fullscreen.contains(parent) ? fullscreen : parent;
}

/** The viewport position of the panel's containing block's padding edge, which its left and top
 *  are measured from. A page-level panel (no positioned ancestor) is placed in page coordinates. */
function panelOrigin(): { left: number; top: number } {
  const origin = panel?.offsetParent as HTMLElement | null;
  if (!origin || origin === document.body || origin === document.documentElement) {
    return { left: -window.scrollX, top: -window.scrollY };
  }
  const rect = origin.getBoundingClientRect();
  return {
    left: rect.left + origin.clientLeft - origin.scrollLeft,
    top: rect.top + origin.clientTop - origin.scrollTop,
  };
}
function onFullscreenChange(): void {
  if (panel) panelParent().appendChild(panel);
}

function loop(): void {
  loopId = requestAnimationFrame(loop);
  if (!panel || !svgEl) return;
  const controlsOpacity = playerControlsOpacity();
  const snapshot = readSnapshot();
  if (!(snapshot.duration > 0)) return;
  zoomRange = clampRange(
    zoomRange ?? defaultRange(snapshot.playhead, snapshot.duration),
    snapshot.duration,
    MIN_RANGE_SECONDS
  );
  const isPlayheadInRange =
    snapshot.playhead >= zoomRange.start && snapshot.playhead <= zoomRange.end;
  if (isAnyDragActive()) {
    holdingForDrag = true;
  } else if (holdingForDrag && !appState.video.seeking) {
    // As after a user move, so the range doesn't jump on release.
    holdingForDrag = false;
    followingPlayhead = isPlayheadInRange || !pressBeganOnPanel;
  }
  if (isPlayheadInRange) {
    followingPlayhead = true;
  } else if (followingPlayhead && !holdingForDrag && !isOutsideActiveLoop(snapshot.playhead)) {
    zoomRange = followPlayhead(zoomRange, snapshot.playhead, snapshot.duration, MIN_RANGE_SECONDS);
  }
  shownRange = easeRangeToward(shownRange ?? zoomRange, zoomRange, EASE_PER_FRAME);
  panel.dataset.rangeStart = `${zoomRange.start}`;
  panel.dataset.rangeEnd = `${zoomRange.end}`;
  // The eased range on screen; tests wait for it to reach the chosen range before screenshots.
  panel.dataset.shownStart = `${shownRange.start}`;
  panel.dataset.shownEnd = `${shownRange.end}`;
  if (!fadeWithPlayerControls(controlsOpacity)) return;
  layout = alignToProgressBar();
  if (!layout) return;
  svgEl.setAttribute('width', `${layout.width}`);
  svgEl.setAttribute('height', `${layout.progressBarTop + layout.progressBarHeight}`);
  render(timelineTemplate(snapshot, shownRange, layout, hoverX), svgEl);
  if (timesEl) render(rangeTimesTemplate(shownRange, layout.width), timesEl);
  updateDragLabel(snapshot.duration, shownRange, layout);
  updateTooltip();
}

/** Place the panel so its bottom covers the progress bar and its top holds the zoomed bar just above
 *  the progress bar's start numbers. Null when the progress bar has no layout yet. */
function alignToProgressBar(): PanelLayout | null {
  if (!panel) return null;
  // Markers are positioned as a percentage of the markers svg, so map time through its box.
  const markers = appState.markersSvg.getBoundingClientRect();
  const bar = appState.hooks.progressBar.getBoundingClientRect();
  if (!markers.width || !bar.height) {
    panel.style.display = 'none';
    return null;
  }
  panel.style.display = '';
  const top = bar.top - PROGRESS_BAR_NUMBERS_CLEARANCE - ROW_H;
  const origin = panelOrigin();
  panel.style.left = `${markers.left - origin.left}px`;
  panel.style.top = `${top - origin.top}px`;
  panel.style.width = `${markers.width}px`;
  panel.style.height = `${bar.bottom - top}px`;
  return {
    width: markers.width,
    progressBarTop: bar.top - top,
    progressBarHeight: bar.height,
    markersBandTop: markers.top - top,
    markersBandHeight: MARKER_HEIGHT_PX,
  };
}

/** While a loop keeps playback inside a range, a playhead outside it is about to be pulled back, so
 *  following it there would make the range jump out and straight back. */
function isOutsideActiveLoop(playhead: number): boolean {
  const loop = getActiveLoop();
  return loop != null && (playhead < loop.start || playhead > loop.end);
}

/** The player controls' opacity this frame, mid-transition included, so the panel can follow the
 *  platform's own fade curve exactly. Read at the start of the frame, before any of the panel's
 *  writes, so it costs no extra style recalculation. */
function playerControlsOpacity(): number {
  const style = getComputedStyle(appState.hooks.controls);
  return style.display === 'none' ? 0 : parseFloat(style.opacity);
}

/** Show the panel at the controls' opacity, so the zoomed bar and brush show and hide with the
 *  progress bar. Fully hidden, it skips this frame's layout and render. */
function fadeWithPlayerControls(opacity: number): boolean {
  if (!panel) return false;
  const isHidden = opacity < 0.05;
  panel.style.opacity = `${opacity}`;
  panel.style.visibility = isHidden ? 'hidden' : '';
  return !isHidden;
}

interface MarkerView {
  pair: PairSpan;
  kind: MarkerKind;
  x: number;
  isSelected: boolean;
  showNumber: boolean;
}

/** A marker's number, unless thinned out: start numbers above the bar, end below. */
const markerNumberTemplate = ({ pair, kind, x, isSelected, showNumber }: MarkerView) => {
  if (!showNumber) return '';
  const numberClass = markerNumberClassName(kind, isSelected);
  const numberY = kind === 'start' ? NUMBER_BASELINE : LANE_H + MARKER_H + NUMBER_BASELINE;
  return svg`<text class=${numberClass} data-pair-index=${pair.index} data-marker=${kind} x=${x} y=${numberY} text-anchor="middle">${pair.index + 1}</text>`;
};

/** One marker line, with the selected tick and, for an end marker, its Shift+hover target. */
const markerTemplate = ({ pair, kind, x, isSelected }: MarkerView) => {
  return svg`
    <rect class=${markerClassName(kind, isSelected)} x=${x - MARKER_WIDTH_PX / 2} y=${LANE_H} width=${MARKER_WIDTH_PX} height=${MARKER_H}></rect>
    ${
      isSelected
        ? svg`<rect class="selected-marker-overlay" x=${x - MARKER_WIDTH_PX / 2} y=${LANE_H + SELECTED_TICK_Y_PX} width=${MARKER_WIDTH_PX} height=${SELECTED_TICK_HEIGHT_PX}></rect>`
        : ''
    }
    ${
      kind === 'end'
        ? svg`<rect class="ytc-tz-end-hit" data-end-of-pair=${pair.index} x=${x - END_MARKER_HIT_W / 2} y=${LANE_H} width=${END_MARKER_HIT_W} height=${MARKER_H}></rect>`
        : ''
    }
  `;
};

/** The brush on the progress bar: an outline around the zoom range, edge handles just outside its
 *  ends to resize it, and a center handle on top to move it. Only the handles take the pointer, so
 *  clicks inside the brush still seek the progress bar. */
const brushTemplate = (rangeX0: number, rangeX1: number, layout: PanelLayout) => {
  // On whole pixels, so the slim lines stay sharp instead of smearing across two pixel columns.
  const x0 = Math.round(rangeX0);
  const x1 = Math.round(rangeX1);
  const brushTop = Math.round(layout.markersBandTop - BRUSH_PAD_Y);
  const brushH = Math.round(layout.markersBandHeight + 2 * BRUSH_PAD_Y);
  // Hit areas are at least TARGET_MIN tall, centred on the slim handles.
  const edgeHandleHitH = Math.max(brushH, TARGET_MIN);
  const edgeHandleHitTop = brushTop + brushH / 2 - edgeHandleHitH / 2;
  const edgeHandle = (edge: 'start' | 'end', x: number) => svg`
    <g class="ytc-tz-edge-handle-group">
      <title>Drag to resize the zoom range</title>
      <rect class="ytc-tz-edge-handle" x=${x + 0.5} y=${brushTop + 0.5} width=${EDGE_HANDLE_W - 1} height=${brushH - 1}></rect>
      <line class="ytc-tz-grip" x1=${x + EDGE_HANDLE_W / 2} y1=${brushTop + 3} x2=${x + EDGE_HANDLE_W / 2} y2=${brushTop + brushH - 3}></line>
      <rect class="ytc-tz-hit edge-handle" data-edge=${edge} x=${x + EDGE_HANDLE_W / 2 - TARGET_MIN / 2} y=${edgeHandleHitTop} width=${TARGET_MIN} height=${edgeHandleHitH}></rect>
    </g>
  `;
  const centerHandleX = Math.round((x0 + x1) / 2 - CENTER_HANDLE_W / 2);
  const centerHandleY = brushTop - CENTER_HANDLE_H + 1;
  const dotY = centerHandleY + Math.floor(CENTER_HANDLE_H / 2);
  // The center handle's hit area grows upward (into the progress bar's start-number lane) rather
  // than down over the brush, so clicks inside the brush still reach the progress bar. It stops at
  // the callout's arrow so it never covers the zoomed bar's end numbers.
  const centerHandleHitBottom = centerHandleY + CENTER_HANDLE_H;
  const centerHandleHitTop = Math.max(
    centerHandleHitBottom - TARGET_MIN,
    ROW_H + CALLOUT_GAP_Y + CALLOUT_ARROW_H
  );
  return svg`
    <defs>
      <linearGradient id="ytc-tz-outside-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.1" stop-color="black" stop-opacity="0"></stop>
        <stop offset="0.3" stop-color="black" stop-opacity="0.15"></stop>
        <stop offset="0.42" stop-color="black" stop-opacity="0.4"></stop>
        <stop offset="0.58" stop-color="black" stop-opacity="0.4"></stop>
        <stop offset="0.7" stop-color="black" stop-opacity="0.15"></stop>
        <stop offset="0.9" stop-color="black" stop-opacity="0"></stop>
      </linearGradient>
    </defs>
    <rect class="ytc-tz-outside" x="0" y=${brushTop} width=${Math.max(x0, 0)} height=${brushH}></rect>
    <rect class="ytc-tz-outside" x=${x1} y=${brushTop} width=${Math.max(layout.width - x1, 0)} height=${brushH}></rect>
    <rect class="ytc-tz-brush-edge" x=${x0 + 0.5} y=${brushTop + 0.5} width=${Math.max(x1 - x0 - 1, 1)} height=${brushH - 1}></rect>
    <rect class="ytc-tz-brush" x=${x0 + 0.5} y=${brushTop + 0.5} width=${Math.max(x1 - x0 - 1, 1)} height=${brushH - 1}></rect>
    <g class="ytc-tz-center-handle-group">
      <title>Drag to move the zoom range</title>
      <rect class="ytc-tz-center-handle" x=${centerHandleX + 0.5} y=${centerHandleY + 0.5} width=${CENTER_HANDLE_W - 1} height=${CENTER_HANDLE_H - 1}></rect>
      ${[-3, 0, 3].map(
        (dx) =>
          svg`<rect class="ytc-tz-grip-dot" x=${centerHandleX + Math.floor(CENTER_HANDLE_W / 2) + dx} y=${dotY} width="1" height="1"></rect>`
      )}
      <rect class="ytc-tz-hit center-handle" x=${centerHandleX + CENTER_HANDLE_W / 2 - CENTER_HANDLE_HIT_W / 2} y=${centerHandleHitTop} width=${CENTER_HANDLE_HIT_W} height=${centerHandleHitBottom - centerHandleHitTop}></rect>
    </g>
    ${edgeHandle('start', x0 - EDGE_HANDLE_W)}
    ${edgeHandle('end', x1)}
  `;
};

/** The leader line: dotted, from the callout's arrow tip down to the center handle, so the two read
 *  as one control for the zoom range. Both sit at the range's centre. */
const leaderLineTemplate = (rangeCenterX: number, width: number, layout: PanelLayout) => {
  const x = Math.min(Math.max(rangeCenterX, CALLOUT_ARROW_W / 2), width - CALLOUT_ARROW_W / 2);
  const top = ROW_H + CALLOUT_GAP_Y + CALLOUT_ARROW_H;
  const centerHandleTop = layout.markersBandTop - BRUSH_PAD_Y - CENTER_HANDLE_H + 1;
  return centerHandleTop > top
    ? svg`<line class="ytc-tz-leader-line" x1=${x} y1=${top} x2=${rangeCenterX} y2=${centerHandleTop}></line>`
    : '';
};

/** Rough rendered width of a range time label, for keeping end numbers out from under it. */
function rangeTimeWidth(time: number, secondsPerPixel: number): number {
  return formatTimelineTime(time, secondsPerPixel).length * RANGE_TIME_CHAR_PX;
}

/** Where the arrowX bracket sits: its border line's y and ends, and the arrowX's x. */
function calloutGeometry(width: number, arrowTargetX: number) {
  const arrowX = Math.min(Math.max(arrowTargetX, CALLOUT_ARROW_W / 2), width - CALLOUT_ARROW_W / 2);
  return {
    bottom: ROW_H + CALLOUT_GAP_Y,
    arrowX,
    lineStart: Math.max(arrowX - CALLOUT_LINE_HALF_W, 0),
    lineEnd: Math.min(arrowX + CALLOUT_LINE_HALF_W, width),
  };
}

/** Path commands tracing the callout's border line and arrow from its start to `lineEnd`. */
function calloutOutline({ bottom, arrowX, lineEnd }: ReturnType<typeof calloutGeometry>): string {
  return [
    `H${arrowX - CALLOUT_ARROW_W / 2} L${arrowX},${bottom + CALLOUT_ARROW_H} L${arrowX + CALLOUT_ARROW_W / 2},${bottom}`,
    `H${lineEnd}`,
  ].join(' ');
}

/** SVG path for the callout: a short stretch of bottom border under the zoomed bar with an arrow in
 *  it, pointing down at the brush, like the arrow of a popover over that region. */
function calloutPath(width: number, arrowTargetX: number): string {
  const geometry = calloutGeometry(width, arrowTargetX);
  return `M${geometry.lineStart},${geometry.bottom} ${calloutOutline(geometry)}`;
}

/** A soft shadow filling the callout from above, darkest down at its border line and arrow, so the
 *  callout reads as the lip the zoomed bar is projected from. Its ends fade out sideways. */
const calloutShadowTemplate = (width: number, arrowTargetX: number) => {
  const geometry = calloutGeometry(width, arrowTargetX);
  const { bottom, lineStart, lineEnd } = geometry;
  const top = bottom - CALLOUT_SHADOW_H;
  const d = `M${lineStart},${top} V${bottom} ${calloutOutline(geometry)} V${top} Z`;
  return svg`
    <defs>
      <linearGradient id="ytc-tz-callout-shadow-fill" gradientUnits="userSpaceOnUse" x1="0" y1=${top} x2="0" y2=${bottom + CALLOUT_ARROW_H}>
        <stop offset="0" stop-color="black" stop-opacity="0"></stop>
        <stop offset="1" stop-color="black" stop-opacity="0.35"></stop>
      </linearGradient>
      <linearGradient id="ytc-tz-callout-shadow-sides" gradientUnits="userSpaceOnUse" x1=${lineStart} y1="0" x2=${lineEnd} y2="0">
        <stop offset="0" stop-color="white" stop-opacity="0"></stop>
        <stop offset="0.35" stop-color="white" stop-opacity="1"></stop>
        <stop offset="0.65" stop-color="white" stop-opacity="1"></stop>
        <stop offset="1" stop-color="white" stop-opacity="0"></stop>
      </linearGradient>
      <mask id="ytc-tz-callout-shadow-mask" maskUnits="userSpaceOnUse" x=${lineStart} y=${top} width=${lineEnd - lineStart} height=${CALLOUT_SHADOW_H + CALLOUT_ARROW_H}>
        <rect x=${lineStart} y=${top} width=${lineEnd - lineStart} height=${CALLOUT_SHADOW_H + CALLOUT_ARROW_H} fill="url(#ytc-tz-callout-shadow-sides)"></rect>
      </mask>
    </defs>
    <path class="ytc-tz-callout-shadow" d=${d} mask="url(#ytc-tz-callout-shadow-mask)"></path>
  `;
};

const timelineTemplate = (
  snapshot: TimelineSnapshot,
  range: ZoomRange,
  layout: PanelLayout,
  hoverX: number | null
) => {
  const width = layout.width;
  const toZoomedX = (time: number) => timeToFraction(range, time) * width;
  const toProgressBarX = (time: number) => (time / snapshot.duration) * width;
  const clampX = (x: number) => Math.min(Math.max(x, 0), width);
  const labelGap = String(snapshot.pairs.length).length * LABEL_DIGIT_PX + LABEL_PADDING_PX;
  // Markers inside the zoom range only, each lane thinned on its own; the svg does not clip, so
  // one outside would draw past the panel edge.
  const markersIn = (kind: MarkerKind): MarkerView[] => {
    const inRange = snapshot.pairs
      .map((pair) => ({ pair, x: toZoomedX(pair[kind]) }))
      .filter(({ x }) => x >= 0 && x <= width);
    const shown = new Set(
      visibleLabelIndices(
        inRange.map(({ pair, x }) => ({ x, priority: pair.index === snapshot.selectedIndex })),
        labelGap
      )
    );
    return inRange.map(({ pair, x }, i) => ({
      pair,
      kind,
      x,
      isSelected: pair.index === snapshot.selectedIndex,
      showNumber: shown.has(i) && !(kind === 'end' && underRangeTime(x)),
    }));
  };
  // The range times sit at the ends of the end-number lane; hide end numbers they would cover.
  const secondsPerPixel = (range.end - range.start) / width;
  const startTimeW = rangeTimeWidth(range.start, secondsPerPixel);
  const endTimeW = rangeTimeWidth(range.end, secondsPerPixel);
  const underRangeTime = (x: number) =>
    x < startTimeW + RANGE_TIME_GAP_PX || x > width - endTimeW - RANGE_TIME_GAP_PX;
  const markers = [...markersIn('start'), ...markersIn('end')];
  const brushX0 = toProgressBarX(range.start);
  const brushX1 = toProgressBarX(range.end);
  const trackH = hoverX != null ? TRACK_HOVER_H : TRACK_H;
  const trackTop = TRACK_Y - trackH / 2;
  const playedX = clampX(toZoomedX(snapshot.playhead));
  const playheadInRange = snapshot.playhead >= range.start && snapshot.playhead <= range.end;
  const pendingX = snapshot.pendingStart == null ? null : toZoomedX(snapshot.pendingStart);
  const fillTo = (x: number, cls: string) =>
    svg`<rect class=${cls} x="0" y=${trackTop} width=${clampX(x)} height=${trackH}></rect>`;
  // Edges with more timeline beyond them fade out.
  const moreBefore = range.start > 0;
  const moreAfter = range.end < snapshot.duration;
  return svg`
    ${brushTemplate(brushX0, brushX1, layout)}
    <g class="ytc-tz-zoomed">
    ${edgeFadeDefs(width, moreBefore, moreAfter)}
    ${calloutShadowTemplate(width, (brushX0 + brushX1) / 2)}
    <path class="ytc-tz-callout" d=${calloutPath(width, (brushX0 + brushX1) / 2)}></path>
    ${leaderLineTemplate((brushX0 + brushX1) / 2, width, layout)}
    <rect class="ytc-tz-row-hit" x="0" y="0" width=${width} height=${ROW_H}></rect>
    <g mask="url(#ytc-tz-edge-mask)">
    <g class="ytc-tz-content">
    <rect class="ytc-tz-track" x="0" y=${trackTop} width=${width} height=${trackH}></rect>
    ${snapshot.buffered.map(([start, end]) => {
      const x0 = clampX(toZoomedX(start));
      const x1 = clampX(toZoomedX(end));
      return x1 > x0
        ? svg`<rect class="ytc-tz-buffered" x=${x0} y=${trackTop} width=${x1 - x0} height=${trackH}></rect>`
        : '';
    })}
    ${hoverX != null && hoverX > playedX ? fillTo(hoverX, 'ytc-tz-hover-fill') : ''}
    ${fillTo(playedX, 'ytc-tz-played')}
    ${markers.map(markerTemplate)}
    ${
      pendingX != null && pendingX >= 0 && pendingX <= width
        ? svg`<rect class=${markerClassName('start')} x=${pendingX - MARKER_WIDTH_PX / 2} y=${LANE_H} width=${MARKER_WIDTH_PX} height=${MARKER_H}></rect>`
        : ''
    }
    ${playheadInRange ? svg`<circle class="ytc-tz-knob" cx=${playedX} cy=${TRACK_Y} r=${KNOB_R}></circle>` : ''}
    </g>
    ${markers.map(markerNumberTemplate)}
    </g>
    </g>
  `;
};

/** Mask that fades the zoomed bar's contents out at an edge where more timeline continues. */
const edgeFadeDefs = (width: number, moreBefore: boolean, moreAfter: boolean) => {
  const fade = Math.min(EDGE_FADE_PX / width, 0.25);
  return svg`
    <defs>
      <linearGradient id="ytc-tz-edge-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2=${width} y2="0">
        <stop offset="0" stop-color="white" stop-opacity=${moreBefore ? 0 : 1}></stop>
        <stop offset=${fade} stop-color="white" stop-opacity="1"></stop>
        <stop offset=${1 - fade} stop-color="white" stop-opacity="1"></stop>
        <stop offset="1" stop-color="white" stop-opacity=${moreAfter ? 0 : 1}></stop>
      </linearGradient>
      <mask id="ytc-tz-edge-mask" maskUnits="userSpaceOnUse" x="-20" y="-20" width=${width + 40} height=${ROW_H + 40}>
        <rect x="-20" y="-20" width=${width + 40} height=${ROW_H + 40} fill="url(#ytc-tz-edge-gradient)"></rect>
      </mask>
    </defs>
  `;
};

/** While an edge handle or the center handle is dragged, show the time(s) it is setting just above
 *  the center handle, clear of the pointer, since the result is otherwise only visible in the zoomed
 *  bar's range times. */
function updateDragLabel(duration: number, range: ZoomRange, layout: PanelLayout): void {
  const label = panel?.querySelector<HTMLDivElement>('.ytc-tz-drag-label');
  if (!label || !brushDrag) return;
  const secondsPerPixel = (range.end - range.start) / layout.width;
  const toProgressBarX = (time: number) => (time / duration) * layout.width;
  const [text, x] =
    brushDrag === 'start'
      ? [formatTimelineTime(range.start, secondsPerPixel), toProgressBarX(range.start)]
      : brushDrag === 'end'
        ? [formatTimelineTime(range.end, secondsPerPixel), toProgressBarX(range.end)]
        : [
            `${formatTimelineTime(range.start, secondsPerPixel)} – ${formatTimelineTime(range.end, secondsPerPixel)}`,
            toProgressBarX((range.start + range.end) / 2),
          ];
  label.textContent = text;
  label.style.left = `${x}px`;
  label.style.top = `${layout.markersBandTop - BRUSH_PAD_Y - CENTER_HANDLE_H - DRAG_LABEL_LIFT}px`;
}

/** The zoom range's start and end times, in the bottom (end-number) lane at the zoomed bar's ends.
 *  The edge fade keeps marker numbers there faint, so the times need no extra row of their own. */
const rangeTimesTemplate = (range: ZoomRange, width: number) => {
  const secondsPerPixel = (range.end - range.start) / width;
  const top = `${LANE_H + MARKER_H - 1}px`;
  return html`
    <div class="ytc-tz-time" style=${`left: 0; top: ${top}`}>
      ${formatTimelineTime(range.start, secondsPerPixel)}
    </div>
    <div class="ytc-tz-time end" style=${`left: ${width}px; top: ${top}`}>
      ${formatTimelineTime(range.end, secondsPerPixel)}
    </div>
  `;
};

function updateTooltip(): void {
  if (!tooltipEl || !shownRange || !layout || hoverX == null) return;
  const secondsPerPixel = (shownRange.end - shownRange.start) / layout.width;
  tooltipEl.textContent = formatTimelineTime(
    fractionToTime(shownRange, hoverX / layout.width),
    secondsPerPixel
  );
  tooltipEl.style.left = `${hoverX}px`;
  tooltipEl.style.top = `${-24}px`;
}

/** The zoomed bar's scrubbable surface: the row itself, or an end marker's Shift+hover target on it. */
function isZoomedBarSurface(element: Element): boolean {
  return (
    element.classList.contains('ytc-tz-row-hit') || element.classList.contains('ytc-tz-end-hit')
  );
}

function panelX(clientX: number): number {
  return panel ? clientX - panel.getBoundingClientRect().left : 0;
}

function keepPlayerControlsAwake(): void {
  const now = performance.now();
  if (now - lastKeepAwake > KEEP_CONTROLS_AWAKE_MS) {
    lastKeepAwake = now;
    refreshPlayerControlsAutoHideTimer();
  }
}

function onPointerMove(e: PointerEvent): void {
  keepPlayerControlsAwake();
  const target = e.target as Element;
  if (!dragging) {
    panel?.classList.toggle(
      'center-handle-hover',
      target.classList.contains('ytc-tz-hit') && target.classList.contains('center-handle')
    );
  }
  if (dragging && !panel?.classList.contains('scrubbing')) return;
  hoverX = isZoomedBarSurface(target) || dragging ? panelX(e.clientX) : null;
  panel?.classList.toggle('hovering', hoverX != null);
}

function onPointerLeave(): void {
  if (dragging) return;
  hoverX = null;
  panel?.classList.remove('hovering', 'center-handle-hover');
}

/** Track a drag on the panel until release, calling `onMove` with each pointer position and `onEnd`
 *  on release. */
function beginDrag(
  e: PointerEvent,
  kind: string,
  onMove: (ev: PointerEvent) => void,
  onEnd?: () => void
): void {
  if (!panel) return;
  const host = panel;
  dragging = true;
  host.classList.add('dragging', kind);
  host.setPointerCapture(e.pointerId);
  // Ended by pointerup/cancel, by drag recovery when the browser drops both (blur, hidden tab), or
  // by closing the panel mid-drag. Each path may race another, so ending is idempotent.
  let ended = false;
  const onUp = (): void => {
    if (ended) return;
    ended = true;
    unregisterRecovery();
    endActiveDrag = null;
    onEnd?.();
    dragging = false;
    brushDrag = null;
    host.classList.remove('dragging', kind);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
    try {
      host.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already released */
    }
  };
  const unregisterRecovery = registerActiveDragCleanup(onUp);
  endActiveDrag = onUp;
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
}

/** Shift+hover an end marker to open its pair, as on the progress bar. */
function onPointerOver(e: PointerEvent): void {
  const target = e.target as Element;
  const index = target.getAttribute('data-end-of-pair') ?? target.getAttribute('data-pair-index');
  if (index == null) return;
  // As on the progress bar, the end marker and both numbers toggle the pair's editor.
  const endMarker = markerElementFor(Number(index), 'end');
  if (endMarker) toggleMarkerPairEditorHandler(e, endMarker);
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !zoomRange || !shownRange || !layout) return;
  const target = e.target as Element;
  e.preventDefault();
  e.stopPropagation();
  const duration = getVideoDuration(platform, appState.video);
  const width = layout.width;
  const progressBarTimeAt = (clientX: number) => (panelX(clientX) / width) * duration;

  const number = target.closest('[data-pair-index]');
  if (number && svgEl) {
    const kind: MarkerKind = number.getAttribute('data-marker') === 'end' ? 'end' : 'start';
    const panelLeft = panel?.getBoundingClientRect().left ?? 0;
    const pressedRange = shownRange;
    const zoomTimeline: TimelineMapping = {
      timeAtClientX: (clientX) => fractionToTime(pressedRange, (clientX - panelLeft) / width),
    };
    pressMarkerNumber(e, Number(number.getAttribute('data-pair-index')), kind, zoomTimeline, svgEl);
    return;
  }

  const startRange = zoomRange;
  if (target.classList.contains('ytc-tz-hit') && target.classList.contains('edge-handle')) {
    // The edge handles cover the progress bar, so a click without a drag seeks there as the bar
    // would, and only a drag resizes.
    const edge = target.getAttribute('data-edge') === 'start' ? 'start' : 'end';
    const downX = e.clientX;
    let resizing = false;
    beginDrag(
      e,
      'edge-pressed',
      (ev) => {
        if (!resizing && Math.abs(ev.clientX - downX) < DRAG_THRESHOLD_PX) return;
        if (!resizing) {
          resizing = true;
          brushDrag = edge;
          panel?.classList.add('resizing');
        }
        setRangeByUser(
          resizeRangeEdge(
            startRange,
            edge,
            progressBarTimeAt(ev.clientX),
            duration,
            MIN_RANGE_SECONDS
          )
        );
      },
      () => {
        panel?.classList.remove('resizing');
        if (resizing) return;
        seekToSafe(appState.video, loopSafeSeekTime(progressBarTimeAt(downX)));
        // A click seeks as the progress bar would, so the range follows it.
        holdingForDrag = false;
      }
    );
    return;
  }
  if (target.classList.contains('ytc-tz-hit') && target.classList.contains('center-handle')) {
    // A second press soon after the first refits the zoom range (fittedRange): a quick way
    // back after scrolling away, and a non-drag way to move the range. Detected here rather than
    // with dblclick, which pointer capture retargets away from the center handle.
    const now = performance.now();
    if (now - lastCenterHandlePress < DOUBLE_CLICK_MS) {
      lastCenterHandlePress = 0;
      setRangeByUser(fittedRange(duration), { animate: true });
      return;
    }
    lastCenterHandlePress = now;
    const downTime = progressBarTimeAt(e.clientX);
    brushDrag = 'move';
    beginDrag(e, 'panning', (ev) =>
      setRangeByUser(
        panRange(startRange, progressBarTimeAt(ev.clientX) - downTime, duration, MIN_RANGE_SECONDS)
      )
    );
    return;
  }
  if (isZoomedBarSurface(target)) {
    // Scrub like the progress bar: seek on press and while dragging, within the range as shown. As with
    // Alt+dragging a marker number, the knob follows the pointer and seeks go out once per frame.
    // While a loop is active, a point outside it goes to the loop start, as on the progress bar.
    // Playback pauses while held, so the frame shown is the one under the knob, and resumes on
    // release (or a cancelled pointer) if it was playing, as YouTube's bar and video.js do.
    const wasPlaying = !appState.video.paused;
    pauseSafe(appState.video);
    const scrubRange = shownRange;
    const zoomedTimeAt = (clientX: number) =>
      loopSafeSeekTime(
        fractionToTime(scrubRange, Math.min(Math.max(panelX(clientX) / width, 0), 1))
      );
    const seekPerFrame = coalescePerAnimationFrame((time: number) =>
      seekToSafe(appState.video, time)
    );
    scrubTime = zoomedTimeAt(e.clientX);
    seekToSafe(appState.video, scrubTime);
    beginDrag(
      e,
      'scrubbing',
      (ev) => {
        hoverX = panelX(ev.clientX);
        scrubTime = zoomedTimeAt(ev.clientX);
        seekPerFrame.schedule(scrubTime);
      },
      () => {
        seekPerFrame.flush();
        if (wasPlaying) void appState.video.play();
      }
    );
  }
}

/** Scroll on the zoomed bar zooms (Shift+scroll pans). Over the brush on the progress bar it passes
 *  through, so the page scrolls as usual. */
function onWheel(e: WheelEvent): void {
  if (!zoomRange || !shownRange || !layout) return;
  if (!(e.target as Element).closest('.ytc-tz-zoomed')) return;
  e.preventDefault();
  e.stopPropagation();
  const duration = getVideoDuration(platform, appState.video);
  const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  if (horizontal) {
    const notches = wheelNotches(e.deltaX || e.deltaY, e.deltaMode);
    const span = zoomRange.end - zoomRange.start;
    setRangeByUser(
      panRange(zoomRange, notches * span * WHEEL_PAN_FRACTION, duration, MIN_RANGE_SECONDS),
      { animate: true }
    );
    return;
  }
  // Zoom around the chosen range's centre, so the brush on the progress bar grows and shrinks in place
  // (it shifts only where it meets a video end) and quick successive notches accumulate.
  const anchor = (zoomRange.start + zoomRange.end) / 2;
  const factor = WHEEL_ZOOM_FACTOR ** -wheelNotches(e.deltaY, e.deltaMode);
  setRangeByUser(zoomRangeAround(zoomRange, anchor, factor, duration, MIN_RANGE_SECONDS), {
    animate: true,
  });
}
