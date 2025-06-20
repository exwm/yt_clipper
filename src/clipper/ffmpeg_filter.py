import sys
from fractions import Fraction
from functools import reduce
from math import floor, log
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple, Union

from clipper import util
from clipper.clipper_types import (
    ClipperState,
    CropMap,
    DictStrAny,
    ExtendedRealNumber,
    Settings,
    SpeedMap,
)
from clipper.ytc_logger import logger


def autoScaleCropMap(cropMap: List[Dict[str, Any]], settings: Settings) -> None:
    for cropPoint in cropMap:
        cropString = cropPoint["crop"]
        cropPoint["crop"], cropPoint["cropComponents"] = getAutoScaledCropComponents(
            cropString,
            settings,
        )


def getAutoScaledCropComponents(
    cropString: str,
    settings: Settings,
    forceEvenDimensions: bool = False,
) -> Tuple[str, Dict[str, float]]:
    cropResWidth = settings["cropResWidth"]
    cropResHeight = settings["cropResHeight"]
    cropComponents = getCropComponents(cropString, cropResWidth, cropResHeight)

    cropComponents["x"] = round(settings["cropMultipleX"] * cropComponents["x"])
    cropComponents["x"] = min(cropComponents["x"], settings["width"])
    cropComponents["w"] = round(settings["cropMultipleX"] * cropComponents["w"])
    cropComponents["w"] = min(cropComponents["w"], settings["width"])

    cropComponents["y"] = round(settings["cropMultipleY"] * cropComponents["y"])
    cropComponents["y"] = min(cropComponents["y"], settings["height"])
    cropComponents["h"] = round(settings["cropMultipleY"] * cropComponents["h"])
    cropComponents["h"] = min(cropComponents["h"], settings["height"])

    # We floor the width and height to even to get even dimension output
    # This is important as some services require even dimensions
    # For example, gfycat re-encodes odd dimension video usually with low quality
    if forceEvenDimensions:
        cropComponents["w"] = util.floorToEven(cropComponents["w"])
        cropComponents["h"] = util.floorToEven(cropComponents["h"])

    scaledCropString = f"""{cropComponents['x']}:{cropComponents['y']}:{cropComponents['w']}:{cropComponents['h']}"""

    return scaledCropString, cropComponents


def getCropComponents(
    cropString: str,
    maxWidth: int,
    maxHeight: int,
) -> Dict[str, float]:
    cropComponents: List[Any] = cropString.split(":")
    if cropComponents[2] == "iw":
        cropComponents[2] = maxWidth
    if cropComponents[3] == "ih":
        cropComponents[3] = maxHeight
    cropComponentsDict = {
        "x": float(cropComponents[0]),
        "y": float(cropComponents[1]),
        "w": float(cropComponents[2]),
        "h": float(cropComponents[3]),
    }
    return cropComponentsDict


def getMinterpFilter(mp: Dict[str, Any], mps: Dict[str, Any]) -> str:
    speedMap = mp["speedMap"]

    minterpFPS = mps["minterpFPS"]

    minterpEnable = []
    if minterpFPS is not None:
        outDurs = mp["outputDurations"]
        fps = Fraction(mps["r_frame_rate"])
        targetSpeed = minterpFPS / fps

        for sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
            startSpeed = left["y"]
            endSpeed = right["y"]
            speedChange = endSpeed - startSpeed

            logger.debug(
                f"speedChange: {speedChange}, startSpeed: {startSpeed}, targetSpeed: {round(targetSpeed, 2)}",
            )
            if speedChange != 0 or startSpeed < round(targetSpeed, 2):
                logger.debug(f'minterp enabled for section: {left["x"]}, {right["x"]}')
                sectStart = outDurs[sect]
                sectEnd = outDurs[sect + 1]
                minterpEnable.append(f"between(t,{sectStart},{sectEnd})")

    if mps["enableMinterpEnhancements"]:
        if len(minterpEnable) > 0:
            minterpEnable = f"""enable='{'+'.join(minterpEnable)}':"""
        else:
            minterpEnable = "enable=0:"
    else:
        minterpEnable = ""

    if minterpFPS is not None:
        minterpFilter = f""",minterpolate={minterpEnable}fps=({minterpFPS}):mi_mode=mci"""
        minterpFilter += f""":mc_mode=aobmc:me_mode=bidir:vsbmc=1"""
        sp = max(mps["minterpSearchParam"], 4)
        minterpFilter += f""":search_param={sp}:scd_threshold=8:mb_size=16"""
        if mps["enableMinterpEnhancements"]:
            minterpFilter += f""":fuovf=1:alpha_threshold=256"""
    else:
        minterpFilter = ""

    logger.debug(minterpFilter)
    return minterpFilter


