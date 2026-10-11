"""Given/When/Then steps in plain Python. A test reads as a list of step calls, and each step's name
is its label: `when_i_scroll_on_the_zoomed_bar` prints "When I scroll on the zoomed bar" as it runs,
and a failure inside it is annotated with that label.

Steps (and page setup) are also timed, so a run can list its slowest steps and keep the suite fast.
"""

import contextlib
import functools
import time
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


@dataclass(frozen=True)
class Timing:
    label: str
    seconds: float


# This test's step timings; the markup fixture clears them per test and hands them to the report.
TIMINGS: list[Timing] = []


@contextlib.contextmanager
def timed(label: str) -> Generator[None]:
    start = time.perf_counter()
    try:
        yield
    finally:
        TIMINGS.append(Timing(label, time.perf_counter() - start))


def step_label(name: str) -> str:
    """`when_i_scroll_on_the_zoomed_bar` -> "When I scroll on the zoomed bar"."""
    label = " ".join("I" if word == "i" else word for word in name.split("_"))
    return label[:1].upper() + label[1:]


def step(run: Callable[P, R]) -> Callable[P, R]:
    label = step_label(run.__name__)

    @functools.wraps(run)
    def run_step(*args: P.args, **kwargs: P.kwargs) -> R:
        print(f"  {label}")
        try:
            with timed(label):
                return run(*args, **kwargs)
        except Exception as error:
            error.add_note(f"in step: {label}")
            raise

    return run_step
