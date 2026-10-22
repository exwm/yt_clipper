import codecs
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
        # The release's own tools, also when it runs from another folder.
        pytest.param(True, {}, "{install}/bin/video-tools/ffmpeg", "{install}/bin/yt-dlp/yt-dlp", id="frozen release layout"),
    ],
)
def test_tool_dirs_come_from_cli_args_not_settings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    frozen: bool,
    cli_args: dict[str, str],
    ffmpeg_prefix: str,
    ytdl_prefix: str,
) -> None:
    install = tmp_path / "yt_clipper_win_5.49.0"
    monkeypatch.setattr("sys.frozen", frozen, raising=False)
    monkeypatch.setattr("sys.executable", str(install / "yt_clipper.exe"))
    monkeypatch.chdir(tmp_path)
    cs = ClipperState(settings={"ffmpegToolsDir": "settings-tools", "ytdlDir": "settings-ytdl"})
    setupClipperPaths(cs, cli_args)

    def asPath(path: str) -> str:
        return Path(argvPath(path)).as_posix()

    assert asPath(cs.clipper_paths.ffmpegPath).startswith(ffmpeg_prefix.format(install=install.resolve().as_posix()))
    assert asPath(cs.clipper_paths.ytdlPath).startswith(ytdl_prefix.format(install=install.resolve().as_posix()))


def test_minterp_enhancements_use_the_install_ffmpeg_ytc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # The commands split the path again, so a Windows path must stay quoted with its backslashes.
    install = tmp_path / "yt clipper" / "yt_clipper_win_5.49.0"
    ytcPath = install / "bin" / "video-tools" / "ffmpeg_ytc.exe"
    ytcPath.parent.mkdir(parents=True)
    ytcPath.touch()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(install / "yt_clipper.exe"))
    monkeypatch.setattr(sys, "platform", "win32")
    cs = ClipperState(settings={"enableMinterpEnhancements": True})
    yt_clipper.enableMinterpEnhancements(cs)
    assert Path(argvPath(cs.clipper_paths.ffmpegPath)) == ytcPath.resolve()


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        pytest.param(b"--cookies C:\\Users\\example\\cookies.txt\n", ["--cookies", "C:\\Users\\example\\cookies.txt"], id="plain"),
        pytest.param("\ufeff--cookies C:\\Users\\example\\c.txt\n".encode(), ["--cookies", "C:\\Users\\example\\c.txt"], id="byte order mark"),
        pytest.param(
            b'--cookies "C:\\Users\\example\\My Files\\cookies.txt"\n',
            ["--cookies", "C:\\Users\\example\\My Files\\cookies.txt"],
            id="quoted path with a space",
        ),
        pytest.param("--cookies C:\\Users\\example\\Jos\u00e9\\c.txt\n".encode("cp1252"), None, id="not UTF-8"),
        pytest.param(
            codecs.BOM_UTF8 + "--cookies C:\\Users\\example\\Jos\u00e9\\c.txt\n".encode("cp1252"),
            None,
            id="not UTF-8 after a UTF-8 byte order mark",
        ),
        pytest.param(
            codecs.BOM_UTF16_LE + "--cookies C:\\Users\\example\\Jos\u00e9\\c.txt\r\n".encode("utf-16-le"),
            ["--cookies", "C:\\Users\\example\\Jos\u00e9\\c.txt"],
            id="UTF-16, as Windows PowerShell 5.1 writes",
        ),
        pytest.param(b"# cookies\n--audio\n  # indented comment\n--overwrite\n", ["--audio", "--overwrite"], id="comments"),
        pytest.param(
            b'--title-suffix "a b\n--cookies "C:\\Users\\example\\x y\\c.txt"\n',
            ["--title-suffix", '"a', "b", "--cookies", "C:\\Users\\example\\x y\\c.txt"],
            id="unbalanced quote: that line read without quotes, the next with them",
        ),
        pytest.param(
            b"--cookies C:\\Users\\example\\it's\\cookies.txt\n--title-suffix Don't\n",
            ["--cookies", "C:\\Users\\example\\it's\\cookies.txt", "--title-suffix", "Don't"],
            id="apostrophes are not quotes",
        ),
    ],
)
def test_settings_file_is_read_like_a_command_line(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    content: bytes,
    expected: list[str] | None,
) -> None:
    settings = tmp_path / "default_args.txt"
    settings.write_bytes(content)
    args = argparser.readArgFile(settings)
    if expected is None:
        # Read in the system encoding, with a warning to save it as UTF-8.
        assert args[0] == "--cookies"
        assert "not saved as UTF-8" in capsys.readouterr().err
    else:
        assert args == expected


