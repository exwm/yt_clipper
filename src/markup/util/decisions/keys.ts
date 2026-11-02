/** The releases a group's flag can pick. 5.48's is frozen; 'next' is where fixes land. */
export const GROUP_RELEASES = ['5.48', 'next'] as const;
export type GroupRelease = (typeof GROUP_RELEASES)[number];

/** Every release with frame decisions. 5.49's, frozen too, is taken only whole, by the
 *  `frameTiming549` build and the oracle tests. */
export const FRAME_TIMING_RELEASES = [...GROUP_RELEASES, '5.49'] as const;
export type FrameTimingRelease = (typeof FRAME_TIMING_RELEASES)[number];

/** Each group's decisions. Kept apart from the groups, which import the releases' code, so
 *  frame-timing.ts can lay out its table while those still load (see `decisionGroup`). */
export const GROUP_KEYS = {
  placement: [
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
  seek: ['placeSeek', 'staleSeek', 'newSourceSeek'],
  loop: ['loopTurnBack', 'noteRefresh'],
  steps: ['stepSeek', 'nudge', 'pairDuration'],
  compare: [
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
  rate: ['usesMeasuredRate', 'platformRate', 'rateCacheAtNewSource'],
  cropEase: ['easeSectionDuration'],
  cinematic: ['cutFrameMiddle'],
} as const;
