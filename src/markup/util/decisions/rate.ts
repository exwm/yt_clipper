import { frameTiming548 } from '../frame-timing-548';
import { frameTiming549 } from '../frame-timing-549';
import { DecisionGroup, decisionGroup } from './group';

/** Which frame rate is in use: the measured one or the platform's, and how the platform's is kept. */
export interface RateTiming {
  /** Whether the frame rate in use is the one measured from played frames, given the saved
   *  setting. */
  usesMeasuredRate(isMeasureOn: () => boolean): boolean;
  /** The platform's frame rate in use and the rate to cache, from the cached rate and the stats
   *  read only when needed. */
  platformRate(at: {
    cached: number | null;
    widthChanged: boolean;
    isNewSourceLoaded: boolean;
    readStats: () => number;
  }): { rate: number; cached: number | null };
  /** The cached platform rate once a new source starts loading. */
  rateCacheAtNewSource(cached: number | null): number | null;
}

const KEYS = ['usesMeasuredRate', 'platformRate', 'rateCacheAtNewSource'] as const;

export const rate: DecisionGroup<RateTiming> = decisionGroup(
  KEYS,
  () => frameTiming548,
  () => frameTiming549
);
