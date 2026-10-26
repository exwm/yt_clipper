// Rewrites the samples of the crop easing and Cinematic parity tables from the markup's preview math.
// Each case keeps its inputs (crop points, easing, margins, fps, sample times); add a case or a time
// by hand, then run `just regen-parity` to fill in the crops it should show. The clipper's tests
// check its render against the same files.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CropPoint } from '../../src/markup/@types/yt_clipper';
import { CropPointEasing } from '../../src/markup/crop/crop-keyframe-math';
import {
  CinematicParityCase,
  cinematicCropAt,
  easedCropAtTime,
} from '../../src/markup/crop/parity-sampling';

const FIXTURES = join(__dirname, '../../src/clipper/tests/fixtures');

type Samples = { samples: Record<string, number>[] };
type Sampler<C> = (c: C) => (t: number) => Record<string, number>;

const decimals = (value: number) => (String(value).split('.')[1] ?? '').length;

// Each case keeps the precision its samples were written with, so a rerun leaves an unchanged case
// byte for byte the same. A new case, with no samples yet, gets `digits`.
function casePrecision(samples: Record<string, number>[], digits: number): number {
  const values = samples.flatMap(({ t: _t, ...crop }) => Object.values(crop));
  return values.length ? Math.max(...values.map(decimals)) : digits;
}

function rewrite<C extends Samples>(file: string, digits: number, sampler: Sampler<C>): void {
  const path = join(FIXTURES, file);
  const cases = JSON.parse(readFileSync(path, 'utf8')) as C[];
  for (const c of cases) {
    const precision = casePrecision(c.samples, digits);
    const at = sampler(c);
    c.samples = c.samples.map(({ t }) => {
      const crop = Object.entries(at(t)).map(([key, v]) => [key, Number(v.toFixed(precision))]);
      return { t, ...Object.fromEntries(crop) };
    });
  }
  writeFileSync(path, JSON.stringify(cases, null, 2) + '\n');
  console.log(`wrote ${cases.length} cases to ${file}`);
}

rewrite<{ easing: CropPointEasing; cropMap: CropPoint[]; fps: number } & Samples>(
  'crop_easing_parity.json',
  6,
  (c) => (t) => {
    const [x, y] = easedCropAtTime(c.easing, c.cropMap, t, c.fps);
    return { x, y };
  }
);

rewrite<CinematicParityCase & Samples>('cinematic_path_parity.json', 4, (c) => {
  const at = cinematicCropAt(c);
  return (t) => {
    const [x, y, w, h] = at(t);
    return { x, y, w, h };
  };
});
