import { readFileSync } from 'fs';
import { join } from 'path';
import { getOutputDuration } from './util';
import type { SpeedPoint } from '../@types/yt_clipper';

interface Case {
  rate: string;
  kind: string;
  origin: number;
  partStart: number;
  speedMap: SpeedPoint[];
  outputDuration: number;
}
const cases: Case[] = JSON.parse(
  readFileSync(join(__dirname, '../../clipper/tests/fixtures/output_duration_cases.json'), 'utf8')
);

const rate = (fraction: string) => {
  const [num, den = '1'] = fraction.split('/');
  return Number(num) / Number(den);
};

// The markup's frame grid starts at 0, so rows on another grid are the clipper's alone.
const onTheMarkupsGrid = cases.filter((c) => c.origin === 0 && c.partStart === 0);

describe('getOutputDuration, against the clipper’s output durations', () => {
  it.each(onTheMarkupsGrid.map((c) => [`${c.rate} fps, ${c.kind}`, c] as const))(
    '%s',
    (_name, c) => {
      expect(getOutputDuration(c.speedMap, rate(c.rate))).toBeCloseTo(c.outputDuration, 6);
    }
  );
});
