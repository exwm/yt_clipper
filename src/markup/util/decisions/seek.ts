import type { FrameGrid } from '../frame-grid';
import type { FrameSeek } from '../frame-timing';
import type { SeekDecision } from '../seek-coalescer';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** Where a seek to a placed time goes, and what becomes of a seek seekToSafe holds back. */
export interface SeekTiming {
  /** The seek that shows the frame at `time`, a placed time such as a marker's. */
  placeSeek(grid: FrameGrid, time: number): FrameSeek;
  /** What seekToSafe's stale timer does with the seek held back, a second after it was. */
  staleSeek(pending: number | null, current: number, seeking: boolean): SeekDecision;
  /** What a new source on the video, or another video, does to the seek held back, or null to
   *  leave it. */
  newSourceSeek(): SeekDecision | null;
}

export const seek: DecisionGroup<SeekTiming> = decisionGroup(GROUP_KEYS.seek);
