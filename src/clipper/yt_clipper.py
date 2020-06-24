#!/usr/bin/env python3

import argparse
import importlib
import io
import json
import logging
import os
import re
import shlex
import subprocess
import sys
import time
from fractions import Fraction
from functools import reduce
from math import ceil, floor, log
from pathlib import Path

import coloredlogs
import verboselogs
import youtube_dl

UPLOAD_KEY_REQUEST_ENDPOINT = 'https://api.gfycat.com/v1/gfycats?'
FILE_UPLOAD_ENDPOINT = 'https://filedrop.gfycat.com'
AUTHENTICATION_ENDPOINT = 'https://api.gfycat.com/v1/oauth/token'

__version__ = '3.7.0-beta.3.9.0-alpha.7'

settings = {}

outPaths = []
fileNames = []
links = []
markdown = ''

ffmpegPath = 'ffmpeg'
ffprobePath = 'ffprobe'
ffplayPath = 'ffplay'
webmsPath = './webms'
logger = None

if True:
    ffmpegPath = './bin/ffmpeg'
    ffprobePath = './bin/ffprobe'
    ffplayPath = './bin/ffplay'
    if sys.platform == 'win32':
        ffmpegPath += '.exe'
        ffprobePath += '.exe'
        ffplayPath += '.exe'
    if sys.platform == 'darwin':
        os.environ['SSL_CERT_FILE'] = "certifi/cacert.pem"


def main():
    global settings, webmsPath
    args, unknown = buildArgParser()
    if args.cropMultiple != 1:
        args.cropMultipleX = args.cropMultiple
        args.cropMultipleY = args.cropMultiple

    args = vars(args)

    args = {k: v for k, v in args.items() if v is not None}

    args["videoStabilization"] = getVidstabPreset(
        args["videoStabilization"], args["videoStabilizationDynamicZoom"])
    args["denoise"] = getDenoisePreset(args["denoise"])
    settings = {'markerPairMergeList': '', 'rotate': 0,
                'overlayPath': '', 'delay': 0, 'color_space': None, **args}

    settings["isDashVideo"] = False
    settings["isDashAudio"] = False
    if "enableSpeedMaps" not in settings:
        settings["enableSpeedMaps"] = not settings["noSpeedMaps"]

    with open(settings["json"], 'r', encoding='utf-8-sig') as file:
        markersJson = file.read()
        settings = loadMarkers(markersJson, settings)
    settings["videoTitle"] = re.sub('"', '', settings["videoTitle"])
    settings["markersDataFileStem"] = Path(settings["json"]).stem
    settings["titleSuffix"] = settings["markersDataFileStem"]
    webmsPath += f'/{settings["titleSuffix"]}'

    os.makedirs(f'{webmsPath}', exist_ok=True)
    reportStream = io.StringIO()
    setUpLogger(reportStream)

    logger.info(f'Version: {__version__}')
    logger.info('-' * 80)

    if settings["enableMinterpEnhancements"] and sys.platform == 'win32':
        global ffmpegPath
        ffmpegPath = "./bin/ffmpeg_ytc.exe"
        if not Path(ffmpegPath).is_file():
            logger.error(f'{ffmpegPath} required for minterp enhancements not found.')
            sys.exit(1)
        else:
            logger.success(f'Found {ffmpegPath}. Minterp enhancements enabled.')
    else:
        settings["enableMinterpEnhancements"] = False

    settings["downloadVideoNameStem"] = f'{settings["titleSuffix"]}-full'
    settings["downloadVideoPath"] = f'{webmsPath}/{settings["downloadVideoNameStem"]}'
    pivpat = r'^' + re.escape(settings["downloadVideoNameStem"]) + r'\.[^.]+$'
    potentialInputVideos = [
        f'{webmsPath}/{iv}' for iv in os.listdir(webmsPath) if re.search(pivpat, iv)]

    settings["automaticFetching"] = not settings["inputVideo"] and not settings["downloadVideo"]

    if settings["automaticFetching"] and not settings["preview"] and not settings["noAutoFindInputVideo"]:
        if len(potentialInputVideos) > 0:
            logger.info(
                f'Found potential input video at path {potentialInputVideos[0]}.')
            if len(potentialInputVideos) > 1:
                logger.warning(
                    f'Also found the following other potential input videos {potentialInputVideos[1:]}.')
            settings["inputVideo"] = potentialInputVideos[0]

    if settings["automaticFetching"] and settings["preview"]:
        logger.warning(
            "Preview mode was enabled without providing a local input video and video downloading disabled.")
        logger.warning(
            "Automatic fetching of video stream chunks provides a poor preview experience.")
        logger.warning(
            "Automatically fetched video previews can only loop up to 32767 frames (~9 min at 60fps).")
        logger.warning(
            "When previewing, a local video file uses less memory and does not require re-streaming from the"
            "internet on seek with right-click.")
        logger.warning(
            "A local video also enables toggling of video correction filters with W.")
        if not settings["noAutoFindInputVideo"]:
            if len(potentialInputVideos) > 0:
                logger.info(
                    f'Found potential input video at path {potentialInputVideos[0]}.')
                useFoundInputVideo = input(
                    r'Would you like to use this input video? (y/n): ')
                if useFoundInputVideo == 'yes' or useFoundInputVideo == 'y':
                    settings["inputVideo"] = potentialInputVideos[0]

        if not settings["inputVideo"]:
            try:
                logger.info(
                    "You may be able to drag and drop the input video file at the following prompt.")
                settings["inputVideo"] = input(
                    f'Specify an input video path OR press ENTER to continue without doing so: ')
                if settings["inputVideo"] == '':
                    logger.info(
                        f'The video can also be downloaded before previewing to the path: '
                        f'"{settings["downloadVideoPath"]}"')
                    logger.info(
                        "Note the file extension will be automatically determined.")
                    logger.info(
                        "If the file already exists it will be used as is without re-downloading.")
                    downloadVideo = input(
                        f'Would you like to automatically download the video? (y/n): ')
                    if downloadVideo == 'yes' or downloadVideo == 'y':
                        settings["downloadVideo"] = True
            except:
                pass

    if settings["inputVideo"]:
        if not Path(settings["inputVideo"]).is_file():
            logger.error(
                f'Input video file "{settings["inputVideo"]}" does not exist or is not a file.')
            logger.error(f'Exiting...')
            sys.exit(1)
        else:
            logger.info(
                f'Automatically using found input video file "{settings["inputVideo"]}".')

    settings = prepareGlobalSettings(settings)

    logger.info("-" * 80)
    if not settings["preview"]:
        nMarkerPairs = len(settings["markerPairs"])
        markerPairQueue = getMarkerPairQueue(nMarkerPairs, settings["only"], settings["except"])
        if len(markerPairQueue) == 0:
            logger.warning("No marker pairs to process")
        else:
            printableMarkerPairQueue = {x + 1 for x in markerPairQueue}
            logger.report(f'Processing the following set of marker pairs: {printableMarkerPairQueue}')

        for markerPairIndex, marker in enumerate(settings["markerPairs"]):
            if markerPairIndex in markerPairQueue:
                settings["markerPairs"][markerPairIndex] = makeMarkerPairClip(settings, markerPairIndex)

        if settings["markerPairMergeList"] != '':
            makeMergedClips(settings)
    else:
        while True:
            try:
                inputStr = input(
                    f'Enter a valid marker pair number (between {1} and {len(settings["markerPairs"])}) or quit(q): ')
                if inputStr == 'quit' or inputStr == 'q':
                    break
                markerPairIndex = int(inputStr)
                markerPairIndex -= 1
            except ValueError:
                logger.error(f'{inputStr} is not a valid number.')
                continue
            if 0 <= markerPairIndex < len(settings["markerPairs"]):
                makeMarkerPairClip(settings, markerPairIndex)
            else:
                logger.error(
                    f'{markerPairIndex + 1} is not a valid marker pair number.')
            continue

    printReport(reportStream)


def setUpLogger(reportStream):
    global logger
    verboselogs.add_log_level(33, "HEADER")
    verboselogs.add_log_level(34, "REPORT")
    logger = verboselogs.VerboseLogger(__name__)
    logger.header = lambda msg: logger.log(33, msg)
    logger.report = lambda msg: logger.log(34, msg)

    formatString = r'[%(asctime)s] (ln %(lineno)d) %(levelname)s: %(message)s'
    coloredlogs.DEFAULT_LOG_FORMAT = formatString
    coloredlogs.DEFAULT_FIELD_STYLES['levelname'] = {'color': 'white'}
    coloredlogs.DEFAULT_LEVEL_STYLES['HEADER'] = {'color': 'blue'}
    coloredlogs.DEFAULT_LEVEL_STYLES['REPORT'] = {'color': 'cyan'}

    coloredlogs.install(level=logging.INFO, datefmt="%y-%m-%d %H:%M:%S")

    coloredFormatter = coloredlogs.ColoredFormatter(datefmt="%y-%m-%d %H:%M:%S")

    reportHandler = logging.StreamHandler(reportStream)
    reportHandler.setLevel(33)
    reportHandler.setFormatter(coloredFormatter)
    logger.addHandler(reportHandler)

    if not settings["preview"]:
        fileHandler = logging.FileHandler(
            filename=f'{webmsPath}/{settings["titleSuffix"]}.log', mode='a', encoding='utf-8', )
        formatter = coloredlogs.BasicFormatter(datefmt="%y-%m-%d %H:%M:%S")
        fileHandler.setFormatter(formatter)
        logger.addHandler(fileHandler)


def printReport(reportStream):
    report = reportStream.getvalue()
    logger.info("-" * 80)
    logger.header("#" * 30 + " Summary Report " + "#" * 30)
    logger.notice("\n" + report)


