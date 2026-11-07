"""The command palette keeps shortcut descriptions to one line, with a short subtitle under each
shortcut that has one. Longer details live in the row's tooltip, marked with an info mark."""

from harness.markup_page import MarkupPage
from harness.steps import step
from playwright.sync_api import Locator
from test_palette_footer import when_i_open_the_palette

ZOOM_SUBTITLE = "Shows a zoomed bar above the progress bar, where crowded marker pairs spread out."
REFRAME_SUBTITLE = "The current crop fills the player and everything outside it is black."
REFRAME_DETAILS = (
    "A preview of the clip as the crop pans and zooms. Ctrl+Mousewheel zooms the crop."
    " The preview never changes the output."
)


def test_rows_show_their_subtitle_and_keep_details_in_the_tooltip(markup: MarkupPage) -> None:
    when_i_open_the_palette(markup)
    when_i_search(markup, "timeline zoom")
    then_the_zoom_row_shows_its_subtitle_without_an_info_mark(markup)
    markup.shot("subtitle")
    when_i_search(markup, "reframe mode")
    then_the_reframe_row_shows_its_subtitle_and_has_its_details_in_the_tooltip(markup)


def test_a_subtitle_only_match_shows_the_subtitle_with_the_match_marked(markup: MarkupPage) -> None:
    when_i_open_the_palette(markup)
    when_i_search(markup, "crowded")
    then_the_zoom_row_shows_its_subtitle_with_marked(markup, "crowded")
    markup.shot("subtitle-match")


@step
def when_i_search(markup: MarkupPage, query: str) -> None:
    markup.page.fill(".cmdp-search", query)


@step
def then_the_zoom_row_shows_its_subtitle_without_an_info_mark(markup: MarkupPage) -> None:
    row = zoom_row(markup)
    assert row.locator(".cmdp-item-subtitle").inner_text() == ZOOM_SUBTITLE
    assert row.locator(".cmdp-item-info").count() == 0
    assert row.get_attribute("title") is None


@step
def then_the_reframe_row_shows_its_subtitle_and_has_its_details_in_the_tooltip(
    markup: MarkupPage,
) -> None:
    row = markup.page.locator(".cmdp-item").filter(has_text="Toggle reframe mode")
    assert row.locator(".cmdp-item-subtitle").inner_text() == REFRAME_SUBTITLE
    assert row.get_attribute("title") == REFRAME_DETAILS
    assert row.locator(".cmdp-item-info").count() == 1
    assert row.locator(".cmdp-item-details").count() == 0


@step
def then_the_zoom_row_shows_its_subtitle_with_marked(markup: MarkupPage, query: str) -> None:
    subtitle = zoom_row(markup).locator(".cmdp-item-subtitle")
    assert subtitle.inner_text() == ZOOM_SUBTITLE
    assert subtitle.locator("mark").inner_text() == query


def zoom_row(markup: MarkupPage) -> Locator:
    return markup.page.locator(".cmdp-item").filter(has_text="Toggle the timeline zoom")
