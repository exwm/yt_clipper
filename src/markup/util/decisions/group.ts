import type { FrameTiming } from '../frame-timing';
import { frameTimingNext } from '../frame-timing-next';
import { timing548, timing549 } from '../frame-timing-releases';
import type { FrameTimingRelease } from './keys';

/** One group of frame decisions, as each release makes them. Builds take 5.49's only whole
 *  (`composeFrameTiming`); a group's 5.49 decisions alone are for tests. */
export interface DecisionGroup<G> {
  keys: readonly (keyof G)[];
  release(release: FrameTimingRelease): G;
}

/** The group of decisions `keys`, taken from each release's whole object, which stays whole as the
 *  oracle its tests check. */
export function decisionGroup<K extends keyof FrameTiming>(
  keys: readonly K[]
): DecisionGroup<Pick<FrameTiming, K>> {
  const pick = (whole: FrameTiming) =>
    Object.fromEntries(keys.map((key) => [key, whole[key]])) as Pick<FrameTiming, K>;
  const releases = {
    '5.48': pick(timing548),
    '5.49': pick(timing549),
    next: pick(frameTimingNext),
  };
  return { keys, release: (release) => releases[release] };
}
