"""Hold crop points: a hold point shows the crop of the crop point before it and follows it when it
changes. The flag is saved and loaded with the markers."""

import math

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step
from test_crop_chart import (
    CROP_CHART_JS,
    crop_point_position,
    crop_x,
    ctrl_drag,
    given_a_crop_point_in_the_middle_panned_right,
    given_a_marker_pair_with_its_editor_open,
    given_the_crop_chart_is_open,
)
from test_crop_easing import when_i_save_the_markers, when_i_set_the_crop
from test_frame_stepping import VIDEO_FPS, when_i_shift_scroll

# Full-height crops, so a drag at the video's middle row starts inside them. Crops are x:y:w:h in
# the default 1920x1080 crop resolution.
CROP_A = "0:0:960:1080"
CROP_B = "640:0:960:1080"
CROP_MIDDLE = "320:0:960:1080"
LEFT, RIGHT = 3, 9


def pair(*points: tuple[str, bool]) -> dict:
    """A marker pair from 3 to 9 s with crop points (crop, hold) spread evenly across it."""
    times = [LEFT + (RIGHT - LEFT) * i / (len(points) - 1) for i in range(len(points))]
    crop_map = []
    for time, (crop, hold) in zip(times, points, strict=True):
        point = {"x": time, "y": 0, "crop": crop}
        if hold:
            point["hold"] = True
        crop_map.append(point)
    return {"start": LEFT, "end": RIGHT, "crop": points[0][0], "cropMap": crop_map}


def test_a_new_marker_pair_ends_in_a_hold_point(markup: MarkupPage) -> None:
    # A crop point added in a new pair and moved holds to the end, instead of panning back.
    given_a_marker_pair_with_its_editor_open(markup)
    given_the_crop_chart_is_open(markup)
    start_crop = crop_points(markup)[0]["crop"]
    then_the_crop_points_are(markup, [(start_crop, False), (start_crop, True)])
    given_a_crop_point_in_the_middle_panned_right(markup)
    then_the_end_point_holds_the_middle_points_crop(markup)


def test_hold_points_are_saved_and_loaded(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_A, True), (CROP_B, False))
    )
    when_i_pan_crop_point(markup, 0, 150)
    saved = when_i_save_the_markers(markup)
    then_only_the_middle_point_is_saved_as_a_hold_point_with_the_first_points_crop(markup, saved)
    when_i_load_the_saved_pair_and_open_it(markup, saved)
    then_the_crop_points_are(
        markup, [(saved_crop(saved, 0), False), (saved_crop(saved, 0), True), (CROP_B, False)]
    )


def test_a_hold_end_point_follows_a_new_middle_point(markup: MarkupPage) -> None:
    # A crop point added in a static crop and moved pans out and back; holding the end keeps it.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_B, False), (CROP_B, True)])
    moved = when_i_pan_crop_point(markup, 1, 100)
    then_the_crop_points_are(markup, [(CROP_A, False), (moved, False), (moved, True)])


def test_toggling_hold_and_instant_and_editing_a_hold_point(markup: MarkupPage) -> None:
    # The end point's own crop is A. Holding shows B; releasing the hold gives A back.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "hold", CROP_B)
    when_i_toggle_hold_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "normal", CROP_A)
    when_i_toggle_hold_of_crop_point(markup, 2)
    when_i_toggle_instant_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "instant", CROP_A)
    when_i_toggle_instant_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "normal", CROP_A)
    when_i_toggle_hold_of_crop_point(markup, 2)
    moved = when_i_pan_crop_point(markup, 2, 100)
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_B, False), (moved, False)])
    when_i_toggle_hold_of_crop_point(markup, 0)
    then_crop_point_has_the_type(markup, 0, "normal", CROP_A)


def test_a_refused_hold_on_the_first_point_keeps_the_redo(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    when_i_press_outside_any_input(markup, "Alt+KeyZ")
    when_i_toggle_hold_of_crop_point(markup, 0)
    when_i_press_outside_any_input(markup, "Alt+Shift+KeyZ")
    then_crop_point_has_the_type(markup, 2, "hold", CROP_B)


def test_a_hold_point_released_after_a_pan_only_resize_keeps_the_shared_size(
    markup: MarkupPage,
) -> None:
    # Every pan-only point shares one size, so the released point keeps its position at the new size.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    markup.seek(crop_points(markup)[0]["x"], presented=True)
    select_crop_point(markup, 0)
    when_i_set_the_crop(markup, "0:0:800:900")
    when_i_toggle_hold_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "normal", "0:0:800:900")


def test_a_hold_point_added_on_the_frame_after_another_is_a_new_point(markup: MarkupPage) -> None:
    # Points added at the playhead sit on frame starts, a frame apart here.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_A, False)))
    when_i_add_a_hold_point_on_frame(markup, 180)
    when_i_add_a_hold_point_on_frame(markup, 181)
    then_the_crop_points_are(
        markup, [(CROP_A, False), (CROP_A, True), (CROP_A, True), (CROP_A, False)]
    )


def test_a_hold_point_dragged_from_while_pressing_a_keeps_its_own_crop(markup: MarkupPage) -> None:
    # Holding shows A; its own crop is B. The points added mid-drag are plain ones. The end point has a
    # crop of its own: an edit to the second last point also moves the end point when they match.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_MIDDLE, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 1)
    added = when_i_drag_from_crop_point_and_press_a_at(markup, 1, [6.5, 7.5])
    then_the_crop_points_are(
        markup,
        [
            (CROP_A, False),
            (CROP_A, True),
            (added[0], False),
            (added[1], False),
            (CROP_MIDDLE, False),
        ],
    )
    when_i_toggle_hold_of_crop_point(markup, 1)
    then_crop_point_has_the_type(markup, 1, "normal", CROP_B)


def test_a_hold_point_released_after_a_markers_load_gets_back_its_own_crop(
    markup: MarkupPage,
) -> None:
    # A loaded pair has no undo history, so the point's own crop must come from the saved file.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    when_i_load_the_saved_pair_and_open_it(markup, when_i_save_the_markers(markup))
    when_i_toggle_hold_of_crop_point(markup, 2)
    then_crop_point_has_the_type(markup, 2, "normal", CROP_A)


