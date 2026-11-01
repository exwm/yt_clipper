import type { CropPoint, SpeedPoint } from '../@types/yt_clipper';
import type { CropKeyframeMatch, EaseSectionDuration } from '../crop/crop-keyframe-math';
import type { FrameGrid } from './frame-grid';
import type { FrameOnScreen, LoopRefresh, OwnSeek, ScreenFrame } from './frame-step';
import type { SeekDecision } from './seek-coalescer';
import { featureFlags } from '../feature-flags';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';

/**
 * The markup's frame decisions, as pure functions of one frame reading. The shell (videoUtil.ts)
 * reads the video and keeps the state the decisions take in and give back. The `legacyFrameTiming`
 * flag swaps in 5.48's decisions (frame-timing-548.ts) for 5.49's (frame-timing-549.ts).
 */

/** What the shell reads of the video for one frame decision. */
export interface FrameReading {
  // The playhead (getCurrentTime), on the platform's timeline.
  currentTime: number;
  // The seek seekToSafe holds back while another is in flight, or null.
  pendingSeek: number | null;
  seeking: boolean;
  onScreen: FrameOnScreen;
  // The video's frames at the frame rate in use.
  grid: FrameGrid;
  isRateMeasured: boolean;
  ownSeek: OwnSeek | null;
}

/** A seek to carry out: to a time, noting it as the markup's own seek, or by a time from the
 *  playhead, which leaves the last own seek as it is. */
export type FrameSeek = { to: number; ownSeek: OwnSeek | null } | { by: number };

/** What a preview loop reads besides the frame reading. */
export type LoopReading = Omit<LoopRefresh, 'grid' | 'isRateMeasured' | 'time' | 'playhead'>;

export interface FrameTiming {
  /** The time of the frame the user is on, which placements store and frame decisions read. */
  frameTime(reading: FrameReading): number;
  /** The frame on screen, its start on the platform's timeline. */
  screenFrame(reading: FrameReading): ScreenFrame;
  /** The start of the frame a frame callback presents at `platformTime`, as `screenFrame` gives it. */
  presentedFrameStart(reading: FrameReading, platformTime: number): number;
  /** The seek that shows the frame at `time`, a placed time such as a marker's. */
  placeSeek(grid: FrameGrid, time: number): FrameSeek;
  /** The seek `frames` whole frames from the frame on screen. */
  stepSeek(
    reading: FrameReading,
    step: { frames: number; duration: number; hasFrameCallbacks: boolean }
  ): FrameSeek;
  /** Where a loop over the frames shown from `loop.start` through `loop.end` seeks, or null, and
   *  its `lastOtherFrameAt` for the next refresh. */
  loopTurnBack(
    reading: FrameReading,
    loop: LoopReading
  ): { seekTo: number | null; lastOtherFrameAt: number };

  /** The order of the frames shown at `a` and at `b`: negative, zero or positive. */
  compareFrames(grid: FrameGrid, a: number, b: number): number;
  /** Whether `time` shows the frame of a marker at `markerTime`. */
  isOnMarkerFrame(grid: FrameGrid, time: number, markerTime: number): boolean;
  /** Whether moving a marker of `type` to `time` widens the pair from its `last` saved state. */
  isStretch(grid: FrameGrid, type: MarkerType, time: number, last: TimeSpan): boolean;
  /** Where an Alt+drag of a marker's number puts it at `time`, off the other marker's frame. */
  dragClamp(
    grid: FrameGrid,
    type: MarkerType,
    time: number,
    pair: TimeSpan,
    duration: number
  ): number;
  /** Alt+Shift+wheel: a marker's time one frame on from `markerTime`, and where to seek. */
  nudge(
    grid: FrameGrid,
    markerTime: number,
    deltaY: number,
    duration: number
  ): { markerTime: number; seekTime: number };
  /** Ctrl+arrow: the marker time to jump to from `currentTime`, or null. A double jump skips one. */
  jumpTarget(
    grid: FrameGrid,
    markerTimes: readonly number[],
    currentTime: number,
    key: 'ArrowLeft' | 'ArrowRight',
    isDoubleJump: boolean
  ): number | null;
  /** A marker pair's duration as the settings editor shows it, and its output duration. */
  pairDuration(
    grid: FrameGrid,
    pair: PairTiming,
    isVariableSpeed: boolean
  ): { text: string; outputDuration: number };

