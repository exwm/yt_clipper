import { INITIAL_LOOP_STATE } from './decisions/loop';
import type { OwnSeek } from './frame-step';
import {
  composeFrameTiming,
  frameDecisionGroups,
  FrameDecisionGroup,
  FrameReading,
} from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';

const groupNames = Object.keys(frameDecisionGroups) as FrameDecisionGroup[];
const allGroups = (useCandidate: boolean) =>
  Object.fromEntries(groupNames.map((name) => [name, useCandidate])) as Record<
    FrameDecisionGroup,
    boolean
  >;

describe('the frame decision groups', () => {
  it('hold every decision once, with the same members in 5.48 and the candidate', () => {
    const members = groupNames.flatMap((name) => {
      const { legacy, candidate } = frameDecisionGroups[name];
      expect(Object.keys(candidate).sort()).toEqual(Object.keys(legacy).sort());
      return Object.keys(legacy);
    });
    expect(members.sort()).toEqual(Object.keys(frameTiming548).sort());
  });

  it.each([
    ['5.48', false, frameTiming548],
    ['5.49', true, frameTiming549],
  ] as const)('recompose %s decision by decision', (_mode, useCandidate, whole) => {
    const composed = composeFrameTiming(allGroups(useCandidate));
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
      expect(frameDecisionGroups.seek.legacy.placeSeek(grid, 1.234)).toEqual({
        to: 1.234,
        ownSeek: null,
      });
      expect(frameDecisionGroups.steps.legacy.stepSeek(reading(1, null), step)).toEqual({
        by: 1 / 30,
      });
    });

    // So the candidates that read it work beside 5.48's writers.
    it.each([0.5, 1, 1.0123, 2.49])(
      'reads null as a seek the playhead has left, at %p s',
      (time) => {
        const { placement, steps, loop } = frameDecisionGroups;
        const refresh = { refresh: { time: 1000, gap: 16.7 }, lastOtherFrameAt: 990 };
        for (const kind of ['place', 'step'] as const) {
          const left: OwnSeek = { target: time + 0.5, frameStart: time + 0.48, kind };
          const decide = (ownSeek: OwnSeek | null) => [
            placement.candidate.frameTime(reading(time, ownSeek)),
            steps.candidate.stepSeek(reading(time, ownSeek), step),
            loop.candidate.loopTurnBack(reading(time, ownSeek), { ...loopAt, ...refresh }),
          ];
          expect(decide(null)).toEqual(decide(left));
        }
      }
    );
  });

  it("leaves the loop state as it is under 5.48's loop, which reads no refreshes", () => {
    const { noteRefresh } = frameDecisionGroups.loop.legacy;
    expect(noteRefresh(noteRefresh(INITIAL_LOOP_STATE, 1000), 1016.7)).toBe(INITIAL_LOOP_STATE);
  });

  it("notes each refresh and the gap since the last under the candidate's loop", () => {
    const { noteRefresh } = frameDecisionGroups.loop.candidate;
    const state = noteRefresh(noteRefresh(INITIAL_LOOP_STATE, 1000), 1016.5);
    expect(state).toEqual({ refresh: { time: 1016.5, gap: 16.5 }, lastOtherFrameAt: -Infinity });
  });

  it.each(groupNames)('swap only the %s group when only its candidate is on', (group) => {
    const composed = composeFrameTiming({ ...allGroups(false), [group]: true });
    for (const name of groupNames) {
      const { legacy, candidate } = frameDecisionGroups[name];
      for (const [member, decision] of Object.entries(name === group ? candidate : legacy)) {
        expect(composed[member as keyof typeof composed]).toBe(decision);
      }
    }
  });
});