def buildArgParser():
    parser = argparse.ArgumentParser(
        description='Generate trimmed webms from input video.')
    parser.add_argument('--input-video', '-i', dest='inputVideo', default='',
                        help='Input video path.')
    parser.add_argument('--download-video', '-dv', action='store_true', dest='downloadVideo',
                        help='Download video from the internet and use as input video for processing marker data.')
    parser.add_argument('--markers-json', '-j', required=True, dest='json',
                        help=('Specify markers json path for generating webms from input video.'
                              'Automatically streams required portions of input video from the '
                              'internet if it is not otherwise specified.'))
    parser.add_argument('--overlay', '-ov', dest='overlay',
                        help='overlay image path')
    parser.add_argument('--multiply-crop', '-mc', type=float, dest='cropMultiple', default=1,
                        help=('Multiply all crop dimensions by an integer. ' +
                              '(Helpful if you change resolutions: eg 1920x1080 * 2 = 3840x2160(4k)).'))
    parser.add_argument('--multiply-crop-x', '-mcx', type=float, dest='cropMultipleX', default=1,
                        help='Multiply all x crop dimensions by an integer.')
    parser.add_argument('--multiply-crop-y', '-mcy', type=float, dest='cropMultipleY', default=1,
                        help='Multiply all y crop dimensions by an integer.')
    parser.add_argument('--only', default='',
                        help=('Specify which marker pairs to process by providing a comma separated '
                              'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9"). '
                              'The --except flag takes precedence and will skip pairs specified with --only.'))
    parser.add_argument('--except', default='',
                        help=('Specify which marker pairs to skip by providing a comma separated '
                              'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9"). '
                              'The --except flag takes precedence and will skip pairs specified with --only.'))
    parser.add_argument('--gfycat', '-gc', action='store_true',
                        help='upload all output webms to gfycat and print reddit markdown with all links')
    parser.add_argument('--audio', '-a', action='store_true',
                        help='Enable audio in output webms.')
    parser.add_argument('--format', '-f', default='bestvideo+(bestaudio[acodec=opus]/bestaudio)',
                        help='Specify format string passed to youtube-dl.')
    parser.add_argument('--extra-video-filters', '-evf', dest='extraVideoFilters', default='',
                        help='Specify any extra video filters to be passed to ffmpeg.')
    parser.add_argument('--extra-audio-filters', '-eaf', dest='extraAudioFilters', default='',
                        help='Specify any extra audio filters to be passed to ffmpeg.')
    parser.add_argument('--minterp-mode', '-mm', dest='minterpMode', default='Numeric',
                        choices=['Numeric', 'None', 'MaxSpeed', 'VideoFPS', 'MaxSpeedx2', 'VideoFPSx2'],
                        help=('Motion interpolation is Enabled by default in a numeric mode.'
                              'In numeric mode, specify a valid target fps value in --minterp-fps. '
                              'In MaxSpeed mode, targets the fps of the highest speed seen in the dynamic speed chart. '
                              'In VideoFPS mode, targets the fps of the input video. '
                              'MaxSpeedx2 and VideoFPSx2 modes double the target fps from the previous two modes. '
                              ))
    parser.add_argument('--minterp-fps', '-mf', dest='minterpFPS', type=int,
                        help=(
                            'Input an fps value from 10-120 to add interpolated frames and achieve smooth slow motion. '
                            'Motion interpolation mode must be set to Numeric. '
                            'This filter is resource intensive and will take longer to process the higher the target fps. '
                            'Motion interpolation can and will introduce artifacting (visual glitches). '
                            'Artifacting increases with the speed and complexity of the video. '
                        ))
    parser.add_argument('--enable-minterp-enhancements', '-eme', action='store_true',
                        dest='enableMinterpEnhancements', default=False,
                        help=(
                            'Enables experimental enhancements for motion interpolation (minterp):'
                            ' 1) Sections of the video already at the target minterp speed are not interpolated.'
                            '    This saves resources and improves performance and avoids artifacting.'
                            ' 2) The original video frames are forcibly used in the interpolated result.'
                            '    This improves performance and may reduce artifacting at the cost of some smoothness.'
                            'Enabling this option requires a custom build of ffmpeg named ffmpeg_ytc.'
                            'ffmpeg_ytc must be present inside the bin folder of the clipper installation.'
                            'Currently ffmpeg_ytc is available only for windows.'
                        ))
    parser.add_argument('--delay', '-d', type=float, dest='delay', default=0,
                        help='Add a fixed delay to both the start and end time of each marker. Can be negative.')
    parser.add_argument('--gamma', '-ga', type=float, dest='gamma', default=1,
                        help='Apply luminance gamma correction.'
                        'Pass in a value between 0 and 1 to brighten shadows and reveal darker details.')
    parser.add_argument('--rotate', '-r', choices=['clock', 'cclock'],
                        help='Rotate video 90 degrees clockwise or counter-clockwise.')
    parser.add_argument('--denoise', '-dn', type=int, default=0, choices=range(0, 6),
                        help='Apply the hqdn3d denoise filter using a preset strength level from 0-5 '
                        'where 0 is disabled and 5 is very strong.')
    parser.add_argument('--video-stabilization', '-vs', dest='videoStabilization',
                        type=int, default=0, choices=range(0, 7),
                        help='Apply video stabilization using a preset strength from 0-6 '
                        'where 0 is disabled and 6 is strongest.')
    parser.add_argument('--video-stabilization-dynamic-zoom', '-vsdz',
                        dest='videoStabilizationDynamicZoom', type=bool, default=False,
                        help='Enable video stabilization dynamic zoom. '
                        'Unlike a static zoom the zoom in can vary with time to reduce cropping of video.')
    parser.add_argument('--remove-duplicate-frames', '-rdf', dest='removeDuplicateFrames',
                        action='store_true',
                        help=(
                            'Remove duplicate frames from input video.'
                            'This option is automatically enabled when motion interpolation is enabled.'
                        ))
    parser.add_argument('--deinterlace', '-di', action='store_true',
                        help='Apply bwdif deinterlacing.')
    parser.add_argument('--expand-color-range', '-ecr', dest='expandColorRange', action='store_true',
                        help='Expand the output video color range to full (0-255).')
    parser.add_argument('--loop', '-l', dest='loop', choices=['none', 'fwrev', 'fade'], default='none',
                        help='Apply special looping effect to marker pair clips. '
                        'For a forward-reverse or ping-pong loop use fwrev. For a cross-fading loop use fade.')
    parser.add_argument('--fade-duration', '-fd', type=float, dest='fadeDuration', default=0.7,
                        help=('When fade loop is enabled, set the duration of the fade for both clip start and end. '
                              'The fade duration is clamped to a minimum of 0.1 seconds '
                              'and a maximum of 40%% of the output clip duration.'))
    parser.add_argument('--audio-fade', '-af', type=float, dest='audioFade', default=0,
                        help=('Fade the audio in at start and out at end by the specified duration in seconds.'))
    parser.add_argument('--encode-speed', '-s', type=int, dest='encodeSpeed', choices=range(0, 6),
                        help='Set the vp9 encoding speed.')
    parser.add_argument('--crf', type=int,
                        help=('Set constant rate factor (crf). Default is 30 for video file input.' +
                              'Automatically set to a factor of the detected video bitrate'))
    parser.add_argument('--two-pass', '-tp', dest='twoPass', action='store_true',
                        help='Enable two-pass encoding. Improves quality at the cost of encoding speed.')
    parser.add_argument('--target-max-bitrate', '-b', dest='targetMaxBitrate', type=int,
                        help=('Set target max bitrate in kilobits/s. Constrains bitrate of complex scenes.' +
                              'Automatically set based on detected video bitrate.'))
    parser.add_argument('--enable-vp8', '-vp8', dest='vp8', action='store_true', default=False,
                        help=(
                            'Use vp8 codec for video encoding instead of the default vp9.'
                            'Also use libopus for audio encoding instead of the default libopus.'
                            'Note that yt_clipper is not yet optimized for vp8, only for vp9.'
                            'This means quality and file size may not be well balanced.'
                            'Additionally, vp9 generally offers a better quality-size trade-off.'
                        ))
    parser.add_argument('--auto-subs-lang', '-asl', dest='autoSubsLang', default='',
                        help=(
                            'Automatically download and add subtitles from YouTube in the specified language.'
                            'Subtitles will be burned (hardcoded) into the video.'
                            'The argument to this option is a two-letter language code (eg en, fr, ko, ja).'
                        ))
    parser.add_argument('--subs-file', '-sf', dest='subsFilePath', default='',
                        help=(
                            'Provide a subtitles file in vtt, sbv, or srt format .'
                            'Subtitles will be burned (hardcoded) into the video.'
                            'This option will take precedence over `--auto-subs-lang`.'
                        ))
    parser.add_argument('--subs-style', '-ss', dest='subsStyle',
                        default='FontSize=12,PrimaryColour=&H32FFFFFF,SecondaryColour=&H32000000,MarginV=5',
                        help=(
                            'Specify an ASS format string for styling subtitles.'
                            'The provided styles will override those specified in the subs file.'
                            'See https://fileformats.fandom.com/wiki/SubStation_Alpha#Styles_section.'
                        ))
    parser.add_argument('--no-auto-scale-crop-res', '-nascr', dest='noAutoScaleCropRes', action='store_true',
                        help=('Disable automatically scaling the crop resolution '
                              'when a mismatch with video resolution is detected.'))
    parser.add_argument('--preview', '-p', action='store_true',
                        help=('Pass in semicolon separated lists of marker pairs. '
                              'Lists of marker pairs are comma-separated numbers or dash separated ranges. '
                              '(eg 1-3,7;4-6,9)'))
    parser.add_argument('--no-auto-find-input-video', '-nafiv', dest='noAutoFindInputVideo', action='store_true',
                        help='Disable automatic detection and usage of input video when not in preview mode.')
    parser.add_argument('--no-speed-maps', '-nsm', dest='noSpeedMaps', action='store_true',
                        help='Disable speed maps for time-variable speed.')
    parser.add_argument('--remove-metadata', '-rm', dest='removeMetadata', action='store_true',
                        help=(
                            'Do not add metadata to output video.'
                            'The only metadata currently added is the videoTitle from the markers .json file.'
                            'Also tries to strip any other metadata that may otherwise be added.'
                            'Some basic video properties such as the duration or muxing app will remain.'
                        ))
    parser.add_argument('--extra-ffmpeg-args', '-efa', dest='extraFfmpegArgs', default='',
                        help=(
                            'Extra arguments to be passed to the ffmpeg command built by yt_clipper.'
                            'The extra arguments are injected after other arguments set by yt_clipper, '
                            'but before the video filters.'
                            'Use quotes to ensure the arguments are passed to ffmpeg including whitespace.'
                            'On Windows, if nested quoting is required, it may be necessary '
                            'to use double quotes for the outermost quotes due to a bug.'
                            'Arguments that conflict with the arguments automatically added '
                            'by yt_clipper may cause errors.'
                        ))
    return parser.parse_known_args()


