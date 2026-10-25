"""Feature flags popup of local builds: the flask button in the markers toolbar lists the flags, a
change is kept in the browser and marked, and Reset all clears it. CI builds leave it out."""

import json

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step

POPUP = "#ytc-feature-flags-popover"
TIMING_SELECT = f"{POPUP} label:has-text('videoFrameLoopTiming') select"
STORAGE_KEY = "yt_clipper_feature_flags"


@pytest.mark.local_build
def test_the_feature_flags_popup_keeps_a_change_until_reset(markup: MarkupPage) -> None:
    given_a_marker_pair_editor(markup)
    when_i_open_the_feature_flags_popup(markup)
    when_i_choose_the_frame_loop_timing(markup, "frameCallback")
    then_the_stored_flags_are(markup, {"videoFrameLoopTiming": "frameCallback"})
    then_the_changed_flags_are(markup, ["videoFrameLoopTiming"])
    markup.shot_of("feature-flags-popup", [POPUP])
    when_i_reset_all_flags(markup)
    then_the_stored_flags_are(markup, None)
    then_the_changed_flags_are(markup, [])


@step
def given_a_marker_pair_editor(markup: MarkupPage) -> None:
    markup.add_marker_pair(3, 6)
    markup.open_marker_pair(0)


@step
def when_i_open_the_feature_flags_popup(markup: MarkupPage) -> None:
    markup.reveal("#toggle-feature-flags")
    markup.page.click("#toggle-feature-flags")
    markup.page.wait_for_selector(POPUP, state="visible")


@step
def when_i_choose_the_frame_loop_timing(markup: MarkupPage, timing: str) -> None:
    markup.page.select_option(TIMING_SELECT, timing)


@step
def when_i_reset_all_flags(markup: MarkupPage) -> None:
    markup.page.click(f"{POPUP} .ytc-feature-flags-reset")


@step
def then_the_stored_flags_are(markup: MarkupPage, expected: dict | None) -> None:
    stored = markup.page.evaluate("(key) => localStorage.getItem(key)", STORAGE_KEY)
    assert (json.loads(stored) if stored else None) == expected


@step
def then_the_changed_flags_are(markup: MarkupPage, expected: list[str]) -> None:
    changed = markup.page.locator(f"{POPUP} .ytc-feature-flag.changed > span").all_inner_texts()
    assert changed == expected
