import type { EaseSectionDuration } from '../../crop/crop-keyframe-math';
import { DecisionGroup, decisionGroup } from './group';
import { FRAME_TIMING_GROUPS } from './keys';

/** How long a crop section eases, which the clipper's twin matches. */
export interface CropEaseTiming {
  /** The duration to ease a crop section over, which the clipper's twin matches. */
  easeSectionDuration: EaseSectionDuration;
}

export const cropEase: DecisionGroup<CropEaseTiming> = decisionGroup(
  FRAME_TIMING_GROUPS.cropEase.keys
);
