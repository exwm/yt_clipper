import { clampNumber } from './util';

export class Crop {
  private static minX = 0;
  private static minY = 0;
  private static minW = 20;
  private static minH = 20;
  private _history: string[] = [];
  constructor(
    private _x: number,
    private _y: number,
    private _w: number,
    private _h: number,
    public maxW: number,
    public maxH: number
  ) {
    this._x = Math.max(Crop.minX, _x);
    this._y = Math.max(Crop.minY, _y);
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
  static getCropComponents(cropString: string) {
    const cropArr = cropString
      .split(':')
      .map((cropComponent) => parseInt(cropComponent, 10));
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

  public get aspectRatio() {
    return this._w / this._h;
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
    console.log('delta n: ', delta);
    this._y -= delta;
    this._h += delta;
    return delta;
  }
  resizeW(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeW, this.maxResizeW);
    console.log('delta w: ', delta);
    this._x -= delta;
    this._w += delta;
    return delta;
  }
  resizeS(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeS, this.maxResizeS);
    console.log('delta s: ', delta);
    this._h += delta;
    return delta;
  }
  resizeE(delta: number, shouldClamp = true) {
    if (shouldClamp) delta = clampNumber(delta, this.minResizeE, this.maxResizeE);
    console.log('delta e: ', delta);
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
    console.log('delta ns: ', delta);
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
    console.log('delta ew: ', delta);
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
    console.log('delta nesw: ', deltaX, deltaY);
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
    deltaX *= a;
    deltaY *= b;
    let isExpand = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX >= 0 : deltaY >= 0;

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
