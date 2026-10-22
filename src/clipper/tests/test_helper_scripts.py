"""The helper scripts shipped next to yt_clipper, run against stub tools that log their arguments.

The Windows scripts need a real exe as the stub: cmd never returns from a .cmd called without `call`.
The C# compiler that ships with Windows builds one."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

HELPERS = Path(__file__).parents[1]


def helperScript(config: pytest.Config, platform: str, script: str) -> Path:
    """A helper script from the source tree, or from `--helpers-dir` (an installed release keeps
    them next to yt_clipper)."""
    folder = config.getoption("helpers_dir")
    if folder:
        return Path(folder) / script
    return HELPERS / f"{platform}_helpers" / script


# The bash the scripts' shebang runs: /bin/bash is 3.2 on macOS, where a newer one may come first on
# PATH and hide 3.2-only behavior.
BASH = "/bin/bash" if Path("/bin/bash").exists() else shutil.which("bash")

SEPARATOR = "\x1f"
PROMPT = "You are in the yt_clipper folder."

STUB_SOURCE = """
using System;
using System.IO;
class Stub {
  static int Main(string[] args) {
    string name = Path.GetFileNameWithoutExtension(Environment.GetCommandLineArgs()[0]);
    File.AppendAllText(Environment.GetEnvironmentVariable("YTC_HELPER_LOG"), name + "\\u001f" + string.Join("\\u001f", args) + "\\n");
    return 0;
  }
}
"""

BASH_STUB = """#!/bin/bash
{ printf '%s' "$(basename "$0")"; for arg in "$@"; do printf '\\x1f%s' "$arg"; done; printf '\\n'; } >>"$YTC_HELPER_LOG"
"""


def loggedCalls(log: Path) -> list[list[str]]:
    if not log.exists():
        return []
    return [line.split(SEPARATOR) for line in log.read_text(encoding="utf-8").splitlines()]


@pytest.fixture(scope="module")
def windowsStub(tmp_path_factory: pytest.TempPathFactory) -> Path:
    if sys.platform != "win32":
        pytest.skip("Windows helper scripts")
    compilers = sorted(Path(r"C:\Windows\Microsoft.NET\Framework64").glob("v4*/csc.exe"))
    if not compilers:
        pytest.skip("needs the .NET Framework C# compiler")
    folder = tmp_path_factory.mktemp("stub")
    (folder / "stub.cs").write_text(STUB_SOURCE, encoding="utf-8")
    subprocess.run([compilers[-1], "/nologo", f"/out:{folder / 'stub.exe'}", str(folder / "stub.cs")], check=True, capture_output=True)  # fmt: skip
    return folder / "stub.exe"


@pytest.fixture
def install(tmp_path: Path) -> Path:
    """An install folder whose path has a space, as a user's might."""
    folder = tmp_path / "yt clipper install"
    (folder / "bin" / "video-tools").mkdir(parents=True)
    return folder


@pytest.fixture
def inputs(tmp_path: Path) -> dict[str, str]:
    """Input files, named with a space and a `!` (common in video titles), and one with the
    characters cmd treats specially: `( ) & % ^`."""
    folder = tmp_path / "my clips"
    folder.mkdir()
    paths = {"json": folder / "Wow! clip.json", "json2": folder / "second.json", "video": folder / "Wow! clip.mp4", "video2": folder / "two.mp4",
             "odd": folder / "Take (1) & 100% ^up.mp4"}  # fmt: skip
    for path in paths.values():
        path.write_text("{}", encoding="utf-8")
    return {name: str(path) for name, path in paths.items()}


def fill(template: list[str], inputs: dict[str, str]) -> list[str]:
    return [
        inputs.get(part.strip("{}"), part) if part.startswith("{") else part for part in template
    ]


