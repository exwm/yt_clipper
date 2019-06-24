#!/usr/bin/env python3

import sys
import subprocess
import shlex
import argparse
import re
import json
import itertools
import os
import logging
from pathlib import Path

UPLOAD_KEY_REQUEST_ENDPOINT = 'https://api.gfycat.com/v1/gfycats?'
FILE_UPLOAD_ENDPOINT = 'https://filedrop.gfycat.com'
AUTHENTICATION_ENDPOINT = 'https://api.gfycat.com/v1/oauth/token'

__version__ = '3.4.2'

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

if getattr(sys, 'frozen', False):
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
    args = buildArgParser()
    if args.cropMultiple != 1:
        args.cropMultipleX = args.cropMultiple
        args.cropMultipleY = args.cropMultiple

    args = vars(args)

    args = {k: v for k, v in args.items() if v is not None}

    args["videoStabilization"] = getVidstabPreset(args["videoStabilization"])
    args["denoise"] = getDenoisePreset(args["denoise"])
    settings = {'markerPairMergeList': '', 'rotate': 0,
                'overlayPath': '', 'delay': 0, 'colorspace': None, **args}

    settings["isDashVideo"] = False
    settings["isDashAudio"] = False

    with open(settings["json"], 'r', encoding='utf-8-sig') as file:
        markersJson = file.read()
        settings = loadMarkers(markersJson, settings)
    settings["videoTitle"] = re.sub('"', '',  settings["videoTitle"])
    settings["markersDataFileStem"] = Path(settings["json"]).stem
    settings["titleSuffix"] = settings["markersDataFileStem"]
    webmsPath += f'/{settings["titleSuffix"]}'

    if not settings["preview"]:
        os.makedirs(f'{webmsPath}', exist_ok=True)
    setUpLogger()

    logger.info(f'Version: {__version__}')
    logger.info('-' * 80)

    settings["downloadVideoPath"] = f'{webmsPath}/{settings["titleSuffix"]}'

    if not settings["inputVideo"] and not settings["downloadVideo"] and settings["preview"]:
        logger.warning(
            "Preview mode was enabled without providing a local input video and video downloading disabled.")
        logger.warning(
            "Automatic fetching of video stream chunks provides a poor preview experience.")
        logger.warning(
            "When previewing, a local video file uses less memory and does not require re-streaming from the internet on seek with right-click.")
        logger.warning(
            "A local video also enables toggling of video correction filters with W.")
        logger.info(
            "Note that you may be able to drag and drop the input video file at the following prompt.")
        try:
            settings["inputVideo"] = input(
                f'Provide an input video path or press enter to continue: ')
            if settings["inputVideo"] == '':
                logger.info(
                    f'The video can also be downloaded before previewing to the path: "{settings["downloadVideoPath"]}"')
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
            sys.exit()
        settings = getVideoInfo(settings, {})
    else:
        settings = prepareGlobalSettings(settings)

    if not settings["preview"]:
        for markerPairIndex, marker in enumerate(settings["markers"]):
            settings["markers"][markerPairIndex] = makeMarkerPairClip(
                settings, markerPairIndex)
        if settings["markerPairMergeList"] != '':
            makeMergedClips(settings)
    else:
        while True:
            try:
                inputStr = input(
                    f'Enter a valid marker pair number (between {1} and {len(settings["markers"])}) or quit(q): ')
                if inputStr == 'quit' or inputStr == 'q':
                    break
                markerPairIndex = int(inputStr)
                markerPairIndex -= 1
            except ValueError:
                logger.error(f'{inputStr} is not a valid number.')
                continue
            if 0 <= markerPairIndex < len(settings["markers"]):
                makeMarkerPairClip(settings, markerPairIndex)
            else:
                logger.error(
                    f'{markerPairIndex + 1} is not a valid marker pair number.')
            continue


def setUpLogger():
    global logger
    loggerHandlers = [logging.StreamHandler()]
    if not settings["preview"]:
        loggerHandlers.append(logging.FileHandler(
            filename=f'{webmsPath}/{settings["titleSuffix"]}.log', mode='a', encoding='utf-8'))
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s',
        datefmt="%y-%m-%d %H:%M:%S",
        handlers=loggerHandlers)
    logger = logging.getLogger()


