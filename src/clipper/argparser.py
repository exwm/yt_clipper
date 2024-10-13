import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, OrderedDict, Tuple

from rich_argparse import ArgumentDefaultsRichHelpFormatter

from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.ffmpeg_version import getFfmpegVersion
from clipper.version import __version__
from clipper.ytdl import ytdl_bin_get_version


def getArgParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate clips from input video.",
        formatter_class=ArgumentDefaultsRichHelpFormatter,
    )
    parser.add_argument(
        "-v",
        "--version",
        action="version",
        version=getVersionFormatString(),
    )
    parser.add_argument(
        "--print-versions",
        dest="printVersions",
        action="store_true",
        default=False,
        help="Print version information for yt_clipper and its dependencies.",
    )
    logging_options = parser.add_argument_group("Logging Options")
    other_options = parser.add_argument_group("Other Options")
    input_options = parser.add_argument_group("Input Options")
    ytdl_options = parser.add_argument_group("yt-dlp Options")

    output_options = parser.add_argument_group("Output Options")
    afilter_options = parser.add_argument_group("Audio Filter Options")
    vfilter_options = parser.add_argument_group("Video Filter Options")

    parser.add_argument(
        "--markers-json",
        "-j",
        required="--print-versions" not in sys.argv,
        dest="json",
        help=" ".join(
            [
                "Specify markers json path for generating webms from input video.",
                "Automatically streams required portions of input video from the",
                "internet if it is not otherwise specified.",
            ],
        ),
    )
    parser.add_argument(
        "--arg-files",
        nargs="*",
        dest="argFiles",
        default=["default_args.txt"]
        + (["../yt_clipper_default_args.txt"] if getattr(sys, "frozen", False) else []),
        help=" ".join(
            [
                "List of paths to files to read arguments from.",
                "The files are processed in order with later files taking precedence.",
            ],
        ),
    )
    logging_options.add_argument(
        "--log-level",
        dest="logLevel",
        type=int,
        default=15,  # VERBOSE
        help=" ".join(
            [
                "Change the log level of yt-clipper. Should be between 0 and 56.",
                "All logs above the chosen level will be shown and the rest will be hidden.",
                """Log Level Reference:
                  CRITICAL = 50;
                  FATAL = CRITICAL;
                  ERROR = 40;
                  REPORT = 34;
                  HEADER = 33;
                  NOTICE = 32;
                  WARNING = 30;
                  WARN = WARNING;
                  IMPORTANT = 29;
                  INFO = 20;
                  VERBOSE = 15;
                  DEBUG = 10;
                  NOTSET = 0;
                """,
            ],
        ),
    )
    logging_options.add_argument(
        "--no-rich-logs",
        dest="noRichLogs",
        action="store_true",
        default=False,
        help=" ".join(
            [
                "Disable rich colored logging introduced in v5.26 (3 column layout with syntactical highlighting)."
                "Use simpler colored logging instead.",
            ],
        ),
    )

    input_options.add_argument(
        "--input-video",
        "-i",
        dest="inputVideo",
        default="",
        help="Input video path.",
    )
    input_options.add_argument(
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
            ],
        ),
    )
    output_options.add_argument(
        "--fast-trim",
        "-ft",
        action="store_true",
        dest="fastTrim",
        help="Enable fast trim mode. Generates output clips very quickly by skipping re-encoding. The output will use the same video and audio codec as the input. Will output video clips with imprecise time trim and will disable most features including crop and speed.",
    )
    vfilter_options.add_argument(
        "--overlay",
        "-ov",
        dest="overlayPath",
        default="",
        help="Overlay image path.",
    )
    vfilter_options.add_argument(
        "--multiply-crop",
        "-mc",
        type=float,
        dest="cropMultiple",
        default=1,
        help=" ".join(
            [
                "Multiply all crop dimensions by an integer.",
                "(Helpful if you change resolutions: eg 1920x1080 * 2 = 3840x2160(4k)).",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--multiply-crop-x",
        "-mcx",
        type=float,
        dest="cropMultipleX",
        default=1,
        help="Multiply all x crop dimensions by an integer.",
    )
    vfilter_options.add_argument(
        "--multiply-crop-y",
        "-mcy",
        type=float,
        dest="cropMultipleY",
        default=1,
        help="Multiply all y crop dimensions by an integer.",
    )
    input_options.add_argument(
        "--only",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs to process by providing a comma separated",
                'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9").',
                "The --except flag takes precedence and will skip pairs specified with --only.",
            ],
        ),
    )
    input_options.add_argument(
        "--except",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs to skip by providing a comma separated",
                'list of marker pair numbers or ranges (e.g., "1-3,5,9" = "1,2,3,5,9").',
                "The --except flag takes precedence and will skip pairs specified with --only.",
            ],
        ),
    )
    input_options.add_argument(
        "--format",
        "-f",
        default="(bestvideo+(bestaudio[acodec=opus]/bestaudio))/best",
        help="Specify format string passed to yt-dlp.",
    )

    input_options.add_argument(
        "--format-sort",
        "-S",
        dest="formatSort",
        nargs="+",
        default=[
            "hasvid,ie_pref,lang,quality,res,fps,br,size,hdr:1,vcodec:vp9.2,vcodec:vp9,asr,proto,ext,hasaud,source,id",
        ],
        help=" ".join(
            [
                "Specify the sorting used to determine the best audio and video formats to download for generating clips."
                "The sorting is specified as a comma-separated list of sort fields that describe audio/video formats."
                "The list of sort fields is passed to yt_dlp.",
                "See the documentation of yt-dlp for the details on available sort fields.",
                "The default sort used by yt-dlp is similar to the yt-dlp default",
                "except higher filesize and bitrate are preferred over a codec hierarchy.",
                "This default sort is closer to the behavior of youtube_dl but not the same.",
            ],
        ),
    )

    output_options.add_argument(
        "--audio",
        "-a",
        action="store_true",
        help="Enable audio in output webms.",
    )

    vfilter_options.add_argument(
        "--extra-video-filters",
        "-evf",
        dest="extraVideoFilters",
        default="",
        help="Specify any extra video filters to be passed to ffmpeg.",
    )
    afilter_options.add_argument(
        "--extra-audio-filters",
        "-eaf",
        dest="extraAudioFilters",
        default="",
        help="Specify any extra audio filters to be passed to ffmpeg.",
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    afilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
        "--gamma",
        "-ga",
        type=float,
        dest="gamma",
        default=1,
        help=" ".join(
            [
                "Apply luminance gamma correction.",
                "Pass in a value between 0 and 1 to brighten shadows and reveal darker details.",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--rotate",
        "-r",
        choices=["", "clock", "cclock"],
        default="",
        help="Rotate video 90 degrees clockwise or counter-clockwise.",
    )
    vfilter_options.add_argument(
        "--denoise",
        "-dn",
        type=int,
        default=0,
        choices=range(0, 6),
        help=" ".join(
            [
                "Apply the hqdn3d denoise filter using a preset strength level from 0-5",
                "where 0 is disabled and 5 is very strong.",
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
        "--video-stabilization-dynamic-zoom",
        "-vsdz",
        dest="videoStabilizationDynamicZoom",
        action="store_true",
        help=" ".join(
            [
                "Enable video stabilization dynamic zoom.",
                "Unlike a static zoom the zoom in can vary with time to reduce cropping of video.",
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
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
            ],
        ),
    )
    vfilter_options.add_argument(
        "--remove-duplicate-frames",
        "-rdf",
        dest="dedupe",
        action="store_true",
        help=" ".join(
            [
                "Remove duplicate frames from input video.",
                "This option is automatically enabled when motion interpolation is enabled.",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--no-remove-duplicate-frames",
        "-nrdf",
        dest="noDedupe",
        action="store_true",
        help=" ".join(
            [
                "Force disable removing of duplicate frames from input video.",
                "Overrides --remove-duplicate-frames option.",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--deinterlace",
        "-di",
        action="store_true",
        help="Apply bwdif deinterlacing.",
    )
    vfilter_options.add_argument(
        "--enable-hdr",
        dest="enableHDR",
        action="store_true",
        help="Use HDR (high dynamic range) for output videos. Typically this improves image vibrancy and colors at the expense of file size and playback compatibility.",
    )
    vfilter_options.add_argument(
        "--loop",
        "-l",
        dest="loop",
        choices=["none", "fwrev", "fade"],
        default="none",
        help="Apply special looping effect to marker pair clips. "
        "For a forward-reverse or ping-pong loop use fwrev. For a cross-fading loop use fade.",
    )

    vfilter_options.add_argument(
        "--no-speed-maps",
        "-nsm",
        dest="noSpeedMaps",
        action="store_true",
        help="Disable speed maps for time-variable speed.",
    )

    vfilter_options.add_argument(
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
            ],
        ),
    )
    afilter_options.add_argument(
        "--audio-fade",
        "-af",
        type=float,
        dest="audioFade",
        default=0,
        help=("Fade the audio in at start and out at end by the specified duration in seconds."),
    )
    output_options.add_argument(
        "--encode-speed",
        "-s",
        type=int,
        dest="encodeSpeed",
        choices=range(0, 6),
        help="Set the vp9 encoding speed.",
    )
    output_options.add_argument(
        "--crf",
        type=int,
        help=" ".join(
            [
                "Set constant rate factor (crf). Default is 30 for video file input.",
                "Automatically set to a factor of the detected video bitrate",
            ],
        ),
    )
    output_options.add_argument(
        "--two-pass",
        "-tp",
        dest="twoPass",
        action="store_true",
        help="Enable two-pass encoding. Improves quality at the cost of encoding speed.",
    )
    output_options.add_argument(
        "--target-max-bitrate",
        "-b",
        dest="targetMaxBitrate",
        type=int,
        help=" ".join(
            [
                "Set target max bitrate in kilobits/s. Constrains bitrate of complex scenes."
                "Automatically set based on detected video bitrate.",
            ],
        ),
    )
    output_options.add_argument(
        "--video-codec",
        "-vc",
        dest="videoCodec",
        default="vp9",
        choices=["vp9", "vp8", "h264", "h264_vulkan"],
        help=" ".join(
            [
                "Select a video codec for video encoding."
                "With vp8, use libvorbis for audio encoding instead of the default libopus.",
                "vp9 is the default and most tested video codec with yt_clipper.",
                "vp9 generally offers a better quality-size trade-off than vp8.",
                "h264 was added more recently and is not as well tested as vp9.",
                "h264_vulkan uses hardware acceleration (typically a discrete GPU) for faster encodes at the cost of some quality.",
                "h264_vulkan uses the Vulkan technology which is supported on Linux and Windows across most modern GPUs (AMD/NVIDIA/Intel). MacOS and iOS are not yet supported. Requires ffmpeg >= 7.1.",
                "If you have issues with hardware acceleration, ensure you have the latest drivers.",
            ],
        ),
    )
    output_options.add_argument(
        "--h264-disable-reduce-stutter",
        "-h264-drs",
        dest="h264DisableReduceStutter",
        action="store_true",
        help=" ".join(
            [
                "Disable reducing output clip sutter when using the h264 output video codec.",
                "When disabled, output clips will all use the input video framerate and slowed down clips may have duplicate frames that cause some stuttering.",
                "This may be useful when merging h264 videos however as in some cases keeping the same framerate results in smoother transitions between clips.",
            ],
        ),
    )
    output_options.add_argument(
        "--auto-subs-lang",
        "-asl",
        dest="autoSubsLang",
        default="",
        help=" ".join(
            [
                "Automatically download and add subtitles from YouTube in the specified language.",
                "Subtitles will be burned (hardcoded) into the video.",
                "The argument to this option is a two-letter language code (eg en, fr, ko, ja).",
            ],
        ),
    )
    output_options.add_argument(
        "--subs-file",
        "-sf",
        dest="subsFilePath",
        default="",
        help=" ".join(
            [
                "Provide a subtitles file in vtt, sbv, or srt format.",
                "Subtitles will be burned (hardcoded) into the video.",
                "This option will take precedence over `--auto-subs-lang`.",
            ],
        ),
    )
    output_options.add_argument(
        "--subs-style",
        "-ss",
        dest="subsStyle",
        default="FontSize=12,PrimaryColour=&H32FFFFFF,SecondaryColour=&H32000000,MarginV=5",
        help=" ".join(
            [
                "Specify an ASS format string for styling subtitles.",
                "The provided styles will override those specified in the subs file.",
                "See https://fileformats.fandom.com/wiki/SubStation_Alpha#Styles_section.",
            ],
        ),
    )
    output_options.add_argument(
        "--no-auto-scale-crop-res",
        "-nascr",
        dest="noAutoScaleCropRes",
        action="store_true",
        help=" ".join(
            [
                "Disable automatically scaling the crop resolution",
                "when a mismatch with video resolution is detected.",
            ],
        ),
    )
    other_options.add_argument(
        "--preview",
        "-p",
        action="store_true",
        help=" ".join(
            [
                "Enable preview mode. Skips generating clips and instead prompts for marker pairs to preview.",
            ],
        ),
    )
    input_options.add_argument(
        "--no-auto-find-input-video",
        "-nafiv",
        dest="noAutoFindInputVideo",
        action="store_true",
        help="Disable automatic detection and usage of input video when not in preview mode.",
    )

    output_options.add_argument(
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
            ],
        ),
    )
    output_options.add_argument(
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
            ],
        ),
    )
    output_options.add_argument(
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
            ],
        ),
    )
    other_options.add_argument(
        "--notify-on-completion",
        "-noc",
        dest="notifyOnCompletion",
        action="store_true",
        help="Display a system notification when yt_clipper completes the current run.",
    )
    output_options.add_argument(
        "--overwrite",
        "-ow",
        dest="overwrite",
        action="store_true",
        help="Regenerate and overwrite existing clips.",
    )

    input_options.add_argument(
        "--enable-video-streaming-protocol-hls",
        "-evsp-hls",
        dest="enableVideoStreamingProtocolHLS",
        action="store_true",
        help="Enable use of the HLS (HTTP live streaming) video streaming protocol. Typically this involves the use of a m3u8 manifest file with a list of video segments. HLS is a relatively unreliable protocol and support for it in ffmpeg is not robust, often leading to errors during clip generation. Thus, HLS is disabled by default. However, some platforms only offer HLS (e.g. AfreecaTV for which HLS is allowed by default) and in other cases HLS may be the highest quality video stream. If HLS is required, consider downloading the video first either automatically with --download-video or the yt_clipper_auto_download helper script or manually and then specifying the video with --input-video or the yt_clipper_auto_input_video helper script.",
    )

    ytdl_options.add_argument(
        "--ytdl-username",
        "-yu",
        dest="username",
        default="",
        help="Username passed to youtube-dl for authentication.",
    )
    ytdl_options.add_argument(
        "--ytdl-password",
        "-yp",
        dest="password",
        default="",
        help="Password passed to youtube-dl for authentication.",
    )

    ytdl_options.add_argument(
        "--cookiefile",
        "-cf",
        dest="cookiefile",
        default="",
        metavar="FILE",
        help="Specify the path to a Netscape formatted cookies file to be used by yt-dlp. Use this option when sign "
        "in is required by the video platform. On how to obtain the cookies file, "
        "see https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp",
    )

    ytdl_options.add_argument(
        "--ytdl-location",
        dest="ytdlLocation",
        default="",
        help="Specify a location for yt-dlp on your system."
        "If a relative or absolute path is given, the yt-dlp installed at that location is used."
        "Otherwise the system PATH will be searched.",
    )

    ytdl_options.add_argument(
        "--no-ytdl-auto-update",
        dest="ytdlAutoUpdate",
        action="store_false",
        default=True,
        help="Disable automatic yt-dlp updates when running a frozen release of yt_clipper.",
    )

    return parser


