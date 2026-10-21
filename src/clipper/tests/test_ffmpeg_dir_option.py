import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from clipper.tests import conftest


def configure(ffmpegDir: str | None) -> None:
    conftest.pytest_configure(SimpleNamespace(getoption=lambda _name: ffmpegDir))  # type: ignore[arg-type]


def test_ffmpeg_dir_puts_that_folder_first_on_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PATH", os.pathsep.join(["C:\\example\\tools", "C:\\example\\more"]))
    configure(str(tmp_path))
    assert os.environ["PATH"].split(os.pathsep) == [
        str(tmp_path.resolve()),
        "C:\\example\\tools",
        "C:\\example\\more",
    ]


def test_without_ffmpeg_dir_path_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "C:\\example\\tools")
    configure(None)
    assert os.environ["PATH"] == "C:\\example\\tools"
