import {
  FrameGrid,
  frameAt,
  frameSeekTarget,
  frameSpan,
  loopSeekTarget,
  PLACEMENT_TOLERANCE,
} from './frame-grid';

/** The markup's last seek to show a frame: where it seeks, and the start of the frame it means. A
 *  'place' seek shows a placed time, such as a marker's; a 'step' seek a frame middle on the grid of
 *  the rate in use, which at a rate above the video's isn't the frame it shows. */
export interface OwnSeek {
  target: number;
  frameStart: number;
  kind: 'place' | 'step';
}

/** Whether the playhead is still where `seek` put it. */
export function isAtOwnSeek(seek: OwnSeek, playhead: number, fps: number): boolean {
  return (
    Math.abs(playhead - seek.target) < 1 / fps / 4 &&
    playhead >= seek.frameStart - PLACEMENT_TOLERANCE
  );
}

/** What the frame clock knows of the frame on screen. */
export interface FrameOnScreen {
  // Null before the video presents a frame.
  mediaTime: number | null;
  // Read at the last `seeked` (new VideoFrame), which times it at its start.
  isRead: boolean;
  // Presented or read after the last seek finished, with no seek started since.
  isCurrent: boolean;
}

/** The frame on screen as frame decisions read it. */
export interface ScreenFrame {
  // Its start, or where that is unknown, a stand-in in the playhead's frame.
  start: number;
  isStartKnown: boolean;
  // It is the playhead's frame: current, or it contains the playhead exactly.
  isPlayheads: boolean;
}

// Millisecond-rounded frame times sit up to half a millisecond off the frame's start.
const FRAME_TIME_ROUNDING = 0.0005;
// Firefox rounds currentTime to the microsecond, so a playhead on the next frame's start can read a
// hair before it.
export const TIME_ROUNDING = 0.00001;

/** Whether the frame starting at `start` holds the playhead within a frame of the rate in use. A
 *  frame from before a seek never does: the markup's seeks land 1 ms or more into a frame. */
function holdsPlayhead(start: number, playhead: number, fps: number): boolean {
  return (
    start <= playhead + PLACEMENT_TOLERANCE && playhead < start + 1 / fps + FRAME_TIME_ROUNDING
  );
}

// A frame from before the last seek can look like it holds the playhead only through the tolerances,
// when a user seek lands just before its start: such a frame must contain the playhead exactly. A
// frame presented before `seeking` (YouTube) is never current, and a step's middle target is well
// inside it.
function containsPlayhead(start: number, playhead: number, fps: number): boolean {
  return start <= playhead && playhead + TIME_ROUNDING < start + 1 / fps;
}

/** The start of the playhead's frame on the grid of the rate in use. A plain floor: the playhead is
 *  exact, unlike placed times. */
function gridFrameStart(playhead: number, fps: number): number {
  return Math.floor(playhead * fps + 1e-9) / fps;
}

/**
 * The frame on screen at `playhead`. Firefox times the first frame after a seek at the seek target
 * (Gecko's DropVideoUpToSeekTarget), so a frame timed at the playhead may start earlier, unless the
 * read at `seeked` timed it, or it sits on the grid of a measured rate (millisecond-rounded frame
 * starts do). Its start is then unknown. The stand-in is its grid frame's start on a measured rate;
 * else the playhead less the placement tolerance, as in 5.48, since a grid frame of an assumed rate
 * can start in the video frame before.
 */
export function screenFrame(
  on: FrameOnScreen,
  playhead: number,
  fps: number,
  isRateExact: boolean
): ScreenFrame {
  const mediaTime = on.mediaTime ?? playhead;
  const gridOffset = Math.abs(mediaTime * fps - Math.round(mediaTime * fps));
  const isStartKnown =
    Math.abs(mediaTime - playhead) >= TIME_ROUNDING ||
    on.isRead ||
    (isRateExact && gridOffset <= FRAME_TIME_ROUNDING * fps);
  const standIn = isRateExact
    ? gridFrameStart(playhead, fps)
    : Math.max(0, playhead - PLACEMENT_TOLERANCE);
  return {
    start: isStartKnown ? mediaTime : standIn,
    isStartKnown,
    isPlayheads: on.isCurrent || containsPlayhead(mediaTime, playhead, fps),
  };
}

/**
 * The time of the frame the user is on, which placements store and decisions read: the frame of the
 * playhead, presented yet or not. Right after a jump to a placed time, that time. Else the start of
 * the frame on screen, once it is the playhead's frame. Else the playhead less the placement
 * tolerance, which `frameAt` reads as the playhead's own frame on any grid. A point placed on a frame
 * and the time read there later are then the same frame start, so finding a point on the frame shown
 * needs no grid guess.
 */
export function frameTime(
  screen: ScreenFrame,
  at: {
    // Where the playhead is or is going: the seek held back, else the current time.
    playhead: number;
    isSeekInFlight: boolean;
    ownSeek: OwnSeek | null;
    fps: number;
  }
): number {
  const { playhead, isSeekInFlight, ownSeek, fps } = at;
  if (ownSeek?.kind === 'place' && isAtOwnSeek(ownSeek, playhead, fps)) return ownSeek.frameStart;
  if (!isSeekInFlight && screen.isPlayheads) return screen.start;
  return Math.max(0, playhead - PLACEMENT_TOLERANCE);
}

/** A display refresh as an animation frame callback sees it: its time and the gap since the last
 *  one, in ms. A missed refresh doubles the gap. */
export interface Refresh {
  time: number;
  gap: number;
}

/**
 * Whether a loop should keep its end frame on screen at `refresh` rather than seek back, so the frame
 * shows about its full time and the frame after it never shows. The end frame started after
 * `lastOtherFrameAt`, the last refresh the loop saw another frame, so the next frame can show a
 * frame duration (ms) after it. A frame under 2 refreshes long turns back at once.
 */
