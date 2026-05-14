"""Per-stage wall-clock timing for run-end "where did the time go".

Operators want to see how a run's time was distributed:

    timing summary:
      pair 1 / crf search   47.2s  (23.0%)
      pair 1 / encode       18.6s  ( 9.1%)
      pair 1 / v2x          62.3s  (30.4%)
      pair 2 / crf search   41.0s  (20.0%)
      pair 2 / encode       17.3s  ( 8.4%)
      pair 2 / v2x          18.5s  ( 9.0%)
      total                205.0s

Without this, the only timing in logs is the per-CRF-search wall
time inside ``search_seconds`` — there's no "stage X took Y" view
across the whole run.

Usage::

    from clipper.log_helpers import time_stage

    with time_stage(f"pair {N} / crf search"):
        run_crf_search_for_marker_pair(...)

The context manager records elapsed time on exit, appending to a
module-level singleton ``StageTimer``. Render the summary at run
end via ``render_timing_summary()``.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Generator


class StageTimer:
    """Accumulates ``(stage_name, elapsed_seconds)`` records for a run.

    Stages are kept in insertion (chronological) order. The same
    name appearing twice produces two records — the renderer can
    show both or group as the caller prefers.
    """

    __slots__ = ("_records",)

    def __init__(self) -> None:
        self._records: list[tuple[str, float]] = []

    @contextmanager
    def stage(self, name: str) -> Generator[None, None, None]:
        """Time a block of code as a named stage."""
        start = time.monotonic()
        try:
            yield
        finally:
            self._records.append((name, time.monotonic() - start))

    def records(self) -> list[tuple[str, float]]:
        return list(self._records)

    def total_seconds(self) -> float:
        return sum(elapsed for _, elapsed in self._records)

    def reset(self) -> None:
        self._records.clear()


_GLOBAL_TIMER = StageTimer()


def get_timer() -> StageTimer:
    """Module-level singleton. One timer per run; pytest fixtures
    can call ``get_timer().reset()`` between tests."""
    return _GLOBAL_TIMER


@contextmanager
def time_stage(name: str) -> Generator[None, None, None]:
    """Context manager that times its block and records the elapsed
    seconds on the global timer."""
    with _GLOBAL_TIMER.stage(name):
        yield


def render_timing_summary() -> str:
    """Render the global timer as a multi-line ``key  value`` block.

    Returns the empty string when no stages were recorded so the
    caller can skip emitting an empty section.
    """
    records = _GLOBAL_TIMER.records()
    if not records:
        return ""
    name_width = max(len(name) for name, _ in records)
    name_width = max(name_width, len("total"))
    total = _GLOBAL_TIMER.total_seconds()
    lines: list[str] = ["timing summary (sum of recorded stages):"]
    for name, elapsed in records:
        pct = elapsed / total * 100.0 if total > 0 else 0.0
        lines.append(f"  {name:<{name_width}}  {elapsed:>7.1f}s  ({pct:>4.1f}%)")
    lines.append(f"  {'total':<{name_width}}  {total:>7.1f}s")
    return "\n".join(lines)