@pytest.mark.parametrize(
    ("dynamicRange", "bitDepth"),
    [
        pytest.param(None, 8, id="unknown"),
        pytest.param("SDR", 8, id="SDR"),
        pytest.param("HDR10", 10, id="HDR10"),
        pytest.param("HLG", 10, id="HLG"),
        pytest.param("DV", 10, id="Dolby Vision"),
        pytest.param("HDR12", 12, id="HDR12"),
    ],
)
def test_bit_depth_from_ytdlp_dynamic_range(dynamicRange: str | None, bitDepth: int) -> None:
    # For when ffprobe cannot read the video: an unknown range is no reason to encode 10-bit.
    assert ytc_settings.bitDepthFromDynamicRange(dynamicRange) == bitDepth


def test_unreadable_settings_file_is_skipped_with_a_warning(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    # A folder stands in for a file that cannot be read (locked, or no permission).
    assert argparser.readArgFile(tmp_path) == []
    assert "so its settings are not used" in capsys.readouterr().err


@pytest.mark.parametrize("fromInstall", [True, False], ids=["run from the install", "run from another folder"])
@pytest.mark.parametrize("nested", [False, True], ids=["unzipped", "Extract All nested it in a same-named folder"])
def test_release_finds_settings_files_next_to_its_folder(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fromInstall: bool,
    nested: bool,
) -> None:
    install = tmp_path / "yt_clipper_win_5.49.0"
    if nested:
        install = install / install.name
    install.mkdir(parents=True)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(install / "yt_clipper.exe"))
    monkeypatch.chdir(install if fromInstall else elsewhere)
    # The shared file first, so the install's own settings override it.
    expected = [str(tmp_path.resolve() / "yt_clipper_default_args.txt"), str(install.resolve() / "default_args.txt")]
    if not fromInstall:
        # The working folder's own default_args.txt still applies last, as before 5.49.
        expected.append(str(elsewhere.resolve() / "default_args.txt"))
    assert argparser.defaultArgFiles() == expected


@pytest.mark.parametrize(
    ("shared", "own", "key", "value"),
    [
        pytest.param("", '--extra-ffmpeg-args "-tune film"\n', "extraFfmpegArgs", "-tune film", id="a quoted value that starts with a dash"),
        # argparse reads "-preset slow" alone as the short option -p, on the command line too.
        pytest.param("", '--extra-ffmpeg-args="-preset slow"\n', "extraFfmpegArgs", "-preset slow", id="a quoted value like a short option, after ="),
        pytest.param("", "-dn 2\n", "denoise", argparser.getDenoisePreset(2), id="a short option with a value"),
        # The skipped option's value must not join the option before it, which takes several.
        pytest.param("-S res --from-a-newer-version 5\n", "", "formatSort", ["res"], id="an unknown option's value"),
    ],
)
def test_settings_file_values_reach_their_own_option(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    shared: str,
    own: str,
    key: str,
    value: object,
) -> None:
    install = tmp_path / "yt_clipper_win_5.49.0"
    install.mkdir()
    (tmp_path / "yt_clipper_default_args.txt").write_text(shared, encoding="utf-8")
    (install / "default_args.txt").write_text(own, encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(install / "yt_clipper.exe"))
    monkeypatch.setattr(sys, "argv", ["yt_clipper", "--markers-json", "markers.json"])
    monkeypatch.chdir(install)
    args, unknown, *_ = argparser.getArgs()
    assert unknown == []
    assert args[key] == value