# script, dropped files, typed answers, the logged calls (tool, then its arguments)
WINDOWS_CASES = [
    pytest.param("yt_clipper_auto", ["{json}", "{json2}"], "\n",
                 [["yt_clipper", "--markers-json", "{json}"], ["yt_clipper", "--markers-json", "{json2}"]],
                 id="auto"),
    pytest.param("yt_clipper_auto", ["{json}"], '--overwrite --title-suffix "a b"\n\n',
                 [["yt_clipper", "--markers-json", "{json}"],
                  ["yt_clipper", "--markers-json", "{json}", "--overwrite", "--title-suffix", "a b"]],
                 id="auto, run again with options"),
    pytest.param("yt_clipper_auto", ["{json}"], "--format (bv+ba)/b\n\n",
                 [["yt_clipper", "--markers-json", "{json}"],
                  ["yt_clipper", "--markers-json", "{json}", "--format", "(bv+ba)/b"]],
                 id="auto, run again with options in parentheses"),
    pytest.param("yt_clipper_auto", [], "", [], id="auto, no files"),
    pytest.param("yt_clipper_auto_download", ["{json}"], "\n",
                 [["yt_clipper", "--markers-json", "{json}", "--download-video"]], id="auto download"),
    pytest.param("yt_clipper_options", ["{json}"], "--audio\n--overwrite\n\n",
                 [["yt_clipper", "-h"], ["yt_clipper", "--markers-json", "{json}", "--audio"],
                  ["yt_clipper", "--markers-json", "{json}", "--overwrite"]],
                 id="options, each run with its own options"),
    pytest.param("yt_clipper_auto_input_video", ["{video}", "{json}"], "\n",
                 [["yt_clipper", "-i", "{video}", "--markers-json", "{json}"]], id="input video"),
    pytest.param("yt_clipper_auto_input_video", ["{video}"], "", [], id="input video, missing a file"),
    pytest.param("yt_clipper_preview", ["{json}"], "\n",
                 [["yt_clipper", "--markers-json", "{json}", "--preview"]], id="preview"),
    pytest.param("yt_clipper_preview", ["{json}", "{video}"], "\n",
                 [["yt_clipper", "-i", "{video}", "--markers-json", "{json}", "--preview"]], id="preview with input video"),
    pytest.param("yt_clipper_preview", ["{json}", "{odd}"], "--audio\n\n",
                 [["yt_clipper", "-i", "{odd}", "--markers-json", "{json}", "--preview"],
                  ["yt_clipper", "-i", "{odd}", "--markers-json", "{json}", "--preview", "--audio"]],
                 id="preview with an input video named with ( ) & % ^"),
    pytest.param("yt_clipper_preview", [], "", [], id="preview, no files"),
    pytest.param("yt_clipper_check_for_updates", [], "", [["yt_clipper", "--check-for-updates"]], id="check for updates"),
    pytest.param("fast_trim", ["{video}"], "1\n2\n",
                 [["ffmpeg", "-ss", "1", "-to", "2", "-i", "{video}", "-c", "copy", "{trimmed}"]], id="fast trim"),
    pytest.param("fast_trim", [], "", [], id="fast trim, no file"),
    pytest.param("fast_trim", ["{video}"], "\n2\n",
                 [["ffmpeg", "-to", "2", "-i", "{video}", "-c", "copy", "{trimmed}"]], id="fast trim from the beginning"),
    pytest.param("fast_trim", ["{video}"], "1\n\n",
                 [["ffmpeg", "-ss", "1", "-i", "{video}", "-c", "copy", "{trimmed}"]], id="fast trim to the end"),
    pytest.param("fast_trim", ["{video}"], ' "1.5" \n  \n',
                 [["ffmpeg", "-ss", "1.5", "-i", "{video}", "-c", "copy", "{trimmed}"]],
                 id="fast trim, pasted times with quotes and spaces"),
    pytest.param("vid2gif", ["{video}"], "\n100X50\n",
                 [["ffmpeg", "-i", "{video}", "-vf", "{gif_filter}", "{gif}"]], id="vid2gif, WxH with a capital X"),
    pytest.param("merge", ["{video}", "{video2}"], "",
                 [["ffmpeg", "-f", "concat", "-safe", "0", "-i", "{merge_list}", "-c", "copy", "{merged}"]], id="merge"),
    pytest.param("preprocess_hevc", ["{video}"], "",
                 [["ffmpeg", "-i", "{video}", "-c", "copy", "-bsf:v", "hevc_mp4toannexb", "{preprocessed}"]], id="preprocess hevc"),
    pytest.param("vid2gif", ["{video}", "{video2}"], "\n100x50\n",
                 [["ffmpeg", "-i", "{video}", "-vf", "{gif_filter}", "{gif}"],
                  ["ffmpeg", "-i", "{video2}", "-vf", "{gif_filter}", "{gif2}"]], id="vid2gif"),
    pytest.param("vid2gif", ["{odd}"], "\n100x50\n",
                 [["ffmpeg", "-i", "{odd}", "-vf", "{gif_filter}", "{odd_gif}"]], id="vid2gif, a name with ( ) & % ^"),
]  # fmt: skip


