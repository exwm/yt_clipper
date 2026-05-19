import contextlib
import copy
import os
import re
import shlex
import subprocess
import sys
from fractions import Fraction
from math import pi
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Set, Tuple

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
from clipper.ffmpeg_codec import (
    getContainerForCodec,
    getFfmpegVideoCodecArgs,
    isHardwareAcceleratedVideoCodec,
    wrapVideoFilterForHardwareAcceleration,
)
from clipper.ffmpeg_filter import (
    autoScaleCropMap,
    getAutoScaledCropComponents,
    getAverageSpeed,
    getCropFilter,
    getEasingExpression,
    getMinSpeed,
    getMinterpFilter,
    getMinterpFPS,
    getSpeedFilterAndDuration,
    getSubsFilter,
    getZoomPanFilter,
    videoStabilizationGammaFixFilter,
)
from clipper.log_helpers import (
    LogPath,
    build_marker_pair_settings_snapshot,
    emit_marker_pair_settings_log,
    get_active_search_progress,
    run_ffmpeg_with_progress,
    substitute_filter_graphs,
    time_stage,
)
from clipper.platforms import getFfmpegHeaders
from clipper.previews import makePreview, mergePreviews
from clipper.util import escapeSingleQuotesFFmpeg, getTrimmedBase64Hash
from clipper.video2x import runVideo2xCommand
from clipper.ytc_logger import Subsystem, make_subsystem_logger, pair_context

logger = make_subsystem_logger(Subsystem.CLIP_MAKER)


