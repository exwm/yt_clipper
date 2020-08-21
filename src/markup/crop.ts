import { CropPoint } from './@types/yt_clipper';
import { clampNumber, getCropString } from './util';

export class Crop {
  private static minX = 0;
  private static minY = 0;
  private static _minW = 20;
  private static _minH = 20;
  public static shouldConstrainMinDimensions = true;
  public static get minW() {
    return Crop.shouldConstrainMinDimensions ? this._minW : 0;
  }
  public static get minH() {
    return Crop.shouldConstrainMinDimensions ? this._minH : 0;
  }
  public static set minW(minW: number) {
    Crop.minW = minW;
  }
  public static set minH(minH: number) {
    Crop.minH = minH;
  }
  private _history: string[] = [];
  private _defaultAspectRatio = 1;
  constructor(
    private _x: number,
    private _y: number,
    private _w: number,
    private _h: number,
    public maxW: number,
    public maxH: number // private _minW: number, // private _minH: number
  ) {
    this._x = Math.max(Crop.minX, _x);
    this._y = Math.max(Crop.minY, _y);
    // this._minW = Crop.minW;
    // this._minW = Crop.minW;
    this.maxW = Math.max(Crop.minW, maxW);
    this.maxH = Math.max(Crop.minH, maxH);
    this._w = clampNumber(_w, Crop.minW, this.maxW);
    this._h = clampNumber(_h, Crop.minH, this.maxH);
  }
  static fromCropString(cropString: string, cropRes: string) {
    const [x, y, w, h] = Crop.getCropComponents(cropString);
    const [maxW, maxH] = Crop.getMaxDimensions(cropRes);
    return new this(x, y, w, h, maxW, maxH);
  }

  public get cropString() {
    return this.cropComponents.join(':');
  }
  public set cropString(cropString: string) {
    [this._x, this._y, this._w, this._h] = Crop.getCropComponents(cropString);
  }
  public setCropStringSafe(cropString: string, shouldMaintainCropAspectRatio = false) {
    const [nx, ny, nw, nh] = Crop.getCropComponents(cropString);
    const isDrag = nw === this._w && nh === this._h;

    const maxX = isDrag ? this.maxW - this._w : this.maxW - Crop.minW;
    const maxY = isDrag ? this.maxH - this._h : this.maxH - Crop.minH;
    let cx = clampNumber(nx, Crop.minX, maxX);
    let cy = clampNumber(ny, Crop.minY, maxY);

    const maxW = this.maxW - cx;
    const maxH = this.maxH - cy;
    let cw = isDrag ? this._w : clampNumber(nw, Crop.minW, maxW);
    let ch = isDrag ? this._h : clampNumber(nh, Crop.minH, maxH);

    if (shouldMaintainCropAspectRatio) {
      const ar = this.aspectRatio;
      const ph = Math.floor(cw / ar);
      const pw = Math.floor(ch * ar);
      const phWithinBounds = Crop.minH <= ph && ph <= this.maxH;
      const pwWithinBounds = Crop.minW <= pw && pw <= this.maxW;

      if (!phWithinBounds && !pwWithinBounds) {
        throw new Error('Could not determine a valid aspect-ratio-constrained crop.');
      }

      if (phWithinBounds) {
        ch = ph;
      } else {
        cw = pw;
      }
    }

    this.cropString = getCropString(cx, cy, cw, ch);
  }
  // public set minW(minW: number) {
  //   this._minW = Math.max(minW, 0);
  // }
  // public set minH(minH: number) {
  //   this._minH = Math.max(minH, 0);
  // }
  // private get minW(minW: number) {
  //   this._minW = Math.max(minW, 0);
  // }
  // private get minH(minH: number) {
  //   this._minH = Math.max(minH, 0);
  // }

  public pushHistory(cropString?: string) {
    cropString = cropString ?? this.cropString;
    this._history.push(cropString);
  }

  public clearHistory() {
    this._history = [];
  }

