"""Marker placement: a marker marks the start of the frame of the playhead, and
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
    frames_per_step,
    given_the_video_has_played_until_its_frame_rate_is_measured,
    then_a_flash_says,
)


def test_a_marker_marks_the_start_of_the_playheads_frame_and_moves_one_frame_at_a_time(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks a site that reports no frame rate; YouTube's stats report one")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    when_i_add_a_marker_pair_on_frames(markup, 90, 120)
    then_the_pair_is_at(markup, 90 / VIDEO_FPS, 120 / VIDEO_FPS)
    then_the_pair_spans_frames(markup, 90, 120)
    when_i_nudge_the_start_marker_forward(markup, times=3)
    nudged_to = 90 + math.floor(3 * frames_per_step(markup))
    then_the_video_shows_frame(markup, nudged_to)
    then_the_pair_spans_frames(markup, nudged_to, 120)


# A pair needs its end marker after its start marker's frame: a second A on the same frame is refused.
def test_a_second_a_on_the_start_markers_frame_is_refused(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test video frame times")
    for into_frame in (0.2, 0.8):
        markup.seek((90 + into_frame) / VIDEO_FPS, presented=True)
        markup.press("KeyA")
    then_a_flash_says(markup, "End marker must be after start marker.")
    assert when_i_save_the_markers(markup)["markerPairs"] == []


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


# Far apart on the 40 minute test video, so the pair's two numbers don't overlap on the progress bar.
DYNAMIC_CROP_PAIR = {
    "start": 600,
    "end": 900,
    "crop": "0:0:960:540",
    "cropMap": [
        {"x": 600, "y": 0, "crop": "0:0:960:540"},
        {"x": 750, "y": 0, "crop": "300:0:960:540"},
        {"x": 900, "y": 0, "crop": "900:0:960:540"},
    ],
}


@pytest.mark.parametrize("with_speed_chart", [True, False], ids=["speed chart shown", "no chart"])
def test_alt_dragging_a_pairs_end_number_moves_its_end_marker_and_crop_map(
    markup: MarkupPage, with_speed_chart: bool
) -> None:
    given_a_pair_with_its_editor_open(markup, DYNAMIC_CROP_PAIR)
    if with_speed_chart:
        given_the_speed_chart_is_shown(markup)
    when_i_alt_drag_a_number(markup, "end", pixels=40)
    then_the_crop_map_ends_on_the_end_marker_past(markup, DYNAMIC_CROP_PAIR["end"])


# Close enough on the progress bar that a drag carries one number past the other.
CLOSE_PAIR = {
    "start": 300,
    "end": 400,
    "crop": "0:0:960:540",
    "cropMap": [
        {"x": 300, "y": 0, "crop": "0:0:960:540"},
        {"x": 400, "y": 0, "crop": "900:0:960:540"},
    ],
    "speedMap": [{"x": 300, "y": 0.5}, {"x": 350, "y": 1}, {"x": 400, "y": 0.5}],
}


@pytest.mark.parametrize(("numbering", "pixels"), [("start", 200), ("end", -200)])
def test_alt_dragging_a_number_past_the_other_stops_a_frame_short_and_moves_the_crop_map(
    markup: MarkupPage, numbering: str, pixels: float
) -> None:
    given_a_pair_with_its_editor_open(markup, CLOSE_PAIR)
    when_i_alt_drag_a_number(markup, numbering, pixels)
    then_the_crop_map_spans_the_pair_of_more_than_one_frame(markup)


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
    assert (math.floor(pair["start"] * VIDEO_FPS), math.floor(pair["end"] * VIDEO_FPS)) == (
        start,
        end,
    )


@step
def then_the_pair_is_at(markup: MarkupPage, start: float, end: float) -> None:
    pair = when_i_save_the_markers(markup)["markerPairs"][0]
    assert (pair["start"], pair["end"]) == pytest.approx((start, end), abs=1e-5)


@step
def given_a_pair_with_its_editor_open(markup: MarkupPage, pair: dict) -> None:
    markup.load_saved_marker_pairs([pair])
    markup.open_marker_pair(0)


@step
def given_the_speed_chart_is_shown(markup: MarkupPage) -> None:
    markup.press("KeyD")
    markup.page.wait_for_selector("#speedChartCanvas", state="visible")


@step
def when_i_alt_drag_a_number(markup: MarkupPage, numbering: str, pixels: float) -> None:
    x, y = markup.center_of(f"#marker-numberings-div text[data-idx='1'].{numbering}MarkerNumbering")
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Alt")
    markup.page.mouse.down()
    markup.page.mouse.move(x + pixels, y, steps=6)
    markup.page.mouse.up()
    markup.page.keyboard.up("Alt")
    markup.next_frames()


@step
def then_the_crop_map_ends_on_the_end_marker_past(markup: MarkupPage, seconds: float) -> None:
    pair = when_i_save_the_markers(markup)["markerPairs"][0]
    markup.report(f"saved end {pair['end']}, last crop point at {pair['cropMap'][-1]['x']}")
    assert pair["end"] > seconds
    # Only the move on release stretches the crop map to the new end.
    assert pair["cropMap"][-1]["x"] == pytest.approx(pair["end"], abs=1e-3)


@step
def then_the_crop_map_spans_the_pair_of_more_than_one_frame(markup: MarkupPage) -> None:
    pair = when_i_save_the_markers(markup)["markerPairs"][0]
    crop_map_edges = (pair["cropMap"][0]["x"], pair["cropMap"][-1]["x"])
    markup.report(f"saved start {pair['start']}, end {pair['end']}, crop map {crop_map_edges}")
    # Unmeasured, frames are those of the assumed 60 fps: two of them can share a video frame.
    assert pair["start"] < pair["end"]
    assert crop_map_edges == pytest.approx((pair["start"], pair["end"]), abs=1e-3)