def getArgs() -> Tuple[Dict[str, Any], List[str], List[str], List[str], Dict[str, List[str]]]:
    parser = getArgParser()

    argFiles: List[str] = parser.parse_known_args()[0].argFiles

    argv = sys.argv[1:]
    argsFromArgFiles: List[str] = []
    argsFromArgFilesMap: Dict[str, List[str]] = OrderedDict()
    for argFile in argFiles:
        args = []
        argFilePath = Path(argFile)
        if argFilePath.is_file():
            with Path.open(argFilePath, encoding="utf-8") as f:
                lines = [line.lstrip() for line in f.readlines()]
                lines = "".join([line for line in lines if not line.startswith("#")])
                args = lines.split()
                argsFromArgFiles += args
                argsFromArgFilesMap[argFile] = args

    argv = argsFromArgFiles + argv
    args, unknown = parser.parse_known_args(argv)
    args = vars(args)

    if args["cropMultiple"] != 1:
        args["cropMultipleX"] = args["cropMultiple"]
        args["cropMultipleY"] = args["cropMultiple"]
    args = {k: v for k, v in args.items() if v is not None}
    args["videoStabilization"] = getVidstabPreset(args["videoStabilization"])
    args["denoise"] = getDenoisePreset(args["denoise"])

    return args, unknown, argsFromArgFiles, argFiles, argsFromArgFilesMap


def getVersionFormatString() -> str:
    return f"""%(prog)s v{__version__}"""


def getDepVersionsString(cp: ClipperPaths) -> str:
    return f"""yt_clipper: {__version__}\nyt_dlp: {ytdl_bin_get_version(cp)}{getFfmpegVersion(cp.ffmpegPath)}"""


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
