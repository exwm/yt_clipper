/**
 * Each frame decision group's releases against 5.48's, over simulated playback (__sim__/): a group on
 * 5.48 decides exactly as 5.48 whatever the other groups use, and a release whose decisions differ
 * is never worse than 5.48 in any scenario. Where it is, the class of scenarios is pinned below as a
 * strict failing case with its finding, never loosened.
 */
import {
  BROWSERS,
  Browser,
  clipper548EndFrame,
  clipper548StartFrame,
  clipper549Frame,
  frameTimestamp,
  gridOf,
  legacyRate,
  pausedOnScreen,
  playheadAs,
  rateRelation,
  shownAt,
  SIM_RATES,
  Site,
  Video,
} from './__sim__/video-model';
import { INITIAL_LOOP_STATE, LoopState } from './decisions/loop';
import { FrameTimingRelease } from './decisions/keys';
import type { OwnSeek } from './frame-step';
import {
  composeFrameTiming,
  frameDecisionGroups,
  FrameDecisionGroup,
  FrameReading,
  FrameTiming,
  FrameTimingReleases,
} from './frame-timing';

// Read once: jest runs modules in a vm context, where each global Math lookup is slow.
const Math = globalThis.Math;

/** A group's actions over its scenarios. `score` is 0 for a right outcome and grows with how wrong
 *  it is. A release's inputs and reader pair with it: a placement is read by its release's clipper
 *  ('next' by 5.48's until a fix there pairs with a clipper rule). */
interface Entry<S> {
  group: FrameDecisionGroup;
  scenarios: S[];
  classOf(s: S): string;
  act(timing: FrameTiming, s: S, pairedWith: FrameTimingRelease): unknown;
  score(outcome: unknown, s: S, pairedWith: FrameTimingRelease): number;
}

const reads549 = (release: FrameTimingRelease) => release === '5.49';

const SITES: readonly Site[] = ['other', 'youtube'];
const videosOf = (origins: readonly number[]) =>
  SIM_RATES.flatMap((rate) =>
    SITES.flatMap((site) =>
      [false, true].flatMap((msTimestamps) =>
        origins
          .filter((origin) => site === 'other' || (rate <= 60 && origin === 0))
          .map((origin) => ({
            site,
            fps: legacyRate(site, rate),
            v: { rate, origin, msTimestamps, duration: 7200 } as Video,
          }))
      )
    )
  );
const timestampsOf = (v: Video) => (v.msTimestamps ? 'ms' : 'exact');
const phasesIn = (n: number) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

/** The reading of a video paused where a seek left the playhead at `p`. */
function pausedReading(b: Browser, v: Video, p: number, fps: number): FrameReading {
  return {
    currentTime: p,
    pendingSeek: null,
    seeking: false,
    onScreen: pausedOnScreen(b, v, p),
    grid: gridOf(fps),
    isRateMeasured: false,
    ownSeek: null,
  };
}

// A marker or point placed while paused on the frame a seek left on screen; right when its clipper
// takes the stored time to mean that frame.
interface PlacementScenario {
  site: Site;
  fps: number;
  v: Video;
  b: Browser;
  p: number;
  // Uniform playheads, or ones within 1 ms of a frame's edge.
  at: 'uniform' | 'edge';
  kind: 'start' | 'end';
}
const placementEntry: Entry<PlacementScenario> = {
  group: 'placement',
  scenarios: videosOf([0, 0.0333]).flatMap(({ site, fps, v }) =>
    [1, 1799].flatMap((k) => {
      const start = v.origin + k / v.rate;
      const edges = [0, 1e-6, 0.0005, 0.001, 1 / v.rate - 0.0009, 1 / v.rate - 1e-6];
      const times = [
        ...phasesIn(12).map((f) => [start + f / v.rate, 'uniform'] as const),
        ...edges.map((e) => [start + e, 'edge'] as const),
      ];
      return times.flatMap(([p0, at]) =>
        BROWSERS.flatMap((b) =>
          (['start', 'end'] as const).map((kind) => ({
            site,
            fps,
            v,
            b,
            p: playheadAs(b, p0),
            at,
            kind,
          }))
        )
      );
    })
  ),
  classOf: (s) =>
    `${s.site}, ${s.b}, ${timestampsOf(s.v)} timestamps, ${s.at} playheads, ${s.kind} markers`,
  act: (timing, s) => timing.frameTime(pausedReading(s.b, s.v, s.p, s.fps)),
  score(outcome, s, pairedWith) {
    const t = outcome as number;
    const read = reads549(pairedWith)
      ? clipper549Frame
      : s.kind === 'start'
        ? clipper548StartFrame
        : clipper548EndFrame;
    return read(s.v, t) === shownAt(s.v, s.p) ? 0 : 1;
  },
};