def getMarkerPairQueue(nMarkerPairs, onlyArg, exceptArg):
    markerPairQueue = set(range(nMarkerPairs))
    onlyPairsSet = markerPairQueue
    exceptPairsSet = set()

    if onlyArg != '':
        try:
            onlyPairsList = markerPairsCSVToList(onlyArg)
        except ValueError:
            logger.error(f'Argument provided to --only was invalid: {onlyArg}')
            sys.exit(1)
        onlyPairsSet = {x - 1 for x in set(onlyPairsList)}
    if exceptArg != '':
        try:
            exceptPairsList = markerPairsCSVToList(exceptArg)
        except ValueError:
            logger.error(f'Argument provided to --except was invalid: {exceptArg}')
            sys.exit(1)
        exceptPairsSet = {x - 1 for x in set(exceptPairsList)}

    onlyPairsSet.difference_update(exceptPairsSet)
    markerPairQueue.intersection_update(onlyPairsSet)
    return markerPairQueue


def loadMarkers(markersJson, settings):
    markersDict = json.loads(markersJson)
    settings = {**settings, **markersDict}
    if "markers" in settings and "markerPairs" not in settings:
        settings["markerPairs"] = settings["markers"]
    settings["videoURL"] = 'https://www.youtube.com/watch?v=' + \
        settings["videoID"]

    return settings


def getVideoURL(settings):
    ydl_opts = {'format': settings["format"], 'forceurl': True,
                'merge_output_format': 'mkv',
                'outtmpl': f'{settings["downloadVideoPath"]}.%(ext)s', "cachedir": False}

    if getattr(sys, 'frozen', False):
        ydl_opts["ffmpeg_location"] = ffmpegPath

    with youtube_dl.YoutubeDL(ydl_opts) as ydl:
        if settings["downloadVideo"]:
            ydl_info = ydl.extract_info(settings["videoURL"], download=True)
            settings["downloadVideoPath"] = f'{settings["downloadVideoPath"]}.mkv'
        else:
            ydl_info = ydl.extract_info(settings["videoURL"], download=False)

    if 'requested_formats' in ydl_info:
        rf = ydl_info["requested_formats"]
        videoInfo = rf[0]
    else:
        videoInfo = ydl_info

    dashFormatIDs = []
    dashVideoFormatID = None
    dashAudioFormatID = None

    if settings["downloadVideo"]:
        settings["inputVideo"] = settings["downloadVideoPath"]
    else:
        if videoInfo["protocol"] == 'http_dash_segments':
            settings["isDashVideo"] = True
            dashVideoFormatID = videoInfo["format_id"]
            dashFormatIDs.append(dashVideoFormatID)
        else:
            settings["videoURL"] = videoInfo["url"]

        if 'requested_formats' in ydl_info:
            audioInfo = rf[1]
            settings["audiobr"] = int(audioInfo["tbr"])

            if audioInfo["protocol"] == 'http_dash_segments':
                settings["isDashAudio"] = True
                dashAudioFormatID = audioInfo["format_id"]
                dashFormatIDs.append(dashAudioFormatID)
            else:
                settings["audioURL"] = audioInfo["url"]

        if dashFormatIDs:
            filteredDashPath = filterDash(videoInfo["url"], dashFormatIDs)
            if settings["isDashVideo"]:
                settings["videoURL"] = filteredDashPath
            if settings["isDashAudio"]:
                settings["audioURL"] = filteredDashPath

    return getVideoInfo(settings, videoInfo)


def getVideoInfo(settings, videoInfo):
    if settings["inputVideo"]:
        probedSettings = ffprobeVideoProperties(settings["inputVideo"])
    else:
        probedSettings = ffprobeVideoProperties(settings["videoURL"])

    settings = {**settings, **videoInfo}
    if probedSettings is not None:
        settings = {**settings, **probedSettings}
    else:
        logger.warning(
            "Could not fetch video info with ffprobe")
        logger.warning("Defaulting to video info fetched with youtube-dl")

    if settings["isDashVideo"] or "bit_rate" not in settings:
        settings["bit_rate"] = int(videoInfo["tbr"])

    if "r_frame_rate" not in settings:
        settings["r_frame_rate"] = videoInfo["fps"]

    logger.info(f'Video Title: {settings["videoTitle"]}')
    logger.info(f'Video Width: {settings["width"]}')
    logger.info(f'Video Height: {settings["height"]}')
    logger.info(f'Video fps: {settings["r_frame_rate"]}')
    logger.notice(f'Detected Video Bitrate: {settings["bit_rate"]}kbps')

    settings = autoSetCropMultiples(settings)

    return settings


def getSubs(settings):
    importlib.reload(youtube_dl)
    settings["subsFileStem"] = f'{webmsPath}/subs/{settings["titleSuffix"]}'
    settings["subsFilePath"] = f'{settings["subsFileStem"]}.{settings["autoSubsLang"]}.vtt'

    ydl_opts = {'skip_download': True, 'writesubtitles': True,
                'subtitlesformat': 'vtt', 'subtitleslangs': [settings["autoSubsLang"]],
                'outtmpl': f'{settings["subsFileStem"]}', "cachedir": False}

    with youtube_dl.YoutubeDL(ydl_opts) as ydl:
        ydl.download([settings["videoURL"]])

    return settings


def prepareGlobalSettings(settings):
    logger.info(f'Video URL: {settings["videoURL"]}')
    logger.info(
        f'Merge List: {settings["markerPairMergeList"] if settings["markerPairMergeList"] else "None"}')

    if settings["subsFilePath"] == '' and settings["autoSubsLang"] != '':
        settings = getSubs(settings)
        if not Path(settings["subsFilePath"]).is_file():
            logger.error(f'Could not download subtitles with language id {settings["autoSubsLang"]}.')
            sys.exit(1)
    elif settings["subsFilePath"] != '':
        if not Path(settings["subsFilePath"]).is_file():
            logger.error(f'Could not find subtitles file at "{settings["subsFilePath"]}"')
            sys.exit(1)
        else:
            logger.success(f'Found subtitles file at "{settings["subsFilePath"]}"')

    if settings["subsFilePath"] != '':
        subsPath = f'{webmsPath}/subs'
        os.makedirs(subsPath, exist_ok=True)
        subs_ext = Path(settings["subsFilePath"]).suffix
        if subs_ext not in ['.vtt', '.sbv', '.srt']:
            logger.error(f'Uknown subtitle file extension {subs_ext}.')
            logger.notice('Only .vtt, .sbv, and .srt subtitles are supported for now.')
            skipSubs = input('Would you like to continue without subtitles? (y/n): ')
            if skipSubs == 'yes' or skipSubs == 'y':
                logger.notice('Continuing without subtitles.')
                settings["subsFilePath"] = ''
            else:
                logger.error('Exiting...')
                sys.exit(1)

    if settings["inputVideo"]:
        settings = getVideoInfo(settings, {})
    else:
        settings = getVideoURL(settings)

    encodeSettings = getDefaultEncodeSettings(settings["bit_rate"])

    logger.info('-' * 80)
    unknownColorSpaceMsg = "unknown (bt709 will be assumed for color range operations)"
    globalColorSpaceMsg = f'{settings["color_space"] if settings["color_space"] else unknownColorSpaceMsg}'
    logger.info((f'Automatically determined encoding settings: CRF: {encodeSettings["crf"]} (0-63), ' +
                 f'Auto Target Max Bitrate: {encodeSettings["autoTargetMaxBitrate"]}kbps, ' +
                 f'Detected Color Space: {globalColorSpaceMsg}, ' +
                 f'Two-pass Encoding Enabled: {encodeSettings["twoPass"]}, ' +
                 f'Encoding Speed: {encodeSettings["encodeSpeed"]} (0-5)'))

    encodeSettings = {**encodeSettings, **settings}
    if "targetMaxBitrate" not in encodeSettings:
        encodeSettings["targetMaxBitrate"] = encodeSettings["autoTargetMaxBitrate"]

    logger.info('-' * 80)
    globalTargetBitrateMsg = (
        f'{encodeSettings["targetMaxBitrate"]}kbps' if "targetMaxBitrate" in encodeSettings else "Auto")
    minterpFPSMsg = f'Target FPS: {getMinterpFPS(settings, None)}, '
    logger.info((f'Global Encoding Settings: CRF: {encodeSettings["crf"]} (0-63), ' +
                 f'Detected Bitrate: {settings["bit_rate"]}kbps, ' +
                 f'Global Target Bitrate: {globalTargetBitrateMsg}, ' +
                 f'Two-pass Encoding Enabled: {encodeSettings["twoPass"]}, ' +
                 f'Encoding Speed: {encodeSettings["encodeSpeed"]} (0-5), ' +
                 f'Audio Enabled: {settings["audio"]}, ' +
                 f'Denoise: {settings["denoise"]["desc"]}, Rotate: {settings["rotate"]}, ' +
                 f'Expand Color Range Enabled: {settings["expandColorRange"]}, ' +
                 f'Speed Maps Enabled: {settings["enableSpeedMaps"]}, ' +
                 f'Minterpolation Mode: {settings["minterpMode"]}, ' + minterpFPSMsg +
                 f'Special Looping: {settings["loop"]}, ' +
                 (f'Fade Duration: {settings["fadeDuration"]}, ' if settings["loop"] == 'fade' else '') +
                 f'Video Stabilization: {settings["videoStabilization"]["desc"]}, ' +
                 f'Video Stabilization Dynamic Zoom: {settings["videoStabilizationDynamicZoom"]}'))

    return settings


