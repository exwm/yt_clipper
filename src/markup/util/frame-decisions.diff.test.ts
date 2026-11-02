/**
 * Frame decisions against 5.48's, over simulated playback (__sim__/): each action scores how far its
 * outcome is from the right frame, and a build is never further than 5.48's in any scenario. Each
 * build is scored as it ships, with its own clipper rule. Checked here: 5.49's whole build, and the
 * default build ('next' for every group) once its decisions differ from 5.48's. Where a build is
 * further, the class of scenarios is pinned below as a strict failing case with its finding, never
 * loosened. Each action calls one decision; how the shell couples them (videoUtil.ts, the seek
 * coalescer) is not covered.
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
import { FRAME_DECISION_GROUPS, FrameDecisionGroup, FrameTimingRelease } from './decisions/keys';
import type { OwnSeek } from './frame-step';
import { composeFrameTiming, FrameReading, FrameTiming } from './frame-timing';
import { frameTimingNext } from './frame-timing-next';
import { timing548 } from './frame-timing-releases';

// Read once: jest runs modules in a vm context, where each global Math lookup is slow.
const Math = globalThis.Math;

/** The clipper's rule for which frames a marker pair's times mean: 5.48's (`-ss` keeps frames from
 *  the first at or after the start, the trim those before the end), 5.49's (frame_grid: the frame
 *  shown at each marker, the end's included), or the next release's, which is 5.48's today. Each
 *  build is scored with its own rule: the markup and the clipper ship together. */
type ClipperRule = FrameTimingRelease;
const startFrameBy = (rule: ClipperRule, v: Video, t: number) =>
  rule === '5.49' ? clipper549Frame(v, t) : clipper548StartFrame(v, t);
const endFrameBy = (rule: ClipperRule, v: Video, t: number) =>
  rule === '5.49' ? clipper549Frame(v, t) : clipper548EndFrame(v, t);

/** A group's action over its scenarios. `score` is 0 for a right outcome and grows with its
 *  distance from right, in frames where the action is about one frame. */
interface Entry<S> {
  group: FrameDecisionGroup;
  scenarios: S[];
  classOf(s: S): string;
  act(timing: FrameTiming, s: S): unknown;
  score(outcome: unknown, s: S): number;
  // The decisions `act` calls: a fix in next is checked here only if it is one of them.
  calls: readonly (keyof FrameTiming)[];
  // The scenario with the clipper rule of the build scored, for actions whose clip it decides.
  withRule?(s: S, rule: ClipperRule): S;
  // Classes scored for the record only, where 5.48 is always wrong, so no build can be worse.
  isReportOnly?(s: S): boolean;
}

const ruled = <S>(entry: Entry<S>, s: S, rule: ClipperRule) =>
  entry.withRule ? entry.withRule(s, rule) : s;

/** How far `timing`'s outcome is from right in scenario `s`, scored with clipper rule `rule`. */
function distance<S>(entry: Entry<S>, timing: FrameTiming, s: S, rule: ClipperRule): number {
  const scenario = ruled(entry, s, rule);
  return entry.score(entry.act(timing, scenario), scenario);
}

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

// A marker or point placed while paused on the frame a seek left on screen; scored by how many
// frames the clipper's rule puts it from that frame.
interface PlacementScenario {
  site: Site;
  fps: number;
  v: Video;
  b: Browser;
  p: number;
  // Uniform playheads, or ones within 1 ms of a frame's edge.
  at: 'uniform' | 'edge';
  kind: 'start' | 'end';
  rule: ClipperRule;
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
            rule: '5.48' as ClipperRule,
          }))
        )
      );
    })
  ),
  classOf: (s) =>
    `${s.site}, ${s.b}, ${timestampsOf(s.v)} timestamps, ${s.at} playheads, ${s.kind} markers`,
  calls: ['frameTime'],
  withRule: (s, rule) => ({ ...s, rule }),
  act: (timing, s) => timing.frameTime(pausedReading(s.b, s.v, s.p, s.fps)),
  score(outcome, s) {
    const t = outcome as number;
    const frame = s.kind === 'start' ? startFrameBy(s.rule, s.v, t) : endFrameBy(s.rule, s.v, t);
    return Math.abs(frame - shownAt(s.v, s.p));
  },
};

