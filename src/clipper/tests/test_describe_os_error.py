import pytest

from clipper.yt_clipper import describeOsError


def osError(strerror: str, filename: str | None = None, winerror: int | None = None) -> OSError:
    error = OSError(2, strerror, filename)
    error.winerror = winerror  # type: ignore[attr-defined]  # set on Windows only
    return error


@pytest.mark.parametrize(
    ("error", "message"),
    [
        pytest.param(
            osError("No such file or directory", r"C:\Users\example\bin\video-tools\ffmpeg.exe"),
            "ffmpeg.exe: No such file or directory. Check that it is in the bin folder.",
            id="a bundled tool that is missing",
        ),
        pytest.param(
            osError("Permission denied", r"C:\Users\example\clips\clip.webm"),
            "clip.webm: Permission denied.",
            id="a file that cannot open",
        ),
        pytest.param(
            osError("%1 is not a valid Win32 application", winerror=193),
            "A program the clipper runs could not start: the program is not a valid Win32 application. "
            "Check that ffmpeg, ffprobe and yt-dlp are in the bin folder.",
            id="a program that cannot start",
        ),
        pytest.param(
            osError("No space left on device", winerror=112),
            "No space left on device.",
            id="any other failure",
        ),
    ],
)
def test_describes_what_could_not_start_or_open(error: OSError, message: str) -> None:
    assert describeOsError(error) == message
