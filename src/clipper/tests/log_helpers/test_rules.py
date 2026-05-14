"""Tests for the horizontal-rule renderer."""

from __future__ import annotations

from clipper.log_helpers.rules import render_rule


def test_untitled_rule_is_just_repeated_char() -> None:
    assert render_rule(width=10) == "──────────"
    assert render_rule(char="-", width=10) == "----------"


def test_titled_rule_centers_title_with_padding() -> None:
    out = render_rule("X", char="-", width=10)
    # width=10, ` X ` is 3 chars, leftover 7 chars: 3 left + 4 right
    # (right-biased when the remainder is odd).
    assert out == "--- X ----"
    assert len(out) == 10


def test_titled_rule_balances_padding_when_remainder_is_even() -> None:
    out = render_rule("Title", char="-", width=15)
    assert len(out) == 15
    assert " Title " in out
    # Equal padding on both sides when (width - len(decorated)) is even.
    left, right = out.split(" Title ")
    assert len(left) == len(right)


def test_titled_rule_overflows_rather_than_truncates_long_titles() -> None:
    # Title longer than width: return the bare title (no truncation,
    # no rule chars). Better to overflow than hide the title.
    out = render_rule("A very long title that exceeds the width", width=10)
    assert "A very long title" in out
    assert "─" not in out
    assert "-" not in out


def test_default_char_is_unicode_horizontal() -> None:
    # Non-ASCII default keeps the rule visually distinct from
    # in-message hyphens; ASCII override (`char="-"`) covers the
    # plain-terminal case.
    assert render_rule(width=3) == "───"