def test_a_hold_point_moved_past_another_point_gets_back_its_own_crop(markup: MarkupPage) -> None:
    # Moved ahead of the point before it, the hold point becomes point 1 and holds the first crop.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_MIDDLE, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    when_i_drag_crop_point_to(markup, 2, 4)
    then_crop_point_has_the_type(markup, 1, "hold", CROP_A)
    when_i_toggle_hold_of_crop_point(markup, 1)
    then_crop_point_has_the_type(markup, 1, "normal", CROP_B)


def test_hold_points_are_drawn_over_a_vertical_yellow_bar(markup: MarkupPage) -> None:
    # Two hold points in a row each get a bar, and the end point holds too. Screenshots for review show
    # each role color (start, end, other) on a hold point.
    given_a_pair_with_its_crop_chart_open(
        markup,
        pair((CROP_A, False), (CROP_A, True), (CROP_A, True), (CROP_B, False), (CROP_B, True)),
    )
    # Selecting the first hold point also selects the hold section after it.
    for index, label in [
        (1, "first-hold-selected"),
        (4, "last-hold-selected"),
        (3, "normal-selected"),
    ]:
        when_i_select_crop_point(markup, index)
        then_the_crop_chart_is_shot(markup, label)
    then_only_hold_points_have_a_yellow_bar(markup, holds=[1, 2, 4], normal=[3])


def test_a_hold_point_added_at_the_current_time_shows_the_previous_crop(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    when_i_add_a_hold_point_at(markup, 6)
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_A, True), (CROP_B, False)])
    then_crop_point_is_selected(markup, 1)


def test_a_hold_point_follows_a_later_fix_of_the_point_before_it(markup: MarkupPage) -> None:
    # A hold point where a subject starts moving keeps the crop before it, also after a fix there.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_A, True), (CROP_B, False))
    )
    moved = when_i_pan_crop_point(markup, 0, 100)
    then_the_crop_points_are(markup, [(moved, False), (moved, True), (CROP_B, False)])


def test_adding_points_during_a_drag_from_a_hold_point_keeps_it_a_hold_point(
    markup: MarkupPage,
) -> None:
    # Tracking a subject from where it starts moving: drag from the hold point and press A at each
    # position. The hold point keeps holding, and the new points keep the crops they were added with.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_A, True), (CROP_B, False))
    )
    added = when_i_drag_from_crop_point_and_press_a_at(markup, 1, [6.5, 7.5])
    then_the_crop_points_are(
        markup,
        [(CROP_A, False), (CROP_A, True), (added[0], False), (added[1], False), (CROP_B, False)],
    )
    moved = when_i_pan_crop_point(markup, 0, 50)
    then_the_crop_points_are(
        markup,
        [(moved, False), (moved, True), (added[0], False), (added[1], False), (CROP_B, False)],
    )


def test_ctrl_alt_a_during_a_crop_drag_leaves_the_drag_going(markup: MarkupPage) -> None:
    # The drag holds Ctrl, so A pressed with Alt during it is Ctrl+Alt+A. It must not add a point under
    # the drag, which then could not continue (and threw on every move).
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_A, True), (CROP_B, False))
    )
    moved = when_i_ctrl_drag_crop_point_and_press_ctrl_alt_a_midway(markup, 0)
    then_the_crop_points_are(markup, [(moved, False), (moved, True), (CROP_B, False)])


def test_alt_a_while_a_crop_draw_is_armed_cancels_the_draw(markup: MarkupPage) -> None:
    # The draw reverts to the crop map it read when armed, so it must not outlive an added point.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    markup.seek(6, presented=True)
    markup.press("KeyX")
    markup.press("Alt+KeyA")
    when_i_drag_across_the_video(markup)
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_A, False), (CROP_B, False)])


def test_a_crop_typed_while_a_crop_draw_is_armed_stays_after_the_draw_is_canceled(
    markup: MarkupPage,
) -> None:
    # A draw waiting for its first click leaves the settings editor usable, and canceling the draw
    # restores the crop points it read when armed.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    when_i_press_outside_any_input(markup, "KeyX")
    crop_input = markup.page.locator("#crop-input")
    crop_input.fill(CROP_MIDDLE)
    crop_input.dispatch_event("change")
    when_i_press_outside_any_input(markup, "KeyX")
    then_the_crop_points_are(markup, [(CROP_MIDDLE, False), (CROP_B, False)])


def test_a_crop_nudged_in_the_crop_input_while_a_crop_draw_is_armed_stays_after_the_draw_is_canceled(
    markup: MarkupPage,
) -> None:
    # ArrowUp in the crop input steps the component under the cursor, which writes the crop map.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    when_i_press_outside_any_input(markup, "KeyX")
    crop_input = markup.page.locator("#crop-input")
    crop_input.click()
    crop_input.press("Home")
    crop_input.press("ArrowUp")
    nudged = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    assert nudged[0] != (CROP_A, False), "ArrowUp should change the crop"
    when_i_press_outside_any_input(markup, "KeyX")
    then_the_crop_points_are(markup, nudged)


def test_alt_shift_x_while_a_crop_draw_is_armed_keeps_its_crops_after_the_draw_is_canceled(
    markup: MarkupPage,
) -> None:
    # Alt+Shift+X sets every static crop to the default; canceling the draw must not take it back.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_A, False)))
    when_i_press_outside_any_input(markup, "KeyX")
    when_i_press_outside_any_input(markup, "Alt+Shift+KeyX")
    after_reset = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    assert after_reset != [(CROP_A, False), (CROP_A, False)], "Alt+Shift+X should reset the crops"
    when_i_press_outside_any_input(markup, "KeyX")
    then_the_crop_points_are(markup, after_reset)


def test_rotating_the_video_cancels_an_armed_crop_draw(markup: MarkupPage) -> None:
    # The draw would take a crop drawn in the rotated view as one in the video's own orientation.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    when_i_press_outside_any_input(markup, "KeyX")
    when_i_press_outside_any_input(markup, "KeyR")
    when_i_drag_across_the_video(markup)
    when_i_press_outside_any_input(markup, "KeyR")
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_B, False)])


