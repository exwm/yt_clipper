import type { FrameGrid } from '../frame-grid';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** When a Cinematic cut takes effect, which the clipper's twin matches. */
export interface CinematicTiming {
  /** When a Cinematic cut at `cutX` takes effect: the middle of the frame before the cut point's,
   *  which the clipper's twin matches. */
  cutFrameMiddle(grid: FrameGrid, cutX: number): number;
}

export const cinematic: DecisionGroup<CinematicTiming> = decisionGroup(GROUP_KEYS.cinematic);
