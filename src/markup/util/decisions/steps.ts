import type { FrameGrid } from '../frame-grid';
import type { FrameReading, FrameSeek, PairTiming } from '../frame-timing';
import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** Moves by whole frames, and a marker pair's length in frames, which read the frame rate. */
export interface StepTiming {
  /** The seek `frames` whole frames from the frame on screen. */
  stepSeek(
    reading: FrameReading,
    step: { frames: number; duration: number; hasFrameCallbacks: boolean }
  ): FrameSeek;
  /** Alt+Shift+wheel: a marker's time one frame on from `markerTime`, and where to seek. */
  nudge(
    grid: FrameGrid,
    markerTime: number,
    deltaY: number,
    duration: number
  ): { markerTime: number; seekTime: number };
  /** A marker pair's duration as the settings editor shows it, and its output duration. */
  pairDuration(
    grid: FrameGrid,
    pair: PairTiming,
    isVariableSpeed: boolean
  ): { text: string; outputDuration: number };
}

export const steps: DecisionGroup<StepTiming> = decisionGroup(
  GROUP_KEYS.steps,
  () => frameTiming548,
  () => frameTiming549
);
