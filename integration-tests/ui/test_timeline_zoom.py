"""Timeline zoom (Shift+F): the brush on the progress bar, the zoomed bar, marker pairs on it, the
loop guard, scrubbing, and fading with the player controls. Terms follow the glossary at the top of
timeline-zoom.ts. Each test starts from crowded marker pairs with the zoom open."""

import io

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step
from PIL import Image

# 14 short pairs 3s apart from 3s, crowded together like the reported screenshot. Kept within the
# first 45s: an automated browser may only get YouTube's initial buffer, so later seeks can stall.
PAIR_COUNT = 14
PAIR_SPACING = 3
PAIR_LENGTH = 1.5
END_EDGE_HANDLE = ".ytc-tz-hit.edge-handle[data-edge='end']"


@pytest.fixture
def zoom(markup: MarkupPage) -> MarkupPage:
    given_crowded_marker_pairs(markup)
    given_the_timeline_zoom_is_open(markup)
    return markup


@pytest.mark.platform
def test_brush_handles_move_and_resize_the_zoom_range(zoom: MarkupPage) -> None:
    then_the_hints_bar_lists_the_zoomed_bar_gestures(zoom)
    before = zoom_range(zoom)
    when_i_drag_the_center_handle(zoom)
    moved = then_the_zoom_range_moved(zoom, before)
    when_i_drag_the_end_edge_handle(zoom)
    then_the_zoom_range_end_changed(zoom, moved)


@pytest.mark.platform
@pytest.mark.parametrize("edge", ["start", "end"])
def test_click_on_an_edge_handle_seeks_there(zoom: MarkupPage, edge: str) -> None:
    before = zoom_range(zoom)
    clicked_time = when_i_click_the_edge_handle(zoom, edge)
    then_playback_seeks_to(zoom, clicked_time)
    then_the_zoom_range_kept_its_length(zoom, before)


def test_edge_handles_ignore_a_playhead_drag_passing_over_them(zoom: MarkupPage) -> None:
    then_the_end_edge_handle_takes_the_pointer(zoom, expected=True)
    when_i_press_the_progress_bar_and_drag_onto_the_end_edge_handle(zoom)
    then_the_end_edge_handle_takes_the_pointer(zoom, expected=False)
    when_i_release_the_pointer(zoom)
    then_the_end_edge_handle_takes_the_pointer(zoom, expected=True)


def test_markers_show_over_the_brush_and_leave_its_handles_working(zoom: MarkupPage) -> None:
    pair_index = given_a_pair_ending_under_the_end_edge_handle(zoom)
    then_its_end_marker_shows_over_the_end_edge_handle(zoom, pair_index)
    then_the_end_edge_handle_takes_the_pointer_over_its_marker(zoom)
    then_the_center_handle_takes_the_pointer(zoom)
    when_i_click_its_end_number(zoom, pair_index)
    then_its_pair_editor_is_open(zoom)
    before = zoom_range(zoom)
    when_i_drag_the_end_edge_handle(zoom)
    then_the_zoom_range_end_changed(zoom, before)


def test_wheel_on_the_zoomed_bar_zooms_around_the_middle(zoom: MarkupPage) -> None:
    before = zoom_range(zoom)
    when_i_scroll_up_on_the_zoomed_bar(zoom)
    then_the_zoom_range_narrowed_around_its_middle(zoom, before)


def test_wheel_on_an_edge_handle_leaves_the_zoom_range(zoom: MarkupPage) -> None:
    before = zoom_range(zoom)
    when_i_scroll_on_the_end_edge_handle(zoom)
    then_the_zoom_range_is_unchanged(zoom, before)


@pytest.mark.platform
def test_loop_guard_on_both_bars(zoom: MarkupPage) -> None:
    pair_index = given_a_pair_opened_from_the_zoomed_bar(zoom)
    given_the_pair_loops(zoom)
    when_i_click_the_progress_bar_outside_the_pair(zoom, pair_index)
    then_playback_only_seeks_to_the_pair_start(zoom, pair_index)
    when_i_click_the_zoomed_bar_outside_the_pair(zoom, pair_index)
    then_playback_only_seeks_to_the_pair_start(zoom, pair_index)


def test_alt_drag_a_zoomed_number_moves_its_marker(zoom: MarkupPage) -> None:
    pair_index = given_a_pair_opened_from_the_zoomed_bar(zoom)
    pointer_x = when_i_alt_drag_its_start_number_left(zoom, pair_index)
    then_its_start_number_is_under(zoom, pair_index, pointer_x)


