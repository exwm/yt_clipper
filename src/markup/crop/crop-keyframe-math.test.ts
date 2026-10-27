import { readFileSync } from 'fs';
import { join } from 'path';
import { CropPoint } from '../@types/yt_clipper';
import {
  CropPointEasing,
  CropSectionNeighbor,
  cropInterpolationSectionAtTime,
  findCropKeyframeAtTime,
  getEaseSectionDuration,
  getEasedCropComponentsAtTime,
  getSmoothTrackCropComponentsAtTime,
  nextKeyframeIndex,
} from './crop-keyframe-math';
import { easedCropAtTime } from './parity-sampling';

// Keyframes at t = 0, 1, 2 (crop strings are irrelevant to the time math).
const cropMap: CropPoint[] = [
  { x: 0, y: 0, crop: '0:0:100:100' },
  { x: 1, y: 0, crop: '0:0:100:100' },
  { x: 2, y: 0, crop: '0:0:100:100' },
];

// The grid the playhead's frames are on: frame n starts at n / 30 s.
const AT_30 = { origin: 0, rate: 30 };

describe('findCropKeyframeAtTime', () => {
  describe("on a point's frame", () => {
    it.each([
      ['the first point', 0, 0],
      ['the middle point', 1, 1],
      ['the last point', 2, 2],
      ["later in the middle point's frame", 1 + 0.02, 1],
      ['a hair below the last point, as millisecond times round', 2 - 0.0005, 2],
    ])('%s', (_label, time, index) => {
      const match = findCropKeyframeAtTime(cropMap, time, AT_30);
      expect(match.onKeyframe).toBe(true);
      expect(match.index).toBe(index);
    });

    it('takes a 0.01 s chart point on the frame shown, whatever its time in the frame', () => {
      const chartPoint: CropPoint[] = [cropMap[0], { ...cropMap[1], x: 1.03 }, cropMap[2]];
      const match = findCropKeyframeAtTime(chartPoint, 1, AT_30);
      expect(match.onKeyframe).toBe(true);
      expect(match.index).toBe(1);
    });
  });

  describe('off the points', () => {
    // Points added at the playhead sit on frame starts, so the next frame starts a frame later.
    it.each([
      ['the next frame', 1 + 1 / 30],
      ['the next frame, its start rounded to the millisecond', 1.033],
      ['the frame before', 1 - 1 / 30],
    ])('%s is not on the point', (_label, time) => {
      const match = findCropKeyframeAtTime(cropMap, time, AT_30);
      expect(match.onKeyframe).toBe(false);
      expect(match.index).toBe(1);
    });

    it('mid-section brackets the surrounding points', () => {
      const match = findCropKeyframeAtTime(cropMap, 0.5, AT_30);
      expect(match.onKeyframe).toBe(false);
      expect(match.section).toEqual([0, 1]);
    });

    it('selects the nearer point (index), not the section left point', () => {
      // 1.6 is closer to point 2 than point 1, so a click/seek there selects point 2.
      const match = findCropKeyframeAtTime(cropMap, 1.6, AT_30);
      expect(match.onKeyframe).toBe(false);
      expect(match.index).toBe(2);
      expect(match.section).toEqual([1, 2]);
    });
  });

  describe('edges clamp to valid indices', () => {
    it('time before the first keyframe clamps to index 0', () => {
      const match = findCropKeyframeAtTime(cropMap, -0.5, AT_30);
      expect(match.index).toBe(0);
      expect(match.section).toEqual([0, 0]);
    });

    it('time past the last keyframe clamps to the last index', () => {
      const match = findCropKeyframeAtTime(cropMap, 2.5, AT_30);
      expect(match.index).toBe(2);
      expect(match.section).toEqual([2, 2]);
    });
  });
});

describe('cropInterpolationSectionAtTime', () => {
  it.each([
    ['mid first section', 0.5, [0, 1]],
    ['mid second section', 1.5, [1, 2]],
  ])('brackets the surrounding points (%s)', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });

  // The bug fix: never collapse to [i, i] (which would divide-by-zero when easing), an
  // exact keyframe hit eases across the forward section, so time == keyframe time gives
  // 0% and returns that keyframe's crop without a jump.
  it.each([
    ['first keyframe', 0, [0, 1]],
    ['middle keyframe', 1, [1, 2]],
    ['last keyframe', 2, [1, 2]],
  ])('returns a real interval on an exact %s hit', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });

  it.each([
    ['before the first keyframe', -0.5, [0, 1]],
    ['past the last keyframe', 2.5, [1, 2]],
  ])('clamps to a real edge section %s', (_label, time, expected) => {
    expect(cropInterpolationSectionAtTime(cropMap, time as number)).toEqual(expected);
  });
});

