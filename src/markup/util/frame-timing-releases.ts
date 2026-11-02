import type { FrameTiming } from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';

// Members added to the frame decisions after 5.48 and 5.49 froze, as each release had them.
const ADDED_548 = { countsFrames: false };
const ADDED_549 = { countsFrames: true };

/** 5.48's whole frame timing: its frozen object and the members added since. */
export const timing548: FrameTiming = { ...frameTiming548, ...ADDED_548 };

/** 5.49's whole frame timing, as `timing548` makes 5.48's. */
export const timing549: FrameTiming = { ...frameTiming549, ...ADDED_549 };
