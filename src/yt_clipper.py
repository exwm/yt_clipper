import sys
import subprocess
import shlex
import argparse
import re
import json
import itertools
import os
from pathlib import Path

UPLOAD_KEY_REQUEST_ENDPOINT = 'https://api.gfycat.com/v1/gfycats?'
FILE_UPLOAD_ENDPOINT = 'https://filedrop.gfycat.com'
AUTHENTICATION_ENDPOINT = 'https://api.gfycat.com/v1/oauth/token'

markers = []
markers = ['0:0:iw:ih' if m == 'undefined' else m for m in markers]
concats = ''
title = 'None'
shortTitle = 'None'

outPaths = []
fileNames = []
links = []
markdown = ''

ffmpegPath = './bin/ffmpeg.exe'
webmsPath = './webms'


def loadMarkers(markersJson):
    markersDict = json.loads(markersJson)
    videoUrl = ''
    for videoID, markers in markersDict.items():
        videoUrl = 'https://www.youtube.com/watch?v=' + videoID
        break
    markers = list(itertools.chain.from_iterable(markers))
    global concats
    concats = markersDict['merge-list']
    cropResWidth = markersDict['crop-res-width']
    cropResHeight = markersDict['crop-res-height']

    print('videoUrl: ', videoUrl)
    print('concats: ', concats)
    return videoUrl, markers, cropResWidth, cropResHeight


def autoSetCropMultiples(cropResWidth, cropResHeight, videoWidth, videoHeight):
    cropMultipleX = (videoWidth / cropResWidth)
    cropMultipleY = (videoHeight / cropResHeight)
    if cropResWidth != videoWidth or cropResHeight != videoHeight:
        print('Warning: Crop resolution does not match video resolution.',
              file=sys.stderr)
        if cropResWidth != videoWidth:
            print(
                f'Crop resolution width ({cropResWidth}) not equal to video width ({videoWidth})', file=sys.stderr)
        if cropResWidth != videoWidth:
            print(
                f'Crop resolution height ({cropResHeight}) not equal to video height ({videoHeight})', file=sys.stderr)
        print(f'Crop X offset and width will be multiplied by {cropMultipleX}')
        print(
            f'Crop Y offset and height will be multiplied by {cropMultipleY}')
        shouldScaleCrop = input(
            'Automatically scale the crop resolution? (y/n): ')
        if shouldScaleCrop == 'yes' or shouldScaleCrop == 'y':
            args.cropMultipleX = cropMultipleX
            args.cropMultipleY = cropMultipleY


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
    with open(filteredDashPath, 'w+') as filteredDash:
        filteredDash.write(dashdom.toxml())

    return filteredDashPath


def getVideoInfo(videoUrl, ytdlFormat):
    from youtube_dl import YoutubeDL
    ydl = YoutubeDL({'format': ytdlFormat, 'forceurl': True})
    ydl_info = ydl.extract_info(videoUrl, download=False)
    if 'requested_formats' in ydl_info:
        rf = ydl_info['requested_formats']
        videoInfo = rf[0]
    else:
        videoInfo = ydl_info

    dashFormatIDs = []
    dashVideoFormatID = None
    dashAudioFormatID = None
    if videoInfo['protocol'] == 'http_dash_segments':
        dashVideoFormatID = videoInfo['format_id']
        dashFormatIDs.append(dashVideoFormatID)
    else:
        videoUrl = videoInfo['url']

    global title
    title = re.sub("'", "", ydl_info['title'])

    videoWidth = videoInfo['width']
    videoHeight = videoInfo['height']
    videoFPS = videoInfo['fps']
    videobr = int(videoInfo['tbr'])

    print('Video title: ', title)
    print('Video width: ', videoWidth)
    print('Video height: ', videoHeight)
    print('Video fps: ', videoFPS)
    print(f'Detected video bitrate: {videobr}k')

    if args.json:
        autoSetCropMultiples(cropResWidth, cropResHeight,
                             videoWidth, videoHeight)

    audioUrl = ''
    if args.audio:
        audioInfo = rf[1]
        audiobr = int(videoInfo['tbr'])

        if audioInfo['protocol'] == 'http_dash_segments':
            dashAudioFormatID = audioInfo['format_id']
            dashFormatIDs.append(dashAudioFormatID)
        else:
            audioUrl = audioInfo['url']

    if dashFormatIDs:
        filteredDashPath = filterDash(videoInfo['url'], dashFormatIDs)
        if dashVideoFormatID:
            videoUrl = filteredDashPath
        if dashAudioFormatID:
            audioUrl = filteredDashPath

    return videoUrl, videobr, audioUrl


