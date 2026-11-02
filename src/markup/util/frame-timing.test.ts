import { composeFrameTiming, frameDecisionGroups, FrameDecisionGroup } from './frame-timing';
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
