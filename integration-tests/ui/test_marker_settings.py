"""The marker pair settings editor's own fields."""

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step
from test_crop_easing import when_i_save_the_markers


@pytest.mark.parametrize(
    ("typed", "saved"),
    [
        pytest.param("intro", "intro", id="plain text"),
        pytest.param('in"tro', None, id="a double quote"),
        pytest.param("in\\tro", None, id="a backslash"),
    ],
)
def test_the_title_prefix_field_refuses_characters_clip_names_leave_out(
    markup: MarkupPage, typed: str, saved: str | None
) -> None:
    given_a_marker_pair_with_its_editor_open(markup)
    when_i_type_the_title_prefix(markup, typed)
    then_the_saved_title_prefix_is(markup, saved)


@step
def given_a_marker_pair_with_its_editor_open(markup: MarkupPage) -> None:
    markup.load_marker_pairs([(3, 6)])
    markup.open_marker_pair(0)


@step
def when_i_type_the_title_prefix(markup: MarkupPage, text: str) -> None:
    markup.page.fill("#title-prefix-input", text)


@step
def then_the_saved_title_prefix_is(markup: MarkupPage, expected: str | None) -> None:
    overrides = when_i_save_the_markers(markup)["markerPairs"][0].get("overrides", {})
    markup.report(f"saved overrides {overrides}")
    assert overrides.get("titlePrefix") == expected
