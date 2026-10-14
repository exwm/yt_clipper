from subprocess import PIPE, Popen

from clipper.clipper_types import argvPath


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
