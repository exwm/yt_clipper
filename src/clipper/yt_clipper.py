#!/usr/bin/env python3

import io
import os
import shlex
import subprocess
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import certifi

from clipper import (
    argparser,
    argparser_suggestions,
    clip_maker,
    clipper_types,
    updates,
    util,
    ytc_logger,
    ytc_settings,
)
from clipper.clipper_types import ClipperPaths, ClipperState
from clipper.ffmpeg_version import getFfmpegVersion
from clipper.log_helpers import LogPath
from clipper.version import __version__
from clipper.ytc_logger import Subsystem, make_subsystem_logger
from clipper.ytdl import ytdl_bin_get_version

logger = make_subsystem_logger(Subsystem.CLI)
# The programs a release bundles in bin/, by file name prefix.
BUNDLED_TOOLS = ("ffmpeg", "ffprobe", "ffplay", "yt-dlp", "video2x", "deno")

UNKNOWN_PROPERTY = "unknown"

# Frozen release layout. video2x loads the ffmpeg DLLs from its own folder, so it shares video-tools.
VIDEO_TOOLS_DIR = "./bin/video-tools"
YTDL_DIR = "./bin/yt-dlp"
# The readme's manual install location. Upstream video2x brings its own ffmpeg DLLs.
MANUAL_VIDEO2X_DIR = "./bin/video2x"


def useUtf8Output() -> None:
    """Redirected output otherwise uses the Windows code page (e.g. cp1252), which cannot encode
    the log's box-drawing characters, so the first log rule crashes the run."""
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper) and stream.encoding.lower() != "utf-8":
            stream.reconfigure(encoding="utf-8", errors="replace")


def printAndExitIfAsked(cs: clipper_types.ClipperState) -> None:
    """--print-versions and --check-for-updates print their answer and exit without clipping."""
    if cs.settings["printVersions"]:
        print(argparser.getDepVersionsString(cs.clipper_paths))
        sys.exit(0)
    if cs.settings["checkForUpdates"]:
        print(updates.checkForUpdates())
        sys.exit(0)


def main() -> None:
    useUtf8Output()
    cs = clipper_types.ClipperState()

    args, unknown, argsFromArgFiles, argFiles, argsFromArgFilesMap = argparser.getArgs()

    setupClipperPaths(cs, args)

    cs.settings.update({"color_space": None, **args})

    printAndExitIfAsked(cs)

    # The logger needs only the command line and the markers JSON's file name, so it is set up
    # before the file is read, and loading problems are logged like the rest of the run.
    ytc_settings.setMarkersFileNames(cs.settings)
    setupOutputPaths(cs)
    ytc_logger.setUpLogger(cs)

    ytc_settings.loadSettingsFromMarkersJson(cs.settings)

    logger.debug(f"clipper paths set up: {cs.clipper_paths}")

    # Absolute-date anchor at the top of the run. Per-line
    # timestamps are HH:MM:SS only (see DATE_FORMAT in ytc_logger);
    # this line gives the on-disk log file a date so a postmortem
    # days later can recover the calendar context.
    from datetime import datetime, timezone

    logger.report(
        f"run started at {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}",
    )
    logger.report(f"yt_clipper version: {__version__}")
    logger.report(
        f"yt-dlp version: {describeYtdlVersion(cs.clipper_paths)}",
    )
    logger.report(f"{getFfmpegVersion(cs.clipper_paths.ffmpegPath)}", extra={"highlighter": None})
    if cs.clipper_paths.logFilePath:
        logger.report(f"log file: {LogPath(cs.clipper_paths.logFilePath)}")
    logger.rule()

    logger.debug(f"The following arguments were read from the command line {sys.argv[1:]}:")

    if argsFromArgFiles:
        logger.notice(f"The following default arguments were read from {argFiles}:")
        logger.notice(argsFromArgFilesMap)
        logger.rule(title="Setup")
    elif argFiles:
        logger.notice(f"No uncommented arguments were found in {argFiles}")
        logger.rule(title="Setup")
    try:
        updates.showStartupNotices()
    except Exception as error:
        # The notices only help; a run never stops over them.
        logger.debug(f"Skipped the startup notices: {error!r}")

    if unknown:
        parser = argparser.getArgParser()
        # Usage block first, then the error: matches the layout argparse uses
        # for the errors it raises on its own (e.g. single-dash bundling).
        parser.print_usage(sys.stderr)
        optionGroups = argparser_suggestions.getOptionGroups(parser)
        logger.error(argparser_suggestions.formatUnknownArgumentsError(unknown, optionGroups))
        sys.exit(1)

    enableMinterpEnhancements(cs)

    exit_code, failedClips = runClipping(cs)

    # Emit per-stage timing block before the Summary Report so it
    # lands in the report stream and the on-disk log file alongside
    # the other aggregate outputs. A second Ctrl+C during cleanup
    # would be confusing; suppress and continue to printReport.
    from clipper.log_helpers import render_timing_summary

    try:
        timing_block = render_timing_summary()
        if timing_block:
            logger.report(timing_block)
        ytc_logger.printReport(cs)
    except KeyboardInterrupt:
        pass

    if exit_code != 0:
        sys.exit(exit_code)

    if cs.settings["notifyOnCompletion"]:
        util.notifyOnComplete(cs.settings["titleSuffix"])

    # A failed clip makes the whole run fail, so scripts and scheduled runs can tell.
    if failedClips:
        logger.error(f"Failed to generate: {', '.join(failedClips)}.")
        sys.exit(1)


