import { Draft, finishDraft } from 'immer';
import { MarkerPair, MarkerPairHistory } from '../@types/yt_clipper';

const historySize = 100;
export function pushState<S>(undoredo: { history: S[]; index: number }, state: S): void {
  undoredo.history.splice(undoredo.index + 1);
  undoredo.history.push(state);
  if (undoredo.history.length > historySize) {
    undoredo.history.shift();
  } else {
    undoredo.index++;
  }
}

enum RestoreDirection {
  undo,
  redo,
}

export function undo<S>(
  undoredo: { history: S[]; index: number },
  restore: (state: S, dir: RestoreDirection) => void
): S | null {
  if (undoredo.index <= 0) {
    return null;
  } else {
    undoredo.index--;
    const state = undoredo.history[undoredo.index];
    restore(state, RestoreDirection.undo);
    return state;
  }
}

export function redo<S>(
  undoredo: { history: S[]; index: number },
  restore: (state: S, dir: RestoreDirection) => void
): S | null {
  if (undoredo.index >= undoredo.history.length - 1) {
    return null;
  } else {
    undoredo.index++;
    const state = undoredo.history[undoredo.index];
    restore(state, RestoreDirection.redo);
    return state;
  }
}

export function peekLastState<S>(undoredo: { history: S[]; index: number }): S {
  const state = undoredo.history[undoredo.index];
  return state;
}

export function getMarkerPairHistory(markerPair: MarkerPair): MarkerPairHistory {
  const { start, end, speed, speedMap, crop, cropMap, enableZoomPan, cropRes } = markerPair;
  const history = { start, end, speed, speedMap, crop, cropMap, enableZoomPan, cropRes };
  return history;
}

// Dispatched on `document` whenever a marker pair's undo/redo stacks change, so
// UI such as the undo/redo buttons can resync their disabled state without
// polling. Decouples the low-level history store from the editor that renders it.
export const MARKER_PAIR_HISTORY_CHANGED_EVENT = 'ytc:markerpair-history-changed';

// Guarded so this module stays importable in the DOM-less (node) test env.
export function dispatchMarkerPairHistoryChanged() {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new Event(MARKER_PAIR_HISTORY_CHANGED_EVENT));
  }
}

export function saveMarkerPairHistory(
  draft: Draft<MarkerPairHistory>,
  markerPair: MarkerPair,
  storeHistory = true
) {
  const newState = finishDraft(draft);
  Object.assign(markerPair, newState);
  if (storeHistory) {
    pushState(markerPair.undoredo, newState);
    dispatchMarkerPairHistoryChanged();
  }
}
