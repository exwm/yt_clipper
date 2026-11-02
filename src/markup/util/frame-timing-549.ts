import {
  findCropKeyframeAtTime,
  getEaseSectionDuration,
  nextKeyframeIndex,
} from '../crop/crop-keyframe-math';
import { clampNumber, getOutputDuration, toHHMMSSTrimmed } from './util';
import {
  frameAt,
  frameMiddle,
  frameSeekTarget,
  frameSpan,
  frameStart,
  isInFrameSpan,
  sameFrame,
} from './frame-grid';
import {
  frameStepTarget,
  frameTime as frameTimeAt,
  loopTurnBack as loopTurnBackAt,
  ScreenFrame,
  screenFrame as screenFrameAt,
  TIME_ROUNDING,
} from './frame-step';
import type {
  FrameReading,
  FrozenFrameTiming as FrameTiming,
  RateReading,
  ScreenReading,
} from './frame-timing';
import { onExternalSeek, onSeekSettled } from './seek-coalescer';

/** 5.49's frame timing: frames on the grid of the rate in use, read from the frame on screen. */

// Where the playhead is or is going: the seek held back, else the current time.
const playheadOf = (reading: ScreenReading) => reading.pendingSeek ?? reading.currentTime;
const isSeekInFlight = (reading: ScreenReading) => reading.seeking || reading.pendingSeek != null;

function screenFrame(reading: ScreenReading & RateReading): ScreenFrame {
  const { onScreen, grid, isRateMeasured } = reading;
  return screenFrameAt(onScreen, playheadOf(reading), grid.rate, isRateMeasured);
}

function frameTime(reading: FrameReading): number {
  return frameTimeAt(screenFrame(reading), {
    playhead: playheadOf(reading),
    isSeekInFlight: isSeekInFlight(reading),
    ownSeek: reading.ownSeek,
    fps: reading.grid.rate,
  });
}

