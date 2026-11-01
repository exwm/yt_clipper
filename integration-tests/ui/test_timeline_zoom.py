"""Timeline zoom (Shift+F): the brush on the progress bar, the zoomed bar, marker pairs on it, the
loop guard, scrubbing, and fading with the player controls. Terms follow the glossary at the top of
timeline-zoom.ts. Each test starts from crowded marker pairs with the zoom open."""

import pytest
from harness.markup_page import MarkupPage
from harness.steps import step

# 14 short pairs 3s apart from 3s, crowded together like the reported screenshot. Kept within the
# first 45s: an automated browser may only get YouTube's initial buffer, so later seeks can stall.
PAIR_COUNT = 14
PAIR_SPACING = 3
PAIR_LENGTH = 1.5


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
    before = start_marker_x(zoom, pair_index)
    when_i_alt_drag_its_start_number_left(zoom, pair_index)
    then_its_start_marker_moved(zoom, pair_index, before)


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
def when_i_alt_drag_its_start_number_left(markup: MarkupPage, pair_index: int) -> None:
    x, y = markup.center_of(f".ytc-tz text[data-pair-index='{pair_index}'][data-marker='start']")
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Alt")
    markup.page.mouse.down()
    markup.page.mouse.move(x - 20, y, steps=4)
    markup.shot("number-alt-dragging")
    markup.page.mouse.up()
    markup.page.keyboard.up("Alt")


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
def then_its_start_marker_moved(markup: MarkupPage, pair_index: int, before: str) -> None:
    after = start_marker_x(markup, pair_index)
    markup.report(f"start marker x {before} -> {after}")
    assert after != before


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


def start_marker_x(markup: MarkupPage, pair_index: int) -> str:
    return markup.page.evaluate(
        "(i) => document.querySelector('#markers-div svg').children[i * 2].getAttribute('x')",
        pair_index,
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
