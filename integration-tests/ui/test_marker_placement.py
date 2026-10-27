"""Marker placement: a marker marks the frame on screen, saved as the start of that frame, and
Alt+Shift+Mousewheel moves it one frame. The dev site's test video is 30 fps, with frame n starting
at exactly n / 30 s."""

import math

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step
from test_crop_easing import when_i_save_the_markers
from test_frame_stepping import (
    VIDEO_FPS,
    given_the_video_has_played_until_its_frame_rate_is_measured,
)


def test_a_marker_marks_the_start_of_the_frame_shown_and_moves_one_frame_at_a_time(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks a site that reports no frame rate; YouTube's stats report one")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    when_i_add_a_marker_pair_on_frames(markup, 90, 120)
    then_the_pair_spans_frames(markup, 90, 120)
    when_i_nudge_the_start_marker_forward(markup, times=3)
    then_the_video_shows_frame(markup, 93)
    then_the_pair_spans_frames(markup, 93, 120)


def test_ctrl_left_jumps_to_each_earlier_markers_frame(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks a site that reports no frame rate; YouTube's stats report one")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    when_i_add_a_marker_pair_on_frames(markup, 90, 120)
    markup.seek(150.5 / VIDEO_FPS, presented=True)
    when_i_jump_to_the_previous_marker(markup)
    then_the_video_shows_frame(markup, 120)
    when_i_jump_to_the_previous_marker(markup)
    then_the_video_shows_frame(markup, 90)


@step
def when_i_jump_to_the_previous_marker(markup: MarkupPage) -> None:
    # Two presses within 150 ms skip a marker.
    markup.page.wait_for_timeout(200)
    markup.press("Control+ArrowLeft")
    markup.eventually("() => !document.querySelector('video').seeking")
    markup.next_frames(2)


@step
def when_i_add_a_marker_pair_on_frames(markup: MarkupPage, start: int, end: int) -> None:
    """Pauses late in each frame, where the playhead is most of a frame past the frame's start."""
    for frame in (start, end):
        markup.seek((frame + 0.8) / VIDEO_FPS, presented=True)
        markup.press("KeyA")
    markup.open_marker_pair(0)


@step
def when_i_nudge_the_start_marker_forward(markup: MarkupPage, times: int) -> None:
    # The left half of the page moves the start marker.
    markup.page.mouse.move(10, markup.center_of("video")[1])
    markup.page.keyboard.down("Alt")
    markup.page.keyboard.down("Shift")
    for _ in range(times):
        markup.page.mouse.wheel(0, -100)
        # The nudge is ignored while a seek is in flight.
        markup.eventually("() => !document.querySelector('video').seeking")
        markup.next_frames(2)
    markup.page.keyboard.up("Shift")
    markup.page.keyboard.up("Alt")


@step
def then_the_video_shows_frame(markup: MarkupPage, frame: int) -> None:
    position = markup.current_time() * VIDEO_FPS
    markup.report(f"playhead at frame {position:.3f}")
    # A seek to a frame lands just past its start, where the frame it shows is the frame its time means.
    assert math.floor(position) == frame


@step
def then_the_pair_spans_frames(markup: MarkupPage, start: int, end: int) -> None:
    pair = when_i_save_the_markers(markup)["markerPairs"][0]
    markup.report(f"saved start {pair['start']}, end {pair['end']}")
    assert (pair["start"], pair["end"]) == pytest.approx(
        (start / VIDEO_FPS, end / VIDEO_FPS), abs=1e-5
    )