def autoScaleCropMap(cropMap, settings):
    for cropPoint in cropMap:
        cropString = cropPoint["crop"]
        cropPoint["crop"], cropPoint["cropComponents"] = getAutoScaledCropComponents(
            cropString, settings)


def getAutoScaledCropComponents(cropString, settings):
    cropComponents = getCropComponents(
        cropString, settings["cropResWidth"], settings["cropResHeight"])
    cropComponents['x'] = settings["cropMultipleX"] * cropComponents['x']
    cropComponents['y'] = settings["cropMultipleY"] * cropComponents['y']
    cropComponents['w'] = settings["cropMultipleX"] * cropComponents['w']
    cropComponents['h'] = settings["cropMultipleY"] * cropComponents['h']

    scaledCropString = f'''{cropComponents['x']}:{cropComponents['y']}:{cropComponents['w']}:{cropComponents['h']}'''
    return scaledCropString, cropComponents


def getCropComponents(cropString, cropResWidth, cropResheight):
    cropComponents = cropString.split(':')
    if cropComponents[2] == 'iw':
        cropComponents[2] = cropResWidth
    if cropComponents[3] == 'ih':
        cropComponents[3] = cropResheight
    cropComponents = {'x': float(cropComponents[0]), 'y': float(cropComponents[1]),
                      'w': float(cropComponents[2]), 'h': float(cropComponents[3])}
    return cropComponents


def getMarkerPairSettings(settings, markerPairIndex):
    # marker pair properties
    mp = settings["markerPairs"][markerPairIndex]

    cropString, cropComponents = getAutoScaledCropComponents(
        mp["crop"], settings)
    mp["crop"] = cropString
    mp["cropComponents"] = cropComponents

    # marker pair settings
    mps = {**settings, **(mp["overrides"])}

    mp["exists"] = False
    if not mps["preview"]:
        if "titlePrefix" in mps:
            mps["titlePrefix"] = cleanFileName(mps["titlePrefix"])
        titlePrefix = f'{mps["titlePrefix"] + "-" if "titlePrefix" in mps else ""}'
        mp["fileNameStem"] = f'{titlePrefix}{mps["titleSuffix"]}-{markerPairIndex + 1}'
        mp["fileName"] = f'{mp["fileNameStem"]}.webm'
        mp["filePath"] = f'{webmsPath}/{mp["fileName"]}'
        if checkWebmExists(mp["fileName"], mp["filePath"]):
            mp["exists"] = True
            return (mp, mps)

    mp["start"] = mp["start"] + mps["delay"]
    mp["end"] = mp["end"] + mps["delay"]
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
        mp["speedMap"] = [{"x": mp["start"], "y":mp["speed"]}, {
            "x": mp["end"], "y":mp["speed"]}]

    mp["speedFilter"], mp["outputDuration"], mp["outputDurations"] = getSpeedFilterAndDuration(
        mp["speedMap"], mp, mps, mps["r_frame_rate"])

    mp["averageSpeed"] = getAverageSpeed(mp["speedMap"], mps["r_frame_rate"])

    bitrateCropFactor = (
        cropComponents['w'] * cropComponents['h']) / (settings["width"] * settings["height"])

    # relax bitrate crop factor assuming that most crops include complex parts
    # of the video and exclude simpler parts
    bitrateRelaxationFactor = 0.8
    bitrateCropFactor = min(1, bitrateCropFactor ** bitrateRelaxationFactor)

    bitrateSpeedFactor = mp["averageSpeed"]
    mps["minterpFPS"] = getMinterpFPS(mps, mp["speedMap"])
    if mps["minterpFPS"] is not None:
        bitrateSpeedFactor = mps["minterpFPS"] / (mp["averageSpeed"] * Fraction(mps["r_frame_rate"]))
        bitrateSpeedFactor **= 0.5

    bitrateFactor = bitrateCropFactor * bitrateSpeedFactor

    globalEncodeSettings = getDefaultEncodeSettings(mps["bit_rate"])
    autoMarkerPairEncodeSettings = getDefaultEncodeSettings(mps["bit_rate"] * bitrateFactor)
    mps = {**globalEncodeSettings, **autoMarkerPairEncodeSettings, **mps}
    if "targetMaxBitrate" not in mps:
        mps["targetMaxBitrate"] = mps["autoTargetMaxBitrate"]

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
        mp["cropMap"] = [{"x": mp["start"], "y":0, "crop": cropString, "cropComponents": cropComponents}, {
            "x": mp["end"], "y":0, "crop": cropString, "cropComponents": cropComponents}]

    if mp["isZoomPanCrop"]:
        mp["cropFilter"] = getZoomPanFilter(mp["cropMap"], mps, mps["r_frame_rate"])
    elif mp["isPanningCrop"]:
        mp["cropFilter"] = getCropFilter(mp["cropMap"], mps, mps["r_frame_rate"])
    else:
        cc = cropComponents
        mp["cropFilter"] = f"""crop='x={cc["x"]}:y={cc["y"]}:w={cc["w"]}:h={cc["h"]}'"""

    titlePrefixLogMsg = f'Title Prefix: {mps["titlePrefix"] if "titlePrefix" in mps else ""}'
    logger.info('-' * 80)
    minterpFPSMsg = f'Target FPS: {mps["minterpFPS"]}, '
    logger.info((f'Marker Pair {markerPairIndex + 1} Settings: {titlePrefixLogMsg}, ' +
                 f'CRF: {mps["crf"]} (0-63), Target Bitrate: {mps["targetMaxBitrate"]}, ' +
                 f'Bitrate Crop Factor: {bitrateCropFactor}, Bitrate Speed Factor {bitrateSpeedFactor}, ' +
                 f'Adjusted Target Max Bitrate: {mps["autoTargetMaxBitrate"]}kbps, ' +
                 f'Two-pass Encoding Enabled: {mps["twoPass"]}, Encoding Speed: {mps["encodeSpeed"]} (0-5), ' +
                 f'Expand Color Range Enabled: {mps["expandColorRange"]}, ' +
                 f'Audio Enabled: {mps["audio"]}, Denoise: {mps["denoise"]["desc"]}, ' +
                 f'Marker Pair {markerPairIndex + 1} is of variable speed: {mp["isVariableSpeed"]}, ' +
                 f'Speed Maps Enabled: {mps["enableSpeedMaps"]}, ' +
                 f'Minterpolation Mode: {mps["minterpMode"]}, ' + minterpFPSMsg +
                 f'Special Looping: {mps["loop"]}, ' +
                 (f'Fade Duration: {mps["fadeDuration"]}s, ' if mps["loop"] == 'fade' else '') +
                 f'Final Output Duration: {mp["outputDuration"]}, ' +
                 f'Video Stabilization: {mps["videoStabilization"]["desc"]}, ' +
                 f'Video Stabilization Dynamic Zoom: {mps["videoStabilizationDynamicZoom"]}'))
    logger.info('-' * 80)

    return (mp, mps)


