"""Frame stepping: on a site that reports no frame rate, Shift+Mousewheel steps one frame of the
video, at the rate measured from played frames. The dev site's test video is 30 fps."""

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step

VIDEO_FPS = 30


def test_shift_mousewheel_steps_one_frame_at_the_measured_frame_rate(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("YouTube reports its frame rate, so nothing is measured there")
    given_the_video_has_played_a_moment(markup)
    before = when_i_pause_on_a_frame(markup, 90)
    when_i_shift_scroll_up_once(markup)
    then_the_playhead_moved_one_frame(markup, before)


@step
def given_the_video_has_played_a_moment(markup: MarkupPage) -> None:
    markup.seek(2, presented=True)
    markup.play()
    assert markup.eventually("() => document.querySelector('video').currentTime > 2.6")
    markup.pause()


@step
def when_i_pause_on_a_frame(markup: MarkupPage, frame: int) -> float:
    markup.seek(frame / VIDEO_FPS, presented=True)
    return markup.current_time()


@step
def when_i_shift_scroll_up_once(markup: MarkupPage) -> None:
    markup.page.mouse.move(*markup.center_of("video"))
    markup.page.keyboard.down("Shift")
    markup.page.mouse.wheel(0, -100)
    markup.page.keyboard.up("Shift")
    markup.next_frames(3)


@step
def then_the_playhead_moved_one_frame(markup: MarkupPage, before: float) -> None:
    step_seconds = markup.current_time() - before
    markup.report(f"shift+mousewheel step {step_seconds * VIDEO_FPS:.2f} frames")
    assert step_seconds == pytest.approx(1 / VIDEO_FPS, abs=0.002)