def test_ctrl_wheel_while_a_crop_draw_is_armed_in_reframe_is_ignored(markup: MarkupPage) -> None:
    # The wheel zoom adds a crop point under the playhead, which the armed draw doesn't know about.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    markup.seek(6, presented=True)
    markup.press("KeyV")
    markup.page.wait_for_selector("#ytc-reframe-canvas", state="visible")
    markup.press("KeyX")
    video = markup.reveal("video")
    markup.page.mouse.move(video["x"] + video["width"] / 2, video["y"] + video["height"] / 2)
    markup.page.keyboard.down("Control")
    markup.page.mouse.wheel(0, -100)
    markup.page.keyboard.up("Control")
    markup.next_frames()
    when_i_drag_across_the_video(markup)
    assert len(crop_points(markup)) == 2


def test_selecting_the_next_pair_during_a_crop_drag_cancels_the_drag(markup: MarkupPage) -> None:
    next_pair = {**pair((CROP_B, False), (CROP_MIDDLE, False)), "start": 12, "end": 18}
    next_pair["cropMap"] = [{**point, "x": point["x"] + 9} for point in next_pair["cropMap"]]
    markup.load_saved_marker_pairs([pair((CROP_A, False), (CROP_B, False)), next_pair])
    markup.open_marker_pair(0)
    open_the_crop_chart(markup)
    when_i_ctrl_drag_crop_point_and_select_the_next_pair_right_after_a_move(markup, 0)
    assert markup.page.locator("#marker-pair-number-input").input_value() == "2"
    saved = when_i_save_the_markers(markup)["markerPairs"]
    markup.report(f"saved crop maps {[marker_pair['cropMap'] for marker_pair in saved]}")
    assert [point["crop"] for point in saved[0]["cropMap"]] == [CROP_A, CROP_B]
    assert [point["crop"] for point in saved[1]["cropMap"]] == [CROP_B, CROP_MIDDLE]


def test_closing_the_global_settings_while_a_crop_draw_is_armed_cancels_the_draw(
    markup: MarkupPage,
) -> None:
    markup.press("KeyW")
    markup.page.wait_for_selector("#settings-editor-div", state="visible")
    markup.press("KeyX")
    markup.press("KeyW")
    markup.page.wait_for_selector("#settings-editor-div", state="detached")


def test_a_wheel_zoom_just_before_a_canceled_drag_stays_its_own_undo_step(
    markup: MarkupPage,
) -> None:
    # The wheel zoom commits 300 ms after the wheel goes idle, which here lands during the drag.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    start = crop_points(markup)[0]["crop"]
    zoomed, dragged = when_i_ctrl_wheel_then_drag_the_crop_at_once_and_undo_midway(markup)
    assert zoomed != start, "the wheel should zoom the crop"
    assert dragged != zoomed, "the drag should move the crop"
    when_i_press_outside_any_input(markup, "Alt+KeyZ")
    assert crop_points(markup)[0]["crop"] == start
    when_i_press_outside_any_input(markup, "Alt+Shift+KeyZ")
    assert crop_points(markup)[0]["crop"] == zoomed


def test_closing_the_global_settings_during_a_crop_drag_cancels_it(markup: MarkupPage) -> None:
    when_i_press_outside_any_input(markup, "KeyW")
    markup.page.wait_for_selector("#settings-editor-div", state="visible")
    before = markup.page.locator("#crop-input").input_value()
    when_i_ctrl_drag_the_crops_right_edge_in_and_press_midway(markup, "KeyW")
    markup.page.wait_for_selector("#settings-editor-div", state="detached")
    when_i_press_outside_any_input(markup, "KeyW")
    after = markup.page.locator("#crop-input").input_value()
    markup.report(f"new marker crop {before} -> {after}")
    # Crops are written in pixels, where the default says iw and ih.
    assert after == before.replace("iw", "1920").replace("ih", "1080")


def test_undo_during_a_minimap_crop_drag_cancels_that_drag(markup: MarkupPage) -> None:
    # After a drag on the video, whose end handler a minimap drag must not reuse.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_pan_crop_point(markup, 0, 100)
    when_i_toggle_hold_of_crop_point(markup, 2)
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    when_i_minimap_drag_crop_point_and_press_midway(markup, 0, "Alt+KeyZ")
    then_the_crop_points_are(markup, before)
    # The canceled drag left no undo step: the next undo takes back the hold.
    when_i_press_outside_any_input(markup, "Alt+KeyZ")
    then_crop_point_has_the_type(markup, 2, "normal", CROP_A)


@pytest.mark.parametrize("key", ["Alt+KeyA", "KeyA"])
def test_adding_a_point_during_a_minimap_crop_drag_moves_the_drag_onto_it(
    markup: MarkupPage, key: str
) -> None:
    # As on the video: the dragged point keeps its crop, and the new point takes the drag from there.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_minimap_drag_crop_point_and_press_midway(markup, 0, key, seek_to=4.5)
    points = crop_points(markup)
    markup.report(f"crop points {[(p['x'], p['crop']) for p in points]}")
    assert [p["x"] for p in points] == [3, 4.5, 6, 9]
    assert [p["crop"] for p in points[:1] + points[2:]] == [CROP_A, CROP_B, CROP_A]
    assert crop_x(points[1]["crop"]) > crop_x(CROP_A), "the new point should take the drag"
    # Once the drag ends, an added point is a plain one, with the crop before it.
    when_i_add_a_point_at(markup, 7.5)
    assert crop_points(markup)[3]["crop"] == CROP_B


@pytest.mark.parametrize("key", ["Alt+KeyA", "KeyA"])
def test_adding_a_point_on_the_dragged_point_during_a_minimap_crop_drag_is_refused(
    markup: MarkupPage, key: str
) -> None:
    # The reframe auto-key puts the playhead on the dragged point, so a second point would share its time.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_minimap_drag_crop_point_and_press_midway(markup, 1, key)
    points = crop_points(markup)
    markup.report(f"crop points {[(p['x'], p['crop']) for p in points]}")
    assert [p["x"] for p in points] == [3, 6, 9]
    assert crop_x(points[1]["crop"]) > crop_x(CROP_B), "the drag should go on with its point"


def test_adding_a_point_on_an_existing_point_is_refused(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_add_a_point_at(markup, 6)
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_B, False), (CROP_A, False)])


