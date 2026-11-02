import shutil
from pathlib import Path

import pytest

from clipper.tests.synthetic_media import CLIPS, SyntheticClip, makeSyntheticClip

TINY = "testsrc2=size=64x36:rate=10"


@pytest.fixture(scope="module")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    return path


@pytest.mark.parametrize(
    ("change", "made_again"),
    [
        ({}, False),
        ({"seconds": 2}, True),
        ({"source": "testsrc2=size=64x36:rate=12"}, True),
        ({"upload": "vp9-mid"}, True),
    ],
    ids=["same recipe", "other length", "other source", "other upload"],
)
def test_a_synthetic_clip_is_made_again_only_when_its_recipe_changes(
    ffmpeg: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    change: dict,
    made_again: bool,
) -> None:
    def make(source: str = TINY, upload: str = "vp9-low", seconds: float = 1) -> tuple[Path, Path]:
        monkeypatch.setitem(CLIPS, "tiny", SyntheticClip("tiny", source, upload))
        return makeSyntheticClip(ffmpeg, "tiny", tmp_path, seconds)

    first = make()
    stamps = [path.stat().st_mtime_ns for path in first]
    again = make(**change)
    assert (again[1] != first[1]) == made_again
    assert [path.stat().st_mtime_ns for path in first] == stamps
    assert not list(tmp_path.glob("partial-*"))
