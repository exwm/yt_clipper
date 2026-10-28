"""The page a test drives: the platform's player with the markup activated, plus the actions tests
share (seeking, playing, placing and opening marker pairs) and named screenshots."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from .hosts import Host
from .paths import REPO

if TYPE_CHECKING:
    from playwright.sync_api import FloatRect, Page

SEEK_TIMEOUT_MS = 15_000


def clip_box(boxes: "list[FloatRect]", scroll: tuple[float, float], padding: float) -> "FloatRect":
    """The page box around viewport `boxes`, padded and kept inside the page's top left corner."""
    scroll_x, scroll_y = scroll
    left = max(min(box["x"] for box in boxes) + scroll_x - padding, 0)
    top = max(min(box["y"] for box in boxes) + scroll_y - padding, 0)
    right = max(box["x"] + box["width"] for box in boxes) + scroll_x + padding
    bottom = max(box["y"] + box["height"] for box in boxes) + scroll_y + padding
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


class MarkupPage:
    def __init__(
        self,
        page: "Page",
        host: Host,
        shots_dir: Path,
        tracing: bool = False,
        assumed_frame_rate: bool = False,
    ) -> None:
        self.page = page
        # Tests that measure the rate run at the assumed 60 fps instead (--assumed-frame-rate).
        self.assumed_frame_rate = assumed_frame_rate
        self.host = host
        self.shots_dir = shots_dir
        self.shot_count = 0
        self.tracing = tracing

    @contextmanager
    def untraced(self) -> Iterator[None]:
        """Pause the trace for a stretch of playback that measures the video. Tracing's screenshots
        starve Chrome of frames (about 1 in 7 shown), so the frame rate can't be measured under it."""
        if self.tracing:
            self.page.context.tracing.stop_chunk()
        try:
            yield
        finally:
            if self.tracing:
                self.page.context.tracing.start_chunk()

    def report(self, message: str) -> None:
        """Print a measured value, so a run's log shows what each check saw."""
        print(f"    {message}")

    def shot(self, label: str) -> None:
        self.shot_count += 1
        self.next_frames()  # the userscript's UI renders on animation frames
        path = self.shots_dir / f"{self.shot_count:02d}-{label}.png"
        self.page.screenshot(path=str(path))
        self.report(str(path.relative_to(REPO)))

    def shot_of(self, label: str, selectors: list[str], padding: int = 12) -> Path:
        """A screenshot clipped to the box around `selectors`, for close-ups of one feature."""
        self.shot_count += 1
        self.next_frames()
        boxes = [self.box_of(selector) for selector in selectors]
        scroll_x, scroll_y = self.page.evaluate("() => [window.scrollX, window.scrollY]")
        clip = clip_box(boxes, (scroll_x, scroll_y), padding)
        path = self.shots_dir / f"{self.shot_count:02d}-{label}.png"
        self.page.screenshot(path=str(path), clip=clip, full_page=True)
        self.report(str(path.relative_to(REPO)))
        return path

    # ─── waiting ────────────────────────────────────────────────────────────
    # Wait for what a step depends on rather than for a fixed time: fixed sleeps are either too
    # short (flaky on a slow machine or YouTube) or too long (they add up across the suite).

    def next_frames(self, count: int = 2) -> None:
        """Wait for `count` animation frames, for UI that updates in its requestAnimationFrame loop."""
        self.page.evaluate(
            "count => new Promise(resolve => {"
            " const step = (left) => left ? requestAnimationFrame(() => step(left - 1)) : resolve();"
            " step(count); })",
            count,
        )

    def eventually(self, predicate: str, arg: object = None, timeout_ms: int = 5000) -> bool:
        """Whether the JS `predicate` (called with `arg`) holds within the timeout. Returns rather
        than raises, so a Then step can assert on it with its own message."""
        try:
            self.page.wait_for_function(predicate, arg=arg, timeout=timeout_ms)
        except PlaywrightTimeoutError:
            return False
        return True

    # ─── page geometry ──────────────────────────────────────────────────────

    def box_of(self, selector: str) -> "FloatRect":
        """The first matching element's bounding box; fails when it is not visible."""
        box = self.page.locator(selector).first.bounding_box()
        assert box is not None, f"{selector} is not visible"
        return box

    def reveal(self, selector: str) -> "FloatRect":
        """Scroll the element into view and return its box, for pointing the mouse at it. (Mouse
        coordinates are in the viewport, so an element below the fold would be missed.)"""
        self.page.locator(selector).first.scroll_into_view_if_needed()
        return self.box_of(selector)

    def center_of(self, selector: str) -> tuple[float, float]:
        box = self.reveal(selector)
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    # ─── video ──────────────────────────────────────────────────────────────

    def seek(self, seconds: float, presented: bool = False) -> None:
        """Seek and wait for 'seeked'. With `presented`, also wait for the first video frame
        presented after the seek, which the markup's frame callbacks draw from: 'seeked' can come
        before it, and a busy machine can take longer than a few animation frames to present it."""
        # Bounded wait: a seek that never settles (buffering, an ad) should fail the test with a
        # screenshot, not hang it. On YouTube, seek through its player API: setting currentTime
        # directly bypasses the player's buffering and can stall in an unbuffered region (the
        # userscript seeks the same way).
        settled = self.page.evaluate(
            """([t, timeout, presented]) => new Promise(resolve => {
                const v = document.querySelector('video');
                const player = document.querySelector('#movie_player');
                // YouTube's seekTo is a no-op (no 'seeked') when already there.
                if (Math.abs(v.currentTime - t) < 0.01) return resolve(true);
                const timer = setTimeout(() => resolve(false), timeout);
                let waiting = presented ? 2 : 1;
                const done = () => { if (--waiting === 0) { clearTimeout(timer); resolve(true); } };
                v.addEventListener('seeked', done, { once: true });
                // Registered before the seek, so it cannot miss the frame the seek presents. A frame
                // from before the seek (playback just paused) can still arrive: wait for the frame
                // that covers the target, which starts at most a frame (0.1 s at 10 fps) before it.
                const onFrame = (_now, meta) => {
                  const behind = t - meta.mediaTime;
                  if (behind > -0.002 && behind < 0.1) done();
                  else v.requestVideoFrameCallback(onFrame);
                };
                if (presented) v.requestVideoFrameCallback(onFrame);
                if (player?.seekTo) player.seekTo(t, true);
                else v.currentTime = t;
            })""",
            [seconds, SEEK_TIMEOUT_MS, presented],
        )
        assert settled, f"seek to {seconds}s did not settle within {SEEK_TIMEOUT_MS} ms"

    def measure_frame_rate(self) -> None:
        """Play half a second, so the markup measures the video's frame rate from played frames. A site
        that reports no rate (the dev site) otherwise steps, seeks and compares frames at 60 fps."""
        self.seek(2, presented=True)
        if self.assumed_frame_rate:
            return
        with self.untraced():
            self.play()
            self.page.wait_for_function(
                "() => document.querySelector('video').currentTime > 2.5", timeout=SEEK_TIMEOUT_MS
            )
            self.pause()

    def current_time(self) -> float:
        return self.page.evaluate("() => document.querySelector('video').currentTime")

    def is_paused(self) -> bool:
        return self.page.evaluate("() => document.querySelector('video').paused")

    def play(self) -> None:
        self.page.evaluate(
            "() => { const p = document.querySelector('#movie_player');"
            " p?.playVideo ? p.playVideo() : document.querySelector('video').play(); }",
        )

    def pause(self) -> None:
        self.page.evaluate(
            "() => { const p = document.querySelector('#movie_player');"
            " p?.pauseVideo ? p.pauseVideo() : document.querySelector('video').pause(); }",
        )

    # ─── markup ─────────────────────────────────────────────────────────────

    def press(self, keys: str) -> None:
        self.page.keyboard.press(keys)
        self.next_frames()  # hotkey handlers run at once; let what they changed render

    def add_marker_pair(self, start: float, end: float) -> None:
        # A marker marks the frame on screen, so wait for the seek to present it.
        self.seek(start, presented=True)
        self.press("KeyA")
        self.seek(end, presented=True)
        self.press("KeyA")

    def load_marker_pairs(self, spans: list[tuple[float, float]]) -> None:
        """Add marker pairs the way a user loads a saved markers .json (markers data menu, file,
        review, Load): one step instead of a seek and a key press per marker."""
        self.load_saved_marker_pairs([{"start": s, "end": e} for s, e in spans])

    def load_saved_marker_pairs(self, pairs: list[dict], settings: dict | None = None) -> None:
        """Load marker pairs given in the saved markers .json format, e.g. with a cropMap, and any
        global settings."""
        # With the crop easing, as the markup script saves it: a file without one is from before
        # 5.49 and loads as EaseInOut.
        data = json.dumps(
            {"cropPointEasing": "smoothTrack", **(settings or {}), "markerPairs": pairs}
        )
        self.press("KeyG")
        self.page.set_input_files(
            "#markers-json-input",
            files=[
                {"name": "markers.json", "mimeType": "application/json", "buffer": data.encode()},
            ],
        )
        self.page.click("#upload-markers-json")
        self.page.click(".ytc-share-modal-load")
        self.page.wait_for_function(
            "count => document.querySelector('#markers-div svg').children.length >= count",
            arg=2 * len(pairs),
        )

    def open_marker_pair(self, index: int) -> None:
        """Open a pair's editor by clicking its start number on the progress bar."""
        self.page.locator(f"#marker-numberings-div text[data-idx='{index + 1}']").first.click()
        self.page.wait_for_selector("#crop-input", state="attached")