def makeMarkerPairClip(settings, markerPairIndex):
    mp, mps = getMarkerPairSettings(settings, markerPairIndex)

    if mp["exists"]:
        return {**(settings["markerPairs"][markerPairIndex]), **mp}

    inputs = ''
    audio_filter = ''
    video_filter = ''

    if mp["isVariableSpeed"] or mps["loop"] != 'none':
        mps["audio"] = False

    reconnectFlags = r'-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5'
    if mps["audio"]:
        # ffplay previewing does not support multiple inputs
        # if an input video is provided, a dash xml is used, or previewing is on, there is only one input
        if not mps["inputVideo"] and not settings["isDashAudio"] and not settings["preview"]:
            inputs += reconnectFlags
            inputs += f' -ss {mp["start"]} -to {mp["end"]} -i "{mps["audioURL"]}" '

        # preview mode does not start each clip at time 0 unlike encoding mode
        if settings["preview"] and (settings["inputVideo"] or settings["isDashAudio"]):
            audio_filter += f'atrim={mp["start"]}:{mp["end"]},atempo={mp["speed"]}'
        # encoding mode starts each clip at time 0
        elif not settings["preview"]:
            audio_filter += f'atrim=0:{mp["duration"]},atempo={mp["speed"]}'
            if mps["audioFade"] > 0:
                af = mps["audioFade"]
                audio_filter += f',afade=d={af},areverse,afade=d={af},areverse'
        # when streaming the required chunks from the internet the video and audio inputs are separate
        else:
            mps["audio"] = False
            logger.warning(
                'Audio disabled when previewing without an input video over non-dash protocol.')
        if mps["extraAudioFilters"]:
            audio_filter += f',{mps["extraAudioFilters"]}'

    if not mps["inputVideo"] and not settings["isDashVideo"]:
        inputs += reconnectFlags

    if mps["inputVideo"]:
        inputs += f' -ss {mp["start"]} -i "{mps["inputVideo"]}" '
    else:
        inputs += f' -ss {mp["start"]} -i "{mps["videoURL"]}" '

    qmax = max(min(mps["crf"] + 15, 63), 35)
    qmin = min(mps["crf"], 15)

    if mps["minterpFPS"] is not None:
        fps_arg = f'-r {mps["minterpFPS"]}'
    elif not mp["isVariableSpeed"]:
        fps_arg = f'-r ({mps["r_frame_rate"]}*{mp["speed"]})'
    else:
        fps_arg = f'-r 1000000000'

    ffmpegCommand = ' '.join((
        ffmpegPath,
        f'-hide_banner',
        inputs,
        f'-benchmark',
        # f'-loglevel 56',
        f'-c:v libvpx-vp9' if not mps["vp8"] else f'-c:v libvpx',
        f'-c:a libopus -b:a 128k' if not mps["vp8"] else f'-c:a libvorbis -q:a 10',
        f'-pix_fmt yuv420p -slices 8',
        f'-aq-mode 4 -row-mt 1 -tile-columns 6 -tile-rows 2' if not mps["vp8"] else '',
        f'-qmin {qmin} -crf {mps["crf"]} -qmax {qmax} -b:v {mps["targetMaxBitrate"]}k',
        f'-force_key_frames 1 -g {mp["averageSpeed"] * Fraction(mps["r_frame_rate"])}',
        f'-metadata title="{mps["videoTitle"]}"' if not mps["removeMetadata"] else '-map_metadata -1',
        fps_arg,
        f'-af {audio_filter}' if mps["audio"] else '-an',
        f'-f webm ',
        f'{mps["extraFfmpegArgs"]}',
    ))

    if not mps["preview"]:
        video_filter += f'trim=0:{mp["duration"]}'
    else:
        video_filter += f'trim={mp["start"]}:{mp["end"]}'

    if mps["preview"] and not settings["inputVideo"]:
        video_filter += f',loop=loop=-1:size=(32767)'

    cropComponents = mp["cropComponents"]
    video_filter += f',{mp["cropFilter"]}'

    if mps["subsFilePath"] != '':
        video_filter += getSubsFilter(mp, mps, markerPairIndex)

    if mps["preview"]:
        video_filter += f',scale=w=iw/2:h=ih/2'
        cropComponents["w"] /= 2
        cropComponents["h"] /= 2

    # if the marker pair crop is used after the filter then it should be rotated the same way
    if mps["rotate"] and mps["rotate"] != "0":
        video_filter += f',transpose={mps["rotate"]}'

    if mps["preview"]:
        video_filter_before_correction = video_filter

    if mps["deinterlace"]:
        video_filter += f',bwdif'
    if mps["minterpFPS"] is not None or mps["removeDuplicateFrames"]:
        video_filter += f''',mpdecimate,setpts=N/FR/TB'''
    if 0 <= mps["gamma"] <= 4 and mps["gamma"] != 1:
        video_filter += f',lutyuv=y=gammaval({mps["gamma"]})'
    if mps["expandColorRange"]:
        video_filter += f',colorspace=all={settings["color_space"] if settings["color_space"] else "bt709"}:range=pc'
    if mps["denoise"]["enabled"]:
        video_filter += f',hqdn3d=luma_spatial={mps["denoise"]["lumaSpatial"]}'
    # if mps["scale"]:
    #     video_filter += f'scale=w=2*iw:h=2*ih:flags=lanczos'

    # if mps["overlayPath"]:
    #     video_filter += f'[1:v]overlay=x=W-w-10:y=10:alpha=0.5'
    #     inputs += f'-i "{mps["overlayPath"]}"'

    if mps["extraVideoFilters"]:
        video_filter += f',{mps["extraVideoFilters"]}'

    if mps["loop"] != 'fwrev':
        video_filter += f',{mp["speedFilter"]}'
    if mps["loop"] == 'fwrev':
        reverseSpeedMap = [{"x": speedPoint["x"], "y":speedPointRev["y"]}
                           for speedPoint, speedPointRev in zip(mp["speedMap"], reversed(mp["speedMap"]))]
        reverseSpeedFilter, _, _ = getSpeedFilterAndDuration(
            reverseSpeedMap, mp, mps, mps["r_frame_rate"])
        loop_filter = ''
        loop_filter += f',split=2[f1][f2];'
        loop_filter += f'[f1]{mp["speedFilter"]}[f];'
        loop_filter += f'''[f2]{reverseSpeedFilter},select='gt(n,0)',reverse,select='gt(n,0)','''
        loop_filter += f'setpts=(PTS-STARTPTS)[r];'
        loop_filter += f'[f][r]concat=n=2'
    if mps["loop"] == 'fade':
        fadeDur = mps["fadeDuration"] = max(
            0.1, min(mps["fadeDuration"], 0.4 * mp["outputDuration"]))

        easeP = f'(T/{fadeDur})'
        alphaEaseOut = getEasingExpression('linear', '1', '0', easeP)
        alphaEaseIn = getEasingExpression('linear', '0', '1', easeP)

        loop_filter = ''
        loop_filter += f''',select='if(lte(t,{fadeDur}),1,2)':n=2[fia][mfia];'''
        loop_filter += f'''[fia]format=yuva420p,geq=lum='p(X,Y)':a='{alphaEaseIn}*alpha(X,Y)'[fi];'''
        loop_filter += f'''[mfia]setpts=(PTS-STARTPTS)[mfib];'''
        loop_filter += f'''[mfib]reverse,select='if(lte(t,{fadeDur}),1,2)':n=2[for][mr];'''
        loop_filter += f'''[mr]reverse,setpts=(PTS-STARTPTS)[m];'''
        loop_filter += f'''[for]reverse,format=yuva420p,geq=lum='p(X,Y)':a='{alphaEaseOut}*alpha(X,Y)'[fo];'''
        loop_filter += f'''[fi][fo]overlay=eof_action=repeat,setpts=(PTS-STARTPTS)[fl];'''
        loop_filter += f'''[m][fl]concat=n=2'''

    if mps["preview"]:
        return runffplayCommand(inputs, video_filter, video_filter_before_correction,
                                audio_filter, markerPairIndex, mp, mps)

    vidstabEnabled = mps["videoStabilization"]["enabled"]
    if vidstabEnabled:
        vidstab = mps["videoStabilization"]
        shakyPath = f'{webmsPath}/shaky'
        os.makedirs(shakyPath, exist_ok=True)
        transformPath = f'{shakyPath}/{mp["fileNameStem"]}.trf'
        shakyWebmPath = f'{shakyPath}/{mp["fileNameStem"]}-shaky.webm'
        video_filter += '[shaky];[shaky]'
        vidstabdetectFilter = video_filter + \
            f'''vidstabdetect=result='{transformPath}':shakiness={vidstab["shakiness"]}'''

        vidstabtransformFilter = video_filter + \
            f'''vidstabtransform=input='{transformPath}':smoothing={vidstab["smoothing"]}'''
        if mps["videoStabilizationDynamicZoom"]:
            vidstabtransformFilter += f':optzoom=2:zoomspeed={vidstab["zoomspeed"]}'
        vidstabtransformFilter += r',unsharp=5:5:0.8:3:3:0.4'

        if "minterpMode" in mps and mps["minterpMode"] != "None":
            vidstabtransformFilter += getMinterpFilter(mp, mps)

        if mps["loop"] != 'none':
            vidstabdetectFilter += loop_filter
            vidstabtransformFilter += loop_filter

        ffmpegVidstabdetect = ffmpegCommand + f'-vf "{vidstabdetectFilter}" '
        ffmpegVidstabdetect += f' -y '
        ffmpegVidstabtransform = ffmpegCommand + \
            f'-vf "{vidstabtransformFilter}" '
        ffmpegVidstabtransform += f' -n '
    else:
        ffmpegCommand += f' -n '

    ffmpegCommands = []
    if mps["twoPass"] and not vidstabEnabled:
        if "minterpMode" in mps and mps["minterpMode"] != "None":
            video_filter += getMinterpFilter(mp, mps)

        if mps["loop"] != 'none':
            video_filter += loop_filter

        ffmpegCommand += f' -vf "{video_filter}" '
        ffmpegPass1 = ffmpegCommand + ' -pass 1 -'
        ffmpegPass2 = ffmpegCommand + \
            f' -speed {mps["encodeSpeed"]} -pass 2 "{mp["filePath"]}"'

        ffmpegCommands = [ffmpegPass1, ffmpegPass2]
    elif vidstabEnabled:
        if mps["twoPass"]:
            ffmpegVidstabdetect += f' -pass 1'
        else:
            ffmpegVidstabdetect += f' -speed 5'

        ffmpegVidstabdetect += f' "{shakyWebmPath}"'

        if mps["twoPass"]:
            ffmpegVidstabtransform += f' -pass 2'
        ffmpegVidstabtransform += f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'

        ffmpegCommands = [ffmpegVidstabdetect, ffmpegVidstabtransform]
    else:
        if "minterpMode" in mps and mps["minterpMode"] != "None":
            video_filter += getMinterpFilter(mp, mps)

        if mps["loop"] != 'none':
            video_filter += loop_filter

        ffmpegCommand += f' -vf "{video_filter}" '
        ffmpegCommand += f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'

        ffmpegCommands = [ffmpegCommand]

    if not (1 <= len(ffmpegCommands) <= 2):
        logger.error(f'ffmpeg command could not be built.\n')
        logger.error(f'Failed to generate: {mp["fileName"]}\n')
        return {**(settings["markerPairs"][markerPairIndex])}

    return runffmpegCommand(settings, ffmpegCommands, markerPairIndex, mp)


def getMinterpFilter(mp, mps):
    speedMap = mp["speedMap"]

    minterpFPS = mps["minterpFPS"]
    maxSpeed = getMaxSpeed(speedMap)

    minterpEnable = []
    if minterpFPS is not None:
        outDurs = mp["outputDurations"]
        fps = Fraction(mps["r_frame_rate"])
        targetSpeed = minterpFPS / fps

        for sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
            startSpeed = left["y"]
            endSpeed = right["y"]
            speedChange = endSpeed - startSpeed

            logger.debug(f'speedChange: {speedChange}, startSpeed: {startSpeed}, targetSpeed: {round(targetSpeed, 2)}')
            if speedChange != 0 or startSpeed < round(targetSpeed, 2):
                logger.debug(f'minterp enabled for section: {left["x"]}, {right["x"]}')
                sectStart = outDurs[sect]
                sectEnd = outDurs[sect + 1]
                minterpEnable.append(f'between(t,{sectStart},{sectEnd})')

    if mps["enableMinterpEnhancements"]:
        if len(minterpEnable) > 0:
            minterpEnable = f"""enable='{'+'.join(minterpEnable)}':"""
        else:
            minterpEnable = 'enable=0:'
    else:
        minterpEnable = ''

    if minterpFPS is not None:
        minterpFilter = f''',minterpolate={minterpEnable}fps=({minterpFPS}):mi_mode=mci'''
        minterpFilter += f''':mc_mode=aobmc:me_mode=bidir:vsbmc=1:search_param=64:scd_threshold=8:mb_size=16'''
        if mps["enableMinterpEnhancements"]:
            minterpFilter += f''':fuovf=1:alpha_threshold=256'''
    else:
        minterpFilter = ''

    logger.debug(minterpFilter)
    return minterpFilter


