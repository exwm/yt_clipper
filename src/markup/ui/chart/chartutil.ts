import cloneDeep from 'lodash.clonedeep';
import { appState } from '../../appState';
import { cropStringsEqual, getCropComponents, setAspectRatioForAllPoints } from '../../crop-utils';
import { bsearch, getRounder } from '../../util/util';
import { chartState, getInterpolatedCrop, updateChartBounds } from '../../charts';
import { addSpeedPoint, addCropPoint } from './scatterChartSpec';
import { Crop } from '../../crop/crop';
import { getInterpolatedSpeed } from '../../speed';
import { MarkerPair } from '../../@types/yt_clipper';
export const sortX = (a, b) => {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  return 0;
};

export const lightgrey = (opacity: number) => `rgba(120, 120, 120, ${opacity})`;
export const medgrey = (opacity: number) => `rgba(90, 90, 90, ${opacity})`;
export const grey = (opacity: number) => `rgba(50, 50, 50, ${opacity})`;

export const cubicInOutTension = 0.6;

export const roundX = getRounder(0.01, 2);
export const roundY = getRounder(0.05, 2);

export let inputId: string = null as any;
export function setInputId(Id: string) {
  inputId = Id;
}
export function getInputUpdater(inputId) {
  return function (newValue?: string | number) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    if (input) {
      if (newValue != null) {
        input.value = newValue.toString();
      }
      // input.dispatchEvent(new Event('change'));
    } else {
      console.log(`Input with Id ${inputId} not found.`);
    }
  };
}
export function addChartPoint() {
  if (appState.isChartEnabled && appState.isCurrentChartVisible) {
    if (chartState.currentChartInput!.type == 'speed') {
      addSpeedPoint.call(chartState.currentChartInput!.chart, appState.video.getCurrentTime(), 1);
    } else if (chartState.currentChartInput!.type == 'crop') {
      addCropPoint.call(chartState.currentChartInput!.chart, appState.video.getCurrentTime());
    }
  }
}export function stretchPointMap(_draft, pointMap, pointType, toTime, type) {
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
  let [sectStart, sectEnd] = bsearch(pointMap, searchPoint, sortX);
  if (sectStart <= 0) {
    [sectStart, sectEnd] = [0, 1];
  } else if (sectStart >= maxIndex) {
    [sectStart, sectEnd] = [maxIndex - 1, maxIndex];
  } else {
    [sectStart, sectEnd] = [sectStart, sectStart + 1];
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
    speedChart.config.data!.datasets![0].data = markerPair.speedMap;
    updateChartBounds(speedChart.config, markerPair.start, markerPair.end);
  }
  const cropChart = chartState.cropChartInput.chart;
  if (cropChart) {
    cropChart.config.data!.datasets![0].data = markerPair.cropMap;
    updateChartBounds(cropChart.config, markerPair.start, markerPair.end);
  }
  if (rerender) rerenderCurrentChart();
}
export function rerenderCurrentChart() {
  if (appState.isCurrentChartVisible && chartState.currentChartInput && chartState.currentChartInput.chart) {
    chartState.currentChartInput.chart.update();
  }
}

