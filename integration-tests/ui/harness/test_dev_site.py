import threading
from typing import ClassVar

import pytest

from harness import dev_site


class FakeServer:
    """A server that binds the next port from `ports`, as the OS would pick for port 0."""

    ports: ClassVar[list[int]] = []
    closed: ClassVar[list[int]] = []

    def __init__(self, address: tuple[str, int], handler: object) -> None:
        self.server_address = (address[0], FakeServer.ports.pop(0))
        self.stopped = threading.Event()

    def serve_forever(self) -> None:
        self.stopped.wait()

    def shutdown(self) -> None:
        self.stopped.set()

    def server_close(self) -> None:
        FakeServer.closed.append(self.server_address[1])


def test_serving_skips_a_port_chrome_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dev_site.http.server, "ThreadingHTTPServer", FakeServer)
    FakeServer.ports, FakeServer.closed = [6566, 51234], []
    with dev_site.serving(0) as url:
        assert url == "http://localhost:51234/"
    assert FakeServer.closed == [6566]
