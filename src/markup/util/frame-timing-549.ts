import type { CropPoint, SpeedPoint } from '../@types/yt_clipper';
import type { CropKeyframeMatch } from '../crop/crop-keyframe-math';
import { sortX } from '../ui/chart/chartPrimitives';
import { bsearch, clampNumber, toHHMMSSTrimmed } from './pure-util';
import {
  FrameGrid,
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

// 5.49's frame rules, which its frame timing below uses. Shared modules take them as parameters.

// On a point means on the point's frame. A distance test as wide as a frame would also take the
// neighboring frame's point. Points and the time read share frame starts (getFrameTime), so equal
// frames compare equal on any grid.
export function findCropKeyframeAtTime(
  cropMap: CropPoint[],
  time: number,
  grid: FrameGrid
): CropKeyframeMatch {
  // bsearch returns [i, i] on an exact hit and [i, i+1] between points, but
  // [-1, 0] / [n-1, n] just outside the map: clamp to valid indices (the
  // playhead stays within [start, end] in practice, this only guards the edges).
  const lastIndex = cropMap.length - 1;
  const [rawStart, rawEnd] = bsearch(cropMap, { x: time, y: 0, crop: '' }, sortX);
  const s = Math.max(0, Math.min(rawStart, lastIndex));
  const e = Math.max(0, Math.min(rawEnd, lastIndex));
  const frame = frameAt(grid, time);
  const isOnFrame = (x: number) => frameAt(grid, x) === frame;
  const onStart = isOnFrame(cropMap[s].x);
  const onEnd = isOnFrame(cropMap[e].x);
  // In frames, so the answer is the same anywhere in the frame.
  const framesTo = (x: number) => Math.abs(frameAt(grid, x) - frame);
  const nearest = framesTo(cropMap[s].x) <= framesTo(cropMap[e].x) ? s : e;
  const index = onStart ? s : onEnd ? e : nearest;
  return { onKeyframe: onStart || onEnd, index, section: [s, e] };
}

/**
 * The index of the keyframe to step to from `time` in direction `dir` (+1 forward, -1 back): for
 * reframe wheel/keyframe navigation. On a keyframe's frame step to the adjacent point; between keyframes go to the
 * bracketing point in that direction. Clamped to the map, so stepping past the ends stays put.
 */
export function nextKeyframeIndex(
  cropMap: CropPoint[],
  time: number,
  grid: FrameGrid,
  dir: 1 | -1
): number {
  const { onKeyframe, index, section } = findCropKeyframeAtTime(cropMap, time, grid);
  const next =
    dir > 0 ? (onKeyframe ? index + 1 : section[1]) : onKeyframe ? index - 1 : section[0];
  return Math.max(0, Math.min(next, cropMap.length - 1));
}

/**
 * The duration to ease a crop section over, kept in sync with the clipper's getEaseSectionDuration
 * (frame_timing_549.py) so the preview eases over the same span the rendered output does. The end time
 * is pulled back toward the last displayed frame so the ease finishes on it; for a section shorter
 * than that pull-back the adjustment inverts, so fall back to the real duration rather than dropping
 * it (in the clipper a dropped section leaves a gap that snaps the crop to 0,0). Returns null for a
 * zero-duration section, which has no frames to ease.
 */
export function getEaseSectionDuration(
  startTime: number,
  endTime: number,
  fps: number
): number | null {
  const realDuration = endTime - startTime;
  if (realDuration <= 0) return null;

  // The frame the point was placed on, allowing for its time being rounded below that frame's start.
  const grid = { origin: 0, rate: fps };
  const adjustedDuration = frameMiddle(grid, frameAt(grid, endTime) - 1) - startTime;
  if (adjustedDuration <= 0) return realDuration;

  return adjustedDuration;
}

/** A marker pair's output duration as the clipper renders it: the frames from the one shown at its
 *  start marker through the one at its end marker, at its speed map's speeds. Mirrors
 *  getSpeedFilterAndDuration in the clipper's frame_timing_549.py; both are checked against
 *  src/clipper/tests/fixtures/output_duration_cases.json. */
export function getOutputDuration(speedMap: SpeedPoint[], fps = 30) {
  const last = speedMap.length - 1;
  const span = frameSpan({ origin: 0, rate: fps }, speedMap[0].x, speedMap[last].x);
  // The map's ends are the pair's: the last speed runs to the last frame's end.
  const points = speedMap.map((point, i) => ({
    ...point,
    x: i === 0 ? span.start : i === last ? span.end : point.x,
  }));
  if (points.every((point) => point.y === points[0].y)) {
    return (span.end - span.start) / points[0].y;
  }

  let outputDuration = 0;
  const frameDur = 1 / fps;
  const nSects = points.length - 1;
  const speedMapStartTime = span.start;

  for (let sect = 0; sect < nSects; ++sect) {
    const left = points[sect];
    const right = points[sect + 1];

    const startSpeed = left.y;
    const endSpeed = right.y;
    const speedChange = endSpeed - startSpeed;

    const sectStart = left.x - speedMapStartTime;
    let sectEnd = right.x - speedMapStartTime;
    // The map ends at the last frame's end. Its last section runs to that frame's start, the frame
    // then held for a frame below; a speed point inside the last frame leaves that section empty.
    if (sect === nSects - 1) {
      sectEnd = Math.max(sectStart, right.x - frameDur - speedMapStartTime);
    }

    const sectDuration = sectEnd - sectStart;
    if (sectDuration === 0) continue;

    const m = speedChange / sectDuration;
    const b = startSpeed - m * sectStart;

    if (speedChange === 0) {
      outputDuration += sectDuration / endSpeed;
    } else {
      // Integrate the reciprocal of the linear time vs speed function for the current section
      outputDuration +=
        (1 / m) * (Math.log(Math.abs(m * sectEnd + b)) - Math.log(Math.abs(m * sectStart + b)));
    }
  }
  // The last frame's output time rounds to a whole frame, half up as the clipper rounds, and the
  // frame is held for one frame.
  const lastFrame = Math.floor(outputDuration * fps + 0.5);
  return (lastFrame + 1) / fps;
}

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
