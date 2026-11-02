"""The player's current-time readout shows the playhead's milliseconds (features/time-readout)."""

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step

MILLISECONDS = ".ytc-time-ms"


@pytest.mark.platform
def test_the_current_time_readout_shows_milliseconds(markup: MarkupPage) -> None:
    when_i_seek_to(markup, 12.3456)
    then_the_milliseconds_read(markup, ".345")
    when_i_seek_to(markup, 7.05)
    then_the_milliseconds_read(markup, ".050")
    markup.shot_of("readout", [MILLISECONDS], padding=40)


@pytest.mark.platform
def test_the_milliseconds_hide_while_youtube_shows_the_remaining_time(markup: MarkupPage) -> None:
    if markup.host == DEV_SITE_HOST:
        pytest.skip("Video.js shows the remaining time in an element of its own")
    when_i_seek_to(markup, 12.3456)
    when_i_toggle_youtubes_time_display(markup)
    then_the_readout_shows_the_remaining_time(markup, True)
    then_the_milliseconds_read(markup, "")
    when_i_toggle_youtubes_time_display(markup)
    then_the_readout_shows_the_remaining_time(markup, False)
    then_the_milliseconds_read(markup, ".345")


@pytest.mark.feature_flags({"millisecondsInTimeReadout": False})
def test_with_the_flag_off_the_readout_has_no_milliseconds(markup: MarkupPage) -> None:
    when_i_seek_to(markup, 12.3456)
    assert markup.page.locator(MILLISECONDS).count() == 0


@step
def when_i_seek_to(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.next_frames(2)


@step
def when_i_toggle_youtubes_time_display(markup: MarkupPage) -> None:
    # Clicking the time switches YouTube between the current and the remaining time.
    markup.page.locator("#movie_player").hover()
    markup.page.locator("#movie_player .ytp-time-contents").click()


@step
def then_the_readout_shows_the_remaining_time(markup: MarkupPage, remaining: bool) -> None:
    readout = markup.page.locator("#movie_player .ytp-time-current")
    shown = readout.inner_text()
    markup.report(f"readout {shown!r}")
    assert shown.startswith("-") == remaining


@step
def then_the_milliseconds_read(markup: MarkupPage, text: str) -> None:
    shown = markup.page.locator(MILLISECONDS).inner_text()
    markup.report(f"milliseconds {shown!r}")
    assert shown == text