def test_a_minimap_crop_drag_is_refused_while_a_crop_draw_is_armed(markup: MarkupPage) -> None:
    # The draw reverts to the crop map it read when armed, which would drop the drag's edit.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    when_i_toggle_hold_of_crop_point(markup, 2)
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    open_the_minimap_at(markup, 4.5)
    markup.press("KeyX")
    x, y = ctrl_drag_on_the_minimap(markup, CROP_A)
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    then_the_crop_points_are(markup, before)
    markup.press("KeyX")
    # The refused drag left no undo step: the next undo takes back the hold.
    when_i_press_outside_any_input(markup, "Alt+KeyZ")
    then_crop_point_has_the_type(markup, 2, "normal", CROP_A)


def test_a_minimap_crop_drag_is_refused_while_the_speed_chart_is_shown(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    open_the_minimap_at(markup, 3)
    markup.press("KeyD")
    markup.page.wait_for_selector("#speedChartCanvas", state="visible")
    x, y = ctrl_drag_on_the_minimap(markup, CROP_A)
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    saved = when_i_save_the_markers(markup)["markerPairs"][0]["cropMap"]
    assert [(point["crop"], point.get("hold", False)) for point in saved] == before


@pytest.mark.parametrize(
    "key",
    ["KeyX", "KeyD", "Alt+ArrowRight"],
    ids=["arming a crop draw", "opening the speed chart", "selecting the next pair"],
)
def test_a_minimap_press_does_not_become_a_crop_drag_after(markup: MarkupPage, key: str) -> None:
    # The press is checked again when it starts dragging, as these come between the two.
    markup.load_saved_marker_pairs(two_pairs())
    markup.open_marker_pair(0)
    open_the_crop_chart(markup)
    when_i_toggle_hold_of_crop_point(markup, 2)
    before = saved_crop_maps(markup)
    open_the_minimap_at(markup, 4.5)
    x, y = ctrl_press_on_the_minimap(markup, CROP_A)
    markup.press(key)
    if key == "Alt+ArrowRight":
        # Inside the next pair, so the drag is refused by the press check alone.
        markup.seek(15)
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    if key == "KeyX":
        markup.press("KeyX")
    assert saved_crop_maps(markup) == before
    if key != "Alt+ArrowRight":
        # No undo step was left: the next undo takes back the hold.
        when_i_press_outside_any_input(markup, "Alt+KeyZ")
        assert saved_crop_maps(markup)[0][2][2] is False


@pytest.mark.parametrize("surface", ["video", "minimap", "wheel"])
def test_a_reframe_crop_edit_with_the_playhead_outside_the_pair_is_refused(
    markup: MarkupPage, surface: str
) -> None:
    # Selecting a pair in reframe doesn't seek, and an auto-keyed point would land outside the pair.
    markup.load_saved_marker_pairs(two_pairs())
    markup.open_marker_pair(0)
    open_the_crop_chart(markup)
    open_the_minimap_at(markup, 3)
    markup.press("Alt+ArrowRight")
    markup.next_frames(3)
    before = saved_crop_maps(markup)
    if surface == "minimap":
        x, y = ctrl_press_on_the_minimap(markup, CROP_B)
        markup.page.mouse.move(x + 40, y, steps=4)
        markup.page.mouse.up()
    else:
        video = markup.reveal("video")
        x, y = video["x"] + video["width"] / 2, video["y"] + video["height"] / 2
        markup.page.mouse.move(x, y)
        markup.page.keyboard.down("Control")
        if surface == "wheel":
            markup.page.mouse.wheel(0, -100)
        else:
            markup.page.mouse.down()
            markup.page.mouse.move(x + 40, y, steps=4)
            markup.page.mouse.up()
        markup.page.keyboard.up("Control")
    markup.next_frames()
    assert saved_crop_maps(markup) == before
    assert markup.page.locator(".msg-div", has_text="Seek into the marker pair").count()


def test_a_blur_during_a_minimap_crop_drag_ends_it_and_keeps_the_edit(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    open_the_minimap_at(markup, 3)
    x, y = ctrl_drag_on_the_minimap(markup, CROP_A)
    markup.page.evaluate("() => window.dispatchEvent(new Event('blur'))")
    dragged = crop_points(markup)[0]["crop"]
    assert dragged != CROP_A, "the drag should move the crop"
    markup.page.mouse.move(x + 60, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    assert crop_points(markup)[0]["crop"] == dragged
    # The drag has ended, so Ctrl+Alt+A is no longer refused, and one undo per edit takes both back.
    when_i_add_a_hold_point_at(markup, 4.5)
    assert len(crop_points(markup)) == 4
    for _ in range(2):
        when_i_press_outside_any_input(markup, "Alt+KeyZ")
    assert crop_points(markup)[0]["crop"] == CROP_A


def test_opening_the_speed_chart_and_adding_a_speed_point_during_a_crop_drag_cancels_it(
    markup: MarkupPage,
) -> None:
    # The speed point's undo step must not sit between the drag's snapshot and its cancel.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    x, y = grab_crop_point(markup, 0)
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 60, y, steps=4)
    markup.press("KeyD")
    markup.seek(4.5, presented=True)
    markup.press("Alt+KeyA")
    markup.page.mouse.move(x + 120, y, steps=4)
    markup.page.mouse.up()
    for keys in ["Alt+KeyZ", "Alt+KeyZ", "Alt+Shift+KeyZ"]:
        when_i_press_outside_any_input(markup, keys)
    saved = when_i_save_the_markers(markup)["markerPairs"][0]["cropMap"]
    assert saved[0]["crop"] == CROP_A


def test_alt_wheel_during_a_crop_drag_keeps_the_dragged_point(markup: MarkupPage) -> None:
    # Alt+wheel selects another crop point, which the drag would then write its crop to.
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    x, y = grab_crop_point(markup, 0)
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 60, y, steps=4)
    markup.page.keyboard.down("Alt")
    markup.page.mouse.wheel(0, -100)
    markup.page.keyboard.up("Alt")
    markup.next_frames()
    markup.page.mouse.move(x + 120, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    points = [point["crop"] for point in crop_points(markup)]
    markup.report(f"crop points {points}")
    # The wheel also zooms the dragged crop (every point in pan-only mode), so compare positions.
    assert [crop_x(crop) for crop in points[1:]] == [crop_x(CROP_B), crop_x(CROP_A)]
    assert crop_x(points[0]) > crop_x(CROP_A), "the drag should have moved the first point"


@pytest.mark.parametrize(
    "key", ["Shift+KeyV", "KeyV"], ids=["closing the minimap", "leaving reframe"]
)
def test_a_minimap_crop_drag_is_canceled_when_the_minimap_goes(
    markup: MarkupPage, key: str
) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_A, False))
    )
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    when_i_minimap_drag_crop_point_and_press_midway(markup, 0, key)
    then_the_crop_points_are(markup, before)
    # The drag has ended, so Ctrl+Alt+A is no longer refused.
    when_i_add_a_hold_point_at(markup, 4.5)
    assert len(crop_points(markup)) == len(before) + 1