export const frameTiming549: FrameTiming = {
  frameTime,
  screenFrame,
  presentedFrameStart(reading, platformTime) {
    const { onScreen, currentTime, grid, isRateMeasured } = reading;
    const isRead =
      onScreen.isRead &&
      onScreen.mediaTime != null &&
      Math.abs(onScreen.mediaTime - platformTime) < TIME_ROUNDING;
    const presented = { mediaTime: platformTime, isRead, isCurrent: true };
    return screenFrameAt(presented, currentTime, grid.rate, isRateMeasured).start;
  },
  placeSeek(grid, time) {
    const target = frameSeekTarget(grid, time);
    return { to: target, ownSeek: { target, frameStart: time, kind: 'place' } };
  },
  stepSeek(reading, { frames, duration, hasFrameCallbacks }) {
    const fps = reading.grid.rate;
    // Without frame callbacks the frame on screen is unknown: step from the playhead.
    if (!hasFrameCallbacks) return { by: frames / fps };
    const target = frameStepTarget(screenFrame(reading), {
      playhead: playheadOf(reading),
      isSeekInFlight: isSeekInFlight(reading),
      ownSeek: reading.ownSeek,
      fps,
      duration,
      frames,
    });
    return { to: target, ownSeek: { target, frameStart: target - 0.5 / fps, kind: 'step' } };
  },
  loopTurnBack(reading, loop) {
    // Playing, the frame on screen, so the loop turns back while its last frame shows. Paused, the
    // playhead, which a paused loop seeks back from; past the end, as 5.48.
    const time = loop.isPlaying ? frameTime(reading) : reading.currentTime;
    return loopTurnBackAt({
      ...loop,
      grid: reading.grid,
      isRateMeasured: reading.isRateMeasured,
      time,
      playhead: reading.currentTime,
    });
  },
  // The end frame hold times its frame from the refreshes.
  noteRefresh: (state, time) => ({ ...state, refresh: { time, gap: time - state.refresh.time } }),

  compareFrames: (grid, a, b) => frameAt(grid, a) - frameAt(grid, b),
  isOnMarkerFrame: sameFrame,
  isStretch(grid, type, time, last) {
    return type === 'start'
      ? frameAt(grid, time) < frameAt(grid, last.start)
      : frameAt(grid, time) > frameAt(grid, last.end);
  },
  dragClamp(grid, type, time, pair, duration) {
    // Off the other marker's frame, which moveMarker refuses.
    return type === 'start'
      ? clampNumber(time, 0, frameStart(grid, frameAt(grid, pair.end) - 1))
      : clampNumber(time, frameStart(grid, frameAt(grid, pair.start) + 1), duration);
  },
  nudge(grid, markerTime, deltaY, duration) {
    const frame = frameAt(grid, markerTime) + (deltaY > 0 ? -1 : 1);
    const time = clampNumber(frameStart(grid, frame), 0, duration);
    return { markerTime: time, seekTime: time };
  },
  jumpTarget(grid, markerTimes, currentTime, key, isDoubleJump) {
    // Markers compare by frame: a jump lands inside the marker's frame, past its time.
    const currentFrame = frameAt(grid, currentTime);
    const markers = markerTimes.map((time) => ({ time, frame: frameAt(grid, time) }));
    const direction = key === 'ArrowLeft' ? -1 : 1;
    // The nearest marker in the jump's direction, if any.
    const nearest = (candidates: typeof markers) =>
      candidates.reduce<(typeof markers)[number] | null>(
        (best, marker) =>
          best == null || direction * (marker.frame - best.frame) < 0 ? marker : best,
        null
      );
    const isAhead = (marker: (typeof markers)[number], frame: number) =>
      direction * (marker.frame - frame) > 0;
    const ahead = markers.filter((marker) => isAhead(marker, currentFrame));
    const first = nearest(ahead);
    if (!isDoubleJump || first == null) return first?.time ?? null;
    return (nearest(ahead.filter((marker) => isAhead(marker, first.frame))) ?? first).time;
  },
  pairDuration(grid, pair, isVariableSpeed) {
    // Over the frames the clip includes, the end marker's frame too.
    const span = frameSpan(grid, pair.start, pair.end);
    const durationHHMMSS = toHHMMSSTrimmed(span.end - span.start);
    const frames = ` (${span.lastFrame - span.firstFrame + 1})`;
    const { speed, speedMap } = pair;
    if (isVariableSpeed) {
      const outputDuration = getOutputDuration(speedMap, grid.rate);
      const text = `${durationHHMMSS} (${toHHMMSSTrimmed(outputDuration)})${frames}`;
      return { text, outputDuration };
    }
    // At the pair's own speed, as the clipper's constant-speed path renders it.
    const constantSpeed = [
      { x: pair.start, y: speed },
      { x: pair.end, y: speed },
    ];
    const outputDuration = getOutputDuration(constantSpeed, grid.rate);
    return {
      text: `${durationHHMMSS}/${speed} = ${toHHMMSSTrimmed(outputDuration)}${frames}`,
      outputDuration,
    };
  },

  isInPair: (grid, pair, time) => isInFrameSpan(grid, pair.start, pair.end, time),
  pairSpan: (grid, pair) => frameSpan(grid, pair.start, pair.end),
  frameNumber: frameAt,

  findCropKeyframe: (grid, cropMap, time) => findCropKeyframeAtTime(cropMap, time, grid),
  nextKeyframeIndex: (grid, cropMap, time, dir) => nextKeyframeIndex(cropMap, time, grid, dir),
  parkedPointIndex(grid, cropMap, { frameTime, time, isPaused }) {
    const { index } = findCropKeyframeAtTime(cropMap, frameTime, grid);
    const point = cropMap[index];
    // Only while parked on the point's own frame: playing on, or a step past it, interpolates.
    return point && isPaused && frameAt(grid, time) === frameAt(grid, point.x) ? index : null;
  },
  editFrameTime: ({ isPaused, presentedTime, frameTime }) =>
    isPaused ? frameTime() : presentedTime,
  pointTime: (time) => time,
  // Pausing can move the playhead past the picture the edit is made on.
  autoKeyTime: ({ beforePause }) => beforePause,
  cropSectionTime: (_reading, presentedTime) => presentedTime,
  redrawTime: (_reading, heldFrameStart) => heldFrameStart,
  // On the end marker's frame, past the end point's time, the clip plays at the end speed.
  speedPreviewTime: (pair, playhead) => Math.min(Math.max(playhead, pair.start), pair.end),
  usesMeasuredRate: (isMeasureOn) => isMeasureOn(),
  // A seek still running after a second keeps its target, so frame steps held behind a slow seek
  // are not lost; a new source drops it.
  staleSeek: onSeekSettled,
  newSourceSeek: onExternalSeek,
  platformRate({ cached, widthChanged, isNewSourceLoaded, readStats }) {
    if (cached != null && !widthChanged) return { rate: cached, cached };
    const rate = readStats();
    // Between a new source's `emptied` and its `loadedmetadata` the stats still describe the old
    // video, so the rate read then isn't kept.
    return { rate, cached: isNewSourceLoaded ? rate : cached };
  },
  rateCacheAtNewSource: () => null,
  easeSectionDuration: getEaseSectionDuration,
  // The frame the cut point was placed on, allowing for its time being rounded below that frame's
  // start.
  cutFrameMiddle: (grid, cutX) => frameMiddle(grid, frameAt(grid, cutX) - 1),
};