  /** Whether `time` shows one of a marker pair's frames, its end marker's frame included. */
  isInPair(grid: FrameGrid, pair: TimeSpan, time: number): boolean;
  /** The times a marker pair's frames span, as the clip includes them. */
  pairSpan(grid: FrameGrid, pair: TimeSpan): TimeSpan;
  /** The number of the frame shown at `time`, as a frame capture names it. */
  frameNumber(grid: FrameGrid, time: number): number;

  /** The crop point on the frame shown at `time`, else the nearest one, and the section around it. */
  findCropKeyframe(grid: FrameGrid, cropMap: CropPoint[], time: number): CropKeyframeMatch;
  /** The crop point to step to from `time` in direction `dir`, clamped to the map. */
  nextKeyframeIndex(grid: FrameGrid, cropMap: CropPoint[], time: number, dir: 1 | -1): number;
  /** The crop point the paused preview snaps to, as `frameTime` finds it, or null. `time` is the
   *  time the preview draws. */
  parkedPointIndex(
    grid: FrameGrid,
    cropMap: CropPoint[],
    at: { frameTime: number; time: number; isPaused: boolean }
  ): number | null;
  /** The time the crop point highlight is judged at: the time the next crop edit reads while
   *  paused, else the time of the frame presented. `frameTime` is read only when needed. */
  editFrameTime(at: { isPaused: boolean; presentedTime: number; frameTime: () => number }): number;
  /** The time a speed or crop point added at `time` stores. */
  pointTime(time: number): number;
  /** The time a reframe crop edit keys its point at, from the frame time read before the edit
   *  pauses playback, or after. */
  autoKeyTime(at: { beforePause: number; afterPause: () => number }): number;
  /** The time the crop chart section follows, given the time of the frame the preview draws. */
  cropSectionTime(reading: FrameReading, presentedTime: number): number;
  /** The time a crop redraw outside the frame loop draws at, given the start of the frame the
   *  video holds. */
  redrawTime(reading: FrameReading, heldFrameStart: number): number;
  /** The time the speed preview reads a marker pair's speed points at, from the playhead. */
  speedPreviewTime(pair: TimeSpan, playhead: number): number;
  /** Whether the frame rate in use is the one measured from played frames, given the saved
   *  setting. */
  usesMeasuredRate(isMeasureOn: () => boolean): boolean;
  /** What seekToSafe's stale timer does with the seek held back, a second after it was. */
  staleSeek(pending: number | null, current: number, seeking: boolean): SeekDecision;
  /** What a new source on the video, or another video, does to the seek held back, or null to
   *  leave it. */
  newSourceSeek(): SeekDecision | null;
  /** The platform's frame rate in use and the rate to cache, from the cached rate and the stats
   *  read only when needed. */
  platformRate(at: {
    cached: number | null;
    widthChanged: boolean;
    isNewSourceLoaded: boolean;
    readStats: () => number;
  }): { rate: number; cached: number | null };
  /** The cached platform rate once a new source starts loading. */
  rateCacheAtNewSource(cached: number | null): number | null;
  /** The duration to ease a crop section over, which the clipper's twin matches. */
  easeSectionDuration: EaseSectionDuration;
  /** When a Cinematic cut at `cutX` takes effect: the middle of the frame before the cut point's,
   *  which the clipper's twin matches. */
  cutFrameMiddle(grid: FrameGrid, cutX: number): number;
}

export type MarkerType = 'start' | 'end';

export interface TimeSpan {
  start: number;
  end: number;
}

export interface PairTiming extends TimeSpan {
  speed: number;
  speedMap: SpeedPoint[];
}

/** Whether the markup times frames as 5.48 did. Read once at start, so the flag applies on reload:
 *  frame decisions never mix the two. */
export const isLegacyFrameTiming = featureFlags.legacyFrameTiming;

export const frameTiming: FrameTiming = isLegacyFrameTiming ? frameTiming548 : frameTiming549;