  public popHistory() {
    const cropString = this._history.pop();
    if (cropString != null) this.cropString = cropString;
  }
  public applyPrevHistory() {
    if (this._history.length > 0) {
      const cropString = this._history[this._history.length - 1];
      if (cropString != null) this.cropString = cropString;
    }
  }
  static getCropComponents(cropString: string, cropRes?: string) {
    let maxW, maxH: number;
    if (cropRes != null) [maxW, maxH] = Crop.getMaxDimensions(cropRes);
    const cropArr = cropString.split(':').map((cropComponent) => {
      if (cropComponent === 'iw') return maxW;
      if (cropComponent === 'ih') return maxH;
      return parseInt(cropComponent, 10);
    });
    return cropArr;
  }
  static getMaxDimensions(cropRes: string) {
    const maxDimensions = cropRes.split('x').map((dim) => parseInt(dim, 10));
    return maxDimensions;
  }
  public get cropComponents() {
    return [this._x, this._y, this._w, this._h];
  }

  public get x() {
    return this._x;
  }

  public get y() {
    return this._y;
  }

  public get w() {
    return this._w;
  }

  public get h() {
    return this._h;
  }

  public get r() {
    return this._x + this._w;
  }

  public get b() {
    return this._y + this._h;
  }

  panX(delta: number) {
    delta = clampNumber(delta, -this._x, this.maxW - this.r);
    this._x += delta;
  }
  panY(delta: number) {
    delta = clampNumber(delta, -this._y, this.maxH - this.b);
    this._y += delta;
  }

  public set defaultAspectRatio(aspectRatio: number) {
    this._defaultAspectRatio = aspectRatio;
  }
  public get aspectRatio() {
    return this._w == 0 || this._h == 0 ? this._defaultAspectRatio : this._w / this._h;
  }

  public get minResizeS() {
    return -(this.b - (this._y + Crop.minH));
  }
  public get maxResizeS() {
    return this.maxH - this.b;
  }
  public get minResizeE() {
    return -(this.r - (this._x + Crop.minW));
  }
  public get maxResizeE() {
    return this.maxW - this.r;
  }
  public get minResizeN() {
    return -(this.b - Crop.minH - this._y);
  }
  public get maxResizeN() {
    return this._y;
  }

  public get minResizeW() {
    return -(this.r - Crop.minW - this._x);
  }
  public get maxResizeW() {
    return this._x;
  }

  public get cx() {
    return this._x + this._w / 2;
  }
  public get cy() {
    return this._y + this._h / 2;
  }

  clampResizeN(delta: number) {
    delta = clampNumber(delta, this.minResizeN, this.maxResizeN);
    return delta;
  }
  clampResizeE(delta: number) {
    delta = clampNumber(delta, this.minResizeE, this.maxResizeE);
    return delta;
  }
  clampResizeS(delta: number) {
    delta = clampNumber(delta, this.minResizeS, this.maxResizeS);
    return delta;
  }
  clampResizeW(delta: number) {
    delta = clampNumber(delta, this.minResizeW, this.maxResizeW);
    return delta;
  }