def describeYtdlVersion(cp: ClipperPaths) -> str:
    """yt-dlp's version for the log; a local input video needs no yt-dlp, so a missing one only
    shows here."""
    try:
        return ytdl_bin_get_version(cp)
    except (OSError, subprocess.CalledProcessError) as error:
        return f"unavailable ({error})"


# On Windows a program that cannot start raises with no file name, unlike a file that cannot open:
# not found, path not found, access denied, not a program, not for this Windows, blocked by
# antivirus or group policy, or by Smart App Control.
CANNOT_START_WINERRORS = {2, 3, 5, 193, 216, 225, 226, 1260, 4551}


def describeOsError(error: OSError) -> str:
    """The message for a tool that cannot start (missing, or blocked by antivirus or a firewall) or a
    file that cannot be opened."""
    name = Path(str(error.filename)).name if error.filename else ""
    hint = " Check that it is in the bin folder." if name.startswith(BUNDLED_TOOLS) else ""
    cannotStart = not name and getattr(error, "winerror", None) in CANNOT_START_WINERRORS
    if name:
        return f"{name}: {error.strerror or error}.{hint}"
    if cannotStart:
        # Some of these messages name the program as a literal %1.
        reason = str(error.strerror or error).replace("%1", "the program")
        return (
            f"A program the clipper runs could not start: {reason}. "
            "Check that ffmpeg, ffprobe and yt-dlp are in the bin folder."
        )
    return f"{error.strerror or error}."


def runClipping(cs: ClipperState) -> tuple[int, list[str]]:
    """Get the video and make the clips. Return the exit code and the clips that failed."""
    # Ctrl+C during any of setup / clipping bubbles up here as
    # ``KeyboardInterrupt``. We catch it at the top level so the
    # operator gets a clean ``cancelled by user`` NOTICE plus the
    # partial timing + summary report (showing what got done before
    # the interrupt) instead of a Python traceback. The pair_context
    # contextvar is still set on the current pair so the chip on the
    # NOTICE line names which pair was being worked on.
    try:
        ytc_settings.getInputVideo(cs)
        ytc_settings.getGlobalSettings(cs)

        logger.rule(title="Clipping")
        if cs.settings["preview"]:
            clip_maker.previewClips(cs)
            return 0, []
        return 0, clip_maker.makeClips(cs)
    except KeyboardInterrupt:
        logger.critical("cancelled by user (Ctrl+C)")
        return 130, []  # standard shell convention for SIGINT termination
    except OSError as error:
        logger.error(describeOsError(error))
        return 1, []
    except subprocess.CalledProcessError as error:
        # The tool printed its own error above, so name it instead of showing a traceback.
        command = error.cmd if isinstance(error.cmd, (list, tuple)) else shlex.split(str(error.cmd))
        logger.error(
            f"{Path(command[0]).name} failed with exit code {error.returncode}. See its messages above.",
        )
        return 1, []
    except EOFError:
        # A prompt read the end of input: no one can answer, for example in a scheduled run.
        logger.error("No answer to the prompt above, so the clipper script stopped.")
        return 1, []
    except Exception:
        # Log the traceback so the run's log file has it for a bug report, and still print the report.
        logger.error("Unexpected error. Please report it with this run's log file.", exc_info=True)
        return 1, []


