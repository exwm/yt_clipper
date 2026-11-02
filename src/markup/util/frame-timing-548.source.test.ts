/**
 * The legacy shell against the v5.48.0 source itself, not a copy of it: each side's functions are
 * read from its own source (the tag, and this checkout), run on the same stubbed leaves (appState,
 * seeks, timers, the frame rate), and must make the same seeks and marker moves.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import ts from 'typescript';
import { roundX, roundY, sortX } from '../ui/chart/chartPrimitives';
import { frameAt, sameFrame } from './frame-grid';
import { INITIAL_LOOP_STATE } from './decisions/loop';
import { frameTiming548 } from './frame-timing-548';
import { clampNumber, roundValue } from './util';

const TAG = 'v5.48.0';
// A shallow clone (CI's checkout) has no tags: this check runs locally, as in release-prep.
const tagCommit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${TAG}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
})();
const hasTag = tagCommit !== null;
// Kept on disk by the tag's commit, so a moved tag reads afresh: each `git show` costs about 0.1 s.
const TAG_CACHE = join(__dirname, '../../../node_modules/.cache/frame-timing-548-source');
const tagSource = (path: string) =>
  cached(`tag:${path}`, () => {
    const file = join(TAG_CACHE, tagCommit!, path);
    if (existsSync(file)) return readFileSync(file, 'utf8');
    const text = execFileSync('git', ['show', `${TAG}:${path}`], { encoding: 'utf8' });
    mkdirSync(dirname(file), { recursive: true });
    // Written whole, then renamed, so a stopped run never leaves a partial file to read later.
    const partial = `${file}.${process.pid}.partial`;
    writeFileSync(partial, text);
    renameSync(partial, file);
    return text;
  });
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

// Keyed by the source string itself, then by short keys: a key built by joining the whole source
// was hashed again on every lookup, a second of the file's run.
const built = new Map<string, Map<string, (...args: unknown[]) => any>>();
function compile(source: string, names: string[], keys: string[]) {
  const bySource = built.get(source) ?? built.set(source, new Map()).get(source)!;
  const key = `${names.join()}\n${keys.join()}`;
  if (!bySource.has(key)) {
    const file = ts.createSourceFile('m.ts', source, ts.ScriptTarget.ES2020, true);
    const picked = file.statements.filter((s) => declaredNames(s).some((n) => names.includes(n)));
    const found = picked.flatMap(declaredNames);
    const missing = names.filter((n) => !found.includes(n));
    if (missing.length) throw new Error(`not declared: ${missing.join(', ')}`);
    const text = picked.map((s) => s.getText().replace(/^export\s+/, '')).join('\n');
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } });
    const exports = found.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`);
    bySource.set(
      key,
      new Function(...keys, `${js.outputText}\nreturn { ${exports.join(', ')} };`) as any
    );
  }
  return bySource.get(key)!;
}

/** The named top-level declarations of `source`, evaluated with `scope` standing in for imports.
 *  Each call runs the declarations afresh, so no state carries over between tests. */
function load(source: string, names: string[], scope: Record<string, unknown> = {}): any {
  const keys = Object.keys(scope);
  return compile(source, names, keys)(...keys.map((k) => scope[k]));
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
    INITIAL_LOOP_STATE,
    // The chart and crop paths.
    roundX,
    roundY,
    sortX,
    frameAt,
    sameFrame,
    roundValue,
    bsearch: v548Util.bsearch,
    assertDefined: () => {},
    flashMessage: (message: string) => log.push(['flash', message]),
    createDraft: (state: unknown) => JSON.parse(JSON.stringify(state)),
    getMarkerPairHistory: (pair: any) => ({ speedMap: pair.speedMap, cropMap: pair.cropMap }),
    saveMarkerPairHistory: (draft: any, pair: any) => {
      Object.assign(pair, draft);
      log.push(['save', draft.speedMap.map((p: any) => p.x), draft.cropMap.map((p: any) => p.x)]);
    },
    resolveCropEditConflict: () => true,
    cropManipulationKind: null,
    cropDragStartPoint: null,
    cropDragStartCropString: null,
    refreshCropDragInitState: () => {},
    suppressNextAltLock: () => {},
    cropChartMode: { Start: 0, End: 1 },
    currentCropChartMode: 0,
    currentCropChartSection: [0, 1],
    setCurrentCropPoint: (_chart: unknown, index: number) => log.push(['select', index]),
    activeCropPoints: (chart: any) => chart?.data.datasets[0].data ?? null,
    isStaticCrop: () => false,
    renderSpeedAndCropUI: () => {},
  };
  const expireTimers = () => {
    const due = [...timers.values()];
    timers.clear();
    due.forEach((fn) => fn());
  };
  return { scope, log, video, expireTimers };
}

