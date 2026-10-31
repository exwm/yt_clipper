/**
 * The legacy shell against the v5.48.0 source itself, not a copy of it: each side's functions are
 * read from its own source (the tag, and this checkout), run on the same stubbed leaves (appState,
 * seeks, timers, the frame rate), and must make the same seeks and marker moves.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { frameTiming548 } from './frame-timing-548';

const TAG = 'v5.48.0';
// A shallow clone (CI's checkout) has no tags: this check runs locally, as in release-prep.
const hasTag = (() => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${TAG}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();
const tagSource = (path: string) =>
  cached(`tag:${path}`, () =>
    execFileSync('git', ['show', `${TAG}:${path}`], { encoding: 'utf8' })
  );
const ownSource = (path: string) =>
  cached(path, () => readFileSync(join(__dirname, '../../..', path), 'utf8'));

const declaredNames = (s: ts.Statement): string[] =>
  ts.isFunctionDeclaration(s) && s.name
    ? [s.name.text]
    : ts.isVariableStatement(s)
      ? s.declarationList.declarations.flatMap((d) =>
          ts.isIdentifier(d.name) ? [d.name.text] : []
        )
      : [];

const compiled = new Map<string, { js: string; found: string[] }>();
function compile(source: string, names: string[]) {
  const key = `${names.join()}\n${source}`;
  if (!compiled.has(key)) {
    const file = ts.createSourceFile('m.ts', source, ts.ScriptTarget.ES2020, true);
    const picked = file.statements.filter((s) => declaredNames(s).some((n) => names.includes(n)));
    const found = picked.flatMap(declaredNames);
    const missing = names.filter((n) => !found.includes(n));
    if (missing.length) throw new Error(`not declared: ${missing.join(', ')}`);
    const text = picked.map((s) => s.getText().replace(/^export\s+/, '')).join('\n');
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } });
    compiled.set(key, { js: js.outputText, found });
  }
  return compiled.get(key)!;
}

/** The named top-level declarations of `source`, evaluated with `scope` standing in for imports. */
function load(source: string, names: string[], scope: Record<string, unknown> = {}): any {
  const { js, found } = compile(source, names);
  const exports = found.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`);
  const keys = Object.keys(scope);
  return new Function(...keys, `${js}\nreturn { ${exports.join(', ')} };`)(
    ...keys.map((k) => scope[k])
  );
}

const sources = new Map<string, string>();
const cached = (key: string, read: () => string) =>
  sources.get(key) ?? (sources.set(key, read()), sources.get(key)!);

const v548Util = hasTag
  ? load(tagSource('src/markup/util/util.ts'), [
      'frameDuration',
      'isWithinSameFrame',
      'getOutputDuration',
      'toHHMMSS',
      'toHHMMSSTrimmed',
      'bsearch',
    ])
  : {};

/** The leaves both sides call, recording what they do. */
function leaves(rate: number, playhead: number) {
  const log: unknown[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const video = {
    seeking: false,
    paused: true,
    playbackRate: 1,
    duration: 120,
    currentTime: playhead,
    getCurrentTime: () => video.currentTime,
  };
  const seekTo = (to: number) => {
    log.push(['seek', to]);
    video.currentTime = to;
  };
  const scope = {
    appState: { video, videoInfo: { fps: rate }, markerPairs: [] as any[] } as any,
    blockEvent: () => {},
    pauseSafe: () => {},
    requestAnimationFrame: () => {},
    seekToSafe: (_v: unknown, to: number) => seekTo(to),
    seekBySafe: (_v: unknown, by: number) => seekTo(video.currentTime + by),
    setTimeout: (fn: () => void) => (timers.set(nextTimer, fn), nextTimer++),
    clearTimeout: (id: number) => timers.delete(id),
    getFPS: () => rate,
    getFrameRate: () => ({ rate, source: 'platform' }),
    getVideoDuration: () => video.duration,
    moveMarker: (_marker: unknown, to: number) => log.push(['move', to]),
    platform: 'yt_clipper',
    window: { innerWidth: 1000 },
    markerSeekDebounceTimeout: null,
    setIsMarkerSeekPending: () => {},
    setMarkerSeekDebounceTimeout: () => {},
    isMarkerSeekPending: false,
    getIsMarkerLoopPreviewOn: () => true,
    isReframeEnabled: () => false,
    isMouseManipulatingCrop: false,
    isDrawingCrop: false,
    chartState: undefined as any,
    cropChartSectionLoop: () => log.push(['section loop']),
    isWithinSameFrame: v548Util.isWithinSameFrame,
    // Decoys: 5.48 read none of these, so the shell must not either.
    getFrameOnScreen: () => ({
      mediaTime: video.currentTime - 0.011,
      isRead: true,
      isCurrent: true,
    }),
    getHeldFrame: () => ({ time: video.currentTime - 0.011, duration: 0.004 }),
    getPendingSeekTime: () => video.currentTime + 0.25,
    frameTiming: frameTiming548,
  };
  const expireTimers = () => [...timers.values()].forEach((fn) => fn());
  return { scope, log, video, expireTimers };
}

type Leaves = ReturnType<typeof leaves>;

/** The shell of each side, with its own module state, on fresh leaves. */
const sides = {
  'v5.48.0': (l: Leaves) => ({
    ...load(
      tagSource('src/markup/markers.ts'),
      [
        'dblJump',
        'prevJumpKeyCode',
        'prevTime',
        'jumpToNearestMarker',
        'moveMarkerByFrameHandler',
        'loopMarkerPair',
      ],
      l.scope
    ),
    ...load(
      tagSource('src/markup/yt_clipper.ts'),
      ['mouseWheelFrameSkipRate', 'mouseWheelFrameSkipHandler'],
      l.scope
    ),
  }),
  current: (l: Leaves) => {
    const videoUtil = load(
      ownSource('src/markup/util/videoUtil.ts'),
      [
        'getFrameGrid',
        'ownSeek',
        'readFrame',
        'applySeek',
        'seekToFrameAt',
        'seekByFrames',
        'getFrameTime',
        'loopPlaybackOver',
        'refresh',
        'lastOtherFrameAt',
        'noteRefresh',
      ],
      l.scope
    );
    return {
      ...load(
        ownSource('src/markup/markers.ts'),
        [
          'dblJump',
          'prevJumpKeyCode',
          'prevTime',
          'jumpToNearestMarker',
          'moveMarkerByFrameHandler',
          'loopMarkerPair',
        ],
        { ...l.scope, ...videoUtil }
      ),
      ...load(
        ownSource('src/markup/yt_clipper.ts'),
        ['mouseWheelFrameSkipRate', 'mouseWheelFrameSkipHandler'],
        {
          ...l.scope,
          ...videoUtil,
        }
      ),
    };
  },
};

const RATES = [24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];

function sweep(rate: number): number[] {
  const frames = [0, 1, 29, 30, 31, 89, 90, 91, 1799];
  const offsets = [-0.001, -1e-6, 0, 1e-6, 0.001, 0.25 / rate, 0.5 / rate, 0.99 / rate];
  const times = frames.flatMap((n) => offsets.map((d) => n / rate + d));
  return [...new Set([...times, ...times.map((t) => Math.round(t * 1e3) / 1e3)])].filter(
    (t) => t >= 0
  );
}

// A test that never sees 5.48 seek or move a marker compares nothing.
let oracleRuns = 0;
let oracleEvents = 0;
afterEach(() => {
  if (oracleRuns > 0) expect(oracleEvents).toBeGreaterThan(0);
  oracleRuns = oracleEvents = 0;
});

/** Runs `act` on both sides with the same inputs and returns each side's log. */
function both(
  rate: number,
  playhead: number,
  setup: (l: Leaves) => void,
  act: (shell: any, l: Leaves) => void
) {
  const logs = Object.fromEntries(
    Object.entries(sides).map(([name, make]) => {
      const l = leaves(rate, playhead);
      setup(l);
      act(make(l), l);
      return [name, l.log];
    })
  );
  oracleRuns++;
  oracleEvents += logs['v5.48.0'].length;
  return logs;
}

(hasTag ? describe : describe.skip).each(RATES.map((rate) => [Number(rate.toFixed(3)), rate]))(
  `at %p fps${hasTag ? '' : ` (needs the ${TAG} tag)`}`,
  (_fps, rate) => {
    const pair = (start: number, end: number) => ({ start, end, speed: 1, speedMap: [] });
    const pairs = [
      pair(30.4 / rate + 7e-7, 90.6 / rate),
      pair(60 / rate, 60 / rate + 1e-7),
      pair(91 / rate, 1799 / rate),
    ];
    it.each([
      [['ArrowLeft']],
      [['ArrowRight']],
      [['ArrowLeft', 'ArrowLeft']],
      [['ArrowRight', 'ArrowRight']],
      [['ArrowLeft', 'ArrowRight']],
      [['ArrowLeft', 'expire', 'ArrowLeft']],
    ])('Ctrl+arrows %j jump to the same markers', (keys) => {
      // With a start marker placed and its end not yet, the start's time is a target too.
      for (const [t, isNextMarkerStart] of sweep(rate).flatMap(
        (t) =>
          [
            [t, true],
            [t, false],
          ] as const
      )) {
        const withPairs = (l: Leaves) =>
          Object.assign(l.scope.appState, {
            markerPairs: pairs,
            isNextMarkerStart,
            startTime: 75.2 / rate,
          });
        const logs = both(rate, t, withPairs, (shell, l) => {
          for (const key of keys) {
            if (key === 'expire') l.expireTimers();
            else shell.jumpToNearestMarker({}, l.video.getCurrentTime(), key);
          }
        });
        expect({ t, isNextMarkerStart, log: logs.current }).toEqual({
          t,
          isNextMarkerStart,
          log: logs['v5.48.0'],
        });
      }
    });

    it.each([[-100], [100]])(
      'Shift+wheel %p steps the same, with frame callbacks too',
      (deltaY) => {
        for (const hasFrameCallbacks of [true, false]) {
          for (const t of sweep(rate)) {
            const logs = both(
              rate,
              t,
              (l) => {
                l.scope.appState.isHotkeysEnabled = true;
                if (hasFrameCallbacks)
                  Object.assign(l.video, { requestVideoFrameCallback: () => 0 });
              },
              (shell) => shell.mouseWheelFrameSkipHandler({ shiftKey: true, deltaY })
            );
            expect({ hasFrameCallbacks, t, log: logs.current }).toEqual({
              hasFrameCallbacks,
              t,
              log: logs['v5.48.0'],
            });
          }
        }
      }
    );

    it.each([
      [100, 100],
      [100, 900],
      [-100, 100],
      [-100, 900],
    ])('Alt+Shift+wheel %p at x %p nudges and seeks the same', (deltaY, pageX) => {
      for (const t of [...sweep(rate), 120 - 0.5 / rate]) {
        const logs = both(
          rate,
          3,
          (l) =>
            Object.assign(l.scope.appState, {
              isHotkeysEnabled: true,
              isSettingsEditorOpen: true,
              prevSelectedEndMarker: { previousElementSibling: {} },
              prevSelectedMarkerPairIndex: 0,
              markerPairs: [pair(t, t + 0.5)],
            }),
          (shell) => shell.moveMarkerByFrameHandler({ altKey: true, shiftKey: true, deltaY, pageX })
        );
        expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
      }
    });

    it.each([
      ['the marker pair loop', null],
      ['a speed chart loop', { enabled: true, start: 40 / rate + 3e-4, end: 80 / rate }],
    ])('%s turns back the same, paused or playing', (_loop, chartLoop) => {
      // Half a frame either side of each loop edge: the 5.48 window at the start.
      const edges = [
        pairs[0].start,
        pairs[0].end,
        chartLoop?.start ?? 0,
        chartLoop?.end ?? 0,
      ].flatMap((x) => [-0.5, 0.5].flatMap((f) => [-1e-9, 0, 1e-9].map((d) => x + f / rate + d)));
      for (const paused of [true, false]) {
        for (const t of [...sweep(rate), ...edges]) {
          const logs = both(
            rate,
            t,
            (l) => {
              Object.assign(l.scope.appState, {
                isSettingsEditorOpen: true,
                prevSelectedMarkerPairIndex: 0,
                markerPairs: [{ ...pairs[0], speedChartLoop: chartLoop }],
              });
              l.video.paused = paused;
              l.scope.chartState = {
                currentChartInput: chartLoop
                  ? { chartLoopKey: 'speedChartLoop', type: 'speed' }
                  : null,
                cropChartInput: { chart: null },
              };
            },
            (shell) => shell.loopMarkerPair(1000)
          );
          expect({ paused, t, log: logs.current }).toEqual({ paused, t, log: logs['v5.48.0'] });
        }
      }
    });

    it('finds crop points, eases sections and shows durations as the v5.48.0 functions do', () => {
      const v548 = load(
        tagSource('src/markup/crop/crop-keyframe-math.ts'),
        ['findCropKeyframeAtTime', 'nextKeyframeIndex', 'getEaseSectionDuration'],
        {
          ...v548Util,
          sortX: load(tagSource('src/markup/ui/chart/chartPrimitives.ts'), ['sortX']).sortX,
        }
      );
      const grid = { origin: 0, rate };
      const cropMap = [0, 30.4 / rate, 45 / rate, 60.5 / rate, 90.6 / rate].map((x) => ({
        x,
        y: 0,
        crop: '',
      }));
      for (const t of sweep(rate).filter((t) => t <= 100 / rate)) {
        expect(frameTiming548.findCropKeyframe(grid, cropMap, t)).toEqual(
          v548.findCropKeyframeAtTime(cropMap, t, rate)
        );
        for (const dir of [1, -1] as const) {
          expect(frameTiming548.nextKeyframeIndex(grid, cropMap, t, dir)).toBe(
            v548.nextKeyframeIndex(cropMap, t, rate, dir)
          );
        }
        expect(frameTiming548.easeSectionDuration(30.4 / rate, t, rate)).toBe(
          v548.getEaseSectionDuration(30.4 / rate, t, rate)
        );
        const speedMap = [
          { x: 30.4 / rate, y: 1 },
          { x: (30.4 / rate + t + 1) / 2, y: 0.5 },
          { x: t + 1, y: 1 },
        ];
        expect(
          frameTiming548.pairDuration(grid, { start: 0, end: t + 1, speed: 1, speedMap }, true)
            .outputDuration
        ).toBe(v548Util.getOutputDuration(speedMap, rate));
      }
    });
  }
);
