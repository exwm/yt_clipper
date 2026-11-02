import type { FrameTiming } from './frame-timing';
import { timing548 } from './frame-timing-releases';

/**
 * The next release's frame timing, where fixes land one decision at a time. Each decision not in
 * `fixes` is 5.48's own function, so a group set to 'next' behaves as 5.48 until a fix for it lands,
 * and the differential tests check each fix against 5.48.
 */
const fixes: Partial<FrameTiming> = {
  // The playhead's time as is: 5.48 rounded it to 0.01 s, which moves a point near a frame's edge
  // into the next or previous frame.
  pointTime: (time) => time,
};

export const frameTimingNext: FrameTiming = { ...timing548, ...fixes };