@pytest.mark.parametrize(
    ("line", "kept"),
    [
        pytest.param("", [], id="empty"),
        pytest.param("-di -dn 2", ["-di", "-dn", "2"], id="short options"),
        pytest.param("--audio --from-a-newer-version 5", ["--audio"], id="an unknown option and its value"),
        # Full option names only: a newer option that starts like a current one is neither read as
        # that one nor ambiguous.
        pytest.param("--audio --overwr", ["--audio"], id="a prefix of one option"),
        pytest.param("--audio --video", ["--audio"], id="a prefix of several options"),
        # argparse would read -fps 60 as -f ps, and -vx as -v (print the version and exit).
        pytest.param("--audio -fps 60", ["--audio"], id="a short option that starts like -f"),
        pytest.param("--audio -vx 2", ["--audio"], id="a short option that starts like -v"),
        pytest.param("--new --audio-delay -0.5", ["--audio-delay", "-0.5"], id="a negative value"),
        pytest.param('--new --extra-ffmpeg-args "-crf 20"', ["--extra-ffmpeg-args", "-crf 20"], id="a quoted value"),
        pytest.param('--new --extra-ffmpeg-args="-crf 20"', ["--extra-ffmpeg-args=-crf 20"], id="a joined value"),
        pytest.param('--new="a b" --audio', ["--audio"], id="an unknown option with a joined value"),
    ],
)
def test_the_shared_settings_file_keeps_only_the_options_this_version_knows(
    capsys: pytest.CaptureFixture[str], line: str, kept: list[str]
) -> None:
    # Every installed version reads the shared file, so an option only a newer version knows is
    # skipped there with its values, instead of stopping the run.
    tokens = argparser.splitArgLine(line)
    assert argparser.knownSharedArgs(argparser.getArgParser(), tokens, "shared") == kept
    assert ("options this version does not know" in capsys.readouterr().err) == (kept != tokens)


@pytest.mark.parametrize(
    ("shared", "own", "cli", "unknown"),
    [
        pytest.param("--audio --from-a-newer-version\n", "", [], [], id="in the shared file: skipped"),
        pytest.param("--audio -vx 2\n", "", [], [], id="in the shared file, skipped before parsing"),
        pytest.param("--audio\n", "--from-a-newer-version\n", [], ["--from-a-newer-version"], id="in the install's own file"),
        pytest.param("--audio\n", "--overwr\n", [], ["--overwr"], id="a prefix in the install's own file"),
        pytest.param("--audio\n", "", ["--overwr"], ["--overwr"], id="a prefix on the command line"),
    ],
)
def test_an_option_only_a_newer_version_knows_is_skipped_only_in_the_shared_settings_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    shared: str,
    own: str,
    cli: list[str],
    unknown: list[str],
) -> None:
    # An unknown option elsewhere stops the run.
    install = tmp_path / "yt_clipper_win_5.49.0"
    install.mkdir()
    (tmp_path / "yt_clipper_default_args.txt").write_text(shared, encoding="utf-8")
    (install / "default_args.txt").write_text(own, encoding="utf-8")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(install / "yt_clipper.exe"))
    monkeypatch.setattr(sys, "argv", ["yt_clipper", "--markers-json", "markers.json", *cli])
    monkeypatch.chdir(install)
    args, unknownArgs, *_ = argparser.getArgs()
    assert unknownArgs == unknown
    assert args["audio"]
    # No abbreviation sets --overwrite, wherever it is written.
    assert not args.get("overwrite", False)


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
        raise PermissionError(13, "Access is denied", "D:\\example\\other install")

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
