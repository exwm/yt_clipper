import { PLACEMENT_TOLERANCE, frameSeekTarget } from './frame-grid';
import { frameStepTarget, frameTime, presentedFrameStart } from './frame-step';

// A frozen copy of frame-step.ts as of 5.49 (uxrlrlyt), the oracle the consolidation is checked
// against. Deleted once the consolidation lands.
namespace Oracle {
  export interface FrameSeek {
    target: number;
    frameTime: number;
  }
  const FRAME_TIME_ROUNDING = 0.0005;
  const TIME_ROUNDING = 0.00001;
  function holdsPlayhead(presentedFrameTime: number, playhead: number, fps: number): boolean {
    return (
      presentedFrameTime <= playhead + PLACEMENT_TOLERANCE &&
      playhead < presentedFrameTime + 1 / fps + FRAME_TIME_ROUNDING
    );
  }
  function containsPlayhead(presentedFrameTime: number, playhead: number, fps: number): boolean {
    return presentedFrameTime <= playhead && playhead + TIME_ROUNDING < presentedFrameTime + 1 / fps;
  }
  function mayBeRetimed(t: number, playhead: number, fps: number, seekRetimesFrame: boolean) {
    const gridOffset = Math.abs(t * fps - Math.round(t * fps));
    return (
      seekRetimesFrame &&
      Math.abs(t - playhead) < TIME_ROUNDING &&
      gridOffset > FRAME_TIME_ROUNDING * fps
    );
  }
  function gridFrameStart(playhead: number, fps: number): number {
    return Math.floor(playhead * fps + 1e-9) / fps;
  }
  export function presentedFrameStart(t: number, playhead: number, fps: number, retimes: boolean) {
    return mayBeRetimed(t, playhead, fps, retimes) ? gridFrameStart(playhead, fps) : t;
  }
  function isPlayheadsFrame(at: {
    presentedFrameTime: number;
    playhead: number;
    isFrameCurrent: boolean;
    fps: number;
    mustHold: boolean;
  }): boolean {
    const { presentedFrameTime, playhead, isFrameCurrent, fps, mustHold } = at;
    const isCurrentFrame =
      isFrameCurrent && (!mustHold || holdsPlayhead(presentedFrameTime, playhead, fps));
    return isCurrentFrame || containsPlayhead(presentedFrameTime, playhead, fps);
  }
  export function frameTime(at: {
    presentedFrameTime: number;
    playhead: number;
    isSeekInFlight: boolean;
    isFrameCurrent: boolean;
    lastFrameSeek: FrameSeek | null;
    fps: number;
    seekRetimesFrame: boolean;
  }): number {
    const { presentedFrameTime, playhead, isSeekInFlight, isFrameCurrent, lastFrameSeek, fps } = at;
    if (
      lastFrameSeek != null &&
      Math.abs(playhead - lastFrameSeek.target) < 1 / fps / 4 &&
      playhead >= lastFrameSeek.frameTime - PLACEMENT_TOLERANCE
    ) {
      return lastFrameSeek.frameTime;
    }
    const onScreen = { presentedFrameTime, playhead, isFrameCurrent, fps, mustHold: false };
    if (!isSeekInFlight && isPlayheadsFrame(onScreen)) {
      return presentedFrameStart(presentedFrameTime, playhead, fps, at.seekRetimesFrame);
    }
    return Math.max(0, playhead - PLACEMENT_TOLERANCE);
  }
  export function frameStepTarget(step: {
    presentedFrameTime: number;
    playhead: number;
    isFrameCurrent: boolean;
    lastTarget: number | null;
    fps: number;
    duration: number;
    frames: number;
    seekRetimesFrame: boolean;
  }): number {
    const { presentedFrameTime, playhead, isFrameCurrent, lastTarget, fps, duration, frames } = step;
    const frameDuration = 1 / fps;
    const lastMiddle = Number.isFinite(duration) ? duration - frameDuration / 2 : Infinity;
    const playheadInVideo = Math.min(playhead, lastMiddle);
    const onScreen = {
      presentedFrameTime,
      playhead: playheadInVideo,
      isFrameCurrent,
      fps,
      mustHold: true,
    };
    const frameStart =
      isPlayheadsFrame(onScreen) &&
      !mayBeRetimed(presentedFrameTime, playheadInVideo, fps, step.seekRetimesFrame)
        ? presentedFrameTime
        : lastTarget != null && Math.abs(playheadInVideo - lastTarget) < frameDuration / 4
          ? lastTarget - frameDuration / 2
          : gridFrameStart(playheadInVideo, fps);
    const target = frameStart + (frames + 0.5) * frameDuration;
    return Math.min(Math.max(target, frameDuration / 2), lastMiddle);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A moment the frame clock can produce: what is on screen, the playhead, the rate in use, and the
 *  markup's last own seek (a jump to a placed time, or a step). */
interface State {
  browser: 'chrome' | 'firefox';
  videoFps: number;
  fps: number;
  isRateExact: boolean;
  mediaTime: number;
  isRead: boolean;
  isCurrent: boolean;
  playhead: number;
  isSeekInFlight: boolean;
  lastSeek: { kind: 'place'; time: number; target: number } | { kind: 'step'; target: number } | null;
  duration: number;
  frames: number;
}

function clockStates(seed: number, count: number): State[] {
  const random = mulberry32(seed);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];
  return Array.from({ length: count }, (): State => {
    const browser = random() < 0.5 ? 'chrome' : 'firefox';
    const videoFps = pick([24, 25, 30000 / 1001, 30, 50, 60]);
    const fps = pick([videoFps, videoFps, 60, 30, 25]);
    const isRateExact = fps === videoFps && random() < 0.6;
    const roundToMs = random() < 0.5;
    const start = (n: number) =>
      roundToMs ? Math.round((n / videoFps) * 1000) / 1000 : n / videoFps;
    const nearEnd = random() < 0.1;
    const lastFrame = 2000;
    const n = nearEnd ? lastFrame - Math.floor(random() * 3) : Math.floor(random() * lastFrame);
    const duration = (lastFrame + 1) / videoFps;
    const into = pick([0, 0, 0.0001, 0.03, 0.5, 0.97, 0.9999, random()]);
    let playhead = into === 0 ? start(n) : (n + into) / videoFps;
    let mediaTime = start(n);
    let isCurrent = true;
    let isRead = false;
    let isSeekInFlight = false;
    switch (pick(['settled', 'settled', 'playing', 'inFlight', 'late', 'ended'] as const)) {
      case 'settled':
        // Gecko times the first frame after a seek at its target; Chromium reads it at `seeked`.
        if (browser === 'firefox' && random() < 0.7) mediaTime = playhead;
        if (browser === 'chrome') isRead = random() < 0.7;
        break;
      case 'playing':
        mediaTime = start(Math.max(0, n - pick([0, 0, 1])));
        break;
      case 'inFlight':
        isSeekInFlight = true;
        isCurrent = false;
        mediaTime = start(Math.max(0, n + pick([-30, -1, 0, 1, 2])));
        break;
      case 'late':
        // A seek finished whose frame hasn't shown yet: an earlier frame, or one that never held it.
        isCurrent = false;
        mediaTime = start(Math.max(0, n + pick([-30, -1, 0, 1])));
        break;
      case 'ended':
        playhead = duration;
        mediaTime = start(lastFrame);
        break;
    }
    const placed = start(n) - pick([0, 0.0015, 0.0004]);
    const lastSeek = pick([
      null,
      { kind: 'place' as const, time: placed, target: frameSeekTarget({ origin: 0, rate: fps }, placed) },
      { kind: 'step' as const, target: playhead },
      { kind: 'step' as const, target: playhead + pick([-0.3, 0.2, 0.3, 1.5]) / fps },
    ]);
    if (lastSeek?.kind === 'place' && random() < 0.5) playhead = lastSeek.target;
    return {
      browser,
      videoFps,
      fps,
      isRateExact,
      mediaTime,
      isRead,
      isCurrent,
      playhead,
      isSeekInFlight,
      lastSeek,
      duration,
      frames: pick([-5, -1, 1, 1, 3]),
    };
  });
}

// What today's shell passes the frame-step functions for a state.
function oracleInputs(s: State) {
  return {
    presentedFrameTime: s.mediaTime,
    playhead: s.playhead,
    isSeekInFlight: s.isSeekInFlight,
    isFrameCurrent: s.isCurrent,
    lastFrameSeek:
      s.lastSeek?.kind === 'place' ? { target: s.lastSeek.target, frameTime: s.lastSeek.time } : null,
    lastTarget: s.lastSeek?.kind === 'step' ? s.lastSeek.target : null,
    fps: s.fps,
    duration: s.duration,
    frames: s.frames,
    seekRetimesFrame: s.browser === 'firefox',
  };
}

// The production functions over the same state.
const production = {
  frameTime: (s: State) => frameTime(oracleInputs(s)),
  frameStepTarget: (s: State) => frameStepTarget(oracleInputs(s)),
  frameStart: (s: State) =>
    presentedFrameStart(s.mediaTime, s.playhead, s.fps, s.browser === 'firefox'),
};

describe('the frame-step functions against the 5.49 oracle', () => {
  const states = clockStates(1, 30000);
  it.each([
    ['frameTime', (s: State) => Oracle.frameTime(oracleInputs(s)), production.frameTime],
    [
      'frameStepTarget',
      (s: State) => Oracle.frameStepTarget(oracleInputs(s)),
      production.frameStepTarget,
    ],
    [
      'the start of a presented frame',
      (s: State) =>
        Oracle.presentedFrameStart(s.mediaTime, s.playhead, s.fps, s.browser === 'firefox'),
      production.frameStart,
    ],
  ] as const)('%s agrees over clock states', (_name, oracle, actual) => {
    const differ = states.filter((s) => Math.abs(oracle(s) - actual(s)) > 1e-12);
    expect(differ.slice(0, 3)).toEqual([]);
  });
});
