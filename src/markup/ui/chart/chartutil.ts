import cloneDeep from 'lodash.clonedeep';
import { appState } from '../../appState';
import { cropStringsEqual, getCropComponents, setAspectRatioForAllPoints } from '../../crop-utils';
import { assertDefined, bsearch } from '../../util/util';
import { chartState, getInterpolatedCrop, updateChartBounds } from '../../charts';
import { Crop } from '../../crop/crop';
import { getInterpolatedSpeed } from '../../speed';
import { MarkerPair } from '../../@types/yt_clipper';
import { sortX } from './chartPrimitives';

export { sortX, lightgrey, medgrey, grey, cubicInOutTension, roundX, roundY, getInputUpdater } from './chartPrimitives';

export function addChartPoint() {
  if (appState.isChartEnabled && appState.isCurrentChartVisible) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy import to break circular dependency with scatterChartSpec
    const { addSpeedPoint, addCropPoint } = require('./scatterChartSpec');
    assertDefined(chartState.currentChartInput, 'currentChartInput must be defined');
    if (chartState.currentChartInput.type == 'speed') {
      addSpeedPoint.call(chartState.currentChartInput.chart, appState.video.getCurrentTime(), 1);
    } else if (chartState.currentChartInput.type == 'crop') {
      addCropPoint.call(chartState.currentChartInput.chart, appState.video.getCurrentTime());
    }
  }
}

export function stretchPointMap(_draft, pointMap, pointType, toTime, type) {
  const maxIndex = pointMap.length - 1;
  const [sectStart, sectEnd] = type === 'start' ? [0, 1] : [maxIndex - 1, maxIndex];
  const leftPoint = pointMap[sectStart];
  const rightPoint = pointMap[sectEnd];
  const targetPoint = type === 'start' ? leftPoint : rightPoint;

  const isSectionStatic = pointType === 'crop'
    ? cropStringsEqual(leftPoint.crop, rightPoint.crop)
    : leftPoint.y === rightPoint.y;

  if (isSectionStatic) {
    targetPoint.x = toTime;
  } else {
    const targetPointCopy = cloneDeep(targetPoint);
    targetPointCopy.x = toTime;
    type === 'start' ? pointMap.unshift(targetPointCopy) : pointMap.push(targetPointCopy);
  }

  return pointMap;
}
export function shrinkPointMap(draft, pointMap, pointType, toTime, type) {
  const maxIndex = pointMap.length - 1;
  const searchPoint = { x: toTime, y: 0, crop: '' };
  let [sectStart] = bsearch(pointMap, searchPoint, sortX);
  let sectEnd: number;
  if (sectStart <= 0) {
    sectStart = 0;
    sectEnd = 1;
  } else if (sectStart >= maxIndex) {
    sectStart = maxIndex - 1;
    sectEnd = maxIndex;
  } else {
    sectEnd = sectStart + 1;
  }

  const leftPoint = pointMap[sectStart];
  const rightPoint = pointMap[sectEnd];
  const targetPointIndex = type === 'start' ? sectStart : sectEnd;
  const targetPoint = pointMap[targetPointIndex];

  if (pointType === 'crop') {
    const toCropString = getInterpolatedCrop(leftPoint, rightPoint, toTime);
    const [x, y, w, h] = getCropComponents(targetPoint.crop);
    const toCrop = new Crop(
      x,
      y,
      w,
      h,
      appState.settings.cropResWidth,
      appState.settings.cropResHeight
    );
    toCrop.setCropStringSafe(toCropString, draft.enableZoomPan);
    targetPoint.crop = toCrop.cropString;
    setAspectRatioForAllPoints(toCrop.aspectRatio, pointMap, pointMap, targetPointIndex);
    if (type === 'start') draft.crop = toCrop.cropString;
  } else {
    const speed = getInterpolatedSpeed(leftPoint, rightPoint, toTime);
    targetPoint.y = speed;
    if (type === 'start') draft.speed = speed;
  }
  targetPoint.x = toTime;

  pointMap = pointMap.filter((point) => {
    const keepPoint = point === targetPoint || (type === 'start' ? point.x > toTime : point.x < toTime);
    return keepPoint;
  });

  return pointMap;
}
export function updateCharts(markerPair: MarkerPair, rerender = true) {
  const speedChart = chartState.speedChartInput.chart;
  if (speedChart) {
    assertDefined(speedChart.config.data, 'speedChart config data must be defined');
    assertDefined(speedChart.config.data.datasets, 'speedChart config datasets must be defined');
    speedChart.config.data.datasets[0].data = markerPair.speedMap;
    updateChartBounds(speedChart.config, markerPair.start, markerPair.end);
  }
  const cropChart = chartState.cropChartInput.chart;
  if (cropChart) {
    assertDefined(cropChart.config.data, 'cropChart config data must be defined');
    assertDefined(cropChart.config.data.datasets, 'cropChart config datasets must be defined');
    cropChart.config.data.datasets[0].data = markerPair.cropMap;
    updateChartBounds(cropChart.config, markerPair.start, markerPair.end);
  }
  if (rerender) rerenderCurrentChart();
}
export function rerenderCurrentChart() {
  if (appState.isCurrentChartVisible && chartState.currentChartInput?.chart) {
    chartState.currentChartInput.chart.update();
  }
}

