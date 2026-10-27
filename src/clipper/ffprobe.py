import json
import shlex
import subprocess
import time
from fractions import Fraction
from typing import Optional

from clipper.clipper_types import ClipperState, DictStrAny
from clipper.pix_fmt_bit_depth import PIX_FMT_BIT_DEPTH_MAP
from clipper.platforms import getFfmpegHeaders
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.FFPROBE)


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

        statedRate, averageRate = ffprobeStreamData["r_frame_rate"], ffprobeStreamData.get("avg_frame_rate")
        ffprobeStreamData["r_frame_rate"] = getFrameRate(statedRate, averageRate)
        # Unless the header showed a varying rate, check a local video's frame times.
        rate = ffprobeStreamData["r_frame_rate"]
        if videoURL == settings.get("inputVideo") and rate and not headerRatesDiffer(statedRate, averageRate):
            origin = float(ffprobeStreamData.get("start_time") or 0)
            warnIfFramesOffGrid(cp.ffprobePath, videoURL, origin, Fraction(rate))

        settings["inputIsHDR"] = settings.get("inputIsHDR") or color_transfer in (
            "smpte2084",
            "arib-std-b67",
        )

        settings["inputPixelFormat"] = ffprobeStreamData.get("pix_fmt")
        # ffplay seeks from it (clip_maker's preview inputs).
        settings["inputStartTime"] = float(ffprobeData["format"].get("start_time") or 0)

        settings["inputBitDepth"] = getColorBitDepth(
            ffprobeStreamData,
            settings["inputPixelFormat"],
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

    if headerRatesDiffer(r_frame_rate, avg_frame_rate):
        logger.warning(
            " ".join(
                [
                    f"The video's frame rate varies (r_frame_rate={float(r):.3f}, avg_frame_rate={float(avg):.3f}).",
                    f"Clips use a constant {float(Fraction(frame_rate)):.3f} fps,",
                    "so where the video's frames stray from that rate, a clip's first or last frame and instant crop points can be a frame off.",
                ]
            ),
        )

    return frame_rate


def headerRatesDiffer(r_frame_rate: Optional[str], avg_frame_rate: Optional[str]) -> bool:
    """Whether ffprobe's two rates say the frame rate varies. Constant-rate videos report equal rates;
    0.1% leaves room for an average rounded like 29.97. WebM and MKV report equal rates either way."""
    try:
        r, avg = Fraction(r_frame_rate or ""), Fraction(avg_frame_rate or "")
        return abs(r - avg) / avg > Fraction(1, 1000)
    except (ValueError, ZeroDivisionError):
        return False


def offGridFrames(times: list[float], origin: float, rate: Fraction) -> int:
    """How many frame times sit more than a quarter frame from the grid origin + n / rate. Millisecond
    timestamps (WebM) stay well inside that."""
    frames = [(time - origin) * float(rate) for time in times]
    return sum(1 for frame in frames if abs(frame - round(frame)) > 0.25)


def warnIfFramesOffGrid(ffprobePath: str, videoPath: str, origin: float, rate: Fraction) -> None:
    """Warns when the local video's first 20 s of frame times stray from the grid that markers and crop
    points are mapped to. Reads packets only, without decoding."""
    # The path is its own argument, so no quoting can split it. ffprobePath is shell-quoted.
    command = shlex.split(
        f"{ffprobePath} -v error -select_streams v:0 -show_entries packet=pts_time -read_intervals %+20 -of csv=p=0"
    )
    try:
        output = subprocess.run([*command, videoPath], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        # Advisory only: the clip is made either way.
        logger.verbose(f"Could not read the input video's frame times: {e}")
        return
    times = [float(value) for value in output.split() if value not in ("", "N/A")]
    off = offGridFrames(times, origin, rate)
    if off:
        logger.warning(
            " ".join(
                [
                    f"The video's frame rate varies: {off} of its first {len(times)} frames are off its {float(rate):.3f} fps grid.",
                    "Clips use a constant frame rate,",
                    "so where the video's frames stray from it, a clip's first or last frame and instant crop points can be a frame off.",
                ]
            ),
        )


def getColorBitDepth(
    ffprobeStreamData: dict[str, str],
    pix_fmt: Optional[str],
) -> Optional[int]:
    if pix_fmt and pix_fmt in PIX_FMT_BIT_DEPTH_MAP:
        return PIX_FMT_BIT_DEPTH_MAP[pix_fmt]

    bits_per_raw_sample = ffprobeStreamData.get("bits_per_raw_sample")
    if bits_per_raw_sample and bits_per_raw_sample.isdigit():
        return int(bits_per_raw_sample)

    # Unknown or non-standard
    return None
