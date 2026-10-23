import { createDraft } from 'immer';
import { MarkerPair } from '../@types/yt_clipper';
import { getMarkerPairHistory, saveMarkerPairHistory } from './undoredo';

function pairWithAHoldPoint(): MarkerPair {
  const cropMap = [
    { x: 0, y: 0, crop: '0:0:100:100' },
    { x: 1, y: 0, crop: '0:0:100:100', hold: true },
  ];
  return {
    start: 0,
    end: 1,
    speed: 1,
    speedMap: [],
    crop: cropMap[0].crop,
    cropMap,
    enableZoomPan: false,
    cropRes: '1920x1080',
    undoredo: { history: [], index: -1 },
  } as unknown as MarkerPair;
}

describe('saveMarkerPairHistory', () => {
  it.each([
    ['stored in history', true, 1],
    ['not stored in history', false, 0],
  ])(
    'gives a hold point the crop of the point before it when %s',
    (_name, storeHistory, entries) => {
      const pair = pairWithAHoldPoint();
      const draft = createDraft(getMarkerPairHistory(pair));
      draft.cropMap[0].crop = '50:0:100:100';
      saveMarkerPairHistory(draft, pair, storeHistory);
      expect(pair.cropMap.map((point) => point.crop)).toEqual(['50:0:100:100', '50:0:100:100']);
      expect(pair.undoredo.history).toHaveLength(entries);
    }
  );
});