def getMinterpFPS(mps, speedMap):
    minterpMode = mps["minterpMode"]
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


def getMaxSpeed(speedMap):
    maxSpeed = 0.05
    if speedMap is None:
        maxSpeed = 1
    else:
        for speedPoint in speedMap:
            maxSpeed = max(maxSpeed, speedPoint["y"])

    return maxSpeed


def getSubsFilter(mp, mps, markerPairIndex):
    import webvtt

    subs_ext = Path(mps["subsFilePath"]).suffix
    if subs_ext == '.vtt':
        vtt = webvtt.read(mps["subsFilePath"])
    elif subs_ext == '.sbv':
        vtt = webvtt.from_sbv(mps["subsFilePath"])
    elif subs_ext == '.srt':
        vtt = webvtt.from_srt(mps["subsFilePath"])
    else:
        logger.error(f'Uknown subtitle file extension {subs_ext}.')
        logger.notice('Only .vtt, .sbv, and .srt are supported for now.')
        sys.exit(1)

    subsStart = mp["start"]
    subsEnd = mp["end"]
    vtt._captions = [c for c in vtt.captions
                     if c.start_in_seconds < subsEnd and c.end_in_seconds > subsStart]
    for i, caption in enumerate(vtt.captions):
        start = caption.start_in_seconds
        end = caption.end_in_seconds
        caption.start = caption._to_timestamp(max(start - subsStart, 0))
        caption.end = caption._to_timestamp(min(subsEnd - subsStart, end - subsStart))
    tmp_subs_path = f'{webmsPath}/subs/{mps["titleSuffix"]}-{markerPairIndex+1}.vtt'
    vtt.save(tmp_subs_path)
    subs_filter = f""",subtitles='{tmp_subs_path}':force_style='{mps["subsStyle"]}'"""

    return subs_filter


def runffmpegCommand(settings, ffmpegCommands, markerPairIndex, mp):
    ffmpegPass1 = ffmpegCommands[0]
    if len(ffmpegCommands) == 2:
        logger.info('Running first pass...')

    printablePass1 = re.sub(r'-i.*?\".*?\"', r'', ffmpegPass1)

    logger.info(f'Using ffmpeg command: {printablePass1}\n')
    ffmpegProcess = subprocess.run(shlex.split(ffmpegPass1))

    if len(ffmpegCommands) == 2:
        ffmpegPass2 = ffmpegCommands[1]

        printablePass2 = re.sub(r'-i.*?\".*?\"', r'', ffmpegPass2)

        logger.info('Running second pass...')
        logger.info(f'Using ffmpeg command: {printablePass2}\n')
        ffmpegProcess = subprocess.run(shlex.split(ffmpegPass2))

    mp["returncode"] = ffmpegProcess.returncode
    if mp["returncode"] == 0:
        logger.success(f'Successfuly generated: "{mp["fileName"]}"')
    else:
        logger.error(f'Failed to generate: "{mp["fileName"]}" (error code: {mp["returncode"]}).')

    return {**(settings["markerPairs"][markerPairIndex]), **mp}


def getSpeedFilterAndDuration(speedMap, mp, mps, fps):
    if not mp["isVariableSpeed"]:
        duration = mp["duration"] / mp["speed"]
        return f'setpts=(PTS-STARTPTS)/{mp["speed"]}', duration, [0, duration]

    video_filter_speed_map = ''
    setpts = ''
    outputDurations = [0]

    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(speedMap) - 1
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]
    # Account for first input frame delay due to potentially imprecise trim
    startt = ceil(speedMapStartTime / frameDur) * frameDur - speedMapStartTime

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
            sliceDuration = f'(min((T-STARTT-({sectStart})),{sectDuration})/{endSpeed})'
            nextDur = (sectDuration / endSpeed) + outputDurations[nDurs - 1]
        else:
            # Integrate the reciprocal of the linear time vs speed function for the current section
            sliceDuration = f'(1/{m})*(log(abs({m}*min((T-STARTT),{sectEnd})+({b})))-log(abs({m}*{sectStart}+({b}))))'
            nextDur = ((1 / m) * (log(abs(m * sectEnd + b)
                                      ) - log(abs(m * sectStart + b)))) + outputDurations[nDurs - 1]

        outputDurations.append(nextDur)
        sliceDuration = f'if(gte((T-STARTT),{sectStart}), {sliceDuration},0)'

        if sect == 0:
            setpts += f'(if(eq(N,0),0,{sliceDuration}))'
        else:
            setpts += f'+({sliceDuration})'

    video_filter_speed_map += f'''setpts='({setpts})/TB' '''

    nDurs = len(outputDurations)
    # Each output frame time is rounded to the nearest multiple of a frame's duration at the given fps
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] / frameDur) * frameDur
    # The last included frame is held for a single frame's duration
    outputDurations[nDurs - 1] += frameDur
    outputDurations[nDurs - 1] = round(outputDurations[nDurs - 1] * 1000) / 1000

    outputDuration = outputDurations[nDurs - 1]

    # logger.info('-' * 80
    # logger.info(f'First Input Frame Time: {startt}')
    # logger.info(
    #     f'Last Input Frame Time: {right["x"] - speedMapStartTime - startt}')
    # logger.info(f'Last Input Frame Time (Rounded): {sectEnd}')
    # logger.info(f'Last Output Frame Time: {outputDuration}')
    return video_filter_speed_map, outputDuration, outputDurations


def getAverageSpeed(speedMap, fps):
    fps = Fraction(fps)
    frameDur = 1 / fps
    # Account for marker pair start time as trim filter sets start time to ~0
    speedMapStartTime = speedMap[0]["x"]
    # Account for first input frame delay due to potentially imprecise trim
    startt = ceil(speedMapStartTime / frameDur) * frameDur - speedMapStartTime

    averageSpeed = 0
    duration = 0
    for sect, (left, right) in enumerate(zip(speedMap[:-1], speedMap[1:])):
        startSpeed = left["y"]
        endSpeed = right["y"]

        sectStart = left["x"] - speedMapStartTime
        sectEnd = right["x"] - speedMapStartTime
        sectDuration = sectEnd - sectStart

        duration += sectDuration
        averageSpeed += ((startSpeed + endSpeed) / 2) * sectDuration

    averageSpeed = averageSpeed / duration

    return averageSpeed


def getCropFilter(cropMap, mps, fps, easeType='easeInOutSine'):
    logger.info('-' * 80)
    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(cropMap) - 1
    firstTime = cropMap[0]["x"]
    firstCropX, firstCropY, firstCropW, firstCropH = cropMap[0]["crop"].split(':')

    cropXExpr = cropYExpr = cropWExpr = cropYExpr = ''

    # Account for first input frame delay due to potentially imprecise trim
    startt = ceil(firstTime / frameDur) * frameDur - firstTime

    for sect, (left, right) in enumerate(zip(cropMap[:-1], cropMap[1:])):
        startTime = left["x"] - firstTime
        startX, startY, startW, startH = left["crop"].split(':')
        endTime = right["x"] - firstTime
        endX, endY, endW, endH = right["crop"].split(':')

        sectDuration = endTime - startTime
        if sectDuration == 0:
            continue

        if not right.get("easeIn", False):
            currEaseType = easeType
        else:
            currEaseType = right["easeIn"]

        easeP = f'((t-{startTime})/{sectDuration})'
        easeX = getEasingExpression(currEaseType, f'({startX})', f'({endX})', easeP)
        easeY = getEasingExpression(currEaseType, f'({startY})', f'({endY})', easeP)

        if sect == nSects - 1:
            cropXExpr += f'between(t, {startTime}, {endTime})*{easeX}'
            cropYExpr += f'between(t, {startTime}, {endTime})*{easeY}'
        else:
            cropXExpr += f'(gte(t, {startTime})*lt(t, {endTime}))*{easeX}+'
            cropYExpr += f'(gte(t, {startTime})*lt(t, {endTime}))*{easeY}+'

        cropWExpr = firstCropW
        cropHExpr = firstCropH

    cropFilter = f"crop='x={cropXExpr}:y={cropYExpr}:w={cropWExpr}:h={cropHExpr}'"
    return cropFilter


