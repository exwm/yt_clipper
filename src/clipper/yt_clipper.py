#!/usr/bin/env python3

import os
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
    ytdl_importer,
)
from clipper.clipper_types import ClipperState
from clipper.version import __version__
from clipper.ytc_logger import logger

UNKNOWN_PROPERTY = "unknown"


def main() -> None:
    cs = clipper_types.ClipperState()

    args, unknown, defArgs, argFiles = argparser.getArgs()

    cs.settings.update({"color_space": None, **args})
    ytc_settings.loadSettings(cs.settings)

    setupPaths(cs)

    ytc_logger.setUpLogger(cs)

    youtube_dl_alternative = cs.settings["youtubeDLAlternative"]
    ytdl_importer.import_youtube_dl_alternative(youtube_dl_alternative)

    logger.report(f"yt_clipper version: {__version__}")
    logger.report(
        f"{youtube_dl_alternative} version: {ytdl_importer.youtube_dl.version.__version__}"
    )
    logger.info("-" * 80)

    if defArgs:
        logger.notice(f"The following default arguments were read from {argFiles}:")
        logger.notice(defArgs)
        logger.info("-" * 80)
    elif argFiles:
        logger.notice(f"No uncommented arguments were found in {argFiles}")
        logger.info("-" * 80)

    if unknown:
        logger.notice(f"The following unknown arguments were provided and were ignored:")
        logger.notice(unknown)
        logger.info("-" * 80)

    enableMinterpEnhancements(cs)

    ytc_settings.getInputVideo(cs)

    ytc_settings.getGlobalSettings(cs)

    logger.info("-" * 80)
    if not cs.settings["preview"]:
        clip_maker.makeClips(cs)
    else:
        clip_maker.previewClips(cs)

    ytc_logger.printReport(cs)

    if cs.settings["notifyOnCompletion"]:
        util.notifyOnComplete(cs.settings["titleSuffix"])


def setupPaths(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    cp.clipsPath += f'/{settings["titleSuffix"]}'
    os.makedirs(f"{cp.clipsPath}/temp", exist_ok=True)
    settings["downloadVideoPath"] = f'{cp.clipsPath}/{settings["downloadVideoNameStem"]}'

    if getattr(sys, "frozen", False):
        cp.ffmpegPath = "./bin/ffmpeg"
        cp.ffprobePath = "./bin/ffprobe"
        cp.ffplayPath = "./bin/ffplay"
        if sys.platform == "win32":
            cp.ffmpegPath += ".exe"
            cp.ffprobePath += ".exe"
            cp.ffplayPath += ".exe"
        if sys.platform == "darwin":
            certifi_cacert_path = certifi.where()
            os.environ["SSL_CERT_FILE"] = certifi_cacert_path
            os.environ["REQUESTS_CA_BUNDLE"] = certifi_cacert_path


def enableMinterpEnhancements(cm: ClipperState) -> None:
    settings = cm.settings
    cp = cm.clipper_paths
    if settings["enableMinterpEnhancements"] and sys.platform == "win32":
        cp.ffmpegPath = "./bin/ffmpeg_ytc.exe"
        if not Path(cp.ffmpegPath).is_file():
            logger.critical(f"{cp.ffmpegPath} required for minterp enhancements not found.")
            sys.exit(1)
        else:
            logger.success(f"Found {cp.ffmpegPath}. Minterp enhancements enabled.")
    else:
        settings["enableMinterpEnhancements"] = False


if __name__ == "__main__":
    main()
