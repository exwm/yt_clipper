"""A local HTTP file server with byte range support that records each range requested, standing in
for a video host such as YouTube in tests."""

import re
import threading
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


@dataclass(frozen=True)
class ServedRange:
    path: str
    start: int
    length: int


class RangeHTTPServer:
    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.served: list[ServedRange] = []
        self._lock = threading.Lock()
        server = self

        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
                super().__init__(*args, directory=str(folder), **kwargs)

            def log_message(self, format: str, *args: object) -> None:  # noqa: A002 (the base's name)
                pass

            def do_GET(self) -> None:
                file = folder / self.path.lstrip("/").split("?")[0]
                if not file.is_file():
                    self.send_error(404)
                    return
                size = file.stat().st_size
                start, end = 0, size - 1
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
                if match:
                    start = int(match[1] or 0)
                    end = min(int(match[2]), size - 1) if match[2] else size - 1
                # Recorded before replying: a client can finish reading before this thread runs on.
                with server._lock:
                    server.served.append(ServedRange(self.path, start, end - start + 1))
                if match:
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                else:
                    self.send_response(200)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Content-Type", "video/webm")
                self.end_headers()
                sent = 0
                with file.open("rb") as stream:
                    stream.seek(start)
                    try:
                        while sent < end - start + 1:
                            chunk = stream.read(min(64 * 1024, end - start + 1 - sent))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            sent += len(chunk)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                        pass  # ffmpeg closes the connection once it has what it needs

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def url(self, name: str) -> str:
        return f"http://127.0.0.1:{self._httpd.server_address[1]}/{name}"

    def readsStartingIn(self, name: str, start: float, end: float) -> int:
        """Requests for `name` that start between the `start` and `end` fractions of the file.

        A client that seeks into the file starts a request there. Bytes served would also count
        what socket buffers absorb before the client closes an open-ended range.
        """
        size = (self.folder / name).stat().st_size
        with self._lock:
            return sum(
                1
                for served in self.served
                if served.path.lstrip("/") == name and start * size <= served.start <= end * size
            )

    def reset(self) -> None:
        with self._lock:
            self.served.clear()

    def __enter__(self) -> "RangeHTTPServer":
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
