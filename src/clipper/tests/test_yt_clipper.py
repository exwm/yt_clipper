import shlex
import subprocess
from pathlib import Path

import pytest

from clipper import argparser, util, yt_clipper, ytdl
from clipper.clipper_types import ClipperState, argvPath
from clipper.yt_clipper import findVideo2x, setupClipperPaths


@pytest.mark.parametrize(
    ("test_input", "expected"),
    [
        pytest.param("", "", id="empty string"),
        ("non-empty", "non-empty"),
        ("'squoted'", r"'\''squoted'\''"),
    ],
)
def test_escapeSingleQuotesFFmpeg(test_input: str, expected: str) -> None:
    assert expected == util.escapeSingleQuotesFFmpeg(test_input)


@pytest.mark.parametrize(
    ("installed", "expected"),
    [
        pytest.param(
            ["video-tools", "video2x"],
            "./bin/video-tools/video2x.exe",
            id="bundled wins",
        ),
        pytest.param(["video2x"], "./bin/video2x/video2x.exe", id="manual install"),
        pytest.param([], "video2x", id="system PATH"),
    ],
)
def test_findVideo2x(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    installed: list[str],
    expected: str,
) -> None:
    for video2x_dir in installed:
        (tmp_path / "bin" / video2x_dir).mkdir(parents=True)
        (tmp_path / "bin" / video2x_dir / "video2x.exe").touch()
    monkeypatch.chdir(tmp_path)
    assert findVideo2x(".exe") == expected


def test_print_versions_needs_no_markers_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", "--print-versions"])
    monkeypatch.setattr(argparser, "getDepVersionsString", lambda _paths: "tool versions")

    with pytest.raises(SystemExit) as exit_info:
        yt_clipper.main()

    assert exit_info.value.code == 0
    assert "tool versions" in capsys.readouterr().out


@pytest.mark.parametrize(
    "path",
    [
        "./bin/yt-dlp/yt-dlp.exe",
        "D:\\Tools\\yt-dlp.exe",
        "D:\\My Tools\\yt-dlp.exe",
        "/home/me/it's here/yt-dlp",
    ],
)
def test_argv_path_undoes_the_shell_quoting(path: str) -> None:
    assert argvPath(shlex.quote(path)) == path


def test_tool_dirs_reach_list_form_calls_unquoted(monkeypatch: pytest.MonkeyPatch) -> None:
    cs = ClipperState()
    setupClipperPaths(cs, {"ytdlDir": "D:\\My Tools\\bin"})
    calls: list[list[str]] = []

    def fakeRun(args: list[str], **_kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout=b"2026.08.19")

    monkeypatch.setattr(ytdl.subprocess, "run", fakeRun)

    assert ytdl.ytdl_bin_get_version(cs.clipper_paths) == "2026.08.19"
    assert calls[0][0].startswith("D:\\My Tools\\bin/yt-dlp")


CLI_TOOL_DIRS = {"ffmpegToolsDir": "cli-tools", "ytdlDir": "cli-ytdl"}


@pytest.mark.parametrize(
    ("frozen", "cli_args", "ffmpeg_prefix", "ytdl_prefix"),
    [
        pytest.param(False, CLI_TOOL_DIRS, "cli-tools/ffmpeg", "cli-ytdl/yt-dlp", id="cli args"),
        pytest.param(
            True,
            CLI_TOOL_DIRS,
            "cli-tools/ffmpeg",
            "cli-ytdl/yt-dlp",
            id="frozen cli args",
        ),
        pytest.param(False, {}, "ffmpeg", "yt-dlp", id="system PATH"),
        pytest.param(
            True,
            {},
            "./bin/video-tools/ffmpeg",
            "./bin/yt-dlp/yt-dlp",
            id="frozen release layout",
        ),
    ],
)
def test_tool_dirs_come_from_cli_args_not_settings(
    monkeypatch: pytest.MonkeyPatch,
    frozen: bool,
    cli_args: dict[str, str],
    ffmpeg_prefix: str,
    ytdl_prefix: str,
) -> None:
    monkeypatch.setattr("sys.frozen", frozen, raising=False)
    cs = ClipperState(settings={"ffmpegToolsDir": "settings-tools", "ytdlDir": "settings-ytdl"})
    setupClipperPaths(cs, cli_args)
    assert cs.clipper_paths.ffmpegPath.startswith(ffmpeg_prefix)
    assert cs.clipper_paths.ytdlPath.startswith(ytdl_prefix)
