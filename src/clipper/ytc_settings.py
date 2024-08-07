import importlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

from clipper import util, ytdl_importer
from clipper.clip_maker import getDefaultEncodeSettings
from clipper.clipper_types import (
    UNKNOWN_PROPERTY,
    ClipperState,
    KnownPlatform,
    Settings,
)
from clipper.ffmpeg_filter import getMinterpFPS, getSubs
from clipper.ffprobe import ffprobeVideoProperties
from clipper.platforms import getVideoPageURL
from clipper.ytc_logger import logger


def loadSettings(settings: Settings) -> None:
    with Path.open(Path(settings["json"]), encoding="utf-8-sig") as file:
        markersJson = file.read()
        markersDict = json.loads(markersJson)
        settings.update(markersDict)

        if "markers" in settings and "markerPairs" not in settings:
            settings["markerPairs"] = settings["markers"]
        settings["platform"] = settings.get("platform", "youtube")

        settings["videoPageURL"] = getVideoPageURL(
            settings,
            settings["platform"],
            settings["videoID"],
        )
        settings["videoTitle"] = re.sub('"', "", settings["videoTitle"])
        settings["markersDataFileStem"] = Path(settings["json"]).stem

        if settings["markersDataFileStem"] != settings["markersDataFileStem"].rstrip():
            logger.fatal(
                "FATAL: Markers data file name stem (excluding .json extension) must not end in whitespace.",
            )
            logger.fatal(
                f"""markersDataFileStem={settings["markersDataFileStem"]!r}.""",
            )
            logger.fatal("Exiting...")
            sys.exit(1)
        settings["titleSuffix"] = settings["markersDataFileStem"]

        settings["downloadVideoNameStem"] = f'{settings["titleSuffix"]}-full'

        settings["mergedStreams"] = False
        if "enableSpeedMaps" not in settings:
            settings["enableSpeedMaps"] = not settings.get("noSpeedMaps", False)


