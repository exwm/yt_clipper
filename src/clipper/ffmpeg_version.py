import functools
import re
import subprocess
import tempfile
from pathlib import Path
from subprocess import PIPE, Popen

from clipper.clipper_types import argvPath
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)


def getFfmpegVersion(ffmpeg_path: str) -> str:
    try:
        with Popen([argvPath(ffmpeg_path), "-version"], stdout=PIPE, stderr=PIPE) as proc:
            version_line = (
                proc.stdout.readline().decode("utf-8").rstrip().replace("version", "")
                if proc.stdout is not None
                else "unknown"
            )
    except:  # pylint: disable=bare-except  # noqa: E722
        version_line = "unknown"

    return str(version_line).strip()


@functools.cache
def supportsOptionFiles(ffmpeg_path: str) -> bool:
    """Whether this ffmpeg reads an option's value from a file, as -/filter:v (ffmpeg 7 and later).
    Tried rather than read from the version, which git builds do not print."""
    # Only an ffmpeg that rejects the option lacks it: any other failure (a slow scan, an unwritable
    # temp folder) says nothing about it, and the current option is the safer guess.
    try:
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / "filter.txt"
            script.write_text("null", encoding="utf-8")
            command = [
                argvPath(ffmpeg_path),
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=d=0.04",
            ]
            result = subprocess.run(
                [*command, "-/filter:v", str(script), "-f", "null", "-"],
                capture_output=True,
                check=False,
                timeout=30,
            )
    except (OSError, subprocess.TimeoutExpired):
        return True
    return result.returncode == 0 or b"Unrecognized option" not in result.stderr


FILTER_OPTION_PATTERN = re.compile(r"^\s+(\w+)\s+<\w+>", re.MULTILINE)


def filterOptionNames(helpText: str) -> set[str]:
    """The options in `ffmpeg -h filter=NAME` text: the lines with a type (a named value has none)."""
    return set(FILTER_OPTION_PATTERN.findall(helpText))


@functools.cache
def vidstabWritesTextTransforms(ffmpeg_path: str) -> bool:
    """Whether this ffmpeg's vidstabdetect has fileformat, for the text transforms the motion repair
    reads. ffmpeg 6.x and some 7.x builds have a vid.stab from before it. Warns once when not."""
    try:
        helpText = subprocess.run(
            [argvPath(ffmpeg_path), "-hide_banner", "-h", "filter=vidstabdetect"],
            capture_output=True,
            text=True,
            errors="replace",
            check=False,
            timeout=30,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        # The bundled ffmpeg has it, and the help failing says nothing about the filter
        return True
    options = filterOptionNames(helpText)
    if "fileformat" in options:
        return True
    if not options:
        logger.warning(
            "This ffmpeg has no video stabilization (vid.stab), so stabilized clips fail."
            " Use ffmpeg 9.0.2, or turn off video stabilization."
        )
        return False
    logger.warning(
        "This ffmpeg's video stabilization is older than ffmpeg 9.0.2's, so it runs without the motion analysis."
        " Stabilized clips can jerk at flashes and around moving subjects."
        " Use ffmpeg 9.0.2 for the full stabilization.",
    )
    return False


def filterFileOption(ffmpeg_path: str) -> str:
    """The option that reads a video filter from a file: ffmpeg 9 removed -filter_script:v, and
    ffmpeg before 7 has no -/filter:v."""
    return "-/filter:v" if supportsOptionFiles(ffmpeg_path) else "-filter_script:v"
