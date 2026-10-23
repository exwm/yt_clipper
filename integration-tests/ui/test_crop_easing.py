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
ZOOM_MARGIN_INPUT = "#cinematic-zoom-margin-input"

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
# PAN_PAIR's crop points, after ZOOM_PAIR.
LATER_PAN_PAIR = {
    **PAN_PAIR,
    "start": 12,
    "end": 18,
    "cropMap": [{**point, "x": point["x"] + 9} for point in PAN_PAIR["cropMap"]],
}
# Zooms in from the full frame and back out part of the way.
ZOOM_PAIR = {
    "start": 3,
    "end": 9,
    "crop": "0:0:1920:1080",
    "enableZoomPan": True,
    "cropMap": [
        {"x": 3, "y": 0, "crop": "0:0:1920:1080"},
        {"x": 5, "y": 0, "crop": "480:270:960:540"},
        {"x": 9, "y": 0, "crop": "240:135:1440:810"},
    ],
}
# Between the first two points, where the modes ease differently. A frame of the 30 fps test video,
# so a paused redraw at the current time matches the frame on screen.
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


def test_moving_the_start_marker_between_points_keeps_the_previewed_crop(
    dynamic_pan: MarkupPage,
) -> None:
    previewed = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    when_i_move_the_start_marker_to_the_current_time(dynamic_pan)
    saved = when_i_save_the_markers(dynamic_pan)
    then_the_first_crop_point_is_at(saved, BETWEEN_POINTS_TIME, previewed)


def test_moving_the_start_marker_keeps_a_pans_crop_size(dynamic_pan: MarkupPage) -> None:
    # At 3.125 s (the dev site reports 60 fps) Smooth Track eases the unchanged size to 959.999...,
    # which was once stored as 959: the pan then rendered as a zoom.
    previewed_crop_x_at(dynamic_pan, 3.125)
    when_i_move_the_start_marker_to_the_current_time(dynamic_pan)
    saved = when_i_save_the_markers(dynamic_pan)
    then_every_crop_point_has_the_size(saved, "960:540")


def test_a_paused_preview_shows_the_cinematic_path_once_it_is_solved(
    dynamic_pan: MarkupPage,
) -> None:
    smooth_track = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    paused = shown_crop_x(dynamic_pan)
    cinematic = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    then_the_crops_differ(dynamic_pan, smooth_track, cinematic)
    then_the_crops_match(dynamic_pan, paused, cinematic)


def test_a_paused_preview_follows_a_cinematic_margin_change(dynamic_pan: MarkupPage) -> None:
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    before = previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    when_i_set_the_cinematic_margin(dynamic_pan, "45")
    then_the_shown_crop_changes_from(dynamic_pan, before)
    then_the_crops_match(
        dynamic_pan, shown_crop_x(dynamic_pan), previewed_crop_x_at(dynamic_pan, BETWEEN_POINTS_TIME)
    )


def test_cinematic_bakes_a_path_and_its_gear_shows_the_current_margins(
    dynamic_pan: MarkupPage,
) -> None:
    when_i_choose_easing(dynamic_pan, "smoothInOut")
    then_the_cinematic_gear_is_shown(dynamic_pan)
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    when_i_set_the_cinematic_margin(dynamic_pan, "20")
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_cinematic_margin_shows(dynamic_pan, "20")


def test_a_strength_preset_sets_both_margins_and_custom_restores_typed_ones(
    dynamic_pan: MarkupPage,
) -> None:
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_active_strength_is(dynamic_pan, "Medium")
    when_i_type_the_cinematic_margin(dynamic_pan, "9")
    then_the_active_strength_is(dynamic_pan, "Custom")
    when_i_click_the_strength(dynamic_pan, "Strong")
    then_the_margins_show(dynamic_pan, "20", "15")
    then_the_active_strength_is(dynamic_pan, "Strong")
    then_the_margin_pixels_show(dynamic_pan, "≈ 108 px", "≈ ±144 px width")
    when_i_click_the_strength(dynamic_pan, "Custom")
    then_the_margins_show(dynamic_pan, "9", "")
    # Medium is the inherited default, so choosing it clears the pair's own margins.
    when_i_click_the_strength(dynamic_pan, "Medium")
    then_the_margins_show(dynamic_pan, "", "")
    then_the_active_strength_is(dynamic_pan, "Medium")
    then_the_pair_saves_the_margins(when_i_save_the_markers(dynamic_pan), None, None)


