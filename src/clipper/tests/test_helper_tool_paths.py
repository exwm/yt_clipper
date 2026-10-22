import re
from pathlib import Path

import pytest

CLIPPER = Path(__file__).parents[1]
HELPERS = sorted(
    h
    for h in [*(CLIPPER / "macos_helpers").iterdir(), *(CLIPPER / "win_helpers").iterdir()]
    if h.is_file()
)
FFMPEG_HELPERS = [
    h for h in HELPERS if re.search(r"\bffmpeg\b", h.read_text(encoding="utf-8", errors="replace"))
]
# A tool right under bin, where releases before 5.48 kept it.
TOOL_UNDER_BIN = re.compile(r"bin[/\\](ffmpeg|ffprobe|ffplay)\b")


@pytest.mark.parametrize("helper", HELPERS, ids=lambda h: h.name)
def test_no_helper_runs_a_tool_from_bin_itself(helper: Path) -> None:
    assert TOOL_UNDER_BIN.findall(helper.read_text(encoding="utf-8", errors="replace")) == []


@pytest.mark.parametrize("helper", FFMPEG_HELPERS, ids=lambda h: h.name)
def test_helpers_that_run_ffmpeg_run_the_bundled_one(helper: Path) -> None:
    assert re.search(
        r"bin[/\\]video-tools[/\\]ffmpeg", helper.read_text(encoding="utf-8", errors="replace")
    )
