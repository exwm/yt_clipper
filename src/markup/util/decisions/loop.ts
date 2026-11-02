import type { FrameReading, LoopReading } from '../frame-timing';
import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { DecisionGroup, decisionGroup } from './group';

/** When a preview loop turns back to its start. */
export interface LoopTiming {
  /** Where a loop over the frames shown from `loop.start` through `loop.end` seeks, or null, and
   *  its `lastOtherFrameAt` for the next refresh. */
  loopTurnBack(
    reading: FrameReading,
    loop: LoopReading
  ): { seekTo: number | null; lastOtherFrameAt: number };
}

const KEYS = ['loopTurnBack'] as const;

export const loop: DecisionGroup<LoopTiming> = decisionGroup(
  KEYS,
  () => frameTiming548,
  () => frameTiming549
);
