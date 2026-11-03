import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from stab_eval import CONFIG, failures, findings, parseConfig, passKey

from clipper.vidstab_motions import SHAKE_TOLERANCE_PX

NONE = {"worse": False, "warn": False, "stall": False}


@pytest.mark.parametrize(
    ("found", "expected", "fail"),
    [
        (NONE, {}, []),
        ({**NONE, "worse": True}, {}, ["worse"]),
        ({**NONE, "worse": True}, {"worse": "a whip"}, []),
        # An expectation that stops holding fails, like a strict xfail
        (NONE, {"stall": "solver"}, ["stall expected but gone (solver)"]),
        ({**NONE, "warn": True, "stall": True}, {"stall": "solver"}, ["warn"]),
    ],
)
def test_a_finding_fails_unless_expected_and_an_expectation_fails_once_gone(
    found: dict[str, bool], expected: dict[str, str], fail: list[str]
) -> None:
    assert failures(found, expected) == fail


WIDTH = 640
# The shakier clip warning's absolute tolerance, as a share of the frame's width a frame
FLOOR = SHAKE_TOLERANCE_PX / WIDTH


@pytest.mark.parametrize(
    ("on", "off", "worse"),
    [
        (11 * FLOOR, 10 * FLOOR, False),
        (11.1 * FLOOR, 10 * FLOOR, True),
        # Twice 5.49's shake, but 5.49 left almost none: within the floor is noise
        (1.9 * FLOOR, 0.9 * FLOOR, False),
        (2.1 * FLOOR, 1.0 * FLOOR, True),
        (None, FLOOR, False),
        (FLOOR, None, False),
    ],
)
def test_worse_is_more_than_ten_percent_shakier_than_549_and_past_the_warnings_floor(
    on: float | None, off: float | None, worse: bool
) -> None:
    found = findings({"shake": on, "warn": None, "stalled": False}, {"shake": off}, WIDTH)
    assert found == {**NONE, "worse": worse}


def test_the_checked_in_config_parses_and_bad_entries_are_refused() -> None:
    parseConfig(CONFIG.read_text(encoding="utf-8"))
    for entry in ('kind = "shaky"', 'kind = "warn"'):  # an unknown kind; no reason
        with pytest.raises(ValueError, match="kind"):
            parseConfig(f'[[expected]]\ncase = "stab-x"\npreset = 1\n{entry}\n')
    twice = '[[expected]]\ncase = "stab-x"\npreset = 1\nkind = "warn"\nreason = "r"\n' * 2
    with pytest.raises(ValueError, match="twice"):
        parseConfig(twice)


def test_a_pass_key_changes_with_any_part_and_only_then() -> None:
    assert passKey("clip", 6, "filter") == passKey("clip", 6, "filter")
    assert passKey("clip", 6, "filter") != passKey("clip", 6, "filter2")
    # Parts are kept apart, so moving text between them changes the key
    assert passKey("ab", "c") != passKey("a", "bc")
