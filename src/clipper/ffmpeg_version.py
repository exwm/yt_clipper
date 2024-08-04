from subprocess import PIPE, Popen

def getFfmpegVersion(ffmpeg_path: str) -> str:
    try:
        with Popen([ffmpeg_path, "-version"], stdout=PIPE, stderr=PIPE) as proc:
            if proc.stdout is not None:
                version_line = proc.stdout.readline()
            else:
                version_line = "unknown"
    except:  # pylint: disable=bare-except
        version_line = "unknown"

    return str(version_line).strip()
