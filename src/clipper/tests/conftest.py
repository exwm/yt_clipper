"""
Shared pytest setup for the Python clipper test suite.

Registers the custom ``verboselogs`` levels used by ``ytc_logger`` so tests
that invoke ``logger.notice`` / ``logger.header`` / etc. don't fail on a
missing rich style. In production these are registered inside
``setUpLogger``, which no test calls.
"""

import os
from pathlib import Path

import pytest
import verboselogs

from clipper.ytc_logger import HEADER, IMPORTANT, NOTICE, REPORT

verboselogs.add_log_level(IMPORTANT, "IMPORTANT")
verboselogs.add_log_level(NOTICE, "NOTICE")
verboselogs.add_log_level(HEADER, "HEADER")
verboselogs.add_log_level(REPORT, "REPORT")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--clipper-exe",
        metavar="PATH",
        help="run the end-to-end tests with this built yt_clipper executable and its bundled tools",
    )
    parser.addoption(
        "--helpers-dir",
        metavar="DIR",
        help="run the helper script tests on the scripts in this folder, e.g. an installed release",
    )
    parser.addoption(
        "--ffmpeg-dir",
        metavar="DIR",
        help="run the tests with the ffmpeg and ffprobe in this folder instead of the ones on PATH",
    )


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """The tests that run yt-dlp or encode go first, so xdist spreads them over the workers instead
    of leaving them for last, when the other workers have nothing left."""
    slow = {"test_e2e.py", "test_ytdl.py"}
    items.sort(key=lambda item: item.path.name not in slow)


@pytest.fixture(autouse=True)
def noCoverageInSubprocesses(monkeypatch: pytest.MonkeyPatch) -> None:
    """pytest-cov measures every Python process a test starts, yt-dlp included, which runs none of
    the clipper's code but 5x slower measured. Total coverage is the same without it."""
    for name in ("COV_CORE_SOURCE", "COV_CORE_CONFIG", "COV_CORE_DATAFILE"):
        monkeypatch.delenv(name, raising=False)


def pytest_configure(config: pytest.Config) -> None:
    # The tests and the clipper they start both find ffmpeg on PATH. Each xdist worker runs this too.
    ffmpegDir = config.getoption("--ffmpeg-dir")
    if ffmpegDir:
        os.environ["PATH"] = os.pathsep.join([str(Path(ffmpegDir).resolve()), os.environ["PATH"]])