export function shouldHoldEndFrame(
  refresh: Refresh,
  lastOtherFrameAt: number,
  frameDuration: number
): boolean {
  // The 2% keeps a frame of exactly 2 refreshes from turning back at 1 on rounded frame times. Kept
  // small: a frame of 6.875 refreshes (165 Hz, 24 fps) holds 6 or 7.
  return refresh.time + refresh.gap * 0.98 <= lastOtherFrameAt + frameDuration;
}

/** The end frame's duration in ms at `playbackRate`: the `reported` one (s) where the browser gives
 *  it, else a frame at `rate`, which before the rate is measured is the assumed 60 fps. */
export function endFrameDuration(
  reported: number | null,
  rate: number,
  playbackRate: number
): number {
  const duration = reported != null && reported > 0 ? reported : 1 / rate;
  return (duration * 1000) / playbackRate;
}

/** What a loop over the frames shown from `start` through `end` reads at a refresh, and its state
 *  from the refresh before. */
export interface LoopRefresh {
  grid: FrameGrid;
  start: number;
  end: number;
  isPlaying: boolean;
  // Playing, the frame on screen's time; paused, the playhead.
  time: number;
  playhead: number;
  // The frame the video holds while playing, on the platform's timeline; null where it can't be read.
  held: { time: number; duration: number | null } | null;
  refresh: Refresh;
  playbackRate: number;
  // The last refresh the loop saw a frame other than its end frame.
  lastOtherFrameAt: number;
}

/** Where a loop seeks at a refresh, or null, and its `lastOtherFrameAt` for the next one. */
export function loopTurnBack(loop: LoopRefresh): {
  seekTo: number | null;
  lastOtherFrameAt: number;
} {
  const { grid, start, end, isPlaying, time, playhead, held, refresh } = loop;
  // Also 5.48's test: at an assumed rate a mid-frame end can fall in a grid frame after the frame on
  // screen's, which then turns back only once the frame after it shows.
  const isPastEnd = isPlaying && playhead > end;
  const target = isPastEnd
    ? frameSeekTarget(grid, start)
    : loopSeekTarget(grid, start, end, time, isPlaying);
  // A seek as the end frame shows cuts it to one refresh. Also past the end, which the playhead
  // crosses a refresh after a frame-start end's frame shows, but only for the frame shown at the end:
  // at an assumed rate the grid's last frame can be the video frame after it. The frame's own
  // duration, where the browser reports it, also times it before the rate is measured.
  const isEndFrame =
    held != null &&
    held.time <= end + PLACEMENT_TOLERANCE &&
    frameAt(grid, held.time) === frameSpan(grid, start, end).lastFrame;
  const lastOtherFrameAt = isEndFrame ? loop.lastOtherFrameAt : refresh.time;
  const frameDuration = endFrameDuration(held?.duration ?? null, grid.rate, loop.playbackRate);
  const isHolding = isEndFrame && shouldHoldEndFrame(refresh, lastOtherFrameAt, frameDuration);
  return { seekTo: isHolding ? null : target, lastOtherFrameAt };
}

/**
 * Where a step of whole frames should seek: the middle of the frame `frames` away. A seek shows the
 * frame that covers its target, so a target on a frame boundary can show either neighbor; the middle
 * is half a frame from both edges, so millisecond-rounded timestamps and a rate slightly off can't
 * change the frame shown.
 *
 * A step starts from the frame on screen once it is the playhead's, its start known, and it holds
 * the playhead within a frame of the rate in use, so steps keep moving at an assumed rate above the
 * video's. Until then (a seek in flight, or its frame not presented yet) the frame on screen is an
 * earlier one: a step then continues from the last step's target, or from the playhead's frame after
 * another seek. So no order of seek events and frame presentation matters, and a rate slightly off
 * never builds up.
 */
export function frameStepTarget(
  screen: ScreenFrame,
  step: {
    // Where the playhead is or is going: the seek held back, else the current time.
    playhead: number;
    isSeekInFlight: boolean;
    ownSeek: OwnSeek | null;
    fps: number;
    // The video's duration: NaN before its metadata loads, Infinity while live.
    duration: number;
    frames: number;
  }
): number {
  const { playhead, isSeekInFlight, ownSeek, fps, duration, frames } = step;
  const frameDuration = 1 / fps;
  // At the video's ends, the middle of its first or last frame, so the next step back or forward
  // starts from a frame middle too.
  const lastMiddle = Number.isFinite(duration) ? duration - frameDuration / 2 : Infinity;
  // Past the last frame's middle (at the end the video snaps to its duration), the playhead is on
  // the last frame.
  const playheadInVideo = Math.min(playhead, lastMiddle);
  const ownStep =
    ownSeek?.kind === 'step' && isAtOwnSeek(ownSeek, playheadInVideo, fps) ? ownSeek : null;
  // With no seek pending and the playhead moved off the last step, the frame on screen is the user's,
  // as `frameTime` reads it, even when it doesn't hold the playhead: paused from playing, Chrome can
  // hold a frame that starts after the playhead or ends before it.
  const isScreenFrom =
    screen.isPlayheads &&
    screen.isStartKnown &&
    (holdsPlayhead(screen.start, playheadInVideo, fps) || (!isSeekInFlight && ownStep == null));
  const frameStart = isScreenFrom
    ? screen.start
    : (ownStep?.frameStart ??
      // The playhead's grid frame, so every target is a frame middle.
      gridFrameStart(playheadInVideo, fps));
  const target = frameStart + (frames + 0.5) * frameDuration;
  return Math.min(Math.max(target, frameDuration / 2), lastMiddle);
}