def getMinterpFPS(
    mps: DictStrAny,
    speedMap: Union[SpeedMap, None],
) -> Union[ExtendedRealNumber, None]:
    minterpMode = mps["minterpMode"]
    if mps["r_frame_rate"] is None:
        return None
    videoFPS = Fraction(mps["r_frame_rate"])

    maxSpeed = getMaxSpeed(speedMap)
    maxFPS = maxSpeed * videoFPS

    minterpFPS = None
    if minterpMode == "Numeric" and "minterpFPS" in mps and mps["minterpFPS"] is not None:
        minterpFPS = min(120, mps["minterpFPS"])
    if minterpMode == "MaxSpeed":
        minterpFPS = maxFPS
    elif minterpMode == "VideoFPS":
        minterpFPS = videoFPS
    elif minterpMode == "MaxSpeedx2":
        minterpFPS = 2 * maxFPS
    elif minterpMode == "VideoFPSx2":
        minterpFPS = 2 * videoFPS

    return minterpFPS


def getMaxSpeed(speedMap: Union[SpeedMap, None]) -> float:
    maxSpeed = 0.05
    if speedMap is None:
        maxSpeed = 1
    else:
        for speedPoint in speedMap:
            maxSpeed = max(maxSpeed, speedPoint["y"])

    return maxSpeed


def getSubsFilter(
    cs: ClipperState,
    mp: DictStrAny,
    mps: DictStrAny,
    markerPairIndex: int,
) -> str:
    cp = cs.clipper_paths
    import webvtt

    subs_ext = Path(mps["subsFilePath"]).suffix
    if subs_ext == ".vtt":
        vtt = webvtt.read(mps["subsFilePath"])
    elif subs_ext == ".sbv":
        vtt = webvtt.from_sbv(mps["subsFilePath"])
    elif subs_ext == ".srt":
        vtt = webvtt.from_srt(mps["subsFilePath"])
    else:
        logger.critical(f"Uknown subtitle file extension {subs_ext}.")
        logger.critical("Only .vtt, .sbv, and .srt are supported for now.")
        sys.exit(1)

    subsStart = mp["start"]
    subsEnd = mp["end"]
    vtt._captions = [  # pylint: disable=protected-access
        c for c in vtt.captions if c.start_in_seconds < subsEnd and c.end_in_seconds > subsStart
    ]
    for _i, caption in enumerate(vtt.captions):
        start = caption.start_in_seconds
        end = caption.end_in_seconds
        caption.start = caption._to_timestamp(  # pylint: disable=protected-access
            max(start - subsStart, 0),
        )
        caption.end = caption._to_timestamp(  # pylint: disable=protected-access
            min(subsEnd - subsStart, end - subsStart),
        )
    tmp_subs_path = f'{cp.clipsPath}/subs/{mps["titleSuffix"]}-{markerPairIndex+1}.vtt'
    vtt.save(tmp_subs_path)
    subs_filter = f""",subtitles='{tmp_subs_path}':force_style='{mps["subsStyle"]}'"""

    return subs_filter


