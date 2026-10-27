import { readFileSync } from 'fs';
import { join } from 'path';
import { getOutputDuration } from './util';
import type { SpeedPoint } from '../@types/yt_clipper';

interface Case {
  rate: string;
  kind: string;
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

describe('getOutputDuration, against the clipper’s output durations', () => {
  it.each(cases.map((c) => [`${c.rate} fps, ${c.kind}`, c] as const))('%s', (_name, c) => {
    expect(getOutputDuration(c.speedMap, rate(c.rate))).toBeCloseTo(c.outputDuration, 6);
  });
});