def getDefaultEncodingSettings(videobr):
    if videobr is None:
        settings = (30, 0, 2, False)
    elif videobr <= 4000:
        settings = (20, int(1.6 * videobr), 2, False)
    elif videobr <= 6000:
        settings = (22, int(1.5 * videobr), 3, False)
    elif videobr <= 10000:
        settings = (24, int(1.4 * videobr), 4, False)
    elif videobr <= 15000:
        settings = (26, int(1.3 * videobr), 5, False)
    elif videobr <= 20000:
        settings = (30, int(1.2 * videobr), 5, False)
    else:
        settings = (35, int(1.1 * videobr), 5, False)
    return settings


def clipper(markers, title, videoUrl, ytdlFormat, overlayPath='', delay=0):
    if args.url:
        videoUrl, videobr, audioUrl = getVideoInfo(videoUrl, ytdlFormat)
        crf, videobr, speed, twoPass = getDefaultEncodingSettings(videobr)
    else:
        crf, videobr, speed, twoPass = getDefaultEncodingSettings(None)
    if args.videobr:
        videobr = args.videobr
    if args.crf:
        crf = args.crf
    if args.twoPass:
        twoPass = args.twoPass
    if args.speed:
        speed = args.speed
    print((f'Encoding options: CRF: {crf} (0-63), Target Bitrate: {videobr}k, '
           + f'Two-pass encoding enabled: {twoPass}, Encoding Speed: {speed} (0-5)'))

    def trim_video(startTime, endTime, slowdown, cropString,  outPath):
        filter_complex = ''
        startTime += delay
        endTime += delay
        duration = (endTime - startTime)*slowdown
        inputs = f'"{ffmpegPath}" '

        if args.url:
            inputs += f' -n -ss {startTime} -i "{videoUrl}" '
            filter_complex += f'[0:v]setpts={slowdown}*(PTS-STARTPTS)[slowed];'
            if args.audio:
                inputs += f' -i "{audioUrl}" '
                filter_complex += f'[1:a]atrim={startTime}:{endTime},atempo={1/slowdown};'
            else:
                inputs += ' -an '
        else:
            inputs += f' -n -i "{videoUrl}" -map 0 '
            filter_complex += f'[0:v]trim={startTime}:{endTime}, setpts={slowdown}*(PTS-STARTPTS)[slowed];'
            if args.audio:
                filter_complex += f'[0:a]atrim={startTime}:{endTime},atempo={1/slowdown};'
            else:
                inputs += ' -an '

        inputs += ' -hide_banner '

        crops = cropString.split(':')
        crops[0] = args.cropMultipleX * int(crops[0])
        if crops[2] != 'iw':
            crops[2] = args.cropMultipleX * int(crops[2])
        crops[1] = args.cropMultipleY * int(crops[1])
        if crops[3] != 'ih':
            crops[3] = args.cropMultipleY * int(crops[3])

        filter_complex += (
            f'[slowed]crop=x={crops[0]}:y={crops[1]}:w={crops[2]}:h={crops[3]}')
        filter_complex += f'[cropped];[cropped]lutyuv=y=gammaval({args.gamma})'

        if args.rotate:
            filter_complex += f',transpose={args.rotate}'
        if args.denoise:
            filter_complex += f',hqdn3d'
        if args.deinterlace:
            filter_complex += f',bwdif'

        if overlayPath:
            filter_complex += f'[corrected];[corrected][1:v]overlay=x=W-w-10:y=10:alpha=0.5'
            inputs += f'-i "{overlayPath}"'

        ffmpegCommand = ' '.join((
            inputs,
            f'-filter_complex "{filter_complex}"',
            f'-c:v libvpx-vp9 -pix_fmt yuv420p',
            f'-c:a libopus -b:a 128k',
            f'-slices 8 -threads 8 -row-mt 1 -tile-columns 6 -tile-rows 2',
            f'-speed {speed} -crf {crf} -b:v {videobr}k',
            f'-metadata title="{title}" -t {duration}',
            f'-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
            f'-f webm ',
        ))

        if twoPass:
            ffmpegPass1 = shlex.split(ffmpegCommand + ' -pass 1 -')
            subprocess.run(ffmpegPass1)
            ffmpegPass2 = ffmpegCommand + f' -pass 2 "{outPath}"'
            print(re.sub(r'(&a?itags?.*?")', r'"', ffmpegPass2) + '\n')
            ffmpegProcess = subprocess.run(shlex.split(ffmpegPass2))
        else:
            ffmpegCommand = ffmpegCommand + f' "{outPath}"'
            print(re.sub(r'(&a?itags?.*?")', r'"', ffmpegCommand) + '\n')
            ffmpegProcess = subprocess.run(shlex.split(ffmpegCommand))
        return ffmpegProcess.returncode

    def makeMergedClips():
        global concats
        concats = concats.split(';')
        nonlocal report
        for concat in concats:
            concatCSV = concat.split(',')
            concatList = []
            for concatRange in concatCSV:
                if '-' in concatRange:
                    concatRange = concatRange.split('-')
                    for i in range(int(concatRange[0]), int(concatRange[1]) + 1):
                        concatList.append(i)
                else:
                    concatList.append(int(concatRange))
            inputs = ''
            mergedCSV = ','.join([str(i) for i in concatList])
            for i in concatList:
                inputs += f'''file '{shortTitle}-{i}.webm'\n'''
            inputsTxtPath = f'{webmsPath}/inputs.txt'
            with open(inputsTxtPath, "w+") as inputsTxt:
                inputsTxt.write(inputs)
            mergedFileName = f'{shortTitle}-({mergedCSV}).webm'
            mergedFilePath = f'{webmsPath}/{mergedFileName}'
            ffmpegConcatCmd = f' "{ffmpegPath}" -n -hide_banner -f concat -safe 0 -i "{inputsTxtPath}" -c copy "{mergedFilePath}"'

            if not Path(mergedFilePath).is_file():
                print(f'\nGenerating "{mergedFileName}"...\n')
                print(ffmpegConcatCmd)
                ffmpegProcess = subprocess.run(shlex.split(ffmpegConcatCmd))
                if ffmpegProcess.returncode == 0:
                    report += f'Successfuly generated: "{mergedFileName}"\n'
                else:
                    report += f'Failed to generate: "{mergedFileName}"\n'
            else:
                print(f'Skipped existing file: "{mergedFileName}"\n')
                report += f'Skipped existing file: "{mergedFileName}"\n'
        try:
            os.remove(inputsTxtPath)
        except OSError:
            pass

    report = '\n** yt_clipper Summary Report **\n'
    for i in range(0, len(markers), 4):
        startTime = markers[i]
        endTime = markers[i+1]
        slowdown = 1 / markers[i+2]
        cropString = markers[i+3]
        fileName = f'{shortTitle}-{i//4+1}.webm'
        outPath = f'{webmsPath}/{fileName}'
        outPaths.append(outPath)
        fileNames.append(outPath[0:-5])
        if not Path(outPath).is_file():
            print(f'\nGenerating "{fileName}"...\n')
            ffmpegReturnCode = trim_video(
                startTime, endTime, slowdown, cropString, outPath)
            if ffmpegReturnCode == 0:
                report += f'Successfuly generated: "{fileName}"\n'
            else:
                report += f'Failed to generate: "{fileName}"\n'
        else:
            print(f'Skipped existing file: "{fileName}"\n')
            report += f'Skipped existing file: "{fileName}"\n'
    if concats != '':
        makeMergedClips()
    print(report)


