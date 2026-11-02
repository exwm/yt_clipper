import type { CropPoint, SpeedPoint } from '../@types/yt_clipper';
import type { CropKeyframeMatch } from '../crop/crop-keyframe-math';
import { roundX, sortX } from '../ui/chart/chartPrimitives';
import type { FrameTiming } from './frame-timing';
import { onSeekSettled, SeekDecision } from './seek-coalescer';
import { bsearch, clampNumber, toHHMMSSTrimmed } from './util';

const NONE: SeekDecision = { pending: null, effects: [] };

/**
 * 5.48's frame timing, for the `legacyFrameTiming` flag. 5.48 had no frame grid: it stored the raw
 * playhead, stepped by 1/fps from it, seeked to raw times, and compared raw times. It reads no
 * frame on screen and keeps no own seek. Citations are v5.48.0 file:line.
 */

// util.ts:322, which falls back to 30 fps for a missing rate.
function frameDuration(fps: number): number {
  return 1 / (fps > 0 ? fps : 30);
}

// util.ts:330.
function isWithinSameFrame(timeA: number, timeB: number, fps: number): boolean {
  return Math.abs(timeA - timeB) <= 0.5 * frameDuration(fps);
}

// crop-keyframe-math.ts:29: on a point within a full frame, the nearest point selected.
function findCropKeyframe(cropMap: CropPoint[], time: number, fps: number): CropKeyframeMatch {
  const lastIndex = cropMap.length - 1;
  const [rawStart, rawEnd] = bsearch(cropMap, { x: time, y: 0, crop: '' }, sortX);
  const s = Math.max(0, Math.min(rawStart, lastIndex));
  const e = Math.max(0, Math.min(rawEnd, lastIndex));
  const distToStart = Math.abs(cropMap[s].x - time);
  const distToEnd = Math.abs(cropMap[e].x - time);
  const index = distToStart <= distToEnd ? s : e;
  const onKeyframe = Math.min(distToStart, distToEnd) < frameDuration(fps);
  return { onKeyframe, index, section: [s, e] };
}

// The speed preview's active pair (speed.ts:24) and the fade bounds (preview-toggles.ts:140): the
// start floored and the end ceiled to the microsecond.
const floorMicros = (time: number) => Math.floor(time * 1e6) / 1e6;
const ceilMicros = (time: number) => Math.ceil(time * 1e6) / 1e6;

// util.ts:443, as 5.48 had it. The 5.49 one counts the end marker's frame.
function getOutputDuration(speedMap: SpeedPoint[], fps = 30): number {
  let outputDuration = 0;
  const frameDur = 1 / fps;
  const nSects = speedMap.length - 1;
  const speedMapStartTime = speedMap[0].x;
  const startt = Math.ceil(speedMapStartTime / frameDur) * frameDur - speedMapStartTime;
  for (let sect = 0; sect < nSects; ++sect) {
    const left = speedMap[sect];
    const right = speedMap[sect + 1];
    const startSpeed = left.y;
    const endSpeed = right.y;
    const speedChange = endSpeed - startSpeed;
    const sectStart = left.x - speedMapStartTime - startt;
    let sectEnd = right.x - speedMapStartTime - startt;
    if (sect === nSects - 1) {
      sectEnd = Math.floor(right.x / frameDur) * frameDur;
      if (right.x - sectEnd < 1e-10) sectEnd = sectEnd - frameDur;
      sectEnd = sectEnd - speedMapStartTime - startt;
      sectEnd = Math.floor(sectEnd * 1000000) / 1000000;
    }
    const sectDuration = sectEnd - sectStart;
    if (sectDuration === 0) continue;
    const m = speedChange / sectDuration;
    const b = startSpeed - m * sectStart;
    if (speedChange === 0) {
      outputDuration += sectDuration / endSpeed;
    } else {
      outputDuration +=
        (1 / m) * (Math.log(Math.abs(m * sectEnd + b)) - Math.log(Math.abs(m * sectStart + b)));
    }
  }
  outputDuration = Math.round(outputDuration / frameDur) * frameDur;
  outputDuration += frameDur;
  outputDuration = Math.round(outputDuration * 1000) / 1000;
  return outputDuration;
}

