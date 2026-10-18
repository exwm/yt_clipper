import math
import shutil
from pathlib import Path

import pytest

from clipper.tests import shaky_media
from clipper.tests.clip_character import asDict, measure
from clipper.tests.stabilization_metrics import grayFrames


@pytest.fixture(scope="session")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    return path


def test_every_clip_has_a_spec() -> None:
    assert shaky_media.TRAITS.keys() == shaky_media.CLIPS.keys()


@pytest.mark.parametrize("name", list(shaky_media.CLIPS))
def test_clip_has_the_character_it_stands_for(ffmpeg: str, tmp_path: Path, name: str) -> None:
    video = shaky_media.makeShakyClip(ffmpeg, name, tmp_path)
    character = asDict(measure(grayFrames(ffmpeg, video, (shaky_media.WIDTH, shaky_media.HEIGHT))))
    outside = {
        trait: round(character[trait], 3)
        for trait, (low, high) in shaky_media.traitRanges(name).items()
        if not math.isnan(character[trait]) and not low <= character[trait] <= high
    }
    assert not outside, f"{name} measures {outside}, outside {shaky_media.traitRanges(name)}"