  resizeN(delta: number, shouldClamp = true) {
    delta = this.clampResizeN(delta);
    this._y -= delta;
    this._h += delta;
    return delta;
  }
  resizeW(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeW, this.maxResizeW);
    this._x -= delta;
    this._w += delta;
    return delta;
  }
  resizeS(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeS, this.maxResizeS);
    this._h += delta;
    return delta;
  }
  resizeE(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeE, this.maxResizeE);
    this._w += delta;
    return delta;
  }

  resizeNE(deltaY: number, deltaX: number) {
    this.resizeN(deltaY);
    this.resizeE(deltaX);
  }
  resizeSE(deltaY: number, deltaX: number) {
    this.resizeS(deltaY);
    this.resizeE(deltaX);
  }
  resizeSW(deltaY: number, deltaX: number) {
    this.resizeS(deltaY);
    this.resizeW(deltaX);
  }
  resizeNW(deltaY: number, deltaX: number) {
    this.resizeN(deltaY);
    this.resizeW(deltaX);
  }

  resizeNS(delta: number) {
    if (delta >= 0) {
      delta = this.clampResizeN(delta);
      delta = this.clampResizeS(delta);
    } else {
      delta = Math.max(delta, -(this.b - this.cy - Crop.minH / 2));
    }
    this.resizeN(delta, false);
    this.resizeS(delta, false);
  }

  resizeEW(delta: number) {
    if (delta >= 0) {
      delta = this.clampResizeE(delta);
      delta = this.clampResizeW(delta);
    } else {
      delta = Math.max(delta, -(this.r - this.cx - Crop.minW / 2));
    }
    this.resizeE(delta, false);
    this.resizeW(delta, false);
  }

  resizeNESW(deltaY: number, deltaX: number) {
    if (deltaY >= 0) {
      deltaY = this.clampResizeN(deltaY);
      deltaY = this.clampResizeS(deltaY);
    } else {
      deltaY = Math.max(deltaY, -(this.b - this.cy - Crop.minH / 2));
    }
    if (deltaX >= 0) {
      deltaX = this.clampResizeE(deltaX);
      deltaX = this.clampResizeW(deltaX);
    } else {
      deltaX = Math.max(deltaX, -(this.r - this.cx - Crop.minW / 2));
    }
    this.resizeN(deltaY, false);
    this.resizeS(deltaY, false);
    this.resizeE(deltaX, false);
    this.resizeW(deltaX, false);
  }

  resizeNAspectRatioLocked(delta: number) {
    const aspectRatio = this.aspectRatio;
    delta = this.clampResizeN(delta);
    delta *= aspectRatio;
    delta = Math.round(delta);
    delta = this.resizeE(delta);
    delta /= aspectRatio;
    delta = Math.round(delta);
    this.resizeN(delta);
  }
  resizeEAspectRatioLocked(delta: number) {
    const aspectRatio = this.aspectRatio;
    delta = this.clampResizeE(Math.round(delta));
    delta /= aspectRatio;
    delta = Math.round(delta);
    delta = this.resizeS(Math.round(delta));
    delta *= aspectRatio;
    delta = Math.round(delta);
    this.resizeE(delta);
  }
  resizeSAspectRatioLocked(delta: number) {
    const aspectRatio = this.aspectRatio;
    delta = this.clampResizeS(delta);
    delta *= aspectRatio;
    delta = Math.round(delta);
    delta = this.resizeE(delta);
    delta /= aspectRatio;
    delta = Math.round(delta);
    this.resizeS(delta);
  }
  resizeWAspectRatioLocked(delta: number) {
    const aspectRatio = this.aspectRatio;
    delta = this.clampResizeW(delta);
    delta /= aspectRatio;
    delta = Math.round(delta);
    delta = this.resizeS(delta);
    delta *= aspectRatio;
    delta = Math.round(delta);
    this.resizeW(delta);
  }
  public get aspectRatioPair() {
    const a = this.aspectRatio / (this.aspectRatio + 1);
    const b = 1 - a;
    return [a, b];
  }
  resizeSEAspectRatioLocked(deltaY: number, deltaX: number) {
    const [a, b] = this.aspectRatioPair;
    deltaX *= a;
    deltaY *= b;
    deltaY += deltaX / this.aspectRatio;
    deltaY = this.clampResizeS(deltaY);

    deltaX = deltaY * this.aspectRatio;
    deltaX = Math.round(deltaX);
    deltaX = this.clampResizeE(deltaX);
    deltaY = deltaX / this.aspectRatio;
    deltaY = Math.round(deltaY);
    deltaY = this.clampResizeS(deltaY);

    this.resizeS(deltaY, false);
    this.resizeE(deltaX, false);
  }

  resizeSWAspectRatioLocked(deltaY: number, deltaX: number) {
    const [a, b] = this.aspectRatioPair;
    deltaX *= a;
    deltaY *= b;
    deltaY += deltaX / this.aspectRatio;
    deltaY = this.clampResizeS(deltaY);

    deltaX = deltaY * this.aspectRatio;
    deltaX = Math.round(deltaX);
    deltaX = this.clampResizeW(deltaX);
    deltaY = deltaX / this.aspectRatio;
    deltaY = Math.round(deltaY);
    deltaY = this.clampResizeS(deltaY);

    this.resizeS(deltaY, false);
    this.resizeW(deltaX, false);
  }

  resizeNEAspectRatioLocked(deltaY: number, deltaX: number) {
    const [a, b] = this.aspectRatioPair;
    deltaX *= a;
    deltaY *= b;
    deltaY += deltaX / this.aspectRatio;
    deltaY = this.clampResizeN(deltaY);

    deltaX = deltaY * this.aspectRatio;
    deltaX = Math.round(deltaX);
    deltaX = this.clampResizeE(deltaX);
    deltaY = deltaX / this.aspectRatio;
    deltaY = Math.round(deltaY);
    deltaY = this.clampResizeN(deltaY);

    this.resizeN(deltaY, false);
    this.resizeE(deltaX, false);
  }
  resizeNWAspectRatioLocked(deltaY: number, deltaX: number) {
    const [a, b] = this.aspectRatioPair;
    deltaX *= a;
    deltaY *= b;
    deltaY += deltaX / this.aspectRatio;
    deltaY = this.clampResizeN(deltaY);

    deltaX = deltaY * this.aspectRatio;
    deltaX = Math.round(deltaX);
    deltaX = this.clampResizeW(deltaX);
    deltaY = deltaX / this.aspectRatio;
    deltaY = Math.round(deltaY);
    deltaY = this.clampResizeN(deltaY);

    this.resizeN(deltaY, false);
    this.resizeW(deltaX, false);
  }
  resizeNESWAspectRatioLocked(deltaY: number, deltaX: number) {
    const [a, b] = this.aspectRatioPair;
    let isExpand = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX >= 0 : deltaY >= 0;
    deltaX *= a;
    deltaY *= b;

    if (isExpand) {
      deltaY += deltaX / this.aspectRatio;
      deltaY = this.clampResizeN(deltaY);
      deltaY = this.clampResizeS(deltaY);

      deltaX = deltaY * this.aspectRatio;
      deltaX = Math.round(deltaX);
      deltaX = this.clampResizeE(deltaX);
      deltaX = this.clampResizeW(deltaX);
      deltaY = deltaX / this.aspectRatio;
      deltaY = Math.round(deltaY);
      deltaY = this.clampResizeN(deltaY);
      deltaY = this.clampResizeS(deltaY);
    } else {
      deltaY += deltaX / this.aspectRatio;
      deltaY = Math.max(deltaY, -(this.b - this.cy - Crop.minH / 2));

      deltaX = deltaY * this.aspectRatio;
      deltaX = Math.round(deltaX);
      deltaX = Math.max(deltaX, -(this.r - this.cx - Crop.minW / 2));
      deltaY = deltaX / this.aspectRatio;
      deltaY = Math.round(deltaY);
      deltaY = Math.max(deltaY, -(this.b - this.cy - Crop.minH / 2));
    }

    this.resizeN(deltaY, false);
    this.resizeE(deltaX, false);
    this.resizeS(deltaY, false);
    this.resizeW(deltaX, false);
  }
}

