import argparse
import importlib
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from clipper.clipper_types import DictStrAny
from clipper.version import __version__
from clipper.ytdl_importer import SUPPORTED_YOUTUBE_DL_ALTERNATIVES


def getArgParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate clips from input video.",
        formatter_class=ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("-v", "--version", action="version", version=getVersionString())
    parser.add_argument(
        "--markers-json",
        "-j",
        required=True,
        dest="json",
        help=" ".join(
            [
                "Specify markers json path for generating webms from input video.",
                "Automatically streams required portions of input video from the",
                "internet if it is not otherwise specified.",
            ]
        ),
    )
    parser.add_argument(
        "--arg-files",
        nargs="*",
        dest="argFiles",
        default=["default_args.txt"],
        help=" ".join(
            [
                "List of paths to files to read arguments from.",
                "The files are processed in order with later files taking precedence.",
            ]
        ),
    )
    parser.add_argument(
        "--input-video", "-i", dest="inputVideo", default="", help="Input video path."
    )
    parser.add_argument(
        "--download-video",
        "-dv",
        action="store_true",
        dest="downloadVideo",
        help="Download video from the internet and use as input video for processing marker data.",
    )
    parser.add_argument(
        "--marker-pairs-merge-list",
        "-mpml",
        dest="markerPairsMergeList",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs if any you would like to merge/concatenate.",
                "Each merge is a comma separated list of marker pair numbers or ranges",
                'For example "1-3,5,9" will merge marker pairs "1,2,3,5,9").',
                'Separate multiple merges with semicolons (eg "1-3,5,9;6-2,8" creates 2 merged clips).',
                "Merge requires successful generation of each required marker pair.",
                "Merge does not require reencoding and simply orders each clip into one container.",
            ]
        ),
    )
    parser.add_argument(
        "--overlay", "-ov", dest="overlayPath", default="", help="Overlay image path."
    )
    parser.add_argument(
        "--multiply-crop",
        "-mc",
        type=float,
        dest="cropMultiple",
        default=1,
        help=" ".join(
            [
                "Multiply all crop dimensions by an integer.",
                "(Helpful if you change resolutions: eg 1920x1080 * 2 = 3840x2160(4k)).",
            ]
        ),
    )
    parser.add_argument(
        "--multiply-crop-x",
        "-mcx",
        type=float,
        dest="cropMultipleX",
        default=1,
        help="Multiply all x crop dimensions by an integer.",
    )
    parser.add_argument(
        "--multiply-crop-y",
        "-mcy",
        type=float,
        dest="cropMultipleY",
        default=1,
        help="Multiply all y crop dimensions by an integer.",
    )
    parser.add_argument(
        "--only",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs to process by providing a comma separated",
                'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9").',
                "The --except flag takes precedence and will skip pairs specified with --only.",
            ]
        ),
    )
    parser.add_argument(
        "--except",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs to skip by providing a comma separated",
                'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9").',
                "The --except flag takes precedence and will skip pairs specified with --only.",
            ]
        ),
    )
    parser.add_argument("--audio", "-a", action="store_true", help="Enable audio in output webms.")
    parser.add_argument(
        "--format",
        "-f",
        default="(bestvideo+(bestaudio[acodec=opus]/bestaudio))/best",
        help="Specify format string passed to youtube-dl alternative.",
    )
    parser.add_argument(
        "--format-sort",
        "-S",
        dest="formatSort",
        nargs="+",
        default=[
            "hasvid,ie_pref,lang,quality,res,fps,size,br,hdr:1,codec:vp9.2,asr,proto,ext,hasaud,source,id"
        ],
        help=" ".join(
            [
                "Specify the sorting used to determine the best audio and video formats to download for generating clips."
                "The sorting is specified as a comma-separated list of sort fields that describe audio/video formats."
                "The list of sort fields is passed to the youtube_dl alternative (not supported by: youtube_dl).",
                "See the documentation of the youtube-dl alternative for the details on available sort fields.",
                "The default sort used by yt_clipper is similar to the yt_dlp default",
                "except higher filesize and bitrate are preferred over a codec hierarchy.",
                "This default sort is closer to the behavior of youtube_dl but not the same.",
            ]
        ),
    )
    parser.add_argument(
        "--extra-video-filters",
        "-evf",
        dest="extraVideoFilters",
        default="",
        help="Specify any extra video filters to be passed to ffmpeg.",
    )
    parser.add_argument(
        "--extra-audio-filters",
        "-eaf",
        dest="extraAudioFilters",
        default="",
        help="Specify any extra audio filters to be passed to ffmpeg.",
    )
    parser.add_argument(
        "--minterp-mode",
        "-mm",
        dest="minterpMode",
        default="Numeric",
        choices=["Numeric", "None", "MaxSpeed", "VideoFPS", "MaxSpeedx2", "VideoFPSx2"],
        help=" ".join(
            [
                "Motion interpolation is Enabled by default in a numeric mode.",
                "In numeric mode, specify a valid target fps value in --minterp-fps.",
                "In MaxSpeed mode, targets the fps of the highest speed seen in the dynamic speed chart.",
                "In VideoFPS mode, targets the fps of the input video.",
                "MaxSpeedx2 and VideoFPSx2 modes double the target fps from the previous two modes.",
            ]
        ),
    )
    parser.add_argument(
        "--minterp-fps",
        "-mf",
        dest="minterpFPS",
        type=int,
        help=" ".join(
            [
                "Input an fps value from 10-120 to add interpolated frames and achieve smooth slow motion.",
                "Motion interpolation mode must be set to Numeric.",
                "This filter is resource intensive and will take longer to process the higher the target fps.",
                "Motion interpolation can and will introduce artifacting (visual glitches).",
                "Artifacting increases with the speed and complexity of the video.",
            ]
        ),
    )
    parser.add_argument(
        "--minterp-search-parameter",
        "-msp",
        dest="minterpSearchParam",
        type=int,
        default=32,
        help=" ".join(
            [
                "Specify a search parameter value for motion interpolation.",
                "The search parameter is roughly the exhaustiveness of the search for the right motion vectors.",
                "The minimum is 4 while the maximum is very large, but above 1024 there should be no practical use.",
                "A higher or lower value than default may help to reduce artifacting",
                "depending on the source video, but no general recommendation can be given.",
            ]
        ),
    )
    parser.add_argument(
        "--enable-minterp-enhancements",
        "-eme",
        action="store_true",
        dest="enableMinterpEnhancements",
        default=False,
        help=" ".join(
            [
                "Enables experimental enhancements for motion interpolation (minterp):",
                " 1) Sections of the video already at the target minterp speed are not interpolated.",
                "    This saves resources and improves performance and avoids artifacting.",
                " 2) The original video frames are forcibly used in the interpolated result.",
                "    This improves performance and may reduce artifacting at the cost of some smoothness.",
                "Enabling this option requires a custom build of ffmpeg named ffmpeg_ytc.",
                "ffmpeg_ytc must be present inside the bin folder of the clipper installation.",
                "Currently ffmpeg_ytc is available only for windows.",
            ]
        ),
    )
    parser.add_argument(
        "--delay",
        "-d",
        type=float,
        dest="delay",
        default=0,
        help=" ".join(
            [
                "Add a fixed delay to both the start and end time of each marker pair.",
                "This can be used to correct desync between the markup video and the input video.",
                "Can be negative.",
            ]
        ),
    )
    parser.add_argument(
        "--audio-delay",
        "-ad",
        type=float,
        dest="audioDelay",
        default=0,
        help=" ".join(
            [
                "Add a fixed delay to the start and end time of the audio of each marker pair.",
                "This can be used to correct audio desync present in the source video.",
                "Note that the audio delay is applied on top of the overall delay from `--delay`/`-d`.",
            ]
        ),
    )
    parser.add_argument(
        "--gamma",
        "-ga",
        type=float,
        dest="gamma",
        default=1,
        help=" ".join(
            [
                "Apply luminance gamma correction.",
                "Pass in a value between 0 and 1 to brighten shadows and reveal darker details.",
            ]
        ),
    )
    parser.add_argument(
        "--rotate",
        "-r",
        choices=["", "clock", "cclock"],
        default="",
        help="Rotate video 90 degrees clockwise or counter-clockwise.",
    )
    parser.add_argument(
        "--denoise",
        "-dn",
        type=int,
        default=0,
        choices=range(0, 6),
        help=" ".join(
            [
                "Apply the hqdn3d denoise filter using a preset strength level from 0-5",
                "where 0 is disabled and 5 is very strong.",
            ]
        ),
    )
    parser.add_argument(
        "--video-stabilization",
        "-vs",
        dest="videoStabilization",
        type=int,
        default=0,
        choices=range(0, 7),
        help=" ".join(
            [
                "Apply video stabilization using a preset strength from 0-6",
                "where 0 is disabled and 6 is strongest.",
            ]
        ),
    )
    parser.add_argument(
        "--video-stabilization-dynamic-zoom",
        "-vsdz",
        dest="videoStabilizationDynamicZoom",
        action="store_true",
        help=" ".join(
            [
                "Enable video stabilization dynamic zoom.",
                "Unlike a static zoom the zoom in can vary with time to reduce cropping of video.",
            ]
        ),
    )
    parser.add_argument(
        "--video-stabilization-max-angle",
        "-vsma",
        dest="videoStabilizationMaxAngle",
        type=float,
        default=0,
        help=" ".join(
            [
                "When video stabilization is enabled,",
                "set the per-frame maximum angle in degrees for rotation-based stabilization.",
                "Negative values impose no limit.",
            ]
        ),
    )
    parser.add_argument(
        "--video-stabilization-max-shift",
        "-vsms",
        dest="videoStabilizationMaxShift",
        type=int,
        default=-1,
        help=" ".join(
            [
                "When video stabilization is enabled,",
                "set the per-frame maximum shift in pixels for shift-based stabilization.",
                "Negative values impose no limit.",
            ]
        ),
    )
    parser.add_argument(
        "--remove-duplicate-frames",
        "-rdf",
        dest="dedupe",
        action="store_true",
        help=" ".join(
            [
                "Remove duplicate frames from input video.",
                "This option is automatically enabled when motion interpolation is enabled.",
            ]
        ),
    )
    parser.add_argument(
        "--no-remove-duplicate-frames",
        "-nrdf",
        dest="noDedupe",
        action="store_true",
        help=" ".join(
            [
                "Force disable removing of duplicate frames from input video.",
                "Overrides --remove-duplicate-frames option.",
            ]
        ),
    )
    parser.add_argument(
        "--deinterlace", "-di", action="store_true", help="Apply bwdif deinterlacing."
    )
    parser.add_argument(
        "--expand-color-range",
        "-ecr",
        dest="expandColorRange",
        action="store_true",
        help="Expand the output video color range to full (0-255).",
    )
    parser.add_argument(
        "--loop",
        "-l",
        dest="loop",
        choices=["none", "fwrev", "fade"],
        default="none",
        help="Apply special looping effect to marker pair clips. "
        "For a forward-reverse or ping-pong loop use fwrev. For a cross-fading loop use fade.",
    )
    parser.add_argument(
        "--fade-duration",
        "-fd",
        type=float,
        dest="fadeDuration",
        default=0.7,
        help=" ".join(
            [
                "When fade loop is enabled, set the duration of the fade for both clip start and end.",
                "The fade duration is clamped to a minimum of 0.1 seconds",
                "and a maximum of 40%% of the output clip duration.",
            ]
        ),
    )
    parser.add_argument(
        "--audio-fade",
        "-af",
        type=float,
        dest="audioFade",
        default=0,
        help=("Fade the audio in at start and out at end by the specified duration in seconds."),
    )
    parser.add_argument(
        "--encode-speed",
        "-s",
        type=int,
        dest="encodeSpeed",
        choices=range(0, 6),
        help="Set the vp9 encoding speed.",
    )
    parser.add_argument(
        "--crf",
        type=int,
        help=" ".join(
            [
                "Set constant rate factor (crf). Default is 30 for video file input.",
                "Automatically set to a factor of the detected video bitrate",
            ]
        ),
    )
    parser.add_argument(
        "--two-pass",
        "-tp",
        dest="twoPass",
        action="store_true",
        help="Enable two-pass encoding. Improves quality at the cost of encoding speed.",
    )
    parser.add_argument(
        "--target-max-bitrate",
        "-b",
        dest="targetMaxBitrate",
        type=int,
        help=" ".join(
            [
                "Set target max bitrate in kilobits/s. Constrains bitrate of complex scenes."
                "Automatically set based on detected video bitrate."
            ]
        ),
    )
    parser.add_argument(
        "--video-codec",
        "-vc",
        dest="videoCodec",
        default="vp9",
        choices=["vp9", "vp8", "h264"],
        help=" ".join(
            [
                "Select a video codec for video encoding."
                "With vp8, use libvorbis for audio encoding instead of the default libopus.",
                "vp9 is the default and most tested video codec with yt_clipper.",
                "vp9 generally offers a better quality-size trade-off than vp8.",
                "h264 was added more recently and is not as well tested as vp9.",
            ]
        ),
    )
    parser.add_argument(
        "--auto-subs-lang",
        "-asl",
        dest="autoSubsLang",
        default="",
        help=" ".join(
            [
                "Automatically download and add subtitles from YouTube in the specified language.",
                "Subtitles will be burned (hardcoded) into the video.",
                "The argument to this option is a two-letter language code (eg en, fr, ko, ja).",
            ]
        ),
    )
    parser.add_argument(
        "--subs-file",
        "-sf",
        dest="subsFilePath",
        default="",
        help=" ".join(
            [
                "Provide a subtitles file in vtt, sbv, or srt format.",
                "Subtitles will be burned (hardcoded) into the video.",
                "This option will take precedence over `--auto-subs-lang`.",
            ]
        ),
    )
    parser.add_argument(
        "--subs-style",
        "-ss",
        dest="subsStyle",
        default="FontSize=12,PrimaryColour=&H32FFFFFF,SecondaryColour=&H32000000,MarginV=5",
        help=" ".join(
            [
                "Specify an ASS format string for styling subtitles.",
                "The provided styles will override those specified in the subs file.",
                "See https://fileformats.fandom.com/wiki/SubStation_Alpha#Styles_section.",
            ]
        ),
    )
    parser.add_argument(
        "--no-auto-scale-crop-res",
        "-nascr",
        dest="noAutoScaleCropRes",
        action="store_true",
        help=" ".join(
            [
                "Disable automatically scaling the crop resolution",
                "when a mismatch with video resolution is detected.",
            ]
        ),
    )
    parser.add_argument(
        "--preview",
        "-p",
        action="store_true",
        help=" ".join(
            [
                "Enable preview mode. Skips generating clips and instead prompts for marker pairs to preview.",
            ]
        ),
    )
    parser.add_argument(
        "--no-auto-find-input-video",
        "-nafiv",
        dest="noAutoFindInputVideo",
        action="store_true",
        help="Disable automatic detection and usage of input video when not in preview mode.",
    )
    parser.add_argument(
        "--no-speed-maps",
        "-nsm",
        dest="noSpeedMaps",
        action="store_true",
        help="Disable speed maps for time-variable speed.",
    )
    parser.add_argument(
        "--remove-metadata",
        "-rm",
        dest="removeMetadata",
        action="store_true",
        help=" ".join(
            [
                "Do not add metadata to output video.",
                "The only metadata currently added is the videoTitle from the markers .json file.",
                "Also tries to strip any other metadata that may otherwise be added.",
                "Some basic video properties such as the duration or muxing app will remain.",
            ]
        ),
    )
    parser.add_argument(
        "--extra-ffmpeg-args",
        "-efa",
        dest="extraFfmpegArgs",
        default="",
        help=" ".join(
            [
                "Extra arguments to be passed to the ffmpeg command built by yt_clipper.",
                "The extra arguments are injected after other arguments set by yt_clipper,",
                "but before the video filters."
                "Use quotes to ensure the arguments are passed to ffmpeg including whitespace.",
                "On Windows, if nested quoting is required, it may be necessary ",
                "to use double quotes for the outermost quotes due to a bug.",
                "Arguments that conflict with the arguments automatically added ",
                "by yt_clipper may cause errors.",
            ]
        ),
    )
    parser.add_argument(
        "--target-size",
        "-ts",
        dest="targetSize",
        type=float,
        default=0,
        help=" ".join(
            [
                "Target file size in megabytes.",
                "A target size of 0 or less means unlimited.",
                "Note that this will use an estimated a constant bitrate for encoding.",
            ]
        ),
    )
    parser.add_argument(
        "--notify-on-completion",
        "-noc",
        dest="notifyOnCompletion",
        action="store_true",
        help="Display a system notification when yt_clipper completes the current run.",
    )
    parser.add_argument(
        "--overwrite",
        "-ow",
        dest="overwrite",
        action="store_true",
        help="Regenerate and overwrite existing clips.",
    )
    parser.add_argument(
        "--ytdl-username",
        "-yu",
        dest="username",
        default="",
        help="Username passed to youtube-dl for authentication.",
    )
    parser.add_argument(
        "--ytdl-password",
        "-yp",
        dest="password",
        default="",
        help="Password passed to youtube-dl for authentication.",
    )

    parser.add_argument(
        "--youtube-dl-alternative",
        "-ytdla",
        dest="youtubeDLAlternative",
        choices=SUPPORTED_YOUTUBE_DL_ALTERNATIVES,
        default="yt_dlp",
        help="Choose a youtube_dl alternative for downloading videos.",
    )
    return parser