// A seek to a placed time, as a marker number click or a jump does; right when it shows the frame the
// time was placed on. Placed times: a 5.48 playhead anywhere in the frame, 5.49's frame start (saved
// to 6 decimals), and 5.49's stand-in, the playhead less 1 ms.
type Stored = '5.48 playhead' | 'frame start' | 'playhead less 1 ms';
interface SeekScenario {
  site: Site;
  fps: number;
  v: Video;
  stored: Stored;
  t: number;
  frame: number;
}
const seekEntry: Entry<SeekScenario> = {
  group: 'seek',
  scenarios: videosOf([0, 0.0333]).flatMap(({ site, fps, v }) =>
    [1, 1799].flatMap((k) => {
      const start = frameTimestamp(v, k);
      const nextStart = frameTimestamp(v, k + 1);
      const playheads = phasesIn(16).map((f) => start + f * (nextStart - start));
      const scenario = (stored: Stored, t: number, frame: number) => ({
        site,
        fps,
        v,
        stored,
        t,
        frame,
      });
      return [
        ...playheads.map((p) => scenario('5.48 playhead', p, k)),
        scenario('frame start', Number(start.toFixed(6)), k),
        ...playheads
          .filter((p) => p - 0.001 >= 0)
          .map((p) => scenario('playhead less 1 ms', p - 0.001, k)),
      ];
    })
  ),
  classOf: (s) => `${s.site}, ${timestampsOf(s.v)} timestamps, ${s.stored}`,
  act(timing, s) {
    const seek = timing.placeSeek(gridOf(s.fps), s.t);
    return 'to' in seek ? seek.to : s.t + seek.by;
  },
  score: (outcome, s) => (shownAt(s.v, outcome as number) === s.frame ? 0 : 1),
};

// Shift+wheel presses while paused, each seek landing before the next press ('slow') or the next
// press coming while the seek is in flight ('fast'); counts frames skipped, presses that show no
// new frame, and steps the wrong way.
interface StepScenario {
  site: Site;
  fps: number;
  v: Video;
  b: Browser;
  p0: number;
  mode: 'slow' | 'fast';
  dir: 1 | -1;
}
const PRESSES = 8;
const stepsEntry: Entry<StepScenario> = {
  group: 'steps',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    phasesIn(6).flatMap((f) =>
      BROWSERS.flatMap((b) =>
        (['slow', 'fast'] as const).flatMap((mode) =>
          ([1, -1] as const).map((dir) => ({
            site,
            fps,
            v: { ...v, duration: 1e6 },
            b,
            p0: frameTimestamp(v, 30) + f / v.rate,
            mode,
            dir,
          }))
        )
      )
    )
  ),
  classOf: (s) =>
    `${s.site}, ${s.b}, ${s.mode}, rate in use ${rateRelation(s.fps, s.v.rate)} the video's`,
  act(timing, s) {
    const { v, b, fps, dir } = s;
    let p = playheadAs(b, s.p0);
    let shown = shownAt(v, p);
    let ownSeek: OwnSeek | null = null;
    const moves: number[] = [];
    for (let i = 0; i < PRESSES; i++) {
      const isInFlight = s.mode === 'fast' && i > 0;
      const reading = pausedReading(b, v, p, fps);
      if (isInFlight) {
        reading.seeking = true;
        reading.onScreen = { ...reading.onScreen, isCurrent: false };
      }
      reading.ownSeek = ownSeek;
      const seek = timing.stepSeek(reading, {
        frames: dir,
        duration: v.duration,
        hasFrameCallbacks: b !== 'noRvfc',
      });
      if ('to' in seek) {
        p = playheadAs(b, seek.to);
        ownSeek = seek.ownSeek;
      } else {
        p = playheadAs(b, p + seek.by);
      }
      const next = shownAt(v, p);
      moves.push((next - shown) * dir);
      shown = next;
    }
    return moves;
  },
  // A press that shows no new frame is wrong only where the rate in use is at or below the video's:
  // above it (the assumed 60 fps), both releases need several presses per frame.
  score(outcome, s) {
    const isStuckWrong = s.fps <= s.v.rate + 1e-9;
    return (outcome as number[]).reduce(
      (wrong, moved) =>
        wrong + (moved > 1 ? moved - 1 : moved < 0 || (moved === 0 && isStuckWrong) ? 1 : 0),
      0
    );
  },
};