def test_alt_drag_a_zoomed_number_past_the_range_end_keeps_the_range(zoom: MarkupPage) -> None:
    pair_index = given_a_pair_opened_from_the_zoomed_bar(zoom)
    wait_for_the_zoom_to_settle(zoom)
    pressed = zoom_range(zoom)
    drag = when_i_alt_drag_its_end_number_past_the_range_end(zoom, pair_index)
    then_the_zoom_range_is_unchanged(zoom, pressed)
    when_i_release_the_alt_drag(zoom)
    then_the_zoom_range_is_unchanged(zoom, pressed)
    then_its_end_marker_is_at_the_pointer_time(zoom, pair_index, pressed, drag)


def test_alt_drag_a_zoomed_number_in_fullscreen_moves_its_marker(zoom: MarkupPage) -> None:
    # The dev site fullscreens the player, which holds the scrub and crop listeners, and the zoomed
    # bar moves inside it.
    pair_index = given_a_pair_opened_from_the_zoomed_bar(zoom)
    given_the_player_is_fullscreen(zoom)
    start, _ = pair_span(pair_index)
    record_seeks(zoom)
    pointer_x = when_i_alt_drag_its_start_number_left(zoom, pair_index)
    then_its_start_number_is_under(zoom, pair_index, pointer_x)
    then_playback_only_followed_the_marker(zoom, pair_index, start)


def test_ctrl_drag_on_the_zoomed_bar_in_fullscreen_leaves_the_crop(zoom: MarkupPage) -> None:
    given_a_pair_opened_from_the_zoomed_bar(zoom)
    given_a_fullscreen_player_with_the_zoomed_bar_over_the_video(zoom)
    before = crop(zoom)
    when_i_ctrl_drag_on_the_zoomed_bar(zoom)
    then_the_crop_is(zoom, before)


def test_ctrl_hover_on_the_zoomed_bar_in_fullscreen_keeps_it(zoom: MarkupPage) -> None:
    given_a_pair_opened_from_the_zoomed_bar(zoom)
    given_a_fullscreen_player_with_the_zoomed_bar_over_the_video(zoom)
    when_i_hold_ctrl_and_move_along_the_zoomed_bar(zoom)
    then_the_zoomed_bar_is_visible_with_no_crop_cursor(zoom)


def test_an_armed_crop_draw_hides_the_zoomed_bar(zoom: MarkupPage) -> None:
    # Why the draw needs no own-overlay check: its press can't land on the zoomed bar, even after a
    # Ctrl tap (whose keyup shows the controls when no draw is armed).
    given_a_pair_opened_from_the_zoomed_bar(zoom)
    given_a_crop_draw_is_armed(zoom)
    then_the_zoomed_bar_is_hidden(zoom)
    when_i_tap_ctrl(zoom)
    then_the_zoomed_bar_is_hidden(zoom)
    then_the_crop_hook_shows_the_draw_crosshair(zoom)


@pytest.mark.platform
def test_scrub_pauses_while_held_and_resumes_on_release(zoom: MarkupPage) -> None:
    given_the_video_is_playing(zoom)
    knob_target_x = when_i_press_and_drag_along_the_zoomed_bar(zoom)
    then_the_knob_is_under_the_pointer(zoom, knob_target_x)
    then_the_video_is_paused(zoom)
    when_i_release_the_pointer(zoom)
    then_the_video_is_playing(zoom)


@pytest.mark.platform
def test_follows_playback_and_fades_with_the_controls(zoom: MarkupPage) -> None:
    given_the_zoom_range_is_fitted_to_an_early_pair(zoom)
    end = zoom_range(zoom)[1]
    when_i_play_across_the_end_of_the_zoom_range(zoom, end)
    then_the_zoom_range_paged_forward(zoom, end)
    when_i_play_with_the_pointer_away_from_the_player(zoom)
    then_the_zoomed_bar_faded_with_the_controls(zoom)
    when_i_close_the_timeline_zoom(zoom)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_crowded_marker_pairs(markup: MarkupPage) -> None:
    markup.load_marker_pairs([pair_span(i) for i in range(PAIR_COUNT)])
    markup.seek(20)
    markup.shot("crowded-progress-bar")


@step
def given_the_timeline_zoom_is_open(markup: MarkupPage) -> None:
    markup.press("Shift+KeyF")
    markup.page.wait_for_selector(".ytc-tz-row-hit")
    markup.shot("timeline-open")


