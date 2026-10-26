/**
 * What an edit does while a crop drag or draw is in progress. Both write over the crop map they read
 * when they began, so an edit that changes the map under them must cancel them first or wait.
 */

export type CropEditInProgress = 'drag' | 'draw' | null;

export type CropEdit =
  | 'selectCropPoint'
  | 'copyNeighborCrop'
  | 'wheelZoomCrop'
  | 'addCropPoint'
  | 'addHoldCropPoint'
  | 'addSpeedPoint'
  | 'grabCropPoint'
  | 'deleteCropPoint'
  | 'toggleCropPointType'
  | 'moveMarker'
  | 'applyToAllPairs'
  | 'settingsInput'
  | 'rotateVideo'
  | 'deleteMarkerPair'
  | 'closeCropEditor'
  | 'showChart'
  | 'undoRedo'
  | 'startCropDraw'
  | 'startCropDrag';

export type CropEditConflict =
  // The edit in progress goes on with the change.
  | 'proceed'
  // Cancel the edit in progress, then make the edit.
  | 'cancelFirst'
  // The edit is a cancel of the edit in progress.
  | 'cancelOnly'
  | 'refuse';

const CROP_EDIT_POLICY: Record<CropEdit, Record<'drag' | 'draw', CropEditConflict>> = {
  // The drag or draw writes to the selected point, over another selection or a copied crop.
  selectCropPoint: { drag: 'refuse', draw: 'refuse' },
  copyNeighborCrop: { drag: 'refuse', draw: 'refuse' },
  // A drag scales the crop on its own Ctrl+wheel. A tick under a draw would add a crop point.
  wheelZoomCrop: { drag: 'refuse', draw: 'refuse' },
  // A drag refreshes its snapshot and goes on with the new point.
  addCropPoint: { drag: 'proceed', draw: 'cancelFirst' },
  // A hold point added under a drag breaks the drag.
  addHoldCropPoint: { drag: 'refuse', draw: 'cancelFirst' },
  // Alt+A with the speed chart open. Its undo step would sit between the drag's snapshot and its
  // cancel. Opening the chart cancels a draw, so only a drag can be in progress.
  addSpeedPoint: { drag: 'cancelFirst', draw: 'cancelFirst' },
  // Chart clicks: a drag holds the pointer, so only a draw can be in progress.
  grabCropPoint: { drag: 'cancelFirst', draw: 'cancelFirst' },
  deleteCropPoint: { drag: 'cancelFirst', draw: 'cancelFirst' },
  toggleCropPointType: { drag: 'cancelFirst', draw: 'cancelFirst' },
  moveMarker: { drag: 'cancelFirst', draw: 'cancelFirst' },
  // Alt+Shift+X and Alt+Shift+Q: an undo step for every pair, the edited one included.
  applyToAllPairs: { drag: 'cancelFirst', draw: 'cancelFirst' },
  // A settings editor input: a crop draw waiting for its first click leaves the editor usable, and
  // canceling the draw later would restore the crop points from before the edit.
  settingsInput: { drag: 'cancelFirst', draw: 'cancelFirst' },
  // The overlay's frame of reference turns under the drag or draw.
  rotateVideo: { drag: 'cancelFirst', draw: 'cancelFirst' },
  deleteMarkerPair: { drag: 'cancelFirst', draw: 'cancelFirst' },
  closeCropEditor: { drag: 'cancelFirst', draw: 'cancelFirst' },
  showChart: { drag: 'proceed', draw: 'cancelFirst' },
  // Undo or redo steps back over the canceled edit only.
  undoRedo: { drag: 'cancelOnly', draw: 'cancelOnly' },
  // Pressing the draw key again during a draw cancels it.
  startCropDraw: { drag: 'refuse', draw: 'cancelOnly' },
  startCropDrag: { drag: 'refuse', draw: 'refuse' },
};

export function cropEditConflict(edit: CropEdit, inProgress: CropEditInProgress): CropEditConflict {
  return inProgress == null ? 'proceed' : CROP_EDIT_POLICY[edit][inProgress];
}

export const CROP_EDITS = Object.keys(CROP_EDIT_POLICY) as CropEdit[];
