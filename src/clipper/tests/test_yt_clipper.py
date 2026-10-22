import io
import json
import shlex
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

from clipper import argparser, clip_maker, updates, util, yt_clipper, ytc_settings, ytdl
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


def failingTool() -> list[str]:
    raise subprocess.CalledProcessError(1, ["./bin/yt-dlp/yt-dlp.exe", "--dump-json", "URL"])


def unexpectedError() -> list[str]:
    raise RuntimeError("a bug")


def missingTool() -> list[str]:
    raise FileNotFoundError(2, "The system cannot find the file specified", "./bin/yt-dlp/yt-dlp.exe")


def missingProgramOnWindows() -> list[str]:
    # Windows' subprocess names no file when a program cannot start.
    raise FileNotFoundError(2, "The system cannot find the file specified", None, 2)


# Python sets OSError.winerror only on Windows.
ONLY_ON_WINDOWS = pytest.mark.skipif(sys.platform != "win32", reason="Windows error codes")


def notAProgramOnWindows() -> list[str]:
    # A file that is not a program (or a damaged one) also names no file, and its message has a %1.
    raise OSError(8, "This version of %1 is not compatible with the version of Windows", None, 216)


def fullDisk() -> list[str]:
    # A write that fails names no file either, but no program is missing.
    raise OSError(28, "No space left on device")


def noAnswer() -> list[str]:
    # input() at the end of input, as in a scheduled run.
    raise EOFError


@pytest.mark.parametrize(
    ("makeClips", "exitCode", "logged"),
    [
        pytest.param(lambda: [], None, "", id="all clips made"),
        pytest.param(
            lambda: ["marker pair 2", "merge 1-3"],
            1,
            "Failed to generate: marker pair 2, merge 1-3.",
            id="a clip failed",
        ),
        pytest.param(
            failingTool,
            1,
            "yt-dlp.exe failed with exit code 1. See its messages above.",
            id="a tool failed",
        ),
        pytest.param(
            unexpectedError,
            1,
            "Unexpected error. Please report it with this run's log file.",
            id="an unexpected error",
        ),
        pytest.param(
            missingTool,
            1,
            "yt-dlp.exe: The system cannot find the file specified. Check that it is in the bin folder.",
            id="a missing tool",
        ),
        pytest.param(
            missingProgramOnWindows,
            1,
            "Check that ffmpeg, ffprobe and yt-dlp are in the bin folder.",
            id="a program that cannot start on Windows",
            marks=ONLY_ON_WINDOWS,
        ),
        pytest.param(
            notAProgramOnWindows,
            1,
            "could not start: This version of the program is not compatible with the version of Windows. "
            "Check that ffmpeg, ffprobe and yt-dlp are in the bin folder.",
            id="a file that is not a program on Windows",
            marks=ONLY_ON_WINDOWS,
        ),
        pytest.param(fullDisk, 1, "No space left on device.", id="a full disk"),
        pytest.param(noAnswer, 1, "No answer to the prompt above, so the clipper script stopped.", id="a prompt with no answer"),
    ],
)
def test_main_exits_with_an_error_when_the_run_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    makeClips: Callable[[], list[str]],
    exitCode: int | None,
    logged: str,
) -> None:
    example = Path(__file__).resolve().parents[2] / "schema" / "examples" / "kitchen-sink.json"
    (tmp_path / "markers.json").write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", "--markers-json", "markers.json"])
    monkeypatch.setattr(yt_clipper, "ytdl_bin_get_version", lambda _paths: "2026.08.19")
    monkeypatch.setattr(yt_clipper, "getFfmpegVersion", lambda _path: "ffmpeg version 8.0.1")
    monkeypatch.setattr(ytc_settings, "getInputVideo", lambda _cs: None)
    monkeypatch.setattr(ytc_settings, "getGlobalSettings", lambda _cs: None)
    monkeypatch.setattr(clip_maker, "makeClips", lambda _cs: makeClips())

    if exitCode is None:
        yt_clipper.main()
    else:
        with pytest.raises(SystemExit) as exit_info:
            yt_clipper.main()
        assert exit_info.value.code == exitCode
        assert logged in caplog.text
        # Only a program that cannot start points at the bin folder.
        assert ("bin folder" in caplog.text) == ("bin folder" in logged)
        # Only an unexpected error needs its traceback, and the log file keeps it.
        hasTraceback = any(record.exc_info for record in caplog.records)
        assert hasTraceback == (makeClips is unexpectedError)
        logs = list((tmp_path / "webms" / "markers" / "logs").glob("*.log"))
        # The log file wraps long lines with padding.
        assert " ".join(logged.split()) in " ".join(logs[0].read_text(encoding="utf-8").split())


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


def test_missing_ytdlp_does_not_stop_the_run_start() -> None:
    # A local input video needs no yt-dlp, so a missing one only shows in the version line.
    cp = ClipperPaths(ytdlPath="./bin/yt-dlp/missing-yt-dlp.exe")
    assert yt_clipper.describeYtdlVersion(cp).startswith("unavailable (")


def test_startup_notices_failing_never_stop_the_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    example = Path(__file__).resolve().parents[2] / "schema" / "examples" / "kitchen-sink.json"
    (tmp_path / "markers.json").write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", "--markers-json", "markers.json"])
    monkeypatch.setattr(yt_clipper, "ytdl_bin_get_version", lambda _paths: "2026.08.19")
    monkeypatch.setattr(ytc_settings, "getInputVideo", lambda _cs: None)
    monkeypatch.setattr(ytc_settings, "getGlobalSettings", lambda _cs: None)
    monkeypatch.setattr(clip_maker, "makeClips", lambda _cs: [])

    def failingNotices() -> None:
        raise PermissionError(13, "Access is denied", "D:\\other install")

    monkeypatch.setattr(updates, "showStartupNotices", failingNotices)
    yt_clipper.main()


def test_merge_prompt_with_no_one_to_answer_skips_the_merge(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # A merge needing a failed pair asks whether to merge anyway; a scheduled run cannot answer.
    cs = ClipperState(settings={"markerPairMergeList": "1-2", "markerPairs": [{"returncode": 1, "overrides": {}}, {"overrides": {}}]})
    cs.clipper_paths.clipsPath = str(tmp_path)

    def noAnswer(_prompt: str = "") -> str:
        raise EOFError

    logged: list[str] = []
    monkeypatch.setattr("builtins.input", noAnswer)
    monkeypatch.setattr(clip_maker.logger, "warning", lambda message, *_args, **_kwargs: logged.append(str(message)))
    assert clip_maker.mergeClips(cs) == []
    assert "No answer to the prompt, so the merge is skipped." in logged
