import sys

from clipper.clipper_types import KnownPlatform, Settings
from clipper.ytc_logger import logger


def getFfmpegHeaders(platform: str) -> str:
    if platform == KnownPlatform.afreecatv.name:
        return " ".join(
            (
                f"-headers 'Referer: https://play.afreecatv.com/'",
                f"-headers 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:75.0) Gecko/20100101 Firefox/75.0'",
            ),
        )

    return ""


def getVideoPageURL(settings: Settings, platform: str, videoID: str) -> str:
    if platform == KnownPlatform.youtube.name:
        return f"https://www.youtube.com/watch?v={videoID}"
    if platform == KnownPlatform.vlive.name:
        return f"https://www.vlive.tv/video/{videoID}"
    if platform == KnownPlatform.naver_now_watch.name:
        return f"https://now.naver.com/watch/{videoID}"
    if platform == KnownPlatform.weverse.name:
        return settings["videoUrl"]
    if platform == KnownPlatform.naver_tv.name:
        return f"https://tv.naver.com/v/{videoID}"
    if platform == KnownPlatform.afreecatv.name:
        return settings["videoUrl"]
    if platform == KnownPlatform.ytc_generic.name:
        if settings["inputVideo"]:
            return "unknown_video_url_for_input_video"
        logger.warning("Video page URL not found and no local input video was provided.")
        logger.warning(
            "Enter a video page URL at the prompt below OR rerun with an input video (e.g. by using the input video helper script).",
        )
        videoPageUrl = input("Please enter a compatible video page URL for processing markers: ")
        if videoPageUrl:
            return videoPageUrl

        logger.fatal(f"Neither video page URL nor input video provided.")
        sys.exit(1)

    logger.fatal(f"Unknown platform: {platform}")
    sys.exit(1)
