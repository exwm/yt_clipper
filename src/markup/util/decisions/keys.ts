/** The releases a group's flag can pick. 5.48's is frozen; 'next' is where fixes land. */
export const GROUP_RELEASES = ['5.48', 'next'] as const;
export type GroupRelease = (typeof GROUP_RELEASES)[number];

/** Every release with frame decisions. 5.49's, frozen too, is taken only whole, by the
 *  `frameTiming549` build and the oracle tests. */
export const FRAME_TIMING_RELEASES = [...GROUP_RELEASES, '5.49'] as const;
export type FrameTimingRelease = (typeof FRAME_TIMING_RELEASES)[number];

/**
 * Each group of frame decisions: its members, and what its flag (`${group}Timing`) decides, as the
 * feature flags popup shows it. Kept apart from the groups, which import the releases' code, so
 * frame-timing.ts and feature-flags.ts can read it with no import cycle.
 */
export const FRAME_TIMING_GROUPS = {
  placement: {
    keys: [
      'frameTime',
      'screenFrame',
      'presentedFrameStart',
      'frameNumber',
      'editFrameTime',
      'pointTime',
      'autoKeyTime',
      'cropSectionTime',
      'redrawTime',
    ],
    description: 'Where markers, crop and speed points are placed, and the frame they read.',
  },
  seek: {
    keys: ['placeSeek', 'staleSeek', 'newSourceSeek'],
    description: 'Where a seek to a marker or point goes, and what happens to a seek held back.',
  },
  loop: {
    keys: ['loopTurnBack', 'noteRefresh'],
    description: 'When the marker pair and crop loops turn back to their start.',
  },
  steps: {
    keys: ['stepSeek', 'nudge', 'pairDuration', 'countsFrames'],
    description: 'How frame steps and marker nudges move, and how a pair duration counts.',
  },
  compare: {
    keys: [
      'compareFrames',
      'isOnMarkerFrame',
      'isStretch',
      'dragClamp',
      'jumpTarget',
      'isInPair',
      'pairSpan',
      'speedPreviewTime',
      'findCropKeyframe',
      'nextKeyframeIndex',
      'parkedPointIndex',
    ],
    description: 'How markers, points and the playhead compare, and which crop point is found.',
  },
  rate: {
    keys: ['usesMeasuredRate', 'platformRate', 'rateCacheAtNewSource'],
    description: "The frame rate in use, and how YouTube's rate is kept.",
  },
  cropEase: {
    keys: ['easeSectionDuration'],
    description: "Where a crop section's ease ends.",
  },
  cinematic: {
    keys: ['cutFrameMiddle'],
    description: 'The frame a Cinematic cut takes effect on.',
  },
} as const;

export type FrameDecisionGroup = keyof typeof FRAME_TIMING_GROUPS;
export const FRAME_DECISION_GROUPS = Object.keys(FRAME_TIMING_GROUPS) as FrameDecisionGroup[];

export type GroupFlagName = `${FrameDecisionGroup}Timing`;
export const groupFlagName = (group: FrameDecisionGroup): GroupFlagName => `${group}Timing`;

/** Every group's flag set to `release`. */
export function frameTimingFlags(release: GroupRelease): Record<GroupFlagName, GroupRelease> {
  return Object.fromEntries(
    FRAME_DECISION_GROUPS.map((group) => [groupFlagName(group), release])
  ) as Record<GroupFlagName, GroupRelease>;
}
