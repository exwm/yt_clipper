import type { FrameTiming } from '../frame-timing';

/** One group of frame decisions: 5.48's, which is the fallback, and the candidate its flag turns on. */
export interface DecisionGroup<G> {
  keys: readonly (keyof G)[];
  legacy: G;
  candidate: G;
}

/**
 * The group of decisions `keys`, taken from 5.48's and 5.49's whole objects, which stay whole as
 * the oracles their tests check. Taken on first use: frame-timing-548.ts and -549.ts import util.ts,
 * which imports frame-timing.ts, so a module that loads either first finds it still loading here.
 */
export function decisionGroup<K extends keyof FrameTiming>(
  keys: readonly K[],
  legacy: () => FrameTiming,
  candidate: () => FrameTiming
): DecisionGroup<Pick<FrameTiming, K>> {
  const pick = (timing: FrameTiming) =>
    Object.fromEntries(keys.map((key) => [key, timing[key]])) as Pick<FrameTiming, K>;
  const picked: { legacy?: Pick<FrameTiming, K>; candidate?: Pick<FrameTiming, K> } = {};
  return {
    keys,
    get legacy() {
      return (picked.legacy ??= pick(legacy()));
    },
    get candidate() {
      return (picked.candidate ??= pick(candidate()));
    },
  };
}
