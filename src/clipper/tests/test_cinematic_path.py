import json
from pathlib import Path

import pytest

PARITY = json.loads((Path(__file__).parent / "fixtures" / "cinematic_path_parity.json").read_text(encoding="utf-8"))
# The markup and the clipper solve iteratively to the same tolerance, so they agree to a fraction of a
# pixel rather than bit for bit.
TOLERANCE_PX = 0.5


@pytest.mark.xfail(reason="the clipper does not solve the Cinematic crop path yet", strict=True)
@pytest.mark.parametrize("case", PARITY, ids=[case["name"] for case in PARITY])
def test_cinematic_path_matches_the_markup(case: dict) -> None:
    from clipper import cinematic_path

    path = cinematic_path.bakeCinematicPath(case["cropMap"], case["margins"], *case["cropRes"])
    assert path is not None
    for sample in case["samples"]:
        x, y, w, h = cinematic_path.evalCropPathAtTime(path, sample["t"])
        assert (x, y, w, h) == pytest.approx(
            (sample["x"], sample["y"], sample["w"], sample["h"]),
            abs=TOLERANCE_PX,
        ), f"at {sample['t']} s"