def getSpeedFilterAndDuration(
    speedMap: SpeedMap,
    mp: DictStrAny,
    fps: Union[float, Fraction],
) -> Tuple[str, ExtendedRealNumber, List[ExtendedRealNumber]]:
    if not mp["isVariableSpeed"]:
        duration = mp["duration"] / mp["speed"]
        return f'setpts=(PTS-STARTPTS)/{mp["speed"]}', duration, [0, duration]

    video_filter_speed_map = ""
    setpts = ""
    outputDurations: List[ExtendedRealNumber] = [0]

    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(speedMap) - 1
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]

    for sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
        startSpeed = left["y"]
        endSpeed = right["y"]
        speedChange = endSpeed - startSpeed

        sectStart = left["x"] - speedMapStartTime
        sectEnd = right["x"] - speedMapStartTime
        # Account for last input frame delay due to potentially imprecise trim
        if sect == nSects - 1:
            sectEnd = floor(right["x"] / frameDur) * frameDur
            # When trim is frame-precise, the frame that begins at the marker pair end time is not included
            if right["x"] - sectEnd < 1e-10:
                sectEnd = sectEnd - frameDur
            sectEnd = sectEnd - speedMapStartTime
            sectEnd = floor(sectEnd * 1000000) / 1000000

        nDurs = len(outputDurations)
        nextDur = 0
        sectDuration = sectEnd - sectStart
        if sectDuration == 0:
            nextDur = outputDurations[nDurs - 1]
            outputDurations.append(nextDur)
            continue

        m = speedChange / sectDuration
        b = startSpeed - m * sectStart

        if speedChange == 0:
            # Duration is time multiplied by slowdown (or time divided by speed)
            sliceDuration = f"(min((T-STARTT-({sectStart})),{sectDuration})/{endSpeed})"
            nextDur = (sectDuration / endSpeed) + outputDurations[nDurs - 1]
        else:
            # Integrate the reciprocal of the linear time vs speed function for the current section
            sliceDuration = f"(1/{m})*(log(abs({m}*min((T-STARTT),{sectEnd})+({b})))-log(abs({m}*{sectStart}+({b}))))"
            nextDur = (
                (1 / m) * (log(abs(m * sectEnd + b)) - log(abs(m * sectStart + b)))
            ) + outputDurations[nDurs - 1]

        outputDurations.append(nextDur)
        sliceDuration = f"if(gte((T-STARTT),{sectStart}), {sliceDuration},0)"

        if sect == 0:
            setpts += f"(if(eq(N,0),0,{sliceDuration}))"
        else:
            setpts += f"+({sliceDuration})"

    video_filter_speed_map += f"""setpts='({setpts})/TB' """

    nDurs = len(outputDurations)
    # Each output frame time is rounded to the nearest multiple of a frame's duration at the given fps
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] / frameDur) * frameDur
    # The last included frame is held for a single frame's duration
    outputDurations[nDurs - 1] += frameDur
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] * 1000) / 1000

    outputDuration = outputDurations[nDurs - 1]

    return video_filter_speed_map, outputDuration, outputDurations


def getAverageSpeed(speedMap: SpeedMap, fps: Union[float, Fraction]) -> float:
    fps = Fraction(fps)
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]

    averageSpeed = 0
    duration = 0
    for _sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
        startSpeed = left["y"]
        endSpeed = right["y"]

        sectStart = left["x"] - speedMapStartTime
        sectEnd = right["x"] - speedMapStartTime
        sectDuration = sectEnd - sectStart

        duration += sectDuration
        averageSpeed += ((startSpeed + endSpeed) / 2) * sectDuration

    averageSpeed = averageSpeed / duration

    return averageSpeed


def getCropFilter(
    crop: str,
    cropMap: CropMap,
    fps: Union[float, Fraction],
    easeType: str = "easeInOutSine",
) -> str:
    logger.info("-" * 80)
    fps = Fraction(fps)

    firstTime = cropMap[0]["x"]
    _, _, cropW, cropH = crop.split(":")
    cropXExpr = cropYExpr = ""

    easingsX = []
    easingsY = []
    for left, right in zip(cropMap[:-1], cropMap[1:]):
        startTime = left["x"] - firstTime
        startX, startY, _startW, _startH = left["crop"].split(":")
        endTime = right["x"] - firstTime
        endX, endY, _endW, _endH = right["crop"].split(":")

        sectDuration = endTime - startTime
        if sectDuration == 0:
            continue

        currEaseType = easeType if not right.get("easeIn", False) else right["easeIn"]

        easeP = f"((t-{startTime})/{sectDuration})"
        easeX = getEasingExpression(currEaseType, f"({startX})", f"({endX})", easeP)
        easeY = getEasingExpression(currEaseType, f"({startY})", f"({endY})", easeP)
        easingsX.append((startTime, endTime, easeX))
        easingsY.append((startTime, endTime, easeY))

    cropXExpr = getEaseFilterExpr(easingsX, timeExpr="t")
    cropYExpr = getEaseFilterExpr(easingsY, timeExpr="t")

    cropFilter = f"crop='x={cropXExpr}:y={cropYExpr}:w={cropW}:h={cropH}:exact=1'"

    return cropFilter


def getEaseFilterExpr(easings: List, timeExpr: Literal["t", "it"]) -> str:
    easeFilterExpr = [
        f"(gte({timeExpr}, {startTime})*lt({timeExpr}, {endTime})*{easeExpr})"
        for (startTime, endTime, easeExpr) in easings[:-1]
    ]
    (startTime, endTime, easeExpr) = easings[-1]
    easeFilterExpr.append(f"(between({timeExpr}, {startTime}, {endTime})*{easeExpr})")

    return "+".join(easeFilterExpr)


# zoompan's time variable is time instead of t
ZOOM_PAN_TIME_EXPR = "it"


