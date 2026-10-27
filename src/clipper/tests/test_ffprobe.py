import logging
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest

from clipper.ffprobe import getFrameRate, offGridFrames, shouldCheckFrameTimes, warnIfFramesOffGrid

FRAMES_AT_30 = [n / 30 for n in range(60)]


@pytest.mark.parametrize(
    ("times", "origin", "rate", "off"),
    [
        pytest.param(FRAMES_AT_30, 0, "30", 0, id="on the grid"),
        pytest.param([round(t, 3) for t in FRAMES_AT_30], 0, "30", 0, id="millisecond timestamps"),
        pytest.param([0.021 + t for t in FRAMES_AT_30], 0.021, "30", 0, id="from a start offset"),
        pytest.param(FRAMES_AT_30[::2] + FRAMES_AT_30[1:2], 0, "30", 0, id="dropped frames"),
        pytest.param([t + 0.3 / 30 * (n % 2) for n, t in enumerate(FRAMES_AT_30)], 0, "30", 30, id="jittered"),
        pytest.param(FRAMES_AT_30, 0, "20", 40, id="a wrong rate"),
    ],
)
def test_frames_off_the_grid_are_counted(times: list[float], origin: float, rate: str, off: int) -> None:
    assert offGridFrames(times, origin, Fraction(rate)) == off


@pytest.mark.parametrize(
    ("videoURL", "inputVideo", "stated", "average", "checks"),
    [
        pytest.param("clip.webm", "clip.webm", "30/1", "30/1", True, id="a local video"),
        pytest.param("https://example.com/v", "", "30/1", "30/1", False, id="a network stream"),
        pytest.param("clip.mp4", "clip.mp4", "30/1", "3600/179", False, id="a varying rate its header shows"),
    ],
)
def test_frame_times_are_read_for_local_videos_whose_header_shows_no_varying_rate(
    videoURL: str, inputVideo: str, stated: str, average: str, checks: bool
) -> None:
    assert shouldCheckFrameTimes(videoURL, inputVideo, stated, average) == checks


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg and ffprobe on PATH")
@pytest.mark.parametrize("name", ["video.webm", "-video.webm"])
@pytest.mark.parametrize(
    ("setpts", "warns"),
    [
        pytest.param("N/30/TB", False, id="constant"),
        pytest.param("if(lt(N,30),N,30+2*(N-30))/30/TB", False, id="half speed after 1 s, on the grid"),
        pytest.param("(N+0.4*mod(N,2))/30/TB", True, id="uneven frame times"),
    ],
)
def test_a_local_webm_with_frames_off_its_grid_is_warned_about(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, setpts: str, warns: bool, name: str
) -> None:
    # WebM reports equal r_frame_rate and avg_frame_rate even when its frame times vary. A 1 ms time
    # base keeps the encoder from rounding the times back onto the 1/30 grid. A name starting with '-'
    # is still the input, not an ffprobe option.
    video = tmp_path / name
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=30:duration=2",
                    "-vf", f"settb=1/1000,setpts='{setpts}'", "-fps_mode", "vfr", "-enc_time_base", "1/1000",
                    "-c:v", "libvpx-vp9", "-deadline", "realtime", "-y", str(video)], check=True)  # fmt: skip
    with caplog.at_level(logging.WARNING):
        warnIfFramesOffGrid("ffprobe", str(video), origin=0, rate=Fraction(30))
    assert any(record.levelno == logging.WARNING for record in caplog.records) == warns


# Rates as ffprobe reports them for mp4: constant-rate clips report equal rates at any length, and a
# variable-rate clip's average comes from its frame count over its duration. (WebM and MKV report the
# same value for both, so a variable rate there goes unnoticed.)
@pytest.mark.parametrize(
    ("r_frame_rate", "avg_frame_rate", "rate", "warns"),
    [
        pytest.param("30/1", "30/1", "30/1", False, id="constant"),
        pytest.param("30000/1001", "2997/100", "30000/1001", False, id="NTSC average rounded"),
        pytest.param("30/1", "2990/100", "30/1", True, id="mildly variable"),
        pytest.param("30/1", "3600/179", "3600/179", True, id="every third frame dropped"),
        pytest.param("90000/1", "2997/100", "2997/100", True, id="time base as the rate"),
    ],
)
def test_a_variable_frame_rate_is_warned_about(
    caplog: pytest.LogCaptureFixture,
    r_frame_rate: str,
    avg_frame_rate: str,
    rate: str,
    warns: bool,
) -> None:
    with caplog.at_level(logging.WARNING):
        assert getFrameRate(r_frame_rate, avg_frame_rate) == rate
    assert any(record.levelno == logging.WARNING for record in caplog.records) == warns
