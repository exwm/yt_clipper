import type { SpeedPoint } from '../@types/yt_clipper';
import type { FrameGrid } from './frame-grid';
import type { FrameOnScreen, LoopRefresh, OwnSeek } from './frame-step';
import { featureFlags } from '../feature-flags';
import { CompareTiming, compare } from './decisions/compare';
import { FixedTiming, fixed } from './decisions/fixed';
import type { DecisionGroup } from './decisions/group';
import { LoopTiming, loop } from './decisions/loop';
import { PlacementTiming, placement } from './decisions/placement';
import { RateTiming, rate } from './decisions/rate';
import { SeekTiming, seek } from './decisions/seek';
import { StepTiming, steps } from './decisions/steps';

/**
 * The markup's frame decisions, as pure functions of one frame reading. The shell (videoUtil.ts)
 * reads the video and keeps the state the decisions take in and give back. Each group in
 * `decisions/` has 5.48's decisions (frame-timing-548.ts) and 5.49's (frame-timing-549.ts); the
 * `legacyFrameTiming` flag picks 5.48's for every group.
 */

/** What the shell reads of the video for one frame decision. */
export interface FrameReading {
  // The playhead (getCurrentTime), on the platform's timeline.
  currentTime: number;
  // The seek seekToSafe holds back while another is in flight, or null.
  pendingSeek: number | null;
  seeking: boolean;
  onScreen: FrameOnScreen;
  // The video's frames at the frame rate in use.
  grid: FrameGrid;
  isRateMeasured: boolean;
  ownSeek: OwnSeek | null;
}

/** A seek to carry out: to a time, noting it as the markup's own seek, or by a time from the
 *  playhead, which leaves the last own seek as it is. */
export type FrameSeek = { to: number; ownSeek: OwnSeek | null } | { by: number };

/** What a preview loop reads besides the frame reading. */
export type LoopReading = Omit<LoopRefresh, 'grid' | 'isRateMeasured' | 'time' | 'playhead'>;

/** Every frame decision, as the groups in `decisions/` split them. */
export interface FrameTiming
  extends
    PlacementTiming,
    SeekTiming,
    LoopTiming,
    StepTiming,
    CompareTiming,
    RateTiming,
    FixedTiming {}

export type MarkerType = 'start' | 'end';

export interface TimeSpan {
  start: number;
  end: number;
}

export interface PairTiming extends TimeSpan {
  speed: number;
  speedMap: SpeedPoint[];
}

export const frameDecisionGroups = { placement, seek, loop, steps, compare, rate, fixed };
export type FrameDecisionGroup = keyof typeof frameDecisionGroups;

/** The frame timing with each group's candidate where `useCandidate` says, else 5.48's. Each
 *  member is looked up on first use, for the import cycle `decisionGroup` describes. */
export function composeFrameTiming(useCandidate: Record<FrameDecisionGroup, boolean>): FrameTiming {
  const timing = {};
  // Each group as a slice of the whole: its keys index only its own members.
  const groups = Object.entries(frameDecisionGroups) as unknown as [
    FrameDecisionGroup,
    DecisionGroup<FrameTiming>,
  ][];
  for (const [name, group] of groups) {
    for (const key of group.keys) {
      Object.defineProperty(timing, key, {
        enumerable: true,
        configurable: true,
        get() {
          const value = (useCandidate[name] ? group.candidate : group.legacy)[key];
          Object.defineProperty(timing, key, { value, enumerable: true });
          return value;
        },
      });
    }
  }
  return timing as FrameTiming;
}

/** Whether the markup times frames as 5.48 did. Read once at start, so the flag applies on reload:
 *  frame decisions never mix the two. */
export const isLegacyFrameTiming = featureFlags.legacyFrameTiming;

export const frameTiming: FrameTiming = composeFrameTiming({
  placement: !isLegacyFrameTiming,
  seek: !isLegacyFrameTiming,
  loop: !isLegacyFrameTiming,
  steps: !isLegacyFrameTiming,
  compare: !isLegacyFrameTiming,
  rate: !isLegacyFrameTiming,
  fixed: !isLegacyFrameTiming,
});
