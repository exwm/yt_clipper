import type { ActiveLoop } from './markers';

let activeLoop: ActiveLoop | null = null;
jest.mock('./markers', () => ({ getActiveLoop: () => activeLoop }));
jest.mock('./yt_clipper', () => ({ platform: 'yt_clipper' }));

import { loopSafeSeekTime } from './loop-seek-guard';

describe('loopSafeSeekTime', () => {
  const loop: ActiveLoop = { kind: 'marker-pair', start: 10, end: 20 };

  it.each([
    ['no active loop keeps the time', null, 5, 5],
    ['inside the loop keeps the time', loop, 15, 15],
    ['the loop edges count as inside', loop, 20, 20],
    ['before the loop goes to its start', loop, 5, 10],
    ['after the loop goes to its start', loop, 25, 10],
  ] as const)('%s', (_name, active, time, expected) => {
    activeLoop = active;
    expect(loopSafeSeekTime(time)).toBe(expected);
  });
});
