import { INITIAL_LOOP_STATE } from './decisions/loop';
import type { OwnSeek } from './frame-step';
import {
  FRAME_TIMING_RELEASES,
  FrameTimingRelease,
  groupFlagName,
  GroupRelease,
} from './decisions/keys';
import {
  composeFrameTiming,
  choiceFromFlags,
  composeGroups,
  frameDecisionGroups,
  FrameDecisionGroup,
  FrameReading,
} from './frame-timing';
import { frameTiming548 } from './frame-timing-548';
import { frameTiming549 } from './frame-timing-549';
import { frameTimingNext } from './frame-timing-next';
import { timing548, timing549 } from './frame-timing-releases';
import { featureFlags, validFeatureFlagOverrides } from '../feature-flags';

const groupNames = Object.keys(frameDecisionGroups) as FrameDecisionGroup[];
const allGroups = (release: FrameTimingRelease) =>
  Object.fromEntries(groupNames.map((name) => [name, release])) as Record<
    FrameDecisionGroup,
    FrameTimingRelease
  >;

/** The decisions of `timing` that are not the same function as `whole`'s. */
function differing(timing: object, whole: object): string[] {
  return Object.keys(whole).filter(
    (name) => timing[name as keyof typeof timing] !== whole[name as keyof typeof whole]
  );
}

const flagsOf = (groups: Record<FrameDecisionGroup, GroupRelease>) =>
  Object.fromEntries(groupNames.map((group) => [groupFlagName(group), groups[group]]));

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
    expect(members.sort()).toEqual(Object.keys(timing548()).sort());
  });

  it.each([
    ['5.48', timing548()],
    ['5.49', timing549()],
    ['next', frameTimingNext],
  ] as const)('recompose %s decision by decision', (release, whole) => {
    const composed = composeGroups(allGroups(release));
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

    // 5.49's readers run only in 5.49's whole build and its oracle tests, beside 5.49's writers;
    // this pins that they would work beside 5.48's too.
    it.each([0.5, 1, 1.0123, 2.49])(
      'oracle only: 5.49 reads null as a seek the playhead has left, at %p s',
      (time) => {
        const refresh = { refresh: { time: 1000, gap: 16.7 }, lastOtherFrameAt: 990 };
        for (const kind of ['place', 'step'] as const) {
          const left: OwnSeek = { target: time + 0.5, frameStart: time + 0.48, kind };
          const decide = (ownSeek: OwnSeek | null) => [
            frameTiming549.frameTime(reading(time, ownSeek)),
            frameTiming549.stepSeek(reading(time, ownSeek), step),
            frameTiming549.loopTurnBack(reading(time, ownSeek), { ...loopAt, ...refresh }),
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
    const { noteRefresh } = frameTiming549;
    const state = noteRefresh(noteRefresh(INITIAL_LOOP_STATE, 1000), 1016.5);
    expect(state).toEqual({ refresh: { time: 1016.5, gap: 16.5 }, lastOtherFrameAt: -Infinity });
  });

  it.each(groupNames)("swap only the %s group when only it is on 5.49's release", (group) => {
    const composed = composeGroups({ ...allGroups('5.48'), [group]: '5.49' });
    for (const name of groupNames) {
      const decisions = frameDecisionGroups[name].release(name === group ? '5.49' : '5.48');
      for (const [member, decision] of Object.entries(decisions)) {
        expect(composed[member as keyof typeof composed]).toBe(decision);
      }
    }
  });
});

it.each([
  ['5.48', false],
  ['next', false],
  ['5.49', true],
] as const)('the steps group on %s counts frames in a pair duration: %p', (release, counts) => {
  const steps = frameDecisionGroups.steps.release(release);
  expect(steps.countsFrames).toBe(counts);
  const text = steps.pairDuration(
    { origin: 0, rate: 30 },
    { start: 1, end: 2, speed: 1, speedMap: [] },
    false
  ).text;
  // 5.49's text ends with the frame count in parentheses: 31 frames, the end marker's included.
  expect(text.endsWith('(31)')).toBe(counts);
});
describe('the build from the flags', () => {
  it.each(groupNames)(
    "is 5.49's whole with frameTiming549 on, even with the %s group's flag on 5.48",
    (group) => {
      const groups = { ...allGroups('next'), [group]: '5.48' } as Record<
        FrameDecisionGroup,
        GroupRelease
      >;
      const composed = composeFrameTiming(
        choiceFromFlags({ ...featureFlags, ...flagsOf(groups), frameTiming549: true })
      );
      expect(differing(composed, timing549())).toEqual([]);
    }
  );

  it('drops a stored 5.49 on a group flag, which only the whole flag offers', () => {
    expect(validFeatureFlagOverrides({ stepsTiming: '5.49', loopTiming: '5.48' })).toEqual({
      loopTiming: '5.48',
    });
  });
});
