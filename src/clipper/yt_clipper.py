#!/usr/bin/env python3

import os
import shlex
import sys
from pathlib import Path

import certifi

from clipper import (
    argparser,
    clip_maker,
    clipper_types,
    util,
    ytc_logger,
    ytc_settings,
)
from clipper.clipper_types import ClipperPaths, ClipperState
from clipper.ffmpeg_version import getFfmpegVersion
from clipper.version import __version__
from clipper.ytc_logger import Subsystem, make_subsystem_logger
from clipper.ytdl import ytdl_bin_get_version

logger = make_subsystem_logger(Subsystem.CLI)

UNKNOWN_PROPERTY = "unknown"


def main() -> None:
    cs = clipper_types.ClipperState()

    args, unknown, argsFromArgFiles, argFiles, argsFromArgFilesMap = argparser.getArgs()

    setupClipperPaths(cs)

    cs.settings.update({"color_space": None, **args})
    ytc_settings.loadSettingsFromMarkersJson(cs.settings)

    if cs.settings["printVersions"]:
        print(argparser.getDepVersionsString(cs.clipper_paths))
        sys.exit(0)

    setupOutputPaths(cs)

    ytc_logger.setUpLogger(cs)

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
        f"yt-dlp version: {ytdl_bin_get_version(cs.clipper_paths)}",
    )
    logger.report(f"{getFfmpegVersion(cs.clipper_paths.ffmpegPath)}", extra={"highlighter": None})
    logger.rule()

    logger.debug(f"The following arguments were read from the command line {sys.argv[1:]}:")

    if argsFromArgFiles:
        logger.notice(f"The following default arguments were read from {argFiles}:")
        logger.notice(argsFromArgFilesMap)
        logger.rule(title="Setup")
    elif argFiles:
        logger.notice(f"No uncommented arguments were found in {argFiles}")
        logger.rule(title="Setup")

    if unknown:
        logger.error(
            f"The following unknown arguments were provided and were ignored: {unknown}",
        )
        sys.exit(1)

    enableMinterpEnhancements(cs)

    # Ctrl+C during any of setup / clipping bubbles up here as
    # ``KeyboardInterrupt``. We catch it at the top level so the
    # operator gets a clean ``cancelled by user`` NOTICE plus the
    # partial timing + summary report (showing what got done before
    # the interrupt) instead of a Python traceback. The pair_context
    # contextvar is still set on the current pair so the chip on the
    # NOTICE line names which pair was being worked on.
    exit_code = 0
    try:
        ytc_settings.getInputVideo(cs)
        ytc_settings.getGlobalSettings(cs)

        logger.rule(title="Clipping")
        if not cs.settings["preview"]:
            clip_maker.makeClips(cs)
        else:
            clip_maker.previewClips(cs)
    except KeyboardInterrupt:
        logger.notice("cancelled by user (Ctrl+C)")
        exit_code = 130  # standard shell convention for SIGINT termination

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


def setupClipperPaths(cs: ClipperState) -> None:
    settings = cs.settings
    cp: ClipperPaths = cs.clipper_paths

    ffmpeg_tools_dir = settings.get("ffmpegToolsDir")

    is_frozen_release = getattr(sys, "frozen", False)

    if is_frozen_release or ffmpeg_tools_dir:
        ffmpeg_tools_dir = ffmpeg_tools_dir if ffmpeg_tools_dir else "./bin"
        cp.ffmpegPath = f"{ffmpeg_tools_dir}/ffmpeg"
        cp.ffprobePath = f"{ffmpeg_tools_dir}/ffprobe"
        cp.ffplayPath = f"{ffmpeg_tools_dir}/ffplay"

        if sys.platform == "win32":
            cp.ffmpegPath += ".exe"
            cp.ffprobePath += ".exe"
            cp.ffplayPath += ".exe"

    ytdl_dir = settings.get("ytdlDir")

    if is_frozen_release or ytdl_dir:
        ytdl_dir = ytdl_dir if ytdl_dir else "./bin"

        cp.ytdlPath = f"{ytdl_dir}/yt-dlp"

        if sys.platform == "darwin":
            cp.ytdlPath += "_macos"

        if sys.platform == "win32":
            cp.ytdlPath += ".exe"

    if is_frozen_release:
        video2x_dir = "./bin/video2x"
        cp.video2xPath = f"{video2x_dir}/video2x"

        if sys.platform == "win32":
            cp.video2xPath += ".exe"

    cp.video2xPath = shlex.quote(cp.video2xPath)
    cp.ffmpegPath = shlex.quote(cp.ffmpegPath)
    cp.ffprobePath = shlex.quote(cp.ffprobePath)
    cp.ffplayPath = shlex.quote(cp.ffplayPath)
    cp.ytdlPath = shlex.quote(cp.ytdlPath)

    if sys.platform == "darwin":
        certifi_cacert_path = certifi.where()
        os.environ["SSL_CERT_FILE"] = certifi_cacert_path
        os.environ["REQUESTS_CA_BUNDLE"] = certifi_cacert_path


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
        cp.ffmpegPath = "./bin/ffmpeg_ytc.exe"
        if not Path(cp.ffmpegPath).is_file():
            logger.critical(
                f"{cp.ffmpegPath} required for minterp enhancements not found.",
            )
            sys.exit(1)
        else:
            logger.success(f"Found {cp.ffmpegPath}. Minterp enhancements enabled.")
    else:
        settings["enableMinterpEnhancements"] = False


if __name__ == "__main__":
    main()
