import {
  FrameScheduleAction,
  FrameScheduleEvent,
  FrameScheduleState,
  initialFrameSchedule,
  retimeFrameSchedule,
  stepFrameSchedule,
} from './video-frame-schedule';

function run(state: FrameScheduleState, events: FrameScheduleEvent[]) {
  const actions: FrameScheduleAction[] = [];
  for (const event of events) {
    const result = stepFrameSchedule(state, event);
    state = result.state;
    actions.push(...result.actions);
  }
  return { state, actions };
}

const refresh = (paused = false, seeking = false): FrameScheduleEvent => ({
  type: 'refresh',
  paused,
  seeking,
});
const taken = (frameTime: number, videoTime = frameTime): FrameScheduleEvent => ({
  type: 'frameTaken',
  frameTime,
  videoTime,
});
const callback = (mediaTime: number, presentedFrames = 1): FrameScheduleEvent => ({
  type: 'frameCallback',
  mediaTime,
  presentedFrames,
});

describe('stepFrameSchedule', () => {
  // A loop that has drawn the frame on screen once, as it does at its first refresh.
  const everyRefresh = run(initialFrameSchedule('everyRefresh'), [refresh(true)]).state;

  it('takes the frame on screen at a new loop\'s first refresh, even while paused', () => {
    expect(run(initialFrameSchedule('everyRefresh'), [refresh(true)]).actions).toEqual([
      { type: 'takeFrame' },
    ]);
  });

  it.each([
    ['takes a frame on a refresh while playing', [refresh()], [{ type: 'takeFrame' }]],
    ['takes nothing on a refresh while paused', [refresh(true)], []],
    [
      'takes a frame again at the next refresh when none was decoded yet',
      [{ type: 'seeked' }, refresh(true), { type: 'frameUnavailable' }, refresh(true), refresh(true)],
      [{ type: 'takeFrame' }, { type: 'takeFrame' }],
    ],
    ['takes a frame while paused and seeking', [refresh(true, true)], [{ type: 'takeFrame' }]],
    [
      'takes a frame once after a seek ends while paused',
      [{ type: 'seeked' }, refresh(true), refresh(true)],
      [{ type: 'takeFrame' }],
    ],
    [
      'takes a frame once after a frame callback while paused',
      [callback(4), refresh(true), refresh(true)],
      [{ type: 'takeFrame' }],
    ],
    [
      'passes a new frame on, and not again',
      [taken(4), taken(4)],
      [{ type: 'dispatch', mediaTime: 4, image: 'videoFrame' }],
    ],
    [
      'falls back when the first frame is on another timeline',
      [taken(500, 4)],
      [{ type: 'fallBackToFrameCallback', offsetSeconds: 496 }],
    ],
  ] as [string, FrameScheduleEvent[], FrameScheduleAction[]][])('%s', (_, events, expected) => {
    expect(run(everyRefresh, events).actions).toEqual(expected);
  });

  it('checks the timeline only on the first frame, so a later seek far away passes on', () => {
    const { actions } = run(everyRefresh, [taken(4), taken(900, 4)]);
    expect(actions.map((a) => a.type)).toEqual(['dispatch', 'dispatch']);
  });

  it('under the frame callback, passes on each reported frame from the video', () => {
    const { actions } = run(initialFrameSchedule('frameCallback'), [
      refresh(),
      callback(4, 7),
      taken(4.1),
    ]);
    expect(actions).toEqual([{ type: 'dispatch', mediaTime: 4, image: 'video', presentedFrames: 7 }]);
  });

  it('keeps the last frame passed on across a change of timing, and takes the frame on screen', () => {
    const { state } = run(everyRefresh, [taken(4)]);
    const retimed = retimeFrameSchedule(state, 'frameCallback');
    expect(retimed).toMatchObject({ timing: 'frameCallback', lastDispatchedTime: 4 });
    const back = retimeFrameSchedule(retimed, 'everyRefresh');
    expect(run(back, [refresh(true), taken(4)]).actions).toEqual([{ type: 'takeFrame' }]);
  });

  it('stays on the frame callback after a fallback, until the source changes', () => {
    const { state } = run(everyRefresh, [taken(500, 4)]);
    expect(state).toMatchObject({ timing: 'frameCallback', timestampsDisagree: true });
    const changed = run(state, [{ type: 'sourceChanged' }]).state;
    expect(changed).toMatchObject({ timestampsDisagree: false, timestampsChecked: false });
  });

  it('passes on the first frame of a new source, even at the time the last one ended on', () => {
    const { state } = run(everyRefresh, [taken(0.5)]);
    const { actions } = run(state, [{ type: 'sourceChanged' }, refresh(true), taken(0.5)]);
    expect(actions).toEqual([
      { type: 'takeFrame' },
      { type: 'dispatch', mediaTime: 0.5, image: 'videoFrame' },
    ]);
  });
});

// ─── simulated playback ──────────────────────────────────────────────────────

// A small seeded PRNG (mulberry32), so a failing scenario replays exactly.
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scenario {
  refreshHz: number;
  fps: number;
  rate: number;
  callbackMissRate: number;
  seed: number;
}

interface Outcome {
  // Each time a frame came on screen, by the refresh it came on at. A seek back shows a frame again.
  shown: { time: number; refresh: number }[];
  // Each frame passed on, by the refresh it was passed on at, in order.
  dispatched: { time: number; refresh: number }[];
  takesPerRefresh: number[];
  takesWhilePausedUnwoken: number;
}