@step
def given_a_pair_ending_under_the_end_edge_handle(markup: MarkupPage) -> int:
    end = time_under(markup, END_EDGE_HANDLE)
    markup.load_marker_pairs([(end - 6, end)])
    pair_index = min(
        range(marker_count(markup) // 2),
        key=lambda i: abs(marker_time(markup, i, "end") - end),
    )
    markup.report(f"pair {pair_index + 1} ends at {end:.2f}s, under the end edge handle")
    markup.shot_of("marker-under-end-edge-handle", [END_EDGE_HANDLE], padding=40)
    return pair_index


@step
def given_a_pair_opened_from_the_zoomed_bar(markup: MarkupPage) -> int:
    number = markup.page.locator(".ytc-tz text.markerNumbering").first
    pair_index = int(number.get_attribute("data-pair-index") or 0)
    number.click()
    markup.shot("number-clicked")
    return pair_index


@step
def given_the_pair_loops(markup: MarkupPage) -> None:
    markup.press("Shift+KeyC")


@step
def given_the_zoom_range_is_fitted_to_an_early_pair(markup: MarkupPage) -> None:
    # Keeps the range's end early, within the first ~45s an automated browser reliably gets from
    # YouTube, whatever the video's length (the default range scales with it).
    given_a_pair_opened_from_the_zoomed_bar(markup)
    x, y = markup.center_of(".ytc-tz-hit.center-handle")
    markup.page.mouse.dblclick(x, y)
    wait_for_the_zoom_to_settle(markup)
    markup.report(f"fitted zoom range {zoom_range(markup)}")


@step
def given_the_player_is_fullscreen(markup: MarkupPage) -> None:
    markup.page.evaluate("s => document.querySelector(s).requestFullscreen()", markup.host.player)
    assert markup.eventually(
        "s => document.fullscreenElement === document.querySelector(s)"
        " && document.querySelector('.ytc-tz')?.parentElement",
        markup.host.player,
    ), "the player did not go fullscreen"
    markup.next_frames(5)  # the zoomed bar lays out at the fullscreen size
    markup.shot("fullscreen")


@step
def given_a_crop_draw_is_armed(markup: MarkupPage) -> None:
    markup.press("KeyX")
    assert markup.eventually(
        "s => document.querySelector(s).style.cursor === 'crosshair'", markup.host.crop_hook
    ), "the crop draw did not arm"


@step
def when_i_tap_ctrl(markup: MarkupPage) -> None:
    markup.press("Control")


@step
def given_a_fullscreen_player_with_the_zoomed_bar_over_the_video(markup: MarkupPage) -> None:
    # The dev site shows the video at most 720 px tall, so a 720 px screen puts the zoomed bar over it.
    markup.page.set_viewport_size({"width": 1280, "height": 720})
    given_the_player_is_fullscreen(markup)
    assert markup.eventually(
        "() => { const v = document.querySelector('video').getBoundingClientRect();"
        " const b = document.querySelector('.ytc-tz-row-hit').getBoundingClientRect();"
        " const y = (b.top + b.bottom) / 2; return v.top < y && y < v.bottom; }",
    ), "the zoomed bar is not over the video"


@step
def given_the_video_is_playing(markup: MarkupPage) -> None:
    start = markup.current_time()
    markup.play()
    assert markup.eventually("t => document.querySelector('video').currentTime > t", start)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_drag_the_center_handle(markup: MarkupPage) -> None:
    x, y = markup.center_of(".ytc-tz-hit.center-handle")
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 60, y, steps=5)
    markup.page.mouse.up()
    markup.shot("range-moved")


@step
def when_i_drag_the_end_edge_handle(markup: MarkupPage) -> None:
    # Mid-drag, the live label shows the edge time above the brush.
    x, y = markup.center_of(".ytc-tz-hit.edge-handle[data-edge='end']")
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 25, y, steps=4)
    markup.shot("resizing-mid-drag")
    markup.page.mouse.up()


