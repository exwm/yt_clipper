/** The releases whose frame decisions a group can use. 5.48's and 5.49's are frozen; 'next' is
 *  where fixes land, 5.48's until they do. */
export const FRAME_TIMING_RELEASES = ['5.48', '5.49', 'next'] as const;
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
