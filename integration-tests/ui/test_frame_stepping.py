"""Frame stepping: on a site that reports no frame rate, Shift+Mousewheel steps one frame of the
video, at the rate measured from played frames. The dev site's test video is 30 fps."""

import math

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step

VIDEO_FPS = 30


# Starts on a frame boundary, where a step by one frame duration can show the same frame again.
def test_shift_mousewheel_steps_one_frame_at_a_time_at_the_measured_frame_rate(
    markup: MarkupPage,
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks a site that reports no frame rate; YouTube's stats report one")
    given_the_video_has_played_until_its_frame_rate_is_measured(markup)
    when_i_pause_on_a_frame(markup, 90)
    forward = when_i_shift_scroll(markup, "up", times=40)
    backward = when_i_shift_scroll(markup, "down", times=10)
    then_the_frames_shown_are(markup, forward, list(range(91, 131)))
    then_the_frames_shown_are(markup, backward, list(range(129, 119, -1)))


# On YouTube the measured rate refines the stats rate, whatever the video's rate.
@pytest.mark.platform
def test_the_measured_frame_rate_flashes_once_the_video_plays(markup: MarkupPage) -> None:
    rate = f"{VIDEO_FPS} fps." if markup.host == DEV_SITE_HOST else ""
    with markup.untraced():
        given_the_video_is_playing(markup)
        then_a_flash_says(markup, f"Measured the frame rate: {rate}")


def test_the_command_palette_turns_frame_rate_measurement_off(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("checks the 60 fps default of a site that reports no frame rate")
    when_i_run_the_palette_command(markup, "frame rate measurement")
    then_a_flash_says(markup, "Frame rate measurement off. Using 60 fps.")


@step
def when_i_run_the_palette_command(markup: MarkupPage, search: str) -> None:
    markup.page.click("#shortcutsTableToggleButton")
    markup.page.keyboard.type(search)
    markup.press("Enter")


@step
def then_a_flash_says(markup: MarkupPage, message: str) -> None:
    markup.page.get_by_text(message).first.wait_for(timeout=5000)
    markup.shot("flash")


@step
def given_the_video_is_playing(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    markup.play()


# Waits for the measurement itself: a fixed stretch of playback can hold too few frames in a row,
# after Chrome's periodic dropped frames or a late start of the markup.
@step
def given_the_video_has_played_until_its_frame_rate_is_measured(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    with markup.untraced():
        markup.play()
        markup.page.get_by_text(f"Measured the frame rate: {VIDEO_FPS} fps.").first.wait_for(
            timeout=5000
        )
        markup.pause()


@step
def when_i_pause_on_a_frame(markup: MarkupPage, frame: int) -> None:
    markup.seek(frame / VIDEO_FPS, presented=True)


@step
def when_i_shift_scroll(markup: MarkupPage, direction: str, times: int) -> list[int]:
    """The frame each step shows. The test video's frame n starts at exactly n / 30 s, so a seek
    shows frame floor(playhead * 30); a playhead on a boundary can show either neighbor, which is
    what the floor of a target like 91 / 30 = 3.0333... (frame 90.999...) reveals. (Headless Chrome
    presents a paused video's frame only when the page next renders, so frame callbacks lag.)"""
    markup.page.mouse.move(*markup.center_of("video"))
    frames = []
    for _ in range(times):
        markup.page.keyboard.down("Shift")
        markup.page.mouse.wheel(0, -100 if direction == "up" else 100)
        markup.page.keyboard.up("Shift")
        markup.next_frames(2)
        frames.append(math.floor(markup.current_time() * VIDEO_FPS))
    return frames


@step
def then_the_frames_shown_are(markup: MarkupPage, shown: list[int], expected: list[int]) -> None:
    markup.report(f"frames shown {shown}")
    assert shown == expected