@step
def when_i_click_the_edge_handle(markup: MarkupPage, edge: str) -> float:
    """Click without moving, and return the video time under the click on the progress bar. The
    handles sit just outside the zoom range, so at the video's start the start handle is before 0."""
    x, y = markup.center_of(f".ytc-tz-hit.edge-handle[data-edge='{edge}']")
    record_seeks(markup)
    markup.page.mouse.click(x, y)
    # Wait for the seek to start, not land: the end handle sits past 60 s, beyond the initial buffer
    # YouTube gives the automated browser, so there the seek never finishes.
    assert markup.eventually("() => window.__seeks.length > 0"), "no seek happened"
    markup.shot(f"{edge}-edge-handle-clicked")
    panel = markup.box_of(".ytc-tz")
    duration = markup.page.evaluate("() => document.querySelector('video').duration")
    return min(max((x - panel["x"]) / panel["width"] * duration, 0), duration)


@step
def when_i_press_the_progress_bar_and_drag_onto_the_end_edge_handle(markup: MarkupPage) -> None:
    x, y = markup.center_of(".ytc-tz-hit.edge-handle[data-edge='end']")
    markup.page.mouse.move(x + 80, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x, y, steps=4)


@step
def when_i_scroll_up_on_the_zoomed_bar(markup: MarkupPage) -> None:
    x, y = markup.center_of(".ytc-tz-row-hit")
    markup.page.mouse.move(x * 0.6, y)  # off-centre: the zoom ignores where the cursor is
    for _ in range(3):
        markup.page.mouse.wheel(0, -100)
    wait_for_the_zoom_to_settle(markup)
    markup.shot("wheel-zoomed-in")


@step
def when_i_scroll_on_the_end_edge_handle(markup: MarkupPage) -> None:
    x, y = markup.center_of(".ytc-tz-hit.edge-handle[data-edge='end']")
    markup.page.mouse.move(x, y)
    markup.page.mouse.wheel(0, 100)
    markup.next_frames(5)  # a zoom would have changed the chosen range within a frame or two


@step
def when_i_click_the_progress_bar_outside_the_pair(markup: MarkupPage, pair_index: int) -> None:
    start, _ = pair_span(pair_index)
    markup.seek(start + PAIR_LENGTH / 2)  # mid-pair, so going to the pair start is a real seek
    record_seeks(markup)
    # The panel's bottom edge sits on the progress bar on every platform.
    panel = markup.box_of(".ytc-tz")
    markup.page.mouse.click(panel["x"] + panel["width"] * 0.85, panel["y"] + panel["height"] - 2)
    wait_for_seeks_to_land(markup)
    markup.shot("loop-click-outside-went-to-pair-start")


@step
def when_i_click_the_zoomed_bar_outside_the_pair(markup: MarkupPage, pair_index: int) -> None:
    start, end = pair_span(pair_index)
    markup.seek(start + PAIR_LENGTH / 2)
    record_seeks(markup)
    bar = markup.box_of(".ytc-tz-row-hit")
    shown_start, shown_end = zoom_range(markup)
    fraction = next(
        f for f in (0.98, 0.02) if not start <= shown_start + f * (shown_end - shown_start) <= end
    )
    markup.page.mouse.click(bar["x"] + bar["width"] * fraction, bar["y"] + bar["height"] / 2)
    wait_for_seeks_to_land(markup)


@step
def when_i_alt_drag_its_start_number_left(markup: MarkupPage, pair_index: int) -> float:
    """Returns where the pointer let go."""
    x, y = markup.center_of(zoomed_number(pair_index, "start"))
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Alt")
    markup.page.mouse.down()
    markup.page.mouse.move(x - 20, y, steps=4)
    markup.shot("number-alt-dragging")
    markup.page.mouse.up()
    markup.page.keyboard.up("Alt")
    markup.next_frames(3)
    return x - 20


@step
def when_i_alt_drag_its_end_number_past_the_range_end(
    markup: MarkupPage, pair_index: int
) -> tuple[float, float]:
    """Hold the drag past the zoomed bar's right edge, and return the pointer's (press, now) x."""
    x, y = markup.center_of(zoomed_number(pair_index, "end"))
    panel = markup.box_of(".ytc-tz")
    to_x = panel["x"] + panel["width"] + 40
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Alt")
    markup.page.mouse.down()
    markup.page.mouse.move(to_x, y, steps=8)
    # Long enough for the per-frame seeks to land and playback following to page the range.
    markup.next_frames(20)
    markup.shot("number-alt-dragged-past-the-range-end")
    return x, to_x


@step
def when_i_release_the_alt_drag(markup: MarkupPage) -> None:
    markup.page.mouse.up()
    markup.page.keyboard.up("Alt")
    assert markup.eventually("() => !document.querySelector('video').seeking")
    markup.next_frames(20)


