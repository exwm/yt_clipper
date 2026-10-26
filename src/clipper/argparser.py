import argparse
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, OrderedDict, Tuple

from rich_argparse import ArgumentDefaultsRichHelpFormatter

from clipper import banded_lapack, updates
from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.ffmpeg_version import getFfmpegVersion
from clipper.settings_file import decodeSettingsFile
from clipper.version import __version__
from clipper.ytdl import DEFAULT_FORMAT_SORT, ytdl_bin_get_version


class DefaultsHelpFormatter(ArgumentDefaultsRichHelpFormatter):
    """Show '(default: ...)' like the parent, but omit it when the default is
    None or an empty string.

    Those render as a confusing '(default: None)' or a blank '(default: )'.
    Such options are either unset/disabled or have their real default computed
    dynamically deeper in the code (e.g. --crf, --encode-speed, --target-max-
    bitrate); where that default matters it is spelled out in the help text.
    """

    def _get_help_string(self, action: argparse.Action) -> Optional[str]:
        if action.default in (None, ""):
            return action.help
        return super()._get_help_string(action)


def getArgParser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate clips from input video.",
        # Full option names only, on the command line and in settings files: a settings file kept for
        # a newer version could otherwise name an option that is the start of a current one's name.
        allow_abbrev=False,
        formatter_class=DefaultsHelpFormatter,
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
    parser.add_argument(
        "--check-for-updates",
        dest="checkForUpdates",
        action="store_true",
        default=False,
        help="Check GitHub for a newer yt_clipper release and print the result.",
    )
    parser.add_argument(
        "--markers-json",
        "-j",
        required=not {"--print-versions", "--check-for-updates"} & set(sys.argv),
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
        # Worked out in getArgs: the paths depend on the machine, and the help would show them.
        default=None,
        help=" ".join(
            [
                "List of paths to files to read arguments from.",
                "The files are processed in order with later files taking precedence.",
                "By default, a release reads yt_clipper_default_args.txt in the folder that holds the install folders, then the install's own default_args.txt.",
                "It then reads default_args.txt in the working folder when that is another folder.",
                "Other installs read default_args.txt in the working folder.",
            ],
        ),
    )

    logging_options = parser.add_argument_group("Logging Options")
    add_logging_options(logging_options)

    tool_options = parser.add_argument_group("Tool Options")
    add_tool_options(tool_options)

    other_options = parser.add_argument_group("Other Options")
    add_other_options(other_options)

    input_options = parser.add_argument_group("Input Options")
    add_input_options(input_options)

    output_options = parser.add_argument_group("Output Options")
    add_output_options(output_options)

    afilter_options = parser.add_argument_group("Audio Filter Options")
    add_afilter_options(afilter_options)

    vfilter_options = parser.add_argument_group("Video Filter Options")
    add_vfilter_options(vfilter_options)

    ytdl_options = parser.add_argument_group("yt-dlp Options")
    add_ytdl_options(ytdl_options)

    return parser


