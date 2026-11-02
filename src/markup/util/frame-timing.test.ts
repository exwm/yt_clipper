import { INITIAL_LOOP_STATE } from './decisions/loop';
import type { OwnSeek } from './frame-step';
import { FRAME_TIMING_RELEASES, FrameTimingRelease } from './decisions/keys';
import {
  composeFrameTiming,
  frameDecisionGroups,
  FrameDecisionGroup,
  FrameReading,
  FrameTimingReleases,
} from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';
import { frameTimingNext } from './frame-timing-next';

const groupNames = Object.keys(frameDecisionGroups) as FrameDecisionGroup[];
const allGroups = (release: FrameTimingRelease) =>
  Object.fromEntries(groupNames.map((name) => [name, release])) as FrameTimingReleases;

describe('the frame decision groups', () => {
  it('hold every decision once, with the same members in every release', () => {
    const members = groupNames.flatMap((name) => {
      const group = frameDecisionGroups[name];
      const legacy = Object.keys(group.release('5.48')).sort();
      for (const release of FRAME_TIMING_RELEASES) {
        expect(Object.keys(group.release(release)).sort()).toEqual(legacy);
      }
      return legacy;
    });
    expect(members.sort()).toEqual(Object.keys(frameTiming548).sort());
  });

  it.each([
    ['5.48', frameTiming548],
    ['5.49', frameTiming549],
    ['next', frameTimingNext],
  ] as const)('recompose %s decision by decision', (release, whole) => {
    const composed = composeFrameTiming(allGroups(release));
    expect(Object.keys(composed).sort()).toEqual(Object.keys(whole).sort());
    for (const [name, decision] of Object.entries(whole)) {
      const isSame = composed[name as keyof typeof composed] === decision;
      expect({ name, isSame }).toEqual({ name, isSame: true });
    }
  });

  describe('the last own seek', () => {
    const grid = { origin: 0, rate: 30 };
    const reading = (currentTime: number, ownSeek: OwnSeek | null): FrameReading => ({
      currentTime,
      pendingSeek: null,
      seeking: false,
      onScreen: { mediaTime: Math.floor(currentTime * 30) / 30, isRead: true, isCurrent: true },
      grid,
      isRateMeasured: true,
      ownSeek,
    });
    const step = { frames: 1, duration: 120, hasFrameCallbacks: true };
    const loopAt = { start: 1, end: 2, isPlaying: false, held: null, playbackRate: 1 };

    it("is never written by 5.48's seeks and steps", () => {
      expect(frameDecisionGroups.seek.release('5.48').placeSeek(grid, 1.234)).toEqual({
        to: 1.234,
        ownSeek: null,
      });
      expect(frameDecisionGroups.steps.release('5.48').stepSeek(reading(1, null), step)).toEqual({
        by: 1 / 30,
      });
    });

    // So 5.49's readers work beside 5.48's writers.
    it.each([0.5, 1, 1.0123, 2.49])(
      'reads null as a seek the playhead has left, at %p s',
      (time) => {
        const { placement, steps, loop } = frameDecisionGroups;
        const refresh = { refresh: { time: 1000, gap: 16.7 }, lastOtherFrameAt: 990 };
        for (const kind of ['place', 'step'] as const) {
          const left: OwnSeek = { target: time + 0.5, frameStart: time + 0.48, kind };
          const decide = (ownSeek: OwnSeek | null) => [
            placement.release('5.49').frameTime(reading(time, ownSeek)),
            steps.release('5.49').stepSeek(reading(time, ownSeek), step),
            loop.release('5.49').loopTurnBack(reading(time, ownSeek), { ...loopAt, ...refresh }),
          ];
          expect(decide(null)).toEqual(decide(left));
        }
      }
    );
  });

  it("leaves the loop state as it is under 5.48's loop, which reads no refreshes", () => {
    const { noteRefresh } = frameDecisionGroups.loop.release('5.48');
    expect(noteRefresh(noteRefresh(INITIAL_LOOP_STATE, 1000), 1016.7)).toBe(INITIAL_LOOP_STATE);
  });

  it("notes each refresh and the gap since the last under 5.49's loop", () => {
    const { noteRefresh } = frameDecisionGroups.loop.release('5.49');
    const state = noteRefresh(noteRefresh(INITIAL_LOOP_STATE, 1000), 1016.5);
    expect(state).toEqual({ refresh: { time: 1016.5, gap: 16.5 }, lastOtherFrameAt: -Infinity });
  });

  it.each(groupNames)("swap only the %s group when only it is on 5.49's release", (group) => {
    const composed = composeFrameTiming({ ...allGroups('5.48'), [group]: '5.49' });
    for (const name of groupNames) {
      const decisions = frameDecisionGroups[name].release(name === group ? '5.49' : '5.48');
      for (const [member, decision] of Object.entries(decisions)) {
        expect(composed[member as keyof typeof composed]).toBe(decision);
      }
    }
  });
});
