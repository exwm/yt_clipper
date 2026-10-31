/**
 * frameTiming548 against an oracle: a frozen copy of the v5.48.0 code each member stands in for,
 * written as 5.48 had it at its call sites (cited file:line), not as frameTiming548 restates it.
 * Each member is swept over common frame rates, times at and around frame starts, mid-frame times,
 * millisecond- and microsecond-rounded times, and the video's edges.
 *
 * No exclusions: every frame decision of 5.48 has a member. Cinematic is new in 5.49: its cut time
 * follows the flag as 5.48's crop ease does, so its oracle is that ease's frame (the clipper's twin
 * matches). Not frame timing, and so not here: the 5.49 features that stay on under the flag (the
 * hold toggle, one point per frame, crop edit conflicts, the chart map's shrink and hold release, the
 * auto-key gate) and the frame rate itself, which the shell reads (videoUtil.legacy.test.ts).
 */
import type { CropPoint, SpeedPoint } from '../@types/yt_clipper';
import { frameTiming548 as timing } from './frame-timing-548';
import type { FrameReading } from './frame-timing';

// ─── the oracle: v5.48.0, frozen ─────────────────────────────────────────────

// util.ts:322-332.
const oracleFrameDuration = (fps: number) => 1 / (fps > 0 ? fps : 30);
const oracleIsWithinSameFrame = (a: number, b: number, fps: number) =>
  Math.abs(a - b) <= 0.5 * oracleFrameDuration(fps);

// markers.ts:297-306 (the chart loop at :278-288 and the crop chart section loop at charts.ts:1237
// are the same test): the seek, or null.
function oracleLoop(currentTime: number, start: number, end: number, fps: number) {
  const isTimeBetweenMarkerPair = start <= currentTime && currentTime <= end;
  if (!isTimeBetweenMarkerPair && !oracleIsWithinSameFrame(currentTime, start, fps)) return start;
  return null;
}

// markers.ts:406 (addMarker) and :772-784 (moveMarker): the message refused, or whether it stretches.
function oracleMoveMarker(
  type: 'start' | 'end',
  toTime: number,
  pair: { start: number; end: number },
  lastState: { start: number; end: number }
) {
  if (type === 'start' && toTime >= pair.end) return 'refused';
  if (type === 'end' && toTime <= pair.start) return 'refused';
  return type === 'start' ? toTime <= lastState.start : toTime >= lastState.end;
}
const oracleAddEndMarkerRefused = (currentFrameTime: number, startTime: number) =>
  currentFrameTime <= startTime;

// markers.ts:657-664.
function oracleDragTime(
  numberingType: 'start' | 'end',
  time: number,
  markerPair: { start: number; end: number },
  duration: number
) {
  const clampNumber = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
  return numberingType === 'start'
    ? clampNumber(time, 0, markerPair.end - 1e-3)
    : clampNumber(time, markerPair.start + 1e-3, duration);
}

// markers.ts:153-171: the time moved to and the time seeked to.
function oracleNudge(fps: number, targetMarkerTime: number, deltaY: number, duration: number) {
  let newMarkerTime: number;
  let moved: number;
  if (deltaY > 0) {
    newMarkerTime = targetMarkerTime - 1 / fps;
    moved = Math.max(0, newMarkerTime);
  } else {
    newMarkerTime = targetMarkerTime + 1 / fps;
    moved = Math.min(duration, newMarkerTime);
  }
  return { moved, seeked: newMarkerTime };
}