def bundledDir(relativeDir: str) -> str:
    """A release's own tools folder, whatever folder it runs from, as its settings files are."""
    if getattr(sys, "frozen", False):
        return str(Path(sys.executable).resolve().parent / relativeDir)
    return relativeDir


def setupClipperPaths(cs: ClipperState, cli_args: Mapping[str, Any]) -> None:
    """Tool paths decide which programs run, so they come only from the command line and arg files."""
    cp: ClipperPaths = cs.clipper_paths

    ffmpeg_tools_dir = cli_args.get("ffmpegToolsDir")

    is_frozen_release = getattr(sys, "frozen", False)

    if is_frozen_release or ffmpeg_tools_dir:
        ffmpeg_tools_dir = ffmpeg_tools_dir if ffmpeg_tools_dir else bundledDir(VIDEO_TOOLS_DIR)
        cp.ffmpegPath = f"{ffmpeg_tools_dir}/ffmpeg"
        cp.ffprobePath = f"{ffmpeg_tools_dir}/ffprobe"
        cp.ffplayPath = f"{ffmpeg_tools_dir}/ffplay"

        if sys.platform == "win32":
            cp.ffmpegPath += ".exe"
            cp.ffprobePath += ".exe"
            cp.ffplayPath += ".exe"

    ytdl_dir = cli_args.get("ytdlDir")

    if is_frozen_release or ytdl_dir:
        ytdl_dir = ytdl_dir if ytdl_dir else bundledDir(YTDL_DIR)

        cp.ytdlPath = f"{ytdl_dir}/yt-dlp"

        if sys.platform == "darwin":
            cp.ytdlPath += "_macos"

        if sys.platform == "win32":
            cp.ytdlPath += ".exe"

    if is_frozen_release:
        cp.video2xPath = findVideo2x(".exe" if sys.platform == "win32" else "")

    cp.video2xPath = shlex.quote(cp.video2xPath)
    cp.ffmpegPath = shlex.quote(cp.ffmpegPath)
    cp.ffprobePath = shlex.quote(cp.ffprobePath)
    cp.ffplayPath = shlex.quote(cp.ffplayPath)
    cp.ytdlPath = shlex.quote(cp.ytdlPath)

    if sys.platform == "darwin":
        certifi_cacert_path = certifi.where()
        os.environ["SSL_CERT_FILE"] = certifi_cacert_path
        os.environ["REQUESTS_CA_BUNDLE"] = certifi_cacert_path


def findVideo2x(exe_suffix: str) -> str:
    """The bundled video2x, else a manual install, else video2x on the system PATH."""
    for video2x_dir in (bundledDir(VIDEO_TOOLS_DIR), bundledDir(MANUAL_VIDEO2X_DIR)):
        video2x_path = f"{video2x_dir}/video2x{exe_suffix}"
        if Path(video2x_path).is_file():
            return video2x_path
    return "video2x"


def setupOutputPaths(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths
    cp.clipsPath += f"/{settings['titleSuffix']}"

    os.makedirs(f"{cp.clipsPath}/temp", exist_ok=True)
    settings["downloadVideoPath"] = f"{cp.clipsPath}/{settings['downloadVideoNameStem']}"


def enableMinterpEnhancements(cm: ClipperState) -> None:
    settings = cm.settings
    cp = cm.clipper_paths
    if settings["enableMinterpEnhancements"] and sys.platform == "win32":
        ytcPath = f"{bundledDir(VIDEO_TOOLS_DIR)}/ffmpeg_ytc.exe"
        if not Path(ytcPath).is_file():
            logger.critical(
                f"{ytcPath} required for minterp enhancements not found.",
            )
            sys.exit(1)
        else:
            cp.ffmpegPath = shlex.quote(ytcPath)
            logger.success(f"Found {ytcPath}. Minterp enhancements enabled.")
    else:
        settings["enableMinterpEnhancements"] = False


if __name__ == "__main__":
    main()
