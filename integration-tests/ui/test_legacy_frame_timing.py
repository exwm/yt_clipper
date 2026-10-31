"""With the `legacyFrameTiming` flag, the markup times frames as 5.48 did: a marker stores the
playhead, Shift+Mousewheel steps 1/fps from the playhead, a seek to a marker goes to its time, and
the frame rate is never measured. The dev site reports no frame rate, so the rate is the assumed
60 fps, while its test video is 30 fps with frame n starting at exactly n / 30 s."""

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step
from test_crop_easing import when_i_save_the_markers
from test_frame_stepping import (
    VIDEO_FPS,
    given_the_global_settings_editor_is_open,
    when_i_shift_scroll,
)
from test_marker_placement import when_i_jump_to_the_previous_marker

ASSUMED_FPS = 60
pytestmark = pytest.mark.frame_timing("5.48")


def test_markers_store_the_playhead_and_steps_and_jumps_go_by_time(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the assumed 60 fps of a site that reports no frame rate")
    # Late in each frame, where 5.49 would store the frame's start.
    start = when_i_add_a_marker_at(markup, 90.8 / VIDEO_FPS)
    end = when_i_add_a_marker_at(markup, 120.8 / VIDEO_FPS)
    then_the_pair_is_at(markup, start, end)
    when_i_shift_scroll(markup, "up", times=2)
    then_the_playhead_is_at(markup, end + 2 / ASSUMED_FPS)
    # Marker times rounded to 6 decimals, as 5.48 jumped to them.
    when_i_jump_to_the_previous_marker(markup)
    then_the_playhead_is_at(markup, end)
    when_i_jump_to_the_previous_marker(markup)
    then_the_playhead_is_at(markup, start)


def test_the_frame_rate_reads_the_assumed_rate_with_no_way_to_measure_it(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the assumed 60 fps of a site that reports no frame rate")
    # The fixture saves Measure as on, which the flag ignores, and playing would measure 30 fps.
    given_the_video_has_played(markup)
    given_the_global_settings_editor_is_open(markup)
    then_the_frame_rate_reads_with_no_measure_button(markup, f"{ASSUMED_FPS} fps")
    when_i_search_the_palette(markup, "frame rate measurement")
    then_the_palette_lists_no(markup, "Toggle frame rate measurement from playback")


@step
def when_i_add_a_marker_at(markup: MarkupPage, seconds: float) -> float:
    """The playhead the marker is added at, which Chrome can round off the seek's target."""
    markup.seek(seconds, presented=True)
    playhead = markup.current_time()
    markup.press("KeyA")
    return playhead


@step
def then_the_pair_is_at(markup: MarkupPage, start: float, end: float) -> None:
    pair = when_i_save_the_markers(markup)["markerPairs"][0]
    markup.report(f"saved start {pair['start']}, end {pair['end']}")
    assert (pair["start"], pair["end"]) == pytest.approx((start, end), abs=1e-6)


@step
def then_the_playhead_is_at(markup: MarkupPage, seconds: float) -> None:
    playhead = markup.current_time()
    markup.report(f"playhead at {playhead}")
    assert playhead == pytest.approx(seconds, abs=1e-5)


@step
def given_the_video_has_played(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    with markup.untraced():
        markup.play()
        markup.page.wait_for_function(
            "() => document.querySelector('video').currentTime > 3", timeout=5000
        )
        markup.pause()


@step
def then_the_frame_rate_reads_with_no_measure_button(markup: MarkupPage, text: str) -> None:
    markup.shot("frame-rate")
    assert markup.page.inner_text("#global-frame-rate") == text
    assert markup.page.locator("#global-frame-rate-toggle").count() == 0


@step
def when_i_search_the_palette(markup: MarkupPage, search: str) -> None:
    markup.page.click("#shortcutsTableToggleButton")
    markup.page.keyboard.type(search)
    markup.next_frames(2)


@step
def then_the_palette_lists_no(markup: MarkupPage, command: str) -> None:
    markup.shot("palette")
    assert markup.page.get_by_text(command).count() == 0
