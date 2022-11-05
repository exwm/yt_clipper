import sys

from clipper.util import is_module_available
from clipper.ytc_logger import logger

YOUTUBE_DL_ALTERNATIVE_YT_DLP = "yt_dlp"
YOUTUBE_DL_ALTERNATIVE_YOUTUBE_DL = "youtube_dl"
SUPPORTED_YOUTUBE_DL_ALTERNATIVES = [
    YOUTUBE_DL_ALTERNATIVE_YT_DLP,
    YOUTUBE_DL_ALTERNATIVE_YOUTUBE_DL,
]


def get_available_youtube_dl_alternative() -> str:
    if is_module_available(YOUTUBE_DL_ALTERNATIVE_YT_DLP):
        return YOUTUBE_DL_ALTERNATIVE_YT_DLP

    if is_module_available(YOUTUBE_DL_ALTERNATIVE_YOUTUBE_DL):
        return YOUTUBE_DL_ALTERNATIVE_YOUTUBE_DL

    print(
        f"No supported youtube_dl alternatives available. SUPPORTED_YOUTUBE_DL_ALTERNATIVES={SUPPORTED_YOUTUBE_DL_ALTERNATIVES}'"
    )
    print("Exiting...")
    sys.exit(1)


def import_youtube_dl_alternative(youtube_dl_alternative: str):
    if is_module_available(youtube_dl_alternative):
        if youtube_dl_alternative == "yt_dlp":
            import yt_dlp as youtube_dl  # pylint: disable=redefined-outer-name
        else:
            import youtube_dl
    else:
        logger.fatal(f"Could not find requested yotube_dl alternative '{youtube_dl_alternative}'")
        logger.fatal("Exiting...")
        sys.exit(1)

    return youtube_dl


def import_available_youtube_dl_alternative():
    available_youtube_dl_alternative = get_available_youtube_dl_alternative()
    youtube_dl_alternative = import_youtube_dl_alternative(available_youtube_dl_alternative)
    return youtube_dl_alternative


def set_youtube_dl_alternative(youtube_dl_alternative: str):
    global youtube_dl  # pylint: disable=global-statement
    youtube_dl = import_youtube_dl_alternative(youtube_dl_alternative)


youtube_dl = import_available_youtube_dl_alternative()
