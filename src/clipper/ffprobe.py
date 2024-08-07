import json
import shlex
import subprocess
import time
from typing import Optional

from clipper.clipper_types import ClipperState, DictStrAny
from clipper.platforms import getFfmpegHeaders
from clipper.ytc_logger import logger


def ffprobeVideoProperties(cs: ClipperState, videoURL: str) -> Optional[DictStrAny]:
    cp = cs.clipper_paths
    settings = cs.settings

    ffprobeRetries = 3
    done = False
    while ffprobeRetries > 0 and not done:
        ffprobeRetries -= 1
        try:
            ffprobeFlags = " ".join(
                (
                    "-v quiet -select_streams v -print_format json -show_streams -show_format",
                    getFfmpegHeaders(settings["platform"]),
                ),
            )
            ffprobeCommand = f'"{cp.ffprobePath}" "{videoURL}" {ffprobeFlags} '
            ffprobeOutput = subprocess.check_output(shlex.split(ffprobeCommand))
            logger.success(f"Successfully fetched video properties with ffprobe")
            done = True
        except subprocess.CalledProcessError:
            logger.warning(f"Could not fetch video properties with ffprobe")
            if ffprobeRetries > 0:
                time.sleep(2)
                logger.info(
                    f"Trying {ffprobeRetries} more time(s) to fetch video properties with ffprobe",
                )
                continue
            return None

        ffprobeOutput = ffprobeOutput.decode("utf-8")
        logger.info("-" * 80)
        logger.info("Detecting video properties with ffprobe")
        ffprobeData = json.loads(ffprobeOutput)

        bit_rate = int(int(ffprobeData["format"]["bit_rate"]) / 1000)

        if bit_rate > 0:
            ffprobeData["streams"][0]["bit_rate"] = int(
                int(ffprobeData["format"]["bit_rate"]) / 1000,
            )
        else:
            logger.warning(f"Ignoring estimated bit rate from ffprobe as it is 0.")

        return ffprobeData["streams"][0]

    return None
