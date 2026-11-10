"""The generic site's player keys seek: J/L by 1 s, Left/Right by 5 s, Shift+Left/Right by 10 s, and a
seek indicator shows how far."""

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step


@pytest.mark.parametrize(
    ("key", "seconds"),
    [
        ("KeyJ", -1),
        ("KeyL", 1),
        ("ArrowLeft", -5),
        ("ArrowRight", 5),
        ("Shift+ArrowLeft", -10),
        ("Shift+ArrowRight", 10),
    ],
)
def test_a_seek_key_moves_the_playhead_by_its_step(
    markup: MarkupPage, key: str, seconds: int
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("the generic site's own player keys")
    markup.seek(20, presented=True)
    when_i_press(markup, key)
    then_the_playhead_is_at(markup, 20 + seconds)


@pytest.mark.parametrize(
    ("keys", "direction", "label"),
    [
        (["ArrowRight", "ArrowRight"], "forward", "10s"),
        (["KeyL", "Shift+ArrowRight"], "forward", "11s"),
        (["Shift+ArrowLeft"], "backward", "10s"),
        (["ArrowRight", "ArrowLeft"], "backward", "5s"),
    ],
)
def test_the_seek_indicator_adds_up_seeks_in_one_direction(
    markup: MarkupPage, keys: list[str], direction: str, label: str
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("the generic site's own player keys")
    markup.seek(20, presented=True)
    for key in keys:
        when_i_press(markup, key)
    then_the_seek_indicator_shows(markup, direction, label)
    markup.shot(f"seek-indicator-{direction}")
    then_the_seek_indicator_closes(markup)


@pytest.mark.parametrize("key", ["ArrowRight", "Shift+ArrowRight"])
def test_arrow_crop_adjustment_keeps_the_arrows_from_seeking(markup: MarkupPage, key: str) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("the generic site's own player keys")
    markup.seek(20, presented=True)
    given_arrow_crop_adjustment_is_on_in_the_global_settings_editor(markup)
    when_i_press(markup, key)
    then_the_playhead_is_at(markup, 20)


def test_the_arrows_change_a_focused_dropdown_instead_of_seeking(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("the generic site's own player keys")
    markup.seek(20, presented=True)
    given_the_loop_dropdown_is_focused_in_the_global_settings_editor(markup)
    when_i_press(markup, "ArrowRight")
    then_the_playhead_is_at(markup, 20)


@step
def given_arrow_crop_adjustment_is_on_in_the_global_settings_editor(markup: MarkupPage) -> None:
    markup.press("KeyW")
    markup.page.wait_for_selector("#global-frame-rate")
    markup.press("Alt+KeyX")


@step
def given_the_loop_dropdown_is_focused_in_the_global_settings_editor(markup: MarkupPage) -> None:
    markup.press("KeyW")
    markup.page.wait_for_selector("#global-frame-rate")
    markup.press("Shift+KeyW")  # the advanced settings hold the loop dropdown
    markup.page.focus("#loop-input")


@step
def when_i_press(markup: MarkupPage, key: str) -> None:
    markup.press(key)
    markup.eventually("() => !document.querySelector('video').seeking")


@step
def then_the_playhead_is_at(markup: MarkupPage, seconds: float) -> None:
    time = markup.current_time()
    markup.report(f"time {time}")
    assert time == pytest.approx(seconds, abs=0.05)


@step
def then_the_seek_indicator_shows(markup: MarkupPage, direction: str, label: str) -> None:
    shown = markup.page.evaluate(
        """() => {
            const indicator = document.getElementById('ytc-seek-indicator');
            return [indicator.hasAttribute('data-open'), indicator.dataset.direction, indicator.textContent.trim()];
        }"""
    )
    markup.report(f"seek indicator {shown}")
    assert shown == [True, direction, label]


@step
def then_the_seek_indicator_closes(markup: MarkupPage) -> None:
    closed = markup.eventually(
        "() => !document.getElementById('ytc-seek-indicator').hasAttribute('data-open')", timeout_ms=2000
    )
    assert closed, "the seek indicator stays open"