def test_the_path_plot_shows_the_zoom_with_its_margin(markup: MarkupPage) -> None:
    given_pairs_with_the_first_ones_editor_open(markup, [ZOOM_PAIR, LATER_PAN_PAIR])
    when_i_choose_easing(markup, "cinematic")
    then_a_cinematic_path_is_baked(markup)
    when_i_reopen_the_cinematic_settings(markup)
    all_lanes = then_the_plot_shows_the_cinematic_path_on(markup, "x,y,zoom")
    height = plot_height(markup)
    when_i_toggle_the_plot_axis(markup, "x")
    when_i_toggle_the_plot_axis(markup, "y")
    zoom = then_the_plot_shows_the_cinematic_path_on(markup, "zoom", unlike=all_lanes)
    # Fewer lanes share the plot's height, so the popover does not jump.
    assert plot_height(markup) == height
    # The last lane shown stays.
    when_i_toggle_the_plot_axis(markup, "zoom")
    then_the_plot_shows_the_cinematic_path_on(markup, "zoom")
    # Dragging the zoom margin previews its band; with the path unsolved, only the band differs.
    when_i_drag_the_margin_slider_to(markup, ZOOM_MARGIN_INPUT, "30")
    at_30 = then_the_plot_redraws(markup, unlike=zoom)
    when_i_drag_the_margin_slider_to(markup, ZOOM_MARGIN_INPUT, "60")
    then_the_plot_redraws(markup, unlike=at_30)
    when_i_release_the_margin_slider(markup, ZOOM_MARGIN_INPUT)
    then_the_plot_shows_the_cinematic_path_on(markup, "zoom", unlike=zoom)
    # A pan-only pair has no zoom, so it shows the lanes it has.
    when_i_open_the_cinematic_settings_of_pair(markup, 1)
    then_the_plot_shows_the_cinematic_path_on(markup, "x,y")


def test_the_path_plot_redraws_after_a_preset_solves_and_switches_axis(
    dynamic_pan: MarkupPage,
) -> None:
    when_i_choose_easing(dynamic_pan, "cinematic")
    then_a_cinematic_path_is_baked(dynamic_pan)
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x,y")
    then_the_cinematic_settings_fit_in_the_window(dynamic_pan)
    # The crop points span 3 to 9 s, and the time axis sits inside 4 px of padding.
    when_i_right_click_the_plot_at(dynamic_pan, 0.1)
    then_the_video_is_at(dynamic_pan, 3.6)
    when_i_right_click_the_plot_at(dynamic_pan, -0.01)
    then_the_video_is_at(dynamic_pan, 3)
    # Taken after the seeks, so the next comparison differs only by the path, not the playhead.
    medium = then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x,y")
    when_i_click_the_strength(dynamic_pan, "Weak")
    weak = then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x,y", unlike=medium)
    then_the_zoom_toggle_is_hidden(dynamic_pan)
    when_i_toggle_the_plot_axis(dynamic_pan, "y")
    horizontal = then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x", unlike=weak)
    # Dragging previews the margin; only the release saves it.
    when_i_drag_the_margin_slider_to(dynamic_pan, MARGIN_INPUT, "30")
    then_the_margins_show(dynamic_pan, "30", "4")
    then_the_pair_saves_the_margins(when_i_save_the_markers(dynamic_pan), 6, 4)
    when_i_release_the_margin_slider(dynamic_pan, MARGIN_INPUT)
    when_i_drag_the_margin_slider_to(dynamic_pan, ZOOM_MARGIN_INPUT, "25")
    when_i_release_the_margin_slider(dynamic_pan, ZOOM_MARGIN_INPUT)
    then_the_margins_show(dynamic_pan, "30", "25")
    then_the_margin_pixels_show(dynamic_pan, "≈ 162 px", "≈ ±240 px width")
    then_the_pair_saves_the_margins(when_i_save_the_markers(dynamic_pan), 30, 25)
    wider = then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x", unlike=horizontal)
    when_i_toggle_the_plot_axis(dynamic_pan, "y")
    when_i_toggle_the_plot_axis(dynamic_pan, "x")
    vertical = then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "y", unlike=wider)
    when_i_click_the_legend(dynamic_pan, "cinematic")
    then_the_plot_shows_the_layer(dynamic_pan, "cinematic", shown=False, unlike=vertical)
    when_i_click_the_legend(dynamic_pan, "cinematic")
    then_the_plot_shows_the_layer(dynamic_pan, "cinematic", shown=True, like=vertical)


