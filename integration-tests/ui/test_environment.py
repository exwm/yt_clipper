"""The timing tests' validity checks (harness/environment.py), without a browser."""

import pytest
from harness.environment import (
    InconclusiveEnvironment,
    check_real_display,
    missed_between,
    split_turns,
    turns_without_missed_refreshes,
)


@pytest.mark.parametrize("refresh_ms", [16.67, 16.4, 16.9])
def test_a_real_display_at_60_hz_is_valid(refresh_ms: float) -> None:
    check_real_display(refresh_ms)


# Asleep (a 17 ms sleep), just under the range, and a 120 Hz display.
@pytest.mark.parametrize("refresh_ms", [17.5, 16.3, 8.33])
def test_a_real_display_not_at_60_hz_is_inconclusive(refresh_ms: float) -> None:
    with pytest.raises(InconclusiveEnvironment):
        check_real_display(refresh_ms)


# Frames held at each refresh of a 10 ms display: two turns back to 60, after which the rows stop.
HELD = [60, 61, 62, 60, 61, 62, 60]
REFRESHED_AT = [0.0, 10, 20, 30, 40, 50, 60]


def test_each_turn_ends_with_the_next_turns_first_refresh() -> None:
    assert split_turns(HELD, REFRESHED_AT) == [
        ([60, 61, 62, 60], [0, 10, 20, 30]),
        ([60, 61, 62, 60], [30, 40, 50, 60]),
    ]


# The second turn's refresh at 40 is late by a whole refresh, so its gaps are 20 ms.
LATE_REFRESHED_AT = [0.0, 10, 20, 30, 50, 60, 70]


@pytest.mark.parametrize(
    ("refreshed_at", "missed", "kept_turn_starts"),
    [
        # A gap the display recorded no miss for is the page's own, and stays for the asserts.
        (LATE_REFRESHED_AT, 0, [0, 30]),
        (LATE_REFRESHED_AT, 1, [0]),
        # A miss outside the turns (the lead-in, the pause) drops nothing.
        (REFRESHED_AT, 1, [0, 30]),
    ],
    ids=["unrecorded gap", "recorded miss", "miss outside the turns"],
)
def test_a_turn_a_missed_refresh_fell_in_is_left_out(
    refreshed_at: list[float], missed: int, kept_turn_starts: list[float]
) -> None:
    turns = turns_without_missed_refreshes(
        split_turns(HELD, refreshed_at), 10, missed, fewest_turns=1
    )
    assert [turn_at[0] for _, turn_at in turns] == kept_turn_starts


def test_too_few_clean_turns_is_inconclusive() -> None:
    turns = split_turns(HELD, LATE_REFRESHED_AT)
    with pytest.raises(InconclusiveEnvironment, match="1 of 2 turns clean"):
        turns_without_missed_refreshes(turns, 10, 1, fewest_turns=2)


def test_only_misses_inside_the_window_count() -> None:
    assert missed_between([0.5, 1.0, 1.5, 2.5], 1.0, 2.0) == 2