def getInputVideo(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    input_video_pattern = (
        r"^" + re.escape(settings["downloadVideoNameStem"]) + r"\.[^.]+$"
    )
    potentialInputVideos = [
        f"{cp.clipsPath}/{iv}"
        for iv in os.listdir(cp.clipsPath)
        if re.search(input_video_pattern, iv)
    ]

    settings["automaticFetching"] = (
        not settings["inputVideo"] and not settings["downloadVideo"]
    )

    if (
        settings["automaticFetching"]
        and not settings["preview"]
        and not settings["noAutoFindInputVideo"]
        and len(potentialInputVideos) > 0
    ):
        logger.info(f"Found potential input video at path {potentialInputVideos[0]}.")
        if len(potentialInputVideos) > 1:
            logger.warning(
                f"Also found the following other potential input videos {potentialInputVideos[1:]}.",
            )
        settings["inputVideo"] = potentialInputVideos[0]

    if settings["automaticFetching"] and settings["preview"]:
        logger.warning(
            "Preview mode was enabled without providing a local input video and video downloading disabled.",
        )
        logger.warning(
            "Automatic fetching of video stream chunks provides a poor preview experience.",
        )
        logger.warning(
            "Automatically fetched video previews can only loop up to 32767 frames (~9 min at 60fps).",
        )
        logger.warning(
            "When previewing, a local video file uses less memory and does not require re-streaming from the"
            "internet on seek with right-click.",
        )
        logger.warning(
            "A local video also enables toggling of video correction filters with W.",
        )
        if not settings["noAutoFindInputVideo"] and len(potentialInputVideos) > 0:
            logger.info(
                f"Found potential input video at path {potentialInputVideos[0]}.",
            )
            useFoundInputVideo = input(
                r"Would you like to use this input video? (y/n): ",
            )
            if useFoundInputVideo in {"yes", "y"}:
                settings["inputVideo"] = potentialInputVideos[0]

        if not settings["inputVideo"]:
            try:
                logger.info(
                    "You may be able to drag and drop the input video file at the following prompt.",
                )
                settings["inputVideo"] = input(
                    f"Specify an input video path OR press ENTER to continue without doing so: ",
                )
                if settings["inputVideo"] == "":
                    logger.info(
                        f"The video can also be downloaded before previewing to the path: "
                        f'"{settings["downloadVideoPath"]}"',
                    )
                    logger.info(
                        "Note the file extension will be automatically determined.",
                    )
                    logger.info(
                        "If the file already exists it will be used as is without re-downloading.",
                    )
                    downloadVideo = input(
                        f"Would you like to automatically download the video? (y/n): ",
                    )
                    if downloadVideo in {"yes", "y"}:
                        settings["downloadVideo"] = True
            except Exception:
                pass

    if settings["inputVideo"]:
        if not Path(settings["inputVideo"]).is_file():
            logger.critical(
                f'Input video file "{settings["inputVideo"]}" does not exist or is not a file.',
            )
            logger.critical(f"Exiting...")
            sys.exit(1)
        else:
            logger.info(f'Using input video file "{settings["inputVideo"]}".')


def getVideoInfo(cs: ClipperState) -> None:
    settings = cs.settings

    UNSUPPORTED_VIDEO_STREAMING_PROTOCOLS = ["m3u8", "m3u8_native"]

    if (
        not settings["enableVideoStreamingProtocolHLS"]
        and settings["platform"] != KnownPlatform.afreecatv.name
    ):
        logger.notice("HLS streaming protocol (m3u8) is disabled.")
        disableVideoStreamingProtocols(settings, UNSUPPORTED_VIDEO_STREAMING_PROTOCOLS)

    videoInfo, audioInfo = _getVideoInfo(cs)

    if (
        not settings["downloadVideo"]
        and "protocol" in videoInfo
        and videoInfo["protocol"] in UNSUPPORTED_VIDEO_STREAMING_PROTOCOLS
        and settings["platform"] != KnownPlatform.afreecatv.name
    ):
        logger.warning(
            f'In streaming mode, got video with unsupported streaming protocol {videoInfo["protocol"]}.',
        )
        logger.warning(
            f"Unsupported streaming protocols: {UNSUPPORTED_VIDEO_STREAMING_PROTOCOLS}",
        )
        logger.warning(
            f"m3u8 and m3u8_native streaming protocols may require downloading the entire video before trimming and may occasionally fail anyways",
        )

        logger.warning(
            f"To avoid processing failures due to streaming m3u8/m3u8 native, consider downloading the video first either automatically with --download-video or the yt_clipper_auto_download helper script or manually and then specifying the video with --input-video or the yt_clipper_auto_input_video helper script",
        )

        response = input(r"Disable potentially unsupported protocols? (y/n): ")
        if response in {"yes", "y"}:
            logger.info(f"Retrying with potentially unsupported protocols disabled.")
            disableVideoStreamingProtocols(
                settings,
                UNSUPPORTED_VIDEO_STREAMING_PROTOCOLS,
            )
            videoInfo, audioInfo = _getVideoInfo(cs)
        else:
            logger.warning(
                f'Continuing with potentially unsupported protocol {videoInfo["protocol"]}',
            )

    if settings["downloadVideo"]:
        settings["inputVideo"] = settings["downloadVideoPath"]
    else:
        settings["videoDownloadURL"] = videoInfo["url"]
        settings["audioDownloadURL"] = audioInfo["url"]

    getMoreVideoInfo(cs, videoInfo, audioInfo)


def disableVideoStreamingProtocols(settings: Settings, protocols: List[str]) -> None:
    disableClause = "".join(f"[protocol!={protocol}]" for protocol in protocols)
    settings["format"] = f'({settings["format"]}){disableClause}'


def _getVideoInfo(cs: ClipperState) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    settings = cs.settings
    cp = cs.clipper_paths

    ydl_opts = {
        "format": settings["format"],
        "forceurl": True,
        "format_sort": ",".join(settings["formatSort"]).split(","),
        "merge_output_format": "mkv",
        "verbose": True,
        "outtmpl": f'{settings["downloadVideoPath"]}.%(ext)s',
        "cachedir": False,
        "youtube_include_dash_manifest": False,
    }

    if settings["username"] != "" or settings["password"] != "":
        ydl_opts["username"] = settings["username"]
        ydl_opts["password"] = settings["password"]

    if getattr(sys, "frozen", False):
        ydl_opts["ffmpeg_location"] = cp.ffmpegPath

    importlib.reload(ytdl_importer.youtube_dl)
    with ytdl_importer.youtube_dl.YoutubeDL(ydl_opts) as ydl:
        if settings["downloadVideo"]:
            ydl_info: Dict[str, Any] = ydl.extract_info(
                settings["videoPageURL"],
                download=True,
            )  # type: ignore
            settings["downloadVideoPath"] = f'{settings["downloadVideoPath"]}.mkv'
        else:
            ydl_info: Dict[str, Any] = ydl.extract_info(
                settings["videoPageURL"],
                download=False,
            )  # type: ignore

    settings["videoType"] = ydl_info.get("_type")

    settings["videoParts"] = []
    if settings["videoType"] == "multi_video":
        settings["videoParts"] = ydl_info["entries"]

    videoPartsStart = 0
    for videoPart in settings["videoParts"]:
        videoPart["start"] = videoPartsStart
        videoPart["end"] = videoPart["start"] + videoPart["duration"]
        videoPartsStart += videoPart["duration"]

    if "requested_formats" in ydl_info:
        videoInfo = ydl_info["requested_formats"][0]
        audioInfo = ydl_info["requested_formats"][1]
        settings["mergedStreams"] = False
    elif settings["videoType"] != "multi_video":
        videoInfo = ydl_info
        audioInfo = videoInfo
        settings["mergedStreams"] = True
    else:
        videoInfo = settings["videoParts"][0]
        audioInfo = videoInfo
        settings["mergedStreams"] = True

    # print(json.dumps(videoInfo))

    return videoInfo, audioInfo


def getMoreVideoInfo(cs: ClipperState, videoInfo: Dict, audioInfo: Dict) -> None:
    settings = cs.settings

    # TODO: ffprobe all streams including audio
    # TODO: merge properties fetched from ffprobe and ytdl into common namespace
    # TODO: improve compatibility between inputVideo mode and default stream mode
    if settings["inputVideo"]:
        settings["videoType"] = "local_video"
        probedSettings = ffprobeVideoProperties(cs, settings["inputVideo"])
    else:
        probedSettings = ffprobeVideoProperties(cs, settings["videoDownloadURL"])

    settings.update(videoInfo)
    if probedSettings is not None:
        settings.update(probedSettings)
    else:
        logger.warning("Could not fetch video info with ffprobe")
        logger.warning("Defaulting to video info fetched with youtube-dl")

    if "bit_rate" not in settings:
        settings["bit_rate"] = int(videoInfo["tbr"])

    if "r_frame_rate" not in settings:
        DEFAULT_VIDEO_FPS = 30
        if videoInfo["fps"] is None:
            logger.warning(
                f"Could not determine video fps. Assuming {DEFAULT_VIDEO_FPS} fps.",
            )
        settings["r_frame_rate"] = (
            videoInfo["fps"] if videoInfo["fps"] is not None else DEFAULT_VIDEO_FPS
        )

    logger.report(f'Video Title: {settings["videoTitle"]}')

    videoFormat = util.dictTryGetKeys(
        videoInfo,
        "vcodec",
        "format",
        default=UNKNOWN_PROPERTY,
    )
    videoFormatID = util.dictTryGetKeys(
        videoInfo,
        "format_id",
        default=UNKNOWN_PROPERTY,
    )
    audioFormat = util.dictTryGetKeys(
        audioInfo,
        "acodec",
        "format",
        default=UNKNOWN_PROPERTY,
    )
    audioFormatID = util.dictTryGetKeys(
        audioInfo,
        "format_id",
        default=UNKNOWN_PROPERTY,
    )

    logger.report(f"Video Format: {videoFormat} ({videoFormatID})")
    # TODO: improve detection of when unique audio stream format information is available
    if videoFormat != audioFormat:
        logger.report(f"Audio Format: {audioFormat} ({audioFormatID})")

    logger.report(
        f'Video Width: {settings["width"]}, Video Height: {settings["height"]}',
    )
    logger.report(
        f'Video FPS: {settings["r_frame_rate"]}, Video Bitrate: {settings["bit_rate"]}kbps',
    )

    autoSetCropMultiples(settings)


def getGlobalSettings(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    logger.report(f'Video Page URL: {settings["videoPageURL"]}')
    logger.report(
        f'Merge List: {settings["markerPairMergeList"] if settings["markerPairMergeList"] else "None"}',
    )

    if settings["subsFilePath"] == "" and settings["autoSubsLang"] != "":
        getSubs(cs)
        if not Path(settings["subsFilePath"]).is_file():
            logger.critical(
                f'Could not download subtitles with language id {settings["autoSubsLang"]}.',
            )
            sys.exit(1)
    elif settings["subsFilePath"] != "":
        if not Path(settings["subsFilePath"]).is_file():
            logger.critical(
                f'Could not find subtitles file at "{settings["subsFilePath"]}"',
            )
            sys.exit(1)
        else:
            logger.success(f'Found subtitles file at "{settings["subsFilePath"]}"')

    if settings["subsFilePath"] != "":
        subsPath = Path(f"{cp.clipsPath}/subs")
        subsPath.mkdir(parents=True, exist_ok=True)
        subs_ext = Path(settings["subsFilePath"]).suffix
        if subs_ext not in [".vtt", ".sbv", ".srt"]:
            logger.error(f"Unknown subtitle file extension {subs_ext}.")
            logger.warning("Only .vtt, .sbv, and .srt subtitles are supported for now.")
            skipSubs = input("Would you like to continue without subtitles? (y/n): ")
            if skipSubs in {"yes", "y"}:
                logger.warning("Continuing without subtitles.")
                settings["subsFilePath"] = ""
            else:
                logger.error("Exiting...")
                sys.exit(1)

    if settings["inputVideo"]:
        getMoreVideoInfo(cs, {}, {})
    else:
        getVideoInfo(cs)

    encodeSettings = getDefaultEncodeSettings(settings["bit_rate"])

    logger.info("-" * 80)
    unknownColorSpaceMsg = "unknown (bt709 will be assumed for color range operations)"
    globalColorSpaceMsg = f'{settings["color_space"] if settings["color_space"] else unknownColorSpaceMsg}'
    logger.info(
        f'Automatically determined encoding settings: CRF: {encodeSettings["crf"]} (0-63), '
        + f'Auto Target Max Bitrate: {encodeSettings["autoTargetMaxBitrate"]}kbps, '
        + f"Detected Color Space: {globalColorSpaceMsg}, "
        + f'Two-pass Encoding Enabled: {encodeSettings["twoPass"]}, '
        + f'Encoding Speed: {encodeSettings["encodeSpeed"]} (0-5)',
    )

    encodeSettings = {**encodeSettings, **settings}
    if "targetMaxBitrate" not in encodeSettings:
        encodeSettings["targetMaxBitrate"] = encodeSettings["autoTargetMaxBitrate"]

    logger.info("-" * 80)
    globalTargetBitrateMsg = (
        f'{encodeSettings["targetMaxBitrate"]}kbps'
        if "targetMaxBitrate" in encodeSettings
        else "Auto"
    )
    minterpFPSMsg = f"Target FPS: {getMinterpFPS(settings, None)}, "
    logger.info(
        f'Global Encoding Settings: Video Codec: {settings["videoCodec"]}, CRF: {encodeSettings["crf"]} (0-63), '
        + f'Detected Bitrate: {settings["bit_rate"]}kbps, '
        + f"Global Target Bitrate: {globalTargetBitrateMsg}, "
        + f'Two-pass Encoding Enabled: {encodeSettings["twoPass"]}, '
        + f'Encoding Speed: {encodeSettings["encodeSpeed"]} (0-5), '
        + f'Audio Enabled: {settings["audio"]}, '
        + f'Denoise: {settings["denoise"]["desc"]}, Rotate: {settings["rotate"]}, '
        + f'Expand Color Range Enabled: {settings["expandColorRange"]}, '
        + f'Speed Maps Enabled: {settings["enableSpeedMaps"]}, '
        + f'Minterpolation Mode: {settings["minterpMode"]}, '
        + minterpFPSMsg
        + f'Special Looping: {settings["loop"]}, '
        + (
            f'Fade Duration: {settings["fadeDuration"]}, '
            if settings["loop"] == "fade"
            else ""
        )
        + f'Video Stabilization Strength: {settings["videoStabilization"]["desc"]}, '
        + f"Video Stabilization Max Angle: "
        + (
            f'{settings["videoStabilizationMaxAngle"]} degrees, '
            if settings["videoStabilizationMaxAngle"] >= 0
            else "Unlimited, "
        )
        + f"Video Stabilization Max Shift: "
        + (
            f'{settings["videoStabilizationMaxShift"]} pixels, '
            if settings["videoStabilizationMaxShift"] >= 0
            else "Unlimited, "
        )
        + f'Video Stabilization Dynamic Zoom: {settings["videoStabilizationDynamicZoom"]}',
    )


def autoSetCropMultiples(settings: Settings) -> None:
    cropMultipleX = settings["width"] / settings["cropResWidth"]
    cropMultipleY = settings["height"] / settings["cropResHeight"]

    if (
        settings["cropResWidth"] != settings["width"]
        or settings["cropResHeight"] != settings["height"]
    ):
        logger.info("-" * 80)
        logger.info("Crop resolution does not match video resolution")
        if settings["cropResWidth"] != settings["width"]:
            logger.info(
                f'Crop resolution width ({settings["cropResWidth"]}) not equal to video width ({settings["width"]})',
            )
        if settings["cropResHeight"] != settings["height"]:
            logger.info(
                f'Crop resolution height ({settings["cropResHeight"]}) not equal to video height ({settings["height"]})',
            )

        if not settings["noAutoScaleCropRes"]:
            logger.info(
                f"Crop X offset and width will be multiplied by {cropMultipleX}",
            )
            logger.info(
                f"Crop Y offset and height will be multiplied by {cropMultipleY}",
            )
            settings.update(
                {"cropMultipleX": cropMultipleX, "cropMultipleY": cropMultipleY},
            )
        else:
            logger.info(f"Auto scale crop resolution disabled in settings.")


def filterDash(
    cs: ClipperState,
    dashManifestUrl: str,
    dashFormatIDs: List[str],
) -> Path:
    cp = cs.clipper_paths

    from urllib import request
    from xml.dom import minidom

    with request.urlopen(dashManifestUrl) as dash:
        dashdom = minidom.parse(dash)

    reps = dashdom.getElementsByTagName("Representation")
    for rep in reps:
        elementId = rep.getAttribute("id")
        if elementId not in dashFormatIDs:
            rep.parentNode.removeChild(rep)

    filteredDashPath = Path(f"{cp.clipsPath}/filtered-dash.xml")
    with filteredDashPath.open("w+", encoding="utf-8") as filteredDash:
        filteredDash.write(dashdom.toxml())

    return filteredDashPath