@step
def when_i_press_and_drag_along_the_zoomed_bar(markup: MarkupPage) -> float:
    bar = markup.box_of(".ytc-tz-row-hit")
    x, y = bar["x"] + bar["width"] * 0.3, bar["y"] + bar["height"] / 2
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 120, y, steps=6)
    markup.shot("scrubbing-mid-drag")
    return x + 120


@step
def when_i_ctrl_drag_on_the_zoomed_bar(markup: MarkupPage) -> None:
    # Diagonal, so a crop pan or an edge resize started by the press would both change the crop.
    x, y = zoomed_bar_point(markup)
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Control")
    markup.page.mouse.down()
    markup.page.mouse.move(x + 60, y - 60, steps=6)
    markup.shot("ctrl-dragging-on-the-zoomed-bar")
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")
    markup.next_frames(3)


@step
def when_i_hold_ctrl_and_move_along_the_zoomed_bar(markup: MarkupPage) -> None:
    # From the video the Ctrl hover hides the controls, and the zoomed bar with them, before the
    # pointer gets there; on purpose, as for the platform's own controls.
    x, y = zoomed_bar_point(markup)
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(x + 40, y, steps=6)
    markup.next_frames(3)  # the hover cursor updates once per frame
    markup.shot("ctrl-hovering-on-the-zoomed-bar")


@step
def when_i_release_the_pointer(markup: MarkupPage) -> None:
    markup.page.mouse.up()


@step
def when_i_play_across_the_end_of_the_zoom_range(markup: MarkupPage, end: float) -> None:
    markup.seek(end - 1)
    markup.play()
    past_end = end + 0.5
    assert markup.eventually("t => document.querySelector('video').currentTime > t", past_end, 8000)
    markup.pause()
    markup.shot("playback-paged-forward")


@step
def when_i_play_with_the_pointer_away_from_the_player(markup: MarkupPage) -> None:
    # Sample the controls' and the zoomed bar's opacity every frame while the platform auto-hides
    # its controls (YouTube); the dev site's controls stay up.
    markup.page.evaluate(
        """controlsSelector => {
          const controls = document.querySelector(controlsSelector);
          const panel = document.querySelector('.ytc-tz');
          window.__fadeGaps = [];
          const tick = () => {
            if (!window.__fadeGaps) return;
            const c = getComputedStyle(controls);
            const controlsOpacity = c.display === 'none' ? 0 : parseFloat(c.opacity);
            const p = getComputedStyle(panel);
            const panelOpacity = p.visibility === 'hidden' ? 0 : parseFloat(p.opacity);
            window.__fadeGaps.push(Math.abs(controlsOpacity - panelOpacity));
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }""",
        markup.host.controls,
    )
    markup.page.mouse.move(2, 2)
    markup.play()
    # Until the platform hides its controls (YouTube's auto-hide; the dev site's may stay up).
    controls_hidden = markup.eventually(
        "s => { const c = getComputedStyle(document.querySelector(s));"
        " return c.display === 'none' || parseFloat(c.opacity) === 0; }",
        markup.host.controls,
        6000,
    )
    markup.report(f"controls hid while playing: {controls_hidden}")
    markup.next_frames(10)  # a few frames with both hidden
    markup.shot("playing-idle")
    markup.pause()


@step
def when_i_close_the_timeline_zoom(markup: MarkupPage) -> None:
    markup.press("Shift+KeyF")
    markup.page.wait_for_selector(".ytc-tz", state="detached", timeout=2000)


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_hints_bar_lists_the_zoomed_bar_gestures(markup: MarkupPage) -> None:
    markup.press("Alt+KeyF")
    x, y = markup.center_of(".ytc-tz-row-hit")
    markup.page.mouse.move(x, y, steps=3)
    # The hints bar debounces region changes before switching to the zoomed bar's gestures.
    markup.page.locator(".hints-bar-host").get_by_text("Center Handle: Move").wait_for()
    markup.shot("hints-bar-on-zoom")
    markup.press("Alt+KeyF")


@step
def then_the_zoom_range_moved(
    markup: MarkupPage,
    before: tuple[float, float],
) -> tuple[float, float]:
    after = zoom_range(markup)
    markup.report(f"zoom range {before} -> {after}")
    assert after[0] > before[0]
    assert after[1] - after[0] == pytest.approx(before[1] - before[0])
    return after