export const frameTiming548: FrameTiming = {
  // Placements read the raw playhead (markers.ts:399, :770; chartutil.ts:28; speed.ts:15).
  frameTime: (reading) => reading.currentTime,
  // The crop drawn and a captured frame's name were at the playhead (charts.ts:740,
  // frame-capture.ts:101).
  screenFrame: (reading) => ({
    start: reading.currentTime,
    isStartKnown: false,
    isPlayheads: true,
  }),
  // A frame callback's media time as given (charts.ts:844). The shell's offset for a platform that
  // plays a video in parts stays on.
  presentedFrameStart: (_reading, platformTime) => platformTime,
  // Seeks to a placed time went to the time (markers.ts:81, scatterChartSpec.ts:176).
  placeSeek: (_grid, time) => ({ to: time, ownSeek: null }),
  // Shift+wheel seeked by frames / fps from the playhead (yt_clipper.ts:709).
  stepSeek: (reading, { frames }) => ({ by: frames / reading.grid.rate }),
  // The loops (markers.ts:278, :298; charts.ts:1237): back to the start when the playhead is
  // outside the pair and not within half a frame of its start, with no end frame hold.
  loopTurnBack(reading, loop) {
    const { currentTime } = reading;
    const isBetween = loop.start <= currentTime && currentTime <= loop.end;
    const isAtStart = isWithinSameFrame(currentTime, loop.start, reading.grid.rate);
    return {
      seekTo: !isBetween && !isAtStart ? loop.start : null,
      lastOtherFrameAt: loop.lastOtherFrameAt,
    };
  },
  // 5.48's loops read no refreshes.
  noteRefresh: (state) => state,

  // Raw time comparisons (markers.ts:406, :772-779).
  compareFrames: (_grid, a, b) => a - b,
  // moveMarker had no same-frame no-op.
  isOnMarkerFrame: () => false,
  // markers.ts:784, with `<=` and `>=`.
  isStretch: (_grid, type, time, last) =>
    type === 'start' ? time <= last.start : time >= last.end,
  // markers.ts:661: 1 ms off the other marker.
  dragClamp: (_grid, type, time, pair, duration) =>
    type === 'start'
      ? clampNumber(time, 0, pair.end - 1e-3)
      : clampNumber(time, pair.start + 1e-3, duration),
  // markers.ts:162-171: a 1/fps step, clamped for the move but not for the seek.
  nudge(grid, markerTime, deltaY, duration) {
    const seekTime = deltaY > 0 ? markerTime - 1 / grid.rate : markerTime + 1 / grid.rate;
    const moved = deltaY > 0 ? Math.max(0, seekTime) : Math.min(duration, seekTime);
    return { markerTime: moved, seekTime };
  },
  // markers.ts:343-389: marker times rounded to 6 decimals and compared by time.
  jumpTarget(_grid, markerTimes, currentTime, key, isDoubleJump) {
    let times = markerTimes.map((time) => parseFloat(time.toFixed(6)));
    let target: number;
    if (key === 'ArrowLeft') {
      times = times.filter((time) => time < currentTime);
      target = Math.max(...times);
      if (isDoubleJump && times.length > 0) {
        times = times.filter((time) => time < target);
        target = Math.max(...times);
      }
    } else {
      times = times.filter((time) => time > currentTime);
      target = Math.min(...times);
      if (isDoubleJump && times.length > 0) {
        times = times.filter((time) => time > target);
        target = Math.min(...times);
      }
    }
    return target !== currentTime && Number.isFinite(target) ? target : null;
  },
  // markers.ts:941-960: end less start, with no frame count.
  pairDuration(grid, pair, isVariableSpeed) {
    const duration = pair.end - pair.start;
    const durationHHMMSS = toHHMMSSTrimmed(duration);
    if (isVariableSpeed) {
      const outputDuration = getOutputDuration(pair.speedMap, grid.rate);
      return { text: `${durationHHMMSS} (${toHHMMSSTrimmed(outputDuration)})`, outputDuration };
    }
    const outputDuration = duration / pair.speed;
    return {
      text: `${durationHHMMSS}/${pair.speed} = ${toHHMMSSTrimmed(outputDuration)}`,
      outputDuration,
    };
  },

  isInPair: (_grid, pair, time) => time >= floorMicros(pair.start) && time <= ceilMicros(pair.end),
  // getFadeBounds (preview-toggles.ts:140).
  pairSpan: (_grid, pair) => ({ start: floorMicros(pair.start), end: ceilMicros(pair.end) }),
  // frame-capture.ts:200.
  frameNumber: (grid, time) => Math.floor(time * grid.rate),

  findCropKeyframe: (grid, cropMap, time) => findCropKeyframe(cropMap, time, grid.rate),
  // crop-keyframe-math.ts:55.
  nextKeyframeIndex(grid, cropMap, time, dir) {
    const { onKeyframe, index, section } = findCropKeyframe(cropMap, time, grid.rate);
    const next =
      dir > 0 ? (onKeyframe ? index + 1 : section[1]) : onKeyframe ? index - 1 : section[0];
    return Math.max(0, Math.min(next, cropMap.length - 1));
  },
  // charts.ts:931-933: the point nearest the time drawn, within half a frame of it, paused.
  parkedPointIndex(grid, cropMap, { time, isPaused }) {
    const { index } = findCropKeyframe(cropMap, time, grid.rate);
    const point = cropMap[index];
    return point && isPaused && isWithinSameFrame(time, point.x, grid.rate) ? index : null;
  },
  // charts.ts:773 and :1089 read the time of the frame presented, paused or playing.
  editFrameTime: ({ presentedTime }) => presentedTime,
  // Rounded to 0.01 s for every caller (scatterChartSpec.ts:87, :114; charts.ts:1040).
  pointTime: roundX,
  // The playhead read after the pause (charts.ts:1014-1015).
  autoKeyTime: ({ afterPause }) => afterPause(),
  // The playhead, inside the preview loop too (charts.ts:855).
  cropSectionTime: (reading) => reading.currentTime,
  // The playhead (video-reframe-canvas.ts:95, :108).
  redrawTime: (reading) => reading.currentTime,
  // Unclamped (speed.ts:97).
  speedPreviewTime: (_pair, playhead) => playhead,
  // 5.48 had no measured rate.
  usesMeasuredRate: () => false,
  // seek-coalescer.ts:52-61 (onStaleTimer).
  staleSeek(pending, current, seeking) {
    if (pending === null) return NONE;
    if (seeking) return NONE; // slower than the timeout: drop rather than wait forever
    return onSeekSettled(pending, current, seeking);
  },
  // util.ts:392-401 had no `emptied` listener and kept the target when the video changed.
  newSourceSeek: () => null,
  // videoUtil.ts:13-23: the stats rate kept until the width changes, over a new source too.
  platformRate({ cached, widthChanged, readStats }) {
    const rate = cached != null && !widthChanged ? cached : readStats();
    return { rate, cached: rate };
  },
  rateCacheAtNewSource: (cached) => cached,
  // crop-keyframe-math.ts:95.
  easeSectionDuration(startTime, endTime, fps) {
    const realDuration = endTime - startTime;
    if (realDuration <= 0) return null;
    const leftFrameIndex = Math.floor(endTime * fps);
    const adjustedDuration = (leftFrameIndex - 0.5) / fps - startTime;
    if (adjustedDuration <= 0) return realDuration;
    return adjustedDuration;
  },
  // Cinematic is new in 5.49. Under the flag its cuts snap as 5.48's crop ease ends a section: on a
  // plain floor, with no allowance for a time rounded below a frame's start.
  cutFrameMiddle: (grid, cutX) =>
    grid.origin + (Math.floor((cutX - grid.origin) * grid.rate) - 1 + 0.5) / grid.rate,
};
