"""Crop overlay: Ctrl+hover shows the resize cursor, and Ctrl+drag resizes and pans the crop."""

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step


@pytest.mark.platform
def test_crop_drag(markup: MarkupPage) -> None:
    given_a_marker_pair_with_its_editor_open(markup)
    right_edge = when_i_ctrl_hover_the_crop_right_edge(markup)
    then_the_cursor_shows_a_resize(markup)
    crop_before = crop(markup)
    when_i_ctrl_drag_the_edge_inward(markup, right_edge)
    resized = then_the_crop_changed(markup, crop_before, "resize")
    when_i_ctrl_drag_inside_the_crop(markup)
    then_the_crop_changed(markup, resized, "pan")


def crop(markup: MarkupPage) -> str:
    return markup.page.locator("#crop-input").input_value()


@step
def given_a_marker_pair_with_its_editor_open(markup: MarkupPage) -> None:
    markup.add_marker_pair(3, 6)
    markup.open_marker_pair(0)


@step
def when_i_ctrl_hover_the_crop_right_edge(markup: MarkupPage) -> tuple[float, float]:
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] - 4, video["y"] + video["height"] / 2
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x - 20, y)
    markup.page.mouse.move(x, y, steps=3)
    markup.next_frames()  # the hover cursor updates once per frame
    return x, y


@step
def then_the_cursor_shows_a_resize(markup: MarkupPage) -> None:
    cursor = markup.page.locator(markup.host.crop_hook).evaluate("element => element.style.cursor")
    markup.report(f"cursor at the right edge: {cursor!r}")
    assert "resize" in cursor


@step
def when_i_ctrl_drag_the_edge_inward(markup: MarkupPage, edge: tuple[float, float]) -> None:
    x, y = edge
    markup.page.mouse.down()
    markup.page.mouse.move(x - 200, y, steps=8)
    markup.shot("crop-resize-mid-drag")
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")


@step
def when_i_ctrl_drag_inside_the_crop(markup: MarkupPage) -> None:
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] * 0.4, video["y"] + video["height"] / 2
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 80, y, steps=8)
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")
    markup.shot("crop-panned")


@step
def then_the_crop_changed(markup: MarkupPage, before: str, action: str) -> str:
    after = crop(markup)
    markup.report(f"crop after {action}: {before} -> {after}")
    assert after != before
    return after
