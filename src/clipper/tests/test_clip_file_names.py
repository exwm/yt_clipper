from pathlib import Path

import pytest

from clipper import clip_maker
from clipper.clipper_types import ClipperPaths, ClipperState


def clipFileName(
    tmp_path: Path,
    *,
    index: int = 0,
    overrides: dict | None = None,
    outputSuffix: str = "",
    outputDir: str | None = None,
    **settings: object,
) -> tuple[str, str]:
    """The name and path a marker pair's clip gets. The clip already exists, so naming is all
    getMarkerPairSettings does."""
    pairs: list[dict] = [{"start": 0, "end": 1, "overrides": {}} for _ in range(index + 1)]
    pairs[index]["overrides"] = overrides or {}
    cs = ClipperState(
        settings={
            "markerPairs": pairs,
            "titleSuffix": "video",
            "videoCodec": "vp9",
            "fastTrim": False,
            "inputVideo": "",
            "ext": "webm",
            "overwrite": False,
            "preview": False,
            **settings,
        },
        clipper_paths=ClipperPaths(clipsPath=str(tmp_path)),
    )
    for name in ("video-1.webm", "video-1.mp4", "video-2.mp4", "x-video-2.mp4", "video-1.mkv", "video-1.trial.mp4"):
        (tmp_path / name).touch()
    (tmp_path / "temp").mkdir(exist_ok=True)
    (tmp_path / "temp" / "video-1.webm").touch()
    mp, _ = clip_maker.getMarkerPairSettings(cs, index, skip=True, outputSuffix=outputSuffix, outputDir=outputDir and str(tmp_path / outputDir))
    return mp["fileName"], Path(mp["filePath"]).relative_to(tmp_path).as_posix()


@pytest.mark.parametrize(
    ("settings", "name", "path"),
    [
        ({"videoCodec": "vp9"}, "video-1.webm", "video-1.webm"),
        *[({"videoCodec": codec}, "video-1.mp4", "video-1.mp4") for codec in ("h264", "h264_nvenc", "h264_vulkan", "av1")],
        ({"videoCodec": "av1", "index": 1}, "video-2.mp4", "video-2.mp4"),
        ({"videoCodec": "av1", "index": 1, "overrides": {"titlePrefix": "x"}}, "x-video-2.mp4", "x-video-2.mp4"),
        ({"videoCodec": "av1", "fastTrim": True, "inputVideo": "source.mkv"}, "video-1.mkv", "video-1.mkv"),
        ({"videoCodec": "av1", "fastTrim": True, "ext": "webm"}, "video-1.webm", "video-1.webm"),
        ({"videoCodec": "av1", "outputSuffix": ".trial"}, "video-1.trial.mp4", "video-1.trial.mp4"),
        ({"videoCodec": "vp9", "outputDir": "temp"}, "video-1.webm", "temp/video-1.webm"),
    ],
)
def test_clip_file_name(tmp_path: Path, settings: dict, name: str, path: str) -> None:
    assert clipFileName(tmp_path, **settings) == (name, path)
