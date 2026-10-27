// Pure decision core for the seekToSafe coalescer. util.ts holds the impure shell (module state, the
// video's seeking/seeked events, and the stale timer) and just applies the effects these functions
// return. HTML5 video runs one seek at a time, so while a seek is in flight the latest requested
// target is held in a single "pending" slot and flushed when the seek settles ("latest write wins").
// Splitting the decisions out makes the concurrency behavior unit-testable: a fast drag's final target
// survives the in-flight seek instead of being dropped (which would strand the video at an
// intermediate frame), re-armed by the shell's timer so a missed 'seeked' is recovered.

export type SeekEffect =
  | { type: 'fire'; target: number } // seek the video to target now
  | { type: 'armTimer' }; // arm the stale-pending timer

export interface SeekDecision {
  // The new pending target (null = the slot is empty).
  pending: number | null;
  effects: readonly SeekEffect[];
}

const NONE: SeekDecision = { pending: null, effects: [] };

// A new seek request. `current` = video.getCurrentTime(), `seeking` = video.seeking; `target` is
// already clamped to a valid time.
export function onSeekRequest(target: number, current: number, seeking: boolean): SeekDecision {
  if (current === target) return NONE; // already there
  if (seeking) return { pending: target, effects: [{ type: 'armTimer' }] };
  return { pending: null, effects: [{ type: 'fire', target }] };
}

// The active seek settled: a 'seeked' event, or the stale timer. The timer flushes once a seek has
// finished whose 'seeked' was missed, and re-arms while a slow seek is still running, so the latest
// target (a step held back) survives a seek of any length. A new source drops it (onExternalSeek).
export function onSeekSettled(
  pending: number | null,
  current: number,
  seeking: boolean
): SeekDecision {
  if (pending === null) return NONE;
  // Another seek is already running (a 'seeked' arrived mid-flight): keep the target, a later settle
  // fires it. This is the half that must NOT drop the pending; re-arm so a missed 'seeked' is bounded.
  if (seeking) return { pending, effects: [{ type: 'armTimer' }] };
  if (Number.isNaN(pending) || current === pending) return NONE;
  return { pending: null, effects: [{ type: 'fire', target: pending }] };
}

// An external seek began (YouTube bar, native shortcut, ad, ...), or the video loaded a new source:
// drop our pending so it can't snap back over the user's intent or land on another video. The shell
// only calls this for seeks that are not ours.
export function onExternalSeek(): SeekDecision {
  return NONE;
}
