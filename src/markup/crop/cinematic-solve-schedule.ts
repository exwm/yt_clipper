/**
 * When the preview solves the active pair's Cinematic path: a pure function from the schedule's state,
 * an event and the inputs of the moment to the next state and the actions `charts.ts` carries out.
 *
 * The L1 solve is global and far too heavy for the frame loops, so edits solve off a debounce timer:
 * every edit restarts the timer, and the solve runs once editing settles. A frame rate change solves
 * on the next frame, once, since its path is then fresh. Inputs that already failed
 * wait for an edit instead of being retried, and a solve never runs mid-drag.
 */

export interface CinematicSolveState {
  // The inputs the running debounce timer will solve for; null when no timer runs.
  pendingSignature: string | null;
}

export interface CinematicSolveInputs {
  // The inputs of the path the preview or the Cinematic plot needs, or null when neither needs one.
  signature: string | null;
  // The pair's solved path matches `signature`.
  fresh: boolean;
  // The inputs of the pair's last solve, if that solve failed.
  failedSignature: string | undefined;
  // A crop drag, crop draw, or chart point drag is in progress.
  manipulating: boolean;
}

export type CinematicSolveEvent =
  // An edit or a settings change, which may leave the path out of date.
  | { type: 'request' }
  // A frame found no fresh path, as a frame rate change does with no edit.
  | { type: 'frame' }
  | { type: 'timerFired' };

// `startTimer` replaces a running timer.
export type CinematicSolveAction =
  | { type: 'startTimer' }
  | { type: 'cancelTimer' }
  | { type: 'solve' };

export interface CinematicSolveStep {
  state: CinematicSolveState;
  actions: CinematicSolveAction[];
}

export const initialCinematicSolveSchedule: CinematicSolveState = { pendingSignature: null };

// No solve is needed for these inputs: none is asked for, the path is fresh, or they already failed.
function needsNoSolve({ signature, fresh, failedSignature }: CinematicSolveInputs): boolean {
  return signature === null || fresh || failedSignature === signature;
}

function request(state: CinematicSolveState, inputs: CinematicSolveInputs): CinematicSolveStep {
  if (needsNoSolve(inputs)) {
    // An edit back to a fresh path or to failed inputs leaves nothing for a running timer to solve.
    return state.pendingSignature === null
      ? { state, actions: [] }
      : { state: initialCinematicSolveSchedule, actions: [{ type: 'cancelTimer' }] };
  }
  // A request with unchanged inputs, such as a paused seek that selects another crop point, keeps the
  // pending solve's time, so scrubbing cannot postpone it.
  if (state.pendingSignature === inputs.signature) return { state, actions: [] };
  return { state: { pendingSignature: inputs.signature }, actions: [{ type: 'startTimer' }] };
}

export function stepCinematicSolve(
  state: CinematicSolveState,
  event: CinematicSolveEvent,
  inputs: CinematicSolveInputs
): CinematicSolveStep {
  switch (event.type) {
    case 'request':
      return request(state, inputs);
    case 'frame':
      // Frames come every refresh during playback, so they never restart a timer.
      if (state.pendingSignature !== null) return { state, actions: [] };
      // With no edit pending, the frame rate changed: no edit is coming to settle, so solve now.
      if (inputs.manipulating || needsNoSolve(inputs)) return request(state, inputs);
      return { state, actions: [{ type: 'solve' }] };
    case 'timerFired': {
      const idle = initialCinematicSolveSchedule;
      // Mid-drag, wait for another settled interval: the drag's end requests again too.
      if (inputs.manipulating) return request(idle, inputs);
      return { state: idle, actions: needsNoSolve(inputs) ? [] : [{ type: 'solve' }] };
    }
  }
}