def getZoomPanFilter(cropMap, mps, fps, easeType='easeInOutSine'):
    maxSize = getMaxSizeCrop(cropMap)
    maxWidth = maxSize["width"]
    maxHeight = maxSize["height"]
    maxSize = maxWidth * maxHeight

    fps = Fraction(fps)
    frameDur = 1 / fps
    nSects = len(cropMap) - 1
    firstTime = cropMap[0]["x"]
    firstCropX, firstCropY, firstCropW, firstCropH = cropMap[0]["crop"].split(':')

    panXExpr = panYExpr = zoomExpr = zoomXExpr = zoomYExpr = ''

    # Account for first input frame delay due to potentially imprecise trim
    startt = ceil(firstTime / frameDur) * frameDur - firstTime

    # This scale constant is used in for prescaling the video before applying zoompan.
    # This reduces jitter caused by the rounding of the panning done by zoompan.
    # We need to account for this scaling in the calculation of the zoom and pan.
    scale = 4

    for sect, (left, right) in enumerate(zip(cropMap[:-1], cropMap[1:])):
        startTime = left["x"] - firstTime
        startX, startY, startW, startH = left["crop"].split(':')
        endTime = right["x"] - firstTime
        endX, endY, endW, endH = right["crop"].split(':')
        startRight = float(startX) + float(startW)
        startBottom = float(startY) + float(startH)
        endRight = float(endX) + float(endW)
        endBottom = float(endY) + float(endH)

        startZoom = maxWidth / float(startW)
        endZoom = maxWidth / float(endW)

        sectDuration = endTime - startTime
        if sectDuration == 0:
            continue

        if not right.get("easeIn", False):
            currEaseType = easeType
        else:
            currEaseType = right["easeIn"]

        # zoompan does not support zooming out or changing aspect ratio without stretching.
        # By cropping the video first we can get the desired aspect ratio.
        # Additionally we can zoom in more (up to 10x) if we apply cropping before zoompan.
        # We crop using the largest crop point's width and height.
        # We pan this maximum crop such that it always contains the target crop.
        # The x:y coordinates of the top-left of this maximum crop is such that
        # it is always the top-left most position that still contains the target crop.
        panEaseP = f'((t-{startTime})/{sectDuration})'
        panEaseRight = getEasingExpression(currEaseType, f'({startRight})', f'({endRight})', panEaseP)
        panEaseBottom = getEasingExpression(currEaseType, f'({startBottom})', f'({endBottom})', panEaseP)

        # Ensure that the containing maximum crop does not go out of the video bounds.
        panEaseRight = f'max({panEaseRight}-{maxWidth}, 0)'
        panEaseBottom = f'max({panEaseBottom}-{maxHeight}, 0)'

        # zoompan's time variable is time instead of t
        t = f'in_time'
        easeP = f'(({t}-{startTime})/{sectDuration})'
        easeZoom = getEasingExpression(currEaseType, f'({startZoom})', f'({endZoom})', easeP)
        easeX = getEasingExpression(currEaseType, f'({scale}*{startX})', f'({scale}*{endX})', easeP)
        easeY = getEasingExpression(currEaseType, f'({scale}*{startY})', f'({scale}*{endY})', easeP)

        easeRight = getEasingExpression(currEaseType, f'({scale}*{startRight})', f'({scale}*{endRight})', easeP)
        easeBottom = getEasingExpression(currEaseType, f'({scale}*{startBottom})', f'({scale}*{endBottom})', easeP)

        containingX = f'max({easeRight}-{scale}*{maxWidth}, 0)'
        containingY = f'max({easeBottom}-{scale}*{maxHeight}, 0)'

        # At each frame the target crop's x:y coordinates
        # are calculated relative to its containing crop.
        easeX = f'(({easeX})-({containingX}))'
        easeY = f'(({easeY})-({containingY}))'

        if sect == nSects - 1:
            panXExpr += f'(between(t, {startTime}, {endTime})*{panEaseRight})'
            panYExpr += f'(between(t, {startTime}, {endTime})*{panEaseBottom})'
            zoomExpr += f'(between({t}, {startTime}, {endTime})*{easeZoom})'
            zoomXExpr += f'(between({t}, {startTime}, {endTime})*{easeX})'
            zoomYExpr += f'(between({t}, {startTime}, {endTime})*{easeY})'
        else:
            panXExpr += f'(gte(t, {startTime})*lt(t, {endTime})*{panEaseRight})+'
            panYExpr += f'(gte(t, {startTime})*lt(t, {endTime})*{panEaseBottom})+'
            zoomExpr += f'(gte({t}, {startTime})*lt({t}, {endTime})*{easeZoom})+'
            zoomXExpr += f'(gte({t}, {startTime})*lt({t}, {endTime})*{easeX})+'
            zoomYExpr += f'(gte({t}, {startTime})*lt({t}, {endTime})*{easeY})+'

    zoomPanFilter = ''
    zoomPanFilter += f"crop='x={panXExpr}:y={panYExpr}:w={maxWidth}:h={maxHeight}',"
    # Prescale filter to reduce jitter caused by the rounding of the panning done by zoompan.
    zoomPanFilter += f"scale=w={scale}*iw:h={scale}*ih,"
    zoomPanFilter += f"zoompan=z='({zoomExpr})':x='{zoomXExpr}':y='{zoomYExpr}'"
    zoomPanFilter += f":d=1:s={maxWidth}x{maxHeight}:fps={fps}"

    return zoomPanFilter


def getMaxSizeCrop(cropMap):
    def getSize(cropPoint):
        _, _, cropW, cropH = cropPoint["crop"].split(':')
        return {"width": int(float(cropW)), "height": int(float(cropH))}

    def getLargerCropSize(cropLeft, cropRight):
        left = cropLeft["width"] * cropLeft["height"]
        right = cropRight["width"] * cropRight["height"]
        return cropLeft if left > right else cropRight

    maxSize = reduce(getLargerCropSize, map(getSize, cropMap))
    return maxSize


def getEasingExpression(easingFunc, easeA, easeB, easeP):
    easeP = f'(clip({easeP},0,1))'
    easeT = f'(2*{easeP})'
    easeM = f'({easeP}-1)'

    if easingFunc == 'instant':
        return f'if(lte({easeP},0),{easeA},{easeB})'
    elif easingFunc == 'linear':
        return f'lerp({easeA}, {easeB}, {easeP})'
    elif easingFunc == 'easeInCubic':
        ease = f'{easeP}^3'
    elif easingFunc == 'easeOutCubic':
        ease = f'1+{easeM}^3'
    elif easingFunc == 'easeInOutCubic':
        ease = f'if(lt({easeT},1), {easeP}*{easeT}^2, 1+({easeM}^3)*4)'
    elif easingFunc == 'easeInOutSine':
        ease = f'0.5*(1-cos({easeP}*PI))'
    elif easingFunc == 'easeInCircle':
        ease = f'1-sqrt(1-{easeP}^2)'
    elif easingFunc == 'easeOutCircle':
        ease = f'sqrt(1-{easeM}^2)'
    elif easingFunc == 'easeInOutCircle':
        ease = f'if(lt({easeT},1), (1-sqrt(1-{easeT}^2))*0.5, (sqrt(1-4*{easeM}^2)+1)*0.5)'
    else:
        return None

    easingExpression = f'({easeA}+({easeB}-{easeA})*{ease})'
    return easingExpression


def runffplayCommand(inputs, video_filter, video_filter_before_correction, audio_filter, markerPairIndex, mp, mps):
    logger.info('running ffplay command')
    if 0 <= markerPairIndex < len(settings["markerPairs"]):
        ffplayOptions = f'-hide_banner -fs -sync video -fast -genpts -infbuf '
        ffplayVideoFilter = f'-vf "{video_filter}"'
        if settings["inputVideo"]:
            ffplayOptions += f' -loop 0'
            ffplayVideoFilter += f' -vf "{video_filter_before_correction}"'

        ffplayAudioFilter = f'-af {audio_filter}'

        ffplayCommand = ' '.join((
            ffplayPath,
            inputs,
            ffplayOptions,
            ffplayVideoFilter,
            ffplayAudioFilter if mps["audio"] else '-an'
        ))

        printableCommand = re.sub(r'-i.*?\".*?\"', r'', ffplayCommand)

        logger.info(f'Using ffplay command: {printableCommand}\n')
        subprocess.run(shlex.split(ffplayCommand))


class MissingMergeInput(Exception):
    pass


class BadMergeInput(Exception):
    pass


class MissingMarkerPairFilePath(Exception):
    pass


def makeMergedClips(settings):
    print()
    logger.header("-" * 30 + " Merge List Processing " + "-" * 30)
    markerPairMergeList = settings["markerPairMergeList"]
    markerPairMergeList = markerPairMergeList.split(';')
    inputsTxtPath = ''

    mergeListGen = createMergeList(markerPairMergeList)
    for merge, mergeList in mergeListGen:
        inputs = ''
        try:
            for i in mergeList:
                markerPair = settings["markerPairs"][i - 1]
                if "returncode" in markerPair and markerPair["returncode"] != 0:
                    logger.warning(
                        f'Required marker pair {i} failed to generate with error code {markerPair["returncode"]}')
                    logger.notice(f'This may be a false positive.')
                    ans = input(r'Would you like to continue merging anyway? (y/n): ')
                    if not (ans == 'yes' or ans == 'y'):
                        logger.notice(f'Continuing with merge despite possible bad input.')
                        raise BadMergeInput
                if 'fileName' in markerPair and 'filePath' in markerPair:
                    if Path(markerPair["filePath"]).is_file():
                        inputs += f'''file '{markerPair["fileName"]}'\n'''
                    else:
                        raise MissingMergeInput
                else:
                    raise MissingMarkerPairFilePath

            titlePrefixesConsistent = True
            titlePrefixes = [p["overrides"].get("titlePrefix", "") for p in settings["markerPairs"]]
            mergeTitlePrefix = titlePrefixes[mergeList[0] - 1]
            if len(mergeList) > 1:
                for l, r in zip(mergeList[:-1], mergeList[1:]):
                    lPrefix = titlePrefixes[l - 1]
                    rPrefix = titlePrefixes[r - 1]
                    if lPrefix != rPrefix or lPrefix == '' or rPrefix == '':
                        titlePrefixesConsistent = False

        except IndexError:
            logger.error(
                f'Aborting generation of webm with merge list {mergeList}.')
            logger.error(f'Missing required marker pair number {i}.')
            continue
        except BadMergeInput:
            logger.error(f'Aborting generation of webm with merge list {mergeList}.')
            logger.error(f'Required marker pair {i} not successfully generated.')
            continue
        except MissingMergeInput:
            logger.error(f'Aborting generation of webm with merge list {mergeList}.')
            logger.error(f'Missing required input webm with path {markerPair["filePath"]}.')
            continue
        except MissingMarkerPairFilePath:
            logger.error(f'Aborting generation of webm with merge list {mergeList}')
            logger.error(f'Missing file path for marker pair {i}')
            continue

        inputsTxtPath = f'{webmsPath}/inputs.txt'
        with open(inputsTxtPath, "w+", encoding='utf-8') as inputsTxt:
            inputsTxt.write(inputs)

        if titlePrefixesConsistent:
            mergedFileName = f'{mergeTitlePrefix}-{settings["titleSuffix"]}-({merge}).webm'
        else:
            mergedFileName = f'{settings["titleSuffix"]}-({merge}).webm'

        mergedFilePath = f'{webmsPath}/{mergedFileName}'
        ffmpegConcatFlags = '-n -hide_banner -f concat -safe 0'
        ffmpegConcatCmd = f' "{ffmpegPath}" {ffmpegConcatFlags}  -i "{inputsTxtPath}" -c copy "{mergedFilePath}"'

        if not Path(mergedFilePath).is_file():
            logger.info('-' * 80)
            logger.info(f'Generating "{mergedFileName}"...\n')
            logger.info(f'Using ffmpeg command: {ffmpegConcatCmd}')
            ffmpegProcess = subprocess.run(shlex.split(ffmpegConcatCmd))
            if ffmpegProcess.returncode == 0:
                logger.success(f'Successfuly generated: "{mergedFileName}"\n')
            else:
                logger.info(f'Failed to generate: "{mergedFileName}"\n')
                logger.error(
                    f'ffmpeg error code: {ffmpegProcess.returncode}\n')
        else:
            logger.report(f'Skipped existing file: "{mergedFileName}"\n')

        try:
            os.remove(inputsTxtPath)
        except (OSError, FileNotFoundError):
            pass


