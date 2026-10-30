"""The pages a scenario can run on: the dev site or a real YouTube video. Each host opens its page,
injects or loads the userscript, and names the platform hooks scenarios need."""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from .dev_site import require_urls

if TYPE_CHECKING:
    from pathlib import Path

    from playwright.sync_api import Page


@dataclass(frozen=True)
class Host:
    name: str
    # Selectors for the platform hooks tests read (see VideoPlatformSelectors in platforms.ts).
    player: str
    crop_hook: str
    controls: str


DEV_SITE_HOST = Host(
    name="dev-site",
    player="#my-video",
    crop_hook="#my-video",
    controls=".vjs-control-bar",
)
YOUTUBE_HOST = Host(
    name="youtube",
    player="#movie_player",
    crop_hook=".html5-video-container",
    controls=".ytp-chrome-bottom",
)


def open_dev_site(page: "Page", url: str, video_name: str) -> None:
    page.goto(url)
    page.evaluate(
        "name => { document.querySelector('video').src = name; finalizeVideoLoad(true); }",
        video_name,
    )
    page.wait_for_function("document.querySelector('video').readyState >= 2")


VIDEO_LOADED = "document.querySelector('video')?.duration > 0"
YOUTUBE_LOAD_TIMEOUT_MS = 60_000


def open_youtube(page: "Page", youtube_url: str, userscript: "Path") -> None:
    """Open a YouTube video and inject the userscript the way Tampermonkey would: the @require
    libraries, then the bundle. The bundle is inlined (Chrome blocks a public page from loading
    from localhost) and named via sourceURL, so its errors are identifiable in stack traces."""
    page.goto(youtube_url, wait_until="domcontentloaded")
    for label in (
        "Reject all",
        "Reject the use of cookies and other data for the purposes described",
    ):
        button = page.get_by_role("button", name=label)
        if button.count():
            button.first.click()
            break
    try:
        page.wait_for_function(VIDEO_LOADED, timeout=YOUTUBE_LOAD_TIMEOUT_MS)
    except PlaywrightTimeoutError:
        # YouTube occasionally stalls a page load; a reload usually recovers it.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(VIDEO_LOADED, timeout=YOUTUBE_LOAD_TIMEOUT_MS)
    # YouTube renders the video before its page shell; the userscript only waits for the video, so
    # activating before the shell exists runs its setup against missing hook elements.
    for shell_selector in ("ytd-watch-flexy", "#below", ".ytp-progress-bar", ".ytp-right-controls"):
        page.wait_for_selector(shell_selector, state="attached", timeout=30_000)
    page.evaluate("() => { const v = document.querySelector('video'); v.muted = true; v.pause(); }")
    # The tests don't depend on the video's resolution (crop values use the userscript's own crop
    # resolution), so stream the lowest quality: it buffers and seeks faster on far less bandwidth.
    page.evaluate(
        "() => document.querySelector('#movie_player')?.setPlaybackQualityRange?.('tiny', 'tiny')",
    )
    # Activation waits for the page to finish loading; pressing before that is accepted but slow.
    page.wait_for_function("document.readyState === 'complete'", timeout=YOUTUBE_LOAD_TIMEOUT_MS)
    page.add_script_tag(content="window.unsafeWindow = window;")
    for url in require_urls(userscript):
        page.add_script_tag(url=url)
    bundle = userscript.read_text(encoding="utf-8")
    page.add_script_tag(content=f"{bundle}\n//# sourceURL=yt_clipper.js")


# The userscript marks the video once it has found it, just before it starts taking hotkeys.
MARKUP_READY = "!!document.querySelector('video.yt-clipper-video')"
MARKUP_ACTIVE = "!!document.querySelector('#markers-div')"
# Activation waits for the page to finish loading, so an accepted press can take a while.
ACTIVATION_TIMEOUT_MS = 15_000


def activate_markup(page: "Page") -> None:
    """Press the activation chord once the userscript takes hotkeys, and wait for the markup."""
    # Checked every animation frame: `wait_for_selector` backs off to 0.5 s between checks.
    page.wait_for_function(MARKUP_READY, timeout=ACTIVATION_TIMEOUT_MS)
    page.keyboard.press("Alt+Shift+KeyA")
    try:
        page.wait_for_function(MARKUP_ACTIVE, timeout=ACTIVATION_TIMEOUT_MS)
    except PlaywrightTimeoutError as timeout:
        raise RuntimeError(
            "markup did not activate (no #markers-div after Alt+Shift+A)"
        ) from timeout