def buildArgParser():
    parser = argparse.ArgumentParser(
        description='Generate trimmed webms from input video.')
    parser.add_argument('--input-video', '-i', dest='inputVideo', default='',
                        help='Input video path.')
    parser.add_argument('--download-video', '-dv', action='store_true', dest='downloadVideo',
                        help='Download video from the internet and use as input video for processing marker data.')
    parser.add_argument('--markers-json', '-j', required=True, dest='json',
                        help=('Specify markers json path for generating webms from input video.' +
                              'Automatically streams required portions of input video from the internet if it is not otherwise specified.'))
    parser.add_argument('--overlay', '-o', dest='overlay',
                        help='overlay image path')
    parser.add_argument('--multiply-crop', '-m', type=float, dest='cropMultiple', default=1,
                        help=('Multiply all crop dimensions by an integer. ' +
                              '(Helpful if you change resolutions: eg 1920x1080 * 2 = 3840x2160(4k)).'))
    parser.add_argument('--multiply-crop-x', '-x', type=float, dest='cropMultipleX', default=1,
                        help='Multiply all x crop dimensions by an integer.')
    parser.add_argument('--multiply-crop-y', '-y', type=float, dest='cropMultipleY', default=1,
                        help='Multiply all y crop dimensions by an integer.')
    parser.add_argument('--gfycat', '-g', action='store_true',
                        help='upload all output webms to gfycat and print reddit markdown with all links')
    parser.add_argument('--audio', '-a', action='store_true',
                        help='Enable audio in output webms.')
    parser.add_argument('--format', '-f', default='bestvideo+(bestaudio[acodec=opus]/bestaudio[acodec=vorbis]/bestaudio)',
                        help='Specify format string passed to youtube-dl.')
    parser.add_argument('--extra-video-filters', '-evf', dest='extraVideoFilters', default='',
                        help='Specify any extra video filters to be passed to ffmpeg.')
    parser.add_argument('--delay', '-d', type=float, dest='delay', default=0,
                        help='Add a fixed delay to both the start and end time of each marker. Can be negative.')
    parser.add_argument('--gamma', '-ga', type=float, dest='gamma', default=1,
                        help='Apply luminance gamma correction. Pass in a value between 0 and 1 to brighten shadows and reveal darker details.')
    parser.add_argument('--rotate', '-r', choices=['clock', 'cclock'],
                        help='Rotate video 90 degrees clockwise or counter-clockwise.')
    parser.add_argument('--denoise', '-dn', type=int, default=0, choices=range(0, 6),
                        help='Apply the hqdn3d denoise filter using a preset strength level from 0-5 where 0 is disabled and 5 is very strong.')
    parser.add_argument('--video-stabilization', '-vs', dest='videoStabilization', type=int, default=0, choices=range(0, 6),
                        help='Apply video stabilization using a preset strength level from 0-5 where 0 is disabled and 5 is very strong.')
    parser.add_argument('--deinterlace', '-di', action='store_true',
                        help='Apply bwdif deinterlacing.')
    parser.add_argument('--expand-color-range', '-ecr', dest='expandColorRange', action='store_true',
                        help='Expand the output video color range to full (0-255).')
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
    parser.add_argument('--no-auto-scale-crop-res', dest='noAutoScaleCropRes', action='store_true',
                        help=('Disable automatically scaling the crop resolution when a mismatch with video resolution is detected.'))
    parser.add_argument('--preview', action='store_true',
                        help=('Pass in semicolon separated lists of marker pairs.'
                              + 'Lists of marker pairs are comma-separated numbers or dash separated ranges. (eg 1-3,7;4-6,9)'))
    return parser.parse_args()


def loadMarkers(markersJson, settings):
    markersDict = json.loads(markersJson)
    settings = {**settings, **markersDict}
    settings["videoURL"] = 'https://www.youtube.com/watch?v=' + \
        settings["videoID"]

    return settings


