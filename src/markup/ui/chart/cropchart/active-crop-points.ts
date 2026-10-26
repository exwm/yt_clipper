import type Chart from 'chart.js';
import type { CropPoint } from '../../../@types/yt_clipper';
import type { appState } from '../../../appState';

type EditorState = Pick<
  typeof appState,
  'isSettingsEditorOpen' | 'wasGlobalSettingsEditorOpen' | 'markerPairs' | 'prevSelectedMarkerPairIndex'
>;

/** The crop points being edited: the crop chart's, which shows the open marker pair's crop map, or
 *  that crop map before the chart is first shown (it is only created then). Null without a chart
 *  when no marker pair's editor is open. */
export function activeCropPoints(
  cropChart: Chart | null | undefined,
  state: EditorState
): CropPoint[] | null {
  const chartPoints = cropChart?.data.datasets?.[0].data as CropPoint[] | undefined;
  if (chartPoints) return chartPoints;
  const isPairEditorOpen = state.isSettingsEditorOpen && !state.wasGlobalSettingsEditorOpen;
  return (isPairEditorOpen && state.markerPairs[state.prevSelectedMarkerPairIndex]?.cropMap) || null;
}
