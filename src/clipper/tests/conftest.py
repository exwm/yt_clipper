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
        "--ffmpeg-dir",
        metavar="DIR",
        help="run the tests with the ffmpeg and ffprobe in this folder instead of the ones on PATH",
    )


def pytest_configure(config: pytest.Config) -> None:
    # The tests and the clipper they start both find ffmpeg on PATH. Each xdist worker runs this too.
    ffmpegDir = config.getoption("--ffmpeg-dir")
    if ffmpegDir:
        os.environ["PATH"] = os.pathsep.join([str(Path(ffmpegDir).resolve()), os.environ["PATH"]])
