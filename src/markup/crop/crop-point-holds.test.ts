import { produce } from 'immer';
import { CropPoint } from '../@types/yt_clipper';
import {
  cropBeforeHold,
  releaseHoldIfChanged,
  releaseMismatchedHolds,
  resolveHeldCrops,
  toggleHold,
  toggleInstant,
} from './crop-point-holds';

// Rows write a crop map as letters for crops and `(h)` for a hold point: 'A B(h)'. The functions
// only compare crop text, so a letter stands in for a crop string.
function cropMap(row: string): CropPoint[] {
  return row.split(' ').map((token, i) => {
    const point: CropPoint = { x: i, y: 0, crop: token.replace('(h)', '') };
    if (token.endsWith('(h)')) point.hold = true;
    return point;
  });
}

function row(map: CropPoint[]): string {
  return map.map((point) => point.crop + (point.hold ? '(h)' : '')).join(' ');
}

describe('resolveHeldCrops', () => {
  it.each([
    ['A B(h)', 'A A(h)'],
    ['A B(h) C(h)', 'A A(h) A(h)'],
    ['A B C(h)', 'A B B(h)'],
    ['A B(h) C D(h)', 'A A(h) C C(h)'],
    ['A(h) B', 'A B'],
    ['A A(h)', 'A A(h)'],
  ])('%s resolves to %s', (input, expected) => {
    expect(row(produce(cropMap(input), resolveHeldCrops))).toBe(expected);
  });

  it.each(['A B', 'A A(h) B'])('keeps an already resolved map (%s) as the same object', (input) => {
    const map = cropMap(input);
    expect(produce(map, resolveHeldCrops)).toBe(map);
  });
});

describe('releaseHoldIfChanged', () => {
  it.each([
    ['A A(h)', 1, 'A A(h)'],
    ['A B(h)', 1, 'A B'],
    ['A B', 1, 'A B'],
    ['A(h) B', 0, 'A B'],
    ['A B(h)', 0, 'A B(h)'],
  ])('%s at index %d gives %s', (input, index, expected) => {
    expect(row(produce(cropMap(input), (map) => releaseHoldIfChanged(map, index)))).toBe(expected);
  });

  it('compares with the given crop equality', () => {
    const map = [
      { x: 0, y: 0 as const, crop: '0:0:iw:ih' },
      { x: 1, y: 0 as const, crop: '0:0:1920:1080', hold: true as const },
    ];
    const toPixels = (crop: string) => crop.replace('iw:ih', '1920:1080');
    const sameSize = (a: string, b: string) => toPixels(a) === toPixels(b);
    releaseHoldIfChanged(map, 1, sameSize);
    expect(map[1].hold).toBe(true);
    releaseHoldIfChanged(map, 1);
    expect(map[1].hold).toBeUndefined();
  });
});

describe('toggleInstant', () => {
  const type = (point: CropPoint) => (point.hold ? 'hold' : (point.easeIn ?? 'normal'));

  it.each([
    ['A B', 'instant', 'A B'],
    ['A B(h)', 'instant', 'A C'],
  ])('%s at index 1 becomes %s and gives %s', (input, expectedType, expected) => {
    const map = cropMap(input);
    toggleInstant(map, 1, 'C');
    expect(type(map[1])).toBe(expectedType);
    expect(row(map)).toBe(expected);
    toggleInstant(map, 1, 'C');
    expect(type(map[1])).toBe('normal');
  });
});