// A crop or speed point added at the playhead (Alt+A) while paused on the frame a seek left on screen;
// scored by how many frames the frame its saved time shows (on a seek back to it, and in the preview)
// is from the one it was added on.
const pointEntry: Entry<PlacementScenario> = {
  group: 'placement',
  scenarios: placementEntry.scenarios.filter((s) => s.kind === 'start'),
  classOf: (s) => `${s.site}, ${s.b}, ${timestampsOf(s.v)} timestamps, ${s.at} playheads, points`,
  calls: ['frameTime', 'pointTime'],
  act: (timing, s) => timing.pointTime(timing.frameTime(pausedReading(s.b, s.v, s.p, s.fps))),
  score: (outcome, s) => Math.abs(shownAt(s.v, outcome as number) - shownAt(s.v, s.p)),
};

// A seek to a placed time, as a marker number click or a jump does; scored by how many frames the
// frame it shows is from the one the time was placed on. Placed times: a 5.48 playhead anywhere in
// the frame, 5.49's frame start (saved to 6 decimals), and 5.49's stand-in, the playhead less 1 ms.
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
      const scenario = (stored: Stored, t: number) => ({ site, fps, v, stored, t, frame: k });
      return [
        ...playheads.map((p) => scenario('5.48 playhead', p)),
        scenario('frame start', Number(start.toFixed(6))),
        ...playheads
          .filter((p) => p - 0.001 >= 0)
          .map((p) => scenario('playhead less 1 ms', p - 0.001)),
      ];
    })
  ),
  classOf: (s) => `${s.site}, ${timestampsOf(s.v)} timestamps, ${s.stored}`,
  calls: ['placeSeek'],
  act(timing, s) {
    const seek = timing.placeSeek(gridOf(s.fps), s.t);
    return 'to' in seek ? seek.to : s.t + seek.by;
  },
  score: (outcome, s) => Math.abs(shownAt(s.v, outcome as number) - s.frame),
};

