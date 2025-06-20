import contextlib
import os
import re
import shlex
import subprocess
import sys
from fractions import Fraction
from math import pi
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Set, Tuple

import rich
import rich.markup

from clipper.clipper_types import (
    BadMergeInput,
    ClipperPaths,
    ClipperState,
    DictStrAny,
    MissingMarkerPairFilePath,
    MissingMergeInput,
    Settings,
)
from clipper.ffmpeg_codec import getFfmpegVideoCodecArgs
from clipper.ffmpeg_filter import (
    autoScaleCropMap,
    getAutoScaledCropComponents,
    getAverageSpeed,
    getCropFilter,
    getEasingExpression,
    getMinterpFilter,
    getMinterpFPS,
    getSpeedFilterAndDuration,
    getSubsFilter,
    getZoomPanFilter,
    isHardwareAcceleratedVideoCodec,
    videoStabilizationGammaFixFilter,
    wrapVideoFilterForHardwareAcceleration,
)
from clipper.platforms import getFfmpegHeaders
from clipper.util import escapeSingleQuotesFFmpeg, getTrimmedBase64Hash
from clipper.ytc_logger import logger


def getMarkerPairSettings(  # noqa: PLR0912
    cs: ClipperState,
    markerPairIndex: int,
    skip: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    settings = cs.settings
    cp = cs.clipper_paths

    # marker pair properties
    mp: Dict[str, Any] = settings["markerPairs"][markerPairIndex]

    # marker pair settings
    mps: Dict[str, Any] = {**settings, **(mp["overrides"])}

    mp["exists"] = False
    if not mps["preview"]:
        if "titlePrefix" in mps:
            mps["titlePrefix"] = cleanFileName(mps["titlePrefix"])
        titlePrefix = f'{mps["titlePrefix"] + "-" if "titlePrefix" in mps else ""}'
        mp["fileNameStem"] = f'{titlePrefix}{mps["titleSuffix"]}-{markerPairIndex + 1}'

        if mps["fastTrim"]:
            if mps["inputVideo"]:
                mp["fileNameSuffix"] = Path(mps["inputVideo"]).suffix.removeprefix(".")
            else:
                mp["fileNameSuffix"] = mps["ext"]
        else:
            mp["fileNameSuffix"] = (
                "mp4" if mps["videoCodec"] in {"h264", "h264_nvenc", "h264_vulkan"} else "webm"
            )

        mp["fileName"] = f'{mp["fileNameStem"]}.{mp["fileNameSuffix"]}'
        mp["filePath"] = f'{cp.clipsPath}/{mp["fileName"]}'
        mp["exists"] = checkClipExists(
            mp["fileName"],
            mp["filePath"],
            mps["overwrite"],
            skip,
        )

        if mp["exists"] and not mps["overwrite"]:
            return (mp, mps)

    videoPartDelay = 0
    if mps["videoType"] == "multi_video":
        videoPart = findVideoPart(mp, mps)
        if videoPart:
            videoPartDelay = videoPart["start"]
            mp["videoPart"] = videoPart

    mp["start"] = mp["start"] + mps["delay"] - videoPartDelay
    mp["end"] = mp["end"] + mps["delay"] - videoPartDelay
    mp["duration"] = mp["end"] - mp["start"]

    mp["isVariableSpeed"] = False
    if mps["enableSpeedMaps"] and "speedMap" in mp:
        if mps["delay"] != 0:
            for point in mp["speedMap"]:
                point["x"] += mps["delay"]

        for left, right in zip(mp["speedMap"][:-1], mp["speedMap"][1:]):
            if left["y"] != right["y"]:
                mp["isVariableSpeed"] = True
                break
    else:
        mp["speedMap"] = [
            {"x": mp["start"], "y": mp["speed"]},
            {"x": mp["end"], "y": mp["speed"]},
        ]

    mp["speedFilter"], mp["outputDuration"], mp["outputDurations"] = getSpeedFilterAndDuration(
        mp["speedMap"],
        mp,
        mps["r_frame_rate"],
    )

    mp["averageSpeed"] = getAverageSpeed(mp["speedMap"], mps["r_frame_rate"])

    cropString, cropComponents = getAutoScaledCropComponents(
        mp["crop"],
        settings,
        forceEvenDimensions=True,
    )

    mp["crop"] = cropString
    mp["cropComponents"] = cropComponents

    if "enableCropMaps" not in mp:
        mps["enableCropMaps"] = True

    mp["isPanningCrop"] = False
    mp["isZoomPanCrop"] = False
    if mps["enableCropMaps"] and "cropMap" in mp:
        if mps["delay"] != 0:
            for point in mp["cropMap"]:
                point["x"] += mps["delay"]

        autoScaleCropMap(mp["cropMap"], settings)
        for left, right in zip(mp["cropMap"][:-1], mp["cropMap"][1:]):
            lcc = left["cropComponents"]
            rcc = right["cropComponents"]
            if lcc["x"] != rcc["x"] or lcc["y"] != rcc["y"]:
                mp["isPanningCrop"] = True
            if lcc["w"] != rcc["w"] or lcc["h"] != rcc["h"]:
                mp["isZoomPanCrop"] = True
                break
    else:
        mp["cropMap"] = [
            {
                "x": mp["start"],
                "y": 0,
                "crop": cropString,
                "cropComponents": cropComponents,
            },
            {
                "x": mp["end"],
                "y": 0,
                "crop": cropString,
                "cropComponents": cropComponents,
            },
        ]

    mp["maxSize"] = cropComponents["w"] * cropComponents["h"]
    if mp["isZoomPanCrop"]:
        mp["cropFilter"], mp["maxSize"] = getZoomPanFilter(
            cropMap=mp["cropMap"],
            fps=mps["r_frame_rate"],
            inputIsHDR=settings["inputIsHDR"],
        )
    elif mp["isPanningCrop"]:
        mp["cropFilter"] = getCropFilter(mp["crop"], mp["cropMap"], mps["r_frame_rate"])
    else:
        cc = cropComponents
        mp["cropFilter"] = f"""crop='x={cc["x"]}:y={cc["y"]}:w={cc["w"]}:h={cc["h"]}:exact=1'"""

    bitrateCropFactor = (mp["maxSize"]) / (settings["width"] * settings["height"])

    # relax bitrate crop factor assuming that most crops include complex parts
    # of the video and exclude simpler parts
    bitrateCropRelaxationFactor = 0.8
    bitrateCropFactor = min(1, bitrateCropFactor**bitrateCropRelaxationFactor)

    bitrateSpeedFactor = mp["averageSpeed"]
    mps["minterpFPS"] = getMinterpFPS(mps, mp["speedMap"])
    if mps["minterpFPS"] is not None:
        bitrateSpeedFactor = mps["minterpFPS"] / (
            mp["averageSpeed"] * Fraction(mps["r_frame_rate"])
        )
        bitrateSpeedFactor **= 0.5

    bitrateHDRFactor = 1.1 if mps["inputIsHDR"] else 1

    bitrateHardwareAccelerationFactor = (
        1.1 if isHardwareAcceleratedVideoCodec(mps["videoCodec"]) else 1
    )

    bitrateFactor = (
        min(1, bitrateCropFactor * bitrateSpeedFactor * bitrateHDRFactor)
        * bitrateHardwareAccelerationFactor
    )

    globalEncodeSettings = getDefaultEncodeSettings(mps["bit_rate"])
    autoMarkerPairEncodeSettings = getDefaultEncodeSettings(
        mps["bit_rate"] * bitrateFactor,
    )
    mps = {**globalEncodeSettings, **autoMarkerPairEncodeSettings, **mps}
    if "targetMaxBitrate" not in mps:
        mps["targetMaxBitrate"] = mps["autoTargetMaxBitrate"]

    titlePrefixLogMsg = f'Title Prefix: {mps.get("titlePrefix", "")}'
    logger.info("-" * 80)
    minterpFPSMsg = f'Target FPS: {mps["minterpFPS"]}, '
    logger.info(
        f"Marker Pair {markerPairIndex + 1} Settings: {titlePrefixLogMsg}, "
        + f'Video Codec: {mps["videoCodec"]}, CRF: {mps["crf"]} (0-63), Target Bitrate: {mps["targetMaxBitrate"]}, '
        + f"Bitrate Crop Factor: {bitrateCropFactor}, Bitrate Speed Factor {bitrateSpeedFactor}, "
        + f'Adjusted Target Max Bitrate: {mps["autoTargetMaxBitrate"]}kbps, '
        + f'Two-pass Encoding Enabled: {mps["twoPass"]}, Encoding Speed: {mps["encodeSpeed"]} (0-5), '
        + f'HDR (High Dynamic Range) Output Enabled: {mps["enableHDR"]}, '
        + f'Audio Enabled: {mps["audio"]}, Denoise: {mps["denoise"]["desc"]}, '
        + f'Marker Pair {markerPairIndex + 1} is of variable speed: {mp["isVariableSpeed"]}, '
        + f'Speed Maps Enabled: {mps["enableSpeedMaps"]}, '
        + f'Minterpolation Mode: {mps["minterpMode"]}, '
        + minterpFPSMsg
        + f'Special Looping: {mps["loop"]}, '
        + (f'Fade Duration: {mps["fadeDuration"]}s, ' if mps["loop"] == "fade" else "")
        + f'Final Output Duration: {mp["outputDuration"]}, '
        + f'Video Stabilization: {mps["videoStabilization"]["desc"]}, '
        + f"Video Stabilization Max Angle: "
        + (
            f'{mps["videoStabilizationMaxAngle"]} degrees, '
            if mps["videoStabilizationMaxAngle"] >= 0
            else "Unlimited, "
        )
        + f"Video Stabilization Max Shift: "
        + (
            f'{mps["videoStabilizationMaxShift"]} pixels, '
            if mps["videoStabilizationMaxShift"] >= 0
            else "Unlimited, "
        )
        + f'Video Stabilization Dynamic Zoom: {mps["videoStabilizationDynamicZoom"]}',
    )
    logger.info("-" * 80)

    return (mp, mps)


def findVideoPart(mp: DictStrAny, mps: DictStrAny) -> Optional[DictStrAny]:
    videoParts = []
    for videoPart in mps["videoParts"]:
        if mp["start"] >= videoPart["start"] and mp["end"] <= videoPart["end"]:
            videoParts.append(videoPart)  # noqa: PERF401
    if len(videoParts) == 1:
        return videoParts[0]

    return None


FFMPEG_NETWORK_INPUT_FLAGS = (
    r"-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5"
)


def fastTrimClip(
    cs: ClipperState,
    markerPairIndex: int,
    mp: DictStrAny,
    mps: DictStrAny,
) -> Optional[Dict[str, Any]]:
    settings = cs.settings
    cp = cs.clipper_paths
    inputs = ""

    if mp["isVariableSpeed"] or mps["loop"] != "none":
        mps["audio"] = False

    if mps["audio"]:
        aStart = mp["start"] + mps["audioDelay"]
        aEnd = mp["end"] + mps["audioDelay"]
        # aDuration = aEnd - aStart
        # ffplay previewing does not support multiple inputs
        # if an input video is provided or previewing is on, there is only one input
        if not mps["inputVideo"] and not settings["preview"]:
            inputs += FFMPEG_NETWORK_INPUT_FLAGS
            inputs += f' -ss {aStart} -to {aEnd} -i "{mps["audioDownloadURL"]}" '
        # when streaming the required chunks from the internet the video and audio inputs are separate
        else:
            mps["audio"] = False
            logger.warning(
                "Audio disabled when previewing without an input video over non-dash protocol.",
            )

    if not mps["inputVideo"]:
        inputs += FFMPEG_NETWORK_INPUT_FLAGS

    videoStart = mp["start"]
    videoEnd = mp["end"]
    if mps["inputVideo"]:
        inputs += f' -ss {videoStart} -to {videoEnd} -i "{mps["inputVideo"]}" '
    elif mps["videoType"] != "multi_video":
        inputs += f' -ss {videoStart} -to {videoEnd} -i "{mps["videoDownloadURL"]}" '
    elif "videoPart" in mp:
        videoPart = mp["videoPart"]
        inputs += f' -ss {videoStart} -to {videoEnd} -i "{videoPart["url"]}" '
    else:
        fileName = rich.markup.escape(mp["fileName"])
        logger.error(
            f'Failed to generate: "{fileName}". The marker pair defines a clip that spans multiple video parts which is not currently supported.',
        )
        return None

    ffmpegCommand = getFfmpegCommandFastTrim(cp, inputs, mp, mps)

    return runffmpegCommand(settings, [ffmpegCommand], markerPairIndex, mp)


def makeClip(cs: ClipperState, markerPairIndex: int) -> Optional[Dict[str, Any]]:  # noqa: PLR0912
    settings = cs.settings
    cp = cs.clipper_paths

    mp, mps = getMarkerPairSettings(cs, markerPairIndex)

    if mp["exists"] and not mps["overwrite"]:
        return {**(settings["markerPairs"][markerPairIndex]), **mp}

    if mps["fastTrim"]:
        logger.notice(
            f"Fast-trim enabled for marker pair {markerPairIndex}. Features that require re-encoding (including crop and speed) will be disabled.",
        )
        return fastTrimClip(cs, markerPairIndex, mp, mps)

    inputs = ""
    audio_filter = ""
    video_filter = ""

    if mp["isVariableSpeed"] or mps["loop"] != "none":
        mps["audio"] = False

    if mps["audio"]:
        aStart = mp["start"] + mps["audioDelay"]
        aEnd = mp["end"] + mps["audioDelay"]
        aDuration = aEnd - aStart
        # ffplay previewing does not support multiple inputs
        # if an input video is provided or previewing is on, there is only one input
        if not mps["inputVideo"] and not settings["preview"]:
            inputs += FFMPEG_NETWORK_INPUT_FLAGS
            inputs += f' -ss {aStart} -to {aEnd} -i "{mps["audioDownloadURL"]}" '

        # preview mode does not start each clip at time 0 unlike encoding mode
        if settings["preview"] and settings["inputVideo"]:
            audio_filter += f'atrim={aStart}:{aEnd},atempo={mp["speed"]}'
        # encoding mode starts each clip at time 0
        elif not settings["preview"]:
            audio_filter += f'atrim=0:{aDuration},atempo={mp["speed"]}'
            if mps["audioFade"] > 0:
                af = mps["audioFade"]
                audio_filter += f",afade=d={af},areverse,afade=d={af},areverse"
        # when streaming the required chunks from the internet the video and audio inputs are separate
        else:
            mps["audio"] = False
            logger.warning(
                "Audio disabled when previewing without an input video over non-dash protocol.",
            )
        if mps["extraAudioFilters"]:
            audio_filter += f',{mps["extraAudioFilters"]}'

    if not mps["inputVideo"]:
        inputs += FFMPEG_NETWORK_INPUT_FLAGS

    if mps["inputVideo"]:
        inputs += f' -ss {mp["start"]} -i "{mps["inputVideo"]}" '
    elif mps["videoType"] != "multi_video":
        inputs += f' -ss {mp["start"]} -i "{mps["videoDownloadURL"]}" '
    elif "videoPart" in mp:
        videoPart = mp["videoPart"]
        inputs += f' -ss {mp["start"]} -i "{videoPart["url"]}" '
    else:
        fileName = rich.markup.escape(mp["fileName"])
        logger.error(
            f'Failed to generate: "{fileName}". The marker pair defines a clip that spans multiple video parts which is not currently supported.',
        )
        return None

    qmax: int = max(min(mps["crf"] + 13, 63), 34)
    qmin: int = min(mps["crf"], 15)

    cbr = None
    if mps["targetSize"] > 0:
        cbr = mps["targetSize"] / mp["outputDuration"]
        logger.important(
            f"Forcing constant bitrate of ~{round(cbr, 3)} MBps "
            + f'({mps["targetSize"]} MB / ~{round(mp["outputDuration"],3)} s).',
        )

    ffmpegCommand = getFfmpegCommandWithoutVideoFilter(
        audio_filter,
        cbr,
        cp,
        inputs,
        mp,
        mps,
        qmax,
        qmin,
    )

    if not mps["preview"]:
        video_filter += f'trim=0:{mp["duration"]}'
    else:
        video_filter += f'trim={mp["start"]}:{mp["end"]}'

    if mps["preview"] and not settings["inputVideo"]:
        video_filter += f",loop=loop=-1:size=(32767)"

    cropComponents = mp["cropComponents"]
    # video_filter += f",mpdecimate=hi=64*2:lo=64:frac=0.1,setpts='(N/FR/TB)'"
    video_filter += f',{mp["cropFilter"]}'

    if mps["subsFilePath"] != "":
        video_filter += getSubsFilter(cs, mp, mps, markerPairIndex)

    if mps["preview"]:
        video_filter += f",scale=w=iw/2:h=ih/2"
        cropComponents["w"] /= 2
        cropComponents["h"] /= 2

    # if the marker pair crop is used after the filter then it should be rotated the same way
    if mps["rotate"] and mps["rotate"] != "0":
        video_filter += f',transpose={mps["rotate"]}'

    video_filter_before_correction = None
    if mps["preview"]:
        video_filter_before_correction = video_filter

    if mps["deinterlace"]:
        video_filter += f",bwdif"

    # Source videos with a high time base (eg 1/60 for 60 fps video)
    # can cause issues with later timestamp manipulations.
    # Thus we set the timebase to a low value (1/9000 as 9000 is a multiple of 24,25,30).
    video_filter += f",settb=1/9000"

    # Videos with no duplicate frames should not be adversely affected by frame deduplication.
    # Low fps video with 1 duplicated frame every N > 2 frames is essentially
    # of variable frame rate masked as a constant frame rate.
    # By removing duplicate frames and resetting timestamps based on the expected
    # constant frame rate, the stutter in the source input is eliminated.
    # High fps video may sometimes actually be low fps video with doubled frame rate
    # via frame duplication. Such videos should be passed through to avoid speeding
    # them up when resetting timestamps to the expected frame rate post-deduplication,
    # Assumes we do not have low fps video with frame doubling via frame duplication
    # or high fps video with duplicate frames every N > 2 frames.
    # We consider videos with less than 47 fps (24*2 - 1) to be of low fps as
    # the lowest common video fps is ~24 fps and with frame doubling is ~48 fps.
    shouldDedupe = not mps["noDedupe"] and (
        mps["dedupe"] or (mps["minterpFPS"] is not None and Fraction(mps["r_frame_rate"]) < 47)
    )
    if shouldDedupe:
        logger.info("Duplicate frames will be removed.")
        video_filter += f",mpdecimate=hi=64*8:lo=64*5:frac=0.1"
        video_filter += f",setpts=N/FR/TB"

    if 0 <= mps["gamma"] <= 4 and mps["gamma"] != 1:
        video_filter += f',lutyuv=y=gammaval({mps["gamma"]})'
    if mps["denoise"]["enabled"]:
        video_filter += f',hqdn3d=luma_spatial={mps["denoise"]["lumaSpatial"]}'
    # if mps["scale"]:
    #     video_filter += f'scale=w=2*iw:h=2*ih:flags=lanczos'

    # if mps["overlayPath"]:
    #     video_filter += f'[1:v]overlay=x=W-w-10:y=10:alpha=0.5'
    #     inputs += f'-i "{mps["overlayPath"]}"'

    if mps["extraVideoFilters"]:
        video_filter += f',{mps["extraVideoFilters"]}'

    loop_filter = ""
    if mps["loop"] != "fwrev":
        video_filter += f',{mp["speedFilter"]}'
    if mps["loop"] == "fwrev":
        reverseSpeedMap = [
            {"x": speedPoint["x"], "y": speedPointRev["y"]}
            for speedPoint, speedPointRev in zip(
                mp["speedMap"],
                reversed(mp["speedMap"]),
            )
        ]
        reverseSpeedFilter, _, _ = getSpeedFilterAndDuration(
            reverseSpeedMap,
            mp,
            mps["r_frame_rate"],
        )
        loop_filter = ""
        loop_filter += f",split=2[f1][f2];"
        loop_filter += f'[f1]{mp["speedFilter"]}[f];'
        loop_filter += f"""[f2]{reverseSpeedFilter},select='gt(n,0)',reverse,select='gt(n,0)',"""
        loop_filter += f"setpts=(PTS-STARTPTS)[r];"
        loop_filter += f"[f][r]concat=n=2"
    if mps["loop"] == "fade":
        fadeDur = mps["fadeDuration"] = max(
            0.1,
            min(mps["fadeDuration"], 0.4 * mp["outputDuration"]),
        )

        easeP = f"(T/{fadeDur})"
        alphaEaseOut = getEasingExpression("linear", "1", "0", easeP)
        alphaEaseIn = getEasingExpression("linear", "0", "1", easeP)

        loop_filter = ""
        loop_filter += f""",select='if(lte(t,{fadeDur}),1,2)':n=2[fia][mfia];"""
        loop_filter += (
            f"""[fia]format=yuva420p,geq=lum='p(X,Y)':a='{alphaEaseIn}*alpha(X,Y)'[fi];"""
        )
        loop_filter += f"""[mfia]setpts=(PTS-STARTPTS)[mfib];"""
        loop_filter += f"""[mfib]reverse,select='if(lte(t,{fadeDur}),1,2)':n=2[for][mr];"""
        loop_filter += f"""[mr]reverse,setpts=(PTS-STARTPTS)[m];"""
        loop_filter += (
            f"""[for]reverse,format=yuva420p,geq=lum='p(X,Y)':a='{alphaEaseOut}*alpha(X,Y)'[fo];"""
        )
        loop_filter += f"""[fi][fo]overlay=eof_action=repeat,setpts=(PTS-STARTPTS)[fl];"""
        loop_filter += f"""[m][fl]concat=n=2"""

    if mps["preview"]:
        if video_filter_before_correction is None:
            logger.error(
                "Preview mode unexpectedly did not have vidoe filters before corrections available.",
            )
            sys.exit(1)

        return runffplayCommand(
            cs,
            inputs,
            video_filter,
            video_filter_before_correction,
            audio_filter,
            markerPairIndex,
            mps,
        )

    ffmpegCommands = []

    MAX_VFILTER_SIZE = 10_000
    filterPathPass1 = f"{cp.clipsPath}/temp/vfilter-{markerPairIndex+1}-pass1.txt"
    filterPathPass2 = f"{cp.clipsPath}/temp/vfilter-{markerPairIndex+1}-pass2.txt"

    overwriteArg = " -y " if mps["overwrite"] else " -n "
    vidstabEnabled = mps["videoStabilization"]["enabled"]
    if vidstabEnabled:
        vidstab = mps["videoStabilization"]
        shakyPath = f"{cp.clipsPath}/shaky"
        os.makedirs(shakyPath, exist_ok=True)
        transformPath = f'{shakyPath}/{mp["fileNameStem"]}.trf'

        if not containsValidCharsForVidStab(transformPath):
            # TODO: Write titleSuffix to text file in safe temp work dir for reverse lookup from titleSuffix to hash
            titleSuffix = mps["titleSuffix"]
            titleSuffixHash = getTrimmedBase64Hash(titleSuffix)
            safeShakyPath = f"{cp.tempPath}/{titleSuffixHash}/shaky"
            logger.warning(
                f"Marker pair titleSuffix contains characters that are incompatible with video stabilization.",
            )
            logger.warning(
                f"Using temp directory for intermediate video stabilization transform files: '{safeShakyPath}'.",
            )
            os.makedirs(safeShakyPath, exist_ok=True)
            transformPath = f"{safeShakyPath}/{markerPairIndex+1}.trf"

        shakyClipPath = f'{shakyPath}/{mp["fileNameStem"]}-shaky.{mp["fileNameSuffix"]}'

        video_filter += "[shaky];[shaky]"
        vidstabdetectFilter = (
            video_filter
            + f"""vidstabdetect=result='{transformPath}':shakiness={vidstab["shakiness"]}"""
        )

        vidstabdetectFilter = videoStabilizationGammaFixFilter(vidstabdetectFilter)

        if mps["videoStabilizationMaxAngle"] < 0:
            mps["videoStabilizationMaxAngle"] = -1
        else:
            mps["videoStabilizationMaxAngle"] *= pi / 180
        if mps["videoStabilizationMaxShift"] < 0:
            mps["videoStabilizationMaxShift"] = -1

        vidstabtransformFilter = (
            video_filter
            + f"""vidstabtransform=input='{transformPath}':smoothing={vidstab["smoothing"]}"""
            + f""":maxangle={mps["videoStabilizationMaxAngle"]}"""
            + f""":maxshift={mps["videoStabilizationMaxShift"]}"""
        )

        if mps["videoStabilizationDynamicZoom"]:
            vidstabtransformFilter += f':optzoom=2:zoomspeed={vidstab["zoomspeed"]}'

        vidstabtransformFilter = videoStabilizationGammaFixFilter(vidstabtransformFilter)

        if "minterpMode" in mps and mps["minterpMode"] != "None":
            vidstabtransformFilter += getMinterpFilter(mp, mps)

        if mps["loop"] != "none":
            vidstabdetectFilter += loop_filter
            vidstabtransformFilter += loop_filter

        if isHardwareAcceleratedVideoCodec(mps["videoCodec"]):
            vidstabdetectFilter = wrapVideoFilterForHardwareAcceleration(
                mps["videoCodec"], vidstabdetectFilter
            )
            vidstabtransformFilter = wrapVideoFilterForHardwareAcceleration(
                mps["videoCodec"], vidstabtransformFilter
            )

        if len(video_filter) > MAX_VFILTER_SIZE:
            logger.info(f"Video filter is larger than {MAX_VFILTER_SIZE} characters.")
            logger.info(
                f'Video filter will be written to "{filterPathPass1}" and "{filterPathPass2}"',
            )
            with open(filterPathPass1, "w", encoding="utf-8") as f:
                f.write(vidstabdetectFilter)
            with open(filterPathPass2, "w", encoding="utf-8") as f:
                f.write(vidstabtransformFilter)
            ffmpegVidstabdetect = ffmpegCommand + f' -filter_script:v "{filterPathPass1}" '
            ffmpegVidstabtransform = ffmpegCommand + f' -filter_script:v "{filterPathPass1}" '
        else:
            ffmpegVidstabdetect = ffmpegCommand + f'-vf "{vidstabdetectFilter}" '
            ffmpegVidstabtransform = ffmpegCommand + f'-vf "{vidstabtransformFilter}" '

        ffmpegVidstabdetect += f" -y "
        ffmpegVidstabtransform += overwriteArg

        if mps["twoPass"]:
            ffmpegVidstabdetect += f" -pass 1"
            ffmpegVidstabtransform += f" -pass 2"
        else:
            ffmpegVidstabdetect += f" -speed 5"

        ffmpegVidstabdetect += f' "{shakyClipPath}"'
        ffmpegVidstabtransform += f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'
        ffmpegCommands: List[str] = [ffmpegVidstabdetect, ffmpegVidstabtransform]

    if not vidstabEnabled:
        if "minterpMode" in mps and mps["minterpMode"] != "None":
            video_filter += getMinterpFilter(mp, mps)

        if mps["loop"] != "none":
            video_filter += loop_filter

        if isHardwareAcceleratedVideoCodec(mps["videoCodec"]):
            video_filter = wrapVideoFilterForHardwareAcceleration(mps["videoCodec"], video_filter)

        if len(video_filter) > MAX_VFILTER_SIZE:
            logger.info(f"Video filter is larger than {MAX_VFILTER_SIZE} characters.")
            logger.info(f'Video filter will be written to "{filterPathPass1}"')
            with open(filterPathPass1, "w", encoding="utf-8") as f:
                f.write(video_filter)
            ffmpegCommand += f' -filter_script:v "{filterPathPass1}" '
        else:
            ffmpegCommand += f' -vf "{video_filter}" '

        if not mps["twoPass"]:
            ffmpegCommand += overwriteArg
            ffmpegCommand += f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'

            ffmpegCommands = [ffmpegCommand]
        else:
            ffmpegPass1 = ffmpegCommand + f" -y -pass 1 {os.devnull}"
            ffmpegPass2 = (
                ffmpegCommand
                + f' {overwriteArg} -speed {mps["encodeSpeed"]} -pass 2 "{mp["filePath"]}"'
            )

            ffmpegCommands = [ffmpegPass1, ffmpegPass2]

    if not (1 <= len(ffmpegCommands) <= 2):  # pylint: disable=superfluous-parens
        logger.error(f"ffmpeg command could not be built.\n")
        fileName = rich.markup.escape(mp["fileName"])
        logger.error(f"Failed to generate: {fileName}\n")
        return {**(settings["markerPairs"][markerPairIndex])}

    return runffmpegCommand(settings, ffmpegCommands, markerPairIndex, mp)


def getFfmpegCommandWithoutVideoFilter(
    audio_filter: str,
    cbr: Optional[int],
    cp: ClipperPaths,
    inputs: str,
    mp: DictStrAny,
    mps: DictStrAny,
    qmax: int,
    qmin: int,
) -> str:
    video_codec_args, video_codec_input_args, video_codec_output_args = getFfmpegVideoCodecArgs(
        mps["videoCodec"],
        cbr=cbr,
        mp=mp,
        mps=mps,
        qmax=qmax,
        qmin=qmin,
    )

    audio_codec_args = "-an"
    if mps["audio"]:
        audio_codec_args = " ".join(
            (
                f"-af {audio_filter}",
                ###
                f"-c:a libopus -b:a 128k"
                if mps["videoCodec"] != "vp8"
                else f"-c:a libvorbis -q:a 7",
            ),
        )

    return " ".join(
        (
            cp.ffmpegPath,
            f"-hide_banner",
            getFfmpegHeaders(mps["platform"]),
            video_codec_input_args,
            inputs,
            f"-benchmark",
            # f'-loglevel 56',
            video_codec_args,
            audio_codec_args,
            (
                f'-metadata title="{mps["videoTitle"]}"'
                if not mps["removeMetadata"]
                else "-map_metadata -1"
            ),
            f"-af {audio_filter}" if mps["audio"] else "-an",
            video_codec_output_args,
            f'{mps["extraFfmpegArgs"]}',
            " ",
        ),
    )


def getFfmpegCommandFastTrim(
    cp: ClipperPaths,
    inputs: str,
    mp: DictStrAny,
    mps: DictStrAny,
) -> str:
    overwriteArg = " -y " if mps["overwrite"] else " -n "

    return " ".join(
        (
            cp.ffmpegPath,
            overwriteArg,
            f"-hide_banner",
            getFfmpegHeaders(mps["platform"]),
            inputs,
            f"-benchmark",
            # f'-loglevel 56',
            f"-c copy",
            (
                f'-metadata title="{mps["videoTitle"]}"'
                if not mps["removeMetadata"]
                else "-map_metadata -1"
            ),
            f"" if mps["audio"] else "-an",
            f'{mps["extraFfmpegArgs"]}',
            f'{mp["filePath"]}' " ",
        ),
    )


def runffmpegCommand(
    settings: Settings,
    ffmpegCommands: List[str],
    markerPairIndex: int,
    mp: DictStrAny,
) -> DictStrAny:
    ffmpegPass1 = ffmpegCommands[0]
    if len(ffmpegCommands) == 2:
        logger.info("Running first pass...")

    input_redaction_pattern = r"(-i[\s]+\".*?\"[\s]+)+"
    nInputs = len(re.findall(input_redaction_pattern, ffmpegPass1))

    printablePass1 = re.sub(
        input_redaction_pattern,
        r"-i ... ",
        ffmpegPass1,
        count=nInputs,
    )

    logger.verbose(f"Using ffmpeg command: {printablePass1}\n")
    ffmpegProcess = subprocess.run(shlex.split(ffmpegPass1), check=False)

    if len(ffmpegCommands) == 2:
        ffmpegPass2 = ffmpegCommands[1]

        printablePass2 = re.sub(
            input_redaction_pattern,
            r"-i ... ",
            ffmpegPass2,
            count=nInputs,
        )

        logger.info("Running second pass...")
        logger.verbose(f"Using ffmpeg command: {printablePass2}\n")
        ffmpegProcess = subprocess.run(shlex.split(ffmpegPass2), check=False)

    fileName = rich.markup.escape(mp["fileName"])
    mp["returncode"] = ffmpegProcess.returncode
    if mp["returncode"] == 0:
        logger.success(f'Successfuly generated: "{fileName}"')
    else:
        logger.error(
            f'Failed to generate: "{fileName}" (error code: {mp["returncode"]}).',
        )

    return {**(settings["markerPairs"][markerPairIndex]), **mp}


def runffplayCommand(
    cs: ClipperState,
    inputs: str,
    video_filter: str,
    video_filter_before_correction: str,
    audio_filter: str,
    markerPairIndex: int,
    mps: DictStrAny,
) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    logger.info("running ffplay command")
    if 0 <= markerPairIndex < len(settings["markerPairs"]):
        ffplayOptions = f"-hide_banner -fs -sync video -fast -genpts -infbuf "
        ffplayVideoFilter = f'-vf "{video_filter}"'
        if settings["inputVideo"]:
            ffplayOptions += f" -loop 0"
            ffplayVideoFilter += f' -vf "{video_filter_before_correction}"'

        ffplayAudioFilter = f"-af {audio_filter}"

        ffplayCommand = " ".join(
            (
                cp.ffplayPath,
                inputs,
                ffplayOptions,
                ffplayVideoFilter,
                ffplayAudioFilter if mps["audio"] else "-an",
            ),
        )

        printableCommand = re.sub(r"-i.*?\".*?\"", r"", ffplayCommand)

        logger.info(f"Using ffplay command: {printableCommand}\n")
        subprocess.run(shlex.split(ffplayCommand), check=True)


def mergeClips(cs: ClipperState) -> None:  # noqa: PLR0912
    settings = cs.settings
    cp = cs.clipper_paths

    print()
    logger.header("-" * 30 + " Merge List Processing " + "-" * 30)
    markerPairMergeList = settings["markerPairMergeList"]
    markerPairMergeList = markerPairMergeList.split(";")
    inputsTxtPath = ""

    mergeListGen = createMergeList(markerPairMergeList)
    for merge, mergeList in mergeListGen:
        inputs = ""
        i = 0
        markerPair = {}
        try:
            for i in mergeList:
                markerPair = settings["markerPairs"][i - 1]
                if "returncode" in markerPair and markerPair["returncode"] != 0:
                    logger.warning(
                        f'Required marker pair {i} failed to generate with error code {markerPair["returncode"]}',
                    )
                    logger.warning(f"This may be a false positive.")
                    ans = input(r"Would you like to continue merging anyway? (y/n): ")
                    if ans not in {"yes", "y"}:
                        raise BadMergeInput
                    logger.warning(f"Continuing with merge despite possible bad input.")
                if "filePath" in markerPair and "fileName" in markerPair:
                    if Path(markerPair["filePath"]).is_file():
                        fileName = escapeSingleQuotesFFmpeg(markerPair["fileName"])
                        inputs += f"""file '{fileName}'\n"""
                    else:
                        raise MissingMergeInput
                else:
                    raise MissingMarkerPairFilePath

            titlePrefixesConsistent = True
            titlePrefixes = [p["overrides"].get("titlePrefix", "") for p in settings["markerPairs"]]
            mergeTitlePrefix = titlePrefixes[mergeList[0] - 1]
            if len(mergeList) > 1:
                for left, right in zip(mergeList[:-1], mergeList[1:]):
                    leftPrefix = titlePrefixes[left - 1]
                    rightPrefix = titlePrefixes[right - 1]
                    if leftPrefix != rightPrefix or leftPrefix == "" or rightPrefix == "":
                        titlePrefixesConsistent = False

        except IndexError:
            logger.error(f"Aborting generation of clip with merge list {mergeList}.")
            logger.error(f"Missing required marker pair number {i}.")
            continue
        except BadMergeInput:
            logger.error(f"Aborting generation of clip with merge list {mergeList}.")
            logger.error(f"Required marker pair {i} not successfully generated.")
            continue
        except MissingMergeInput:
            logger.error(f"Aborting generation of clip with merge list {mergeList}.")
            logger.error(
                f'Missing required input clip with path {markerPair["filePath"]}.',
            )
            continue
        except MissingMarkerPairFilePath:
            logger.error(f"Aborting generation of clip with merge list {mergeList}")
            logger.error(f"Missing file path for marker pair {i}")
            continue

        inputsTxtPath = f"{cp.clipsPath}/inputs.txt"
        with open(inputsTxtPath, "w+", encoding="utf-8") as inputsTxt:
            inputsTxt.write(inputs)

        # TODO: Test merging of clips of different video codecs
        mergedFileNameSuffix = "mp4" if settings["videoCodec"] == "h264" else "webm"
        if titlePrefixesConsistent:
            mergedFileName = (
                f'{mergeTitlePrefix}-{settings["titleSuffix"]}-({merge}).{mergedFileNameSuffix}'
            )
        else:
            mergedFileName = f'{settings["titleSuffix"]}-({merge}).{mergedFileNameSuffix}'

        mergedFilePath = f"{cp.clipsPath}/{mergedFileName}"
        mergeFileExists = checkClipExists(
            mergedFileName,
            mergedFilePath,
            settings["overwrite"],
        )
        overwriteArg = "-y" if settings["overwrite"] else "-n"
        ffmpegConcatFlags = f"{overwriteArg} -hide_banner -f concat -safe 0"
        ffmpegConcatCmd = f' "{cp.ffmpegPath}" {ffmpegConcatFlags}  -i "{inputsTxtPath}" -c copy "{mergedFilePath}"'

        if not mergeFileExists or settings["overwrite"]:
            logger.info(f"Using ffmpeg command: {ffmpegConcatCmd}")
            ffmpegProcess = subprocess.run(shlex.split(ffmpegConcatCmd), check=False)
            if ffmpegProcess.returncode == 0:
                logger.success(f'Successfuly generated: "{mergedFileName}"\n')
            else:
                logger.info(f'Failed to generate: "{mergedFileName}"\n')
                logger.error(f"ffmpeg error code: {ffmpegProcess.returncode}\n")

        with contextlib.suppress(OSError, FileNotFoundError):
            os.remove(inputsTxtPath)  # noqa: PTH107


def checkClipExists(
    fileName: str,
    filePath: str,
    overwrite: bool = False,
    skip: bool = False,
) -> bool:
    fileExists = Path(filePath).is_file()
    if skip:
        logger.notice(f'Skipped generating: "{fileName}"')
    elif overwrite:
        logger.warning(f'Generating and overwriting "{fileName}"...')
    elif not fileExists:
        logger.info(f'Generating "{fileName}"...')
    else:
        logger.notice(f'Skipped existing file: "{fileName}"')

    return fileExists


def createMergeList(
    markerPairMergeList: List[str],
) -> Generator[Tuple[str, List[int]], None, None]:
    for merge in markerPairMergeList:
        mergeList = markerPairsCSVToList(merge)
        yield merge, mergeList


def markerPairsCSVToList(markerPairsCSV: str) -> List[int]:
    markerPairsCSV = re.sub(r"\s+", "", markerPairsCSV)
    markerPairsCSV = markerPairsCSV.rstrip(",")
    csvRangeValidation = r"^((\d{1,2})|(\d{1,2}-\d{1,2})){1}(,((\d{1,2})|(\d{1,2}-\d{1,2})))*$"
    if re.match(csvRangeValidation, markerPairsCSV) is None:
        raise ValueError("Invalid Marker pairs CSV.")

    markerPairsMergeRanges = markerPairsCSV.split(",")

    markerPairsList = []
    for mergeRange in markerPairsMergeRanges:
        if "-" in mergeRange:
            mergeRange = mergeRange.split("-")  # noqa: PLW2901
            startPair = int(mergeRange[0])
            endPair = int(mergeRange[1])
            if startPair <= endPair:
                for i in range(startPair, endPair + 1):
                    markerPairsList.append(i)  # noqa: PERF402
            else:
                for i in range(startPair, endPair - 1 if endPair >= 1 else 0, -1):
                    markerPairsList.append(i)  # noqa: PERF402
        else:
            markerPairsList.append(int(mergeRange))
    return markerPairsList


def cleanFileName(fileName: str) -> str:
    if sys.platform == "win32":
        fileName = re.sub(r'[*?"<>\0]', "", fileName)
        fileName = re.sub(r"[/|\\:]", "_", fileName)
    elif sys.platform == "darwin":
        fileName = re.sub(r"[:\0]", "_", fileName)
    elif sys.platform.startswith("linux"):
        fileName = re.sub(r"[/\0]", "_", fileName)
    return fileName


def getDefaultEncodeSettings(videobr: int) -> DictStrAny:
    # switch to constant quality mode if no bitrate specified
    if videobr is None:
        encodeSettings = {
            "crf": 30,
            "autoTargetMaxBitrate": 0,
            "encodeSpeed": 2,
            "twoPass": False,
        }
    elif videobr <= 1000:
        encodeSettings = {
            "crf": 20,
            "autoTargetMaxBitrate": int(2 * videobr),
            "encodeSpeed": 2,
            "twoPass": False,
        }
    elif videobr <= 2000:
        encodeSettings = {
            "crf": 22,
            "autoTargetMaxBitrate": int(1.8 * videobr),
            "encodeSpeed": 2,
            "twoPass": False,
        }
    elif videobr <= 4000:
        encodeSettings = {
            "crf": 24,
            "autoTargetMaxBitrate": int(1.6 * videobr),
            "encodeSpeed": 2,
            "twoPass": False,
        }
    elif videobr <= 6000:
        encodeSettings = {
            "crf": 26,
            "autoTargetMaxBitrate": int(1.4 * videobr),
            "encodeSpeed": 3,
            "twoPass": False,
        }
    elif videobr <= 10000:
        encodeSettings = {
            "crf": 28,
            "autoTargetMaxBitrate": int(1.2 * videobr),
            "encodeSpeed": 4,
            "twoPass": False,
        }
    elif videobr <= 14000:
        encodeSettings = {
            "crf": 30,
            "autoTargetMaxBitrate": int(1.1 * videobr),
            "encodeSpeed": 5,
            "twoPass": False,
        }
    elif videobr <= 18000:
        encodeSettings = {
            "crf": 30,
            "autoTargetMaxBitrate": int(1.0 * videobr),
            "encodeSpeed": 5,
            "twoPass": False,
        }
    elif videobr <= 25000:
        encodeSettings = {
            "crf": 32,
            "autoTargetMaxBitrate": int(0.9 * videobr),
            "encodeSpeed": 5,
            "twoPass": False,
        }
    else:
        encodeSettings = {
            "crf": 34,
            "autoTargetMaxBitrate": int(0.8 * videobr),
            "encodeSpeed": 5,
            "twoPass": False,
        }
    return encodeSettings


def containsValidCharsForVidStab(string: str) -> bool:
    if not string.isascii():
        return False

    return all(char != "'" for char in string)


def makeClips(cs: ClipperState) -> None:
    settings = cs.settings

    nMarkerPairs = len(settings["markerPairs"])
    markerPairQueue = getMarkerPairQueue(
        nMarkerPairs,
        settings["only"],
        settings["except"],
    )
    if len(markerPairQueue) == 0:
        logger.warning("No marker pairs to process")
    else:
        printableMarkerPairQueue = {x + 1 for x in markerPairQueue}
        logger.report(
            f"Processing the following set of marker pairs: {printableMarkerPairQueue}",
        )

    for markerPairIndex, _marker in enumerate(settings["markerPairs"]):
        if markerPairIndex in markerPairQueue:
            settings["markerPairs"][markerPairIndex] = makeClip(cs, markerPairIndex)
        else:
            mp, _mps = getMarkerPairSettings(cs, markerPairIndex, True)
            settings["markerPairs"][markerPairIndex] = {
                **(settings["markerPairs"][markerPairIndex]),
                **mp,
            }

    if settings["markerPairMergeList"] != "":
        mergeClips(cs)


def previewClips(cs: ClipperState) -> None:
    settings = cs.settings
    while True:
        inputStr = ""
        try:
            inputStr = input(
                f'Enter a valid marker pair number (between {1} and {len(settings["markerPairs"])}) or quit(q): ',
            )
            if inputStr in {"quit", "q"}:
                break
            markerPairIndex = int(inputStr)
            markerPairIndex -= 1
        except ValueError:
            logger.error(f"{inputStr} is not a valid number.")
            continue
        if 0 <= markerPairIndex < len(settings["markerPairs"]):
            makeClip(cs, markerPairIndex)
        else:
            logger.error(f"{markerPairIndex + 1} is not a valid marker pair number.")


def getMarkerPairQueue(
    nMarkerPairs: int,
    onlyMarkerPairs: str,
    exceptMarkerPairs: str,
) -> Set[int]:
    markerPairQueue = set(range(nMarkerPairs))
    onlyPairsSet = markerPairQueue
    exceptPairsSet = set()

    if onlyMarkerPairs != "":
        try:
            onlyPairsList = markerPairsCSVToList(onlyMarkerPairs)
        except ValueError:
            logger.critical(
                f"Argument provided to --only was invalid: {onlyMarkerPairs}",
            )
            sys.exit(1)
        onlyPairsSet = {x - 1 for x in set(onlyPairsList)}
    if exceptMarkerPairs != "":
        try:
            exceptPairsList = markerPairsCSVToList(exceptMarkerPairs)
        except ValueError:
            logger.critical(
                f"Argument provided to --except was invalid: {exceptMarkerPairs}",
            )
            sys.exit(1)
        exceptPairsSet = {x - 1 for x in set(exceptPairsList)}

    onlyPairsSet.difference_update(exceptPairsSet)
    markerPairQueue.intersection_update(onlyPairsSet)
    return markerPairQueue
