import type { FrameGrid } from '../frame-grid';
import type { ScreenFrame } from '../frame-step';
import type { FrameReading, PlayheadReading, RateReading, ScreenReading } from '../frame-timing';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** Which frame the user is on, and the time a placement (a marker, a crop or speed point) stores. */
export interface PlacementTiming {
  /** The time of the frame the user is on, which placements store and frame decisions read. */
  frameTime(reading: FrameReading): number;
  /** The frame on screen, its start on the platform's timeline. */
  screenFrame(reading: ScreenReading & RateReading): ScreenFrame;
  /** The start of the frame a frame callback presents at `platformTime`, as `screenFrame` gives it. */
  presentedFrameStart(reading: ScreenReading & RateReading, platformTime: number): number;
  /** The number of the frame shown at `time`, as a frame capture names it. */
  frameNumber(grid: FrameGrid, time: number): number;
  /** The time the crop point highlight is judged at: the time the next crop edit reads while
   *  paused, else the time of the frame presented. `frameTime` is read only when needed. */
  editFrameTime(at: { isPaused: boolean; presentedTime: number; frameTime: () => number }): number;
  /** The time a speed or crop point added at `time` stores. */
  pointTime(time: number): number;
  /** The time a reframe crop edit keys its point at, from the frame time read before the edit
   *  pauses playback, or after. */
  autoKeyTime(at: { beforePause: number; afterPause: () => number }): number;
  /** The time the crop chart section follows, given the time of the frame the preview draws. */
  cropSectionTime(reading: PlayheadReading, presentedTime: number): number;
  /** The time a crop redraw outside the frame loop draws at, given the start of the frame the
   *  video holds. */
  redrawTime(reading: PlayheadReading, heldFrameStart: number): number;
}

export const placement: DecisionGroup<PlacementTiming> = decisionGroup(GROUP_KEYS.placement);
