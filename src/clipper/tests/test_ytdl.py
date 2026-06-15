from typing import List

import pytest

from clipper import ytdl
from clipper.clipper_types import ClipperState


def buildArgs(**cookieSettings: str) -> List[str]:
    settings = {
        "format": "bv*+ba/b",
        "formatSort": ["res"],
        "downloadVideoPath": "out",
        "cookiefile": "",
        "cookiesFromBrowser": "",
        "username": "",
        "password": "",
        **cookieSettings,
    }
    return ytdl.ytdl_bin_get_args_base(ClipperState(settings=settings))


def assertFollows(args: List[str], flag: str, value: str) -> None:
    """Assert ``flag`` appears immediately followed by ``value``."""
    assert flag in args
    assert args[args.index(flag) + 1] == value


def test_cookiefile_passed_as_cookies() -> None:
    args = buildArgs(cookiefile="cookies.txt")
    assertFollows(args, "--cookies", "cookies.txt")
    assert "--cookies-from-browser" not in args


def test_cookies_from_browser_passed_through() -> None:
    args = buildArgs(cookiesFromBrowser="firefox:Default")
    assertFollows(args, "--cookies-from-browser", "firefox:Default")
    assert "--cookies" not in args


def test_neither_cookie_source_adds_no_cookie_flags() -> None:
    args = buildArgs()
    assert "--cookies" not in args
    assert "--cookies-from-browser" not in args


def test_both_cookie_sources_is_a_fatal_error() -> None:
    # yt-dlp rejects the combination, so we exit before invoking it.
    with pytest.raises(SystemExit):
        buildArgs(cookiefile="cookies.txt", cookiesFromBrowser="firefox")
