import type { FrameTiming } from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';

// Members added to the frame decisions after 5.48 and 5.49 froze, as each release had them.
const ADDED_548 = { countsFrames: false };
const ADDED_549 = { countsFrames: true };

let whole548: FrameTiming | undefined;
let whole549: FrameTiming | undefined;

/** 5.48's whole frame timing: its frozen object and the members added since. Made on first use,
 *  for the import cycle `decisionGroup` describes. */
export function timing548(): FrameTiming {
  return (whole548 ??= { ...frameTiming548, ...ADDED_548 });
}

/** 5.49's whole frame timing, as `timing548` makes 5.48's. */
export function timing549(): FrameTiming {
  return (whole549 ??= { ...frameTiming549, ...ADDED_549 });
}
