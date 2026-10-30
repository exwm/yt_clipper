"""Validity checks for timing tests: a measured window the machine spoiled (displays asleep, a
simulated refresh never sent) makes the run inconclusive, which `just ui-test` reruns, rather than
a failure of the markup. Never use them to excuse what the markup itself did."""

# A real display runs at 60 Hz, as the timing tests expect. Asleep, Windows times Chrome's frames with a
# 17 ms sleep (about 57 Hz, see `displays_stay_on` in conftest.py).
REAL_DISPLAY_HZ = 60
REAL_REFRESH_MS = (16.4, 16.9)
# Slower than the 17 ms sleep, the page itself missed refreshes (a frame callback too slow).
ASLEEP_REFRESH_MS = 17.6
# A gap this many refreshes long holds a refresh the simulated display never sent.
MISSED_REFRESH_GAP = 1.5


class InconclusiveEnvironment(Exception):
    """The machine, not the markup, spoiled the window a timing test measured."""


def check_page_kept_up(refresh_ms: float) -> None:
    """Fails a measured window whose frames ran slower than a sleeping display's. Only where the
    markup works each frame: the setup check measures an idle page, where only the machine is slow."""
    assert refresh_ms <= ASLEEP_REFRESH_MS, (
        f"frames ran every {refresh_ms:.2f} ms: the page missed refreshes"
    )


def check_real_display(refresh_ms: float) -> None:
    low, high = REAL_REFRESH_MS
    if not low <= refresh_ms <= high:
        raise InconclusiveEnvironment(
            f"frames ran every {refresh_ms:.2f} ms, not {1000 / REAL_DISPLAY_HZ:.2f} ({REAL_DISPLAY_HZ} Hz):"
            " the displays may be asleep"
        )


def split_turns(held: list[int], refreshed_at: list[float]) -> list[tuple[list[int], list[float]]]:
    """The rows of each turn of a loop up to its last turn back, split where the frame held goes
    back. Each turn ends with the next one's first refresh, so the run of its end frame is closed."""
    starts = [0] + [i for i in range(1, len(held)) if held[i] < held[i - 1]]
    return [
        (held[start : end + 1], refreshed_at[start : end + 1])
        for start, end in zip(starts, starts[1:])
    ]


def turns_without_missed_refreshes(
    turns: list[tuple[list[int], list[float]]],
    refresh_ms: float,
    missed_in_window: int,
    fewest_turns: int,
) -> list[tuple[list[int], list[float]]]:
    """The turns no missed simulated refresh fell in, when the display missed `missed_in_window`
    refreshes while the test measured: ones its driver woke too late to send, never ones the page's
    late refreshes skipped. A gap between refreshes places a miss, so in a window with no miss a gap
    the page made itself stays in."""
    if not missed_in_window:
        return turns
    clean = [
        turn
        for turn in turns
        if all(b - a < MISSED_REFRESH_GAP * refresh_ms for a, b in zip(turn[1], turn[1][1:]))
    ]
    if len(clean) < fewest_turns:
        raise InconclusiveEnvironment(
            f"the simulated display missed {missed_in_window} refreshes while the loop played,"
            f" leaving {len(clean)} of {len(turns)} turns clean, under {fewest_turns}"
        )
    return clean


def missed_between(missed_at: list[float], start: float, end: float) -> int:
    """How many missed refreshes, by their `time.perf_counter` due time, fell in [start, end]."""
    return sum(1 for due in missed_at if start <= due <= end)