// Two placed times on adjacent frames, as a marker pair's ends or two points are; right when they
// compare in order.
interface CompareScenario {
  site: Site;
  fps: number;
  v: Video;
  stored: Stored;
  a: number;
  b: number;
}
const compareEntry: Entry<CompareScenario> = {
  group: 'compare',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    [30, 31, 1799].flatMap((k) => {
      const at = (n: number, f: number) =>
        frameTimestamp(v, n) + f * (frameTimestamp(v, n + 1) - frameTimestamp(v, n));
      const scenario = (stored: Stored, a: number, b: number) => ({ site, fps, v, stored, a, b });
      return [
        ...phasesIn(8).map((f) => scenario('5.48 playhead', at(k, f), at(k + 1, f))),
        scenario('frame start', frameTimestamp(v, k), frameTimestamp(v, k + 1)),
        ...phasesIn(8).map((f) =>
          scenario('playhead less 1 ms', at(k, f) - 0.001, at(k + 1, f) - 0.001)
        ),
      ];
    })
  ),
  classOf: (s) =>
    `${s.site}, ${timestampsOf(s.v)} timestamps, ${s.stored}, rate in use ${rateRelation(s.fps, s.v.rate)} the video's`,
  act: (timing, s) => Math.sign(timing.compareFrames(gridOf(s.fps), s.a, s.b)),
  score: (outcome) => (outcome === -1 ? 0 : 1),
};