@step
def then_the_zoom_range_end_changed(markup: MarkupPage, before: tuple[float, float]) -> None:
    after = zoom_range(markup)
    markup.report(f"zoom range {before} -> {after}")
    assert after[0] == pytest.approx(before[0])
    assert after[1] != pytest.approx(before[1])


@step
def then_the_zoom_range_narrowed_around_its_middle(
    markup: MarkupPage,
    before: tuple[float, float],
) -> None:
    after = zoom_range(markup)
    markup.report(f"zoom range {before} -> {after}")
    assert after[1] - after[0] < before[1] - before[0]
    assert sum(after) / 2 == pytest.approx(sum(before) / 2, abs=0.05)


@step
def then_the_zoom_range_is_unchanged(markup: MarkupPage, before: tuple[float, float]) -> None:
    after = zoom_range(markup)
    markup.report(f"zoom range {before} -> {after}")
    assert after == before


@step
def then_playback_only_seeks_to_the_pair_start(markup: MarkupPage, pair_index: int) -> None:
    # No seek may land outside the pair, or the clicked frame would flash before the loop returns.
    start, end = pair_span(pair_index)
    seeks = markup.page.evaluate("() => window.__seeks")
    markup.report(f"seeks {[round(t, 2) for t in seeks]}")
    assert all(start - 0.1 <= t <= end + 0.1 for t in seeks)
    assert any(t == pytest.approx(start, abs=0.1) for t in seeks)


@step
def then_the_end_edge_handle_takes_the_pointer(markup: MarkupPage, *, expected: bool) -> None:
    # The handle under the pointer, as the browser picks it for the cursor and hover styles
    x, y = markup.center_of(".ytc-tz-hit.edge-handle[data-edge='end']")
    is_handle = markup.page.evaluate(
        "([x, y]) => !!document.elementFromPoint(x, y)?.matches('.ytc-tz-hit.edge-handle')",
        [x, y],
    )
    assert is_handle == expected


@step
def when_i_click_its_end_number(markup: MarkupPage, pair_index: int) -> None:
    markup.page.locator(f"#end-marker-numberings text[data-idx='{pair_index + 1}']").click()


@step
def then_its_end_marker_shows_over_the_end_edge_handle(markup: MarkupPage, pair_index: int) -> None:
    # The pointer rests on the video, which keeps the controls shown and the handle unlit.
    markup.page.mouse.move(*markup.center_of("video"))
    marker = markup.box_of(f"#markers-svg rect:nth-child({pair_index * 2 + 2})")
    clip = {"x": marker["x"] - 1, "y": marker["y"] + 4, "width": 3, "height": 6}
    image = Image.open(io.BytesIO(markup.page.screenshot(clip=clip))).convert("RGB")
    colors = list(image.getdata())
    markup.report(f"pixels at the marker {sorted(set(colors))}")
    # The marker is gold, the handle light grey.
    assert any(r > 150 and g > 120 and b < 100 for r, g, b in colors), "the handle hides the marker"


@step
def then_the_end_edge_handle_takes_the_pointer_over_its_marker(markup: MarkupPage) -> None:
    then_the_handle_takes_the_pointer(markup, END_EDGE_HANDLE, "ew-resize")
    markup.shot_of("end-edge-handle-hovered", [END_EDGE_HANDLE], padding=40)


@step
def then_the_center_handle_takes_the_pointer(markup: MarkupPage) -> None:
    then_the_handle_takes_the_pointer(markup, ".ytc-tz-hit.center-handle", "grab")


def then_the_handle_takes_the_pointer(markup: MarkupPage, hit: str, cursor: str) -> None:
    """The pointer over the handle's middle reaches its hit area, shows its cursor and lights it."""
    x, y = markup.center_of(hit)
    markup.page.mouse.move(x, y)
    assert markup.eventually(
        """([x, y, hit, cursor]) => {
          const el = document.elementFromPoint(x, y);
          const drawn = el?.parentElement.querySelector('.ytc-tz-edge-handle, .ytc-tz-center-handle');
          return el.matches(hit) && getComputedStyle(el).cursor === cursor
            && getComputedStyle(drawn).fill === 'rgb(255, 255, 255)';
        }""",
        [x, y, hit, cursor],
    ), f"{hit} does not take the pointer with the {cursor} cursor and its hover light"


@step
def then_its_pair_editor_is_open(markup: MarkupPage) -> None:
    markup.page.wait_for_selector("#crop-input", state="attached")


