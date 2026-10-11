/** Handle only the latest of the values scheduled within one animation frame. Pointer events fire at
 *  100-250 Hz, so handling each one re-renders and seeks several times per frame and the result
 *  visibly lags the cursor. */
export interface FrameCoalescer<T> {
  schedule(value: T): void;
  /** Handle the pending value now, so a release does not drop the last position. */
  flush(): void;
  /** Drop the pending value. */
  cancel(): void;
}

export function coalescePerAnimationFrame<T>(handle: (value: T) => void): FrameCoalescer<T> {
  let frameId = 0;
  let pending: { value: T } | null = null;
  const run = (): void => {
    frameId = 0;
    const latest = pending;
    pending = null;
    if (latest) handle(latest.value);
  };
  const cancelFrame = (): void => {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  };
  return {
    schedule(value) {
      pending = { value };
      if (!frameId) frameId = requestAnimationFrame(run);
    },
    flush() {
      cancelFrame();
      run();
    },
    cancel() {
      cancelFrame();
      pending = null;
    },
  };
}