describe('nextKeyframeIndex', () => {
  it.each([
    ['on a keyframe, forward steps to the next', 1, 1, 2],
    ['on a keyframe, back steps to the previous', 1, -1, 0],
    ["later in a keyframe's frame, forward still steps off it", 1 + 0.02, 1, 2],
    ['on the next frame, back goes to the keyframe before it', 1 + 1 / 30, -1, 1],
    ['between keyframes, forward goes to the right bracket', 0.5, 1, 1],
    ['between keyframes, back goes to the left bracket', 0.5, -1, 0],
  ])('%s', (_label, time: number, dir: number, expected: number) => {
    expect(nextKeyframeIndex(cropMap, time, AT_30, dir as 1 | -1)).toBe(expected);
  });

  it('clamps at the ends instead of stepping past', () => {
    expect(nextKeyframeIndex(cropMap, 2, AT_30, 1)).toBe(2); // forward off the last point
    expect(nextKeyframeIndex(cropMap, 0, AT_30, -1)).toBe(0); // back off the first point
  });
});

describe('getEaseSectionDuration', () => {
  // Mirrors the clipper's getEaseSectionDuration (test_ffmpeg_filter.py) so the preview eases
  // over the same duration the rendered output does.
  const FPS_NTSC = 30000 / 1001; // 29.97

  it('returns null for a zero-duration section', () => {
    expect(getEaseSectionDuration(1.0, 1.0, 30)).toBeNull();
  });

  it('falls back to the real duration for a short (sub-adjustment) section', () => {
    // The 23.12 -> 23.15 hold from the clipper gap bug, relative to the marker start.
    expect(getEaseSectionDuration(0.931137, 0.961137, FPS_NTSC)).toBeCloseTo(
      0.961137 - 0.931137,
      9
    );
  });

  it('uses the frame-adjusted (shorter) duration for a normal-length section', () => {
    expect(getEaseSectionDuration(0.0, 0.321137, FPS_NTSC)).toBeCloseTo(8.5 / FPS_NTSC, 9);
  });

  it('keeps a sub-frame section whose end sits on a frame boundary (alignment dependent)', () => {
    expect(getEaseSectionDuration(0.97, 1.0, 30)).toBeCloseTo(29.5 / 30 - 0.97, 9);
  });

  it('falls back when a ~1-frame section ends late within its frame', () => {
    expect(getEaseSectionDuration(0.963667, 0.997, 30)).toBeCloseTo(0.997 - 0.963667, 9);
  });

  it('finishes on the frame of an end point saved a hair below its start', () => {
    // Frame 31's start saved to 6 decimals.
    expect(getEaseSectionDuration(0, Number((31 / 30).toFixed(6)), 30)).toBeCloseTo(30.5 / 30, 9);
  });
});

describe('getEasedCropComponentsAtTime', () => {
  const FPS_30 = 30;
  const start = [0, 0, 100, 100]; // only x changes across the section
  const end = [600, 0, 100, 100];
  // The clipper's easeInOutSine, for parity checks: value = start + delta * sine(percentage).
  const sine = (p: number) => 0.5 * (1 - Math.cos(p * Math.PI));
  const dur = getEaseSectionDuration(0, 2.0, FPS_30) as number;

  it('returns null for a zero-duration section', () => {
    expect(getEasedCropComponentsAtTime(start, end, 5, 5, undefined, 5, FPS_30)).toBeNull();
  });

  it('eases along the cosine curve, not linearly', () => {
    const quarter = getEasedCropComponentsAtTime(start, end, 0, 2.0, undefined, dur * 0.25, FPS_30);
    expect(quarter?.[0]).toBeCloseTo(600 * sine(0.25), 6); // ~87.9, not 150
  });

  it('reaches the halfway crop at the section midpoint', () => {
    const mid = getEasedCropComponentsAtTime(start, end, 0, 2.0, undefined, dur * 0.5, FPS_30);
    expect(mid?.[0]).toBeCloseTo(300, 6);
  });

  it('clamps to the end crop at the real keyframe time (no dip past the adjusted end)', () => {
    // Without the clamp the d3 ease would dip to ~599.9 here; clamped it lands exactly on target.
    const atEnd = getEasedCropComponentsAtTime(start, end, 0, 2.0, undefined, 2.0, FPS_30);
    expect(atEnd?.[0]).toBeCloseTo(600, 6);
  });

  it('instant ease holds the start crop until the keyframe, then jumps', () => {
    expect(getEasedCropComponentsAtTime(start, end, 0, 2.0, 'instant', 1.9, FPS_30)?.[0]).toBe(0);
    expect(getEasedCropComponentsAtTime(start, end, 0, 2.0, 'instant', 2.0, FPS_30)?.[0]).toBe(600);
  });

  it('holds components that do not change across the section', () => {
    const mid = getEasedCropComponentsAtTime(start, end, 0, 2.0, undefined, 1.0, FPS_30);
    expect([mid?.[1], mid?.[2], mid?.[3]]).toEqual([0, 100, 100]);
  });
});