// Plays a video for a few seconds of screen refreshes: a stall, a pause with seeks while paused (each
// taking a refresh to decode, when no frame can be taken), a seek while playing, and a new source.
// Within a refresh the frame callback runs before the refresh event, as the browser runs video frame
// callbacks before animation frames.
function simulate({ refreshHz, fps, rate, callbackMissRate, seed }: Scenario): Outcome {
  const random = seededRandom(seed);
  const frameAt = (playhead: number) => Math.floor(playhead * fps + 1e-9) / fps;
  let state = initialFrameSchedule('everyRefresh');
  let playhead = 10;
  let paused = false;
  let shown: number | null = null;
  let presentedFrames = 0;
  let pendingSeek = false;
  let decodingRefreshes = 0;
  let sourceChanged = false;
  const outcome: Outcome = {
    shown: [],
    dispatched: [],
    takesPerRefresh: [],
    takesWhilePausedUnwoken: 0,
  };
  const refreshes = refreshHz * 4;
  for (let k = 0; k < refreshes; k++) {
    const second = k / refreshHz;
    const stalled = second >= 0.8 && second < 1.0;
    if (second >= 1.6 && second < 2.4) {
      paused = true;
      // Seeks while paused: a frame step, then a jump.
      if (k === Math.round(1.8 * refreshHz)) {
        playhead = frameAt(playhead) + 1 / fps;
        pendingSeek = true;
        decodingRefreshes = 1;
      }
      if (k === Math.round(2.1 * refreshHz)) {
        playhead -= 3;
        pendingSeek = true;
        decodingRefreshes = 1;
      }
    } else {
      paused = false;
      if (k === Math.round(3.0 * refreshHz)) playhead += 20;
      // A new video in the same element, starting from the top.
      if (k === Math.round(3.5 * refreshHz)) {
        playhead = 0;
        sourceChanged = true;
      }
      if (!stalled) playhead += rate / refreshHz;
    }

    // While the seek's frame decodes, the old frame stays on screen and none can be taken.
    const decoding = decodingRefreshes > 0;
    decodingRefreshes = Math.max(0, decodingRefreshes - 1);
    const frame: number = decoding && shown != null ? shown : frameAt(playhead);
    const events: FrameScheduleEvent[] = [];
    if (sourceChanged) events.push({ type: 'sourceChanged' });
    sourceChanged = false;
    if (frame !== shown) {
      shown = frame;
      presentedFrames++;
      outcome.shown.push({ time: frame, refresh: k });
      if (random() >= callbackMissRate) {
        events.push({ type: 'frameCallback', mediaTime: frame, presentedFrames });
      }
    }
    if (pendingSeek) events.push({ type: 'seeked' });
    const wokenBefore = state.woken || pendingSeek || events.some((e) => e.type === 'frameCallback');
    pendingSeek = false;
    events.push({ type: 'refresh', paused, seeking: false });

    let takes = 0;
    for (const event of events) {
      const queue: FrameScheduleEvent[] = [event];
      while (queue.length > 0) {
        const result = stepFrameSchedule(state, queue.shift() as FrameScheduleEvent);
        state = result.state;
        for (const action of result.actions) {
          if (action.type === 'takeFrame') {
            takes++;
            queue.push(
              decoding
                ? { type: 'frameUnavailable' }
                : { type: 'frameTaken', frameTime: frame, videoTime: playhead }
            );
          } else if (action.type === 'dispatch') {
            outcome.dispatched.push({ time: action.mediaTime, refresh: k });
          }
        }
      }
    }
    outcome.takesPerRefresh.push(takes);
    if (paused && !wokenBefore) outcome.takesWhilePausedUnwoken += takes;
  }
  return outcome;
}

const scenarios: Scenario[] = [];
let seed = 1;
for (const refreshHz of [60, 120, 144]) {
  for (const fps of [24000 / 1001, 24, 30, 50, 60000 / 1001, 60]) {
    for (const rate of [0.25, 1, 2]) {
      for (const callbackMissRate of [0, 0.1, 0.3]) {
        scenarios.push({ refreshHz, fps, rate, callbackMissRate, seed: seed++ });
      }
    }
  }
}

describe('the frame schedule over simulated playback', () => {
  const label = (s: Scenario) =>
    `${s.fps.toFixed(3)} fps on ${s.refreshHz} Hz at ${s.rate}x, ${s.callbackMissRate * 100}% callbacks missed (seed ${s.seed})`;
  const outcomes = scenarios.map((scenario) => ({ scenario, outcome: simulate(scenario) }));

  it('passes every frame shown on, at the refresh it comes on screen', () => {
    const key = (d: { time: number; refresh: number }) => `${d.time}@${d.refresh}`;
    const failures = outcomes.flatMap(({ scenario, outcome }) => {
      const dispatched = new Set(outcome.dispatched.map(key));
      const late = outcome.shown.filter((s) => !dispatched.has(key(s)));
      return late.length ? [`${label(scenario)}: ${late.length} frames late or missed`] : [];
    });
    expect(failures).toEqual([]);
  });

  it('passes each frame on once in a row', () => {
    const failures = outcomes.flatMap(({ scenario, outcome }) => {
      const repeats = outcome.dispatched.filter(
        (d, i) => i > 0 && d.time === outcome.dispatched[i - 1].time
      );
      return repeats.length ? [`${label(scenario)}: ${repeats.length} repeats`] : [];
    });
    expect(failures).toEqual([]);
  });

  it('takes at most one frame per refresh, and none while paused unless woken', () => {
    const failures = outcomes.flatMap(({ scenario, outcome }) => {
      const most = Math.max(...outcome.takesPerRefresh);
      return most > 1 || outcome.takesWhilePausedUnwoken > 0
        ? [`${label(scenario)}: ${most} per refresh, ${outcome.takesWhilePausedUnwoken} paused`]
        : [];
    });
    expect(failures).toEqual([]);
  });
});