// The marker pair loop playing on a 60 Hz display, the playhead `delta` ahead of the picture, each
// seek back taking 1 or 3 refreshes. The markers sit where each release places them (5.48's raw
// playheads, 5.49's frame starts) and the clip is the frames their clipper takes. Counts refreshes
// showing a frame past the clip or before it, and cycles that miss its last frame.
interface LoopScenario {
  site: Site;
  fps: number;
  v: Video;
  first: number;
  last: number;
  phase: number;
  delta: number;
  held: 'duration' | 'no duration' | 'none';
  seekRefreshes: number;
}
const loopEntry: Entry<LoopScenario> = {
  group: 'loop',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    [1, 5].flatMap((pairFrames) =>
      phasesIn(3).flatMap((phase) =>
        [0, 0.004, 0.012].flatMap((delta) =>
          (['duration', 'none'] as const).flatMap((held) =>
            [1, 3].map((seekRefreshes) => ({
              site,
              fps,
              v,
              first: 40 + Math.round(v.rate),
              last: 40 + Math.round(v.rate) + pairFrames,
              phase,
              delta,
              held,
              seekRefreshes,
            }))
          )
        )
      )
    )
  ),
  classOf: (s) =>
    `${s.site}, ${timestampsOf(s.v)} timestamps, playhead ${s.delta * 1000} ms ahead, rate in use ${rateRelation(s.fps, s.v.rate)} the video's`,
  act(timing, s, pairedWith) {
    const { v, fps } = s;
    const is549 = reads549(pairedWith);
    const start = is549
      ? frameTimestamp(v, s.first)
      : frameTimestamp(v, s.first) + s.phase / v.rate;
    const end = is549 ? frameTimestamp(v, s.last) : frameTimestamp(v, s.last) + s.phase / v.rate;
    const clip = is549
      ? { first: clipper549Frame(v, start), last: clipper549Frame(v, end) }
      : { first: clipper548StartFrame(v, start), last: clipper548EndFrame(v, end) };
    const refreshMs = 1000 / 60;
    // From the middle of the clip's first frame, so only the loop's decisions vary.
    let time = frameTimestamp(v, clip.first) + 0.5 / v.rate;
    let state: LoopState = INITIAL_LOOP_STATE;
    let seekLeft = 0;
    let pendingTarget = 0;
    let sawEnd = false;
    const result = { past: 0, before: 0, missingEnd: 0 };
    const refreshes = Math.ceil((clip.last - clip.first + 1) * (60 / v.rate) * 4) + 20;
    for (let n = 0; n < refreshes; n++) {
      const now = (n + 0.37) * refreshMs;
      state = timing.noteRefresh(state, now);
      if (seekLeft > 0) {
        seekLeft--;
        if (seekLeft === 0) time = pendingTarget;
      } else if (n > 0) {
        time += refreshMs / 1000;
      }
      const shown = shownAt(v, time);
      if (shown > clip.last) result.past++;
      if (shown < clip.first) result.before++;
      if (shown === clip.last) sawEnd = true;
      if (seekLeft > 0) continue;
      const reading: FrameReading = {
        currentTime: time + s.delta,
        pendingSeek: null,
        seeking: false,
        onScreen: { mediaTime: frameTimestamp(v, shown), isRead: false, isCurrent: true },
        grid: gridOf(fps),
        isRateMeasured: false,
        ownSeek: null,
      };
      const heldFrame =
        s.held === 'none'
          ? null
          : {
              time: frameTimestamp(v, shown),
              duration: s.held === 'duration' ? 1 / v.rate : null,
            };
      const turn = timing.loopTurnBack(reading, {
        start,
        end,
        isPlaying: true,
        held: heldFrame,
        refresh: state.refresh,
        playbackRate: 1,
        lastOtherFrameAt: state.lastOtherFrameAt,
      });
      state = { ...state, lastOtherFrameAt: turn.lastOtherFrameAt };
      if (turn.seekTo != null) {
        if (!sawEnd) result.missingEnd++;
        sawEnd = false;
        pendingTarget = turn.seekTo;
        seekLeft = s.seekRefreshes;
      }
    }
    return result;
  },
  score(outcome) {
    const { past, before, missingEnd } = outcome as {
      past: number;
      before: number;
      missingEnd: number;
    };
    return past + before + missingEnd;
  },
};

const ENTRIES = [
  placementEntry,
  seekEntry,
  stepsEntry,
  compareEntry,
  loopEntry,
] as Entry<unknown>[];

/**
 * Classes of scenarios where a release is worse than 5.48, each pinned as a strict failing case.
 * Keyed by release, group, then class.
 */
// What makes 5.49 worse than 5.48, per class of scenarios (results.md of the 5.49 review names
// R1 to R4). The counts are scenarios worse of the class's scenarios.
const EDGE_START =
  "a playhead on or just after a frame's start, its start unread: the stand-in, the playhead less 1 ms, names the frame before";
const R1 =
  "R1: on millisecond timestamps a frame shows from its rounded start, before the clipper's grid start, so the stand-in names the frame before";
const SEEK48 =
  "a 5.48 playhead in its frame's last 1 ms: the seek 1 ms past it shows the next frame";
const R2 =
  'R2: above 60 fps off YouTube a step from a known frame start moves 1.5 frames of the 60 fps grid, skipping video frames';
const FF_STEP = 'Firefox at the assumed 60 fps: a step from the stand-in can skip a frame (50 fps)';
const R4 = 'R4: above 60 fps off YouTube adjacent frames share a frame of the 60 fps grid';
const MS_COMPARE =
  "a 5.48 playhead just after a frame's millisecond-rounded start falls in the frame before on the grid";
const R3 = 'R3: the playhead ahead of the picture turns the loop back before its end frame shows';
const LOOP_FAST =
  "above 60 fps off YouTube the 60 fps grid's last frame ends past the clip's last video frame";
