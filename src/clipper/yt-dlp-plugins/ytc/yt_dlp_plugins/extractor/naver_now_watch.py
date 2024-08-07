# ruff: noqa
# ⚠ Don't use relative imports
# ℹ️ If you need to import from another plugin
# from yt_dlp_plugins.extractor.example import ExamplePluginIE
from urllib.parse import parse_qs

from yt_dlp.extractor.naver import NaverBaseIE
from yt_dlp.utils import (
    ExtractorError,
    dict_get,
    traverse_obj,
    unified_strdate,
    unified_timestamp,
)

# ℹ️ Instructions on making extractors can be found at:
# 🔗 https://github.com/yt-dlp/yt-dlp/blob/master/CONTRIBUTING.md#adding-support-for-a-new-site


# ⚠ The class name must end in "IE"


class NaverNowWatchIE(NaverBaseIE):
    IE_NAME = "navernowwatch"
    # Video ids seem to be exactly 12 characters for now but this hasn't been thoroughly tested
    # so a wider id length is allowed here
    _VALID_URL = r"https?://now\.naver\.com/watch/(?P<id>[0-9A-Za-z_-]{10,14})"
    _API_URL = "https://apis.naver.com/now_web2/now_web_api/v1/content"
    _TESTS = [
        {
            "url": "https://now.naver.com/watch/ELt-oy2EfLHs",
            "md5": "f6dc239cc08d7ac0d4a3da0794442559",
            "info_dict": {
                "id": "ELt-oy2EfLHs",
                "title": "[NPOP EP.14] VIXX 외의 다른 건 Forget🌟 l 2023.11.29",
                "ext": "mp4",
                "thumbnail": r"re:^https?://.*\.jpg",
                "timestamp": 1701159669,
                "upload_date": "20231128",
                "uploader_id": "npop",
                "view_count": int,
                # The channelUrl from the API is https://m.tv.naver.com/npop but this redirects to https://now.naver.com/s/npop
                "uploader_url": "https://m.tv.naver.com/npop",
                "uploader": "NPOP (엔팝)",
                "duration": 1268,
                "like_count": int,
                "description": "md5:f8b7df218f83ad0e9e941f0be949e832",
            },
            "params": {
                "noplaylist": True,
            },
        },
        {
            # https://now.naver.com/s/now.4759?shareReplayId=26331132#replay= now redirects to this url
            "url": "https://now.naver.com/watch/MLrCxZEjX8zE",
            "md5": "e05854162c21c221481de16b2944a0bc",
            "info_dict": {
                "id": "MLrCxZEjX8zE",
                "title": "아이키X노제💖꽁냥꽁냥💖(1)",
                "ext": "mp4",
                "thumbnail": r"re:^https?://.*\.jpg",
                "timestamp": 1650369600,
                "upload_date": "20220419",
                "uploader_id": "now.4759",
                "view_count": int,
                "uploader_url": "https://now.naver.com/s/now.4759",
                "uploader": "아이키의 떰즈업",
                "duration": 3173,
                "like_count": int,
                "description": "md5:c508c32ae670c583e3ae5bb4f1824dbc",
            },
            "params": {
                "noplaylist": True,
            },
        },
    ]

    def _get_video_info_api_call_qs(self, api_url):
        import base64
        import hashlib
        import hmac
        import time

        # key from https://now.naver.com/_next/static/chunks/pages/_app-c8bbb02b32a20c3d.js (search for 'md=')
        key = b"nbxvs5nwNG9QKEWK0ADjYA4JZoujF4gHcIwvoCxFTPAeamq5eemvt5IWAYXxrbYM"

        msgpad = int(time.time() * 1000)
        # algorithm same as in yt_dlp/extractor/weverse.py::WeverseBaseIE._call_api
        md = base64.b64encode(
            hmac.HMAC(
                key, f"{api_url[:255]}{msgpad}".encode(), digestmod=hashlib.sha1
            ).digest(),
        ).decode()
        qs = parse_qs(f"msgpad={msgpad}&md={md}")
        return qs

    def _real_extract(self, url):
        video_id = self._match_id(url)
        qs = self._get_video_info_api_call_qs(api_url=f"{self._API_URL}/{video_id}")

        video_info_response = self._download_json(
            f"{self._API_URL}/{video_id}",
            video_id,
            query=qs,
            note=f"Downloading JSON video info for video id {video_id}",
        )

        if not video_info_response:
            raise ExtractorError(
                "Got unexpected or empty video info JSON response.", expected=True
            )

        video_info = traverse_obj(video_info_response, ("result", "result"))
        if not video_info:
            raise ExtractorError("Got unexpected video info JSON data.", expected=True)

        video_clip_info = traverse_obj(video_info, "clip")
        if not video_clip_info:
            raise ExtractorError(
                "Could not find video clip info with Naver CDN video id in video info JSON.",
                expected=True,
            )

        key = traverse_obj(video_info, ("play", "inKey"))
        if not key:
            raise ExtractorError(
                "Could not find API key in video info JSON.", expected=True
            )

        vid = traverse_obj(video_clip_info, "videoId")
        if not vid:
            raise ExtractorError(
                "Could not find Naver CDN video id in video clip info.",
                expected=True,
            )

        info = self._extract_video_info(video_id, vid, key)

        info.update(
            {
                "title": video_clip_info.get("title"),
                # episodeStartDateTime seems to be the start time for a live stream and registerDateTime the end time
                # registerDateTime seems to be the upload time for vods
                "upload_date": unified_strdate(
                    dict_get(
                        video_clip_info, ("episodeStartDateTime", "registerDateTime")
                    ),
                ),
                "timestamp": unified_timestamp(
                    dict_get(
                        video_clip_info, ("episodeStartDateTime", "registerDateTime")
                    ),
                ),
                # channelId and channelUrl in the video_clip_info are not always accurate
                "uploader_id": traverse_obj(video_info, ("channel", "channelId")),
                "uploader_url": traverse_obj(video_info, ("channel", "channelUrl")),
                "description": video_clip_info.get("description"),
                "duration": traverse_obj(video_clip_info, "playTime"),
                "like_count": traverse_obj(video_clip_info, "likeItCount"),
            },
        )
        return info