def getMarkerPairSettings(  # noqa: PLR0912
    cs: ClipperState,
    markerPairIndex: int,
    skip: bool = False,
    enableMinterpFpsBitrateFactor: bool = False,
    enableLogging: bool = True,
    outputSuffix: str = "",
    outputDir: Optional[str] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Resolve per-marker-pair settings + filenames.

    ``outputSuffix`` (e.g. ``".crfsearch-trial-crf26"``) is appended to
    ``fileNameStem`` to differentiate output files for non-production
    encode passes such as the empirical CRF binary search's trial encodes.
    Empty string (default) keeps production behavior unchanged.

    ``outputDir`` overrides the directory where ``mp["filePath"]`` lands.
    Defaults to ``cp.clipsPath`` (the user-facing clip output directory).
    Trial / reference encodes for the CRF binary search pass a temp
    subdirectory here so search artifacts don't clutter the user's
    clip output folder.
    """
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
        titlePrefix = f"{mps['titlePrefix'] + '-' if 'titlePrefix' in mps else ''}"
        mp["fileNameStem"] = (
            f"{titlePrefix}{mps['titleSuffix']}-{markerPairIndex + 1}{outputSuffix}"
        )

        if mps["fastTrim"]:
            if mps["inputVideo"]:
                mp["fileNameSuffix"] = Path(mps["inputVideo"]).suffix.removeprefix(".")
            else:
                mp["fileNameSuffix"] = mps["ext"]
        else:
            mp["fileNameSuffix"] = (
                "mp4" if mps["videoCodec"] in {"h264", "h264_nvenc", "h264_vulkan"} else "webm"
            )

        mp["fileName"] = f"{mp['fileNameStem']}.{mp['fileNameSuffix']}"
        resolved_output_dir = outputDir if outputDir is not None else cp.clipsPath
        mp["filePath"] = f"{resolved_output_dir}/{mp['fileName']}"
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

    mps, bitrateFactor, bitrateCropFactor, bitrateFpsFactor = updateEncodeSettings(
        settings,
        mp,
        mps,
        enableMinterpFpsBitrateFactor,
    )

    # Surface the resolved auto-encode picks onto mp so callers that only
    # see the marker-pair return value (e.g. the sample-guided trial loop) can
    # read what the encoder actually used. Without this, mp comes back
    # without a "crf" key and trial summaries can't display the CRF that
    # produced the measured VMAF.
    for _resolvedKey in ("crf", "autoTargetMaxBitrate", "encodeSpeed", "videoCodec"):
        if _resolvedKey in mps:
            mp[_resolvedKey] = mps[_resolvedKey]

    if enableLogging:
        snapshot = build_marker_pair_settings_snapshot(
            mp, mps,
            marker_pair_index=markerPairIndex,
            bitrate_factor=bitrateFactor,
            bitrate_crop_factor=bitrateCropFactor,
            bitrate_fps_factor=bitrateFpsFactor,
        )
        # ``quietFfmpeg`` is set by ``_TRIAL_PIPELINE_OVERRIDES`` (and
        # the reference / baseline equivalents in the sample-guided
        # orchestrator) so every search-context encode passes
        # ``is_search_context=True``. This reframes the diff title
        # from "settings changed:" (which read as "your pair config
        # was modified") to "sample-guided encode using overrides:" (what's
        # actually happening) AND keeps the memo anchored to the
        # operator's original pair snapshot so the post-search final
        # encode still diffs against THAT, not the last trial.
        emit_marker_pair_settings_log(
            log_full=logger.info,
            log_diff=logger.notice,
            marker_pair_index=markerPairIndex,
            snapshot=snapshot,
            is_search_context=bool(settings.get("quietFfmpeg")),
        )

    return (mp, mps)


def updateEncodeSettings(
    settings: DictStrAny,
    mp: DictStrAny,
    mps: DictStrAny,
    enableMinterpFpsBitrateFactor: bool = False,
) -> Tuple[DictStrAny, float | int, int, int]:
    bitrateCropFactor = (mp["maxSize"]) / (settings["width"] * settings["height"])

    # relax bitrate crop factor assuming that most crops include complex parts
    # of the video and exclude simpler parts
    bitrateCropRelaxationFactor = 0.8
    bitrateCropFactor = min(1, bitrateCropFactor**bitrateCropRelaxationFactor)

    # When user slows down the clip, the fps is reduced and we can reduce the bitrate
    # as fewer bits are needed per unit time
    # A longer/slower clip is perceptually easier to scrutinize so we relax the factor slightly
    bitrateFpsFactor = mp["averageSpeed"] ** 0.8

    # When motion interpolation is used, the fps is increased
    # The source bitrate is based on the source fps
    # we might slow this fps down and then use motion interpolation to increase it

    # Thus more bitrate is warranted to encode the extra frames
    # These extra frames will have fewer differences between neighboring frames so we can relax the factor
    mps["minterpFPS"] = getMinterpFPS(mps, mp["speedMap"])
    if mps["minterpFPS"] is not None and enableMinterpFpsBitrateFactor:
        averageSourceFps = float(Fraction(mps["avg_frame_rate"]))
        clipFpsAfterMinterp = mps["minterpFPS"]
        bitrateFpsFactor = clipFpsAfterMinterp / averageSourceFps
        bitrateFpsFactor **= 0.7

        logger.verbose(
            f"Calculated bitrateFpsFactor for motion interpolation compensation. averageSourceFps={averageSourceFps}, clipFpsAfterMinterp={clipFpsAfterMinterp}, bitrateFpsFactor={bitrateFpsFactor}",
        )

    bitrateHDRFactor = 1.1 if mps["inputIsHDR"] else 1

    bitrateHardwareAccelerationFactor = (
        1.1 if isHardwareAcceleratedVideoCodec(mps["videoCodec"]) else 1
    )

    bitrateFactor = (
        # Don't allow the bitrate to be larger than the source bitrate by making 1 the max bitrateFactor
        min(1, bitrateCropFactor * bitrateFpsFactor * bitrateHDRFactor)
        * bitrateHardwareAccelerationFactor
    )

    globalEncodeSettings = getDefaultEncodeSettings(mps["bit_rate"])
    autoMarkerPairEncodeSettings = getDefaultEncodeSettings(
        mps["bit_rate"] * bitrateFactor,
    )
    mps = {**globalEncodeSettings, **autoMarkerPairEncodeSettings, **mps}
    if "targetMaxBitrate" not in mps:
        mps["targetMaxBitrate"] = mps["autoTargetMaxBitrate"]

    return mps, bitrateFactor, bitrateCropFactor, bitrateFpsFactor


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
        logger.error(
            f'Failed to generate: {LogPath(mp["fileName"])}. The marker pair defines a clip that spans multiple video parts which is not currently supported.',
        )
        return None

    ffmpegCommand = getFfmpegCommandFastTrim(cp, inputs, mp, mps)

    return runffmpegCommand(settings, [ffmpegCommand], markerPairIndex, mp)


def makeClip(  # noqa: PLR0912
    cs: ClipperState,
    markerPairIndex: int,
    *,
    outputSuffix: str = "",
    outputDir: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Encode one marker pair.

    ``outputSuffix`` (e.g. ``".crfsearch-trial-crf26"``) is appended to the
    output filename so non-production trial encodes (the empirical CRF
    binary search) don't collide with the user's main output. Empty
    string (default) keeps production behavior. The suffix flows through
    ``getMarkerPairSettings`` so the existing exists/cache check naturally
    skips already-produced reference encodes when running with the same
    suffix on a re-run.

    ``outputDir`` redirects the encode's output file to a non-default
    directory (default: the user's clip output directory). Used by the
    CRF binary search to write trial / reference encodes into a temp
    subdirectory rather than mixing them with user-facing clip outputs.
    """
    settings = cs.settings
    cp = cs.clipper_paths

    mp, mps = getMarkerPairSettings(
        cs, markerPairIndex,
        outputSuffix=outputSuffix,
        outputDir=outputDir,
    )

    if mp["exists"] and not mps["overwrite"]:
        return {**(settings["markerPairs"][markerPairIndex]), **mp}

    if mps["fastTrim"]:
        logger.notice(
            f"Fast-trim enabled for marker pair {markerPairIndex}. Features that require re-encoding (including crop and speed) will be disabled.",
        )
        return fastTrimClip(cs, markerPairIndex, mp, mps)

    v2x_enabled = mps["minterpTool"] == "video2x" and mps["minterpFpsMultiplier"] > 0
    if v2x_enabled:
        videoFPS = Fraction(mps["r_frame_rate"])
        target_fps = mps["minterpFpsMultiplier"] * videoFPS
        min_clip_fps = getMinSpeed(mp.get("speedMap")) * videoFPS
        if target_fps <= min_clip_fps:
            logger.info(
                f"Skipping motion interpolation for marker pair {markerPairIndex + 1}: "
                f"target fps ({float(target_fps):.3g}) is not greater than minimum clip fps "
                f"({float(min_clip_fps):.3g}) — no frames need interpolation.",
            )
            v2x_enabled = False
    if v2x_enabled:
        mp["v2xFinalFilePath"] = mp["filePath"]
        pre_v2x_dir = f"{cp.clipsPath}/{cp.tempPath}/pre-v2x"
        os.makedirs(pre_v2x_dir, exist_ok=True)
        mp["filePath"] = f"{pre_v2x_dir}/{mp['fileNameStem']}.{mp['fileNameSuffix']}"
        pre_v2x_file = Path(mp["filePath"])
        mp["preV2xExists"] = (
            pre_v2x_file.is_file()
            and pre_v2x_file.stat().st_size > 0
            and not mps["overwrite"]
        )

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
            audio_filter += f"atrim={aStart}:{aEnd},atempo={mp['speed']}"
        # encoding mode starts each clip at time 0
        elif not settings["preview"]:
            audio_filter += f"atrim=0:{aDuration},atempo={mp['speed']}"
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
            audio_filter += f",{mps['extraAudioFilters']}"

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
        logger.error(
            f'Failed to generate: {LogPath(mp["fileName"])}. The marker pair defines a clip that spans multiple video parts which is not currently supported.',
        )
        return None

    cbr = None
    if mps["targetSize"] > 0:
        cbr = mps["targetSize"] / mp["outputDuration"]
        logger.important(
            f"Forcing constant bitrate of ~{round(cbr, 3)} MBps "
            + f"({mps['targetSize']} MB / ~{round(mp['outputDuration'], 3)} s).",
        )

    ffmpegCommand = getFfmpegCommandWithoutVideoFilter(audio_filter, cbr, cp, inputs, mp, mps)

    if not mps["preview"]:
        video_filter += f"trim=0:{mp['duration']}"
    else:
        video_filter += f"trim={mp['start']}:{mp['end']}"

    if mps["preview"] and not settings["inputVideo"]:
        video_filter += f",loop=loop=-1:size=(32767)"

    if mps["enableHDR"] or settings["inputIsHDR"] or settings["inputBitDepth"] > 8:
        video_filter += f",format=yuv444p10le"

    ### Crop Filter ###

    cropComponents = mp["cropComponents"]
    # video_filter += f",mpdecimate=hi=64*2:lo=64:frac=0.1,setpts='(N/FR/TB)'"
    video_filter += f",{mp['cropFilter']}"

    if mps["subsFilePath"] != "":
        video_filter += getSubsFilter(cs, mp, mps, markerPairIndex)

    if mps["preview"]:
        video_filter += f",scale=w=iw/2:h=ih/2"
        cropComponents["w"] /= 2
        cropComponents["h"] /= 2

    # if the marker pair crop is used after the filter then it should be rotated the same way
    if mps["rotate"] and mps["rotate"] != "0":
        video_filter += f",transpose={mps['rotate']}"

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
        video_filter += f",lutyuv=y=gammaval({mps['gamma']})"
    if mps["denoise"]["enabled"]:
        video_filter += f",hqdn3d=luma_spatial={mps['denoise']['lumaSpatial']}"
    # if mps["scale"]:
    #     video_filter += f'scale=w=2*iw:h=2*ih:flags=lanczos'

    # if mps["overlayPath"]:
    #     video_filter += f'[1:v]overlay=x=W-w-10:y=10:alpha=0.5'
    #     inputs += f'-i "{mps["overlayPath"]}"'

    if mps["extraVideoFilters"]:
        video_filter += f",{mps['extraVideoFilters']}"

    loop_filter = ""
    if mps["loop"] != "fwrev":
        video_filter += f",{mp['speedFilter']}"
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
        loop_filter += f"[f1]{mp['speedFilter']}[f];"
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
                "Preview mode unexpectedly did not have video filters before corrections available.",
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

    ffmpegCommands: list[str] = []

    MAX_VFILTER_SIZE = 10_000

    overwriteArg = " -y " if mps["overwrite"] else " -n "
    vidstabEnabled = mps["videoStabilization"]["enabled"]
    if vidstabEnabled:
        vidstab = mps["videoStabilization"]
        shakyPath = f"{cp.clipsPath}/shaky"
        os.makedirs(shakyPath, exist_ok=True)
        transformPath = f"{shakyPath}/{mp['fileNameStem']}.trf"

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
            transformPath = f"{safeShakyPath}/{markerPairIndex + 1}.trf"

        shakyClipPath = f"{shakyPath}/{mp['fileNameStem']}-shaky.{mp['fileNameSuffix']}"

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
            vidstabtransformFilter += f":optzoom=2:zoomspeed={vidstab['zoomspeed']}"

        vidstabtransformFilter = videoStabilizationGammaFixFilter(vidstabtransformFilter)

        if mps["minterpTool"] == "ffmpeg" and "minterpMode" in mps and mps["minterpMode"] != "None":
            vidstabtransformFilter += getMinterpFilter(mp, mps)

        if mps["loop"] != "none":
            vidstabdetectFilter += loop_filter
            vidstabtransformFilter += loop_filter

        if isHardwareAcceleratedVideoCodec(mps["videoCodec"]):
            vidstabdetectFilter = wrapVideoFilterForHardwareAcceleration(
                mps["videoCodec"],
                vidstabdetectFilter,
            )
            vidstabtransformFilter = wrapVideoFilterForHardwareAcceleration(
                mps["videoCodec"],
                vidstabtransformFilter,
            )

        if len(video_filter) > MAX_VFILTER_SIZE:
            filterPathVidStabDetectPass = (
                f"{cp.clipsPath}/temp/vfilter-{markerPairIndex + 1}-pass1.txt"
            )
            filterPathVidStabTransformPass = (
                f"{cp.clipsPath}/temp/vfilter-{markerPairIndex + 1}-pass2.txt"
            )
            logger.info(f"Video filter is larger than {MAX_VFILTER_SIZE} characters.")
            logger.info(
                f'Video filter will be written to "{filterPathVidStabDetectPass}" and "{filterPathVidStabTransformPass}"',
            )
            with open(filterPathVidStabDetectPass, "w", encoding="utf-8") as f:
                f.write(vidstabdetectFilter)
            with open(filterPathVidStabTransformPass, "w", encoding="utf-8") as f:
                f.write(vidstabtransformFilter)
            ffmpegVidstabdetect = (
                ffmpegCommand + f' -filter_script:v "{filterPathVidStabDetectPass}" '
            )
            ffmpegVidstabtransform = (
                ffmpegCommand + f' -filter_script:v "{filterPathVidStabTransformPass}" '
            )
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
        ffmpegCommands = [ffmpegVidstabdetect, ffmpegVidstabtransform]

    if not vidstabEnabled:
        if mps["minterpTool"] == "ffmpeg" and "minterpMode" in mps and mps["minterpMode"] != "None":
            video_filter += getMinterpFilter(mp, mps)

        if mps["loop"] != "none":
            video_filter += loop_filter

        if isHardwareAcceleratedVideoCodec(mps["videoCodec"]):
            video_filter = wrapVideoFilterForHardwareAcceleration(mps["videoCodec"], video_filter)

        if len(video_filter) > MAX_VFILTER_SIZE:
            filterPathPass1 = f"{cp.clipsPath}/temp/vfilter-{markerPairIndex + 1}-pass1.txt"
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
        logger.error(f"Failed to generate: {LogPath(mp['fileName'])}\n")
        return {**(settings["markerPairs"][markerPairIndex])}

    if not v2x_enabled:
        return runffmpegCommand(settings, ffmpegCommands, markerPairIndex, mp)

    if mp.get("preV2xExists"):
        logger.notice(f"Skipping ffmpeg - using existing pre-v2x intermediate: {LogPath(mp['filePath'])}")
    else:
        result = runffmpegCommand(settings, ffmpegCommands, markerPairIndex, mp)
        if result.get("returncode") != 0:
            return None

    mps, _, _, _ = updateEncodeSettings(
        settings,
        mp,
        mps,
        True,
    )
    video_codec_args, _, _ = getFfmpegVideoCodecArgs(
        mps["videoCodec"],
        cbr=cbr,
        mp=mp,
        mps=mps,
    )

    logger.rule(title=f"Motion interpolation ({markerPairIndex + 1})", sub=True)
    return runVideo2xCommand(cs, mp, mps, video_codec_args)


def getFfmpegCommandWithoutVideoFilter(
    audio_filter: str,
    cbr: Optional[int],
    cp: ClipperPaths,
    inputs: str,
    mp: DictStrAny,
    mps: DictStrAny,
) -> str:
    video_codec_args, video_codec_input_args, video_codec_output_args = getFfmpegVideoCodecArgs(
        mps["videoCodec"],
        cbr=cbr,
        mp=mp,
        mps=mps,
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

    # No quieting flags: ``-loglevel warning`` suppresses ffmpeg's
    # stats line in many ffmpeg builds (it's emitted at INFO level),
    # which would kill the bar for trial encodes. Instead we let
    # ffmpeg emit normally and rely on the progress tracker's stderr
    # reader to filter — see ``silent_non_progress`` below: for
    # trial encodes, the tracker drops decoder/encoder setup chatter
    # silently so the terminal stays clean while the bar still
    # advances from the stats line's ``frame=N``.
    quiet_flags = ""

    return " ".join(
        (
            cp.ffmpegPath,
            f"-hide_banner",
            quiet_flags,
            getFfmpegHeaders(mps["platform"]),
            video_codec_input_args,
            inputs,
            f"-benchmark",
            video_codec_args,
            audio_codec_args,
            (
                f'-metadata title="{mps["videoTitle"]}"'
                if not mps["removeMetadata"]
                else "-map_metadata -1"
            ),
            f"-af {audio_filter}" if mps["audio"] else "-an",
            video_codec_output_args,
            f"{mps['extraFfmpegArgs']}",
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
            f"{mps['extraFfmpegArgs']}",
            f"{mp['filePath']} ",
        ),
    )


def _estimate_encoded_frames(settings: Settings, mp: DictStrAny) -> int:
    """Rough estimate of the number of frames the upcoming ffmpeg
    encode will produce. Used as the ``total`` for the progress bar
    so it can render a percent + ETA; off by ~10-20% is fine — the
    bar still tracks meaningfully."""
    output_duration = float(mp.get("outputDuration", 0) or 0)
    if output_duration <= 0:
        return 0
    fps_raw = settings.get("r_frame_rate") or 30
    try:
        fps = float(Fraction(str(fps_raw)))
    except (ValueError, ZeroDivisionError):
        fps = 30.0
    return max(0, round(output_duration * fps))


def runffmpegCommand(  # noqa: PLR0912 — encode kind branching + filter-graph substitute is part of the encode-dispatch surface
    settings: Settings,
    ffmpegCommands: List[str],
    markerPairIndex: int,
    mp: DictStrAny,
) -> DictStrAny:
    total_frames = _estimate_encoded_frames(settings, mp)
    n_passes = len(ffmpegCommands)

    input_redaction_pattern = r"(-i[\s]+\".*?\"[\s]+)+"
    nInputs = len(re.findall(input_redaction_pattern, ffmpegCommands[0]))

    returncode = 0
    # Callers (e.g. the sample-guided orchestrator's reference and
    # baseline encodes) can override the generic "encoding" label
    # via the ``ffmpegProgressLabel`` setting so the operator sees
    # context-aware text in the spinner row — "sample-guided encode —
    # reference encode" reads as belonging to a search; bare
    # "encoding" reads like a final user-facing encode and is
    # confusing when it appears mid-search.
    base_label = settings.get("ffmpegProgressLabel") or "encoding"
    for pass_idx, cmd in enumerate(ffmpegCommands):
        pass_num = pass_idx + 1
        if n_passes == 2:
            logger.info(f"Running {'first' if pass_num == 1 else 'second'} pass...")
            label = f"{base_label} (pass {pass_num}/2)"
        else:
            label = base_label

        printable = re.sub(
            input_redaction_pattern,
            r"-i ... ",
            cmd,
            count=nInputs,
        )
        # When a sample-guided encode is active, deduplicate the multi-thousand-
        # char ``-vf "..."`` filter graphs that repeat across every
        # trial / reference encode. ``substitute_filter_graphs``
        # checks the per-search registry: returns the cmd unchanged
        # (and an empty new-entries list) outside a search; otherwise
        # registers each long filter graph with an integer id, emits
        # one ``filter-graph #N: <expr>`` VERBOSE line per new entry,
        # and replaces the inline filter with ``<filter-graph #N>``
        # in the printed command. Trial commands then read as a
        # tight one-liner instead of burying the rest of the log.
        #
        # ``rich.markup.escape`` on the expr is load-bearing —
        # complex filtergraphs contain ``[stream_label]`` tokens
        # which rich would parse as style spans and strip from the
        # rendered output (the on-disk log file would still get
        # the bracketed form via the file handler, but the
        # terminal would lose them).
        printable, new_filter_graphs = substitute_filter_graphs(printable)
        for graph_id, expr in new_filter_graphs:
            logger.verbose(
                f"filter-graph #{graph_id}: {rich.markup.escape(expr)}",
            )
        # ``rich.markup.escape`` on the whole printable command — same
        # convention :class:`LogPath` uses internally to neutralize
        # rich-markup-meaningful brackets in paths. The ffmpeg command
        # contains output paths, ``-metadata title="..."`` values, and
        # filter content that legitimately include ``[`` / ``]`` (e.g.
        # ``[youtube@w1btGccD060]`` in download-derived filenames, or
        # ``[stream_label]`` tokens in complex filtergraphs). Without
        # escaping, rich treats those as style-span opens, strips them
        # from the rendered output, and the operator sees a mangled
        # command line. Angle-bracket placeholders like
        # ``<filter-graph #1>`` pass through untouched (escape only
        # affects square brackets).
        logger.verbose(
            f"Using ffmpeg command: {rich.markup.escape(printable)}\n",
        )

        # Every ffmpeg invocation gets a progress display. The CRF-
        # search orchestrator binds a ``SearchProgressTracker`` to
        # the current context for the duration of a search; when one
        # is active AND this is a trial encode (``quietFfmpeg``),
        # route through the shared search-level display instead of
        # spawning a per-trial Live. That collapses the per-trial
        # spinner into a single counter advancing across all trials,
        # which is what the operator actually wants to see during a
        # multi-minute search.
        #
        # No active search tracker (e.g. final encode, preview, or a
        # trial that somehow runs outside an orchestrator scope):
        # - ``silent_non_progress=True`` (trial) drops decoder /
        #   encoder setup banners that would otherwise repeat per
        #   trial-window and flood the log.
        # - ``spinner_only=True`` (trial) switches the Live display
        #   from a full progress bar to just a spinner + label + the
        #   transient stats line. Trial encodes are dominated by
        #   ffmpeg setup time; a bar sitting at ``0/N`` for most of
        #   that and then jumping to done is more misleading than
        #   helpful.
        is_trial = bool(settings.get("quietFfmpeg"))
        search_tracker = get_active_search_progress() if is_trial else None
        if search_tracker is not None:
            # Three encode "kinds" route through the search tracker:
            # - search trials (``sampleGuidedEncodeTrial=True``): bump
            #   the trial counter and render ``"trial N {suffix}"``
            #   where suffix is e.g. ``"(crf=27 w1 3.2-4.0s)"``.
            # - reference / baseline phase encodes (the default when
            #   the flag isn't set): take the full label verbatim
            #   so the operator sees the same row format as trials
            #   but with no implication about trial numbering.
            # See the orchestrator's settings_overrides for where
            # each kind is configured.
            phase_label = settings.get("ffmpegProgressLabel") or ""
            if settings.get("sampleGuidedEncodeTrial"):
                returncode = search_tracker.run_trial_ffmpeg(
                    cmd, label=phase_label,
                )
            else:
                returncode = search_tracker.run_phase_ffmpeg(
                    cmd, label=phase_label,
                )
        else:
            returncode = run_ffmpeg_with_progress(
                cmd,
                total_frames=total_frames,
                label=label,
                silent_non_progress=is_trial,
                spinner_only=is_trial,
            )

        if returncode != 0:
            # Don't run pass 2 if pass 1 failed.
            break

    file_name_log = LogPath(mp["fileName"])
    mp["returncode"] = returncode
    if mp["returncode"] == 0:
        # Demote the success log to verbose during quiet-ffmpeg encodes
        # (CRF binary search trials run many ffmpeg invocations per clip
        # and don't need a SUCCESS line per window — the search emits its
        # own per-trial summary which is the real signal).
        if settings.get("quietFfmpeg"):
            logger.verbose(f"Successfully generated: {file_name_log}")
        else:
            logger.success(f"Successfully generated: {file_name_log}")
    else:
        logger.error(
            f"Failed to generate: {file_name_log} (error code: {mp['returncode']}).",
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
    logger.rule(title="Merge List Processing")
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
                        f"Required marker pair {i} failed to generate with error code {markerPair['returncode']}.",
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
                f"Missing required input clip with path {LogPath(markerPair['filePath'])}.",
            )
            continue
        except MissingMarkerPairFilePath:
            logger.error(f"Aborting generation of clip with merge list {mergeList}.")
            logger.error(f"Missing file path for marker pair {i}.")
            continue

        inputsTxtPath = f"{cp.clipsPath}/inputs.txt"
        with open(inputsTxtPath, "w+", encoding="utf-8") as inputsTxt:
            inputsTxt.write(inputs)

        # TODO: Test merging of clips of different video codecs
        mergedFileNameSuffix = getContainerForCodec(settings["videoCodec"])
        if titlePrefixesConsistent:
            mergedFileName = (
                f"{mergeTitlePrefix}-{settings['titleSuffix']}-({merge}).{mergedFileNameSuffix}"
            )
        else:
            mergedFileName = f"{settings['titleSuffix']}-({merge}).{mergedFileNameSuffix}"

        mergedFilePath = f"{cp.clipsPath}/{mergedFileName}"
        mergeFileExists = checkClipExists(
            mergedFileName,
            mergedFilePath,
            settings["overwrite"],
        )
        overwriteArg = "-y" if settings["overwrite"] else "-n"
        ffmpegConcatFlags = f"{overwriteArg} -hide_banner -f concat -safe 0"
        ffmpegConcatCmd = (
            f' {cp.ffmpegPath} {ffmpegConcatFlags}  -i "{inputsTxtPath}" -c copy "{mergedFilePath}"'
        )

        merged_file_log = LogPath(mergedFileName)
        mergedClipReady = mergeFileExists and not settings["overwrite"]
        if not mergeFileExists or settings["overwrite"]:
            # Escape ``[...]`` tokens in the embedded paths so rich
            # doesn't parse them as style spans and strip pieces of
            # the command. Same convention as the runffmpegCommand
            # log site above.
            logger.info(
                f"Using ffmpeg command: {rich.markup.escape(ffmpegConcatCmd)}",
            )
            ffmpegProcess = subprocess.run(shlex.split(ffmpegConcatCmd), check=False)
            if ffmpegProcess.returncode == 0:
                logger.success(f"Successfully generated: {merged_file_log}\n")
                mergedClipReady = True
            else:
                logger.info(f"Failed to generate: {merged_file_log}\n")
                logger.error(f"ffmpeg error code: {ffmpegProcess.returncode}\n")

        if mergedClipReady and settings.get("previewFormat", "none") != "none":
            previewPaths = [
                settings["markerPairs"][i - 1].get("previewFilePath")
                for i in mergeList
            ]
            previewPaths = [path for path in previewPaths if path]
            if previewPaths:
                mergePreviews(
                    cp,
                    previewPaths,
                    mergedFilePath,
                    settings["previewFormat"],
                    settings["overwrite"],
                )

        with contextlib.suppress(OSError, FileNotFoundError):
            os.remove(inputsTxtPath)  # noqa: PTH107


def checkClipExists(
    fileName: str,
    filePath: str,
    overwrite: bool = False,
    skip: bool = False,
) -> bool:
    fileExists = Path(filePath).is_file()
    name_log = LogPath(fileName)
    if skip:
        logger.notice(f"Skipped generating: {name_log}")
    elif overwrite:
        logger.warning(f"Generating and overwriting {name_log}...")
    elif not fileExists:
        logger.info(f"Generating {name_log}...")
    else:
        logger.notice(f"Skipped existing file: {name_log}")

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
            mergeRangeSplit = mergeRange.split("-")
            startPair = int(mergeRangeSplit[0])
            endPair = int(mergeRangeSplit[1])
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
        logger.warning("No marker pairs to process.")
    else:
        printableMarkerPairQueue = {x + 1 for x in markerPairQueue}
        logger.report(
            f"Processing the following set of marker pairs: {printableMarkerPairQueue}",
        )

    # Per-clip sample-guided outcomes accumulated across the whole run so we
    # can emit one consolidated summary as the LAST report-level log.
    # Mid-run per-clip lines still emit live; the aggregate table groups
    # everything together at the bottom of the final Summary Report for
    # easy scanning / copying.
    sampleGuidedEncodeSummaries: List[Any] = []

    for markerPairIndex, _marker in enumerate(settings["markerPairs"]):
        with pair_context(markerPairIndex):
            if markerPairIndex in markerPairQueue:
                logger.rule(title=f"Marker pair {markerPairIndex + 1}")
                if settings.get("sampleGuidedEncode"):
                    # Snapshot the pristine marker before any encode so the
                    # search orchestrator can restore a fresh state between
                    # trial encodes — getMarkerPairSettings is non-idempotent
                    # (compounds delay shifts on mp.start/end, multiplies the
                    # crop by cropMultipleX/Y, mutates speedMap point x-coords).
                    # Re-running it on an already mutated marker double-shifts
                    # timestamps and clamps the crop to the full source frame.
                    from clipper.sample_guided_encode import (
                        ClipSearchSummary,
                        run_sample_guided_encode_for_marker_pair,
                    )
                    originalMarkerSnapshot = copy.deepcopy(
                        settings["markerPairs"][markerPairIndex],
                    )
                    logger.rule(title=f"sample-guided encode ({markerPairIndex + 1})", sub=True)
                    # Pre-emit the user's configured pair settings before
                    # the search starts. Two purposes:
                    # 1. Operators see their baseline (the full settings
                    #    table) at the top of the search section.
                    # 2. The diff memo anchors on the user's original
                    #    snapshot, so every trial / reference / baseline
                    #    encode (all ``is_search_context=True``) renders
                    #    as a focused "sample-guided encode using overrides:" diff
                    #    vs the original — instead of falling through to
                    #    "no prior memo → print full table" on the first
                    #    trial. The post-search final-encode diff also
                    #    fires vs this same original baseline (the memo
                    #    is preserved across the search since trial-
                    #    context calls don't bump it).
                    #
                    # ``getMarkerPairSettings`` is non-idempotent on
                    # ``mp`` (mp.start / mp.end shifted by mps.delay,
                    # cropMap structure mutated, etc.). The orchestrator
                    # restores from ``originalMarkerSnapshot`` (captured
                    # above) before each encode, undoing this mutation.
                    getMarkerPairSettings(cs, markerPairIndex)
                    settings["markerPairs"][markerPairIndex] = copy.deepcopy(
                        originalMarkerSnapshot,
                    )
                    with time_stage(f"({markerPairIndex + 1}) crf search + encode"):
                        resultMarker = run_sample_guided_encode_for_marker_pair(
                            cs, markerPairIndex,
                            originalMarkerSnapshot=originalMarkerSnapshot,
                        )
                    settings["markerPairs"][markerPairIndex] = resultMarker
                    # Collect the search result for the cross-clip aggregate;
                    # the orchestrator stashes it on the marker dict.
                    if resultMarker is not None:
                        searchResult = resultMarker.get("sampleGuidedEncodeResult")
                        if searchResult is not None:
                            priorRunDeltas = resultMarker.get("priorRunDeltas") or ()
                            sampleGuidedEncodeSummaries.append(ClipSearchSummary(
                                marker_pair_index=markerPairIndex,
                                file_name_stem=resultMarker.get(
                                    "fileNameStem",
                                    f"clip-{markerPairIndex + 1}",
                                ),
                                result=searchResult,
                                prior_run_deltas=tuple(priorRunDeltas),
                            ))
                else:
                    logger.rule(title=f"Encode ({markerPairIndex + 1})", sub=True)
                    with time_stage(f"({markerPairIndex + 1}) encode"):
                        settings["markerPairs"][markerPairIndex] = makeClip(cs, markerPairIndex)
                generatePreviewForMarkerPair(cs, markerPairIndex)
            else:
                mp, _mps = getMarkerPairSettings(cs, markerPairIndex, True)
                settings["markerPairs"][markerPairIndex] = {
                    **(settings["markerPairs"][markerPairIndex]),
                    **mp,
                }

    if sampleGuidedEncodeSummaries:
        from clipper.sample_guided_encode import (
            format_aggregated_search_summary_log_block,
        )
        aggregateBlock = format_aggregated_search_summary_log_block(
            sampleGuidedEncodeSummaries,
        )
        if aggregateBlock:
            # Report-level emission with the sample-guided subsystem
            # prefix (this block IS the search summary; it just
            # happens to be flushed from the clip-maker loop). The
            # sample-guided logger keeps the chip honest about the
            # source.
            make_subsystem_logger(Subsystem.SAMPLE_ENCODE).report(aggregateBlock)

    if settings["markerPairMergeList"] != "":
        mergeClips(cs)


def generatePreviewForMarkerPair(cs: ClipperState, markerPairIndex: int) -> None:
    """Generate the animated preview sibling for a just-produced clip.

    Placed at the makeClips-loop level rather than inside makeClip so that
    fastTrimClip's early-return path is also covered. No-op when previews
    are disabled or the clip was not produced.
    """
    settings = cs.settings
    if settings.get("previewFormat", "none") == "none":
        return
    markerPair = settings["markerPairs"][markerPairIndex]
    if not markerPair:
        return
    clipFileOnDisk = markerPair.get("returncode") == 0 or markerPair.get("exists")
    if not clipFileOnDisk:
        return
    clipFilePath = markerPair.get("filePath")
    if not clipFilePath:
        return
    mps = {**settings, **markerPair.get("overrides", {})}
    previewPath = makePreview(
        cs.clipper_paths,
        clipFilePath,
        settings["previewFormat"],
        mps,
        settings["overwrite"],
    )
    if previewPath:
        markerPair["previewFilePath"] = previewPath


def previewClips(cs: ClipperState) -> None:
    settings = cs.settings
    while True:
        inputStr = ""
        try:
            inputStr = input(
                f"Enter a valid marker pair number (between {1} and {len(settings['markerPairs'])}) or quit(q): ",
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