def test_the_cinematic_settings_switch_between_smooth_track_and_cinematic(
    dynamic_pan: MarkupPage,
) -> None:
    # Smooth Track is the default easing, and its gear opens the same settings.
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_plot_shows_the_cinematic_path_on(dynamic_pan, "x,y")
    then_the_easing_is(dynamic_pan, "smoothTrack", previewing_cinematic=False, selected="Default")
    when_i_switch_the_easing_in_the_settings(dynamic_pan, "cinematic")
    then_the_easing_is(dynamic_pan, "cinematic", previewing_cinematic=True)
    when_i_switch_the_easing_in_the_settings(dynamic_pan, "smoothTrack")
    # Back on the easing it inherits, the pair follows the global setting again.
    then_the_easing_is(dynamic_pan, "smoothTrack", previewing_cinematic=False, selected="Default")
    when_i_switch_the_easing_in_the_settings(dynamic_pan, "smoothInOut")
    then_the_easing_is(dynamic_pan, "smoothInOut", previewing_cinematic=False)
    # Choosing in the editor's own select by keyboard (a click outside closes them) keeps the settings
    # open and shows the choice there too.
    when_i_choose_easing(dynamic_pan, "Default")
    then_the_easing_is(dynamic_pan, "smoothTrack", previewing_cinematic=False, selected="Default")
    then_the_saved_easing_is(when_i_save_the_markers(dynamic_pan), "smoothTrack", [None, None])


def test_a_fractional_margin_from_a_markers_json_is_saved_through_presets_and_custom(
    markup: MarkupPage,
) -> None:
    # The markers JSON allows any margin in range, so the input must accept what it loads.
    given_a_pair_with_a_fractional_margin_and_its_editor_open(markup)
    when_i_reopen_the_cinematic_settings(markup)
    then_the_margin_input_is_valid(markup)
    when_i_type_the_cinematic_zoom_margin(markup, "10")
    when_i_click_the_strength(markup, "Strong")
    when_i_click_the_strength(markup, "Custom")
    then_the_pair_saves_the_margins(when_i_save_the_markers(markup), 12.5, 10)


def test_the_pixel_hints_follow_a_crop_undone_with_the_settings_open(dynamic_pan: MarkupPage) -> None:
    # A new crop size applies to every crop point of the pair.
    when_i_set_the_crop(dynamic_pan, "0:0:480:270")
    when_i_reopen_the_cinematic_settings(dynamic_pan)
    then_the_pan_margin_pixels_become(dynamic_pan, "≈ 32 px")
    when_i_undo_until_the_crop_is(dynamic_pan, "0:0:960:540")
    then_the_pan_margin_pixels_become(dynamic_pan, "≈ 65 px")


@pytest.mark.parametrize("easing", ["smoothTrack", "cinematic"])
def test_a_loaded_dynamic_crop_previews_its_eased_crop_before_the_crop_chart_opens(
    markup: MarkupPage, easing: str
) -> None:
    given_a_pair_with_a_dynamic_pan_and_its_editor_open_without_the_crop_chart(markup)
    when_i_choose_easing(markup, easing)
    if easing == "cinematic":
        then_a_cinematic_path_is_baked(markup)
    # Between the first two points, and in the third section, past the first two points.
    without_chart = [previewed_crop_x_at(markup, t) for t in (BETWEEN_POINTS_TIME, 7.5)]
    when_i_open_the_crop_chart(markup)
    with_chart = [previewed_crop_x_at(markup, t) for t in (BETWEEN_POINTS_TIME, 7.5)]
    then_the_previews_match(markup, without_chart, with_chart)


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
    given_pairs_with_the_first_ones_editor_open(markup, [PAN_PAIR, OTHER_PAIR])


@step
def given_pairs_with_the_first_ones_editor_open(markup: MarkupPage, pairs: list[dict]) -> None:
    markup.load_saved_marker_pairs(pairs)
    markup.open_marker_pair(0)
    # The crop chart's preview loop drives the crop chip that reports the previewed crop.
    markup.press("Alt+KeyD")
    markup.page.wait_for_selector("#cropChartCanvas")
    show_additional_settings(markup)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def given_a_pair_with_a_dynamic_pan_and_its_editor_open_without_the_crop_chart(
    markup: MarkupPage,
) -> None:
    markup.load_saved_marker_pairs([PAN_PAIR, OTHER_PAIR])
    markup.open_marker_pair(0)
    show_additional_settings(markup)


