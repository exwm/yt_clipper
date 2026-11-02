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

from clipper import frame_timing
from clipper.ytc_logger import HEADER, IMPORTANT, NOTICE, REPORT

verboselogs.add_log_level(IMPORTANT, "IMPORTANT")
verboselogs.add_log_level(NOTICE, "NOTICE")
verboselogs.add_log_level(HEADER, "HEADER")
verboselogs.add_log_level(REPORT, "REPORT")

# The frame timing this source builds into the clipper, before any test sets it. A --clipper-exe is
# assumed to be built from this source.
BUILT_FRAME_TIMING = frame_timing.current()


def markedFrameTiming(mode: str) -> frame_timing.Build:
    """`frame_timing("5.48")` or `("next")`: every group at that release; `("5.49")`: 5.49's whole
    build."""
    if mode == "5.49":
        return frame_timing.WHOLE_549
    if mode == "5.48":
        return frame_timing.ALL_548
    if mode == "next":
        return frame_timing.FrameTimingSwitches()
    raise ValueError(f"unknown frame_timing mode {mode!r}")


def skipsOnBuiltClipper(mode: str, built: frame_timing.FrameTiming) -> bool:
    """A test marked `mode` checks decisions a built clipper doesn't make. Compared by decisions, so a
    5.48 test still runs on a next build until next replaces a decision."""
    return not frame_timing.compose(markedFrameTiming(mode)).sameDecisions(built)


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


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """The tests that run yt-dlp or encode go first, so xdist spreads them over the workers instead
    of leaving them for last, when the other workers have nothing left."""
    slow = {"test_e2e.py", "test_ytdl.py"}
    items.sort(key=lambda item: item.path.name not in slow)
    if config.getoption("clipper_exe"):
        skip = pytest.mark.skip(
            reason=f"a built clipper keeps its own frame timing ({BUILT_FRAME_TIMING.name})"
        )
        for item in items:
            marker = item.get_closest_marker("frame_timing")
            if marker and skipsOnBuiltClipper(marker.args[0], BUILT_FRAME_TIMING):
                item.add_marker(skip)


@pytest.fixture(autouse=True)
def noCoverageInSubprocesses(monkeypatch: pytest.MonkeyPatch) -> None:
    """pytest-cov measures every Python process a test starts, yt-dlp included, which runs none of
    the clipper's code but 5x slower measured. Total coverage is the same without it."""
    for name in ("COV_CORE_SOURCE", "COV_CORE_CONFIG", "COV_CORE_DATAFILE"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def frameTiming(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    """The tests pin 5.49's whole build unless marked with another. A built clipper (--clipper-exe)
    keeps its own, so its unmarked tests must pass with either."""
    marker = request.node.get_closest_marker("frame_timing")
    monkeypatch.setattr(
        frame_timing,
        "SWITCHES",
        markedFrameTiming(marker.args[0]) if marker is not None else frame_timing.WHOLE_549,
    )


def pytest_configure(config: pytest.Config) -> None:
    # The tests and the clipper they start both find ffmpeg on PATH. Each xdist worker runs this too.
    ffmpegDir = config.getoption("--ffmpeg-dir")
    if ffmpegDir:
        os.environ["PATH"] = os.pathsep.join([str(Path(ffmpegDir).resolve()), os.environ["PATH"]])