const KNOWN_WORSE_549: Partial<Record<FrameDecisionGroup, Record<string, string>>> = {
  placement: {
    'other, chromeNoRead, exact timestamps, edge playheads, start markers': EDGE_START, // 11 of 336
    'other, firefox, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 336
    'other, noRvfc, exact timestamps, edge playheads, start markers': EDGE_START, // 11 of 336
    'other, firefox, ms timestamps, uniform playheads, end markers': R1, // 2 of 672
    'other, noRvfc, ms timestamps, uniform playheads, end markers': R1, // 2 of 672
    'other, chromeNoRead, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 336
    'other, firefox, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 336
    'other, firefox, ms timestamps, edge playheads, end markers': R1, // 81 of 336
    'other, noRvfc, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 336
    'other, noRvfc, ms timestamps, edge playheads, end markers': R1, // 85 of 336
    'youtube, chromeNoRead, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 132
    'youtube, firefox, exact timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, noRvfc, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 132
    'youtube, chromeNoRead, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, firefox, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, firefox, ms timestamps, edge playheads, end markers': R1, // 24 of 132
    'youtube, noRvfc, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, noRvfc, ms timestamps, edge playheads, end markers': R1, // 24 of 132
  },
  seek: {
    'other, exact timestamps, 5.48 playhead': SEEK48, // 36 of 896
    'other, ms timestamps, 5.48 playhead': SEEK48, // 35 of 896
    'youtube, exact timestamps, 5.48 playhead': SEEK48, // 8 of 352
    'youtube, ms timestamps, 5.48 playhead': SEEK48, // 8 of 352
  },
  steps: {
    "other, firefox, slow, rate in use above the video's": FF_STEP, // 2 of 240
    "other, firefox, fast, rate in use above the video's": FF_STEP, // 2 of 240
    "other, chrome, slow, rate in use below the video's": R2, // 36 of 72
    "other, chrome, fast, rate in use below the video's": R2, // 36 of 72
    "other, chromeNoRead, slow, rate in use below the video's": R2, // 36 of 72
    "other, chromeNoRead, fast, rate in use below the video's": R2, // 36 of 72
    "other, firefox, slow, rate in use below the video's": R2, // 16 of 72
    "other, firefox, fast, rate in use below the video's": R2, // 16 of 72
  },
  compare: {
    "youtube, ms timestamps, 5.48 playhead, rate in use at the video's": MS_COMPARE, // 1 of 192
    "youtube, ms timestamps, 5.48 playhead, rate in use above the video's": MS_COMPARE, // 2 of 72
    "other, ms timestamps, 5.48 playhead, rate in use at the video's": MS_COMPARE, // 1 of 24
    "other, exact timestamps, 5.48 playhead, rate in use below the video's": R4, // 26 of 72
    "other, exact timestamps, frame start, rate in use below the video's": R4, // 3 of 9
    "other, exact timestamps, playhead less 1 ms, rate in use below the video's": R4, // 24 of 72
    "other, ms timestamps, 5.48 playhead, rate in use below the video's": R4, // 26 of 72
    "other, ms timestamps, frame start, rate in use below the video's": R4, // 3 of 9
    "other, ms timestamps, playhead less 1 ms, rate in use below the video's": R4, // 24 of 72
  },
  loop: {
    "other, exact timestamps, playhead 4 ms ahead, rate in use above the video's": R3, // 6 of 240
    "other, exact timestamps, playhead 12 ms ahead, rate in use above the video's": R3, // 44 of 240
    "other, ms timestamps, playhead 4 ms ahead, rate in use above the video's": R3, // 6 of 240
    "other, ms timestamps, playhead 12 ms ahead, rate in use above the video's": R3, // 44 of 240
    "youtube, exact timestamps, playhead 4 ms ahead, rate in use at the video's": R3, // 6 of 192
    "youtube, exact timestamps, playhead 12 ms ahead, rate in use at the video's": R3, // 36 of 192
    "youtube, ms timestamps, playhead 4 ms ahead, rate in use at the video's": R3, // 6 of 192
    "youtube, ms timestamps, playhead 12 ms ahead, rate in use at the video's": R3, // 36 of 192
    "youtube, exact timestamps, playhead 12 ms ahead, rate in use above the video's": R3, // 8 of 72
    "youtube, ms timestamps, playhead 12 ms ahead, rate in use above the video's": R3, // 8 of 72
    "other, exact timestamps, playhead 0 ms ahead, rate in use below the video's": LOOP_FAST, // 10 of 72
    "other, exact timestamps, playhead 4 ms ahead, rate in use below the video's": R3, // 4 of 72
    "other, exact timestamps, playhead 12 ms ahead, rate in use below the video's": R3, // 4 of 72
    "other, ms timestamps, playhead 0 ms ahead, rate in use below the video's": LOOP_FAST, // 2 of 72
    "other, ms timestamps, playhead 12 ms ahead, rate in use below the video's": R3, // 8 of 72
  },
};

