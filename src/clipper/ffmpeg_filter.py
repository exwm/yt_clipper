import sys
from dataclasses import dataclass
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
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.FFMPEG_FILTER)


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

    scaledCropString = f"""{cropComponents["x"]}:{cropComponents["y"]}:{cropComponents["w"]}:{cropComponents["h"]}"""

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
                logger.debug(f"minterp enabled for section: {left['x']}, {right['x']}")
                sectStart = outDurs[sect]
                sectEnd = outDurs[sect + 1]
                minterpEnable.append(f"between(t,{sectStart},{sectEnd})")

    if mps["enableMinterpEnhancements"]:
        if len(minterpEnable) > 0:
            minterpEnable = f"""enable='{"+".join(minterpEnable)}':"""
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
    if mps["r_frame_rate"] is None:
        return None
    videoFPS = Fraction(mps["r_frame_rate"])

    maxClipSpeed = getMaxSpeed(speedMap)
    maxClipFPS = maxClipSpeed * videoFPS

    if mps["minterpFpsMultiplier"] > 0:
        return mps["minterpFpsMultiplier"] * videoFPS

    minterpFPS = None
    minterpMode = mps["minterpMode"]
    if minterpMode == "Numeric" and "minterpFPS" in mps and mps["minterpFPS"] is not None:
        minterpFPS = min(120, mps["minterpFPS"])

    if minterpMode == "MaxSpeed":
        minterpFPS = maxClipFPS
    elif minterpMode == "VideoFPS":
        minterpFPS = videoFPS
    elif minterpMode == "MaxSpeedx2":
        minterpFPS = 2 * maxClipFPS
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


def getMinSpeed(speedMap: Union[SpeedMap, None]) -> float:
    if speedMap is None:
        return 1.0
    return min(pt["y"] for pt in speedMap)


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
        logger.critical(f"Unknown subtitle file extension {subs_ext}.")
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
    tmp_subs_path = f"{cp.clipsPath}/subs/{mps['titleSuffix']}-{markerPairIndex + 1}.vtt"
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
        return f"setpts=(PTS-STARTPTS)/{mp['speed']}", duration, [0, duration]

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


def getAverageSpeed(speedMap: Optional[SpeedMap], fps: Union[float, Fraction]) -> float:
    if speedMap is None:
        return 1

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
    fps = Fraction(fps)

    firstTime = cropMap[0]["x"]
    _, _, cropW, cropH = crop.split(":")
    cropXExpr = cropYExpr = ""

    easingsX = []
    easingsY = []
    for i in range(len(cropMap) - 1):
        left = cropMap[i]
        right = cropMap[i + 1]
        startTime = left["x"] - firstTime
        startX, startY, _startW, _startH = left["crop"].split(":")
        endTime = right["x"] - firstTime

        endX, endY, _endW, _endH = right["crop"].split(":")

        currEaseType = easeType if not right.get("easeIn", False) else right["easeIn"]

        sectDuration = getSectionEaseDuration(currEaseType, startTime, endTime, float(fps))
        if sectDuration is None:
            continue

        easeP = f"((t-{startTime})/{sectDuration})"

        # The bracketing points shape the smooth-track tangents (ignored by the other modes).
        prev = _smoothTrackNeighbor(cropMap, i - 1, i, firstTime)
        nxt = _smoothTrackNeighbor(cropMap, i + 2, i + 2, firstTime)
        prevTime = prev["time"] if prev else None
        nextTime = nxt["time"] if nxt else None
        easeX = getSectionEasingExpression(
            currEaseType,
            f"({startX})",
            f"({endX})",
            easeP,
            prevValue=prev["x"] if prev else None,
            startValue=float(startX),
            endValue=float(endX),
            nextValue=nxt["x"] if nxt else None,
            prevTime=prevTime,
            startTime=startTime,
            endTime=endTime,
            nextTime=nextTime,
            sectDuration=sectDuration,
        )
        easeY = getSectionEasingExpression(
            currEaseType,
            f"({startY})",
            f"({endY})",
            easeP,
            prevValue=prev["y"] if prev else None,
            startValue=float(startY),
            endValue=float(endY),
            nextValue=nxt["y"] if nxt else None,
            prevTime=prevTime,
            startTime=startTime,
            endTime=endTime,
            nextTime=nextTime,
            sectDuration=sectDuration,
        )

        # Gate on the real endTime, not the duration-adjusted one, so the section timeline
        # has no gaps between consecutive sections.
        easingsX.append((startTime, endTime, easeX))
        easingsY.append((startTime, endTime, easeY))

    if not easingsX:
        # Every section had non-positive duration (all crop points share a time): nothing to
        # ease, so emit a static crop from the first point rather than build an empty expression.
        startX, startY, _startW, _startH = cropMap[0]["crop"].split(":")
        return getStaticCropFilter(startX, startY, cropW, cropH)

    cropXExpr = getEaseFilterExpr(easingsX, timeExpr="t")
    cropYExpr = getEaseFilterExpr(easingsY, timeExpr="t")

    cropFilter = f"crop='x={cropXExpr}:y={cropYExpr}:w={cropW}:h={cropH}:exact=1'"

    return cropFilter