@step
def then_playback_seeks_to(markup: MarkupPage, time: float) -> None:
    seeks = markup.page.evaluate("() => window.__seeks")
    markup.report(f"clicked at {time:.2f}s, seeks {[round(t, 2) for t in seeks]}")
    # Within a pixel's worth of time, since the click and the seek map the same x
    pixel_seconds = markup.page.evaluate(
        "() => document.querySelector('video').duration"
        " / document.querySelector('.ytc-tz').getBoundingClientRect().width",
    )
    assert any(t == pytest.approx(time, abs=pixel_seconds) for t in seeks)


@step
def then_the_zoom_range_kept_its_length(markup: MarkupPage, before: tuple[float, float]) -> None:
    # A seek past the range's end pages the zoom range forward, but a click never resizes it.
    wait_for_the_zoom_to_settle(markup)
    after = zoom_range(markup)
    markup.report(f"zoom range {before} -> {after}")
    assert after[1] - after[0] == pytest.approx(before[1] - before[0])


@step
def then_its_start_number_is_under(markup: MarkupPage, pair_index: int, pointer_x: float) -> None:
    # The grip point stays under the pointer, give or take a frame's snap.
    x, _ = markup.center_of(zoomed_number(pair_index, "start"))
    markup.report(f"start number at x {x:.1f}, pointer at {pointer_x:.1f}")
    assert x == pytest.approx(pointer_x, abs=3)


@step
def then_playback_only_followed_the_marker(
    markup: MarkupPage, pair_index: int, pressed_time: float
) -> None:
    # The drag seeks to the marker as it moves; an Alt+drag scrub of the video would seek elsewhere.
    moved_to = marker_time(markup, pair_index, "start")
    seeks = markup.page.evaluate("() => window.__seeks")
    markup.report(
        f"marker {pressed_time:.3f}s -> {moved_to:.3f}s, seeks {[round(t, 3) for t in seeks]}"
    )
    assert moved_to < pressed_time - 0.01
    assert all(moved_to - 0.01 <= t <= pressed_time + 0.01 for t in seeks)
    assert seeks
    assert seeks[-1] == pytest.approx(moved_to, abs=0.01)


@step
def then_the_crop_is(markup: MarkupPage, expected: str) -> None:
    actual = crop(markup)
    markup.report(f"crop {expected} -> {actual}")
    assert actual == expected


@step
def then_the_zoomed_bar_is_visible_with_no_crop_cursor(markup: MarkupPage) -> None:
    visibility, cursor = markup.page.evaluate(
        "s => [getComputedStyle(document.querySelector('.ytc-tz')).visibility,"
        " document.querySelector(s).style.cursor]",
        markup.host.crop_hook,
    )
    markup.page.keyboard.up("Control")
    markup.report(f"zoomed bar {visibility}, crop hook cursor {cursor!r}")
    assert visibility == "visible"
    assert cursor == ""


@step
def then_the_zoomed_bar_is_hidden(markup: MarkupPage) -> None:
    markup.next_frames(5)  # the zoomed bar copies the controls' visibility each frame
    visibility = markup.page.evaluate(
        "() => getComputedStyle(document.querySelector('.ytc-tz')).visibility"
    )
    assert visibility == "hidden", "the zoomed bar shows while a crop draw is armed"


@step
def then_the_crop_hook_shows_the_draw_crosshair(markup: MarkupPage) -> None:
    cursor = markup.page.locator(markup.host.crop_hook).evaluate("element => element.style.cursor")
    assert cursor == "crosshair"


@step
def then_its_end_marker_is_at_the_pointer_time(
    markup: MarkupPage,
    pair_index: int,
    pressed: tuple[float, float],
    drag: tuple[float, float],
) -> None:
    # The drag maps the pointer through the range shown at the press, even past its end.
    _, end = pair_span(pair_index)
    panel = markup.box_of(".ytc-tz")
    seconds_per_px = (pressed[1] - pressed[0]) / panel["width"]
    expected = end + (drag[1] - drag[0]) * seconds_per_px
    actual = marker_time(markup, pair_index, "end")
    markup.report(f"end marker at {actual:.3f}s, pointer time {expected:.3f}s")
    assert actual == pytest.approx(expected, abs=1 / 30 + seconds_per_px)


@step
def then_the_knob_is_under_the_pointer(markup: MarkupPage, pointer_x: float) -> None:
    # It follows the pointer each frame instead of stepping along as each seek lands.
    knob = markup.box_of(".ytc-tz-knob")
    assert knob["x"] + knob["width"] / 2 == pytest.approx(pointer_x, abs=3)


