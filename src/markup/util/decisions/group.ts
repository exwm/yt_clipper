import type { FrameTiming } from '../frame-timing';
import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { frameTimingNext } from '../frame-timing-next';
import type { FrameTimingRelease } from './keys';

/** One group of frame decisions, as each release makes them. */
export interface DecisionGroup<G> {
  keys: readonly (keyof G)[];
  release(release: FrameTimingRelease): G;
}

/**
 * The group of decisions `keys`, taken from each release's whole object, which stays whole as the
 * oracle its tests check. Taken on first use: the releases import util.ts, which imports
 * frame-timing.ts, so a module that loads a release first finds it still loading here.
 */
export function decisionGroup<K extends keyof FrameTiming>(
  keys: readonly K[]
): DecisionGroup<Pick<FrameTiming, K>> {
  const picked = new Map<FrameTimingRelease, Pick<FrameTiming, K>>();
  return {
    keys,
    release(release) {
      let decisions = picked.get(release);
      if (decisions == null) {
        const whole = { '5.48': frameTiming548, '5.49': frameTiming549, next: frameTimingNext }[
          release
        ];
        decisions = Object.fromEntries(keys.map((key) => [key, whole[key]])) as Pick<
          FrameTiming,
          K
        >;
        picked.set(release, decisions);
      }
      return decisions;
    },
  };
}