def getVideoURL(settings):
    from youtube_dl import YoutubeDL

    ydl_opts = {'format': settings["format"], 'forceurl': True, 'ffmpeg_location': ffmpegPath,
                'outtmpl': f'{settings["downloadVideoPath"]}.%(ext)s'}
    ydl = YoutubeDL(ydl_opts)
    if settings["downloadVideo"]:
        ydl_info = ydl.extract_info(settings["videoURL"], download=True)
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
        settings["inputVideo"] = f'{webmsPath}/{settings["titleSuffix"]}.{videoInfo["ext"]}'
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
        settings = {**settings, **videoInfo, **
                    ffprobeVideoProperties(settings["inputVideo"])}
    else:
        settings = {**settings, **videoInfo, **
                    ffprobeVideoProperties(settings["videoURL"])}

    if settings["isDashVideo"]:
        settings["bit_rate"] = int(videoInfo["tbr"])

    logger.info(f'Video Title: {settings["videoTitle"]}')
    logger.info(f'Video Width: {settings["width"]}')
    logger.info(f'Video Height: {settings["height"]}')
    logger.info(f'Video fps: {settings["r_frame_rate"]}')
    logger.info(f'Detected Video Bitrate: {settings["bit_rate"]}kbps')

    settings = autoSetCropMultiples(settings)

    return settings


def prepareGlobalSettings(settings):
    logger.info(f'Video URL: {settings["videoURL"]}')
    logger.info(
        f'Merge List: {settings["markerPairMergeList"] if settings["markerPairMergeList"] else "None"}')

    settings = getVideoURL(settings)
    encodeSettings = getDefaultEncodeSettings(settings["bit_rate"])

    logger.info('-' * 80)
    unknownColorSpaceMsg = "unknown (bt709 will be assumed for color range operations)"
    logger.info((f'Automatically determined encoding settings: CRF: {encodeSettings["crf"]} (0-63), ' +
                 f'Auto Target Max Bitrate: {encodeSettings["autoTargetMaxBitrate"]}kbps, ' +
                 f'Detected Color Space: {settings["color_space"] if settings["color_space"] else  unknownColorSpaceMsg}, ' +
                 f'Two-pass Encoding Enabled: {encodeSettings["twoPass"]}, ' +
                 f'Encoding Speed: {encodeSettings["encodeSpeed"]} (0-5)'))

    settings = {**encodeSettings, **settings}

    logger.info('-' * 80)
    logger.info((f'Global Encoding Settings: CRF: {settings["crf"]} (0-63), ' +
                 f'Detected Bitrate: {settings["bit_rate"]}kbps, ' +
                 f'Global Target Max Bitrate: {str(settings["targetMaxBitrate"]) + "kbps" if "targetMaxBitrate" in settings else "None"}, ' +
                 f'Two-pass Encoding Enabled: {settings["twoPass"]}, Encoding Speed: {settings["encodeSpeed"]} (0-5), ' +
                 f'Audio Enabled: {settings["audio"]}, Denoise: {settings["denoise"]["desc"]}, Rotate: {settings["rotate"]}, ' +
                 f'Expand Color Range Enabled: {settings["expandColorRange"]}, ' +
                 f'Video Stabilization: {settings["videoStabilization"]["desc"]}'))

    return settings


