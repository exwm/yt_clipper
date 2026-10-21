import re
import shutil
import subprocess
from functools import cache
from typing import Optional

import pytest

from clipper import ffmpeg_codec
from clipper.tests.test_ffmpeg_codec import _make_mp_mps

VIDEO_CODECS = ["vp9", "vp8", "h264", "h264_vulkan", "h264_nvenc", "av1"]
SCENARIOS: dict[str, tuple[dict[str, object], dict[str, object], Optional[int]]] = {
    "crf": ({}, {}, None),
    "hdr": ({}, {"enableHDR": True}, None),
    "target_size": ({}, {}, 12),
    "variable_speed": ({"isVariableSpeed": True}, {}, None),
}


def _help(*topic: str) -> list[str]:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        pytest.skip("ffmpeg is not on PATH")
    run = subprocess.run(
        [ffmpeg, "-hide_banner", "-h", *topic], capture_output=True, text=True, check=False
    )
    return run.stdout.splitlines()


def _option_names(lines: list[str]) -> set[str]:
    return {m[1] for line in lines if (m := re.match(r"\s*-([A-Za-z0-9_-]+)", line))}


@cache
def _shared_options() -> set[str]:
    """Main options (unindented) plus the generic codec and format options, which every encoder takes."""
    lines = _help("full")
    names = _option_names([line for line in lines if line.startswith("-")])
    section = ""
    for line in lines:
        if line.endswith("AVOptions:"):
            section = line
        elif section in {"AVCodecContext AVOptions:", "AVFormatContext AVOptions:"}:
            names |= _option_names([line])
    return names


@cache
def _own_options(kind: str, name: str) -> Optional[set[str]]:
    lines = _help(f"{kind}={name}")
    return _option_names(lines) if lines and "is not recognized" not in lines[0] else None


@pytest.mark.parametrize("scenario", SCENARIOS.values(), ids=SCENARIOS.keys())
@pytest.mark.parametrize("video_codec", VIDEO_CODECS)
def test_codec_args_use_only_options_the_local_ffmpeg_knows(
    video_codec: str, scenario: tuple[dict[str, object], dict[str, object], Optional[int]]
) -> None:
    """An ffmpeg upgrade renames options (`-temporal_aq` became `-temporal-aq`), and the old name then fails the encode."""
    mp_overrides, mps_overrides, cbr = scenario
    mp, mps = _make_mp_mps(**mps_overrides)
    mp.update(mp_overrides)
    args = " ".join(
        ffmpeg_codec.getFfmpegVideoCodecArgs(videoCodec=video_codec, cbr=cbr, mp=mp, mps=mps)
    )
    encoder = re.search(r"-c:v (\S+)", args)[1]
    encoder_options = _own_options("encoder", encoder)
    if encoder_options is None:
        pytest.skip(f"the local ffmpeg lacks {encoder}")
    muxer_options = _own_options("muxer", ffmpeg_codec.getContainerForCodec(video_codec)) or set()
    known = _shared_options() | encoder_options | muxer_options
    used = {name.split(":")[0] for name in re.findall(r"(?<!\S)-([A-Za-z][\w:-]*)", args)}
    assert used - known == set()
