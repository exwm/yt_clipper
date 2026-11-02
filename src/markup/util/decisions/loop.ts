import type { Refresh } from '../frame-step';
import type { FrameReading, LoopReading } from '../frame-timing';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** A preview loop's own state between refreshes, which only this group reads and writes. */
export interface LoopState {
  // NaN until two refreshes are noted, which never holds.
  refresh: Refresh;
  // The last refresh the loop saw a frame other than its end frame.
  lastOtherFrameAt: number;
}

export const INITIAL_LOOP_STATE: LoopState = {
  refresh: { time: NaN, gap: NaN },
  lastOtherFrameAt: -Infinity,
};

/** When a preview loop turns back to its start. */
export interface LoopTiming {
  /** Where a loop over the frames shown from `loop.start` through `loop.end` seeks, or null, and
   *  its `lastOtherFrameAt` for the next refresh. */
  loopTurnBack(
    reading: FrameReading,
    loop: LoopReading
  ): { seekTo: number | null; lastOtherFrameAt: number };
  /** The loop state after an animation frame at `time` (its callback's argument). */
  noteRefresh(state: LoopState, time: number): LoopState;
}

export const loop: DecisionGroup<LoopTiming> = decisionGroup(GROUP_KEYS.loop);