@step
def when_i_open_the_crop_chart(markup: MarkupPage) -> None:
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.press("Alt+KeyD")
    markup.page.wait_for_selector("#cropChartCanvas")


@step
def then_the_previews_match(markup: MarkupPage, first: list[float], second: list[float]) -> None:
    markup.report(f"crop x without the chart {first}, with it {second}")
    # The first point is at x 0; a preview stuck on it would read 0 at both times.
    assert all(x > 1 for x in first)
    assert first == pytest.approx(second, abs=1)


@step
def given_a_pair_with_a_fractional_margin_and_its_editor_open(markup: MarkupPage) -> None:
    pair = {**PAN_PAIR, "overrides": {"cropPointEasingCinematicMargin": 12.5}}
    markup.load_saved_marker_pairs([pair, OTHER_PAIR])
    markup.open_marker_pair(0)
    show_additional_settings(markup)


@step
def when_i_set_the_crop(markup: MarkupPage, crop: str) -> None:
    markup.page.fill("#crop-input", crop)
    markup.page.dispatch_event("#crop-input", "change")
    markup.page.evaluate("() => document.activeElement?.blur()")


@step
def when_i_undo_until_the_crop_is(markup: MarkupPage, crop: str) -> None:
    markup.page.evaluate("() => document.activeElement?.blur()")
    for _ in range(5):
        if markup.page.locator("#crop-input").input_value() == crop:
            return
        markup.press("Alt+KeyZ")
        markup.next_frames()
    assert markup.page.locator("#crop-input").input_value() == crop


@step
def when_i_type_the_cinematic_zoom_margin(markup: MarkupPage, value: str) -> None:
    markup.page.fill(ZOOM_MARGIN_INPUT, value)
    markup.page.dispatch_event(ZOOM_MARGIN_INPUT, "change")


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
def when_i_move_the_start_marker_to_the_current_time(markup: MarkupPage) -> None:
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.press("Shift+KeyQ")


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
def when_i_type_the_cinematic_margin(markup: MarkupPage, value: str) -> None:
    markup.page.fill(MARGIN_INPUT, value)
    markup.page.dispatch_event(MARGIN_INPUT, "change")


@step
def when_i_click_the_strength(markup: MarkupPage, name: str) -> None:
    markup.page.click(f'[data-cinematic-strength="{name}"]')


@step
def when_i_drag_the_margin_slider_to(markup: MarkupPage, margin_input: str, value: str) -> None:
    # A drag fires only input events; the release fires change.
    markup.page.eval_on_selector(
        f"{margin_input}-slider",
        "(slider, value) => { slider.value = value; slider.dispatchEvent(new Event('input')); }",
        value,
    )


@step
def when_i_release_the_margin_slider(markup: MarkupPage, margin_input: str) -> None:
    markup.page.dispatch_event(f"{margin_input}-slider", "change")


@step
def when_i_switch_the_easing_in_the_settings(markup: MarkupPage, easing: str) -> None:
    markup.page.click(f'.ytc-settings-popover [data-crop-easing="{easing}"]')


@step
def when_i_right_click_the_plot_at(markup: MarkupPage, share: float) -> None:
    """Right-clicks at a share of the plot's time axis, which sits inside 4 px of padding."""
    box = markup.page.locator(".ytc-cinematic-plot-canvas").bounding_box()
    assert box is not None
    x = box["x"] + (4 + share * 252) / 260 * box["width"]
    markup.page.mouse.move(x, box["y"] + box["height"] / 2)
    markup.page.mouse.down(button="right")
    markup.page.mouse.up(button="right")


@step
def when_i_click_the_legend(markup: MarkupPage, layer: str) -> None:
    markup.page.click(f'[data-plot-layer="{layer}"]')


@step
def when_i_toggle_the_plot_axis(markup: MarkupPage, axis: str) -> None:
    markup.page.click(f'[data-cinematic-plot-axis="{axis}"]')


@step
def when_i_reopen_the_cinematic_settings(markup: MarkupPage) -> None:
    markup.page.click(GEAR_BUTTON)
    markup.page.wait_for_selector(MARGIN_INPUT)
    markup.shot("cinematic-settings")


