// Pure classification and strength metric for a crop chart "section": the span between two
// consecutive crop points. The crop chart plugin (cropChartSpec.ts) uses this to color and weight
// each connecting segment, so it stays dependency-free and unit-testable.
import {
  cropSectionPanRgb,
  cropSectionPanZoomRgb,
  cropSectionStaticRgb,
  cropSectionZoomRgb,
} from '../chartPrimitives';

export type CropSectionType = 'static' | 'pan' | 'zoom' | 'panzoom';

export interface CropSectionInfo {
  type: CropSectionType;
  // Crop change as a fraction of the crop resolution per second: how fast the move reads to a viewer.
  velocity: number;
  // Crop size (sqrt of the area fraction) at each endpoint, i.e. the zoom level. Drives the band
  // width so it tapers toward the more zoomed-in (smaller) end.
  leftSize: number;
  rightSize: number;
  // The pan of the crop center from the left point to the right point, as a fraction of the crop
  // resolution (screen axes: +x right, +y down). Used to draw a direction arrowhead at the point.
  panX: number;
  panY: number;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

// A change whose center moves less than this fraction of the frame reads as a pure zoom rather than
// pan+zoom: it absorbs the half-pixel center rounding of integer x/y/w/h and the small center drift
// of a mousewheel zoom.
const POSITION_TOLERANCE = 0.03;

// A crop component is either a pixel number or a literal ffmpeg token (iw/ih) meaning the full crop
// resolution. Resolving it here (rather than importing getCropComponents, which reads appState) keeps
// this module dependency-free; the resolution is already threaded through as a parameter.
function resolveCropComponent(token: string, cropResWidth: number, cropResHeight: number): number {
  if (token === 'iw') return cropResWidth;
  if (token === 'ih') return cropResHeight;
  return Number(token);
}

export function getCropSectionInfo(
  leftCrop: string,
  rightCrop: string,
  leftTime: number,
  rightTime: number,
  cropResWidth: number,
  cropResHeight: number
): CropSectionInfo {
  const resolve = (token: string) => resolveCropComponent(token, cropResWidth, cropResHeight);
  const [lx, ly, lw, lh] = leftCrop.split(':').map(resolve);
  const [rx, ry, rw, rh] = rightCrop.split(':').map(resolve);

  // Pan is the movement of the crop CENTER, not the top-left corner: with x:y:w:h a centered zoom
  // moves the corner inward as w/h shrink, so comparing corners would mislabel a pure zoom as
  // pan+zoom. Everything is normalized by the crop resolution so position and size are comparable.
  const panX = (rx + rw / 2 - (lx + lw / 2)) / cropResWidth;
  const panY = (ry + rh / 2 - (ly + lh / 2)) / cropResHeight;
  const positionMagnitude = Math.hypot(panX, panY);
  const sizeMagnitude = Math.hypot((rw - lw) / cropResWidth, (rh - lh) / cropResHeight);

  const positionChanged = positionMagnitude > POSITION_TOLERANCE;
  const sizeChanged = rw !== lw || rh !== lh;

  let type: CropSectionType = 'static';
  if (sizeChanged && positionChanged) {
    type = 'panzoom';
  } else if (sizeChanged) {
    type = 'zoom';
  } else if (positionChanged) {
    type = 'pan';
  }

  const change = positionMagnitude + sizeMagnitude;
  const duration = rightTime - leftTime;
  const velocity = duration > 0 ? change / duration : 0;

  const area = cropResWidth * cropResHeight || 1;
  const leftSize = Math.sqrt((lw * lh) / area);
  const rightSize = Math.sqrt((rw * rh) / area);

  return { type, velocity, leftSize, rightSize, panX, panY };
}

const SECTION_GREY: readonly [number, number, number] = [120, 120, 120];
// The pan/zoom speed at which a section reaches its full color and opacity.
const FULL_COLOR_VELOCITY = 0.6;
// The faint grey "no movement" reference line for static sections.
const STATIC_OPACITY = 0.25;
// The opacity at the slow end of a moving section's speed ramp.
const MIN_OPACITY = 0.4;
// The least a moving section is tinted toward its type color: even a slow pan/zoom keeps some hue
// rather than fading all the way to grey.
const MIN_COLOR_MIX = 0.35;

function sectionBaseRgb(type: CropSectionType): readonly [number, number, number] {
  switch (type) {
    case 'pan':
      return cropSectionPanRgb;
    case 'zoom':
      return cropSectionZoomRgb;
    case 'panzoom':
      return cropSectionPanZoomRgb;
    default:
      return cropSectionStaticRgb;
  }
}

// Speed is carried by color and opacity, not width: a faster section reads as its full type color and
// opaque, a slower one fades toward the static grey and toward transparent, so a slow move blends into
// the "no movement" line. Static is the reference grey line and stays a steady grey.
export function cropSectionColor(type: CropSectionType, velocity: number): string {
  if (type === 'static') return `rgba(120, 120, 120, ${STATIC_OPACITY})`;
  const t = clamp(velocity / FULL_COLOR_VELOCITY, 0, 1);
  const colorMix = MIN_COLOR_MIX + t * (1 - MIN_COLOR_MIX);
  const [br, bg, bb] = sectionBaseRgb(type);
  const r = Math.round(SECTION_GREY[0] + colorMix * (br - SECTION_GREY[0]));
  const g = Math.round(SECTION_GREY[1] + colorMix * (bg - SECTION_GREY[1]));
  const b = Math.round(SECTION_GREY[2] + colorMix * (bb - SECTION_GREY[2]));
  const opacity = MIN_OPACITY + t * (1 - MIN_OPACITY);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const MIN_LINE_WIDTH = 2;
const MAX_LINE_WIDTH = 12;

// The band width at a point, from the crop's zoom level (its size as a fraction of the frame): wider
// when zoomed out, narrower when zoomed in. It is a property of the POINT, not the section, so two
// adjacent sections share the exact width at their common point and the band tapers smoothly with no
// kinks. A pan (constant size) keeps a constant width; only a zoom tapers.
export function cropZoomWidth(cropSize: number): number {
  return MIN_LINE_WIDTH + clamp(cropSize, 0, 1) * (MAX_LINE_WIDTH - MIN_LINE_WIDTH);
}
