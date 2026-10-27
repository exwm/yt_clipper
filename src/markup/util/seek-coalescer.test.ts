import { onExternalSeek, onSeekRequest, onSeekSettled, SeekDecision } from './seek-coalescer';

describe('onSeekRequest', () => {
  it('fires immediately when not seeking', () => {
    expect(onSeekRequest(5, 0, false)).toEqual({
      pending: null,
      effects: [{ type: 'fire', target: 5 }],
    });
  });

  it('pends and arms the timer while a seek is in flight', () => {
    expect(onSeekRequest(5, 0, true)).toEqual({ pending: 5, effects: [{ type: 'armTimer' }] });
  });

  it('no-ops when already at the target', () => {
    expect(onSeekRequest(5, 5, false)).toEqual({ pending: null, effects: [] });
  });
});

describe('onSeekSettled', () => {
  it('flushes the pending target once the seek has finished', () => {
    expect(onSeekSettled(5, 0, false)).toEqual({
      pending: null,
      effects: [{ type: 'fire', target: 5 }],
    });
  });

  it('keeps the pending and re-arms if another seek is still running', () => {
    expect(onSeekSettled(5, 0, true)).toEqual({ pending: 5, effects: [{ type: 'armTimer' }] });
  });

  it('no-ops with an empty slot or when already at the target', () => {
    expect(onSeekSettled(null, 0, false)).toEqual({ pending: null, effects: [] });
    expect(onSeekSettled(5, 5, false)).toEqual({ pending: null, effects: [] });
  });
});

describe('onExternalSeek', () => {
  it('drops any pending target', () => {
    expect(onExternalSeek()).toEqual({ pending: null, effects: [] });
  });
});

// A driver that threads the single pending slot through the decisions exactly like the util.ts shell,
// recording every seek the core asked the video to fire.
describe('coalescer scenarios', () => {
  function makeDriver() {
    let pending: number | null = null;
    const fired: number[] = [];
    const apply = (d: SeekDecision) => {
      pending = d.pending;
      for (const e of d.effects) if (e.type === 'fire') fired.push(e.target);
    };
    return {
      fired,
      request: (target: number, current: number, seeking: boolean) =>
        apply(onSeekRequest(target, current, seeking)),
      settled: (current: number, seeking: boolean) =>
        apply(onSeekSettled(pending, current, seeking)),
      // The stale timer settles the same way as 'seeked'.
      stale: (current: number, seeking: boolean) => apply(onSeekSettled(pending, current, seeking)),
      external: () => apply(onExternalSeek()),
    };
  }

  it('a fast drag lands on its final target after the in-flight seek settles', () => {
    const d = makeDriver();
    d.request(1, 0, false); // first request fires
    d.request(2, 0, true); // while seeking -> pend 2
    d.request(3, 0, true); // overwrite -> pend 3 (final drag position)
    d.settled(1, false); // the first seek finished; flush the latest pending
    expect(d.fired).toEqual([1, 3]);
  });

  it('recovers the final target when the timer fires after the seek already settled', () => {
    const d = makeDriver();
    d.request(1, 0, false);
    d.request(3, 0, true); // pend 3
    d.stale(0, false); // 'seeked' was missed but the seek has finished -> flush 3
    expect(d.fired).toEqual([1, 3]);
  });

  it('keeps the final target through a seek slower than the timer, until it finishes', () => {
    const d = makeDriver();
    d.request(1, 0, false);
    d.request(3, 0, true); // pend 3
    d.stale(1, true); // still seeking after a second, and after two
    d.stale(1, true);
    d.settled(1, false);
    expect(d.fired).toEqual([1, 3]);
  });

  it('drops the target of a seek that never ends at the next external seek or new source', () => {
    const d = makeDriver();
    d.request(1, 0, false);
    d.request(3, 0, true);
    d.stale(1, true);
    d.external(); // a new source ends the stuck seek without 'seeked'
    d.stale(0, false);
    expect(d.fired).toEqual([1]);
  });

  it('lets an external seek win over a pending target', () => {
    const d = makeDriver();
    d.request(1, 0, false);
    d.request(3, 0, true); // pend 3
    d.external(); // user grabbed the YT bar -> drop 3
    d.settled(9, false); // our seek finished elsewhere; nothing to flush
    expect(d.fired).toEqual([1]);
  });
});