// Shift+wheel presses while paused. 'each lands': each seek lands and shows its frame before the
// next press. 'while seeking': the next press comes while the seek runs, sent at once, not held
// back as seekToSafe would hold it (the coalescer is not modelled).
interface StepScenario {
  site: Site;
  fps: number;
  v: Video;
  b: Browser;
  p0: number;
  mode: 'each lands' | 'while seeking';
  dir: 1 | -1;
}
const PRESSES = 8;
const stepsEntry: Entry<StepScenario> = {
  group: 'steps',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    phasesIn(6).flatMap((f) =>
      BROWSERS.flatMap((b) =>
        (['each lands', 'while seeking'] as const).flatMap((mode) =>
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
  calls: ['stepSeek'],
  act(timing, s) {
    const { v, b, fps, dir } = s;
    let p = playheadAs(b, s.p0);
    let shown = shownAt(v, p);
    let ownSeek: OwnSeek | null = null;
    const moves: number[] = [];
    for (let i = 0; i < PRESSES; i++) {
      const reading = pausedReading(b, v, p, fps);
      if (s.mode === 'while seeking' && i > 0) {
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
  score: (outcome, s) => stepsDistance(outcome as number[], s.fps, s.v.rate),
};

/**
 * How far presses' moves (frames each, in the step's direction) are from right, when each press
 * steps one frame at `fps`: the frames moved in all outside floor to ceil of presses x min(1,
 * rate / fps), plus frames moved backward, plus presses in a run with no move beyond the
 * ceil(fps / rate) - 1 a rate in use above the video's needs. A skip counts once, in the total.
 */
function stepsDistance(moves: number[], fps: number, rate: number): number {
  const expected = moves.length * Math.min(1, rate / fps);
  const total = moves.reduce((sum, moved) => sum + moved, 0);
  const outside = Math.max(
    0,
    Math.floor(expected + 1e-9) - total,
    total - Math.ceil(expected - 1e-9)
  );
  const backward = moves.reduce((sum, moved) => sum + Math.max(0, -moved), 0);
  const allowedRun = Math.ceil(fps / rate - 1e-9) - 1;
  let stuck = 0;
  let run = 0;
  for (const moved of [...moves, 1]) {
    if (moved === 0) {
      run++;
    } else {
      stuck += Math.max(0, run - allowedRun);
      run = 0;
    }
  }
  return outside + backward + stuck;
}

// Two placed times on adjacent frames, as a marker pair's ends or two points are, which must compare
// in order; or in the same frame, which compare equal only by frame (report only: 5.48's raw times
// never do, and no build claims it until a fix does).
interface CompareScenario {
  site: Site;
  fps: number;
  v: Video;
  stored: Stored;
  pair: 'adjacent' | 'same';
  a: number;
  b: number;
}
const compareEntry: Entry<CompareScenario> = {
  group: 'compare',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    [30, 31, 1799].flatMap((k) => {
      const at = (n: number, f: number) =>
        frameTimestamp(v, n) + f * (frameTimestamp(v, n + 1) - frameTimestamp(v, n));
      const scenario = (stored: Stored, pair: 'adjacent' | 'same', a: number, b: number) => ({
        site,
        fps,
        v,
        stored,
        pair,
        a,
        b,
      });
      return [
        ...phasesIn(8).map((f) => scenario('5.48 playhead', 'adjacent', at(k, f), at(k + 1, f))),
        scenario('frame start', 'adjacent', frameTimestamp(v, k), frameTimestamp(v, k + 1)),
        ...phasesIn(8).map((f) =>
          scenario('playhead less 1 ms', 'adjacent', at(k, f) - 0.001, at(k + 1, f) - 0.001)
        ),
        scenario('5.48 playhead', 'same', at(k, 0.25), at(k, 0.75)),
        scenario('frame start', 'same', frameTimestamp(v, k), at(k, 0.5)),
      ];
    })
  ),
  classOf: (s) =>
    `${s.site}, ${timestampsOf(s.v)} timestamps, ${s.stored}, ${s.pair} frames, rate in use ${rateRelation(s.fps, s.v.rate)} the video's`,
  calls: ['compareFrames'],
  act: (timing, s) => Math.sign(timing.compareFrames(gridOf(s.fps), s.a, s.b)),
  score: (outcome, s) => (outcome === (s.pair === 'same' ? 0 : -1) ? 0 : 1),
  isReportOnly: (s) => s.pair === 'same',
};

// The marker pair loop playing on a 60 Hz display, the playhead `delta` ahead of the picture, each
// seek back taking 1 or 3 refreshes. The markers are where the build's own placement stores them
// (5.49's frame starts; 5.48 and next keep raw playheads), or an old 5.48 file's mid-frame raw
// playheads opened in the build. The clip is the frames the build's own clipper rule takes. Counts
// refreshes showing a frame past the clip or before it, and cycles that miss its last frame.
interface LoopScenario {
  site: Site;
  fps: number;
  v: Video;
  first: number;
  last: number;
  markers: 'own placement' | 'old 5.48 file';
  phase: number;
  delta: number;
  held: 'duration' | 'no duration' | 'none';
  seekRefreshes: number;
  rule: ClipperRule;
}
const loopEntry: Entry<LoopScenario> = {
  group: 'loop',
  scenarios: videosOf([0]).flatMap(({ site, fps, v }) =>
    [1, 5].flatMap((pairFrames) =>
      (['own placement', 'old 5.48 file'] as const).flatMap((markers) =>
        phasesIn(2).flatMap((phase) =>
          [0, 0.004, 0.012].flatMap((delta) =>
            (['duration', 'no duration', 'none'] as const).flatMap((held) =>
              [1, 3].map((seekRefreshes) => ({
                site,
                fps,
                v,
                first: 40 + Math.round(v.rate),
                last: 40 + Math.round(v.rate) + pairFrames,
                markers,
                phase,
                delta,
                held,
                seekRefreshes,
                rule: '5.48' as ClipperRule,
              }))
            )
          )
        )
      )
    )
  ),
  classOf: (s) =>
    `${s.site}, ${timestampsOf(s.v)} timestamps, ${s.markers}, playhead ${s.delta * 1000} ms ahead, rate in use ${rateRelation(s.fps, s.v.rate)} the video's`,
  calls: ['loopTurnBack', 'noteRefresh'],
  withRule: (s, rule) => ({ ...s, rule }),
  act(timing, s) {
    const { v, fps } = s;
    const isFrameStart = s.markers === 'own placement' && s.rule === '5.49';
    const placed = (frame: number) =>
      frameTimestamp(v, frame) + (isFrameStart ? 0 : s.phase / v.rate);
    const start = placed(s.first);
    const end = placed(s.last);
    const clip = { first: startFrameBy(s.rule, v, start), last: endFrameBy(s.rule, v, end) };
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
  pointEntry,
  seekEntry,
  stepsEntry,
  compareEntry,
  loopEntry,
] as Entry<unknown>[];

/** Decisions a fix in next may change though no entry calls them, each with the todo that adds
 *  their scenarios. Empty: a fix to any other decision fails the coverage test below. */
const UNCOVERED_BY_HARNESS: Partial<Record<keyof FrameTiming, string>> = {};

// What makes 5.49's whole build further from right than 5.48's, per class of scenarios
// (results.md of the 5.49 review names R1 to R4). The counts are scenarios worse of the class's.
const EDGE_START =
  "a playhead on or just after a frame's start, its start unread: the stand-in, the playhead less 1 ms, names the frame before";
const R1 =
  "R1: on millisecond timestamps a frame shows from its rounded start, before the clipper's grid start, so the stand-in names the frame before";
const SEEK48 =
  "a 5.48 playhead in its frame's last 1 ms: the seek 1 ms past it shows the next frame";
const R2 =
  'R2: above 60 fps off YouTube a step from a known frame start moves 1.5 frames of the 60 fps grid, skipping video frames';
// Simulation only, untraced: not yet confirmed in a real browser nor its mechanism traced.
const STEP_ABOVE =
  'at the assumed 60 fps above the video rate, steps from a known frame start stall and skip beyond presses x rate / 60 (simulation only, mechanism not yet traced)';
const R4 = 'R4: above 60 fps off YouTube adjacent frames share a frame of the 60 fps grid';
const MS_COMPARE =
  "a 5.48 playhead just after a frame's millisecond-rounded start falls in the frame before on the grid";
const R3 = 'R3: the playhead ahead of the picture turns the loop back before its end frame shows';
const LOOP_FAST =
  "above 60 fps off YouTube the 60 fps grid's last frame ends past the clip's last video frame";
// Simulation only: traced in the decisions, not yet seen in a real browser.
const SEEK_STORM =
  "an old 5.48 file's mid-frame start marker at the assumed 60 fps: the frame on screen starts before the marker's grid frame, so the playing loop seeks back every refresh and never reaches its end (simulation only)";
const POINT_STAND_IN =
  "a point added within 1 ms of its frame's start, its start unread: the stand-in, the playhead less 1 ms, names the frame before (most often above 60 fps, where 1 ms is a large part of a frame)";
const pointPins = Object.fromEntries(
  (['other', 'youtube'] as const)
    .flatMap((site) =>
      (['exact', 'ms'] as const).flatMap((timestamps) => [
        ...(['firefox', 'noRvfc'] as const).map(
          (b) => `${site}, ${b}, ${timestamps} timestamps, uniform playheads, points`
        ),
        ...(['chromeNoRead', 'firefox', 'noRvfc'] as const).map(
          (b) => `${site}, ${b}, ${timestamps} timestamps, edge playheads, points`
        ),
      ])
    )
    .map((name) => [name, POINT_STAND_IN])
);
const KNOWN_WORSE_549: Partial<Record<FrameDecisionGroup, Record<string, string>>> = {
  placement: {
    ...pointPins,
    'other, chromeNoRead, exact timestamps, edge playheads, start markers': EDGE_START, // 11 of 336
    'other, firefox, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 336
    'other, noRvfc, exact timestamps, edge playheads, start markers': EDGE_START, // 11 of 336
    'other, firefox, ms timestamps, uniform playheads, end markers': R1, // 2 of 672
    'other, noRvfc, ms timestamps, uniform playheads, end markers': R1, // 2 of 672
    'other, chromeNoRead, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 336
    'other, firefox, ms timestamps, edge playheads, start markers': R1, // 2 of 336
    'other, firefox, ms timestamps, edge playheads, end markers': R1, // 81 of 336
    'other, noRvfc, ms timestamps, edge playheads, start markers': R1, // 2 of 336
    'other, noRvfc, ms timestamps, edge playheads, end markers': R1, // 85 of 336
    'youtube, chromeNoRead, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 132
    'youtube, firefox, exact timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, noRvfc, exact timestamps, edge playheads, start markers': EDGE_START, // 3 of 132
    'youtube, chromeNoRead, ms timestamps, edge playheads, start markers': EDGE_START, // 2 of 132
    'youtube, firefox, ms timestamps, edge playheads, start markers': R1, // 2 of 132
    'youtube, firefox, ms timestamps, edge playheads, end markers': R1, // 24 of 132
    'youtube, noRvfc, ms timestamps, edge playheads, start markers': R1, // 2 of 132
    'youtube, noRvfc, ms timestamps, edge playheads, end markers': R1, // 24 of 132
  },
  seek: {
    'other, exact timestamps, 5.48 playhead': SEEK48, // 36 of 896
    'other, ms timestamps, 5.48 playhead': SEEK48, // 35 of 896
    'youtube, exact timestamps, 5.48 playhead': SEEK48, // 8 of 352
    'youtube, ms timestamps, 5.48 playhead': SEEK48, // 8 of 352
  },
  steps: {
    "other, chrome, each lands, rate in use above the video's": STEP_ABOVE, // 54 of 240
    "other, chrome, while seeking, rate in use above the video's": STEP_ABOVE, // 54 of 240
    "other, chromeNoRead, each lands, rate in use above the video's": STEP_ABOVE, // 60 of 240
    "other, chromeNoRead, while seeking, rate in use above the video's": STEP_ABOVE, // 54 of 240
    "other, chrome, each lands, rate in use below the video's": R2, // 36 of 72
    "other, chrome, while seeking, rate in use below the video's": R2, // 36 of 72
    "other, chromeNoRead, each lands, rate in use below the video's": R2, // 36 of 72
    "other, chromeNoRead, while seeking, rate in use below the video's": R2, // 36 of 72
    "other, firefox, each lands, rate in use below the video's": R2, // 16 of 72
    "other, firefox, while seeking, rate in use below the video's": R2, // 16 of 72
  },
  compare: {
    "youtube, ms timestamps, 5.48 playhead, adjacent frames, rate in use at the video's":
      MS_COMPARE, // 1 of 192
    "youtube, ms timestamps, 5.48 playhead, adjacent frames, rate in use above the video's":
      MS_COMPARE, // 2 of 72
    "other, ms timestamps, 5.48 playhead, adjacent frames, rate in use at the video's": MS_COMPARE, // 1 of 24
    "other, exact timestamps, 5.48 playhead, adjacent frames, rate in use below the video's": R4, // 26 of 72
    "other, exact timestamps, frame start, adjacent frames, rate in use below the video's": R4, // 3 of 9
    "other, exact timestamps, playhead less 1 ms, adjacent frames, rate in use below the video's":
      R4, // 24 of 72
    "other, ms timestamps, 5.48 playhead, adjacent frames, rate in use below the video's": R4, // 26 of 72
    "other, ms timestamps, frame start, adjacent frames, rate in use below the video's": R4, // 3 of 9
    "other, ms timestamps, playhead less 1 ms, adjacent frames, rate in use below the video's": R4, // 24 of 72
  },
  loop: {
    "other, exact timestamps, own placement, playhead 4 ms ahead, rate in use above the video's":
      R3, // 15 of 240
    "other, exact timestamps, own placement, playhead 12 ms ahead, rate in use above the video's":
      R3, // 57 of 240
    "other, exact timestamps, old 5.48 file, playhead 0 ms ahead, rate in use above the video's":
      SEEK_STORM, // 102 of 240
    "other, exact timestamps, old 5.48 file, playhead 4 ms ahead, rate in use above the video's":
      SEEK_STORM, // 102 of 240
    "other, exact timestamps, old 5.48 file, playhead 12 ms ahead, rate in use above the video's":
      SEEK_STORM, // 102 of 240
    "other, ms timestamps, own placement, playhead 4 ms ahead, rate in use above the video's": R3, // 12 of 240
    "other, ms timestamps, own placement, playhead 12 ms ahead, rate in use above the video's": R3, // 60 of 240
    "other, ms timestamps, old 5.48 file, playhead 0 ms ahead, rate in use above the video's":
      SEEK_STORM, // 105 of 240
    "other, ms timestamps, old 5.48 file, playhead 4 ms ahead, rate in use above the video's":
      SEEK_STORM, // 105 of 240
    "other, ms timestamps, old 5.48 file, playhead 12 ms ahead, rate in use above the video's":
      SEEK_STORM, // 105 of 240
    "youtube, exact timestamps, own placement, playhead 4 ms ahead, rate in use at the video's": R3, // 15 of 192
    "youtube, exact timestamps, own placement, playhead 12 ms ahead, rate in use at the video's":
      R3, // 45 of 192
    "youtube, ms timestamps, own placement, playhead 4 ms ahead, rate in use at the video's": R3, // 12 of 192
    "youtube, ms timestamps, own placement, playhead 12 ms ahead, rate in use at the video's": R3, // 48 of 192
    "youtube, exact timestamps, own placement, playhead 12 ms ahead, rate in use above the video's":
      R3, // 12 of 72
    "youtube, ms timestamps, own placement, playhead 12 ms ahead, rate in use above the video's":
      R3, // 12 of 72
    "other, exact timestamps, own placement, playhead 0 ms ahead, rate in use below the video's":
      LOOP_FAST, // 12 of 72
    "other, exact timestamps, own placement, playhead 4 ms ahead, rate in use below the video's":
      LOOP_FAST, // 6 of 72
    "other, exact timestamps, own placement, playhead 12 ms ahead, rate in use below the video's":
      LOOP_FAST, // 6 of 72
    "other, exact timestamps, old 5.48 file, playhead 0 ms ahead, rate in use below the video's":
      LOOP_FAST, // 12 of 72
    "other, exact timestamps, old 5.48 file, playhead 4 ms ahead, rate in use below the video's":
      LOOP_FAST, // 12 of 72
    "other, exact timestamps, old 5.48 file, playhead 12 ms ahead, rate in use below the video's":
      LOOP_FAST, // 12 of 72
    "other, ms timestamps, own placement, playhead 0 ms ahead, rate in use below the video's":
      LOOP_FAST, // 3 of 72
    "other, ms timestamps, own placement, playhead 12 ms ahead, rate in use below the video's":
      LOOP_FAST, // 6 of 72
    "other, ms timestamps, old 5.48 file, playhead 0 ms ahead, rate in use below the video's":
      LOOP_FAST, // 9 of 72
    "other, ms timestamps, old 5.48 file, playhead 4 ms ahead, rate in use below the video's":
      LOOP_FAST, // 12 of 72
    "other, ms timestamps, old 5.48 file, playhead 12 ms ahead, rate in use below the video's":
      LOOP_FAST, // 18 of 72
  },
};

const allGroups = (release: 'next' | '5.48') =>
  Object.fromEntries(FRAME_DECISION_GROUPS.map((name) => [name, release])) as Record<
    FrameDecisionGroup,
    'next' | '5.48'
  >;
const BUILDS = [
  ['5.49', composeFrameTiming({ whole: '5.49' }), '5.49', KNOWN_WORSE_549],
  ['the default build', composeFrameTiming({ groups: allGroups('next') }), 'next', {}],
] as const;

/** Whether `timing` makes 5.48's decisions, function by function: comparing it then is a tautology. */
const isTiming548 = (timing: FrameTiming) =>
  Object.entries(timing548).every(
    ([name, decision]) => timing[name as keyof FrameTiming] === decision
  );

const classesOf = <S>(entry: Entry<S>) => {
  const classes = new Map<string, S[]>();
  for (const s of entry.scenarios) {
    const name = entry.classOf(s);
    classes.set(name, [...(classes.get(name) ?? []), s]);
  }
  return classes;
};

/** The scenarios where `timing`, with its clipper rule, is further from right than 5.48. */
const worseThan548 = <S>(entry: Entry<S>, timing: FrameTiming, rule: ClipperRule, scenarios: S[]) =>
  scenarios.filter((s) => distance(entry, timing, s, rule) > distance(entry, timing548, s, '5.48'));

describe.each(BUILDS)('%s', (build, timing, rule, knownWorse) => {
  // The default build makes 5.48's decisions until a fix lands in next; it is checked from then on.
  if (isTiming548(timing)) return;
  describe.each(ENTRIES.map((entry) => [entry.group, entry] as const))('%s', (group, entry) => {
    for (const [name, scenarios] of classesOf(entry)) {
      if (entry.isReportOnly?.(scenarios[0])) continue;
      const finding = (knownWorse as Partial<Record<FrameDecisionGroup, Record<string, string>>>)[
        group
      ]?.[name];
      (finding ? it.failing : it)(
        `is no further from right than 5.48: ${name}${finding ? ` (${finding})` : ''}`,
        () => {
          const worse = worseThan548(entry, timing, rule, scenarios);
          // The first such scenario and both outcomes, to read the failure by.
          const first = worse[0];
          const example = first && {
            scenario: ruled(entry, first, rule),
            [build]: entry.act(timing, ruled(entry, first, rule)),
            '5.48': entry.act(timing548, ruled(entry, first, '5.48')),
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

describe("next's fixes", () => {
  it('are each called by a harness entry, or listed as uncovered with a todo', () => {
    const called = new Set(ENTRIES.flatMap((entry) => entry.calls));
    const fixed = Object.keys(timing548).filter(
      (name) => frameTimingNext[name as keyof FrameTiming] !== timing548[name as keyof FrameTiming]
    );
    const unchecked = fixed.filter(
      (name) => !called.has(name as keyof FrameTiming) && !(name in UNCOVERED_BY_HARNESS)
    );
    expect(unchecked).toEqual([]);
  });
});

describe('same-frame comparisons, for the record', () => {
  it("are always wrong under 5.48's raw times, so no build is checked against them yet", () => {
    const same = compareEntry.scenarios.filter((s) => s.pair === 'same');
    const wrong548 = same.filter((s) => compareEntry.score(compareEntry.act(timing548, s), s) > 0);
    expect(wrong548.length).toBe(same.length);
  });
});

// The scorers must catch outcomes known to be wrong: each mutant of 5.48, as a build with 5.48's
// clipper rule, is further from right than 5.48 in some scenario of the classes it breaks. The
// same-frame class is report only: 5.48's raw compare is always wrong there, so a mutant can only
// be caught scoring wrong.
describe('the scorers', () => {
  type Mutant = [string, Entry<any>, (s: any) => boolean, Partial<FrameTiming>, 'worse' | 'wrong'];
  const halfStep: Partial<FrameTiming> = {
    stepSeek: (r, { frames }) => ({ by: (0.5 * frames) / r.grid.rate }),
  };
  const doubleStep: Partial<FrameTiming> = {
    stepSeek: (r, { frames }) => ({ by: (2 * frames) / r.grid.rate }),
  };
  const MUTANTS: Mutant[] = [
    [
      'steps by 0, rate in use above',
      stepsEntry,
      (s) => s.fps > s.v.rate,
      { stepSeek: () => ({ by: 0 }) },
      'worse',
    ],
    [
      'steps by half a frame, rate in use above',
      stepsEntry,
      (s) => s.fps > s.v.rate,
      halfStep,
      'worse',
    ],
    // Half a 60 fps frame is nearer one frame of a video above 60 fps than 5.48's whole one, so
    // below the video's rate the mutant that must be caught steps two frames.
    [
      'steps by two frames, rate in use below',
      stepsEntry,
      (s) => s.fps < s.v.rate,
      doubleStep,
      'worse',
    ],
    [
      'placement at 0',
      placementEntry,
      (s) => s.at === 'uniform' && s.kind === 'start',
      { frameTime: () => 0 },
      'worse',
    ],
    [
      'placement 3 frames early',
      placementEntry,
      (s) => s.at === 'uniform' && s.kind === 'start',
      { frameTime: (r) => r.currentTime - 3 / r.grid.rate },
      'worse',
    ],
    [
      'point a frame late',
      pointEntry,
      (s) => s.at === 'uniform',
      { pointTime: (time) => time + 1 / 30 },
      'worse',
    ],
    [
      'compare always 0, adjacent frames',
      compareEntry,
      (s) => s.pair === 'adjacent',
      { compareFrames: () => 0 },
      'worse',
    ],
    [
      'compare raw, same frame',
      compareEntry,
      (s) => s.pair === 'same',
      { compareFrames: (_g, a, b) => a - b },
      'wrong',
    ],
    [
      'loop seeks to the end',
      loopEntry,
      () => true,
      {
        loopTurnBack: (r, l) => {
          const turn = timing548.loopTurnBack(r, l);
          return { ...turn, seekTo: turn.seekTo == null ? null : l.end };
        },
      },
      'worse',
    ],
  ];
  it.each(MUTANTS)('catch %s', (_name, entry, isTarget, mutation, bar) => {
    const mutant = { ...timing548, ...mutation } as FrameTiming;
    const targets = entry.scenarios.filter(isTarget);
    expect(targets.length).toBeGreaterThan(0);
    const caught =
      bar === 'worse'
        ? worseThan548(entry, mutant, '5.48', targets)
        : targets.filter((s) => distance(entry, mutant, s, '5.48') > 0);
    expect(caught.length).toBeGreaterThan(0);
  });

  it.each(ENTRIES.map((entry) => [entry.group, entry] as const))(
    'find 5.48 no worse than itself: %s',
    (_group, entry) => {
      expect(worseThan548(entry, timing548, '5.48', entry.scenarios).length).toBe(0);
    }
  );

  // Hand-computed, at 30 fps unless noted: frame n starts at n / 30 s.
  const v30: Video = { rate: 30, origin: 0, msTimestamps: false, duration: 7200 };
  const t549 = composeFrameTiming({ whole: '5.49' });
  const at30 = { site: 'youtube', fps: 30, v: v30 };
  it.each([
    // 5.48's clipper drops a mid-frame start marker's frame, 5.49's keeps it.
    [
      'placement, mid-frame start read by 5.48',
      placementEntry,
      { ...at30, b: 'chrome', p: 30.5 / 30, at: 'uniform', kind: 'start', rule: '5.48' },
      timing548,
      1,
    ],
    [
      'placement, mid-frame start read by 5.49',
      placementEntry,
      { ...at30, b: 'chrome', p: 30.5 / 30, at: 'uniform', kind: 'start', rule: '5.49' },
      timing548,
      0,
    ],
    [
      'seek, 5.48 to a mid-frame time',
      seekEntry,
      { ...at30, stored: '5.48 playhead', t: 30.5 / 30, frame: 30 },
      timing548,
      0,
    ],
    // 5.49 seeks 1 ms past a time in its frame's last 1 ms, into frame 31.
    [
      'seek, 5.49 to a time 0.5 ms before the next frame',
      seekEntry,
      { ...at30, stored: '5.48 playhead', t: 31 / 30 - 0.0005, frame: 30 },
      t549,
      1,
    ],
    [
      'steps, 5.48 at the video rate',
      stepsEntry,
      {
        ...at30,
        v: { ...v30, duration: 1e6 },
        b: 'chrome',
        p0: 30.5 / 30,
        mode: 'each lands',
        dir: 1,
      },
      timing548,
      0,
    ],
    // 8 presses that never move: 8 frames short of 8, and a run of 8 with none allowed.
    [
      'steps, never moving at the video rate',
      stepsEntry,
      {
        ...at30,
        v: { ...v30, duration: 1e6 },
        b: 'chrome',
        p0: 30.5 / 30,
        mode: 'each lands',
        dir: 1,
      },
      { ...timing548, stepSeek: () => ({ by: 0 }) },
      16,
    ],
    [
      'compare, adjacent frame starts',
      compareEntry,
      { ...at30, stored: 'frame start', pair: 'adjacent', a: 30 / 30, b: 31 / 30 },
      timing548,
      0,
    ],
    [
      'compare, 5.48 on one frame',
      compareEntry,
      { ...at30, stored: '5.48 playhead', pair: 'same', a: 30.25 / 30, b: 30.75 / 30 },
      timing548,
      1,
    ],
    // 24 fps, a 2-frame clip of 5.49 frame-start markers from frame 64, never turning back: the
    // frame shown is 64 + floor(0.5 + 0.4 n) at refresh n, past frame 65 from n = 4, of 40.
    [
      'loop, never turning back',
      loopEntry,
      {
        site: 'youtube',
        fps: 24,
        v: { rate: 24, origin: 0, msTimestamps: false, duration: 7200 },
        first: 64,
        last: 65,
        markers: 'own placement',
        phase: 0.5,
        delta: 0,
        held: 'none',
        seekRefreshes: 1,
        rule: '5.49',
      },
      {
        ...timing548,
        loopTurnBack: (_r, l) => ({ seekTo: null, lastOtherFrameAt: l.lastOtherFrameAt }),
      },
      36,
    ],
  ] as [string, Entry<any>, unknown, FrameTiming, number][])(
    '%s',
    (_name, entry, scenario, timing, expected) => {
      expect(entry.score(entry.act(timing, scenario), scenario)).toBe(expected);
    }
  );
});
