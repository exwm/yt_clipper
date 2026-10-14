from pathlib import Path

import pytest

from clipper import argparser, util, yt_clipper
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


def test_print_versions_needs_no_markers_json(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("sys.argv", ["yt_clipper", "--print-versions"])
    monkeypatch.setattr(argparser, "getDepVersionsString", lambda _paths: "tool versions")

    with pytest.raises(SystemExit) as exit_info:
        yt_clipper.main()

    assert exit_info.value.code == 0
    assert "tool versions" in capsys.readouterr().out