@pytest.mark.parametrize(("script", "dropped", "typed", "calls"), WINDOWS_CASES)
def test_windows_helper_runs_the_tool_then_ends_at_a_prompt(
    pytestconfig: pytest.Config,
    windowsStub: Path,
    install: Path,
    inputs: dict[str, str],
    tmp_path: Path,
    script: str,
    dropped: list[str],
    typed: str,
    calls: list[list[str]],
) -> None:
    shutil.copy(windowsStub, install / "yt_clipper.exe")
    shutil.copy(windowsStub, install / "bin" / "video-tools" / "ffmpeg.exe")
    shutil.copy(helperScript(pytestconfig, "win", f"{script}.bat"), install)
    folder = Path(inputs["video"]).parent
    expected = {
        **inputs,
        "trimmed": f"{folder}\\Wow! clip-trim.mp4",
        "merge_list": f"{folder}\\temp_merge.txt",
        "merged": f"{folder}\\Wow! clip-merged.mp4",
        "preprocessed": f"{folder}\\Wow! clip-preproc.mp4",
        "gif": f"{folder}\\Wow! clip.gif",
        "gif2": f"{folder}\\two.gif",
        "odd_gif": f"{folder}\\Take (1) & 100% ^up.gif",
        "gif_filter": "fps=8,scale=100x50:flags=lanczos,setdar=ratio=a,hqdn3d,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse",
    }
    log = tmp_path / "calls.log"
    run = runWindowsScript(install / f"{script}.bat", fill(dropped, inputs), typed, tmp_path, log)
    assert loggedCalls(log) == [fill(call, expected) for call in calls]
    assert PROMPT in run.stdout


def runWindowsScript(
    script: Path, dropped: list[str], typed: str, folder: Path, log: Path
) -> subprocess.CompletedProcess[str]:
    # As dropping files on the script does: each path quoted, started outside the install folder.
    # /s strips only the outer quotes, which cmd otherwise takes from the first and last argument.
    quoted = " ".join(f'"{part}"' for part in [str(script), *dropped])
    # From a file: set /p reads a pipe in blocks, so the first prompt would take every answer.
    answers = folder / "answers.txt"
    answers.write_bytes(typed.replace("\n", "\r\n").encode("utf-8"))
    with answers.open("rb") as stdin:
        run = subprocess.run(
            f'cmd /d /s /c "{quoted}"',
            stdin=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace",
            cwd=folder, env={**os.environ, "YTC_HELPER_LOG": str(log)}, timeout=60, check=False,
        )  # fmt: skip
    print(run.stdout, run.stderr)
    return run


def test_windows_merge_lists_clips_in_number_order_with_quoted_paths(
    pytestconfig: pytest.Config,
    windowsStub: Path,
    install: Path,
    tmp_path: Path,
) -> None:
    shutil.copy(windowsStub, install / "bin" / "video-tools" / "ffmpeg.exe")
    shutil.copy(helperScript(pytestconfig, "win", "merge.bat"), install)
    folder = tmp_path / "my clips"
    folder.mkdir()
    # The clipper numbers clips without zero padding, so a plain sort puts -10 before -2.
    clips = [folder / name for name in ("it's-1.mp4", "clip-10.mp4", "clip-2.mp4")]
    for clip in clips:
        clip.write_text("{}", encoding="utf-8")
    run = runWindowsScript(install / "merge.bat", [str(c) for c in clips], "", tmp_path, tmp_path / "calls.log")
    # ffmpeg's concat list format: each path in quotes, a ' written as '\''.
    assert (folder / "temp_merge.txt").read_text(encoding="utf-8").splitlines() == [
        f"file '{folder}\\clip-2.mp4'",
        f"file '{folder}\\clip-10.mp4'",
        f"file '{folder}\\it'\\''s-1.mp4'",
    ]
    assert PROMPT in run.stdout


