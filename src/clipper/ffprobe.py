import json
import shlex
import subprocess
import time
from fractions import Fraction
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
            ffprobeCommand = f'{cp.ffprobePath} "{videoURL}" {ffprobeFlags} '
            logger.debug(ffprobeCommand)
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

        ffprobeOutput: str = ffprobeOutput.decode("utf-8")  # type: ignore [assignment]
        logger.info("-" * 80)
        logger.info("Detecting video properties with ffprobe")
        logger.debug(f"ffprobeOutput={ffprobeOutput}")

        ffprobeData = json.loads(ffprobeOutput)
        ffprobeStreamData: dict = ffprobeData["streams"][0]

        if "bit_rate" in ffprobeData["format"]:
            bit_rate = int(int(ffprobeData["format"]["bit_rate"]) / 1000)

            if bit_rate > 0:
                ffprobeStreamData["bit_rate"] = int(
                    int(ffprobeData["format"]["bit_rate"]) / 1000,
                )
            else:
                logger.warning(f"Ignoring estimated bit rate from ffprobe as it is 0.")
        else:
            logger.warning(f"Could not find bit_rate in ffprobe results.")

        color_transfer = ffprobeStreamData.get("color_transfer")
        if not color_transfer:
            logger.warning(f"Could not find color_transfer in ffprobe results.")

        ffprobeStreamData["r_frame_rate"] = getFrameRate(
            ffprobeStreamData["r_frame_rate"],
            ffprobeStreamData.get("avg_frame_rate"),
        )

        settings["inputIsHDR"] = settings.get("inputIsHDR") or color_transfer in (
            "smpte2084",
            "arib-std-b67",
        )

        displayMatrixRotation = getDisplayMatrixRotation(ffprobeStreamData)

        if displayMatrixRotation:
            logger.notice(
                f"Input video includes a display-only rotation. To correct for cropping done with the display-only rotation, the input video width and height metadata will be swapped before processing.",
            )
            getInputRotationCorrection(
                displayMatrixRotation,
                ffprobeStreamData,
            )

        return ffprobeStreamData

    return None


def getDisplayMatrix(ffprobeStreamData: dict) -> Optional[dict]:
    sideDataList: Optional[list[dict]] = ffprobeStreamData.get("side_data_list")

    if not sideDataList:
        return None

    displayMatrix: list[dict] = list(
        filter(lambda data: data.get("side_data_type") == "Display Matrix", sideDataList),
    )

    return displayMatrix[0] if displayMatrix else None


def getDisplayMatrixRotation(ffprobeStreamData: dict) -> Optional[int]:
    displayMatrix = getDisplayMatrix(ffprobeStreamData)
    if not displayMatrix:
        return None

    return displayMatrix.get("rotation")


def getInputRotationCorrection(rotation: int, ffprobeStreamData: dict) -> None:
    if rotation in (-90, 90):
        ffprobeStreamData["width"], ffprobeStreamData["height"] = (
            ffprobeStreamData["height"],
            ffprobeStreamData["width"],
        )
    else:
        logger.warning(
            "Input video has a non-orthogonal display-only rotation (neither 90 nor -90 degrees). This is not currently corrected for.",
        )


def getFrameRate(
    r_frame_rate: Optional[str],
    avg_frame_rate: Optional[str],
    *,
    tolerance: float = 0.1,
) -> Optional[str]:
    """
    Return r_frame_rate if it is sufficiently close to avg_frame_rate,
    otherwise return avg_frame_rate.

    """
    if not r_frame_rate and not avg_frame_rate:
        logger.warning("ffprobe did not detect r_frame_rate or avg_frame_rate.")
        return None

    if not r_frame_rate:
        logger.warning("ffprobe did not detect r_frame_rate.")
        return avg_frame_rate

    if not avg_frame_rate:
        logger.warning("ffprobe did not detect avg_frame_rate.")
        return r_frame_rate

    try:
        r = Fraction(r_frame_rate)
        avg = Fraction(avg_frame_rate)
    except Exception as e:
        logger.warning(f"Could not parse ffprobe frame rate: {e}")
        return r_frame_rate

    # Relative difference
    diff = abs(r - avg) / avg

    if diff <= tolerance:
        frame_rate = r_frame_rate
    else:
        logger.notice(
            f"r_frame_rate differs significantly from avg_frame_rate. Using avg_frame_rate instead. r_frame_rate={float(r)}, avg_frame_rate={float(avg)}",
        )
        frame_rate = avg_frame_rate

    return frame_rate
