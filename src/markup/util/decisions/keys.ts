/** Each group's decisions. Kept apart from the groups, which import 5.48's and 5.49's code, so
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
  fixed: ['easeSectionDuration', 'cutFrameMiddle'],
} as const;
