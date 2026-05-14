"""Tests for the LogPath wrapper / quoted_path function."""

from __future__ import annotations

from pathlib import Path

from clipper.log_helpers.paths import LogPath, quoted_path


def test_logpath_quotes_and_escapes_brackets() -> None:
    out = f"{LogPath('foo/bar[baz].webm')}"
    assert out == '"foo/bar\\[baz].webm"'


def test_logpath_renders_none_as_placeholder() -> None:
    assert f"{LogPath(None)}" == "(none)"


def test_logpath_accepts_path_objects() -> None:
    out = f"{LogPath(Path('foo/bar.webm'))}"
    # str() of a Path uses the OS separator. Just verify quoting/escape
    # behavior — separator is OS-dependent.
    assert out.startswith('"')
    assert out.endswith('"')
    assert "bar.webm" in out


def test_logpath_str_matches_format() -> None:
    p = LogPath("/tmp/a.webm")
    assert str(p) == f"{p}"


def test_logpath_repr_shows_wrapped_value() -> None:
    assert repr(LogPath("/x")) == "LogPath('/x')"


def test_quoted_path_alias_matches_str_logpath() -> None:
    assert quoted_path("foo.webm") == str(LogPath("foo.webm"))
    assert quoted_path(None) == "(none)"


def test_logpath_inside_fstring_with_surrounding_text() -> None:
    p = LogPath("foo.webm")
    msg = f"Saved: {p} (some context)"
    assert msg == 'Saved: "foo.webm" (some context)'