def add_afilter_options(afilter_options: argparse._ArgumentGroup) -> None:
    afilter_options.add_argument(
        "--extra-audio-filters",
        "-eaf",
        dest="extraAudioFilters",
        default="",
        help="Specify any extra audio filters to be passed to ffmpeg.",
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
    afilter_options.add_argument(
        "--audio-fade",
        "-af",
        type=float,
        dest="audioFade",
        default=0,
        help=("Fade the audio in at start and out at end by the specified duration in seconds."),
    )


def add_vfilter_options(vfilter_options: argparse._ArgumentGroup) -> None:
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
    vfilter_options.add_argument(
        "--extra-video-filters",
        "-evf",
        dest="extraVideoFilters",
        default="",
        help="Specify any extra video filters to be passed to ffmpeg.",
    )
    vfilter_options.add_argument(
        "--legacy-minterp-mode",
        "-lmm",
        dest="minterpMode",
        default="Numeric",
        choices=["Numeric", "None", "MaxSpeed", "VideoFPS", "MaxSpeedx2", "VideoFPSx2"],
        help=" ".join(
            [
                "Applies only to ffmpeg-based motion interpolation. Deprecated and scheduled for removal.",
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
                "Applies only to ffmpeg-based motion interpolation. Deprecated and scheduled for removal.",
                "Input an fps value from 10-120 to add interpolated frames and achieve smooth slow motion.",
                "Motion interpolation mode must be set to Numeric.",
                "This filter is resource intensive and will take longer to process the higher the target fps.",
                "Motion interpolation can and will introduce artifacting (visual glitches).",
                "Artifacting increases with the speed and complexity of the video.",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--minterp-fps-multiplier",
        "-mfm",
        dest="minterpFpsMultiplier",
        default=0,
        type=float,
        help=" ".join(
            [
                "Input an fps multiplier (>= 1) to enable motion interpolation via video2x RIFE.",
                "A value of 0 (default) disables motion interpolation.",
                "A value of 1 targets the original source video fps, compensating for slowdown.",
                "Higher values (e.g. 2) target N x source fps for extra-smooth slow motion.",
                "Setting an fps multiplier that is an integer multiple of the static speed (e.g. 1.2 = 2 * 0.6) will preserve original frames when doing motion interpolation.",
                "Motion interpolation can introduce artifacting (visual glitches).",
                "Artifacting increases with the speed and complexity of the video.",
            ],
        ),
    )
    vfilter_options.add_argument(
        "--minterp-tool",
        "-mt",
        dest="minterpTool",
        choices=["ffmpeg", "video2x"],
        default="video2x",
        help=" ".join(
            [
                "Select the tool used for motion interpolation.",
                "video2x uses the video2x post-processor with the RIFE model for higher quality interpolation.",
                "video2x requires a vulkan-capable GPU. See also https://github.com/k4yt3x/video2x/.",
                "Frozen releases look for video2x in bin/video-tools and then bin/video2x in the install folder, then on the system PATH.",
                "video2x can be downloaded separately from https://github.com/k4yt3x/video2x/releases.",
                "video2x does not yet support hardware-accelerated encoders like h264_vulkan or h264_nvenc.",
                "ffmpeg-based motion interpolation is deprecated and scheduled to be removed.",
                "ffmpeg-based motion interpolation requires --minterp-fps or a non-Numeric minterp mode to have effect.",
                "ffmpeg uses the built-in minterp filter.",
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
                "ffmpeg_ytc must be present inside the bin/video-tools folder of the clipper installation.",
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
        help=" ".join(
            [
                "Apply special looping effect to marker pair clips.",
                "For a forward-reverse or ping-pong loop use fwrev. For a cross-fading loop use fade.",
            ],
        ),
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


def add_ytdl_options(ytdl_options: argparse._ArgumentGroup) -> None:
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
        "--cookies",
        "--cookiesfile",
        "--cookiefile",
        "-cf",
        dest="cookiefile",
        default="",
        metavar="FILE",
        help=" ".join(
            [
                "Specify the path to a Netscape formatted cookies file to be used by yt-dlp.",
                "Use this option when sign in is required by the video platform.",
                "On how to obtain the cookies file,",
                "see https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp",
            ],
        ),
    )

    ytdl_options.add_argument(
        "--cookies-from-browser",
        "-cfb",
        dest="cookiesFromBrowser",
        default="",
        metavar="BROWSER[+KEYRING][:PROFILE][::CONTAINER]",
        help=" ".join(
            [
                "Load cookies straight from a local browser instead of a cookies file.",
                "Supported browsers: brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale.",
                "Optionally append +KEYRING (Chromium decryption keyring on Linux: basictext, gnomekeyring, kwallet, kwallet5, kwallet6), :PROFILE (name or path), and ::CONTAINER (Firefox only, 'none' for no container).",
                "By default, all containers of the most recently used profile are loaded.",
                "Examples: 'firefox', 'chrome:Default', 'firefox:default-release::Personal'.",
                "Mutually exclusive with --cookies.",
                "Chrome and Chromium-based browsers often fail on Windows due to cookie encryption.",
                "Use firefox or a --cookies file there.",
            ],
        ),
    )

    ytdl_options.add_argument(
        "--ytdl-dir",
        dest="ytdlDir",
        default="",
        help=" ".join(
            [
                "Specify a directory to search for the yt-dlp tool on your system.",
                "The expected tool name for the platform is searched for in the directory.",
                "A relative directory is relative to the working folder.",
                "If unspecified, frozen releases use bin/yt-dlp in the install folder and other installs search the system PATH.",
            ],
        ),
    )

    ytdl_options.add_argument(
        "--no-ytdl-auto-update",
        dest="ytdlAutoUpdate",
        action="store_false",
        default=True,
        help="Disable automatic yt-dlp updates when running a frozen release of yt_clipper.",
    )

    ytdl_options.add_argument(
        "--accept-lower-quality",
        dest="acceptLowerQuality",
        action="store_true",
        default=False,
        help=" ".join(
            [
                "Continue without asking when a higher quality format cannot be downloaded and yt-dlp falls back to a lower quality one.",
                "Without it, the clipper script asks first, and stops when no one can answer, for example in a scheduled run.",
            ],
        ),
    )


def add_other_options(other_options: argparse._ArgumentGroup) -> None:
    other_options.add_argument(
        "--notify-on-completion",
        "-noc",
        dest="notifyOnCompletion",
        action="store_true",
        help="Display a system notification when yt_clipper completes the current run.",
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


def add_output_options(output_options: argparse._ArgumentGroup) -> None:
    output_options.add_argument(
        "--overwrite",
        "-ow",
        dest="overwrite",
        action="store_true",
        help="Regenerate and overwrite existing clips.",
    )
    output_options.add_argument(
        "--audio",
        "-a",
        action="store_true",
        help="Enable audio in output webms.",
    )
    output_options.add_argument(
        "--marker-pairs-merge-list",
        "-mpml",
        dest="markerPairsMergeList",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs if any you would like to merge/concatenate.",
                "Each merge is a comma-separated list of marker pair numbers or ranges.",
                'For example "1-3,5,9" will merge marker pairs "1,2,3,5,9".',
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
    output_options.add_argument(
        "--encode-speed",
        "-s",
        type=int,
        dest="encodeSpeed",
        choices=range(0, 6),
        help=" ".join(
            [
                "Set the vp9 encoding speed (0 slowest/best, 5 fastest).",
                "Defaults to a value from 2-5 chosen from the detected video bitrate",
                "(higher bitrate uses a faster preset).",
            ],
        ),
    )
    output_options.add_argument(
        "--crf",
        type=int,
        help=" ".join(
            [
                "Set constant rate factor (crf). Default is 30 for video file input.",
                "Automatically set to a factor of the detected video bitrate.",
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
        "--sample-guided-encode",
        "-sge",
        dest="sampleGuidedEncode",
        action="store_true",
        help=" ".join(
            [
                "Encode short samples of each marker pair at a few CRF values and pick the CRF that meets a VMAF quality target.",
                "See --sample-guided-encode-alg for the algorithm used (curve-fit by default).",
                "Each sample is compared with a CRF 18 reference encode using VMAF NEG.",
                "The highest CRF (most compression) that meets the target is used for the final encode.",
                "Targets default to VMAF NEG mean >= 95 and 5th-percentile (p5) >= 93.",
                "On very short clips (too few frames for a stable percentile), only the mean is enforced.",
                "The first run takes about 3-5x the normal encode time.",
                "Trial results are cached per marker pair and encoder settings.",
                "A rerun with the same encoder settings reuses the picked CRF, even if other settings (output filename, audio, etc.) changed.",
                "The summary table reports kbps@tgt (the interpolated bitrate at the target VMAF) for comparing encoder settings.",
                "For tuning see --target-vmaf-mean, --target-vmaf-low, --target-vmaf-low-percentile.",
            ],
        ),
    )
    output_options.add_argument(
        "--target-vmaf-mean",
        dest="targetVmafMean",
        type=float,
        default=None,
        help=" ".join(
            [
                "Override the default VMAF NEG mean target (95) used by --sample-guided-encode.",
                "An encode must clear both --target-vmaf-mean and --target-vmaf-low to be acceptable.",
                "Has no effect unless --sample-guided-encode is also set.",
            ],
        ),
    )
    output_options.add_argument(
        "--target-vmaf-low",
        dest="targetVmafLow",
        type=float,
        default=None,
        help=" ".join(
            [
                "Override the VMAF NEG low-percentile threshold used by --sample-guided-encode.",
                "The default depends on --target-vmaf-low-percentile: p1=91, p5=93, p10=95, p15=96, p20=96.5, p25=97.",
                "On short clips with too few frames for a stable percentile, only the mean is enforced.",
                "Has no effect unless --sample-guided-encode is also set.",
            ],
        ),
    )
    output_options.add_argument(
        "--target-vmaf-low-percentile",
        dest="targetVmafLowPercentile",
        type=int,
        default=5,
        choices=[1, 5, 10, 15, 20, 25],
        help=" ".join(
            [
                "Choose which VMAF NEG low percentile to enforce as the worst-case-frame target.",
                "5 (p5, the default) allows up to 5%% of frames below the threshold.",
                "1 (p1) is the usual streaming convention, but it penalizes single bad frames heavily on short clips.",
                "10 (p10) allows 10%% of frames below the threshold. Use it for very short clips where p5 is too strict.",
                "15-25 protect the worst frames less, but measure more reliably. Use them when measurement noise decides the result.",
                "All six percentiles are computed and reported. This option only chooses which one is enforced.",
                "Has no effect unless --sample-guided-encode is also set.",
            ],
        ),
    )
    output_options.add_argument(
        "--sample-guided-encode-alg",
        dest="sampleGuidedEncodeAlg",
        choices=["curve-fit", "legacy-bisection"],
        default="curve-fit",
        help=" ".join(
            [
                "Choose which search algorithm to use under --sample-guided-encode.",
                "'curve-fit' (the default) tests a few fixed CRFs, fits curves to the (CRF, VMAF) results, and picks the CRF at the knee of the curve.",
                "It is deterministic: the same content and probe set always picks the same CRF, regardless of measurement noise.",
                "It uses a soft target, so it still picks a CRF when the strict targets cannot be met.",
                "'legacy-bisection' is the older strict pass/fail search.",
                "It is kept for rollback, and will be removed once curve-fit is validated on more clips.",
                "Has no effect unless --sample-guided-encode is also set.",
            ],
        ),
    )
    output_options.add_argument(
        "--target-max-bitrate",
        "-b",
        dest="targetMaxBitrate",
        type=int,
        help=" ".join(
            [
                "Set target max bitrate in kilobits/s. Constrains bitrate of complex scenes.",
                "Automatically set based on detected video bitrate.",
            ],
        ),
    )
    output_options.add_argument(
        "--video-codec",
        "-vc",
        dest="videoCodec",
        default="vp9",
        choices=["vp9", "vp8", "h264", "h264_vulkan", "h264_nvenc", "av1"],
        help=" ".join(
            [
                "Select a video codec for video encoding.",
                "With vp8, use libvorbis for audio encoding instead of the default libopus.",
                "vp9 is the default and most tested video codec with yt_clipper.",
                "vp9 generally offers a better quality-size trade-off than vp8.",
                "h264 was added more recently and is not as well tested as vp9.",
                "h264_vulkan uses hardware acceleration (typically a discrete GPU) for faster encodes at the cost of some quality.",
                "h264_vulkan uses the Vulkan technology which is supported on Linux and Windows across most modern GPUs (AMD/NVIDIA/Intel). MacOS and iOS are not yet supported. Requires ffmpeg >= 7.1.",
                "h264_nvenc uses NVIDIA GPU hardware acceleration for faster encodes at the cost of some quality.",
                "h264_nvenc is supported on Windows and Linux with NVIDIA GPUs that have NVENC support (most modern NVIDIA GPUs). Requires ffmpeg with nvenc support.",
                "av1 uses libsvtav1 to produce AV1 video in an mp4 container (matching the container YouTube serves AV1 in). It compresses better than vp9, but encodes slower at lower preset values. Requires ffmpeg with libsvtav1 (shipped since 4.4).",
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
                "Disable reducing output clip stutter when using the h264 output video codec.",
                "When disabled, output clips will all use the input video framerate and slowed down clips may have duplicate frames that cause some stuttering.",
                "This may be useful when merging h264 videos however as in some cases keeping the same framerate results in smoother transitions between clips.",
            ],
        ),
    )
    output_options.add_argument(
        "--preview-format",
        "-pvf",
        dest="previewFormat",
        default="none",
        choices=["none", "avif", "webp"],
        help=" ".join(
            [
                "Generate a small animated preview next to each output clip (and each merged clip) in the chosen format.",
                "'avif' produces an animated AVIF at reduced resolution. Requires ffmpeg >= 6.1 for the AVIF muxer (libsvtav1 shipped since 4.4).",
                "'webp' produces an animated WebP. It plays in more browsers (older Safari, webmail, Firefox < 113) and is slightly larger than AVIF.",
                "WebP previews use libwebp method 6 (max effort) and take about 2-3x as long to encode as AVIF.",
                "Previews have no audio.",
            ],
        ),
    )
    output_options.add_argument(
        "--preview-max-dim",
        "-pvmd",
        dest="previewMaxDim",
        type=int,
        default=0,
        help=" ".join(
            [
                "Override the auto-picked max dimension (longest edge in pixels, aspect ratio preserved).",
                "0 = auto, picked from source resolution:",
                "4K->720, 1440p->640, 1080p->540, 720p->480, 480p->360, <480p->match source.",
            ],
        ),
    )
    output_options.add_argument(
        "--preview-quality",
        "-pvq",
        dest="previewQuality",
        type=int,
        default=-1,
        help=" ".join(
            [
                "Override the auto-picked quality for the preview encode. -1 = auto.",
                "AVIF (SVT-AV1 CRF scale, 0-63, lower is better): auto picks 28-45 from the source bitrate, source CRF, and downsample ratio.",
                "WebP (libwebp quality scale, 0-100, higher is better): auto picks 60-80 from the downsample ratio, preview size, and source CRF.",
                "The two scales run in opposite directions. Use the scale of the selected format.",
            ],
        ),
    )
    output_options.add_argument(
        "--preview-preset",
        "-pvp",
        dest="previewPreset",
        type=int,
        default=8,
        help="Encoder preset for preview encode (SVT-AV1: 0=slowest/best, 13=fastest). Has no effect on WebP previews.",
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
                "but before the video filters.",
                "Use quotes to ensure the arguments are passed to ffmpeg including whitespace.",
                'Join the value with = when it starts with -, for example --extra-ffmpeg-args="-preset slow".',
                "On Windows, if nested quoting is required, it may be necessary",
                "to use double quotes for the outermost quotes due to a bug.",
                "Arguments that conflict with the arguments automatically added",
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


def add_input_options(input_options: argparse._ArgumentGroup) -> None:
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
    input_options.add_argument(
        "--only",
        default="",
        help=" ".join(
            [
                "Specify which marker pairs to process by providing a comma-separated",
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
                "Specify which marker pairs to skip by providing a comma-separated",
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
        default=list(DEFAULT_FORMAT_SORT),
        help=" ".join(
            [
                "Specify the sorting used to determine the best audio and video formats to download for generating clips.",
                "The sorting is specified as a comma-separated list of sort fields that describe audio/video formats.",
                "The list of sort fields is passed to yt_dlp.",
                "See the documentation of yt-dlp for the details on available sort fields.",
                "The default sort used by yt-dlp is similar to the yt-dlp default",
                "except higher filesize and bitrate are preferred over a codec hierarchy.",
                "This default sort is closer to the behavior of youtube_dl but not the same.",
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
    input_options.add_argument(
        "--enable-video-streaming-protocol-hls",
        "-evsp-hls",
        dest="enableVideoStreamingProtocolHLS",
        action="store_true",
        help="Enable use of the HLS (HTTP live streaming) video streaming protocol. Typically this involves the use of a m3u8 manifest file with a list of video segments. HLS is a relatively unreliable protocol and support for it in ffmpeg is not robust, often leading to errors during clip generation. Thus, HLS is disabled by default. However, some platforms only offer HLS (e.g. AfreecaTV for which HLS is allowed by default) and in other cases HLS may be the highest quality video stream. If HLS is required, consider downloading the video first either automatically with --download-video or the yt_clipper_auto_download helper script or manually and then specifying the video with --input-video or the yt_clipper_auto_input_video helper script.",
    )


def add_logging_options(logging_options: argparse._ArgumentGroup) -> None:
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
                "Disable rich colored logging introduced in v5.26 (3 column layout with syntactical highlighting).",
                "Use simpler colored logging instead.",
            ],
        ),
    )


def add_tool_options(tool_options: argparse._ArgumentGroup) -> None:
    tool_options.add_argument(
        "--ffmpeg-tools-dir",
        dest="ffmpegToolsDir",
        type=str,
        help=" ".join(
            [
                "Specify a directory to search for ffmpeg, ffprobe, and ffplay.",
                "A relative directory is relative to the working folder.",
                "If unspecified, frozen releases use bin/video-tools in the install folder and other installs search the system PATH.",
            ],
        ),
    )


def defaultArgFiles() -> List[str]:
    """The settings files read before the command line, later ones taking precedence. A release
    reads the shared file every version reads, then its own default_args.txt, whatever folder it runs
    from, then a default_args.txt in the working folder if that is another folder (as before 5.49)."""
    if not getattr(sys, "frozen", False):
        return ["default_args.txt"]
    installDir = Path(sys.executable).resolve().parent
    files = [
        str(updates.installsFolder(installDir) / updates.SHARED_ARGS_FILE),
        str(installDir / "default_args.txt"),
    ]
    try:
        workingDir = Path.cwd().resolve()
    except OSError:
        # The working folder was deleted: only the install's settings apply.
        return files
    if os.path.normcase(workingDir) != os.path.normcase(installDir):
        files.append(str(workingDir / "default_args.txt"))
    return files


def splitArgLine(line: str) -> List[str]:
    """One settings line split like a command line: double quotes group words (a path with spaces);
    backslashes and apostrophes stay as they are (Windows paths, names like O'Brien)."""
    lexer = shlex.shlex(line, posix=True)
    lexer.whitespace_split = True
    lexer.escape = ""
    lexer.commenters = ""
    lexer.quotes = '"'
    return list(lexer)


def readArgFile(path: Path) -> List[str]:
    """The arguments in a settings file: one or more per line, and # starts a comment line."""
    try:
        raw = path.read_bytes()
    except OSError as error:
        print(f"Warning: Could not read {path} ({error.strerror or error}), so its settings are not used.", file=sys.stderr)
        return []
    text, fallbackEncoding = decodeSettingsFile(raw)
    if fallbackEncoding:
        print(f"Warning: {path} is not saved as UTF-8, so it was read as {fallbackEncoding}. Save it as UTF-8.", file=sys.stderr)
    args: List[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        # Each line on its own, so an unbalanced quote never swallows the lines after it.
        try:
            args += splitArgLine(line)
        except ValueError as error:
            print(f"Warning: {path} line {number}: {error}. Reading the line without quotes.", file=sys.stderr)
            args += line.split()
    return args


# A dash, a letter, then word characters: -0.5 and a quoted "-crf 20" are values, as argparse reads them.
OPTION_NAME = re.compile(r"--?[A-Za-z][\w-]*")


def knownSharedArgs(parser: argparse.ArgumentParser, sharedArgs: List[str], sharedFile: str) -> List[str]:
    """The shared settings file's arguments this version knows. Every installed version reads that
    file, so an option only a newer version knows is skipped with its values, with a warning. It is
    skipped before parsing: argparse would read an unknown -ab as the known -a with the value b."""
    kept: List[str] = []
    skipped: List[str] = []
    skipping = False
    for token in sharedArgs:
        name = token.split("=", 1)[0]
        if OPTION_NAME.fullmatch(name):
            skipping = name not in parser._option_string_actions
        (skipped if skipping else kept).append(token)
    if skipped:
        print(
            f"Warning: {sharedFile} has options this version does not know, so they are not used: {' '.join(skipped)}",
            file=sys.stderr,
        )
    return kept


SECRET_OPTIONS = ("--ytdl-password", "-yp")


def redactSecrets(args: List[str]) -> List[str]:
    """`args` with the values of secret options masked, for printing them to the console and log."""
    shown: List[str] = []
    for i, arg in enumerate(args):
        option, joined, _value = arg.partition("=")
        if joined and option in SECRET_OPTIONS:
            shown.append(f"{option}=***")
        elif i > 0 and args[i - 1] in SECRET_OPTIONS:
            shown.append("***")
        else:
            shown.append(arg)
    return shown


def getArgs() -> Tuple[Dict[str, Any], List[str], List[str], List[str], Dict[str, List[str]]]:
    parser = getArgParser()

    givenArgFiles: Optional[List[str]] = parser.parse_known_args()[0].argFiles
    argFiles: List[str] = defaultArgFiles() if givenArgFiles is None else givenArgFiles

    argv = sys.argv[1:]
    argsFromArgFiles: List[str] = []
    argsFromArgFilesMap: Dict[str, List[str]] = OrderedDict()
    for argFile in argFiles:
        argFilePath = Path(argFile)
        if argFilePath.is_file():
            args = readArgFile(argFilePath)
            if argFilePath.name == updates.SHARED_ARGS_FILE:
                args = knownSharedArgs(parser, args, argFile)
            argsFromArgFiles += args
            argsFromArgFilesMap[argFile] = args

    args, unknown = parser.parse_known_args(argsFromArgFiles + argv)
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
    return (
        f"""yt_clipper: {__version__}\nyt_dlp: {ytdl_bin_get_version(cp)}{getFfmpegVersion(cp.ffmpegPath)}"""
        f"\ncinematic solver: {banded_lapack.description()}"
    )


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