describe('getSmoothTrackCropComponentsAtTime', () => {
  const FPS_30 = 30;
  // Section [t=1, t=2] of a constant-velocity ramp in x: prev 0@0, start 100@1, end 200@2, next 300@3.
  const trackStart = [100, 0, 100, 100];
  const trackEnd = [200, 0, 100, 100];
  const prev: CropSectionNeighbor = { components: [0, 0, 100, 100], time: 0, easeIn: undefined };
  const next: CropSectionNeighbor = { components: [300, 0, 100, 100], time: 3, easeIn: undefined };
  const quarterTime = 1.25;

  const trackAt = (
    time: number,
    p: CropSectionNeighbor | null = prev,
    n: CropSectionNeighbor | null = next
  ) => getSmoothTrackCropComponentsAtTime(trackStart, trackEnd, 1, 2, p, n, time);

  it('returns null for a zero-duration section', () => {
    expect(
      getSmoothTrackCropComponentsAtTime(trackStart, trackEnd, 5, 5, prev, next, 5)
    ).toBeNull();
  });

  it('passes exactly through the start and end crop points', () => {
    expect(trackAt(1)?.[0]).toBeCloseTo(100, 6);
    expect(trackAt(2)?.[0]).toBeCloseTo(200, 6);
  });

  it('carries momentum through a point instead of stalling like smoothInOut', () => {
    // Early in the section the spline is already moving, so it leads the cosine ease-in.
    const track = trackAt(quarterTime)?.[0] as number;
    const inOut = getEasedCropComponentsAtTime(
      trackStart,
      trackEnd,
      1,
      2,
      undefined,
      quarterTime,
      FPS_30
    )?.[0] as number;
    expect(track).toBeGreaterThan(inOut);
  });

  it('tracks at near-constant velocity across evenly spaced collinear points', () => {
    // The spline through a constant-velocity ramp is the straight line: ~125 at the quarter.
    expect(trackAt(quarterTime)?.[0]).toBeCloseTo(125, 0);
  });

  it('eases in (zero tangent) at a map end where there is no neighbor', () => {
    // Without an incoming neighbor the start tangent is 0, so it lags the momentum-carrying curve.
    const withMomentum = trackAt(quarterTime)?.[0] as number;
    const atMapEnd = trackAt(quarterTime, null)?.[0] as number;
    expect(atMapEnd).toBeLessThan(withMomentum);
  });

  it('treats an instant transition into the start point as a momentum break', () => {
    const withMomentum = trackAt(quarterTime)?.[0] as number;
    const instantPrev: CropSectionNeighbor = { ...prev, easeIn: 'instant' };
    const broken = trackAt(quarterTime, instantPrev)?.[0] as number;
    expect(broken).toBeLessThan(withMomentum);
  });

  it('holds components that do not change across the section', () => {
    const mid = trackAt(quarterTime);
    expect([mid?.[1], mid?.[2], mid?.[3]]).toEqual([0, 100, 100]);
  });

  it.each([
    ['shares the point time (a redundant zero-duration point)', 1],
    ['is out of time order, at the end point time', 2],
  ])('stays finite when the previous neighbor %s', (_case, prevTime) => {
    // Mirrors the clipper's getCropSectionTangent: the tangent drops to 0 rather than dividing by
    // zero.
    const oddPrev: CropSectionNeighbor = {
      components: [100, 0, 100, 100],
      time: prevTime,
      easeIn: undefined,
    };
    expect(Number.isFinite(trackAt(quarterTime, oddPrev)?.[0] as number)).toBe(true);
  });

  it('does not overshoot a reversal point', () => {
    // start (100) is a local peak: x rises 0 -> 100, then falls 100 -> 50. The plain central slope
    // (Catmull-Rom) would carry the crop past 100 early in the section.
    const before: CropSectionNeighbor = {
      components: [0, 0, 100, 100],
      time: 0,
      easeIn: undefined,
    };
    const early = getSmoothTrackCropComponentsAtTime(
      [100, 0, 100, 100],
      [50, 0, 100, 100],
      1,
      2,
      before,
      null,
      1.1
    );
    expect(early?.[0]).toBeLessThanOrEqual(100);
  });
});

