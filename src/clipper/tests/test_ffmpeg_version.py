import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from clipper import ffmpeg_version


@pytest.mark.parametrize(
    ("returncode", "stderr", "option"),
    [
        pytest.param(0, b"", "-/filter:v", id="ffmpeg 7 and later"),
        pytest.param(1, b"Unrecognized option '/filter:v'.", "-filter_script:v", id="an ffmpeg before 7"),
        pytest.param(1, b"Permission denied", "-/filter:v", id="a failure that is not the option"),
    ],
)
def test_filter_file_option_follows_what_the_ffmpeg_accepts(
    monkeypatch: pytest.MonkeyPatch,
    returncode: int,
    stderr: bytes,
    option: str,
) -> None:
    # ffmpeg 9 removed -filter_script:v, and -/filter:v needs ffmpeg 7. Git builds print no version.
    def run(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess([], returncode, b"", stderr)

    monkeypatch.setattr(ffmpeg_version.subprocess, "run", run)
    ffmpeg_version.supportsOptionFiles.cache_clear()
    try:
        assert ffmpeg_version.filterFileOption("ffmpeg") == option
    finally:
        ffmpeg_version.supportsOptionFiles.cache_clear()


@pytest.mark.parametrize(
    ("length", "readsFiles", "fromFile"),
    [
        pytest.param(100, True, False, id="short filter: inline"),
        pytest.param(20_000, True, True, id="long filter: from a file"),
        pytest.param(20_000, False, False, id="long filter, ffplay before 7: inline, as before"),
    ],
)
def test_preview_reads_a_long_filter_from_a_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    length: int,
    readsFiles: bool,
    fromFile: bool,
) -> None:
    # Windows takes 32767 characters per command, and a zooming crop's filter passes that quickly.
    from clipper import clip_maker

    monkeypatch.setattr(clip_maker, "supportsOptionFiles", lambda _path: readsFiles)
    cs = SimpleNamespace(clipper_paths=SimpleNamespace(clipsPath=str(tmp_path), ffmpegPath="ffmpeg"))
    videoFilter = "null," * (length // 5)
    arg = clip_maker.ffplayFilterArg(cs, videoFilter, "vfilter-1-preview.txt")  # type: ignore[arg-type]
    filterFile = tmp_path / "temp" / "vfilter-1-preview.txt"
    assert arg == (f'-/vf "{filterFile}"' if fromFile else f'-vf "{videoFilter}"')
    assert filterFile.exists() == fromFile
    if fromFile:
        assert filterFile.read_text(encoding="utf-8") == videoFilter


def test_the_ffmpeg_on_path_reads_option_files() -> None:
    # The probe itself, on a real ffmpeg: the tests and releases use 7 or later.
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg on PATH")
    ffmpeg_version.supportsOptionFiles.cache_clear()
    assert ffmpeg_version.supportsOptionFiles(ffmpeg)
