import type { SpeedPoint } from '../@types/yt_clipper';
import type { FrameGrid } from './frame-grid';
import type { FrameOnScreen, LoopRefresh, OwnSeek } from './frame-step';
import { featureFlags, FeatureFlags } from '../feature-flags';
import { CinematicTiming, cinematic } from './decisions/cinematic';
import { CompareTiming, compare } from './decisions/compare';
import { CropEaseTiming, cropEase } from './decisions/crop-ease';
import type { DecisionGroup } from './decisions/group';
import { FrameTimingRelease, GROUP_KEYS, GroupRelease } from './decisions/keys';
import { LoopTiming, loop } from './decisions/loop';
import { PlacementTiming, placement } from './decisions/placement';
import { RateTiming, rate } from './decisions/rate';
import { SeekTiming, seek } from './decisions/seek';
import { StepTiming, steps } from './decisions/steps';

/**
 * The markup's frame decisions, as pure functions of one frame reading. The shell (videoUtil.ts)
 * reads the video and keeps the state the decisions take in and give back. Each group in
 * `decisions/` takes its decisions from the release its flag picks (`choiceFromFlags`): 5.48's
 * (frame-timing-548.ts, frozen), or the next release's (frame-timing-next.ts), the default, where
 * fixes land. The `frameTiming549` flag instead makes the whole build 5.49's (frame-timing-549.ts,
 * frozen), for its oracle tests and opt-in runs.
 *
 * Shared state has one owner. The last own seek is written only by the seek and step groups (and
 * cleared by a new source), and read by placement and steps; 5.48's writers leave it null, so every
 * reader works with null. The loop group owns the loop's refreshes (`LoopState`). The frame clock
 * (the frame on screen, the held frame) is read, never written, by decisions.
 *
 * Kept outside the groups, as the default build ships them in every mode: the point dedupe on
 * adding a speed or crop point (scatterChartSpec.ts), the crop hold toggle (crop-point-holds.ts),
 * the crop interpolated by shrinkPointMap when a marker moves (chartutil.ts), and
 * resolveCropEditConflict (crop-overlay.ts).
 */

/** The playhead (getCurrentTime), on the platform's timeline. */
export interface PlayheadReading {
  currentTime: number;
}

/** What the frame clock and the seek coalescer know of the frame on screen. */
export interface ScreenReading extends PlayheadReading {
  // The seek seekToSafe holds back while another is in flight, or null.
  pendingSeek: number | null;
  seeking: boolean;
  onScreen: FrameOnScreen;
}

/** The video's frames at the frame rate in use. */
export interface RateReading {
  grid: FrameGrid;
  isRateMeasured: boolean;
}

/** What the shell reads of the video for one frame decision. */
export interface FrameReading extends ScreenReading, RateReading {
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
    CropEaseTiming,
    CinematicTiming {}

export type MarkerType = 'start' | 'end';

export interface TimeSpan {
  start: number;
  end: number;
}

export interface PairTiming extends TimeSpan {
  speed: number;
  speedMap: SpeedPoint[];
}

// Getters, which read each import when used: for the import cycle `decisionGroup` describes.
export const frameDecisionGroups = {
  get placement() {
    return placement;
  },
  get seek() {
    return seek;
  },
  get loop() {
    return loop;
  },
  get steps() {
    return steps;
  },
  get compare() {
    return compare;
  },
  get rate() {
    return rate;
  },
  get cropEase() {
    return cropEase;
  },
  get cinematic() {
    return cinematic;
  },
};
export type FrameDecisionGroup = keyof typeof GROUP_KEYS;
export type GroupReleases = Record<FrameDecisionGroup, GroupRelease>;

/** The build's frame timing: 5.49's whole, or each group's release. */
export type FrameTimingChoice = { whole: '5.49' } | { groups: GroupReleases };

/** The frame timing `choice` makes. */
export function composeFrameTiming(choice: FrameTimingChoice): FrameTiming {
  if ('whole' in choice) {
    const groups = Object.keys(GROUP_KEYS) as FrameDecisionGroup[];
    return composeGroups(
      Object.fromEntries(groups.map((name) => [name, '5.49'])) as Record<
        FrameDecisionGroup,
        FrameTimingRelease
      >
    );
  }
  return composeGroups(choice.groups);
}

/** For tests: the frame timing with each group's decisions from the release `releases` picks for
 *  it, 5.49's included, which builds only take whole. Each member is looked up on first use, for
 *  the import cycle `decisionGroup` describes. */
export function composeGroups(
  releases: Record<FrameDecisionGroup, FrameTimingRelease>
): FrameTiming {
  const timing = {};
  for (const name of Object.keys(GROUP_KEYS) as FrameDecisionGroup[]) {
    for (const key of GROUP_KEYS[name]) {
      Object.defineProperty(timing, key, {
        enumerable: true,
        configurable: true,
        get() {
          // Each group as a slice of the whole: its keys index only its own members.
          const group = frameDecisionGroups[name] as unknown as DecisionGroup<FrameTiming>;
          const value = group.release(releases[name])[key];
          Object.defineProperty(timing, key, { value, enumerable: true });
          return value;
        },
      });
    }
  }
  return timing as FrameTiming;
}

/** The build's frame timing from the flags: `frameTiming549` overrides every group's flag. */
export function choiceFromFlags(flags: FeatureFlags): FrameTimingChoice {
  if (flags.frameTiming549) return { whole: '5.49' };
  return {
    groups: {
      placement: flags.placementTiming,
      seek: flags.seekTiming,
      loop: flags.loopTiming,
      steps: flags.stepsTiming,
      compare: flags.compareTiming,
      rate: flags.frameRateTiming,
      cropEase: flags.cropEaseTiming,
      cinematic: flags.cinematicTiming,
    },
  };
}

// Read once at start: a flag applies on reload, so decisions never mix releases mid-session.
const frameTimingChoice: FrameTimingChoice = choiceFromFlags(featureFlags);

export const frameTiming: FrameTiming = composeFrameTiming(frameTimingChoice);

/** Whether the rate decisions can use a measured rate, for the Measure button and its command. */
export function hasFrameRateMeasurement(): boolean {
  return frameTiming.usesMeasuredRate(() => true);
}

/** Whether a marker pair's duration counts its frames: only 5.49's does, until a fix in 'next'. */
export function isFrameCountShown(): boolean {
  return 'whole' in frameTimingChoice;
}
