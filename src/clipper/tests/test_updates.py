import logging
from pathlib import Path

import pytest

from clipper import updates

ACTIVE_ARGS = "# a comment\n--cookies cookies.txt\n"
COMMENTS_ONLY = "# --audio\n\n"


@pytest.mark.parametrize(
    ("version", "parsed"),
    [
        ("5.49.0", (5, 49, 0)),
        ("5.31.0+c42ee43", (5, 31, 0)),
        ("v5.48.1", (5, 48, 1)),
        ("5.49", None),
        (5, None),
        (None, None),
    ],
)
def test_parse_version(version: object, parsed: tuple[int, int, int] | None) -> None:
    assert updates.parseVersion(version) == parsed


@pytest.mark.parametrize(
    ("markersVersion", "warns"),
    [
        ("5.50.0", True),
        ("5.49.1", True),
        ("6.0.0", True),
        ("5.49.0", False),
        ("5.31.0+c42ee43", False),
        (None, False),
        ("not a version", False),
    ],
)
def test_warns_only_for_markers_from_a_newer_markup_script(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    markersVersion: object,
    warns: bool,
) -> None:
    monkeypatch.setattr(updates, "__version__", "5.49.0")
    with caplog.at_level(logging.WARNING):
        updates.warnIfMarkersNewerThanClipper(markersVersion)
    assert (updates.RELEASES_URL in caplog.text) == warns


def test_default_args_examples_are_real_options() -> None:
    # Uncommenting an example that no longer exists would stop every run on an unknown argument.
    from clipper import argparser

    text = (Path(updates.__file__).parent / "include" / "default_args.txt").read_text(encoding="utf-8")
    examples = [line.lstrip("# ").split()[0] for line in text.splitlines() if line.startswith("# -")]
    options = {name for action in argparser.getArgParser()._actions for name in action.option_strings}
    assert examples
    assert [example for example in examples if example not in options] == []


def makeInstall(parent: Path, name: str, defaultArgs: str | bytes | None, nested: bool = False) -> Path:
    # Windows' Extract All puts the zip's top folder inside a folder of the same name.
    install = parent / name / name if nested else parent / name
    install.mkdir(parents=True)
    if defaultArgs is not None:
        content = defaultArgs if isinstance(defaultArgs, bytes) else defaultArgs.encode("utf-8")
        (install / "default_args.txt").write_bytes(content)
    return install


@pytest.mark.parametrize(
    ("current", "older", "shared", "notices"),
    [
        pytest.param(COMMENTS_ONLY, ACTIVE_ARGS, None, True, id="older install has settings"),
        pytest.param(None, ACTIVE_ARGS, None, True, id="new install has no default_args.txt"),
        pytest.param(COMMENTS_ONLY, COMMENTS_ONLY, None, False, id="older install has none"),
        pytest.param(ACTIVE_ARGS, ACTIVE_ARGS, None, False, id="new install already set up"),
        pytest.param(COMMENTS_ONLY, ACTIVE_ARGS, "", False, id="shared file exists"),
        pytest.param(
            COMMENTS_ONLY,
            "--cookies C:\\Users\\example\\Jos\u00e9\\c.txt\n".encode("cp1252"),
            None,
            True,
            id="older install's settings are not UTF-8",
        ),
        pytest.param(
            COMMENTS_ONLY,
            ("\ufeff" + COMMENTS_ONLY).encode("utf-8"),
            None,
            False,
            id="older install has a byte order mark and only comments",
        ),
        pytest.param(
            COMMENTS_ONLY,
            ("﻿" + COMMENTS_ONLY).encode("utf-16-le"),
            None,
            False,
            id="older install has only comments in UTF-16",
        ),
    ],
)
@pytest.mark.parametrize("nested", [False, True], ids=["unzipped", "nested by Extract All"])
def test_notices_settings_left_in_an_older_install(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    current: str | None,
    older: str | bytes,
    shared: str | None,
    notices: bool,
    nested: bool,
) -> None:
    makeInstall(tmp_path, "yt_clipper_win_5.48.0", older, nested)
    install = makeInstall(tmp_path, "yt_clipper_win_5.49.0", current, nested)
    makeInstall(tmp_path, "unrelated", ACTIVE_ARGS)
    if shared is not None:
        (tmp_path / updates.SHARED_ARGS_FILE).write_text(shared, encoding="utf-8")
    with caplog.at_level(logging.DEBUG):
        updates.noticeSettingsLeftInOtherInstalls(install)
    assert ("yt_clipper_win_5.48.0" in caplog.text) == notices
    assert "unrelated" not in caplog.text


@pytest.mark.parametrize(
    ("latest", "result"),
    [
        pytest.param("v5.50.0", "5.50.0 is available (this is 5.49.0)", id="newer release"),
        pytest.param(
            "v5.49.0", "No newer version than yt_clipper 5.49.0 is out", id="same release"
        ),
        pytest.param(
            "v5.48.0", "No newer version than yt_clipper 5.49.0 is out", id="older release"
        ),
        pytest.param("nightly", "Could not read the latest version", id="unreadable tag"),
        pytest.param(OSError("offline"), "Could not check for updates", id="offline"),
    ],
)
def test_check_for_updates_says_whether_a_newer_release_is_out(
    monkeypatch: pytest.MonkeyPatch,
    latest: str | Exception,
    result: str,
) -> None:
    monkeypatch.setattr(updates, "__version__", "5.49.0")

    def fetchLatest() -> str:
        if isinstance(latest, Exception):
            raise latest
        return latest

    assert result in updates.checkForUpdates(fetchLatest)
