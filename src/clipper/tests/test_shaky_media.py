import math
import os
import shutil
import time
from pathlib import Path

import pytest

from clipper.tests import shaky_media
from clipper.tests.clip_character import asDict, fieldConsensus, measure
from clipper.tests.stabilization_metrics import grayFrames


@pytest.fixture(scope="session")
def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if path is None:
        pytest.skip("needs ffmpeg")
    return path


def test_every_clip_has_a_spec() -> None:
    assert shaky_media.TRAITS.keys() == shaky_media.CLIPS.keys()


def test_the_clip_cache_removes_other_versions_unused_for_a_week(
    ffmpeg: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(shaky_media.tempfile, "gettempdir", lambda: str(tmp_path))
    root = tmp_path / "yt_clipper-shaky-media"
    stale, recent = root / "stale", root / "recent"
    for folder in (stale, recent):
        folder.mkdir(parents=True)
    old = time.time() - shaky_media.UNUSED_FOLDER_SECONDS - 60
    os.utime(stale, (old, old))
    current = shaky_media.mediaFolder(ffmpeg)
    assert sorted(p.name for p in root.iterdir()) == sorted([current.name, "recent"])


@pytest.mark.parametrize("name", list(shaky_media.CLIPS))
def test_clip_has_the_character_it_stands_for(ffmpeg: str, name: str) -> None:
    video = shaky_media.makeShakyClip(ffmpeg, name, shaky_media.mediaFolder(ffmpeg))
    character = asDict(measure(grayFrames(ffmpeg, video, (shaky_media.WIDTH, shaky_media.HEIGHT))))
    character["field_consensus"] = fieldConsensus(ffmpeg, video)
    outside = {
        trait: round(character[trait], 3)
        for trait, (low, high) in shaky_media.traitRanges(name).items()
        if not math.isnan(character[trait]) and not low <= character[trait] <= high
    }
    assert not outside, f"{name} measures {outside}, outside {shaky_media.traitRanges(name)}"
