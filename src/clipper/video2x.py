import functools
import re
import shlex
import subprocess
from fractions import Fraction
from pathlib import Path

import rich.markup

from clipper.clipper_types import ClipperState, DictStrAny, argvPath
from clipper.ffmpeg_codec import VIDEO_ENCODERS
from clipper.log_helpers import LogPath, subprocess_block
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.VIDEO2X)

# The Windows release bundles only this model (VIDEO2X_MODELS in yt_clipper_ci.yml).
RIFE_MODEL = "rife-v4.26"

# The first yt_clipper build of video2x with --rife-tta-temporal.
TTA_MIN_VERSION = (6, 7, 0)


def exwmVersion(versionOutput: str) -> tuple[int, int, int] | None:
    """The version in `video2x --version` output of a yt_clipper (-exwm) build, or None for others."""
    match = re.search(r"(\d+)\.(\d+)\.(\d+)-exwm", versionOutput)
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def supportsTta(versionOutput: str) -> bool:
    """Whether `video2x --version` output names a yt_clipper (-exwm) build with temporal TTA."""
    version = exwmVersion(versionOutput)
    return version is not None and version >= TTA_MIN_VERSION


@functools.cache
def video2xSupportsTta(video2xPath: str) -> bool:
    try:
        output = subprocess.run(
            [video2xPath, "--version"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=30,
            check=False,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        # Interpolating without TTA is the 5.49 behavior, so an unreadable version falls back to it.
        output = ""
    supported = supportsTta(output)
    # A missing or upstream video2x fails the interpolation with its own error, so only an older
    # yt_clipper build gets this notice.
    if not supported and exwmVersion(output) is not None:
        path = rich.markup.escape(video2xPath)
        logger.notice(
            f"video2x at '{path}' is older than the yt_clipper build 6.7.0-exwm, so motion interpolation runs without temporal TTA.",
        )
    return supported


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
]


def buildVideo2xArgs(
    pre_v2x_path: str,
    final_path: str,
    mp: DictStrAny,
    mps: DictStrAny,
    video_codec_args: str,
    *,
    tta: bool,
) -> str:
    codec = VIDEO_ENCODERS[mps["videoCodec"]]

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

    videoFPS = Fraction(mps["r_frame_rate"])
    fpsMultiplier = mps["minterpFpsMultiplier"]
    targetFps = fpsMultiplier * videoFPS

    # The input keeps the source's frame timing, so fill every gap up to the target fps.
    fps_arg = f"--vfr-min-fps {float(targetFps)}"

    return " ".join(
        filter(
            None,
            [
                f'-i "{pre_v2x_path}"',
                f'-o "{final_path}"',
                fps_arg,
                "--processor rife",
                f"--rife-model {RIFE_MODEL}",
                "--rife-tta-temporal" if tta else "",
                "--preserve-metadata",
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

    tta = mps["minterpTta"] and video2xSupportsTta(argvPath(cp.video2xPath))
    args_str = buildVideo2xArgs(pre_v2x_path, final_path, mp, mps, video_codec_args, tta=tta)

    # video2x doesn't have a separate overwrite flag; if the final exists and
    # overwrite is off, skip (we already guarded this via mp["exists"])

    args = [argvPath(cp.video2xPath)]
    args.extend(shlex.split(args_str))

    file_log = LogPath(mp["fileName"])
    logger.info(f"Running video2x for motion interpolation: {file_log}")
    logger.verbose(f"Using video2x command: {rich.markup.escape(' '.join(args))}\n")

    try:
        with subprocess_block("video2x", logger=logger, action="motion interpolation") as block:
            process = subprocess.run(
                args=args,
                check=False,
            )
            block.set_returncode(process.returncode)
    except FileNotFoundError:
        logger.error(
            f"video2x not found at '{cp.video2xPath}'. "
            "Motion interpolation requires video2x to be installed. "
            "The Windows release zip includes video2x in bin/video-tools/. "
            "Otherwise install video2x manually. For direct clipper script usage ensure video2x is on your system PATH.",
        )
        mp["returncode"] = 1
        return mp

    mp = {**mp, "filePath": final_path}

    if process.returncode == 0:
        logger.success(f"video2x successfully generated: {file_log}")
    elif process.returncode == 3221225477:
        if Path(final_path).is_file() and Path(final_path).stat().st_size > 0:
            logger.verbose(f"video2x succeeded with warnings. (status code: {process.returncode})")
    else:
        logger.error(
            f"video2x failed for: {file_log} (error code: {process.returncode}).",
        )
        mp["returncode"] = process.returncode

    return mp


def to_pairs(items: list[str]) -> list[tuple[str, str]]:
    if len(items) % 2 != 0:
        raise ValueError("List length must be even")

    return list(zip(items[::2], items[1::2], strict=True))