describe('getSectionEasedCropComponents', () => {
  const easeAt = easedCropAtTime;

  it('keeps a steady pan at the same speed through crop points that fall between frames', () => {
    // 300 px/s from a pair start off the frame grid, through points placed between frames. The
    // clipper's test_ffmpeg_filter.py checks the render the same way.
    const fps = 30000 / 1001;
    const start = 10.52;
    const cropMap = [0, 1.01, 2.03, 3.04, 4.05].map((t) => ({
      x: start + t,
      y: 0,
      crop: `${300 * t}:0:640:360`,
    }));
    // The pair's ends start and stop at rest, so check the frames from the second to the fourth point,
    // through the point at 2.03 s.
    const frames: number[] = [];
    for (let k = Math.ceil((start + 1.01) * fps); k / fps <= start + 3.04; k++)
      frames.push(k / fps);
    const xs = frames.map((t) => easeAt('smoothTrack', cropMap, t, fps)[0]);
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    // 300 px/s is 10.01 px per frame; sections that ended a frame early made 5 px steps at points.
    for (const step of steps) expect(Math.abs(step - 300 / fps)).toBeLessThan(0.05 * (300 / fps));
  });

  it('keeps a Smooth Track zoom inside the frame', () => {
    // x and w are eased on their own, so x + w overshoots 1920 between the last two points.
    const zoom: CropPoint[] = [
      { x: 0, y: 0, crop: '0:0:1000:562' },
      { x: 1, y: 0, crop: '920:0:1000:562' },
      { x: 2, y: 0, crop: '1420:0:500:281' },
    ];
    const frame = { width: 1920, height: 1080 };
    const times = Array.from({ length: 19 }, (_, i) => 1.05 + i * 0.05);
    const rightEdge = (t: number, f?: typeof frame) => {
      const [x, , w] = easeAt('smoothTrack', zoom, t, 30, f);
      return x + w;
    };
    expect(Math.max(...times.map((t) => rightEdge(t)))).toBeGreaterThan(frame.width);
    for (const t of times) {
      const [x] = easeAt('smoothTrack', zoom, t, 30, frame);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(rightEdge(t, frame)).toBeLessThanOrEqual(frame.width + 1e-9);
    }
  });

  // Shared with the clipper's test_ffmpeg_filter.py, which checks the render against these numbers.
  const parityCases = JSON.parse(
    readFileSync(join(__dirname, '../../clipper/tests/fixtures/crop_easing_parity.json'), 'utf8')
  ) as {
    name: string;
    easing: CropPointEasing;
    cropMap: CropPoint[];
    fps: number;
    samples: { t: number; x: number; y: number }[];
  }[];

  it.each(parityCases.map((c) => [c.name, c] as const))(
    'matches the render parity table: %s',
    (_name, c) => {
      for (const sample of c.samples) {
        const [x, y] = easeAt(c.easing, c.cropMap, sample.t, c.fps);
        expect(x).toBeCloseTo(sample.x, 4);
        expect(y).toBeCloseTo(sample.y, 4);
      }
    }
  );

  it('breaks momentum only at an instant transition between a neighbor and the section', () => {
    const point = (x: number, cropX: number, easeIn?: 'instant'): CropPoint => ({
      x,
      y: 0,
      crop: `${cropX}:0:400:300`,
      easeIn,
    });
    const smooth = [point(0, 0), point(1, 100), point(2, 200), point(3, 300)];
    const cutIntoStart = [point(0, 0), point(1, 100, 'instant'), point(2, 200), point(3, 300)];
    const cutIntoPrev = [point(0, 0, 'instant'), point(1, 100), point(2, 200), point(3, 300)];
    const x = (cropMap: CropPoint[]) => easeAt('smoothTrack', cropMap, 1.25)[0];
    // A collinear ramp carries momentum into section [1, 2]; a cut into its start point drops it.
    expect(x(cutIntoStart)).toBeLessThan(x(smooth));
    // A cut into the previous point is not this section's boundary, so momentum is kept.
    expect(x(cutIntoPrev)).toBeCloseTo(x(smooth), 6);
  });
});