MACOS_CASES = [
    pytest.param("yt_clipper_auto", '"{json}" "{json2}"\n\n',
                 [["yt_clipper", "--markers-json", "{json}"], ["yt_clipper", "--markers-json", "{json2}"]],
                 id="auto"),
    pytest.param("yt_clipper_auto", '"{json}"\n--overwrite --title-suffix "a b"\n\n',
                 [["yt_clipper", "--markers-json", "{json}"],
                  ["yt_clipper", "--markers-json", "{json}", "--overwrite", "--title-suffix", "a b"]],
                 id="auto, run again with options"),
    pytest.param("yt_clipper_auto", '"{json}"\n--title-suffix "a b\n\n',
                 [["yt_clipper", "--markers-json", "{json}"]], id="auto, unbalanced quote: no rerun"),
    pytest.param("yt_clipper_auto_download", '"{json}"\n\n',
                 [["yt_clipper", "--markers-json", "{json}", "--download-video"]], id="auto download"),
    pytest.param("yt_clipper_options", '"{json}"\n--audio --overwrite\n--audio\n\n',
                 [["yt_clipper", "-h"], ["yt_clipper", "--markers-json", "{json}", "--audio", "--overwrite"],
                  ["yt_clipper", "--markers-json", "{json}", "--audio"]],
                 id="options, several options in one answer"),
    pytest.param("yt_clipper_input_video", "{json}\n{video}\n\n",
                 [["yt_clipper", "--markers-json", "{json}", "--input-video", "{video}"]], id="input video"),
    pytest.param("yt_clipper_preview", '"{json}"\n\n',
                 [["yt_clipper", "--markers-json", "{json}", "--preview"]], id="preview"),
    pytest.param("yt_clipper_check_for_updates", "", [["yt_clipper", "--check-for-updates"]], id="check for updates"),
    pytest.param("fast_trim", '"{video}"\n1\n2\n',
                 [["ffmpeg", "-ss", "1", "-to", "2", "-i", "{video}", "-c", "copy", "{trimmed}"]], id="fast trim"),
    pytest.param("merge", '"{video}"\n', [], id="merge, one file"),
]  # fmt: skip


@pytest.mark.parametrize(("script", "typed", "calls"), MACOS_CASES)
def test_macos_helper_runs_the_tool_then_ends_at_a_shell(
    pytestconfig: pytest.Config,
    install: Path,
    inputs: dict[str, str],
    tmp_path: Path,
    script: str,
    typed: str,
    calls: list[list[str]],
) -> None:
    if sys.platform == "win32" or BASH is None:
        pytest.skip("macOS helper scripts need bash")
    for stub in (install / "yt_clipper", install / "bin" / "video-tools" / "ffmpeg"):
        stub.write_text(BASH_STUB, encoding="utf-8")
        stub.chmod(0o755)
    shutil.copy(helperScript(pytestconfig, "macos", script), install)
    expected = {**inputs, "trimmed": str(Path(inputs["video"]).with_name("Wow! clip-trim.mp4"))}
    log = tmp_path / "calls.log"
    run = subprocess.run(
        [BASH, str(install / script)],
        input="".join(typed).format(**inputs), capture_output=True, text=True,
        cwd=tmp_path, env={**os.environ, "YTC_HELPER_LOG": str(log), "SHELL": "/bin/sh"}, timeout=60, check=False,
    )  # fmt: skip
    print(run.stdout, run.stderr)
    assert loggedCalls(log) == [fill(call, expected) for call in calls]
    assert PROMPT in run.stdout


def test_macos_merge_quotes_each_path_and_makes_an_mkv_from_mixed_files(
    pytestconfig: pytest.Config,
    install: Path,
    inputs: dict[str, str],
    tmp_path: Path,
) -> None:
    if sys.platform == "win32" or BASH is None:
        pytest.skip("macOS helper scripts need bash")
    ffmpeg = install / "bin" / "video-tools" / "ffmpeg"
    ffmpeg.write_text(BASH_STUB, encoding="utf-8")
    ffmpeg.chmod(0o755)
    shutil.copy(helperScript(pytestconfig, "macos", "merge"), install)
    video = Path(inputs["video"])
    other = video.with_name("it's.mkv")
    other.write_text("{}", encoding="utf-8")
    log = tmp_path / "calls.log"
    run = subprocess.run(
        [BASH, str(install / "merge")],
        input=f'"{video}" "{other}"\n', capture_output=True, text=True,
        cwd=tmp_path, env={**os.environ, "YTC_HELPER_LOG": str(log), "SHELL": "/bin/sh"}, timeout=60, check=False,
    )  # fmt: skip
    print(run.stdout, run.stderr)
    mergeList = video.with_name("temp_merge.txt")
    merged = str(video.with_name("Wow! clip-merged.mkv"))
    assert loggedCalls(log) == [["ffmpeg", "-f", "concat", "-safe", "0", "-i", str(mergeList), "-c", "copy", merged]]
    # ffmpeg's concat list format: each path in quotes, a ' written as '\''.
    assert mergeList.read_text(encoding="utf-8") == f"file '{video}'\nfile '{video.parent}/it'\\''s.mkv'\n"
    assert PROMPT in run.stdout