def test_undo_during_a_crop_drag_cancels_the_drag_and_keeps_the_other_points(
    markup: MarkupPage,
) -> None:
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_MIDDLE, False), (CROP_B, False))
    )
    when_i_add_a_point_at(markup, 4)
    when_i_ctrl_drag_crop_point_and_press_midway(markup, 0, "Alt+KeyZ")
    then_the_crop_points_are(
        markup, [(CROP_A, False), (CROP_A, False), (CROP_MIDDLE, False), (CROP_B, False)]
    )
    # The canceled drag left no undo step: the next undo removes the point added at 4 s.
    when_i_press_outside_any_input(markup, "Alt+KeyZ")
    then_the_crop_points_are(markup, [(CROP_A, False), (CROP_MIDDLE, False), (CROP_B, False)])


def test_a_canceled_reframe_crop_drag_between_points_leaves_no_point(markup: MarkupPage) -> None:
    # In reframe a drag between points first adds a point at the playhead, which canceling takes back.
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    given_reframe_at(markup, (LEFT + RIGHT) / 2)
    when_i_ctrl_drag_the_reframed_crop_and_press_midway(markup, "Alt+KeyZ")
    then_the_crop_points_are(markup, before)


def test_a_canceled_minimap_crop_drag_between_points_leaves_no_point(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(markup, pair((CROP_A, False), (CROP_B, False)))
    before = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    open_the_minimap_at(markup, (LEFT + RIGHT) / 2)
    x, y = ctrl_drag_on_the_minimap(markup, CROP_MIDDLE)
    markup.press("Alt+KeyZ")
    markup.page.mouse.move(x + 30, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()
    then_the_crop_points_are(markup, before)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_reframe_at(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.press("KeyV")
    markup.page.wait_for_selector("#ytc-reframe-canvas", state="visible")
    markup.next_frames()


@step
def given_a_pair_with_its_crop_chart_open(
    markup: MarkupPage, marker_pair: dict, measured: bool = True
) -> None:
    if measured:
        markup.measure_frame_rate()
    markup.load_saved_marker_pairs([marker_pair])
    markup.open_marker_pair(0)
    open_the_crop_chart(markup)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_toggle_hold_of_crop_point(markup: MarkupPage, index: int) -> None:
    click_crop_point_with(markup, index, ["Control", "Shift"])


@step
def when_i_add_a_hold_point_on_frame(markup: MarkupPage, frame: int) -> None:
    # Midway into the frame, where the playhead sits after a frame step. The test video is 30 fps.
    markup.seek((frame + 0.5) / 30, presented=True)
    markup.press("Control+Alt+KeyA")


@step
def when_i_drag_crop_point_to(markup: MarkupPage, index: int, seconds: float) -> None:
    x, y = crop_point_position(markup, index)
    canvas = markup.box_of("#cropChartCanvas")
    target = canvas["x"] + markup.page.evaluate(
        f"(t) => Object.values({CROP_CHART_JS}.scales).find((s) => s.isHorizontal()).getPixelForValue(t)",
        seconds,
    )
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(target, y, steps=8)
    markup.page.mouse.up()
    # The zoom plugin reads the drag as a pan and swallows clicks for 500 ms after it
    # (`_ghostClickHandler`), with no event to wait on.
    markup.page.wait_for_timeout(600)
    markup.report(f"crop point times {[round(p['x'], 2) for p in crop_points(markup)]}")


@step
def when_i_toggle_instant_of_crop_point(markup: MarkupPage, index: int) -> None:
    click_crop_point_with(markup, index, ["Control", "Alt", "Shift"])


def click_crop_point_with(markup: MarkupPage, index: int, modifiers: list[str]) -> None:
    x, y = crop_point_position(markup, index)
    for key in modifiers:
        markup.page.keyboard.down(key)
    markup.page.mouse.click(x, y)
    for key in reversed(modifiers):
        markup.page.keyboard.up(key)
    markup.next_frames()


@step
def when_i_select_crop_point(markup: MarkupPage, index: int) -> None:
    select_crop_point(markup, index)


@step
def when_i_add_a_hold_point_at(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.press("Control+Alt+KeyA")


@step
def when_i_drag_from_crop_point_and_press_a_at(
    markup: MarkupPage, index: int, times: list[float]
) -> list[str]:
    """Ctrl+drag the point's crop on the video and, without releasing, seek to each time, move the
    crop further right and press A. Returns the crops the new points were added with."""
    x, y = grab_crop_point(markup, index)
    # Plain A adds a crop point only without Ctrl; the drag keeps going once it has started.
    markup.page.keyboard.up("Control")
    added = []
    for seconds in times:
        x += 60
        markup.page.mouse.move(x, y, steps=4)
        markup.seek(seconds, presented=True)
        markup.press("KeyA")
        new_index = [point["x"] for point in crop_points(markup)].index(seconds)
        added.append(crop_points(markup)[new_index]["crop"])
    markup.page.mouse.up()
    markup.report(f"added crops {added}")
    assert len(set(added)) == len(added), "each A should add the crop where it was pressed"
    return added


@step
def when_i_ctrl_drag_crop_point_and_press_ctrl_alt_a_midway(markup: MarkupPage, index: int) -> str:
    """Ctrl+drag the point's crop on the video, press Ctrl+Alt+A halfway, and finish the drag. Returns
    the crop the drag ends at."""
    before = crop_points(markup)[index]["crop"]
    x, y = grab_crop_point(markup, index)
    markup.page.mouse.move(x + 50, y, steps=4)
    # Off any point, where Ctrl+Alt+A would add one rather than toggle the point under the playhead.
    markup.seek(4.5, presented=True)
    markup.page.keyboard.down("Alt")
    markup.page.keyboard.press("KeyA")
    markup.page.keyboard.up("Alt")
    markup.next_frames()
    markup.page.mouse.move(x + 100, y, steps=4)
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")
    markup.next_frames()
    after = crop_points(markup)[index]["crop"]
    markup.report(f"crop point {index} {before} -> {after}")
    video_width = markup.reveal("video")["width"]
    assert crop_x(after) > crop_x(before) + 50 * 1920 / video_width, "the drag should keep going"
    return after


@step
def when_i_ctrl_drag_crop_point_and_press_midway(markup: MarkupPage, index: int, key: str) -> None:
    """Ctrl+drag the point's crop on the video, release Ctrl (the drag keeps going), press the key
    halfway, and keep dragging."""
    x, y = grab_crop_point(markup, index)
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.press(key)
    markup.next_frames()
    markup.page.mouse.move(x + 100, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_ctrl_drag_crop_point_and_select_the_next_pair_right_after_a_move(
    markup: MarkupPage, index: int
) -> None:
    """Like the drag above, with Alt+Right sent in the same task as a move, so the drag still has
    that move's frame pending when the pair changes."""
    x, y = grab_crop_point(markup, index)
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.page.evaluate(
        """([x, y]) => {
          const target = document.querySelector('#my-video');
          target.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', altKey: true, bubbles: true }));
        }""",
        [x + 80, y],
    )
    markup.next_frames()
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_ctrl_wheel_then_drag_the_crop_at_once_and_undo_midway(
    markup: MarkupPage,
) -> tuple[str, str]:
    """In reframe on the first crop point: Ctrl+wheel to zoom, grab the crop within 50 ms and drag it
    past the zoom's commit, press Alt+Z, and release. Returns the crop after the wheel and mid-drag."""
    markup.seek(crop_points(markup)[0]["x"], presented=True)
    markup.press("KeyV")
    markup.page.wait_for_selector("#ytc-reframe-canvas", state="visible")
    markup.next_frames()
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] / 2, video["y"] + video["height"] / 2
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Control")
    markup.page.mouse.wheel(0, -100)
    markup.page.wait_for_timeout(50)
    zoomed = crop_points(markup)[0]["crop"]
    markup.page.mouse.move(x + 5, y, steps=2)
    markup.page.mouse.down()
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 120, y, steps=6)
    markup.page.wait_for_timeout(600)
    dragged = crop_points(markup)[0]["crop"]
    markup.report(f"after the wheel {zoomed}, mid-drag {dragged}")
    markup.press("Alt+KeyZ")
    markup.page.mouse.up()
    markup.next_frames()
    assert crop_points(markup)[0]["crop"] == zoomed, "the cancel should restore the zoomed crop"
    return zoomed, dragged


@step
def when_i_ctrl_drag_the_reframed_crop_and_press_midway(markup: MarkupPage, key: str) -> None:
    """Ctrl+drag the reframed crop from the middle of the video, release Ctrl, press the key halfway,
    and keep dragging."""
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] / 2, video["y"] + video["height"] / 2
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x - 20, y)
    markup.page.mouse.move(x, y, steps=3)
    markup.page.mouse.down()
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x + 40, y, steps=4)
    markup.press(key)
    markup.page.mouse.move(x + 100, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_ctrl_drag_the_crops_right_edge_in_and_press_midway(markup: MarkupPage, key: str) -> None:
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] - 3, video["y"] + video["height"] / 2
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x - 20, y)
    markup.page.mouse.move(x, y, steps=3)
    markup.page.mouse.down()
    markup.page.keyboard.up("Control")
    markup.page.mouse.move(x - 300, y, steps=6)
    markup.press(key)
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_minimap_drag_crop_point_and_press_midway(
    markup: MarkupPage, index: int, key: str, seek_to: float | None = None
) -> None:
    """In reframe with the minimap shown, Ctrl+drag the point's crop on the minimap, release Ctrl (the
    drag keeps going), seek if given, press the key, and keep dragging."""
    open_the_minimap_at(markup, crop_points(markup)[index]["x"])
    before = crop_points(markup)[index]["crop"]
    x, y = ctrl_drag_on_the_minimap(markup, before)
    assert crop_points(markup)[index]["crop"] != before, "the drag should move the crop"
    if seek_to is not None:
        markup.seek(seek_to, presented=True)
    markup.press(key)
    markup.page.mouse.move(x + 30, y, steps=4)
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_press_outside_any_input(markup: MarkupPage, keys: str) -> None:
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.press(keys)