def getStaticCropFilter(x: str, y: str, w: str, h: str) -> str:
    return f"crop='x={x}:y={y}:w={w}:h={h}:exact=1'"


def getEaseFilterExpr(easings: List, timeExpr: Literal["t", "it"]) -> str:
    # Callers guard against an empty easings list (a fully zero-duration crop map) before here.
    easeFilterExpr = [
        f"(gte({timeExpr}, {startTime})*lt({timeExpr}, {endTime})*{easeExpr})"
        for (startTime, endTime, easeExpr) in easings[:-1]
    ]
    (startTime, endTime, easeExpr) = easings[-1]
    easeFilterExpr.append(f"(between({timeExpr}, {startTime}, {endTime})*{easeExpr})")

    return "+".join(easeFilterExpr)


# it for input time
ZOOM_PAN_TIME_EXPR = "it"


def getZoomPanFilter(
    cropMap: CropMap,
    fps: Union[float, Fraction],
    easeType: str = "easeInOutSine",
    inputIsHDR: bool = False,
    frameWidth: Optional[float] = None,
    frameHeight: Optional[float] = None,
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

    for i in range(len(cropMap) - 1):
        left = cropMap[i]
        right = cropMap[i + 1]
        startTime = left["x"] - firstTime
        startX, startY, startW, startH = left["crop"].split(":")
        endTime = right["x"] - firstTime

        endX, endY, endW, endH = right["crop"].split(":")

        currEaseType = easeType if not right.get("easeIn", False) else right["easeIn"]

        sectDuration = getSectionEaseDuration(currEaseType, startTime, endTime, float(fps))
        if sectDuration is None:
            continue

        # The bracketing points shape the smooth-track tangents (ignored by the other modes); each
        # eased quantity derives its own neighbor values via _zoomPanSectionEase.
        prev = _smoothTrackNeighbor(cropMap, i - 1, i, firstTime)
        nxt = _smoothTrackNeighbor(cropMap, i + 2, i + 2, firstTime)
        ctx = _SectionEaseContext(
            easeType=currEaseType,
            prev=prev,
            nxt=nxt,
            startTime=startTime,
            endTime=endTime,
            sectDuration=sectDuration,
            frameWidth=frameWidth,
            frameHeight=frameHeight,
        )

        # zoompan does not support zooming out or changing aspect ratio without stretching.
        # By cropping the video first we can get the desired aspect ratio.
        # Additionally we can zoom in more (up to 10x) if we apply cropping before zoompan.
        # We crop using the largest crop point's width and height.
        # We pan this maximum crop such that it always contains the target crop.
        # The x:y coordinates of the top-left of this maximum crop is such that
        # it is always the top-left most position that still contains the target crop.
        panEaseP = f"((t-{startTime})/{sectDuration})"
        startCrop = {"x": float(startX), "y": float(startY), "w": float(startW), "h": float(startH)}
        endCrop = {"x": float(endX), "y": float(endY), "w": float(endW), "h": float(endH)}
        panEaseRight = _zoomPanEdgeEase(ctx, panEaseP, panScale, "right", startCrop, endCrop)
        panEaseBottom = _zoomPanEdgeEase(ctx, panEaseP, panScale, "bottom", startCrop, endCrop)

        # Ensure that the containing maximum crop does not go out of the video bounds.
        panEaseRight = f"max({panEaseRight}-{panScale}*{maxWidth}, 0)"
        panEaseBottom = f"max({panEaseBottom}-{panScale}*{maxHeight}, 0)"

        easeP = f"(({ZOOM_PAN_TIME_EXPR}-{startTime})/{sectDuration})"
        # Derive the zoom factor from the eased crop width (maxWidth / w), matching the preview,
        # which interpolates the width. Easing the zoom factor maxWidth/w directly diverges mid
        # transition because 1/w is nonlinear; only the endpoints agree either way.
        easeW = _zoomPanSectionEase(
            ctx,
            f"({startW})",
            f"({endW})",
            easeP,
            1,
            "w",
            float(startW),
            float(endW),
        )
        easeZoom = f"({maxWidth}/({easeW}))"
        easeX = _zoomPanSectionEase(
            ctx,
            f"({zoomScale}*{startX})",
            f"({zoomScale}*{endX})",
            easeP,
            zoomScale,
            "x",
            float(startX),
            float(endX),
        )
        easeY = _zoomPanSectionEase(
            ctx,
            f"({zoomScale}*{startY})",
            f"({zoomScale}*{endY})",
            easeP,
            zoomScale,
            "y",
            float(startY),
            float(endY),
        )
        easeX = _keepInFrame(ctx, easeX, easeP, zoomScale, "x", startCrop, endCrop)
        easeY = _keepInFrame(ctx, easeY, easeP, zoomScale, "y", startCrop, endCrop)

        easeRight = _zoomPanEdgeEase(ctx, easeP, zoomScale, "right", startCrop, endCrop)
        easeBottom = _zoomPanEdgeEase(ctx, easeP, zoomScale, "bottom", startCrop, endCrop)

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

    if not easingsZoom:
        # All sections had non-positive duration (degenerate crop map): nothing to animate, so
        # emit a static crop from the first point rather than build empty expressions.
        startX, startY, startW, startH = cropMap[0]["crop"].split(":")
        return getStaticCropFilter(startX, startY, startW, startH), maxSize

    panXExpr = getEaseFilterExpr(easingsPanRight, timeExpr="t")
    panYExpr = getEaseFilterExpr(easingsPanBottom, timeExpr="t")
    zoomExpr = getEaseFilterExpr(easingsZoom, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomXExpr = getEaseFilterExpr(easingsZoomX, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomYExpr = getEaseFilterExpr(easingsZoomY, timeExpr=ZOOM_PAN_TIME_EXPR)

    zoomPanFilter = ""
    targetSize = f"{round(1 * maxWidth)}x{round(1 * maxHeight)}"
    # Prescale filter to reduce jitter caused by the rounding of the panning done by zoompan.
    if panScale > 1:
        zoomPanFilter += f"scale=w={panScale}*iw:h={panScale}*ih,"
    zoomPanFilter += f"crop='x={panXExpr}:y={panYExpr}:w={panScale}*{maxWidth}:h={panScale}*{maxHeight}:exact=1',"
    if zoomScale > 1:
        zoomPanFilter += f"scale=w={zoomScale}*iw:h={zoomScale}*ih,"
    zoomPanFilter += f"zoompan=z='({zoomExpr})':x='{zoomXExpr}':y='{zoomYExpr}'"
    zoomPanFilter += f":d=1:s={targetSize}:fps={fps}"

    return zoomPanFilter, maxSize


def _scaleTriple(coeffs: List[Any], scale: float) -> List[float]:
    return [scale * float(coeffs[0]), scale * float(coeffs[1]), scale * float(coeffs[2])]


def _addTriples(a: List[float], b: List[float]) -> List[float]:
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]


def _cropPathPolyExpr(coeffs: List[float], timeExpr: str, startT: float, scale: float = 1.0) -> str:
    # scale*(c0 + c1*u + c2*u^2) with u = timeExpr - startT, matching evalCropPathAtTime (the markup).
    c2 = scale * coeffs[2]
    c1 = scale * coeffs[1]
    c0 = scale * coeffs[0]
    u = f"({timeExpr}-{startT})"
    return f"(({_fmtEaseNum(c2)})*{u}^2+({_fmtEaseNum(c1)})*{u}+({_fmtEaseNum(c0)}))"


def _quadMaxOnSpan(coeffs: List[float], span: float) -> float:
    # The maximum of c0 + c1*u + c2*u^2 over u in [0, span] (endpoints, plus the vertex if it is an
    # interior maximum). Used to size the containing crop so it bounds the path's width/height.
    c0, c1, c2 = coeffs[0], coeffs[1], coeffs[2]
    candidates = [c0, c0 + c1 * span + c2 * span * span]
    if c2 < 0:
        vertex = -c1 / (2 * c2)
        if 0 < vertex < span:
            candidates.append(c0 + c1 * vertex + c2 * vertex * vertex)
    return max(candidates)


def getCropPathFilter(
    cropPath: Dict[str, Any],
    settings: Settings,
    fps: Union[float, Fraction],
    inputIsHDR: bool = False,
) -> Tuple[str, int]:
    """Render a baked cinematic crop path (cinematic-path.ts) as an ffmpeg crop/zoompan filter.

    The path's per-segment quadratics are in cropRes pixels; scale them to output pixels by the same
    per-axis cropMultiple that autoScaleCropMap applies to crop points, so the render matches the
    markup preview. A constant-size path uses a plain crop; a path whose size varies routes through
    zoompan, mirroring getZoomPanFilter.
    """
    fps = Fraction(fps)
    mX = settings["cropMultipleX"]
    mY = settings["cropMultipleY"]

    scaled = [
        {
            "startT": float(seg["startT"]),
            "endT": float(seg["endT"]),
            "x": _scaleTriple(seg["x"], mX),
            "y": _scaleTriple(seg["y"], mY),
            "w": _scaleTriple(seg["w"], mX),
            "h": _scaleTriple(seg["h"], mY),
        }
        for seg in cropPath["segments"]
    ]

    # Zoom when the size varies by more than a pixel across the path, else a constant-size pan.
    widths = []
    for s in scaled:
        span = s["endT"] - s["startT"]
        # The smallest width too, not the start width: a segment that zooms in ends narrower.
        widths.append(-_quadMaxOnSpan([-c for c in s["w"]], span))
        widths.append(_quadMaxOnSpan(s["w"], span))
    isZoom = (max(widths) - min(widths)) > 0.5

    if not isZoom:
        easingsX = [(s["startT"], s["endT"], _cropPathPolyExpr(s["x"], "t", s["startT"])) for s in scaled]
        easingsY = [(s["startT"], s["endT"], _cropPathPolyExpr(s["y"], "t", s["startT"])) for s in scaled]
        cropXExpr = getEaseFilterExpr(easingsX, timeExpr="t")
        cropYExpr = getEaseFilterExpr(easingsY, timeExpr="t")
        # Even, as the other crop paths make it: libx264's yuv420p rejects an odd width or height.
        w = floorToEven(round(scaled[0]["w"][0]))
        h = floorToEven(round(scaled[0]["h"][0]))
        cropFilter = f"crop='x={cropXExpr}:y={cropYExpr}:w={w}:h={h}:exact=1'"
        return cropFilter, w * h

    # Zoom path: the containing max crop in t, then a 4x prescale and zoompan in it, mirroring
    # getZoomPanFilter but with the baked polynomials in place of the per-section eased values.
    panScale = 1
    zoomScale = 1 if inputIsHDR else 4
    # Round off the solver's float noise first, or a size of 95.9999 on one machine floors to 94.
    maxWidth = floorToEven(
        round(max(_quadMaxOnSpan(s["w"], s["endT"] - s["startT"]) for s in scaled), 6)
    )
    maxHeight = floorToEven(
        round(max(_quadMaxOnSpan(s["h"], s["endT"] - s["startT"]) for s in scaled), 6)
    )
    maxSize = maxWidth * maxHeight

    easingsPanRight = []
    easingsPanBottom = []
    easingsZoom = []
    easingsZoomX = []
    easingsZoomY = []
    for s in scaled:
        startT = s["startT"]
        endT = s["endT"]
        right = _addTriples(s["x"], s["w"])
        bottom = _addTriples(s["y"], s["h"])

        panRight = f"max({_cropPathPolyExpr(right, 't', startT, panScale)}-{panScale}*{maxWidth}, 0)"
        panBottom = f"max({_cropPathPolyExpr(bottom, 't', startT, panScale)}-{panScale}*{maxHeight}, 0)"

        easeW = _cropPathPolyExpr(s["w"], ZOOM_PAN_TIME_EXPR, startT)
        easeZoom = f"({maxWidth}/({easeW}))"
        easeX = _cropPathPolyExpr(s["x"], ZOOM_PAN_TIME_EXPR, startT, zoomScale)
        easeY = _cropPathPolyExpr(s["y"], ZOOM_PAN_TIME_EXPR, startT, zoomScale)
        easeRight = _cropPathPolyExpr(right, ZOOM_PAN_TIME_EXPR, startT, zoomScale)
        easeBottom = _cropPathPolyExpr(bottom, ZOOM_PAN_TIME_EXPR, startT, zoomScale)
        containingX = f"max({easeRight}-{zoomScale}*{maxWidth}, 0)"
        containingY = f"max({easeBottom}-{zoomScale}*{maxHeight}, 0)"
        easeX = f"(({easeX})-({containingX}))"
        easeY = f"(({easeY})-({containingY}))"

        easingsPanRight.append((startT, endT, panRight))
        easingsPanBottom.append((startT, endT, panBottom))
        easingsZoom.append((startT, endT, easeZoom))
        easingsZoomX.append((startT, endT, easeX))
        easingsZoomY.append((startT, endT, easeY))

    panXExpr = getEaseFilterExpr(easingsPanRight, timeExpr="t")
    panYExpr = getEaseFilterExpr(easingsPanBottom, timeExpr="t")
    zoomExpr = getEaseFilterExpr(easingsZoom, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomXExpr = getEaseFilterExpr(easingsZoomX, timeExpr=ZOOM_PAN_TIME_EXPR)
    zoomYExpr = getEaseFilterExpr(easingsZoomY, timeExpr=ZOOM_PAN_TIME_EXPR)

    targetSize = f"{round(panScale * maxWidth)}x{round(panScale * maxHeight)}"
    zoomPanFilter = ""
    if panScale > 1:
        zoomPanFilter += f"scale=w={panScale}*iw:h={panScale}*ih,"
    zoomPanFilter += (
        f"crop='x={panXExpr}:y={panYExpr}:w={panScale}*{maxWidth}:h={panScale}*{maxHeight}:exact=1',"
    )
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


def getFrameTimeBetweenLeftFrames(time: float, fps: float) -> float:
    """The ease section end time to use for a crop keyframe placed at `time`.

    A keyframe's time is user-placed and usually overshoots its actual frame. Ending the ease
    just before that frame keeps the normalized ease time reaching 1 by the time playback hits
    the frame, so the transition finishes on it. It shows most for instant ease in, whose
    jump must land on that frame. Landing between frames instead of snapping to a frame boundary
    also avoids float precision issues.
    """
    leftFrameIndex = floor(time * fps)

    midpointTime = (leftFrameIndex - 0.5) / fps

    return midpointTime


def getEaseSectionDuration(
    startTime: float,
    endTime: float,
    fps: float,
) -> Optional[float]:
    realDuration = endTime - startTime
    # Zero/negative duration sections (e.g. redundant hold point pairs) have no
    # frames to render, so skip them.
    if realDuration <= 0:
        return None

    # Pull the end time back toward the last displayed frame so the ease finishes on it
    # rather than at the (usually overshot) keyframe time. See getFrameTimeBetweenLeftFrames.
    adjustedDuration = getFrameTimeBetweenLeftFrames(endTime, fps) - startTime

    # For sections shorter than the adjustment window the adjusted end time can land before
    # the start time. Fall back to the real duration so the section still renders instead of
    # being dropped, which would leave a gap that snaps the crop to 0. Such a short section
    # skips the frame-time adjustment, so an instant ease in here transitions at the next point
    # rather than a frame earlier. That is acceptable since the section spans under ~1.5 frames.
    if adjustedDuration <= 0:
        return realDuration

    return adjustedDuration


def getSectionEaseDuration(
    easeType: str,
    startTime: float,
    endTime: float,
    fps: float,
) -> Optional[float]:
    """The span a section eases over. smoothTrack spans the points' real times, so its sections meet
    exactly and the crop keeps its speed through each point on any frame grid (the clip's frames start
    at the pair's own frame phase, not at multiples of 1/fps). A pulled-back end held it for part of a
    frame at every point. Mirrors the markup's getSmoothTrackCropComponentsAtTime."""
    if easeType == "smoothTrack":
        realDuration = endTime - startTime
        return realDuration if realDuration > 0 else None
    return getEaseSectionDuration(startTime, endTime, fps)


def getEasingExpression(
    easingFunc: str,
    easeA: str,
    easeB: str,
    easeP: str,
) -> Optional[str]:
    easeP = f"(clip({easeP},0,1))"
    easeT = f"(2*{easeP})"
    easeM = f"({easeP}-1)"

    # Hold the left point and then instantly transition to the right point once we reach it
    if easingFunc == "instant":
        return f"if(gte({easeP},1),{easeB},{easeA})"
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


# smoothTrack interpolates a crop component as a monotone cubic Hermite spline that flows THROUGH
# its points (a non-zero tangent at each, no overshoot), unlike the per-section easeInOutSine which
# stalls at every point. It is kept in sync with the markup (getSmoothTrackCropComponentsAtTime,
# crop-keyframe-math.ts) so the rendered crop matches the preview.


def resolveCropEaseType(cropPointEasing: Optional[str]) -> str:
    """Map the markers JSON crop easing mode to a crop filter easeType.

    Absent or "smoothInOut" maps to the original easeInOutSine, so clips without the field render
    exactly as before. "smoothTrack" maps to the cubic Hermite spline.
    """
    # A cinematic pair with no path to solve falls back to smoothTrack, as the preview does.
    if cropPointEasing in ("smoothTrack", "cinematic"):
        return "smoothTrack"
    return "easeInOutSine"


def _easeSign(value: float) -> int:
    return (value > 0) - (value < 0)


def _fmtEaseNum(value: float) -> str:
    # Fixed-point so large/small coefficients never reach ffmpeg in scientific notation.
    return f"{value:.6f}"


def getCropSectionTangent(
    beforeValue: Optional[float],
    pointValue: float,
    afterValue: Optional[float],
    beforeTime: Optional[float],
    pointTime: float,
    afterTime: Optional[float],
    monotone: bool,
) -> float:
    """The tangent (crop-units per second) at a crop point, from the slopes to its two neighbors.

    Returns 0 at a map end or across an instant break (a missing neighbor), which eases the whole
    move gently in/out. With ``monotone``, the Fritsch-Carlson rule keeps the section from
    overshooting the point: a reversal (neighbor slopes of opposite sign) or a flat zeroes the
    tangent, otherwise it is capped at 3x the smaller adjacent slope.
    """
    if beforeValue is None or beforeTime is None or afterValue is None or afterTime is None:
        return 0.0
    if afterTime == beforeTime:
        # Only crop points out of time order get here; there is no slope to follow.
        return 0.0
    central = (afterValue - beforeValue) / (afterTime - beforeTime)
    if not monotone:
        return central

    if pointTime in (beforeTime, afterTime):
        # A coincident-time neighbor (a redundant zero-duration point) has no defined secant; drop
        # the tangent so the section eases gently rather than dividing by zero.
        return 0.0
    secantBefore = (pointValue - beforeValue) / (pointTime - beforeTime)
    secantAfter = (afterValue - pointValue) / (afterTime - pointTime)
    if secantBefore == 0 or secantAfter == 0 or _easeSign(secantBefore) != _easeSign(secantAfter):
        return 0.0
    limit = 3 * min(abs(secantBefore), abs(secantAfter))
    return max(-limit, min(central, limit))


def getHermiteEasingExpression(
    startValue: float,
    endValue: float,
    startTangentScaled: float,
    endTangentScaled: float,
    easeP: str,
) -> str:
    # Cubic Hermite expanded to a*s^3 + b*s^2 + c*s + d so the (clipped) section progress s appears
    # only as the three powers. Tangents arrive pre-scaled by the section duration (the parameter dt).
    a = 2 * (startValue - endValue) + startTangentScaled + endTangentScaled
    b = 3 * (endValue - startValue) - 2 * startTangentScaled - endTangentScaled
    c = startTangentScaled
    d = startValue
    s = f"(clip({easeP},0,1))"
    return (
        f"(({_fmtEaseNum(a)})*{s}^3+({_fmtEaseNum(b)})*{s}^2"
        f"+({_fmtEaseNum(c)})*{s}+({_fmtEaseNum(d)}))"
    )


def getSectionEasingExpression(  # noqa: PLR0913 (one positional/keyword per eased component)
    easeType: str,
    easeA: str,
    easeB: str,
    easeP: str,
    *,
    prevValue: Optional[float],
    startValue: float,
    endValue: float,
    nextValue: Optional[float],
    prevTime: Optional[float],
    startTime: float,
    endTime: float,
    nextTime: Optional[float],
    sectDuration: float,
) -> Optional[str]:
    """The easing expression for one crop component over a section.

    For smoothTrack this is a neighbor-aware monotone cubic Hermite. Every other mode falls through to ``getEasingExpression`` unchanged.
    Callers pass ``prevValue`` / ``nextValue`` as None to drop the velocity at a map end
    or across an instant break.
    """
    if easeType != "smoothTrack":
        return getEasingExpression(easeType, easeA, easeB, easeP)

    # smoothTrack always clamps tangents (no overshoot).
    monotone = True
    startTangent = getCropSectionTangent(
        prevValue,
        startValue,
        endValue,
        prevTime,
        startTime,
        endTime,
        monotone,
    )
    endTangent = getCropSectionTangent(
        startValue,
        endValue,
        nextValue,
        startTime,
        endTime,
        nextTime,
        monotone,
    )
    return getHermiteEasingExpression(
        startValue,
        endValue,
        startTangent * sectDuration,
        endTangent * sectDuration,
        easeP,
    )


def _smoothTrackNeighbor(
    cropMap: CropMap,
    index: int,
    boundaryIndex: int,
    firstTime: float,
) -> Optional[Dict[str, float]]:
    """The parsed crop point at ``index`` for use as a spline tangent neighbor, or None.

    None when the index is off the map or the transition between the neighbor and the section is
    instant. ``boundaryIndex`` is the later point of that transition, whose easeIn describes it: the
    section start for the previous neighbor, the neighbor itself for the next one. Mirrors the
    markup's toSectionNeighbor.
    """
    if index < 0 or index >= len(cropMap):
        return None
    if cropMap[boundaryIndex].get("easeIn") == "instant":
        return None
    point = cropMap[index]
    x, y, w, h = point["crop"].split(":")
    return {
        "x": float(x),
        "y": float(y),
        "w": float(w),
        "h": float(h),
        "time": point["x"] - firstTime,
    }


def _derivedNeighborValue(
    neighbor: Optional[Dict[str, float]],
    scale: float,
    kind: str,
) -> Optional[float]:
    # The (scaled) value of a zoompan-eased quantity at a neighbor crop point, or None when there is
    # no neighbor. right/bottom are the linear x+w / y+h the pan crop tracks.
    if neighbor is None:
        return None
    value = {
        "x": neighbor["x"],
        "y": neighbor["y"],
        "w": neighbor["w"],
        "h": neighbor["h"],
        "right": neighbor["x"] + neighbor["w"],
        "bottom": neighbor["y"] + neighbor["h"],
    }[kind]
    return scale * value


@dataclass(frozen=True)
class _SectionEaseContext:
    """The per-section state every zoompan-eased quantity of one section shares."""

    easeType: str
    prev: Optional[Dict[str, float]]
    nxt: Optional[Dict[str, float]]
    startTime: float
    endTime: float
    sectDuration: float
    # The frame the crop moves in (output pixels), to keep a Smooth Track crop inside it.
    frameWidth: Optional[float] = None
    frameHeight: Optional[float] = None


def _zoomPanSectionEase(
    ctx: _SectionEaseContext,
    easeA: str,
    easeB: str,
    easeP: str,
    scale: float,
    kind: str,
    startDerived: float,
    endDerived: float,
) -> Optional[str]:
    # One zoompan-eased quantity for a section, routed through the shared easing dispatcher with the
    # neighbor values its spline tangents need.
    return getSectionEasingExpression(
        ctx.easeType,
        easeA,
        easeB,
        easeP,
        prevValue=_derivedNeighborValue(ctx.prev, scale, kind),
        startValue=scale * startDerived,
        endValue=scale * endDerived,
        nextValue=_derivedNeighborValue(ctx.nxt, scale, kind),
        prevTime=ctx.prev["time"] if ctx.prev else None,
        startTime=ctx.startTime,
        endTime=ctx.endTime,
        nextTime=ctx.nxt["time"] if ctx.nxt else None,
        sectDuration=ctx.sectDuration,
    )


def _keepInFrame(
    ctx: _SectionEaseContext,
    positionEase: Optional[str],
    easeP: str,
    scale: float,
    position: str,
    start: Dict[str, float],
    end: Dict[str, float],
) -> Optional[str]:
    """A (scaled) Smooth Track x or y kept inside the frame, as the preview keeps it.

    The spline eases the position and the size on their own, so on a zoom the crop can pass the
    frame edge between points. The other easings stay between their end crops, which are inside.
    """
    frame = ctx.frameWidth if position == "x" else ctx.frameHeight
    if ctx.easeType != "smoothTrack" or frame is None:
        return positionEase
    size = "w" if position == "x" else "h"
    sizeEase = _zoomPanSectionEase(
        ctx,
        f"({scale}*{start[size]})",
        f"({scale}*{end[size]})",
        easeP,
        scale,
        size,
        start[size],
        end[size],
    )
    return f"clip({positionEase},0,{scale}*{frame}-{sizeEase})"


def _zoomPanEdgeEase(
    ctx: _SectionEaseContext,
    easeP: str,
    scale: float,
    edge: str,
    start: Dict[str, float],
    end: Dict[str, float],
) -> Optional[str]:
    """The (scaled) eased right (x + w) or bottom (y + h) edge of a section's crop.

    The spline eases the position and the size and adds them, as the preview draws the crop: its
    clamped tangents are not linear, so easing the edge on its own drifts from x + w. The other
    easings are linear in their end values, so the edge eases directly, as it always has.
    """
    position, size = {"right": ("x", "w"), "bottom": ("y", "h")}[edge]
    if ctx.easeType == "smoothTrack":
        positionEase, sizeEase = (
            _zoomPanSectionEase(
                ctx,
                f"({scale}*{start[kind]})",
                f"({scale}*{end[kind]})",
                easeP,
                scale,
                kind,
                start[kind],
                end[kind],
            )
            for kind in (position, size)
        )
        positionEase = _keepInFrame(ctx, positionEase, easeP, scale, position, start, end)
        return f"({positionEase}+{sizeEase})"
    startEdge = start[position] + start[size]
    endEdge = end[position] + end[size]
    return _zoomPanSectionEase(
        ctx,
        f"({scale}*{startEdge})",
        f"({scale}*{endEdge})",
        easeP,
        scale,
        edge,
        startEdge,
        endEdge,
    )


def videoStabilizationGammaFixFilter(filter_to_wrap: str) -> str:
    gammaCorrectionFactor = 0.6

    wrapped_filter = (
        f"lutyuv=y=gammaval({gammaCorrectionFactor}),"
        + filter_to_wrap
        + f",lutyuv=y=gammaval(1/{gammaCorrectionFactor})"
    )

    return wrapped_filter
