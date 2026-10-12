from pathlib import Path

import pytest

from clipper import util
from clipper.yt_clipper import findVideo2x


@pytest.mark.parametrize(
    ("test_input", "expected"),
    [
        pytest.param("", "", id="empty string"),
        ("non-empty", "non-empty"),
        ("'squoted'", r"'\''squoted'\''"),
    ],
)
def test_escapeSingleQuotesFFmpeg(test_input: str, expected: str) -> None:
    assert expected == util.escapeSingleQuotesFFmpeg(test_input)


@pytest.mark.parametrize(
    ("installed", "expected"),
    [
        pytest.param(
            ["video-tools", "video2x"],
            "./bin/video-tools/video2x.exe",
            id="bundled wins",
        ),
        pytest.param(["video2x"], "./bin/video2x/video2x.exe", id="manual install"),
        pytest.param([], "video2x", id="system PATH"),
    ],
)
def test_findVideo2x(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    installed: list[str],
    expected: str,
) -> None:
    for video2x_dir in installed:
        (tmp_path / "bin" / video2x_dir).mkdir(parents=True)
        (tmp_path / "bin" / video2x_dir / "video2x.exe").touch()
    monkeypatch.chdir(tmp_path)
    assert findVideo2x(".exe") == expected
