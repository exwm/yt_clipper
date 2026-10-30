import {
  CinematicSolveEvent,
  CinematicSolveInputs,
  initialCinematicSolveSchedule,
  stepCinematicSolve,
} from './cinematic-solve-schedule';

const stale = (
  signature: string,
  other: Partial<CinematicSolveInputs> = {}
): CinematicSolveInputs => ({
  signature,
  fresh: false,
  failedSignature: undefined,
  manipulating: false,
  ...other,
});
const idle = initialCinematicSolveSchedule;
const pendingFor = (signature: string) => ({ pendingSignature: signature });
const request: CinematicSolveEvent = { type: 'request' };
const frame: CinematicSolveEvent = { type: 'frame' };
const timerFired: CinematicSolveEvent = { type: 'timerFired' };

describe('stepCinematicSolve', () => {
  it.each([
    ['an edit starts the timer', idle, request, stale('a'), pendingFor('a'), ['startTimer']],
    [
      'a further edit restarts it',
      pendingFor('a'),
      request,
      stale('b'),
      pendingFor('b'),
      ['startTimer'],
    ],
    ['unchanged inputs keep its time', pendingFor('a'), request, stale('a'), pendingFor('a'), []],
    [
      'nothing to solve when neither the preview nor the plot needs a path',
      idle,
      request,
      stale('a', { signature: null }),
      idle,
      [],
    ],
    [
      'nothing to solve when the path is fresh',
      idle,
      request,
      stale('a', { fresh: true }),
      idle,
      [],
    ],
    [
      'failed inputs wait for an edit',
      idle,
      request,
      stale('a', { failedSignature: 'a' }),
      idle,
      [],
    ],
    [
      'an edit back to a fresh path cancels the timer',
      pendingFor('a'),
      request,
      stale('b', { fresh: true }),
      idle,
      ['cancelTimer'],
    ],
    [
      'an edit back to failed inputs cancels the timer',
      pendingFor('a'),
      request,
      stale('b', { failedSignature: 'b' }),
      idle,
      ['cancelTimer'],
    ],
    // No edit is pending, so the frame rate made the path stale: no edit is coming to settle.
    ['a stale frame solves at once', idle, frame, stale('a'), idle, ['solve']],
    [
      'a stale frame mid-drag starts the timer',
      idle,
      frame,
      stale('a', { manipulating: true }),
      pendingFor('a'),
      ['startTimer'],
    ],
    [
      'a frame never retries failed inputs',
      idle,
      frame,
      stale('a', { failedSignature: 'a' }),
      idle,
      [],
    ],
    [
      'a frame never restarts a running timer',
      pendingFor('a'),
      frame,
      stale('b'),
      pendingFor('a'),
      [],
    ],
    ['a settled timer solves', pendingFor('a'), timerFired, stale('a'), idle, ['solve']],
    [
      'a timer mid-drag waits again',
      pendingFor('a'),
      timerFired,
      stale('a', { manipulating: true }),
      pendingFor('a'),
      ['startTimer'],
    ],
    [
      'a timer for a path made fresh meanwhile does nothing',
      pendingFor('a'),
      timerFired,
      stale('a', { fresh: true }),
      idle,
      [],
    ],
    [
      'a timer never solves failed inputs',
      pendingFor('a'),
      timerFired,
      stale('b', { failedSignature: 'b' }),
      idle,
      [],
    ],
  ] as const)('%s', (_name, state, event, inputs, nextState, actions) => {
    const step = stepCinematicSolve(state, event, inputs);
    expect(step.state).toEqual(nextState);
    expect(step.actions.map((action) => action.type)).toEqual(actions);
  });

  it('solves once, after a run of edits and frames settles', () => {
    let state = idle;
    const solves: string[] = [];
    const events: [CinematicSolveEvent, CinematicSolveInputs][] = [
      [request, stale('a')],
      [frame, stale('a')],
      [request, stale('b')],
      [frame, stale('b')],
      [request, stale('c')],
      [timerFired, stale('c')],
      [frame, stale('c', { fresh: true })],
    ];
    for (const [event, inputs] of events) {
      const step = stepCinematicSolve(state, event, inputs);
      state = step.state;
      if (step.actions.some((action) => action.type === 'solve'))
        solves.push(inputs.signature ?? '');
    }
    expect(solves).toEqual(['c']);
    expect(state).toEqual(idle);
  });
});