def getArgs() -> Tuple[Dict[str, Any], List[str], List[str], List[str]]:
    parser = getArgParser()

    argFiles: List[str] = parser.parse_known_args()[0].argFiles

    argv = sys.argv[1:]
    defaultArgs: List[str] = []
    for argFile in argFiles:
        args = []
        if Path(argFile).is_file():
            with open(argFile, "r", encoding="utf-8") as f:
                lines = [l.lstrip() for l in f.readlines()]
                lines = "".join([l for l in lines if not l.startswith("#")])
                args = lines.split()
                defaultArgs += args

    argv = defaultArgs + argv
    args, unknown = parser.parse_known_args(argv)
    args = vars(args)

    if args["cropMultiple"] != 1:
        args["cropMultipleX"] = args["cropMultiple"]
        args["cropMultipleY"] = args["cropMultiple"]
    args = {k: v for k, v in args.items() if v is not None}
    args["videoStabilization"] = getVidstabPreset(args["videoStabilization"])
    args["denoise"] = getDenoisePreset(args["denoise"])

    return args, unknown, defaultArgs, argFiles


def getVersionString() -> str:
    return f"""%(prog)s v{__version__}, youtube_dl {getYoutubeDLAlternativeVersion("youtube_dl")}, yt_dlp {getYoutubeDLAlternativeVersion("yt_dlp")}"""