// markers.ts:343-389, with its module state passed in: the seek, or null.
function oracleJump(
  markerTimesIn: number[],
  currentTime: number,
  keyCode: 'ArrowLeft' | 'ArrowRight',
  dblJump: number,
  prevJumpKeyCode: string | undefined
) {
  let minTime: number = currentTime;
  let markerTimes = markerTimesIn.map((markerTime) => parseFloat(markerTime.toFixed(6)));
  if (keyCode === 'ArrowLeft') {
    markerTimes = markerTimes.filter((markerTime) => markerTime < currentTime);
    minTime = Math.max(...markerTimes);
    if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowLeft') {
      markerTimes = markerTimes.filter((markerTime) => markerTime < minTime);
      minTime = Math.max(...markerTimes);
    }
  } else {
    markerTimes = markerTimes.filter((markerTime) => markerTime > currentTime);
    minTime = Math.min(...markerTimes);
    if (dblJump != 0 && markerTimes.length > 0 && prevJumpKeyCode === 'ArrowRight') {
      markerTimes = markerTimes.filter((markerTime) => markerTime > minTime);
      minTime = Math.min(...markerTimes);
    }
  }
  return minTime !== currentTime && minTime != Infinity && minTime != -Infinity ? minTime : null;
}

// util.ts:443-491.
function oracleGetOutputDuration(speedMap: SpeedPoint[], fps = 30) {
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

// markers.ts:941-960, with toHHMMSSTrimmed from util.ts.
const toHHMMSSTrimmed = (seconds: number) =>
  new Date(seconds * 1000)
    .toISOString()
    .substring(11, 23)
    .replace(/(00:)+(.*)/, '$2');
function oracleMarkerPairDuration(
  markerPair: { start: number; end: number; speed: number; speedMap: SpeedPoint[] },
  fps: number,
  isVariableSpeed: boolean
) {
  const duration = markerPair.end - markerPair.start;
  const durationHHMMSS = toHHMMSSTrimmed(duration);
  if (isVariableSpeed) {
    const outputDuration = oracleGetOutputDuration(markerPair.speedMap, fps);
    return { text: `${durationHHMMSS} (${toHHMMSSTrimmed(outputDuration)})`, outputDuration };
  }
  const outputDuration = duration / markerPair.speed;
  return {
    text: `${durationHHMMSS}/${markerPair.speed} = ${toHHMMSSTrimmed(outputDuration)}`,
    outputDuration,
  };
}

// speed.ts:23-26.
const oracleIsActive = (currentTime: number, pair: { start: number; end: number }) =>
  currentTime >= Math.floor(pair.start * 1e6) / 1e6 &&
  currentTime <= Math.ceil(pair.end * 1e6) / 1e6;

// preview-toggles.ts:140-141.
const oracleFadeBounds = (pair: { start: number; end: number }) => ({
  start: Math.floor(pair.start * 1e6) / 1e6,
  end: Math.ceil(pair.end * 1e6) / 1e6,
});

// frame-capture.ts:200.
const oracleFrameNumber = (seconds: number, fps: number) => Math.floor(seconds * fps);

// crop-keyframe-math.ts:29-65, with util.ts bsearch and chartPrimitives sortX replaced by a scan
// that gives the same brackets for a sorted map.
function oracleBsearch(map: CropPoint[], time: number): [number, number] {
  const exact = map.findIndex((p) => p.x === time);
  if (exact >= 0) return [exact, exact];
  const right = map.findIndex((p) => p.x > time);
  return right < 0 ? [map.length - 1, map.length] : [right - 1, right];
}
function oracleFindCropKeyframeAtTime(cropMap: CropPoint[], time: number, fps: number) {
  const lastIndex = cropMap.length - 1;
  const [rawStart, rawEnd] = oracleBsearch(cropMap, time);
  const s = Math.max(0, Math.min(rawStart, lastIndex));
  const e = Math.max(0, Math.min(rawEnd, lastIndex));
  const distToStart = Math.abs(cropMap[s].x - time);
  const distToEnd = Math.abs(cropMap[e].x - time);
  const index = distToStart <= distToEnd ? s : e;
  const onKeyframe = Math.min(distToStart, distToEnd) < oracleFrameDuration(fps);
  return { onKeyframe, index, section: [s, e] };
}
function oracleNextKeyframeIndex(cropMap: CropPoint[], time: number, fps: number, dir: 1 | -1) {
  const { onKeyframe, index, section } = oracleFindCropKeyframeAtTime(cropMap, time, fps);
  const next =
    dir > 0 ? (onKeyframe ? index + 1 : section[1]) : onKeyframe ? index - 1 : section[0];
  return Math.max(0, Math.min(next, cropMap.length - 1));
}

// charts.ts:931-935: the parked point, or null.
function oracleParkedPoint(cropMap: CropPoint[], time: number, fps: number, paused: boolean) {
  const { index } = oracleFindCropKeyframeAtTime(cropMap, time, fps);
  const parkedPoint = cropMap[index];
  return parkedPoint && paused && oracleIsWithinSameFrame(time, parkedPoint.x, fps) ? index : null;
}

// crop-keyframe-math.ts:95-108.
function oracleGetEaseSectionDuration(startTime: number, endTime: number, fps: number) {
  const realDuration = endTime - startTime;
  if (realDuration <= 0) return null;
  const leftFrameIndex = Math.floor(endTime * fps);
  const adjustedDuration = (leftFrameIndex - 0.5) / fps - startTime;
  if (adjustedDuration <= 0) return realDuration;
  return adjustedDuration;
}

// Cinematic's cut on the frame of crop-keyframe-math.ts:103: half a frame before frame
// floor(cutX * fps).
const oracleCutTime = (cutX: number, fps: number) => (Math.floor(cutX * fps) - 1 + 0.5) / fps;

// ─── the sweep ───────────────────────────────────────────────────────────────

const RATES = [24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60, 120];
const DURATION = 120;

/** Times at and around frame starts at `rate`, mid-frame, rounded as saved files and YouTube round
 *  them, and the video's edges. */
function sweepTimes(rate: number): number[] {
  const frames = [0, 1, 2, 29, 30, 89, 90, 1799, Math.floor(DURATION * rate) - 1];
  const offsets = [-0.001, -0.0005, -1e-6, 0, 1e-6, 0.0005, 0.001];
  const fractions = [0.25, 0.5, 0.75, 0.99];
  const times = frames.flatMap((n) => [
    ...offsets.map((d) => n / rate + d),
    ...fractions.map((f) => (n + f) / rate),
  ]);
  const rounded = times.flatMap((t) => [Math.round(t * 1e3) / 1e3, Math.round(t * 1e6) / 1e6]);
  return [...new Set([...times, ...rounded, 0, DURATION])].filter((t) => t >= 0 && t <= DURATION);
}

function reading(currentTime: number, rate: number): FrameReading {
  return {
    currentTime,
    pendingSeek: currentTime + 0.5,
    seeking: true,
    onScreen: { mediaTime: currentTime - 0.01, isRead: true, isCurrent: true },
    grid: { origin: 0, rate },
    isRateMeasured: true,
    ownSeek: { target: currentTime, frameStart: currentTime - 0.01, kind: 'place' },
  };
}

/** Every time where `actual` and `expected` differ, so a failure names its cases. */
function mismatches<T>(times: number[], actual: (t: number) => T, expected: (t: number) => T) {
  return times
    .map((t) => ({ t, actual: actual(t), expected: expected(t) }))
    .filter(({ actual, expected }) => !Object.is(JSON.stringify(actual), JSON.stringify(expected)));
}

describe.each(RATES.map((rate) => [Number(rate.toFixed(3)), rate]))('at %p fps', (_fps, rate) => {
  const grid = { origin: 0, rate };
  const at = (t: number) => reading(t, rate);
  // A pair on frames 30 to 90, its markers placed mid-frame as 5.48 stored the playhead, off the
  // microsecond, which 5.48 rounded the pair's edges to.
  const pair = { start: 30.4 / rate + 7e-7, end: 90.6 / rate + 3e-7 };
  const cropMap: CropPoint[] = [pair.start, 45 / rate, 60.5 / rate, pair.end].map((x) => ({
    x,
    y: 0,
    crop: '0:0:100:100',
  }));
  // The edges of 5.48's tests: half a frame and a frame off each point, and the microsecond
  // rounding of the pair's edges.
  const edges = cropMap.flatMap(({ x }) =>
    [-1, -0.5, 0.5, 1].flatMap((f) => [x + f / rate, x + f / rate - 1e-9, x + f / rate + 1e-9])
  );
  const micros = [pair.start, pair.end].flatMap((x) => [
    Math.floor(x * 1e6) / 1e6,
    Math.ceil(x * 1e6) / 1e6,
    Math.round(x * 1e6) / 1e6,
    x - 1e-7,
    x + 1e-7,
  ]);
  const times = [...sweepTimes(rate), ...edges, ...micros];

  it('reads, places and seeks at the raw playhead', () => {
    expect(
      mismatches(
        times,
        (t) => timing.frameTime(at(t)),
        (t) => t
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => timing.screenFrame(at(t)).start,
        (t) => t
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => timing.presentedFrameStart(at(t), t),
        (t) => t
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => timing.placeSeek(grid, t),
        (t) => ({ to: t, ownSeek: null })
      )
    ).toEqual([]);
    expect(
      mismatches(
        [-3, -1, 1, 3],
        (frames) => timing.stepSeek(at(5), { frames, duration: DURATION, hasFrameCallbacks: true }),
        (frames) => ({ by: frames / rate })
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => timing.editFrameTime({ isPaused: true, presentedTime: t, frameTime: () => -1 }),
        (t) => t
      )
    ).toEqual([]);
  });

  it('loops back to the start as 5.48 did', () => {
    const turn = (t: number) =>
      timing.loopTurnBack(at(t), {
        ...pair,
        isPlaying: true,
        held: null,
        refresh: { time: 1000, gap: 16.7 },
        playbackRate: 1,
        lastOtherFrameAt: 7,
      });
    expect(
      mismatches(
        times,
        (t) => turn(t).seekTo,
        (t) => oracleLoop(t, pair.start, pair.end, rate)
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => turn(t).lastOtherFrameAt,
        () => 7
      )
    ).toEqual([]);
  });

  it('places, moves, drags and nudges markers by time', () => {
    const last = { start: 40 / rate, end: 80 / rate };
    const moveDecision = (type: 'start' | 'end', t: number) => {
      // moveMarker's order in the shell (markers.ts).
      if (type === 'start' && timing.compareFrames(grid, t, pair.end) >= 0) return 'refused';
      if (type === 'end' && timing.compareFrames(grid, t, pair.start) <= 0) return 'refused';
      return timing.isStretch(grid, type, t, last);
    };
    for (const type of ['start', 'end'] as const) {
      expect(
        mismatches(
          times,
          (t) => moveDecision(type, t),
          (t) => oracleMoveMarker(type, t, pair, last)
        )
      ).toEqual([]);
      expect(
        mismatches(
          times,
          (t) => timing.dragClamp(grid, type, t, pair, DURATION),
          (t) => oracleDragTime(type, t, pair, DURATION)
        )
      ).toEqual([]);
    }
    // markers.ts had no same-frame no-op.
    expect(
      mismatches(
        times,
        (t) => timing.isOnMarkerFrame(grid, t, pair.start),
        () => false
      )
    ).toEqual([]);
    expect(
      mismatches(
        times,
        (t) => timing.compareFrames(grid, t, pair.start) <= 0,
        (t) => oracleAddEndMarkerRefused(t, pair.start)
      )
    ).toEqual([]);
    for (const deltaY of [-100, 100]) {
      expect(
        mismatches(
          times,
          (t) => timing.nudge(grid, t, deltaY, DURATION),
          (t) => {
            const { moved, seeked } = oracleNudge(rate, t, deltaY, DURATION);
            return { markerTime: moved, seekTime: seeked };
          }
        )
      ).toEqual([]);
    }
  });

  it('jumps to marker times rounded to 6 decimals', () => {
    // Two markers on one frame and one a microsecond off another, as 5.48 could store them.
    const markerTimes = [pair.start, pair.end, 60 / rate, 60 / rate + 1e-7, 75.2 / rate];
    for (const key of ['ArrowLeft', 'ArrowRight'] as const) {
      for (const isDoubleJump of [false, true]) {
        expect(
          mismatches(
            times,
            (t) => timing.jumpTarget(grid, markerTimes, t, key, isDoubleJump),
            (t) => oracleJump(markerTimes, t, key, isDoubleJump ? 1 : 0, key)
          )
        ).toEqual([]);
      }
    }
  });

  it('shows a pair duration as end less start, with no frame count', () => {
    const speedMaps: SpeedPoint[][] = [
      [
        { x: pair.start, y: 1 },
        { x: pair.end, y: 1 },
      ],
      [
        { x: pair.start, y: 1 },
        { x: (pair.start + pair.end) / 2, y: 0.5 },
        { x: pair.end, y: 1 },
      ],
    ];
    for (const speedMap of speedMaps) {
      for (const speed of [1, 0.5, 2]) {
        for (const isVariableSpeed of [false, true]) {
          const markerPair = { ...pair, speed, speedMap };
          expect(timing.pairDuration(grid, markerPair, isVariableSpeed)).toEqual(
            oracleMarkerPairDuration(markerPair, rate, isVariableSpeed)
          );
        }
      }
    }
  });

  it('finds the active pair, the fade bounds and a captured frame number by time', () => {
    expect(
      mismatches(
        times,
        (t) => timing.isInPair(grid, pair, t),
        (t) => oracleIsActive(t, pair)
      )
    ).toEqual([]);
    const { start, end } = timing.pairSpan(grid, pair);
    expect({ start, end }).toEqual(oracleFadeBounds(pair));
    expect(
      mismatches(
        times,
        (t) => timing.frameNumber(grid, t),
        (t) => oracleFrameNumber(t, rate)
      )
    ).toEqual([]);
  });

  it('finds crop points within a frame, steps between them and snaps to a parked one', () => {
    expect(
      mismatches(
        times,
        (t) => timing.findCropKeyframe(grid, cropMap, t),
        (t) => oracleFindCropKeyframeAtTime(cropMap, t, rate)
      )
    ).toEqual([]);
    for (const dir of [1, -1] as const) {
      expect(
        mismatches(
          times,
          (t) => timing.nextKeyframeIndex(grid, cropMap, t, dir),
          (t) => oracleNextKeyframeIndex(cropMap, t, rate, dir)
        )
      ).toEqual([]);
    }
    for (const isPaused of [true, false]) {
      expect(
        mismatches(
          times,
          // 5.48 read only the drawn time: the frame time is a decoy.
          (t) => timing.parkedPointIndex(grid, cropMap, { frameTime: 0, time: t, isPaused }),
          (t) => oracleParkedPoint(cropMap, t, rate, isPaused)
        )
      ).toEqual([]);
    }
  });

  it("snaps Cinematic's cuts to the frame 5.48's crop ease ends on", () => {
    expect(
      mismatches(
        times,
        (t) => timing.cutFrameMiddle(grid, t),
        (t) => oracleCutTime(t, rate)
      )
    ).toEqual([]);
  });

  it('eases a crop section over the span 5.48 did', () => {
    for (const start of [0, pair.start, 45 / rate]) {
      expect(
        mismatches(
          times,
          (t) => timing.easeSectionDuration(start, t, rate),
          (t) => oracleGetEaseSectionDuration(start, t, rate)
        )
      ).toEqual([]);
    }
  });
});

// The oracle can fail: the 5.49 rules disagree with it where 5.48 and 5.49 differ.
it('the oracle tells 5.49 from 5.48', () => {
  const { frameTiming549 } = jest.requireActual('./frame-timing-549');
  const grid = { origin: 0, rate: 30 };
  expect(frameTiming549.frameTime(reading(3.0123, 30))).not.toBe(3.0123);
  expect(frameTiming549.isInPair(grid, { start: 1, end: 2 }, 2.02)).not.toBe(
    oracleIsActive(2.02, { start: 1, end: 2 })
  );
  expect(frameTiming549.cutFrameMiddle(grid, 0.9995)).not.toBeCloseTo(oracleCutTime(0.9995, 30), 6);
  expect(frameTiming549.easeSectionDuration(0, 0.9995, 30)).not.toBeCloseTo(
    oracleGetEaseSectionDuration(0, 0.9995, 30) as number,
    6
  );
});
