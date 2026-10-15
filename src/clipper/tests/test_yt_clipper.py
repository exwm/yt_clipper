import io
import json
import shlex
import subprocess
import sys
from pathlib import Path

import pytest

from clipper import argparser, updates, util, yt_clipper, ytdl
from clipper.clipper_types import ClipperPaths, ClipperState, argvPath
from clipper.yt_clipper import findVideo2x, setupClipperPaths
from clipper.ytc_logger import newRunLogFilePath


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


def test_redirected_output_can_print_box_drawing_characters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("stdout", "stderr"):
        monkeypatch.setattr(f"sys.{name}", io.TextIOWrapper(io.BytesIO(), encoding="cp1252"))

    yt_clipper.useUtf8Output()

    for stream in (sys.stdout, sys.stderr):
        stream.write("━━ Setup ━━")
        stream.flush()


@pytest.mark.parametrize(
    ("flag", "printed"),
    [("--print-versions", "tool versions"), ("--check-for-updates", "update result")],
)
def test_print_and_exit_flags_need_no_markers_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    flag: str,
    printed: str,
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", flag])
    monkeypatch.setattr(argparser, "getDepVersionsString", lambda _paths: "tool versions")
    monkeypatch.setattr(updates, "checkForUpdates", lambda: "update result")

    with pytest.raises(SystemExit) as exit_info:
        yt_clipper.main()

    assert exit_info.value.code == 0
    assert printed in capsys.readouterr().out


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


def test_main_stops_on_an_invalid_markers_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    example = Path(__file__).resolve().parents[2] / "schema" / "examples" / "kitchen-sink.json"
    markers = {**json.loads(example.read_text(encoding="utf-8")), "crf": "30 -y"}
    (tmp_path / "markers.json").write_text(json.dumps(markers), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", "--markers-json", "markers.json"])

    with pytest.raises(SystemExit) as exit_info:
        yt_clipper.main()

    assert exit_info.value.code == 1
    assert "crf: '30 -y' is not of type 'number'" in caplog.text
    # The logger is set up first, so the run's own log file records why it stopped.
    logs = list((tmp_path / "webms" / "markers" / "logs").glob("*.log"))
    assert len(logs) == 1
    assert "crf: '30 -y' is not of type 'number'" in logs[0].read_text(encoding="utf-8")


def test_each_run_gets_a_new_log_file(tmp_path: Path) -> None:
    cp = ClipperPaths(clipsPath=str(tmp_path / "webms" / "clips"))

    first = Path(newRunLogFilePath(cp))
    second = Path(newRunLogFilePath(cp))

    assert first.parent == second.parent == tmp_path / "webms" / "clips" / "logs"
    assert second != first
    assert first.is_file()
    assert second.is_file()


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
