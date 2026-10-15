from pathlib import Path
from typing import Any, Optional

import pytest

from clipper import clip_maker
from clipper.clipper_types import ClipperState


def test_merge_is_skipped_when_an_encode_gave_up(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clip = tmp_path / "clip-2.webm"
    clip.touch()
    pairs: list[dict[str, Any]] = [
        {"start": 0, "end": 1, "overrides": {}},
        {"start": 2, "end": 3, "overrides": {}},
    ]
    cs = ClipperState(
        settings={
            "markerPairs": pairs,
            "only": "",
            "except": "",
            "previewFormat": "none",
            "markerPairMergeList": "1-2",
        },
    )

    # The first encode gives up (e.g. ffmpeg fails before motion interpolation) and returns None.
    def fakeMakeClip(_cs: ClipperState, markerPairIndex: int) -> Optional[dict[str, Any]]:
        if markerPairIndex == 0:
            return None
        return {**pairs[1], "returncode": 0, "fileName": clip.name, "filePath": str(clip)}

    monkeypatch.setattr(clip_maker, "makeClip", fakeMakeClip)
    monkeypatch.setattr("builtins.input", lambda _prompt: "n")
    monkeypatch.setattr(
        clip_maker.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("merged without the failed clip"),
    )

    clip_maker.makeClips(cs)

    assert cs.settings["markerPairs"][0]["returncode"] == 1
    assert cs.settings["markerPairs"][0]["start"] == 0
