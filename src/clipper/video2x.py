import shlex
import subprocess
from pathlib import Path
from typing import List, Tuple

import rich.markup

from clipper.clipper_types import ClipperState, DictStrAny
from clipper.ytc_logger import logger

_VIDEO2X_CODEC_MAP = {
    "h264": "libx264",
    "h264_vulkan": "h264_vulkan",
    "h264_nvenc": "h264_nvenc",
    "vp9": "libvpx-vp9",
    "vp8": "libvpx",
}

AVCodecContextOptions = {
    "-pix_fmt": "--pix-fmt",
    "-b:v": "--bit-rate",
    "-qmin": "--qmin",
    "-qmax": "--qmax",
    "-g": "--gop-size",
    "-keyint_min": "--keyint-min",
    "-refs": "--refs",
}

ignore_options = [
    # specified explicitly via -codec
    "-c:v",
    # slices may be a deprecated option for libvpx-vp9
    "-slices",
    # not expoded by video2x for AVCodecContext
    "-force_key_frames",
    # for now just let video2x decide bitrate based on crf
    "-b:v",
]


def buildVideo2xArgs(
    pre_v2x_path: str,
    final_path: str,
    mp: DictStrAny,
    mps: DictStrAny,
    video_codec_args: str,
) -> str:
    codec = _VIDEO2X_CODEC_MAP[mps["videoCodec"]]

    video_codec_args_list = shlex.split(video_codec_args)
    video2x_codec_args = [pair for pair in to_pairs(video_codec_args_list)]

    # Emit every codec parameter (except the special "codec" key itself) as a
    # separate -e key=value encoder option understood by video2x.
    encoder_options = []
    for key, value in video2x_codec_args:
        if key in ignore_options:
            continue

        video2x_value = value
        if key in AVCodecContextOptions:
            video2x_key = AVCodecContextOptions[key]
            # video2x bit-rate only accepts bits per second
            if video2x_key == "--bit-rate":
                if value.endswith("k"):
                    video2x_value = str(int(value[:-1]) * 1000)
                elif value.endswith("MB"):
                    video2x_value = str(int(value[:-2]) * 1000 * 1000)
            # video2x only allows int-valued gop-size
            if video2x_key == "--gop-size":
                video2x_value = str(int(float(value)))

            encoder_options.append(f"{video2x_key} {video2x_value}")
            continue

        encoder_options.append(f"-e {key[1:]}={value}")

    extra_encoder_args = " ".join(encoder_options)

    minterpFpsMultiplier = mps["minterpFpsMultiplier"]

    return " ".join(
        filter(
            None,
            [
                f'-i "{pre_v2x_path}"',
                f'-o "{final_path}"',
                f"--frame-rate-mul {minterpFpsMultiplier}",
                "--processor rife",
                "--rife-model rife-v4.26",
                f"-c {codec}",
                extra_encoder_args,
            ],
        ),
    )


def runVideo2xCommand(
    cs: ClipperState,
    mp: DictStrAny,
    mps: DictStrAny,
    video_codec_args: str,
) -> DictStrAny:
    cp = cs.clipper_paths

    pre_v2x_path = mp["filePath"]
    final_path = mp["v2xFinalFilePath"]

    args_str = buildVideo2xArgs(pre_v2x_path, final_path, mp, mps, video_codec_args)

    # video2x doesn't have a separate overwrite flag; if the final exists and
    # overwrite is off, skip (we already guarded this via mp["exists"])

    args = [cp.video2xPath]
    args.extend(shlex.split(args_str))

    fileName = rich.markup.escape(mp["fileName"])
    logger.info(f"Running video2x for motion interpolation: {fileName}")
    logger.verbose(f"Using video2x command: {rich.markup.escape(' '.join(args))}\n")

    try:
        process = subprocess.run(
            args=args,
            check=False,
        )
    except FileNotFoundError:
        logger.error(
            f"video2x not found at '{cp.video2xPath}'. "
            "Motion interpolation requires video2x to be installed. "
            "Download the _full release zip (includes video2x in bin/video2x/) "
            "or install video2x manually. For direct clipper script usage ensure video2x is on your system PATH.",
        )
        mp["returncode"] = 1
        return mp

    mp = {**mp, "filePath": final_path}

    if process.returncode == 0:
        logger.success(f'video2x successfully generated: "{fileName}"')
    elif process.returncode == 3221225477:
        if Path(final_path).is_file() and Path(final_path).stat().st_size > 0:
            logger.verbose(f"video2x succeeded with warnings. (status code: {process.returncode})")
    else:
        logger.error(
            f'video2x failed for: "{fileName}" (error code: {process.returncode}).',
        )
        mp["returncode"] = process.returncode

    return mp


def to_pairs(items: List[str]) -> List[Tuple[str, str]]:
    if len(items) % 2 != 0:
        raise ValueError("List length must be even")

    return list(zip(items[::2], items[1::2]))