const KNOWN_WORSE: Partial<
  Record<FrameTimingRelease, Partial<Record<FrameDecisionGroup, Record<string, string>>>>
> = { '5.49': KNOWN_WORSE_549 };

const groupNames = Object.keys(frameDecisionGroups) as FrameDecisionGroup[];
const allOn = (release: FrameTimingRelease) =>
  Object.fromEntries(groupNames.map((name) => [name, release])) as FrameTimingReleases;
const timing548 = composeFrameTiming(allOn('5.48'));

/** Whether `release`'s decisions in `group` are 5.48's own functions. */
function isSameAs548(group: FrameDecisionGroup, release: FrameTimingRelease): boolean {
  const decisions = Object.entries(frameDecisionGroups[group].release(release));
  const legacy = frameDecisionGroups[group].release('5.48') as Record<string, unknown>;
  return decisions.every(([name, decision]) => decision === legacy[name]);
}

describe.each(ENTRIES.map((entry) => [entry.group, entry] as const))('%s', (group, entry) => {
  it.each(['5.49', 'next'] as const)(
    'on 5.48 decides as 5.48 exactly, with every other group on %s',
    (others) => {
      const timing = composeFrameTiming({ ...allOn(others), [group]: '5.48' });
      const differing = entry.scenarios.filter(
        (s) =>
          JSON.stringify(entry.act(timing, s, '5.48')) !==
          JSON.stringify(entry.act(timing548, s, '5.48'))
      );
      expect(differing.length).toBe(0);
    }
  );

  describe.each(['5.49', 'next'] as const)('on %s', (release) => {
    const timing = composeFrameTiming({ ...allOn('5.48'), [group]: release });
    if (isSameAs548(group, release)) {
      it("is 5.48's decisions, function by function", () => {
        const decisions = Object.entries(frameDecisionGroups[group].release(release));
        for (const [name, decision] of decisions) {
          expect(timing548[name as keyof FrameTiming]).toBe(decision);
        }
      });
      return;
    }
    const classes = new Map<string, unknown[]>();
    for (const s of entry.scenarios) {
      const name = entry.classOf(s);
      classes.set(name, [...(classes.get(name) ?? []), s]);
    }
    const knownWorse = KNOWN_WORSE[release]?.[group] ?? {};
    for (const [name, scenarios] of classes) {
      const finding = knownWorse[name];
      (finding ? it.failing : it)(
        `is no worse than 5.48: ${name}${finding ? ` (${finding})` : ''}`,
        () => {
          const worse = scenarios.filter(
            (s) =>
              entry.score(entry.act(timing, s, release), s, release) >
              entry.score(entry.act(timing548, s, '5.48'), s, '5.48')
          );
          // The first such scenario and both outcomes, to read the failure by.
          const first = worse[0];
          const example = first && {
            scenario: first,
            [release]: entry.act(timing, first, release),
            '5.48': entry.act(timing548, first, '5.48'),
          };
          expect({ worse: worse.length, of: scenarios.length, example }).toEqual({
            worse: 0,
            of: scenarios.length,
            example: undefined,
          });
        }
      );
    }
  });
});

// Groups don't reach into each other: under any mix of releases, each group's actions are those of
// its own release.
describe.each([
  ['every group on 5.49', allOn('5.49')],
  ...groupNames.map(
    (name) => [`only ${name} on 5.49`, { ...allOn('5.48'), [name]: '5.49' }] as const
  ),
] as const)('%s', (_mix, releases) => {
  const timing = composeFrameTiming(releases);
  it.each(ENTRIES.map((entry) => [entry.group, entry] as const))(
    "the %s actions are its release's",
    (group, entry) => {
      const release = releases[group];
      const own = composeFrameTiming(allOn(release));
      const differing = entry.scenarios.filter(
        (s) =>
          JSON.stringify(entry.act(timing, s, release)) !==
          JSON.stringify(entry.act(own, s, release))
      );
      expect(differing.length).toBe(0);
    }
  );
});
