import { FRAME_TIMING_GROUPS } from './decisions/keys';
import type { FrameTiming } from './frame-timing';
import { frameTiming548 } from './frame-timing-548';

/**
 * The next release's frame timing, where fixes land one decision at a time. Each decision not in
 * `fixes` is 5.48's own function, so a group set to 'next' behaves as 5.48 until a fix for it lands,
 * and the differential tests check each fix against 5.48.
 */
const fixes: Partial<FrameTiming> = {};

// 5.48's decisions are looked up on use, for the import cycle `decisionGroup` describes.
export const frameTimingNext = Object.defineProperties(
  {},
  Object.fromEntries(
    Object.values(FRAME_TIMING_GROUPS)
      .flatMap((group) => group.keys)
      .map((key) => [key, { enumerable: true, get: () => fixes[key] ?? frameTiming548[key] }])
  )
) as FrameTiming;
