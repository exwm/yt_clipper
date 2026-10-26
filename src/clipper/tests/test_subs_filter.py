import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from clipper import clip_maker, ffmpeg_filter
from clipper.clipper_types import ClipperPaths, ClipperState

DEFAULT_SUBS_STYLE = "FontSize=12,PrimaryColour=&H32FFFFFF,SecondaryColour=&H32000000,MarginV=5"


def ffmpegWithSubtitles() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        return None
    filters = subprocess.run(
        [ffmpeg, "-hide_banner", "-filters"], capture_output=True, text=True, check=True
    ).stdout
    return ffmpeg if " subtitles " in filters else None


# Folder names a markers file name can give the clips folder. Windows allows no colon or backslash.
NAMES = [
    pytest.param("it's", id="an apostrophe"),
    pytest.param("z';drawbox;'", id="a quote closing the path, then another filter"),
    pytest.param("q,null,'", id="a comma"),
    pytest.param("x [a]; b", id="brackets and a semicolon"),
    pytest.param(
        "c:olon\\x",
        id="a colon and a backslash",
        marks=pytest.mark.skipif(sys.platform == "win32", reason="not a Windows file name"),
    ),
]


@pytest.mark.parametrize("name", NAMES)
def test_subtitles_burn_in_from_a_clips_folder_with_any_name(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    name: str,
) -> None:
    ffmpeg = ffmpegWithSubtitles()
    if ffmpeg is None:
        pytest.skip("needs an ffmpeg with the subtitles filter")
    subs = tmp_path / "subs.vtt"
    subs.write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    clipsPath = f"./webms/{name}"
    (tmp_path / "webms" / name / "subs").mkdir(parents=True)
    cs = ClipperState(clipper_paths=ClipperPaths(clipsPath=clipsPath))
    mps = {"subsFilePath": str(subs), "titleSuffix": name, "subsStyle": DEFAULT_SUBS_STYLE}

    subsFilter = ffmpeg_filter.getSubsFilter(cs, {"start": 0, "end": 1}, mps, 0)
    # The clipper splices the filter into a command string and splits it with shlex.
    filterArgs = shlex.split(clip_maker.ffplayFilterArg(cs, f"null{subsFilter}", "unused.txt"))

    run = subprocess.run(
        [ffmpeg, "-v", "error", "-f", "lavfi", "-i", "color=size=64x36:duration=1",
         *filterArgs, "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    assert run.returncode == 0, run.stderr