class ArgumentDefaultsHelpFormatter(argparse.ArgumentDefaultsHelpFormatter):
    def _get_help_string(self, action) -> Optional[str]:
        if action.help is None:
            return None

        help_str = action.help
        if "%(default)" not in action.help:
            if action.default is not argparse.SUPPRESS:
                defaulting_nargs = [argparse.OPTIONAL, argparse.ZERO_OR_MORE]
                if action.option_strings or action.nargs in defaulting_nargs:
                    if isinstance(action.default, str):
                        help_str += " (default: %(default)r)"
                    else:
                        help_str += " (default: %(default)s)"
        return help_str


def getVidstabPreset(level: int) -> DictStrAny:
    vidstabPreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 2,
            "zoomspeed": 0.05,
            "smoothing": 2,
            "desc": "Very Weak",
        }
    elif level == 2:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 4,
            "zoomspeed": 0.1,
            "smoothing": 4,
            "desc": "Weak",
        }
    elif level == 3:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 6,
            "zoomspeed": 0.2,
            "smoothing": 6,
            "desc": "Medium",
        }
    elif level == 4:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 8,
            "zoomspeed": 0.3,
            "smoothing": 10,
            "desc": "Strong",
        }
    elif level == 5:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 10,
            "zoomspeed": 0.4,
            "smoothing": 16,
            "desc": "Very Strong",
        }
    elif level == 6:
        vidstabPreset = {
            "enabled": True,
            "shakiness": 10,
            "zoomspeed": 0.5,
            "smoothing": 22,
            "desc": "Strongest",
        }
    return vidstabPreset


def getDenoisePreset(level: int) -> DictStrAny:
    denoisePreset = {"enabled": False, "desc": "Disabled"}
    if level == 1:
        denoisePreset = {"enabled": True, "lumaSpatial": 1, "desc": "Very Weak"}
    elif level == 2:
        denoisePreset = {"enabled": True, "lumaSpatial": 2, "desc": "Weak"}
    elif level == 3:
        denoisePreset = {"enabled": True, "lumaSpatial": 4, "desc": "Medium"}
    elif level == 4:
        denoisePreset = {"enabled": True, "lumaSpatial": 6, "desc": "Strong"}
    elif level == 5:
        denoisePreset = {"enabled": True, "lumaSpatial": 8, "desc": "Very Strong"}
    return denoisePreset


def getYoutubeDLAlternativeVersion(module: str):
    try:
        youtube_dl_alternative = importlib.import_module(module)
        return "v" + youtube_dl_alternative.version.__version__
    except ModuleNotFoundError:
        return "vNotFound"