def getZoomPanFilter(
    cropMap: CropMap,
    fps: Union[float, Fraction],
    easeType: str = "easeInOutSine",
    inputIsHDR: bool = False,
) -> Tuple[str, int]:
    maxSizeCrop = getMaxSizeCrop(cropMap)
    maxWidth = floorToEven(maxSizeCrop["width"])
    maxHeight = floorToEven(maxSizeCrop["height"])
    maxSize = maxWidth * maxHeight

    fps = Fraction(fps)
    firstTime = cropMap[0]["x"]

    panXExpr = panYExpr = zoomExpr = zoomXExpr = zoomYExpr = ""

    # This scale constant is used in for prescaling the video before applying zoompan.
    # This reduces jitter caused by the rounding of the panning done by zoompan.
    # We need to account for this scaling in the calculation of the zoom and pan.
    if inputIsHDR:
        logger.warning(
            "Video dynamic zoom may be more jittery than expected because input video is HDR and a workaround to reduce zoom jitter cannot be used with HDR video.",
        )
    panScale = 1
    zoomScale = 1 if inputIsHDR else 4

    easingsPanRight = []
    easingsPanBottom = []
    easingsZoomX = []
    easingsZoomY = []
    easingsZoom = []

    for left, right in zip(cropMap[:-1], cropMap[1:]):
        startTime = left["x"] - firstTime
        startX, startY, startW, startH = left["crop"].split(":")
        endTime = right["x"] - firstTime
        endX, endY, endW, endH = right["crop"].split(":")
        startRight = float(startX) + float(startW)
        startBottom = float(startY) + float(startH)
        endRight = float(endX) + float(endW)
        endBottom = float(endY) + float(endH)

        startZoom = maxWidth / float(startW)
        endZoom = maxWidth / float(endW)

        sectDuration = endTime - startTime
        if sectDuration == 0:
            continue

        currEaseType = easeType if not right.get("easeIn", False) else right["easeIn"]

        # zoompan does not support zooming out or changing aspect ratio without stretching.
        # By cropping the video first we can get the desired aspect ratio.
        # Additionally we can zoom in more (up to 10x) if we apply cropping before zoompan.
        # We crop using the largest crop point's width and height.
        # We pan this maximum crop such that it always contains the target crop.
        # The x:y coordinates of the top-left of this maximum crop is such that
        # it is always the top-left most position that still contains the target crop.
        panEaseP = f"((t-{startTime})/{sectDuration})"
        panEaseRight = getEasingExpression(
            currEaseType,
            f"({panScale}*{startRight})",
            f"({panScale}*{endRight})",
            panEaseP,
        )
        panEaseBottom = getEasingExpression(
            currEaseType,
            f"({panScale}*{startBottom})",
            f"({panScale}*{endBottom})",
            panEaseP,
        )

        # Ensure that the containing maximum crop does not go out of the video bounds.
        panEaseRight = f"max({panEaseRight}-{panScale}*{maxWidth}, 0)"
        panEaseBottom = f"max({panEaseBottom}-{panScale}*{maxHeight}, 0)"

        easeP = f"(({ZOOM_PAN_TIME_EXPR}-{startTime})/{sectDuration})"
        easeZoom = getEasingExpression(
            currEaseType,
            f"({startZoom})",
            f"({endZoom})",
            easeP,
        )
        easeX = getEasingExpression(
            currEaseType,
            f"({zoomScale}*{startX})",
            f"({zoomScale}*{endX})",
            easeP,
        )
        easeY = getEasingExpression(
            currEaseType,
            f"({zoomScale}*{startY})",
            f"({zoomScale}*{endY})",
            easeP,
        )

        easeRight = getEasingExpression(
            currEaseType,
            f"({zoomScale}*{startRight})",
            f"({zoomScale}*{endRight})",
            easeP,
        )
        easeBottom = getEasingExpression(
            currEaseType,
            f"({zoomScale}*{startBottom})",
            f"({zoomScale}*{endBottom})",
            easeP,
        )

        containingX = f"max({easeRight}-{zoomScale}*{maxWidth}, 0)"
        containingY = f"max({easeBottom}-{zoomScale}*{maxHeight}, 0)"

        # At each frame the target crop's x:y coordinates
        # are calculated relative to its containing crop.
        easeX = f"(({easeX})-({containingX}))"
        easeY = f"(({easeY})-({containingY}))"

        easingsPanRight.append((startTime, endTime, panEaseRight))
        easingsPanBottom.append((startTime, endTime, panEaseBottom))
        easingsZoom.append((startTime, endTime, easeZoom))
        easingsZoomX.append((startTime, endTime, easeX))
        easingsZoomY.append((startTime, endTime, easeY))

    panXExpr = getEaseFilterExpr(easingsPanRight, timeExpr="t")
    panYExpr = getEaseFilterExpr(easingsPanBottom, timeExpr="t")
    zoomExpr = getEaseFilterExpr(easingsZoom, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomXExpr = getEaseFilterExpr(easingsZoomX, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomYExpr = getEaseFilterExpr(easingsZoomY, timeExpr=ZOOM_PAN_TIME_EXPR)

    zoomPanFilter = ""
    targetSize = f"{round(1*maxWidth)}x{round(1*maxHeight)}"
    # Prescale filter to reduce jitter caused by the rounding of the panning done by zoompan.
    if panScale > 1:
        zoomPanFilter += f"scale=w={panScale}*iw:h={panScale}*ih,"
    zoomPanFilter += f"crop='x={panXExpr}:y={panYExpr}:w={panScale}*{maxWidth}:h={panScale}*{maxHeight}:exact=1',"
    if zoomScale > 1:
        zoomPanFilter += f"scale=w={zoomScale}*iw:h={zoomScale}*ih,"
    zoomPanFilter += f"zoompan=z='({zoomExpr})':x='{zoomXExpr}':y='{zoomYExpr}'"
    zoomPanFilter += f":d=1:s={targetSize}:fps={fps}"

    return zoomPanFilter, maxSize


def getMaxSizeCrop(cropMap: CropMap) -> Dict[str, int]:
    def getSize(cropPoint: DictStrAny) -> Dict[str, int]:
        _, _, cropW, cropH = cropPoint["crop"].split(":")
        return {"width": int(float(cropW)), "height": int(float(cropH))}

    def getLargerCropSize(cropLeft: DictStrAny, cropRight: DictStrAny) -> DictStrAny:
        left = cropLeft["width"] * cropLeft["height"]
        right = cropRight["width"] * cropRight["height"]
        return cropLeft if left > right else cropRight

    maxSizeCrop = reduce(getLargerCropSize, map(getSize, cropMap))

    return maxSizeCrop


def floorToEven(x: Union[int, str, float]) -> int:
    x = int(x)
    return x & ~1


def getEasingExpression(
    easingFunc: str,
    easeA: str,
    easeB: str,
    easeP: str,
) -> Optional[str]:
    easeP = f"(clip({easeP},0,1))"
    easeT = f"(2*{easeP})"
    easeM = f"({easeP}-1)"

    if easingFunc == "instant":
        return f"if(lte({easeP},0),{easeA},{easeB})"
    if easingFunc == "linear":
        return f"lerp({easeA}, {easeB}, {easeP})"

    if easingFunc == "easeInCubic":
        ease = f"{easeP}^3"
    elif easingFunc == "easeOutCubic":
        ease = f"1+{easeM}^3"
    elif easingFunc == "easeInOutCubic":
        ease = f"if(lt({easeT},1), {easeP}*{easeT}^2, 1+({easeM}^3)*4)"
    elif easingFunc == "easeInOutSine":
        ease = f"0.5*(1-cos({easeP}*PI))"
    elif easingFunc == "easeInCircle":
        ease = f"1-sqrt(1-{easeP}^2)"
    elif easingFunc == "easeOutCircle":
        ease = f"sqrt(1-{easeM}^2)"
    elif easingFunc == "easeInOutCircle":
        ease = f"if(lt({easeT},1), (1-sqrt(1-{easeT}^2))*0.5, (sqrt(1-4*{easeM}^2)+1)*0.5)"
    else:
        return None

    easingExpression = f"({easeA}+({easeB}-{easeA})*{ease})"
    return easingExpression


def videoStabilizationGammaFixFilter(filter_to_wrap: str) -> str:
    gammaCorrectionFactor = 0.6

    wrapped_filter = (
        f"lutyuv=y=gammaval({gammaCorrectionFactor}),"
        + filter_to_wrap
        + f",lutyuv=y=gammaval(1/{gammaCorrectionFactor})"
    )

    return wrapped_filter


def wrapVideoFilterForHardwareAcceleration(videoCodec: str, video_filter: str) -> str:
    if 'nvenc' in videoCodec:
        # Frame data is already in VRAM coming from the decoder, we use it to quickly convert to 4:4:4 yuv format to avoid chroma subsampling artifacts
        # After the filter chain, we upload the frame data back to VRAM unless the user supplied a custom filter that already does that
        video_filter_suffix = ",hwupload_cuda" if "hwupload" not in video_filter else ""
        return f"scale_cuda=format=yuv444p,hwdownload,format=yuv444p,{video_filter}{video_filter_suffix}"
    
    return f"format=nv12,hwupload,hwdownload,format=nv12,{video_filter},format=nv12,hwupload"


def isHardwareAcceleratedVideoCodec(codec: str) -> bool:
    return codec in {"h264_nvenc", "h264_vulkan"}
