"""A page on a simulated display of a chosen refresh rate, for checks that depend on how many
refreshes a video frame holds (`@pytest.mark.display_rate(hz)`).

chromium-headless-shell draws a page created with begin frame control only when told to, so a thread
here sends it `HeadlessExperimental.beginFrame` on an exact grid of `1000 / hz` ms, over its own
DevTools connection: the test's sync Playwright calls block, and a display must not pause with them.
Video playback and the frame the compositor picks per refresh then follow the simulated rate.
"""

import contextlib
import ctypes
import functools
import json
import math
import re
import sys
import tempfile
import threading
import time
import urllib.request
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from websockets.sync.client import connect

if TYPE_CHECKING:
    from playwright.sync_api import Page, Playwright, Route
    from websockets.sync.client import ClientConnection

# Begin frame control alone stalls once the marker pair editor opens: a begin frame never finishes.
# Deterministic mode adds the switches that keep every stage of a frame able to finish.
BEGIN_FRAME_ARGS = ["--deterministic-mode"]
# How long before a tick the driver stops sleeping and spins, to land on the grid.
SPIN_SECONDS = 0.0005
# A begin frame unanswered this long has stalled the page.
STALL_SECONDS = 5


@dataclass
class DisplayStats:
    ticks: int = 0
    # Ticks never sent, as a late refresh ran past them.
    missed: int = 0
    # The tick whose begin frame never finished, which closes the page.
    stalled_at: int | None = None


@contextlib.contextmanager
def simulated_display(
    playwright: "Playwright", hz: float, context_options: dict
) -> Iterator[tuple["Page", DisplayStats]]:
    """A page in chromium-headless-shell refreshed `hz` times a second, and the driver's counts."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
        context = playwright.chromium.launch_persistent_context(
            profile,
            channel="chromium-headless-shell",
            headless=True,
            # Port 0 picks a free port and writes it to DevToolsActivePort in the profile.
            args=[*BEGIN_FRAME_ARGS, "--remote-debugging-port=0"],
            **context_options,
        )
        try:
            # Python fetches the CDN libraries: a firewall that lets only known programs out can block
            # the shell and Playwright's driver.
            context.route(re.compile(r"^https?://(?!localhost[:/])"), fetch_for_the_page)
            blank = context.pages[0]
            # Frame control is set when a target is created; Playwright's own pages lack it.
            viewport = context_options.get("viewport", {})
            with context.expect_page() as created:
                target = context.new_cdp_session(blank).send(
                    "Target.createTarget",
                    {"url": "about:blank", "enableBeginFrameControl": True, **viewport},
                )
            page = created.value
            blank.close()
            port = (Path(profile) / "DevToolsActivePort").read_text().split()[0]
            url = f"ws://127.0.0.1:{port}/devtools/page/{target['targetId']}"
            stats = DisplayStats()
            stop = threading.Event()
            driver = threading.Thread(target=drive, args=(url, hz, stop, stats), daemon=True)
            driver.start()
            try:
                yield page, stats
            finally:
                stop.set()
                driver.join()
        finally:
            context.close()


def fetch_for_the_page(route: "Route") -> None:
    status, content_type, body = fetch(route.request.url)
    # The page loads the libraries with crossorigin, which needs the header the CDN sends to browsers.
    headers = {"content-type": content_type, "access-control-allow-origin": "*"}
    route.fulfill(status=status, headers=headers, body=body)


@functools.cache
def fetch(url: str) -> tuple[int, str, bytes]:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.status, response.headers.get_content_type(), response.read()


def drive(url: str, hz: float, stop: threading.Event, stats: DisplayStats) -> None:
    """Send a begin frame per tick of a `hz` grid until `stop`, each with its tick's time."""
    interval = 1 / hz
    if sys.platform == "win32":
        # Sleeps otherwise round to the 15.6 ms system tick.
        ctypes.windll.winmm.timeBeginPeriod(1)
    try:
        with connect(url, max_size=None) as devtools:
            start = time.perf_counter()
            tick = 0
            while not stop.is_set():
                # A refresh not finished by its next vsync misses the vsyncs it ran into, as on a
                # real display: the next one is the first still ahead, and the page sees a longer gap.
                next_tick = max(tick + 1, math.ceil((time.perf_counter() - start) / interval))
                stats.missed += next_tick - tick - 1
                tick = next_tick
                due = start + tick * interval
                while (left := due - time.perf_counter()) > SPIN_SECONDS:
                    time.sleep(left - SPIN_SECONDS)
                while time.perf_counter() < due:
                    time.sleep(0)
                if time.perf_counter() - due > interval:
                    stats.missed += 1
                    continue
                # perf_counter and Chrome's TimeTicks read the same monotonic clock, so the page's
                # animation frame times are the grid's.
                params = {"interval": interval * 1000, "frameTimeTicks": due * 1000}
                send(devtools, tick, "HeadlessExperimental.beginFrame", params)
                if not await_reply(devtools, tick, due + STALL_SECONDS):
                    # Fail the test's waits on the page rather than leave them hanging.
                    stats.stalled_at = tick
                    send(devtools, 0, "Page.close", {})
                    return
                stats.ticks += 1
    finally:
        if sys.platform == "win32":
            ctypes.windll.winmm.timeEndPeriod(1)


def send(devtools: "ClientConnection", message_id: int, method: str, params: dict) -> None:
    devtools.send(json.dumps({"id": message_id, "method": method, "params": params}))


def await_reply(devtools: "ClientConnection", message_id: int, deadline: float) -> bool:
    """Whether the message `message_id` got its reply before the deadline."""
    try:
        while (
            json.loads(devtools.recv(timeout=deadline - time.perf_counter())).get("id")
            != message_id
        ):
            pass
    except TimeoutError:
        return False
    return True
