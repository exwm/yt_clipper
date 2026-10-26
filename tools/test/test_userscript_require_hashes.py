"""The userscript's @require libraries match the sha256 pinned on each line, which userscript
managers check before running the script. A mismatch there would stop the script loading."""

import hashlib
import re
import urllib.request
from pathlib import Path

import pytest

USERSCRIPT = Path(__file__).resolve().parents[2] / "src" / "markup" / "yt_clipper.ts"
REQUIRES = re.findall(
    r"^// @require\s+(\S+)#sha256=([0-9a-f]{64})$",
    USERSCRIPT.read_text(encoding="utf-8"),
    re.MULTILINE,
)


def test_every_require_pins_a_sha256() -> None:
    lines = re.findall(r"^// @require\s+\S+$", USERSCRIPT.read_text(encoding="utf-8"), re.MULTILINE)
    assert len(REQUIRES) == len(lines) > 0


@pytest.mark.slow
@pytest.mark.parametrize(
    ("url", "sha256"), REQUIRES, ids=[url.rsplit("/", 1)[-1] for url, _ in REQUIRES]
)
def test_a_required_library_matches_its_pinned_sha256(url: str, sha256: str) -> None:
    with urllib.request.urlopen(url, timeout=30) as response:
        assert hashlib.sha256(response.read()).hexdigest() == sha256