@step
def when_i_open_the_cinematic_settings_of_pair(markup: MarkupPage, index: int) -> None:
    markup.page.keyboard.press("Escape")
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.open_marker_pair(index)
    show_additional_settings(markup)
    when_i_reopen_the_cinematic_settings(markup)


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
def then_the_shown_crop_changes_from(markup: MarkupPage, x: float) -> None:
    # The new solve redraws the paused preview, without a seek.
    markup.page.wait_for_function(
        "x => parseFloat(document.querySelector('#interp-crop-value').textContent) !== x",
        arg=x,
        timeout=5000,
    )


@step
def then_the_crops_match(markup: MarkupPage, first: float, second: float) -> None:
    markup.report(f"crop x {first} vs {second}")
    assert abs(first - second) < 1


@step
def then_the_first_crop_point_is_at(saved: dict, time: float, x: float) -> None:
    first = saved["markerPairs"][0]["cropMap"][0]
    assert first["x"] == pytest.approx(time, abs=0.05)
    assert float(first["crop"].split(":")[0]) == pytest.approx(x, abs=1)


@step
def then_every_crop_point_has_the_size(saved: dict, size: str) -> None:
    sizes = {point["crop"].split(":", 2)[2] for point in saved["markerPairs"][0]["cropMap"]}
    assert sizes == {size}


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
def then_the_pair_saves_the_margins(saved: dict, margin: float | None, zoomMargin: float | None) -> None:
    overrides = saved["markerPairs"][0].get("overrides", {})
    assert overrides.get("cropPointEasingCinematicMargin") == margin
    assert overrides.get("cropPointEasingCinematicZoomMargin") == zoomMargin


@step
def then_the_cinematic_gear_is_shown(markup: MarkupPage) -> None:
    # Every easing keeps it, so the settings can switch between them.
    assert markup.page.locator(GEAR_BUTTON).is_visible()


@step
def then_a_cinematic_path_is_baked(markup: MarkupPage) -> None:
    assert markup.page.locator(GEAR_BUTTON).is_visible()
    # The bake runs after edits settle and records its segment count on the crop chip.
    markup.page.wait_for_selector(
        "#interp-crop-value[data-cinematic-segments]:not([data-cinematic-segments='0'])",
        state="attached",
        timeout=5000,
    )


@step
def then_the_active_strength_is(markup: MarkupPage, name: str) -> None:
    active = markup.page.locator(".ytc-cinematic-strength-button.active")
    assert active.count() == 1
    assert active.get_attribute("data-cinematic-strength") == name


@step
def then_the_margins_show(markup: MarkupPage, margin: str, zoomMargin: str) -> None:
    assert markup.page.locator(MARGIN_INPUT).input_value() == margin
    assert markup.page.locator(ZOOM_MARGIN_INPUT).input_value() == zoomMargin


@step
def then_the_plot_shows_the_layer(
    markup: MarkupPage, layer: str, shown: bool, like: str | None = None, unlike: str | None = None
) -> None:
    """Hiding a layer redraws the plot without it; showing it again restores the same pixels."""
    pressed = markup.page.get_attribute(f'[data-plot-layer="{layer}"]', "aria-pressed")
    assert pressed == str(shown).lower()
    pixels = markup.page.evaluate(
        "() => document.querySelector('.ytc-cinematic-plot-canvas').toDataURL()"
    )
    markup.shot(f"plot-{layer}-{'shown' if shown else 'hidden'}")
    if like is not None:
        assert pixels == like
    if unlike is not None:
        assert pixels != unlike


@step
def then_the_margin_input_is_valid(markup: MarkupPage) -> None:
    assert markup.page.eval_on_selector(MARGIN_INPUT, "input => input.checkValidity()")


@step
def then_the_pan_margin_pixels_become(markup: MarkupPage, text: str) -> None:
    # The hints follow the crop once its path is solved.
    markup.page.wait_for_function(
        "([selector, text]) => document.querySelector(selector)?.textContent === text",
        arg=[f"{MARGIN_INPUT}-px", text],
        timeout=3000,
    )


@step
def then_the_margin_pixels_show(markup: MarkupPage, margin: str, zoomMargin: str) -> None:
    markup.shot("cinematic-strength")
    assert markup.page.locator(f"{MARGIN_INPUT}-px").inner_text() == margin
    assert markup.page.locator(f"{ZOOM_MARGIN_INPUT}-px").inner_text() == zoomMargin