describe('cropBeforeHold', () => {
  // A pair state: [time, crop, hold] points, at 1920x1080 in zoompan mode unless given.
  type Point = [number, string, boolean?];
  const state = (points: Point[], cropRes = '1920x1080', enableZoomPan = true) => ({
    cropMap: points.map(([x, crop, hold]) => ({ x, y: 0, crop, ...(hold ? { hold } : {}) })),
    cropRes,
    enableZoomPan,
  });
  const P = '0:0:960:540';
  const Q = '480:270:960:540';
  const R = '960:540:960:540';

  it.each([
    [
      'the crop from before the point became a hold point',
      [
        state([
          [0, P],
          [1, Q],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
      ],
      1,
      Q,
    ],
    [
      'nothing for a point that was always a hold point',
      [
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, R],
          [1, R, true],
        ]),
      ],
      1,
      undefined,
    ],
    [
      'nothing past the current state, which redo would bring back',
      [
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, P],
          [1, Q],
        ]),
      ],
      1,
      undefined,
      0,
    ],
    [
      'nothing for a point added where a deleted one was',
      [
        state([
          [0, P],
          [1, Q],
        ]),
        state([[0, P]]),
        state([
          [0, P],
          [1, P, true],
        ]),
      ],
      1,
      undefined,
    ],
    [
      'nothing for a point moved onto the time of an earlier one',
      [
        state([
          [0, P],
          [1, R],
        ]),
        state([
          [0, P],
          [0.5, P, true],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
      ],
      1,
      undefined,
    ],
    [
      'the position at the size every pan-only point now has',
      [
        state(
          [
            [0, '0:0:960:1080'],
            [1, '640:0:960:1080'],
          ],
          '1920x1080',
          false
        ),
        state(
          [
            [0, '0:0:960:1080'],
            [1, '0:0:960:1080', true],
          ],
          '1920x1080',
          false
        ),
        state(
          [
            [0, '0:0:800:900'],
            [1, '0:0:800:900', true],
          ],
          '1920x1080',
          false
        ),
      ],
      1,
      '640:0:800:900',
    ],
    [
      'a crop moved back into the frame at the new size',
      [
        state(
          [
            [0, '0:0:960:1080'],
            [1, '960:0:960:1080'],
          ],
          '1920x1080',
          false
        ),
        state(
          [
            [0, '0:0:1200:1080'],
            [1, '0:0:1200:1080', true],
          ],
          '1920x1080',
          false
        ),
      ],
      1,
      '720:0:1200:1080',
    ],
    [
      'a crop scaled to the crop resolution now',
      [
        state(
          [
            [0, '0:0:480:270'],
            [1, '240:135:480:270'],
          ],
          '960x540'
        ),
        state([
          [0, P],
          [1, P, true],
        ]),
      ],
      1,
      Q,
    ],
    [
      'a crop given in iw and ih',
      [
        state([
          [0, P],
          [1, '0:0:iw:ih'],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
      ],
      1,
      '0:0:1920:1080',
    ],
    [
      'a zoompan crop at the aspect ratio the points now share, keeping its width and center',
      [
        state([
          [0, P],
          [1, '0:0:960:1080'],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, '0:0:1080:1080'],
          [1, '0:0:1080:1080', true],
        ]),
      ],
      1,
      '0:60:960:960',
    ],
    [
      'a zoompan crop narrowed to fit the frame at that ratio, and moved back into it',
      [
        state([
          [0, P],
          [1, '1600:900:320:180'],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, '0:0:270:960'],
          [1, '0:0:270:960', true],
        ]),
      ],
      1,
      '1609:3:303:1077',
    ],
    [
      'a wide zoompan crop narrowed to a tall shared ratio at the frame height',
      [
        state([
          [0, P],
          [1, '0:0:1920:540'],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, '0:0:540:1080'],
          [1, '0:0:540:1080', true],
        ]),
      ],
      1,
      '690:0:540:1080',
    ],
    [
      'a zoompan crop at a ratio that is not a whole number of pixels',
      [
        state([
          [0, P],
          [1, '0:0:800:100'],
        ]),
        state([
          [0, P],
          [1, P, true],
        ]),
        state([
          [0, '0:0:400:42'],
          [1, '0:0:400:42', true],
        ]),
      ],
      1,
      '0:8:800:84',
    ],
  ] as [string, ReturnType<typeof state>[], number, string | undefined, number?][])(
    'finds %s',
    (_case, states, time, expected, index = states.length - 1) => {
      const now = states[index];
      const held = now.cropMap.find((p) => p.x === time)?.crop ?? '';
      const undoredo = { history: states, index };
      expect(cropBeforeHold(undoredo, time, now, held)).toBe(expected);
    }
  );
});

describe('toggleHold', () => {
  it.each([
    ['A B', 1, true, 'A B(h)'],
    ['A B(h)', 1, true, 'A B'],
    ['A B', 0, false, 'A B'],
  ])('%s at index %d returns %s and gives %s', (input, index, toggled, expected) => {
    const map = cropMap(input);
    expect(toggleHold(map, index)).toBe(toggled);
    expect(row(map)).toBe(expected);
  });

  it('gives a released hold point back its own crop', () => {
    const map = cropMap('A A(h)');
    toggleHold(map, 1, 'B');
    expect(row(map)).toBe('A B');
  });

  it('makes an instant point a hold point without its instant easing', () => {
    const map = cropMap('A B');
    map[1].easeIn = 'instant';
    toggleHold(map, 1);
    expect(map[1]).toEqual({ x: 1, y: 0, crop: 'B', hold: true });
  });
});

describe('releaseMismatchedHolds', () => {
  it.each([
    ['A A(h)', 'A A(h)'],
    ['A B(h)', 'A B'],
    ['A B(h) B(h)', 'A B B(h)'],
    ['A(h) A(h)', 'A A(h)'],
  ])('%s loads as %s', (input, expected) => {
    const map = cropMap(input);
    releaseMismatchedHolds(map);
    expect(row(map)).toBe(expected);
  });
});
