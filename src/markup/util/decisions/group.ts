import type { FrameTiming } from '../frame-timing';
import { frameTimingNext } from '../frame-timing-next';
import { timing548, timing549 } from '../frame-timing-releases';
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
        const whole = { '5.48': timing548(), '5.49': timing549(), next: frameTimingNext }[release];
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