@step
def then_the_video_is_paused(markup: MarkupPage) -> None:
    assert markup.is_paused()


@step
def then_the_video_is_playing(markup: MarkupPage) -> None:
    assert markup.eventually("() => !document.querySelector('video').paused")
    markup.pause()


@step
def then_the_zoom_range_paged_forward(markup: MarkupPage, old_end: float) -> None:
    start, end = zoom_range(markup)
    markup.report(f"zoom range now {start:.1f}-{end:.1f}, was ending at {old_end:.1f}")
    assert start < markup.current_time() < end
    assert end > old_end


@step
def then_the_zoomed_bar_faded_with_the_controls(markup: MarkupPage) -> None:
    gaps = markup.page.evaluate(
        "() => { const g = window.__fadeGaps; window.__fadeGaps = null; return g; }",
    )
    # The panel copies the controls' opacity at the start of its frame, so a fade may show one
    # frame's step of difference (YouTube's 0.1s fade moves about 0.17 per frame at 60 Hz).
    largest = max(gaps)
    markup.report(f"opacity gap over {len(gaps)} frames: largest {largest:.2f}")
    assert largest <= 0.2


# ─── page state ─────────────────────────────────────────────────────────────


def zoom_range(markup: MarkupPage) -> tuple[float, float]:
    """The timeline zoom's chosen range, from the panel's data attributes."""
    start, end = markup.page.evaluate(
        "() => { const d = document.querySelector('.ytc-tz').dataset;"
        " return [Number(d.rangeStart), Number(d.rangeEnd)]; }",
    )
    return start, end


def crop(markup: MarkupPage) -> str:
    return markup.page.locator("#crop-input").input_value()


def zoomed_bar_point(markup: MarkupPage) -> tuple[float, float]:
    bar = markup.box_of(".ytc-tz-row-hit")
    return bar["x"] + bar["width"] * 0.3, bar["y"] + bar["height"] / 2


def pair_span(pair_index: int) -> tuple[float, float]:
    start = PAIR_SPACING * (pair_index + 1)
    return start, start + PAIR_LENGTH


def record_seeks(markup: MarkupPage) -> None:
    """Start (or restart) collecting the video's seek targets in `window.__seeks`."""
    markup.page.evaluate(
        "() => { if (!window.__seeks) document.querySelector('video')"
        ".addEventListener('seeking', (e) => window.__seeks.push(e.target.currentTime));"
        " window.__seeks = []; }",
    )


def zoomed_number(pair_index: int, marker: str) -> str:
    return f".ytc-tz text[data-pair-index='{pair_index}'][data-marker='{marker}']"


def marker_time(markup: MarkupPage, pair_index: int, marker: str) -> float:
    """A marker's time, from its position on the progress bar (a percentage of the duration)."""
    return markup.page.evaluate(
        "([i, end]) => parseFloat(document.querySelector('#markers-div svg')"
        ".children[i * 2 + end].getAttribute('x')) / 100"
        " * document.querySelector('video').duration",
        [pair_index, 1 if marker == "end" else 0],
    )


def marker_count(markup: MarkupPage) -> int:
    return markup.page.evaluate("() => document.querySelector('#markers-div svg').children.length")


def time_under(markup: MarkupPage, selector: str) -> float:
    """The video time on the progress bar under the middle of the element."""
    x, _ = markup.center_of(selector)
    return markup.page.evaluate(
        "x => { const b = document.querySelector('#markers-div svg').getBoundingClientRect();"
        " return (x - b.left) / b.width * document.querySelector('video').duration; }",
        x,
    )


def wait_for_the_zoom_to_settle(markup: MarkupPage) -> None:
    """Wait for the eased range on screen to reach the chosen range."""
    assert markup.eventually(
        "() => { const d = document.querySelector('.ytc-tz').dataset;"
        " return d.shownStart === d.rangeStart && d.shownEnd === d.rangeEnd; }",
    ), "the zoomed bar did not settle on the chosen range"


def wait_for_seeks_to_land(markup: MarkupPage) -> None:
    """Wait for a recorded seek to finish, plus a few frames for any loop pull-back to follow."""
    assert markup.eventually(
        "() => window.__seeks.length > 0 && !document.querySelector('video').seeking",
    ), "no seek happened"
    markup.next_frames(5)