def getMarkerPairSettings(settings, markerPairIndex):
    mp = markerPair = {**(settings["markers"][markerPairIndex])}

    cropString = mp["crop"]
    crops = mp["cropComponents"] = cropString.split(':')
    crops[0] = settings["cropMultipleX"] * int(crops[0])
    if crops[2] != 'iw':
        crops[2] = settings["cropMultipleX"] * int(crops[2])
    else:
        crops[2] = settings["width"]
    crops[1] = settings["cropMultipleY"] * int(crops[1])
    if crops[3] != 'ih':
        crops[3] = settings["cropMultipleY"] * int(crops[3])
    else:
        crops[3] = settings["height"]

    bitrateCropFactor = (crops[2] * crops[3]) / \
        (settings["width"] * settings["height"])
    markerPairEncodeSettings = getDefaultEncodeSettings(
        settings["bit_rate"] * bitrateCropFactor)
    settings = {**markerPairEncodeSettings, **settings}

    if "targetMaxBitrate" in settings:
        settings["autoTargetMaxBitrate"] = getDefaultEncodeSettings(
            settings["targetMaxBitrate"] * bitrateCropFactor)["autoTargetMaxBitrate"]
    else:
        settings["autoTargetMaxBitrate"] = markerPairEncodeSettings["autoTargetMaxBitrate"]

    mps = markerPairSettings = {**settings, **(mp["overrides"])}

    mp["exists"] = False
    if not mps["preview"]:
        if "titlePrefix" in mps:
            mps["titlePrefix"] = cleanFileName(mps["titlePrefix"])
        mp["fileNameStem"] = f'{mps["titlePrefix"] + "-" if "titlePrefix" in mps else ""}{mps["titleSuffix"]}-{markerPairIndex + 1}'
        mp["fileName"] = f'{mp["fileNameStem"]}.webm'
        mp["filePath"] = f'{webmsPath}/{mp["fileName"]}'
        if checkWebmExists(mp["fileName"], mp["filePath"]):
            mp["exists"] = True
            return (markerPair, markerPairSettings)

    mp["start"] = mp["start"] + mps["delay"]
    mp["end"] = mp["end"] + mps["delay"]
    mp["speed"] = (1 / mp["speed"])
    mp["duration"] = mp["end"] - mp["start"]
    mp["speedAdjustedDuration"] = mp["duration"] * mp["speed"]

    titlePrefixLogMsg = f'Title Prefix: {mps["titlePrefix"] if "titlePrefix" in mps else ""}'
    logger.info('-' * 80)
    logger.info((f'Marker Pair {markerPairIndex + 1} Settings: {titlePrefixLogMsg}, ' +
                 f'CRF: {mps["crf"]} (0-63), Bitrate Crop Factor: {bitrateCropFactor}, ' +
                 f'Crop Adjusted Target Max Bitrate: {mps["autoTargetMaxBitrate"]}kbps, ' +
                 f'Two-pass Encoding Enabled: {mps["twoPass"]}, Encoding Speed: {mps["encodeSpeed"]} (0-5), ' +
                 f'Expand Color Range Enabled: {mps["expandColorRange"]}, ' +
                 f'Audio Enabled: {mps["audio"]}, Denoise: {mps["denoise"]["desc"]}, ' +
                 f'Video Stabilization: {mps["videoStabilization"]["desc"]}'))
    logger.info('-' * 80)

    return (markerPair, markerPairSettings)


def makeMarkerPairClip(settings, markerPairIndex):
    mp, mps = getMarkerPairSettings(settings, markerPairIndex)

    if mp["exists"]:
        return {**(settings["markers"][markerPairIndex]), **mp}

    inputs = ''
    audio_filter = ''
    video_filter = ''

    reconnectFlags = r'-reconnect 1 -reconnect_at_eof 1 -reconnect_streamed 1 -reconnect_delay_max 5'
    if mps["audio"]:
        if not mps["inputVideo"] and not settings["isDashAudio"]:
            inputs += reconnectFlags
            inputs += f' -ss {mp["start"]} -i "{mps["audioURL"]}" '

        audio_filter += f'[in]atrim={mp["start"]}:{mp["end"]},atempo={1/mp["speed"]}'
    else:
        inputs += ' -an '

    if not mps["inputVideo"] and not settings["isDashVideo"]:
        inputs += reconnectFlags

    if mps["inputVideo"]:
        inputs += f' -ss {mp["start"]} -i "{mps["inputVideo"]}" '
    else:
        inputs += f' -ss {mp["start"]} -i "{mps["videoURL"]}" '

    if not mps["preview"]:
        video_filter += f'[in]trim={0}:{mp["speedAdjustedDuration"]},setpts={mp["speed"]}*(PTS-STARTPTS)'
    else:
        video_filter += f'[in]trim={mp["start"]}:{mp["end"]},setpts={mp["speed"]}*(PTS-STARTPTS)'
        if not settings["inputVideo"]:
            video_filter += f',loop=loop=-1:size=({mps["r_frame_rate"]}*{mp["speedAdjustedDuration"]})'

    crops = mp["cropComponents"]
    video_filter += (
        f',crop=x={crops[0]}:y={crops[1]}:w={crops[2]}:h={crops[3]}')

    if mps["rotate"]:
        video_filter += f',transpose={mps["rotate"]}'

    if mps["preview"]:
        video_filter_before_correction = video_filter

    if 0 <= mps["gamma"] <= 4 and mps["gamma"] != 1:
        video_filter += f',lutyuv=y=gammaval({mps["gamma"]})'
    if mps["extraVideoFilters"]:
        video_filter += f',{mps["extraVideoFilters"]}'
    if mps["deinterlace"]:
        video_filter += f',bwdif'
    if mps["expandColorRange"]:
        video_filter += f',colorspace=all={settings["color_space"] if settings["color_space"] else "bt709"}:range=pc'
    if mps["denoise"]["enabled"]:
        video_filter += f',hqdn3d=luma_spatial={mps["denoise"]["lumaSpatial"]}'
    # if mps["overlayPath"]:
    #     video_filter += f'[1:v]overlay=x=W-w-10:y=10:alpha=0.5'
    #     inputs += f'-i "{mps["overlayPath"]}"'

    if not mps["preview"]:
        return runffmpegCommand(inputs, video_filter, audio_filter, markerPairIndex, mp, mps)
    else:
        return runffplayCommand(inputs, video_filter, video_filter_before_correction, audio_filter, markerPairIndex)