# cli arguments
parser = argparse.ArgumentParser(
    description='Generate trimmed webms from input video.')
parser.add_argument('infile', metavar='I', help='Input video path.')
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
parser.add_argument('--url', '-u', action='store_true',
                    help='Use youtube-dl and ffmpeg to download only the portions of the video required.')
parser.add_argument('--json', '-j', action='store_true',
                    help='Read in markers json file and automatically create webms.')
parser.add_argument('--format', '-f', default='bestvideo+bestaudio',
                    help='Specify format string passed to youtube-dl.')
parser.add_argument('--delay', '-d', type=float, dest='delay', default=0,
                    help='Add a fixed delay to both the start and end time of each marker. Can be negative.')
parser.add_argument('--gamma', '-ga', type=float, dest='gamma', default=1,
                    help='Apply luminance gamma correction. Pass in a value between 0 and 1 to brighten shadows and reveal darker details.')
parser.add_argument('--rotate', '-r', dest='rotate', choices=['clock', 'cclock'],
                    help='Rotate video 90 degrees clockwise or counter-clockwise.')
parser.add_argument('--denoise', '-dn', action='store_true',
                    help='Apply the hqdn3d denoise filter with default settings.')
parser.add_argument('--deinterlace', '-di', action='store_true',
                    help='Apply bwdif deinterlacing.')
