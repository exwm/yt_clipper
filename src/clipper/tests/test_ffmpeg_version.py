import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from clipper import ffmpeg_version
from clipper.clipper_types import argvPath


@pytest.mark.parametrize(
    ("returncode", "stderr", "option"),
    [
        pytest.param(0, b"", "-/filter:v", id="ffmpeg 7 and later"),
        pytest.param(
            1, b"Unrecognized option '/filter:v'.", "-filter_script:v", id="an ffmpeg before 7"
        ),
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
    cs = SimpleNamespace(
        clipper_paths=SimpleNamespace(clipsPath=str(tmp_path), ffplayPath="ffplay")
    )
    videoFilter = "null," * (length // 5)
    arg = clip_maker.ffplayFilterArg(cs, videoFilter, "vfilter-1-preview.txt")  # type: ignore[arg-type]
    filterFile = tmp_path / "temp" / "vfilter-1-preview.txt"
    assert arg == (f'-/vf "{filterFile}"' if fromFile else f'-vf "{videoFilter}"')
    assert filterFile.exists() == fromFile
    if fromFile:
        assert filterFile.read_text(encoding="utf-8") == videoFilter


@pytest.mark.parametrize(
    ("ffplayPath", "probed"),
    [
        pytest.param(
            r"'C:\Users\example\tools\ffplay.exe'",
            r"C:\Users\example\tools\ffmpeg.exe",
            id="the ffmpeg beside ffplay",
        ),
        pytest.param("ffplay", "ffmpeg", id="the ffmpeg on PATH for ffplay on PATH"),
    ],
)
def test_preview_asks_the_ffmpeg_from_ffplays_build(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    ffplayPath: str,
    probed: str,
) -> None:
    # With minterp enhancements, ffmpegPath is ffmpeg_ytc, another build than the bundled ffplay.
    from clipper import clip_maker

    asked: list[str] = []
    monkeypatch.setattr(clip_maker, "supportsOptionFiles", lambda path: asked.append(path) or False)
    paths = SimpleNamespace(
        clipsPath=str(tmp_path), ffmpegPath="'C:\\example\\ffmpeg_ytc.exe'", ffplayPath=ffplayPath
    )
    clip_maker.ffplayFilterArg(
        SimpleNamespace(clipper_paths=paths), "null," * 4000, "vfilter-1-preview.txt"
    )  # type: ignore[arg-type]
    assert [argvPath(path) for path in asked] == [probed]


VIDSTABDETECT_HELP_OPTIONS = """\
Filter vidstabdetect
  Extract relative transformations, pass 1 of 2 for stabilization (see vidstabtransform for pass 2).
    Inputs:
       #0: default (video)
    Outputs:
       #0: default (video)
vidstabdetect AVOptions:
   result            <string>     ..FV....... path to the file used to write the transforms (default "transforms.trf")
   shakiness         <int>        ..FV....... how shaky is the video and how quick is the camera? 1: little (fast) 10: very strong/quick (slow) (from 1 to 10) (default 5)
   accuracy          <int>        ..FV....... (>=shakiness) 1: low 15: high (slow) (from 1 to 15) (default 15)
   stepsize          <int>        ..FV....... region around minimum is scanned with 1 pixel resolution (from 1 to 32) (default 6)
   mincontrast       <double>     ..FV....... below this contrast a field is discarded (0-1) (from 0 to 1) (default 0.25)
   show              <int>        ..FV....... 0: draw nothing; 1,2: show fields and transforms (from 0 to 2) (default 0)
   tripod            <int>        ..FV....... virtual tripod mode (if >0): motion is compared to a reference reference frame (frame # is the value) (from 0 to INT_MAX) (default 0)
"""
# ffmpeg 9.0.2's, whose vid.stab writes text transforms
VIDSTABDETECT_HELP_FFMPEG_9 = (
    VIDSTABDETECT_HELP_OPTIONS
    + """\
   fileformat        <int>        ..FV....... transforms data file format (from 1 to 2) (default binary)
     ascii           1            ..FV....... ASCII text
     binary          2            ..FV....... binary
"""
)


@pytest.mark.parametrize(
    ("helpText", "writesText"),
    [
        pytest.param(VIDSTABDETECT_HELP_FFMPEG_9, True, id="ffmpeg 9"),
        # ffmpeg 6.x and some 7.x builds have a vid.stab from before fileformat
        pytest.param(VIDSTABDETECT_HELP_OPTIONS, False, id="an older vid.stab"),
        pytest.param("Unknown filter 'vidstabdetect'.\n", False, id="no vid.stab"),
    ],
)
def test_vidstab_text_transforms_follow_the_filters_options(
    monkeypatch: pytest.MonkeyPatch, helpText: str, writesText: bool
) -> None:
    def run(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, helpText, "")

    monkeypatch.setattr(ffmpeg_version.subprocess, "run", run)
    ffmpeg_version.vidstabWritesTextTransforms.cache_clear()
    try:
        assert ffmpeg_version.vidstabWritesTextTransforms("ffmpeg") == writesText
    finally:
        ffmpeg_version.vidstabWritesTextTransforms.cache_clear()


def test_the_ffmpeg_on_path_reads_option_files() -> None:
    # The probe itself, on a real ffmpeg: the tests and releases use 7 or later.
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg on PATH")
    ffmpeg_version.supportsOptionFiles.cache_clear()
    assert ffmpeg_version.supportsOptionFiles(ffmpeg)


def test_the_ffmpeg_on_path_writes_text_transforms() -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("needs ffmpeg on PATH")
    ffmpeg_version.vidstabWritesTextTransforms.cache_clear()
    assert ffmpeg_version.vidstabWritesTextTransforms(ffmpeg)