@step
def when_i_add_a_point_at(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.press("Alt+KeyA")
    markup.next_frames()


@step
def when_i_drag_across_the_video(markup: MarkupPage) -> None:
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] * 0.2, video["y"] + video["height"] * 0.2
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 200, y + 150, steps=5)
    markup.page.mouse.up()
    markup.next_frames()


@step
def when_i_pan_crop_point(markup: MarkupPage, index: int, dx: float) -> str:
    """Select the point with Ctrl+hover on the chart, then Ctrl+drag its crop on the video."""
    before = crop_points(markup)[index]["crop"]
    markup.seek(crop_points(markup)[index]["x"], presented=True)
    select_crop_point(markup, index)
    video = markup.reveal("video")
    y = video["y"] + video["height"] / 2
    inside = video["x"] + video["width"] * (crop_x(before) + 480) / 1920
    ctrl_drag(markup, (inside, y), (inside + dx, y))
    after = crop_points(markup)[index]["crop"]
    markup.report(f"crop point {index} {before} -> {after}")
    assert crop_x(after) > crop_x(before)
    return after


@step
def when_i_load_the_saved_pair_and_open_it(markup: MarkupPage, saved: dict) -> None:
    markup.page.evaluate("() => document.activeElement?.blur()")
    markup.load_saved_marker_pairs(saved["markerPairs"])
    markup.open_marker_pair(1)
    open_the_crop_chart(markup)


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_no_two_crop_points_are_on_one_frame(markup: MarkupPage) -> None:
    times = [point["x"] for point in crop_points(markup)]
    markup.report(f"crop point times {times}")
    frames = [math.floor((time + 0.001) * VIDEO_FPS) for time in times]
    assert len(frames) == len(set(frames))


