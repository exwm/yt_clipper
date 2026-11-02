from pathlib import Path

import pytest
from look_sheet import build_sheet, shot_stem
from PIL import Image


@pytest.mark.parametrize("step", ["a~b", "", "a/b", "..", "a b"])
def test_a_look_step_that_would_break_the_shot_names_is_refused(step: str) -> None:
    with pytest.raises(ValueError, match="step"):
        shot_stem(step, "dark", 1)


def test_the_sheet_stacks_each_step_and_background_from_the_shot_names(tmp_path: Path) -> None:
    for step in ("before", "after-2.1"):
        for density in (1, 2):
            stem = shot_stem(step, "dark", density)
            Image.new("RGB", (8 * density, 4 * density)).save(tmp_path / f"{stem}~rest.png")
    sheet = Image.open(build_sheet(tmp_path))
    # Two rows of a label above two tiles: 1x shown 4x, 2x shown 2x, each 16 px tall
    assert sheet.size[1] == 2 * (18 + 16)