parser.add_argument('--encode-speed', '-s', type=int, dest='speed', choices=range(0, 6),
                    help='Set the vp9 encoding speed.')
parser.add_argument('--crf', type=int, help=('Set constant rate factor (crf). Default is 30 for video file input.' +
                                             'Automatically set to a factor of the detected video bitrate when using --json or --url.'))
parser.add_argument('--two-pass', '-tp', dest='twoPass', action='store_true',
                    help='Enable two-pass encoding. Improves quality at the cost of encoding speed.')
parser.add_argument('--target-max-bitrate', '-b', dest='videobr', type=int,
                    help=('Set target max bitrate in kilobits/s. Constrains bitrate of complex scenes.' +
                          'Automatically set based on detected video bitrate when using --json or --url.'))

args = parser.parse_args()

if args.cropMultiple != 1:
    args.cropMultipleX = args.cropMultiple
    args.cropMultipleY = args.cropMultiple

if args.json:
    args.url = True
    shortTitle = Path(args.infile).stem
    webmsPath += f'/{shortTitle}'
    with open(args.infile, 'r', encoding='utf-8-sig') as file:
        markersJson = file.read()
        videoUrl, markers, cropResWidth, cropResHeight = loadMarkers(
            markersJson)
else:
    videoUrl = args.infile


os.makedirs(f'{webmsPath}', exist_ok=True)
clipper(markers, title, videoUrl=videoUrl, ytdlFormat=args.format,
        overlayPath=args.overlay, delay=args.delay)

# auto gfycat uploading
if (args.gfycat):
    import urllib3
    import json
    from urllib.parse import urlencode
    http = urllib3.PoolManager()

    for outPath in outPaths:
        with open(outPath, 'rb') as fp:
            file_data = fp.read()
        encoded_args = urlencode({'title': f'{outPath}'})
        url = UPLOAD_KEY_REQUEST_ENDPOINT + encoded_args
        r_key = http.request('POST', url)
        print(r_key.status)
        gfyname = json.loads(r_key.data.decode('utf-8'))['gfyname']
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