@step
def then_only_the_middle_point_is_saved_as_a_hold_point_with_the_first_points_crop(
    markup: MarkupPage, saved: dict
) -> None:
    crop_map = saved["markerPairs"][0]["cropMap"]
    markup.report(f"saved crop map {crop_map}")
    assert [point.get("hold") for point in crop_map] == [None, True, None]
    assert crop_map[1]["crop"] == crop_map[0]["crop"] != CROP_A


@step
def then_the_end_point_holds_the_middle_points_crop(markup: MarkupPage) -> None:
    start, middle, end = crop_points(markup)
    markup.report(
        f"crop points {[(point['crop'], point['hold']) for point in (start, middle, end)]}"
    )
    assert middle["crop"] != start["crop"]
    assert (end["crop"], end["hold"]) == (middle["crop"], True)


@step
def then_the_crop_points_are(markup: MarkupPage, expected: list[tuple[str, bool]]) -> None:
    points = [(point["crop"], point["hold"]) for point in crop_points(markup)]
    markup.report(f"crop points {points}")
    markup.shot_of("crop-chart", ["#cropChartCanvas"])
    assert points == expected


@step
def then_crop_point_has_the_type(markup: MarkupPage, index: int, expected: str, crop: str) -> None:
    point = markup.page.evaluate(
        f"(i) => {{ const p = {CROP_CHART_JS}.data.datasets[0].data[i];"
        " return { crop: p.crop, type: p.hold ? 'hold' : (p.easeIn ?? 'normal') }; }",
        index,
    )
    markup.report(f"crop point {index} {point}")
    assert point == {"crop": crop, "type": expected}


@step
def then_crop_point_is_selected(markup: MarkupPage, index: int) -> None:
    # The chart draws the selected point as a rounded square.
    styles = markup.page.evaluate(
        f"() => {CROP_CHART_JS}.getDatasetMeta(0).data.map((p) => p._model.pointStyle)"
    )
    markup.report(f"point styles {styles}")
    assert [i for i, style in enumerate(styles) if style == "rectRounded"] == [index]


@step
def then_only_hold_points_have_a_yellow_bar(
    markup: MarkupPage, holds: list[int], normal: list[int]
) -> None:
    # The playhead line is drawn on the chart too, so park it between points and grid ticks. A bare
    # grid tick shows the bar stands apart from a grid line.
    markup.seek(5.3, presented=True)
    markup.page.mouse.move(0, 0)
    markup.next_frames()
    shares = chart_bar_color_shares(markup, [*holds, *normal], bare_tick_time=5.0)
    markup.report(
        f"share of each column in the bar's color, by point index (-1 is the bare tick): {shares}"
    )
    # The point, its labels and the section line cover part of a hold point's column; the bar shows
    # through the rest.
    assert all(shares[str(index)] > 0.25 for index in holds)
    assert all(shares[str(index)] == 0 for index in [*normal, -1])


@step
def then_the_crop_chart_is_shot(markup: MarkupPage, label: str) -> None:
    # Off the chart, so no point is drawn in its hover colors.
    markup.page.mouse.move(0, 0)
    markup.shot_of(label, ["#cropChartCanvas"])


# ─── page state ─────────────────────────────────────────────────────────────


def grab_crop_point(markup: MarkupPage, index: int) -> tuple[float, float]:
    """Seek to the crop point, select it, and press the mouse with Ctrl inside its crop on the video's
    middle row, holding Ctrl. Returns where the mouse is."""
    markup.seek(crop_points(markup)[index]["x"], presented=True)
    select_crop_point(markup, index)
    video = markup.reveal("video")
    y = video["y"] + video["height"] / 2
    x = video["x"] + video["width"] * (crop_x(crop_points(markup)[index]["crop"]) + 480) / 1920
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x - 20, y)
    markup.page.mouse.move(x, y, steps=3)
    markup.page.mouse.down()
    return x, y


def open_the_minimap_at(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.press("KeyV")
    markup.page.wait_for_selector("#ytc-reframe-canvas", state="visible")
    if not markup.page.locator(".ytc-zoom-minimap").count():
        markup.press("Shift+KeyV")
    markup.page.wait_for_selector(".ytc-zoom-minimap canvas", state="visible")
    markup.next_frames(3)


def ctrl_press_on_the_minimap(markup: MarkupPage, crop: str) -> tuple[float, float]:
    """Press Ctrl and the mouse on the crop's center on the minimap, then release Ctrl with the mouse
    still down."""
    box = markup.page.locator(".ytc-zoom-minimap canvas").bounding_box()
    assert box
    crop_left, _, crop_width, _ = (float(v) for v in crop.split(":"))
    x = box["x"] + box["width"] * (crop_left + crop_width / 2) / 1920
    y = box["y"] + box["height"] / 2
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Control")
    markup.page.mouse.down()
    markup.page.keyboard.up("Control")
    return x, y


def ctrl_drag_on_the_minimap(markup: MarkupPage, crop: str) -> tuple[float, float]:
    """The press, then a move past the drag threshold."""
    x, y = ctrl_press_on_the_minimap(markup, crop)
    markup.page.mouse.move(x + 15, y, steps=4)
    markup.next_frames()
    return x, y


def two_pairs() -> list[dict]:
    next_pair = {**pair((CROP_B, False), (CROP_MIDDLE, False)), "start": 12, "end": 18}
    next_pair["cropMap"] = [{**point, "x": point["x"] + 9} for point in next_pair["cropMap"]]
    return [pair((CROP_A, False), (CROP_B, False), (CROP_A, False)), next_pair]


def saved_crop_maps(markup: MarkupPage) -> list[list[tuple[float, str, bool]]]:
    return [
        [(point["x"], point["crop"], point.get("hold", False)) for point in marker_pair["cropMap"]]
        for marker_pair in when_i_save_the_markers(markup)["markerPairs"]
    ]


def crop_points(markup: MarkupPage) -> list[dict]:
    """The crop chart's points with their hold flag; the chart's dataset is the pair's crop map."""
    return markup.page.evaluate(
        f"() => {CROP_CHART_JS}.data.datasets[0].data"
        ".map((p) => ({ x: p.x, crop: p.crop, hold: p.hold === true }))",
    )


def chart_bar_color_shares(markup: MarkupPage, indexes: list[int], bare_tick_time: float) -> dict:
    """The share of the crop chart canvas's pixels in the hold bar's color, rgb(255, 204, 51), down the
    plot area's column at each point's x and at a time with no point, keyed by point index (-1 for
    that time)."""
    return markup.page.evaluate(
        f"""([indexes, tickTime]) => {{
            const chart = {CROP_CHART_JS};
            const scale = chart.canvas.width / chart.canvas.clientWidth;
            const top = Math.round(chart.chartArea.top * scale);
            const height = Math.round((chart.chartArea.bottom - chart.chartArea.top) * scale);
            const ctx = chart.canvas.getContext('2d');
            const share = (x) => {{
                const data = ctx.getImageData(Math.round(x * scale), top, 1, height).data;
                let bar = 0;
                for (let i = 0; i < data.length; i += 4) {{
                    const near = (value, target) => Math.abs(value - target) <= 16;
                    if (near(data[i], 255) && near(data[i + 1], 204) && near(data[i + 2], 51)) bar++;
                }}
                return Math.round((bar / height) * 100) / 100;
            }};
            const points = chart.getDatasetMeta(0).data;
            const shares = Object.fromEntries(indexes.map((i) => [i, share(points[i]._view.x)]));
            const xScale = Object.values(chart.scales).find((s) => s.isHorizontal());
            shares[-1] = share(xScale.getPixelForValue(tickTime));
            return shares;
        }}""",
        [indexes, bare_tick_time],
    )


def saved_crop(saved: dict, index: int) -> str:
    return saved["markerPairs"][0]["cropMap"][index]["crop"]


def open_the_crop_chart(markup: MarkupPage) -> None:
    # The chart stays open across pairs, and Alt+D toggles it.
    if not markup.page.locator("#cropChartCanvas").is_visible():
        markup.press("Alt+KeyD")
    markup.page.wait_for_selector("#cropChartCanvas")


def select_crop_point(markup: MarkupPage, index: int) -> None:
    """Ctrl+hover a crop chart point, which selects it as the start of its section."""
    x, y = crop_point_position(markup, index)
    markup.page.mouse.move(x - 30, y)
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x, y, steps=3)
    markup.page.keyboard.up("Control")
    markup.next_frames()