type Leaves = ReturnType<typeof leaves>;

/** The current shell's frame reads and seeks, on the leaves. */
const currentVideoUtil = (l: Leaves) =>
  load(
    ownSource('src/markup/util/videoUtil.ts'),
    [
      'getFrameGrid',
      'ownSeek',
      'readFrame',
      'applySeek',
      'seekToFrameAt',
      'seekByFrames',
      'getFrameTime',
      'getScreenFrame',
      'frameStartOf',
      'cropSectionTime',
      'redrawTime',
      'loopPlaybackOver',
      'loopState',
      'noteRefresh',
    ],
    l.scope
  );

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
    const videoUtil = currentVideoUtil(l);
    return {
      ...load(
        ownSource('src/markup/markers.ts'),
        [
          'dblJump',
          'prevJumpKeyCode',
          'prevTime',
          'jumpToNearestMarker',
          'moveMarkerByFrameHandler',
          'getActiveLoop',
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
  act: (shell: any, l: Leaves) => void,
  shells: Record<keyof typeof sides, (l: Leaves) => any> = sides
) {
  const logs = Object.fromEntries(
    Object.entries(shells).map(([name, make]) => {
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

const SCATTER = 'src/markup/ui/chart/scatterChartSpec.ts';
const CHARTUTIL = 'src/markup/ui/chart/chartutil.ts';
const CHARTS = 'src/markup/charts.ts';
const REFRAME = 'src/markup/crop/video-reframe-canvas.ts';
const SPEED = 'src/markup/speed.ts';

const v548KeyframeMath = () =>
  load(
    tagSource('src/markup/crop/crop-keyframe-math.ts'),
    ['findCropKeyframeAtTime', 'nextKeyframeIndex', 'getEaseSectionDuration'],
    { ...v548Util, sortX }
  );

/** Each side's declarations of `names` in `path`: the current side reads frames through its own
 *  videoUtil. `extra` adds leaves for this path. */
function shellsOf(
  path: string,
  names: { 'v5.48.0': string[]; current: string[] },
  extra: (l: Leaves) => Record<string, unknown> = () => ({})
): Record<keyof typeof sides, (l: Leaves) => any> {
  return {
    'v5.48.0': (l) => load(tagSource(path), names['v5.48.0'], { ...l.scope, ...extra(l) }),
    current: (l) =>
      load(ownSource(path), names.current, { ...l.scope, ...currentVideoUtil(l), ...extra(l) }),
  };
}

// The add-point hotkey: addChartPoint calls the scatter chart's add function with the playhead.
const addPointShells: Record<keyof typeof sides, (l: Leaves) => any> = {
  'v5.48.0': (l) => {
    const spec = load(
      tagSource(SCATTER),
      ['getScatterChartBounds', 'addSpeedPoint', 'addCropPoint'],
      l.scope
    );
    return load(tagSource(CHARTUTIL), ['addChartPoint'], { ...l.scope, require: () => spec });
  },
  current: (l) => {
    const scope = { ...l.scope, ...currentVideoUtil(l) };
    const spec = load(
      ownSource(SCATTER),
      ['getScatterChartBounds', 'addSpeedPoint', 'addCropPoint'],
      scope
    );
    return load(ownSource(CHARTUTIL), ['addChartPoint'], { ...scope, require: () => spec });
  },
};

const autoKeyNames = ['autoKeyCurrentCropPoint', 'isPlayheadOnCropKeyframe', 'selectCropPoint'];
const autoKeyShells = shellsOf(CHARTS, { 'v5.48.0': autoKeyNames, current: autoKeyNames }, () => ({
  findCropKeyframeAtTime: v548KeyframeMath().findCropKeyframeAtTime,
  getCurrentCropComponents: () => [10.4, 20.4, 300.2, 200.2],
  Crop: class {
    cropString = '';
    setCropStringSafe(crop: string) {
      this.cropString = crop;
    }
  },
  getCropString: (...components: number[]) => components.join(':'),
}));

// 5.48 had no pinned frame time: its section followed the playhead inside the preview loop too.
const sectionShells: Record<keyof typeof sides, (l: Leaves) => any> = {
  'v5.48.0': (l) => ({
    ...shellsOf(CHARTS, { 'v5.48.0': ['setCurrentCropPointWithCurrentTime'], current: [] })[
      'v5.48.0'
    ](l),
    withPresentedFrameTime: (_time: number, fn: () => void) => fn(),
  }),
  current: shellsOf(CHARTS, {
    'v5.48.0': [],
    current: [
      'setCurrentCropPointWithCurrentTime',
      'currentCropTime',
      'presentedFrameTime',
      'withPresentedFrameTime',
    ],
  }).current,
};

const reframeLoopNames = ['startLoop', 'stopLoop', 'redrawReframeCanvas'];
const reframeShells = shellsOf(
  REFRAME,
  { 'v5.48.0': reframeLoopNames, current: [...reframeLoopNames, 'redraw', 'isRedrawing'] },
  (l) => ({
    canvas: {},
    rafId: 0,
    frameSource: null,
    frames: null,
    drawReframeFrame: (time: number) => l.log.push(['draw', time]),
    // A redraw hands the consumer the last frame presented, here a little before the playhead.
    onVideoFrames: (video: any, consumer: (frame: unknown) => void) => ({
      redraw: () => consumer({ mediaTime: video.currentTime - 0.011, image: video, now: 0 }),
      stop: () => {},
    }),
    featureFlags: { reframeFrameStats: false },
    performance: { now: () => 0 },
  })
);

const speedNames = [
  'updateSpeed',
  'getShortestActiveMarkerPair',
  'getSpeedMapping',
  'getInterpolatedSpeed',
  'prevSpeed',
  'defaultRoundSpeedMapEasing',
  'defaultSpeedRoundPrecision',
  'updateSpeedInputLabel',
];
const speedShells = shellsOf(SPEED, { 'v5.48.0': speedNames, current: speedNames }, () => ({
  isSpeedPreviewOn: true,
  isVariableSpeed: () => true,
  easeCubicInOut: (x: number) => x,
}));

const cropMapAt = (times: number[]) => times.map((x, i) => ({ x, y: 0, crop: `0:0:${10 + i}:10` }));
const chartOf = (data: unknown[]) => ({
  options: { scales: { xAxes: [{ ticks: { min: 0, max: 100 } }] } },
  renderSpeedAndCropUI: () => {},
  data: { datasets: [{ data }] },
});

(hasTag ? describe : describe.skip).each(RATES.map((rate) => [Number(rate.toFixed(3)), rate]))(
  `chart and crop timing at %p fps${hasTag ? '' : ` (needs the ${TAG} tag)`}`,
  (_fps, rate) => {
    it.each([['speed'], ['crop']])(
      'a %s point added at the playhead stores the same time, and reframe seeks there',
      (type) => {
        for (const t of sweep(rate).filter((t) => t > 0.5)) {
          const logs = both(
            rate,
            t,
            (l) => {
              const pair = {
                start: 0,
                end: 100,
                speed: 1,
                speedMap: [
                  { x: 0, y: 1 },
                  { x: 100, y: 1 },
                ],
                cropMap: cropMapAt([0, 100]),
              };
              Object.assign(l.scope.appState, {
                isChartEnabled: true,
                isCurrentChartVisible: true,
                markerPairs: [pair],
                prevSelectedMarkerPairIndex: 0,
                currentCropPointIndex: 0,
              });
              l.scope.chartState = { currentChartInput: { type, chart: chartOf([]) } };
              l.scope.isReframeEnabled = () => true;
            },
            (shell) => shell.addChartPoint(),
            addPointShells
          );
          expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
        }
      }
    );

    it.each([[true], [false]])(
      'a reframe crop edit, paused %p, keys or selects the same point',
      (paused) => {
        const times = [0, 30.4 / rate, 45 / rate, 60.5 / rate, 100];
        for (const t of sweep(rate).filter((t) => t > 0)) {
          const logs = both(
            rate,
            t,
            (l) => {
              Object.assign(l.scope.appState, {
                isSettingsEditorOpen: true,
                wasGlobalSettingsEditorOpen: false,
                isCurrentChartVisible: true,
                markerPairs: [{ start: 0, end: 100, speedMap: [], cropMap: cropMapAt(times) }],
                prevSelectedMarkerPairIndex: 0,
                currentCropPointIndex: -1,
                settings: { cropResWidth: 1920, cropResHeight: 1080 },
              });
              l.video.paused = paused;
              l.scope.chartState = {
                currentChartInput: { type: 'crop' },
                cropChartInput: { chart: null },
              };
              // Pausing can move the playhead on from the frame shown.
              l.scope.pauseSafe = (video: any) => {
                if (video.paused) return;
                video.paused = true;
                video.currentTime += 0.3 / rate;
              };
            },
            (shell, l) => {
              shell.autoKeyCurrentCropPoint();
              l.log.push(['point', l.scope.appState.currentCropPointIndex]);
            },
            autoKeyShells
          );
          expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
        }
      }
    );

    it.each([[0], [1]])(
      'the crop section in chart mode %p follows the same time while the preview plays',
      (mode) => {
        const cropMap = cropMapAt([0, 30.4 / rate, 45 / rate, 60.5 / rate, 90.6 / rate, 100]);
        for (const t of sweep(rate)) {
          const logs = both(
            rate,
            t,
            (l) => {
              Object.assign(l.scope, {
                currentCropChartMode: mode,
                currentCropChartSection: [1, 2],
              });
              l.scope.chartState = { cropChartInput: { chart: chartOf(cropMap) } };
              l.video.paused = false;
            },
            (shell, l) =>
              shell.withPresentedFrameTime(l.video.currentTime - 0.4 / rate, () =>
                shell.setCurrentCropPointWithCurrentTime()
              ),
            sectionShells
          );
          expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
        }
      }
    );

    it('the reframe canvas draws its first frame and paused redraws at the same time', () => {
      for (const t of sweep(rate)) {
        const logs = both(
          rate,
          t,
          (l) =>
            Object.assign(l.video, {
              requestVideoFrameCallback: () => 1,
              cancelVideoFrameCallback: () => {},
            }),
          (shell) => {
            shell.startLoop();
            shell.redrawReframeCanvas();
          },
          reframeShells
        );
        expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
      }
    });

    it('the speed preview plays at the same speed, at the pair edges too', () => {
      const start = 30.4 / rate + 7e-7;
      const end = 90.6 / rate;
      // Inside the pair as 5.48 tests it (start floored, end ceiled to the microsecond) but
      // outside its speed points.
      const edges = [
        (Math.floor(start * 1e6) / 1e6 + start) / 2,
        (end + Math.ceil(end * 1e6) / 1e6) / 2,
      ];
      for (const t of [...sweep(rate), ...edges]) {
        const logs = both(
          rate,
          t,
          (l) =>
            Object.assign(l.scope.appState, {
              isForceSetSpeedOn: false,
              isSettingsEditorOpen: false,
              easingMode: 'linear',
              prevSelectedMarkerPairIndex: null,
              markerPairs: [
                {
                  start,
                  end,
                  speed: 1,
                  speedMap: [
                    { x: start, y: 0.5 },
                    { x: (start + end) / 2, y: 1 },
                    { x: end, y: 0.75 },
                  ],
                },
              ],
            }),
          (shell, l) => {
            shell.updateSpeed();
            l.log.push(['rate', l.video.playbackRate]);
          },
          speedShells
        );
        expect({ t, log: logs.current }).toEqual({ t, log: logs['v5.48.0'] });
      }
    });
  }
);

(hasTag ? it : it.skip)(
  'above 100 fps a reframe crop edit selects the point already at its 0.01 s time',
  () => {
    const rate = 240;
    // 4.4 ms from the point: more than a frame, so not on it, but the same 0.01 s.
    const t = 1.2256;
    const logs = both(
      rate,
      t,
      (l) => {
        Object.assign(l.scope.appState, {
          isSettingsEditorOpen: true,
          wasGlobalSettingsEditorOpen: false,
          isCurrentChartVisible: true,
          markerPairs: [{ start: 0, end: 100, speedMap: [], cropMap: cropMapAt([0, 1.23, 100]) }],
          prevSelectedMarkerPairIndex: 0,
          currentCropPointIndex: -1,
          settings: { cropResWidth: 1920, cropResHeight: 1080 },
        });
        l.scope.chartState = {
          currentChartInput: { type: 'crop' },
          cropChartInput: { chart: null },
        };
      },
      (shell, l) => {
        shell.autoKeyCurrentCropPoint();
        l.log.push(['point', l.scope.appState.currentCropPointIndex]);
      },
      autoKeyShells
    );
    expect(logs['v5.48.0']).toEqual([['point', 1]]);
    expect(logs.current).toEqual(logs['v5.48.0']);
  }
);

/** A video whose seeks and events the coalescer and the frame rate cache listen to. */
function withEvents(l: Leaves) {
  const listeners = new Map<string, Set<() => void>>();
  const dispatch = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());
  Object.assign(l.video, {
    addEventListener: (type: string, fn: () => void) =>
      listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)),
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    seekTo: (to: number) => {
      l.log.push(['seek', to]);
      Object.assign(l.video, { seeking: true, currentTime: to });
      dispatch('seeking');
    },
  });
  l.scope.window = { setTimeout: l.scope.setTimeout };
  return dispatch;
}

const coalescerNames = [
  'pendingSeekTime',
  'pendingSeekVideo',
  'stalePendingTimerId',
  'expectingOurSeekingEvent',
  'STALE_PENDING_TIMEOUT_MS',
  'applyDecision',
  'armStalePendingTimer',
  'fireSeekNow',
  'onSeeked',
  'onSeeking',
  'ensureSeekListeners',
  'seekToSafe',
];
const coalescerShells: Record<keyof typeof sides, (l: Leaves) => any> = {
  'v5.48.0': (l) =>
    load(tagSource('src/markup/util/util.ts'), coalescerNames, {
      ...l.scope,
      clampNumber,
      ...load(tagSource('src/markup/util/seek-coalescer.ts'), [
        'NONE',
        'onSeekRequest',
        'onSeekSettled',
        'onExternalSeek',
        'onStaleTimer',
      ]),
    }),
  current: (l) =>
    load(ownSource('src/markup/util/util.ts'), [...coalescerNames, 'onEmptied'], {
      ...l.scope,
      clampNumber,
      ...load(ownSource('src/markup/util/seek-coalescer.ts'), [
        'NONE',
        'onSeekRequest',
        'onSeekSettled',
        'onExternalSeek',
      ]),
    }),
};

(hasTag ? it.each : it.skip.each)([
  [
    'a seek slower than the timer drops the step held back',
    ['seek 1', 'seek 3', 'expire', 'seeked'],
  ],
  [
    'a new source keeps it until the timer flushes it',
    ['seek 1', 'seek 3', 'emptied', 'settle quietly', 'expire'],
  ],
  ['a missed seeked is recovered by the timer', ['seek 1', 'seek 3', 'settle quietly', 'expire']],
])('the seek coalescer: %s, as in 5.48', (_case, steps) => {
  const dispatchers = new Map<Leaves, (type: string) => void>();
  const logs = both(
    30,
    0,
    (l) => dispatchers.set(l, withEvents(l)),
    (shell, l) => {
      const dispatch = dispatchers.get(l)!;
      for (const step of steps) {
        if (step.startsWith('seek ')) shell.seekToSafe(l.video, Number(step.slice(5)));
        else if (step === 'expire') l.expireTimers();
        else if (step === 'settle quietly') l.video.seeking = false;
        else {
          if (step === 'seeked') l.video.seeking = false;
          dispatch(step);
        }
      }
    },
    coalescerShells
  );
  expect(logs.current).toEqual(logs['v5.48.0']);
});

const frameRateShells: Record<keyof typeof sides, (l: Leaves) => any> = {
  'v5.48.0': (l) =>
    load(tagSource('src/markup/util/videoUtil.ts'), ['prevVideoWidth', 'getFPS'], l.scope),
  current: (l) => {
    const scope = {
      ...l.scope,
      // Decoys: 5.48 had no measured rate, so a saved Measure setting must not reach the rate.
      localStorage: { getItem: () => 'true' },
      getMeasuredFrameRate: () => 29.97,
      onVideoFrames: () => ({ redraw: () => {}, stop: () => {} }),
      updateFrameRate: () => {},
    };
    const rateSource = load(
      ownSource('src/markup/util/frame-rate-source.ts'),
      [
        'rateInUse',
        'MEASURE_FRAME_RATE_KEY',
        'measureFrameRate',
        'isFrameRateMeasured',
        'isMeasureFrameRateOn',
        'prevVideoWidth',
        'youTubeStatsFps',
        'isNewSourceLoaded',
        'noteNewSource',
        'noteSourceLoaded',
        'readFrameRates',
      ],
      scope
    );
    return load(
      ownSource('src/markup/util/videoUtil.ts'),
      ['getFrameRate', 'getFPS', 'followFrameRate', 'frameRateFrames', 'ownSeek'],
      { ...scope, ...rateSource }
    );
  },
};

(hasTag ? it : it.skip)(
  'the YouTube frame rate is cached until the width changes, over a new source too, as in 5.48',
  () => {
    const logs = both(
      30,
      0,
      (l) => {
        Object.assign(l.scope, {
          getPlatform: () => 'youtube',
          VideoPlatforms: { youtube: 'youtube' },
        });
        l.scope.appState.videoInfo = {};
        l.scope.appState.player = { getStatsForNerds: () => ({ resolution: '1920x1080@60' }) };
        l.video.videoWidth = 1920;
      },
      (shell, l) => {
        const dispatch = withEvents(l);
        shell.followFrameRate?.(l.video);
        const stats = (resolution: string) =>
          (l.scope.appState.player.getStatsForNerds = () => ({ resolution }));
        l.log.push(['fps', shell.getFPS()]);
        // Another video on the same element, at the same width.
        stats('1920x1080@30');
        dispatch('emptied');
        l.log.push(['fps', shell.getFPS()]);
        dispatch('loadedmetadata');
        l.log.push(['fps', shell.getFPS()]);
        l.video.videoWidth = 1280;
        l.log.push(['fps', shell.getFPS()]);
      },
      frameRateShells
    );
    expect(logs['v5.48.0']).toEqual([
      ['fps', 60],
      ['fps', 60],
      ['fps', 60],
      ['fps', 30],
    ]);
    expect(logs.current).toEqual(logs['v5.48.0']);
  }
);
