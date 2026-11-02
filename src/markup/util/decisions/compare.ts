import type { CropPoint } from '../../@types/yt_clipper';
import type { CropKeyframeMatch } from '../../crop/crop-keyframe-math';
import type { FrameGrid } from '../frame-grid';
import type { MarkerType, TimeSpan } from '../frame-timing';
import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { DecisionGroup, decisionGroup } from './group';

/** Whether two placed times, or a time and a marker pair or crop point, mean the same frame. */
export interface CompareTiming {
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
  /** Ctrl+arrow: the marker time to jump to from `currentTime`, or null. A double jump skips one. */
  jumpTarget(
    grid: FrameGrid,
    markerTimes: readonly number[],
    currentTime: number,
    key: 'ArrowLeft' | 'ArrowRight',
    isDoubleJump: boolean
  ): number | null;
  /** Whether `time` shows one of a marker pair's frames, its end marker's frame included. */
  isInPair(grid: FrameGrid, pair: TimeSpan, time: number): boolean;
  /** The times a marker pair's frames span, as the clip includes them. */
  pairSpan(grid: FrameGrid, pair: TimeSpan): TimeSpan;
  /** The time the speed preview reads a marker pair's speed points at, from the playhead. */
  speedPreviewTime(pair: TimeSpan, playhead: number): number;
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
}

const KEYS = [
  'compareFrames',
  'isOnMarkerFrame',
  'isStretch',
  'dragClamp',
  'jumpTarget',
  'isInPair',
  'pairSpan',
  'speedPreviewTime',
  'findCropKeyframe',
  'nextKeyframeIndex',
  'parkedPointIndex',
] as const;

export const compare: DecisionGroup<CompareTiming> = decisionGroup(
  KEYS,
  () => frameTiming548,
  () => frameTiming549
);
