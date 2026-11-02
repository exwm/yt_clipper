import type { EaseSectionDuration } from '../../crop/crop-keyframe-math';
import type { FrameGrid } from '../frame-grid';
import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { DecisionGroup, decisionGroup } from './group';
import { GROUP_KEYS } from './keys';

/** The crop ease and Cinematic cut frames, which the clipper's twins match. */
export interface FixedTiming {
  /** The duration to ease a crop section over, which the clipper's twin matches. */
  easeSectionDuration: EaseSectionDuration;
  /** When a Cinematic cut at `cutX` takes effect: the middle of the frame before the cut point's,
   *  which the clipper's twin matches. */
  cutFrameMiddle(grid: FrameGrid, cutX: number): number;
}

export const fixed: DecisionGroup<FixedTiming> = decisionGroup(
  GROUP_KEYS.fixed,
  () => frameTiming548,
  () => frameTiming549
);
