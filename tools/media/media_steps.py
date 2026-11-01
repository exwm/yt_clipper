"""Times the steps of a command, so a slow path shows in its output."""

import threading
import time
from collections import defaultdict
from collections.abc import Generator
from contextlib import contextmanager


class Steps:
    def __init__(self) -> None:
        self.seconds: dict[str, float] = defaultdict(float)
        self.counts: dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()

    @contextmanager
    def step(self, name: str) -> Generator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            with self._lock:
                self.seconds[name] += time.perf_counter() - start
                self.counts[name] += 1

    def report(self) -> str:
        """Slowest first. Steps run by parallel workers add up past the wall time."""
        ranked = sorted(self.seconds.items(), key=lambda item: -item[1])
        if not ranked:
            return "no timed steps"
        return "time by step: " + "; ".join(
            f"{name} {seconds:.1f} s ({self.counts[name]}x)" for name, seconds in ranked
        )