def checkWebmExists(fileName, filePath):
    if not Path(filePath).is_file():
        logger.info(f'Generating "{fileName}"...')
        return False
    else:
        logger.report(f'Skipped existing file: "{fileName}"')
        return True


def createMergeList(markerPairMergeList):
    for merge in markerPairMergeList:
        mergeList = markerPairsCSVToList(merge)
        yield merge, mergeList


def markerPairsCSVToList(markerPairsCSV):
    markerPairsCSV = re.sub(r'\s+', '', markerPairsCSV)
    markerPairsCSV = markerPairsCSV.rstrip(',')
    csvRangeValidation = r'^((\d{1,2})|(\d{1,2}-\d{1,2})){1}(,((\d{1,2})|(\d{1,2}-\d{1,2})))*$'
    if re.match(csvRangeValidation, markerPairsCSV) is None:
        raise ValueError("Invalid Marker pairs CSV.")

    markerPairsCSV = markerPairsCSV.split(',')

    markerPairsList = []
    for mergeRange in markerPairsCSV:
        if '-' in mergeRange:
            mergeRange = mergeRange.split('-')
            startPair = int(mergeRange[0])
            endPair = int(mergeRange[1])
            if (startPair <= endPair):
                for i in range(startPair, endPair + 1):
                    markerPairsList.append(i)
            else:
                for i in range(startPair, endPair - 1 if endPair >= 1 else 0, -1):
                    markerPairsList.append(i)
        else:
            markerPairsList.append(int(mergeRange))
    return markerPairsList


def ffprobeVideoProperties(video):
    ffprobeRetries = 3
    done = False
    while ffprobeRetries > 0 and not done:
        ffprobeRetries -= 1
        try:
            ffprobeFlags = '-v quiet -select_streams v -print_format json -show_streams -show_format'
            ffprobeCommand = f'"{ffprobePath}" "{video}" {ffprobeFlags} '
            ffprobeOutput = subprocess.check_output(shlex.split(ffprobeCommand))
            logger.success(f'Successfully fetched video properties with ffprobe')
            done = True
        except subprocess.CalledProcessError as cpe:
            logger.warning(f'Could not fetch video properties with ffprobe')
            logger.warning(f'{cpe}')
            if ffprobeRetries > 0:
                time.sleep(2)
                logger.info(f'Trying {ffprobeRetries} more time(s) to fetch video properties with ffprobe')

    if ffprobeRetries == 0:
        return None

    ffprobeOutput = ffprobeOutput.decode('utf-8')
    logger.info('-' * 80)
    logger.info('Detecting video properties with ffprobe')
    ffprobeData = json.loads(ffprobeOutput)

    ffprobeData["streams"][0]["bit_rate"] = int(
        int(ffprobeData["format"]["bit_rate"]) / 1000)
    return ffprobeData["streams"][0]


def autoSetCropMultiples(settings):
    cropMultipleX = (settings["width"] / settings["cropResWidth"])
    cropMultipleY = (settings["height"] / settings["cropResHeight"])

    if settings["cropResWidth"] != settings["width"] or settings["cropResHeight"] != settings["height"]:
        logger.info('-' * 80)
        logger.info('Crop resolution does not match video resolution')
        if settings["cropResWidth"] != settings["width"]:
            logger.info(
                f'Crop resolution width ({settings["cropResWidth"]}) not equal to video width ({settings["width"]})')
        if settings["cropResHeight"] != settings["height"]:
            logger.info(
                f'Crop resolution height ({settings["cropResHeight"]}) not equal to video height ({settings["height"]})')

        if not settings["noAutoScaleCropRes"]:
            logger.info(
                f'Crop X offset and width will be multiplied by {cropMultipleX}')
            logger.info(
                f'Crop Y offset and height will be multiplied by {cropMultipleY}')
            return {**settings, 'cropMultipleX': cropMultipleX, 'cropMultipleY': cropMultipleY}
        else:
            logger.info(f'Auto scale crop resolution disabled in settings.')
            return settings
    else:
        return settings


def filterDash(dashManifestUrl, dashFormatIDs):
    from xml.dom import minidom
    from urllib import request

    with request.urlopen(dashManifestUrl) as dash:
        dashdom = minidom.parse(dash)

    reps = dashdom.getElementsByTagName('Representation')
    for rep in reps:
        id = rep.getAttribute('id')
        if id not in dashFormatIDs:
            rep.parentNode.removeChild(rep)

    filteredDashPath = f'{webmsPath}/filtered-dash.xml'
    with open(filteredDashPath, 'w+', encoding='utf-8') as filteredDash:
        filteredDash.write(dashdom.toxml())

    return filteredDashPath


def uploadToGfycat(settings):
    # auto gfycat uploading
    if (settings["gfycat"]):
        import urllib3
        import json
        from urllib.parse import urlencode
        http = urllib3.PoolManager()

        for outPath in outPaths:
            with open(outPath, 'rb', encoding='utf-8') as fp:
                file_data = fp.read()
            encoded_args = urlencode({'title': f'{outPath}'})
            url = UPLOAD_KEY_REQUEST_ENDPOINT + encoded_args
            r_key = http.request('POST', url)
            print(r_key.status)
            gfyname = json.loads(r_key.data.decode('utf-8'))["gfyname"]
            links.append(f'https://gfycat.com/{gfyname}')
            print(gfyname)
            fields = {'key': gfyname, 'file': (
                gfyname, file_data, 'multipart/formdata')}
            r_upload = http.request(
                'POST', FILE_UPLOAD_ENDPOINT, fields=fields)
            print(r_upload.status)
            print(r_upload.data)

        global markdown
        for fileName, link in zip(fileNames, links):
            markdown += f'({fileName})[{link}]\n\n'
            print('\n==Reddit Markdown==')
            print(markdown)


def cleanFileName(fileName):
    if sys.platform == 'win32':
        fileName = re.sub(r'[*?"<>\0]', '', fileName)
        fileName = re.sub(r'[/|\\:]', '_', fileName)
    elif sys.platform == 'darwin':
        fileName = re.sub(r'[:\0]', '_', fileName)
    elif sys.platform.startswith('linux'):
        fileName = re.sub(r'[/\0]', '_', fileName)
    return fileName


def getDefaultEncodeSettings(videobr):
    # switch to constant quality mode if no bitrate specified
    if videobr is None:
        encodeSettings = {'crf': 30, 'autoTargetMaxBitrate': 0,
                          'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 1000:
        encodeSettings = {'crf': 20, 'autoTargetMaxBitrate': int(
            2 * videobr), 'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 2000:
        encodeSettings = {'crf': 22, 'autoTargetMaxBitrate': int(
            1.8 * videobr), 'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 4000:
        encodeSettings = {'crf': 24, 'autoTargetMaxBitrate': int(
            1.6 * videobr), 'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 6000:
        encodeSettings = {'crf': 26, 'autoTargetMaxBitrate': int(
            1.4 * videobr), 'encodeSpeed': 3, 'twoPass': False}
    elif videobr <= 10000:
        encodeSettings = {'crf': 28, 'autoTargetMaxBitrate': int(
            1.2 * videobr), 'encodeSpeed': 4, 'twoPass': False}
    elif videobr <= 14000:
        encodeSettings = {'crf': 30, 'autoTargetMaxBitrate': int(
            1.1 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    elif videobr <= 18000:
        encodeSettings = {'crf': 30, 'autoTargetMaxBitrate': int(
            1.0 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    elif videobr <= 25000:
        encodeSettings = {'crf': 32, 'autoTargetMaxBitrate': int(
            0.9 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    else:
        encodeSettings = {'crf': 34, 'autoTargetMaxBitrate': int(
            0.8 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    return encodeSettings


def getVidstabPreset(level, videoStabilizationDynamicZoom):
    vidstabPreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        vidstabPreset = {"enabled": True, "shakiness": 2,
                         "zoomspeed": 0.05, "smoothing": 2, "desc": "Very Weak"}
    elif level == 2:
        vidstabPreset = {"enabled": True, "shakiness": 4,
                         "zoomspeed": 0.1, "smoothing": 4, "desc": "Weak"}
    elif level == 3:
        vidstabPreset = {"enabled": True, "shakiness": 6,
                         "zoomspeed": 0.2, "smoothing": 6, "desc": "Medium"}
    elif level == 4:
        vidstabPreset = {"enabled": True, "shakiness": 8,
                         "zoomspeed": 0.3, "smoothing": 10, "desc": "Strong"}
    elif level == 5:
        vidstabPreset = {"enabled": True, "shakiness": 10,
                         "zoomspeed": 0.4, "smoothing": 16, "desc": "Very Strong"}
    elif level == 6:
        vidstabPreset = {"enabled": True, "shakiness": 10,
                         "zoomspeed": 0.5, "smoothing": 22, "desc": "Strongest"}
    return vidstabPreset


def getDenoisePreset(level):
    denoisePreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        denoisePreset = {"enabled": True,
                         "lumaSpatial": 1, "desc": "Very Weak"}
    elif level == 2:
        denoisePreset = {"enabled": True, "lumaSpatial": 2, "desc": "Weak"}
    elif level == 3:
        denoisePreset = {"enabled": True, "lumaSpatial": 4, "desc": "Medium"}
    elif level == 4:
        denoisePreset = {"enabled": True, "lumaSpatial": 6, "desc": "Strong"}
    elif level == 5:
        denoisePreset = {"enabled": True,
                         "lumaSpatial": 8, "desc": "Very Strong"}
    return denoisePreset


main()
