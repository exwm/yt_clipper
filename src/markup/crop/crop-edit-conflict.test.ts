import { CROP_EDITS, CropEdit, cropEditConflict } from './crop-edit-conflict';

const editsThatProceedDuring = (inProgress: 'drag' | 'draw'): CropEdit[] =>
  CROP_EDITS.filter((edit) => cropEditConflict(edit, inProgress) === 'proceed');

describe('cropEditConflict', () => {
  it('lets every edit proceed when no crop drag or draw is in progress', () => {
    expect(CROP_EDITS.filter((edit) => cropEditConflict(edit, null) !== 'proceed')).toEqual([]);
  });

  it('lets no edit change the crop map under a draw, which cannot take a change', () => {
    expect(editsThatProceedDuring('draw')).toEqual([]);
  });

  it('lets a drag go on only through what it refreshes its snapshot for', () => {
    expect(editsThatProceedDuring('drag').sort()).toEqual(['addCropPoint', 'showChart']);
  });

  it.each([
    ['undoRedo', 'drag', 'cancelOnly'],
    ['undoRedo', 'draw', 'cancelOnly'],
    ['startCropDraw', 'draw', 'cancelOnly'],
    ['startCropDraw', 'drag', 'refuse'],
    ['addHoldCropPoint', 'drag', 'refuse'],
    ['addHoldCropPoint', 'draw', 'cancelFirst'],
    ['addSpeedPoint', 'drag', 'cancelFirst'],  ] as const)('%s during a %s: %s', (edit, inProgress, expected) => {
    expect(cropEditConflict(edit, inProgress)).toBe(expected);
  });
});
