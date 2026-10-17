from fractions import Fraction

import pytest

from clipper import dedupe


def markerPairSettings(**overrides: object) -> dict:
    mps = {
        "noDedupe": False,
        "dedupe": False,
        "minterpFPS": None,
        "r_frame_rate": Fraction(30000, 1001),
    }
    mps.update(overrides)
    return mps


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param({}, False, id="no interpolation"),
        pytest.param({"dedupe": True}, True, id="--remove-duplicate-frames"),
        pytest.param({"minterpFPS": 60}, True, id="interpolating a low fps source"),
        pytest.param(
            {"minterpFPS": 120, "r_frame_rate": Fraction(60)},
            False,
            id="interpolating a 60 fps source",
        ),
        pytest.param(
            {"minterpFPS": 60, "noDedupe": True}, False, id="--no-remove-duplicate-frames"
        ),
        pytest.param({"dedupe": True, "noDedupe": True}, False, id="no wins over remove"),
    ],
)
def test_when_duplicate_frames_are_removed(overrides: dict, expected: bool) -> None:
    assert dedupe.shouldRemoveDuplicateFrames(markerPairSettings(**overrides)) is expected
