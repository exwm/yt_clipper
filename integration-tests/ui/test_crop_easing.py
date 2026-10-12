"""Crop easing (5.49): the Crop Easing setting changes how the preview moves between crop points, a
pair keeps its chosen mode, and Cinematic bakes a path whose margins live in a gear modal."""

import json
from pathlib import Path

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step

EASING_SELECT = "#crop-point-easing-input"
GEAR_BUTTON = "#cinematic-settings-modal-button"
MARGIN_INPUT = "#cinematic-margin-input"

# A pan right and back with uneven spacing, so the easing modes differ between points.
PAN_PAIR = {
    "start": 3,
    "end": 9,
    "crop": "0:0:960:540",
    "cropMap": [
        {"x": 3, "y": 0, "crop": "0:0:960:540"},
        {"x": 4, "y": 0, "crop": "300:0:960:540"},
        {"x": 7, "y": 0, "crop": "900:0:960:540"},
        {"x": 9, "y": 0, "crop": "100:0:960:540"},
    ],
}
OTHER_PAIR = {"start": 12, "end": 14}
# Between the first two points, where the modes ease differently.
BETWEEN_POINTS_TIME = 3.6


@pytest.fixture
def dynamic_pan(markup: MarkupPage) -> MarkupPage:
    given_a_pair_with_a_dynamic_pan_and_its_editor_open(markup)
    return markup


def test_easing_mode_changes_the_previewed_crop_between_points(dynamic_pan: MarkupPage) -> None:
    when_i_choose_easing(dynamic_pan, "smoothInOut")
    ease_in_out = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    when_i_choose_easing(dynamic_pan, "smoothTrack")
    smooth_track = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    then_the_crops_differ(dynamic_pan, ease_in_out, smooth_track)


def test_a_pair_keeps_its_easing_mode(dynamic_pan: MarkupPage) -> None:
    when_i_choose_easing(dynamic_pan, "smoothInOut")
    when_i_reopen_the_pair(dynamic_pan)
    then_the_easing_select_shows(dynamic_pan, "smoothInOut")


def test_saving_keeps_a_pairs_own_easing_only_when_it_overrides_the_global_setting(
    dynamic_pan: MarkupPage,
) -> None:
    when_i_choose_easing(dynamic_pan, "smoothInOut")
    saved = when_i_save_the_markers(dynamic_pan)
    then_the_saved_easing_is(saved, "smoothTrack", ["smoothInOut", None])


def test_cinematic_bakes_a_path_and_its_gear_shows_the_current_margins(
    dynamic_pan: MarkupPage,
) -> None:
    then_the_cinematic_gear_is_hidden(dynamic_pan)
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    when_i_set_the_cinematic_margin(dynamic_pan, "80")
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_cinematic_margin_shows(dynamic_pan, "80")


def test_the_cinematic_settings_close_with_their_editor(dynamic_pan: MarkupPage) -> None:
    # Left open, they would write to the pair whose editor is gone.
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    when_i_switch_to_the_global_settings_editor(dynamic_pan)
    then_the_cinematic_settings_are_closed(dynamic_pan)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_a_pair_with_a_dynamic_pan_and_its_editor_open(markup: MarkupPage) -> None:
    markup.load_saved_marker_pairs([PAN_PAIR, OTHER_PAIR])
    markup.open_marker_pair(0)
    # The crop chart's preview loop drives the crop chip that reports the previewed crop.
    markup.press("Alt+KeyD")
    markup.page.wait_for_selector("#cropChartCanvas")
    show_additional_settings(markup)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_choose_easing(markup: MarkupPage, mode: str) -> None:
    markup.page.select_option(EASING_SELECT, mode)
    markup.next_frames()


@step
def when_i_save_the_markers(markup: MarkupPage) -> dict:
    # The save shortcut is ignored while a form field has focus.
    markup.page.evaluate("() => document.activeElement?.blur()")
    with markup.page.expect_download() as download:
        markup.press("KeyS")
    return json.loads(Path(download.value.path()).read_text(encoding="utf-8"))


@step
def when_i_reopen_the_pair(markup: MarkupPage) -> None:
    markup.open_marker_pair(1)
    markup.page.wait_for_function(
        "id => document.querySelector(id)?.value === 'Default'",
        arg=EASING_SELECT,
    )
    markup.open_marker_pair(0)
    show_additional_settings(markup)


@step
def when_i_set_the_cinematic_margin(markup: MarkupPage, value: str) -> None:
    markup.page.click(GEAR_BUTTON)
    markup.page.fill(MARGIN_INPUT, value)
    markup.page.dispatch_event(MARGIN_INPUT, "change")
    markup.page.keyboard.press("Escape")
    markup.page.wait_for_selector(MARGIN_INPUT, state="detached")


@step
def when_i_reopen_the_cinematic_settings(markup: MarkupPage) -> None:
    markup.page.click(GEAR_BUTTON)
    markup.page.wait_for_selector(MARGIN_INPUT)
    markup.shot("cinematic-settings")


@step
def when_i_switch_to_the_global_settings_editor(markup: MarkupPage) -> None:
    # Shortcuts are ignored while a form field has focus.
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.press("KeyW")


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_crops_differ(markup: MarkupPage, first: float, second: float) -> None:
    markup.report(f"crop x {first} vs {second}")
    assert abs(first - second) >= 1


@step
def then_the_easing_select_shows(markup: MarkupPage, mode: str) -> None:
    assert markup.page.locator(EASING_SELECT).input_value() == mode


@step
def then_the_saved_easing_is(saved: dict, globalEasing: str, pairEasings: list[str | None]) -> None:
    # The global setting is saved even when unset, as the preview showed it; a pair only when it
    # overrides it, so changing the global setting still reaches the other pairs after a reload.
    assert saved["cropPointEasing"] == globalEasing
    assert [
        pair.get("overrides", {}).get("cropPointEasing") for pair in saved["markerPairs"]
    ] == pairEasings


@step
def then_the_cinematic_gear_is_hidden(markup: MarkupPage) -> None:
    assert not markup.page.locator(GEAR_BUTTON).is_visible()


@step
def then_a_cinematic_path_is_baked(markup: MarkupPage) -> None:
    assert markup.page.locator(GEAR_BUTTON).is_visible()
    # The bake runs after edits settle and reports itself in a flash message.
    markup.page.get_by_text("Cinematic path:").first.wait_for(timeout=5000)


@step
def then_the_cinematic_margin_shows(markup: MarkupPage, value: str) -> None:
    assert markup.page.locator(MARGIN_INPUT).input_value() == value


@step
def then_the_cinematic_settings_are_closed(markup: MarkupPage) -> None:
    markup.page.wait_for_selector(MARGIN_INPUT, state="detached", timeout=2000)


# ─── page state ─────────────────────────────────────────────────────────────


def show_additional_settings(markup: MarkupPage) -> None:
    """The easing setting lives in the editor's additional settings (Shift+W), which stay toggled."""
    if not markup.page.locator(EASING_SELECT).is_visible():
        markup.press("Shift+KeyW")
    markup.reveal(EASING_SELECT)


def previewed_crop_x_at(markup: MarkupPage, seconds: float) -> float:
    """The crop chip's live crop x at `seconds` (the preview's interpolated crop)."""
    # Seek away first: a seek to the current time presents no new frame, so the chip would not update.
    markup.seek(PAN_PAIR["start"])
    markup.seek(seconds)
    markup.next_frames(3)
    chip = markup.page.locator("#interp-crop-value").inner_text()
    return float(chip.split(":")[0])
