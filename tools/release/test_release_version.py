from pathlib import Path

import pytest
from version import LOCATIONS, check, read, set_version, write


def make_tree(root: Path, version: str, newline: str = "\n") -> None:
    """A file per location holding its version line(s) between unrelated lines."""
    for location in LOCATIONS:
        path = root / location.path
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["before", *[location.pattern.format(version=version)] * location.count, "after"]
        write(path, "\n".join(lines).replace("\n", newline) + newline)


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_set_updates_every_location_and_keeps_line_endings(tmp_path: Path, newline: str) -> None:
    make_tree(tmp_path, "5.47.1", newline)
    assert set_version(tmp_path, "5.48.0") == []
    assert check(tmp_path, "5.48.0") == []
    for location in LOCATIONS:
        text = read(tmp_path / location.path)
        assert "5.47.1" not in text
        assert (newline == "\r\n") == ("\r\n" in text)


def test_check_reports_a_location_left_behind(tmp_path: Path) -> None:
    make_tree(tmp_path, "5.48.0")
    stale = tmp_path / "src/markup/appState.ts"
    write(stale, read(stale).replace("5.48.0", "5.47.1"))
    problems = check(tmp_path, "5.48.0")
    assert len(problems) == 1
    assert "src/markup/appState.ts" in problems[0]
    assert check(tmp_path, None) != []  # without a version, the locations still disagree


@pytest.mark.parametrize("change", ["remove", "duplicate"])
def test_set_writes_nothing_when_a_location_moved(tmp_path: Path, change: str) -> None:
    make_tree(tmp_path, "5.47.1")
    moved = tmp_path / "pyproject.toml"
    line = 'version = "5.47.1"'
    text = read(moved)
    write(
        moved,
        text.replace(line, "") if change == "remove" else text.replace(line, f"{line}\n{line}"),
    )
    problems = set_version(tmp_path, "5.48.0")
    assert any("pyproject.toml" in problem for problem in problems)
    assert "5.48.0" not in read(tmp_path / "package.json")