# 1.5 ms before frame 180 (or 270) of the test video ends: a seek to it lands within the placement
# tolerance of the next frame's start, so the playhead reads as the next frame.
LATE_IN_FRAME_180 = round(181 / VIDEO_FPS - 0.0015, 6)


# Before the rate is measured the dev site's 30 fps video steps and compares frames at 60 fps, so a
# grid frame is half a video frame. In reframe the frame loop takes a frame on every refresh.
@pytest.mark.parametrize("reframe", [False, True], ids=["chart only", "in reframe"])
def test_points_added_on_one_frame_before_the_rate_is_measured_stay_one_point(
    markup: MarkupPage, reframe: bool
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site reporting no frame rate")
    given_a_pair_with_its_crop_chart_open(
        markup, pair((CROP_A, False), (CROP_A, False)), measured=False
    )
    if reframe:
        given_reframe_at(markup, 180.1 / VIDEO_FPS)
    for into_frame in (0.1, 0.6, 0.9):
        when_i_add_a_hold_point_at(markup, (180 + into_frame) / VIDEO_FPS)
    for _ in range(4):
        when_i_shift_scroll(markup, "up", 1)
        markup.press("Control+Alt+KeyA")
    then_no_two_crop_points_are_on_one_frame(markup)


LATE_IN_FRAME_270 = round(271 / VIDEO_FPS - 0.0015, 6)


def test_alt_wheel_in_reframe_steps_back_past_a_point_late_in_its_frame(markup: MarkupPage) -> None:
    given_a_pair_with_its_crop_chart_open(markup, pair_with_points_at(3, LATE_IN_FRAME_180, 9))
    given_reframe_at(markup, 7.5)
    when_i_alt_wheel_down(markup)
    then_the_video_shows_the_frame_of(markup, LATE_IN_FRAME_180)
    when_i_alt_wheel_down(markup)
    then_the_video_shows_the_frame_of(markup, 3)


def test_a_reframe_crop_edit_after_jumping_to_an_end_late_in_its_frame_is_applied(
    markup: MarkupPage,
) -> None:
    given_a_pair_with_its_crop_chart_open(markup, pair_with_points_at(3, 6, LATE_IN_FRAME_270))
    given_reframe_at(markup, 7.5)
    when_i_jump_to_the_next_marker(markup)
    before = saved_crop_maps(markup)
    when_i_pan_the_reframed_crop(markup)
    then_the_end_point_was_edited(markup, before)


def pair_with_points_at(*times: float) -> dict:
    crops = [CROP_A, CROP_B, CROP_A]
    crop_map = [{"x": t, "y": 0, "crop": crop} for t, crop in zip(times, crops, strict=True)]
    return {"start": times[0], "end": times[-1], "crop": CROP_A, "cropMap": crop_map}


@step
def when_i_alt_wheel_down(markup: MarkupPage) -> None:
    markup.page.mouse.move(*markup.center_of("video"))
    markup.page.keyboard.down("Alt")
    markup.page.mouse.wheel(0, 100)
    markup.page.keyboard.up("Alt")
    markup.eventually("() => !document.querySelector('video').seeking")
    markup.next_frames(2)


@step
def when_i_jump_to_the_next_marker(markup: MarkupPage) -> None:
    markup.press("Control+ArrowRight")
    markup.eventually("() => !document.querySelector('video').seeking")
    markup.next_frames(2)


@step
def when_i_pan_the_reframed_crop(markup: MarkupPage) -> None:
    video = markup.reveal("video")
    x, y = video["x"] + video["width"] * 0.3, video["y"] + video["height"] / 2
    ctrl_drag(markup, (x, y), (x + 100, y))
    markup.next_frames()


@step
def then_the_video_shows_the_frame_of(markup: MarkupPage, seconds: float) -> None:
    frame = int(markup.current_time() * VIDEO_FPS)
    markup.report(f"video at {markup.current_time():.6f}s, frame {frame}")
    assert frame == int((seconds + 0.001) * VIDEO_FPS)


@step
def then_the_end_point_was_edited(markup: MarkupPage, before: list) -> None:
    assert not markup.page.locator(".msg-div", has_text="Seek into the marker pair").count()
    assert len(crop_points(markup)) == 3, "the edit should update the end point, not add one"
    assert saved_crop_maps(markup) != before