export function saveCropMapInitCrops(cropMap: CropPoint[]) {
  cropMap.forEach((cropPoint) => {
    cropPoint.initCrop = cropPoint.crop;
  });
}

export function deleteCropMapInitCrops(cropMap: CropPoint[]) {
  cropMap.forEach((cropPoint) => {
    delete cropPoint.initCrop;
  });
}

export function loadCropMapInitCrops(cropMap: CropPoint[]) {
  cropMap.forEach((cropPoint) => {
    cropPoint.crop = cropPoint.initCrop ?? cropPoint.crop;
  });
}

export function getCropSize(crop: string, cropRes: string) {
  const [, , w, h] = Crop.getCropComponents(crop, cropRes);
  const size = w * h;
  const aspectRatio = w / h;
  return { w, h, size, aspectRatio };
}
export function getMinMaxAvgCropPoint(cropMap: CropPoint[], cropRes: string) {
  const { aspectRatio } = getCropSize(cropMap[0].crop, cropRes);

  let [minSize, minSizeW, minSizeH] = [Infinity, Infinity, Infinity];
  let [maxSize, maxSizeW, maxSizeH] = [-Infinity, -Infinity, -Infinity];
  let [avgSize, avgSizeW, avgSizeH] = [0, 0, 0];
  cropMap.forEach((cropPoint, i) => {
    const { w, h, size } = getCropSize(cropPoint.crop, cropRes);
    if (size < minSize) {
      [minSizeW, minSizeH, minSize] = [w, h, size];
    }
    if (size > maxSize) {
      [maxSizeW, maxSizeH, maxSize] = [w, h, size];
    }
    avgSizeW += (w - avgSizeW) / (i + 1);
  });

  avgSizeH = Math.floor(avgSizeW / aspectRatio);
  avgSizeW = Math.floor(avgSizeW);
  avgSize = avgSizeW * avgSizeH;

  return { minSizeW, minSizeH, minSize, maxSizeW, maxSizeH, maxSize, avgSizeW, avgSizeH, avgSize };
}

export function isVariableSize(cropMap: CropPoint[], cropRes: string) {
  const { size } = getCropSize(cropMap[0].crop, cropRes);
  const isVariableSize = cropMap.some((cropPoint) => {
    return size !== getCropSize(cropPoint.crop, cropRes).size;
  });
  return isVariableSize;
}
