"""The clips a merge joins, as ffprobe reads them, never trusted by file name."""

import json
import subprocess
from dataclasses import dataclass

from clipper.clipper_types import ClipperPaths, argvPath
from clipper.merge_sizes import markerPairsText
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)

PROBE_ERRORS = (subprocess.CalledProcessError, KeyError, IndexError, ValueError)
# The codec ffprobe reports for each --video-codec
PROBED_CODECS = {
    "vp9": "vp9",
    "vp8": "vp8",
    "h264": "h264",
    "h264_nvenc": "h264",
    "h264_vulkan": "h264",
    "av1": "av1",
}


@dataclass(frozen=True)
class StreamTraits:
    """What a rescaled copy takes from the clip it copies, as ffprobe reports it."""

    # The average rate, since a clip's frames may fit no exact rate (r_frame_rate is then the timescale)
    frameRate: str
    timeBase: str
    pixelFormat: str
    # None where the clip has no tag
    colorRange: str | None
    colorSpace: str | None
    colorTransfer: str | None
    colorPrimaries: str | None


@dataclass(frozen=True)
class MergeInput:
    path: str
    codec: str
    size: tuple[int, int]
    seconds: float
    traits: StreamTraits


def probeMergeInput(cp: ClipperPaths, path: str) -> MergeInput:
    output = subprocess.check_output(
        [argvPath(cp.ffprobePath), "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,width,height,avg_frame_rate,time_base,pix_fmt,color_range,color_space,"
         "color_transfer,color_primaries:format=duration", "-of", "json", path],
        text=True,
    )  # fmt: skip
    probe = json.loads(output)
    stream = probe["streams"][0]
    return MergeInput(
        path,
        stream["codec_name"],
        (stream["width"], stream["height"]),
        float(probe["format"]["duration"]),
        StreamTraits(
            stream["avg_frame_rate"],
            stream["time_base"],
            stream["pix_fmt"],
            stream.get("color_range"),
            stream.get("color_space"),
            stream.get("color_transfer"),
            stream.get("color_primaries"),
        ),
    )


def probeMergeInputs(cp: ClipperPaths, merge: str, paths: list[str]) -> list[MergeInput] | None:
    """The merge's clips, or None (logged) when one cannot be read."""
    try:
        return [probeMergeInput(cp, path) for path in paths]
    except PROBE_ERRORS as error:
        logger.error(f"Skipped merge {merge}: could not read one of its clips ({error}).\n")
        return None


def hasOneCodec(
    merge: str,
    mergeList: list[int],
    inputs: list[MergeInput],
    videoCodec: str,
) -> bool:
    """A merge copies its clips' streams into one track, which plays only the first clip's codec.
    Clips made by runs with different codecs can share names (all mp4 codecs write .mp4)."""
    pairsByCodec: dict[str, list[int]] = {}
    for pair, mergeInput in zip(mergeList, inputs, strict=True):
        pairsByCodec.setdefault(mergeInput.codec, []).append(pair)
    if len(pairsByCodec) <= 1:
        return True
    described = ", ".join(
        f"{markerPairsText(pairs)} {'is' if len(set(pairs)) == 1 else 'are'} {codec}"
        for codec, pairs in pairsByCodec.items()
    )
    logger.error(
        f"Skipped merge {merge}: {described}, and a merged clip plays only the first codec.",
    )
    remake = sorted(
        {
            pair
            for codec, pairs in pairsByCodec.items()
            if codec != PROBED_CODECS.get(videoCodec)
            for pair in pairs
        },
    )
    only = ",".join(map(str, remake))
    logger.error(
        f"To make {markerPairsText(remake)} again as {videoCodec}, add --overwrite --only {only}.\n",
    )
    return False
