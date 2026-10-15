"""The pages a scenario can run on: the dev site or a real YouTube video. Each host opens its page,
injects or loads the userscript, and names the platform hooks scenarios need."""

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from .dev_site import require_urls

if TYPE_CHECKING:
    from pathlib import Path

    from playwright.sync_api import ConsoleMessage, Page


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


ACTIVATION_PRESSES = 20
# How long an accepted press may take to activate: activation waits for the page to finish loading,
# and pressing again meanwhile would toggle the markup back off.
ACTIVATION_WAIT_MS = 6000
NOT_READY_LOG = "not yet ready to process hotkeys"


def activate_markup(page: "Page") -> None:
    """Press the activation chord until the markup activates. Until the userscript has found the
    video it ignores hotkeys (logging that it is not ready) rather than toggling, so a press it
    logged as ignored is retried at once instead of waiting out a full activation."""
    not_ready_logs: list[str] = []

    def on_console(message: "ConsoleMessage") -> None:
        if NOT_READY_LOG in message.text:
            not_ready_logs.append(message.text)

    page.on("console", on_console)
    try:
        for _ in range(ACTIVATION_PRESSES):
            ignored_before = len(not_ready_logs)
            page.keyboard.press("Alt+Shift+KeyA")
            deadline = time.monotonic() + ACTIVATION_WAIT_MS / 1000
            while time.monotonic() < deadline:
                if page.locator("#markers-div").count():
                    return
                if len(not_ready_logs) > ignored_before:
                    break  # ignored: not ready yet, so press again
                page.wait_for_timeout(50)
            page.wait_for_timeout(200)  # the userscript polls for the video every 200ms
    finally:
        page.remove_listener("console", on_console)
    raise RuntimeError("markup did not activate (no #markers-div after Alt+Shift+A)")