@step
def then_the_plot_shows_the_cinematic_path_on(
    markup: MarkupPage, axes: str, unlike: str | None = None
) -> str:
    """Waits for the plot of a solved path on the lanes `axes` (comma separated, top to bottom),
    different from the earlier one, and returns its pixels."""
    markup.page.wait_for_function(
        """([axes, unlike]) => {
            const canvas = document.querySelector('.ytc-cinematic-plot-canvas');
            return canvas?.dataset.cinematicPlotted === 'true' &&
                canvas.dataset.cinematicPlotAxes === axes && canvas.toDataURL() !== unlike;
        }""",
        arg=[axes, unlike],
        timeout=5000,
    )
    markup.shot(f"cinematic-plot-{axes.replace(',', '-')}")
    pressed = markup.page.eval_on_selector_all(
        ".ytc-cinematic-plot-axis-button:not([hidden])[aria-pressed='true']",
        "(buttons) => buttons.map((b) => b.dataset.cinematicPlotAxis).join(',')",
    )
    assert pressed == axes
    return markup.page.evaluate("() => document.querySelector('.ytc-cinematic-plot-canvas').toDataURL()")


@step
def then_the_plot_redraws(markup: MarkupPage, unlike: str) -> str:
    """Waits for the plot to differ from `unlike`, and returns its pixels."""
    markup.page.wait_for_function(
        "(unlike) => document.querySelector('.ytc-cinematic-plot-canvas')?.toDataURL() !== unlike",
        arg=unlike,
        timeout=5000,
    )
    markup.shot("cinematic-plot-redrawn")
    return markup.page.evaluate("() => document.querySelector('.ytc-cinematic-plot-canvas').toDataURL()")


@step
def then_the_zoom_toggle_is_hidden(markup: MarkupPage) -> None:
    # A pan-only pair keeps one crop size, so it has no zoom to plot.
    assert markup.page.is_hidden('[data-cinematic-plot-axis="zoom"]')


@step
def then_the_easing_is(
    markup: MarkupPage, easing: str, previewing_cinematic: bool, selected: str | None = None
) -> None:
    """The editor's select, the settings' highlighted button and the preview all follow the switch.
    The select shows Default while the pair inherits the easing."""
    markup.shot(f"easing-{easing}")
    assert markup.page.locator(EASING_SELECT).input_value() == (selected or easing)
    active = markup.page.locator(".ytc-settings-popover [data-crop-easing].active")
    assert active.count() == 1
    assert active.get_attribute("data-crop-easing") == easing
    # The plot's legend marks the same easing's path, which the plot draws on top.
    layer = {"smoothTrack": "smoothTrack", "cinematic": "cinematic", "smoothInOut": "easeInOut"}[easing]
    legend = markup.page.locator(".ytc-cinematic-plot-legend-item.active")
    assert legend.count() == 1
    assert legend.get_attribute("data-plot-layer") == layer
    # The crop chip counts the Cinematic path only while the preview shows it.
    segments = "#interp-crop-value[data-cinematic-segments]:not([data-cinematic-segments='0'])"
    if previewing_cinematic:
        markup.page.wait_for_selector(segments, state="attached", timeout=5000)
    else:
        assert markup.page.locator(segments).count() == 0


@step
def then_the_video_is_at(markup: MarkupPage, seconds: float) -> None:
    markup.page.wait_for_function(
        "t => Math.abs(document.querySelector('video').currentTime - t) < 0.1",
        arg=seconds,
        timeout=3000,
    )


@step
def then_the_cinematic_settings_fit_in_the_window(markup: MarkupPage) -> None:
    # A popover that grows moves up to stay on the page.
    markup.page.wait_for_function(
        """() => {
            const box = document.querySelector('.ytc-settings-popover').getBoundingClientRect();
            return box.top >= 0 && box.bottom <= window.innerHeight;
        }""",
        timeout=2000,
    )


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
    markup.seek(seconds, presented=True)
    markup.next_frames(3)
    return shown_crop_x(markup)


def plot_height(markup: MarkupPage) -> float:
    box = markup.page.locator(".ytc-cinematic-plot-canvas").bounding_box()
    assert box
    return box["height"]


def shown_crop_x(markup: MarkupPage) -> float:
    """The crop chip's crop x as it is now, without presenting a new frame."""
    chip = markup.page.locator("#interp-crop-value").inner_text()
    return float(chip.split(":")[0])