def runffmpegCommand(inputs, video_filter, audio_filter, markerPairIndex, mp, mps):
    ffmpegCommand = ' '.join((
        ffmpegPath,
        f'-n -hide_banner',
        inputs,
        f'-benchmark',
        f'-c:v libvpx-vp9 -pix_fmt yuv420p',
        f'-c:a libopus -b:a 128k',
        f'-slices 8 -row-mt 1 -tile-columns 6 -tile-rows 2',
        f'-crf {mps["crf"]} -b:v {mps["autoTargetMaxBitrate"]}k',
        f'-metadata title="{mps["videoTitle"]}" -t {mp["duration"]}',
        f'-r (1/{mp["speed"]})*({mps["r_frame_rate"]})',
        f'-af {audio_filter}'
        f'-f webm ',
    ))

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
        ffmpegVidstabdetect = ffmpegCommand + \
            f'-vf "{vidstabdetectFilter}"'

        vidstabtransformFilter = video_filter + \
            f'vidstabtransform=input=\'{transformPath}\''
        if vidstab["optzoom"] == 2 and "zoomspeed" in vidstab:
            vidstabtransformFilter += f':zoomspeed=0.1'
        vidstabtransformFilter += r',unsharp=5:5:0.8:3:3:0.4'
        ffmpegVidstabtransform = ffmpegCommand + \
            f'-vf "{vidstabtransformFilter}" '

    if mps["twoPass"] and not vidstabEnabled:
        ffmpegCommand += f' -vf "{video_filter}" '
        ffmpegPass1 = ffmpegCommand + ' -pass 1 -'
        logger.info('Running first pass...')
        logger.info('Using ffmpeg command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffmpegPass1) + '\n')
        subprocess.run(shlex.split(ffmpegPass1))
        ffmpegPass2 = ffmpegCommand + \
            f' -speed {mps["encodeSpeed"]} -pass 2 "{mp["filePath"]}"'
        logger.info('Running second pass...')
        logger.info('Using ffmpeg command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffmpegPass2) + '\n')
        ffmpegProcess = subprocess.run(shlex.split(ffmpegPass2))
    elif vidstabEnabled:
        if mps["twoPass"]:
            ffmpegVidstabdetect += f' -pass 1'
        else:
            ffmpegVidstabdetect += f' -speed 5'
        ffmpegVidstabdetect += f' "{shakyWebmPath}"'
        logger.info('Running video stabilization first pass...')
        logger.info('Using ffmpeg command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffmpegVidstabdetect) + '\n')
        subprocess.run(shlex.split(ffmpegVidstabdetect))

        if mps["twoPass"]:
            ffmpegVidstabtransform += f' -pass 2'
        ffmpegVidstabtransform += f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'
        logger.info('Running video stabilization second pass...')
        logger.info('Using ffmpeg command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffmpegVidstabtransform) + '\n')
        ffmpegProcess = subprocess.run(shlex.split(ffmpegVidstabtransform))
    else:
        ffmpegCommand += f' -vf "{video_filter}" '
        ffmpegCommand = ffmpegCommand + \
            f' -speed {mps["encodeSpeed"]} "{mp["filePath"]}"'
        logger.info('Using ffmpeg command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffmpegCommand) + '\n')
        ffmpegProcess = subprocess.run(shlex.split(ffmpegCommand))

    if ffmpegProcess.returncode == 0:
        logger.info(f'Successfuly generated: "{mp["fileName"]}"\n')
        return {**(settings["markers"][markerPairIndex]), **mp}
    else:
        logger.info(f'Failed to generate: "{mp["fileName"]}"\n')
        return {**(settings["markers"][markerPairIndex])}


def runffplayCommand(inputs, video_filter, video_filter_before_correction, audio_filter, markerPairIndex):
    logger.info('running ffplay command')
    if 0 <= markerPairIndex < len(settings["markers"]):
        ffplayOptions = f'-fs -sync video -fast -genpts'
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
            ffplayAudioFilter
        ))

        logger.info('Using ffplay command: ' +
                    re.sub(r'(&a?itags?.*?")', r'"', ffplayCommand) + '\n')
        ffplayProcess = subprocess.run(shlex.split(ffplayCommand))


class MissingMergeInput(Exception):
    pass


class MissingMarkerPairFilePath(Exception):
    pass


def makeMergedClips(settings):
    markerPairMergeList = settings["markerPairMergeList"]
    markerPairMergeList = markerPairMergeList.split(';')
    inputsTxtPath = ''

    mergeListGen = createMergeList(markerPairMergeList)
    for merge, mergeList in mergeListGen:
        inputs = ''
        logger.info('-' * 80)
        try:
            for i in mergeList:
                markerPair = settings["markers"][i-1]
                if 'fileName' in markerPair and 'filePath' in markerPair:
                    if Path(markerPair["filePath"]).is_file():
                        inputs += f'''file '{settings["markers"][i-1]["fileName"]}'\n'''
                    else:
                        raise MissingMergeInput
                else:
                    raise MissingMarkerPairFilePath
        except IndexError:
            logger.error(
                f'Aborting generation of webm with merge list {mergeList}.')
            logger.error(f'Missing required marker pair number {i}.')
            continue
        except MissingMergeInput:
            logger.error(
                f'Aborting generation of webm with merge list {mergeList}.')
            logger.error(
                f'Missing required input webm with path {markerPair["filePath"]}.')
            continue
        except MissingMarkerPairFilePath:
            logger.error(
                f'Aborting generation of webm with merge list {mergeList}')
            logger.error(f'Missing file path for marker pair {i}')
            continue

        inputsTxtPath = f'{webmsPath}/inputs.txt'
        with open(inputsTxtPath, "w+", encoding='utf-8') as inputsTxt:
            inputsTxt.write(inputs)
        mergedFileName = f'{settings["titleSuffix"]}-({merge}).webm'
        mergedFilePath = f'{webmsPath}/{mergedFileName}'
        ffmpegConcatCmd = f' "{ffmpegPath}" -n -hide_banner -f concat -safe 0 -i "{inputsTxtPath}" -c copy "{mergedFilePath}"'

        if not Path(mergedFilePath).is_file():
            logger.info('-' * 80)
            logger.info(f'Generating "{mergedFileName}"...\n')
            logger.info(f'Using ffmpeg command: {ffmpegConcatCmd}')
            ffmpegProcess = subprocess.run(shlex.split(ffmpegConcatCmd))
            if ffmpegProcess.returncode == 0:
                logger.info(f'Successfuly generated: "{mergedFileName}"\n')
            else:
                logger.info(f'Failed to generate: "{mergedFileName}"\n')
        else:
            logger.info(f'Skipped existing file: "{mergedFileName}"\n')

        try:
            os.remove(inputsTxtPath)
        except (OSError, FileNotFoundError):
            pass


def checkWebmExists(fileName, filePath):
    if not Path(filePath).is_file():
        logger.info(f'Generating "{fileName}"...\n')
        return False
    else:
        logger.info(f'Skipped existing file: "{fileName}"\n')
        return True


def createMergeList(markerPairMergeList):
    for merge in markerPairMergeList:
        mergeCSV = merge.split(',')
        mergeList = []
        for mergeRange in mergeCSV:
            if '-' in mergeRange:
                mergeRange = mergeRange.split('-')
                startPair = int(mergeRange[0])
                endPair = int(mergeRange[1])
                if (startPair <= endPair):
                    for i in range(startPair, endPair + 1):
                        mergeList.append(i)
                else:
                    for i in range(startPair, endPair - 1 if endPair >= 1 else 0, -1):
                        mergeList.append(i)
            else:
                mergeList.append(int(mergeRange))
        yield merge, mergeList


def ffprobeVideoProperties(video):
    try:
        ffprobeCommand = f'"{ffprobePath}" "{video}" -v quiet -select_streams v -print_format json -show_streams -show_format'
        ffprobeOutput = subprocess.check_output(shlex.split(ffprobeCommand))
    except subprocess.CalledProcessError as cpe:
        logger.error(f'Could not fetch video properties with ffprobe')
        logger.error(f'{cpe}')
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
        logger.warning('Crop resolution does not match video resolution.')
        if settings["cropResWidth"] != settings["width"]:
            logger.warning(
                f'Crop resolution width ({settings["cropResWidth"]}) not equal to video width ({settings["width"]})')
        if settings["cropResHeight"] != settings["height"]:
            logger.warning(
                f'Crop resolution height ({settings["cropResHeight"]}) not equal to video height ({settings["height"]})')
        logger.info(
            f'Crop X offset and width will be multiplied by {cropMultipleX}')
        logger.info(
            f'Crop Y offset and height will be multiplied by {cropMultipleY}')
        if not settings["noAutoScaleCropRes"]:
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


def getDefaultEncodeSettings(videobr):
    if videobr is None:
        encodeSettings = {'crf': 30, 'autoTargetMaxBitrate': 0,
                          'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 4000:
        encodeSettings = {'crf': 20, 'autoTargetMaxBitrate': int(
            1.6 * videobr), 'encodeSpeed': 2, 'twoPass': False}
    elif videobr <= 6000:
        encodeSettings = {'crf': 22, 'autoTargetMaxBitrate': int(
            1.5 * videobr), 'encodeSpeed': 3, 'twoPass': False}
    elif videobr <= 10000:
        encodeSettings = {'crf': 24, 'autoTargetMaxBitrate': int(
            1.4 * videobr), 'encodeSpeed': 4, 'twoPass': False}
    elif videobr <= 15000:
        encodeSettings = {'crf': 26, 'autoTargetMaxBitrate': int(
            1.3 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    elif videobr <= 20000:
        encodeSettings = {'crf': 30, 'autoTargetMaxBitrate': int(
            1.2 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    else:
        encodeSettings = {'crf': 35, 'autoTargetMaxBitrate': int(
            1.1 * videobr), 'encodeSpeed': 5, 'twoPass': False}
    return encodeSettings


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

        for fileName, link in zip(fileNames, links):
            markdown += f'({fileName})[{link}]\n\n'
            print('\n==Reddit Markdown==')
            print(markdown)


def cleanFileName(fileName):
    if sys.platform == 'win32':
        fileName = re.sub(r'[*?"<>\0]', '',  fileName)
        fileName = re.sub(r'[/|\\:]', '_',  fileName)
    elif sys.platform == 'darwin':
        fileName = re.sub(r'[:\0]', '_',  fileName)
    elif sys.platform.startswith('linux'):
        fileName = re.sub(r'[/\0]', '_',  fileName)
    return fileName


def getVidstabPreset(level):
    denoisePreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        denoisePreset = {"enabled": True, "shakiness": 1,
                         "optzoom": 2, "zoomspeed": 0.1,  "desc": "Very Weak"}
    elif level == 2:
        denoisePreset = {"enabled": True, "shakiness": 3,
                         "optzoom": 2, "zoomspeed": 0.25,   "desc": "Weak"}
    elif level == 3:
        denoisePreset = {"enabled": True, "shakiness": 5,
                         "optzoom": 2, "zoomspeed": 0.5,   "desc": "Medium"}
    elif level == 4:
        denoisePreset = {"enabled": True, "shakiness": 8,
                         "optzoom": 2, "zoomspeed": 0.75,   "desc": "Strong"}
    elif level == 5:
        denoisePreset = {"enabled": True, "shakiness": 10,
                         "optzoom": 1,   "desc": "Very Strong"}
    return denoisePreset


def getDenoisePreset(level):
    denoisePreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        denoisePreset = {"enabled": True,
                         "lumaSpatial": 1, "desc": "Very Weak"}
    elif level == 2:
        denoisePreset = {"enabled": True, "lumaSpatial": 2,  "desc": "Weak"}
    elif level == 3:
        denoisePreset = {"enabled": True, "lumaSpatial": 4,  "desc": "Medium"}
    elif level == 4:
        denoisePreset = {"enabled": True, "lumaSpatial": 6,  "desc": "Strong"}
    elif level == 5:
        denoisePreset = {"enabled": True,
                         "lumaSpatial": 8,  "desc": "Very Strong"}
    return denoisePreset


main()
