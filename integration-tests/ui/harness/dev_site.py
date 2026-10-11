"""The dev site: the generic yt_clipper page with the userscript's @require libraries and the freshly
built bundle injected, plus a generated test video, served on localhost (detected as the generic
yt_clipper platform). The @require list is parsed from the userscript header, so the page always
loads the same libraries Tampermonkey would."""

import contextlib
import functools
import http.server
import re
import shutil
import subprocess
import sys
import threading
from collections.abc import Generator
from pathlib import Path

from .paths import BUNDLE, DEV_SITE, SITE_PAGE, USERSCRIPT_SOURCE

DEFAULT_PORT = 8765
# Long enough that marker pairs a few seconds apart crowd together on the progress bar, like the
# long-video reports that motivated the timeline zoom.
DEFAULT_VIDEO_SECONDS = 2400


def require_urls() -> list[str]:
    header = USERSCRIPT_SOURCE.read_text(encoding="utf-8").split("==/UserScript==")[0]
    return re.findall(r"^// @require\s+(\S+)", header, flags=re.MULTILINE)


def test_video_name(seconds: int) -> str:
    return f"test-video-{seconds}s.mp4"


def ensure_test_video(seconds: int) -> str:
    name = test_video_name(seconds)
    path = DEV_SITE / name
    if not path.exists():
        print(f"Generating {name} with ffmpeg (once, then cached)...")
        subprocess.run(
            [
                *("ffmpeg", "-hide_banner", "-loglevel", "error"),
                *("-f", "lavfi", "-i", f"testsrc2=size=320x180:rate=30:duration={seconds}"),
                *("-c:v", "libx264", "-preset", "ultrafast", "-crf", "40", "-pix_fmt", "yuv420p"),
                str(path),
            ],
            check=True,
        )
    return name


def build(video_seconds: int) -> str:
    """Write the dev site and return the test video's file name."""
    if not BUNDLE.exists():
        sys.exit(f"Missing {BUNDLE}; build the userscript first (the just recipes do this).")
    DEV_SITE.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BUNDLE, DEV_SITE / "yt_clipper.js")
    scripts = [
        # Only other platforms read it, but defining it keeps any stray access from throwing.
        "<script>window.unsafeWindow = window;</script>",
        *(f'<script src="{url}"></script>' for url in require_urls()),
        '<script src="yt_clipper.js"></script>',
    ]
    page = SITE_PAGE.read_text(encoding="utf-8")
    page = page.replace("</body>", "\n".join(scripts) + "\n</body>")
    (DEV_SITE / "index.html").write_text(page, encoding="utf-8")
    return ensure_test_video(video_seconds)


class DevSiteHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the dev site quietly, with the single byte-range support browsers need to seek in a
    video (the stdlib handler always sends the whole file, which leaves the video unseekable)."""

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 (stdlib signature)
        pass

    def handle(self) -> None:
        # The browser drops range requests it no longer needs while seeking.
        with contextlib.suppress(ConnectionError):
            super().handle()

    def send_head(self):  # noqa: ANN201 (stdlib signature)
        range_header = self.headers.get("Range")
        path = Path(self.translate_path(self.path))
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header or "")
        if not match or not path.is_file():
            return super().send_head()
        size = path.stat().st_size
        first = int(match[1]) if match[1] else max(0, size - int(match[2] or 0))
        last = min(int(match[2]), size - 1) if match[1] and match[2] else size - 1
        if first >= size:
            self.send_error(416, "Requested range not satisfiable")
            return None
        file = path.open("rb")
        file.seek(first)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {first}-{last}/{size}")
        self.send_header("Content-Length", str(last - first + 1))
        self.end_headers()
        self._range_remaining = last - first + 1
        return file

    def copyfile(self, source, outputfile) -> None:  # noqa: ANN001 (stdlib signature)
        remaining = getattr(self, "_range_remaining", None)
        if remaining is None:
            super().copyfile(source, outputfile)
            return
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._range_remaining = None


@contextlib.contextmanager
def serving(port: int) -> Generator[str]:
    """Serve the dev site in a background thread, yielding its URL."""
    handler = functools.partial(DevSiteHandler, directory=str(DEV_SITE))
    server = http.server.ThreadingHTTPServer(("localhost", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://localhost:{port}/"
    finally:
        server.shutdown()
