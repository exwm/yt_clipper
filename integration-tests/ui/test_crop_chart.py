"""Crop chart and crop chip: the chip shows the live interpolated crop, the chart keeps its zoom
through point edits, a fast point drag still lands the video on the point, sections are labelled,
and on the generic site the chart sits below the settings editor. Most tests start from a marker
pair with a dynamic crop: a crop point between its start and end, panned right."""

import pytest
from harness.hosts import DEV_SITE_HOST
from harness.markup_page import MarkupPage
from harness.steps import step

PAIR_START = 3.0
PAIR_END = 9.0
MIDDLE_POINT_TIME = 6.0


@pytest.fixture
def dynamic_crop(markup: MarkupPage) -> MarkupPage:
    given_a_marker_pair_with_its_editor_open(markup)
    given_the_crop_chart_is_open(markup)
    given_a_crop_point_in_the_middle_panned_right(markup)
    return markup


@pytest.mark.platform
def test_crop_chip_shows_the_live_interpolated_crop(dynamic_crop: MarkupPage) -> None:
    when_i_seek_to(dynamic_crop, (PAIR_START + MIDDLE_POINT_TIME) / 2)
    then_the_crop_chip_x_is_between_the_first_two_points(dynamic_crop)


def test_crop_preview_stays_on_the_frame_on_screen_after_a_seek_within_it(
    dynamic_crop: MarkupPage,
) -> None:
    on_screen = when_i_pause_mid_pan_and_seek_within_the_frame(dynamic_crop)
    when_i_switch_the_crop_easing_away_and_back(dynamic_crop)
    then_the_crop_chip_is_unchanged(dynamic_crop, on_screen)


def test_crop_chart_sections_are_labelled(dynamic_crop: MarkupPage) -> None:
    # The labels (pan, zoom, speed, pan direction) are drawn on the chart canvas, so this is a
    # screenshot for review; their values are unit-tested in crop-section.test.ts.
    then_the_crop_chart_is_drawn(dynamic_crop)


def test_crop_chart_keeps_its_zoom_through_point_edits(dynamic_crop: MarkupPage) -> None:
    zoomed = when_i_ctrl_scroll_to_zoom_the_crop_chart(dynamic_crop)
    when_i_click_a_crop_point(dynamic_crop, 1)
    then_the_crop_chart_zoom_is_unchanged(dynamic_crop, zoomed)
    when_i_add_a_crop_point_at(dynamic_crop, 7.5)
    then_the_crop_chart_zoom_is_unchanged(dynamic_crop, zoomed)
    when_i_delete_crop_point(dynamic_crop, 2)
    then_the_crop_chart_zoom_is_unchanged(dynamic_crop, zoomed)


@pytest.mark.platform
def test_fast_crop_point_drag_lands_the_video_on_the_point(dynamic_crop: MarkupPage) -> None:
    before = crop_points(dynamic_crop)[1]["x"]
    when_i_quickly_drag_crop_point_right(dynamic_crop, 1)
    then_crop_point_moved_later(dynamic_crop, 1, before)
    then_the_video_is_at_crop_point(dynamic_crop, 1)


# The test video is 30 fps, with frame n starting at exactly n / 30 s. Rounding the playhead to
# 0.01 s would put these points at 6.03 s (frame 180) and 6.70 s (frame 201).
@pytest.mark.parametrize(("frame", "into_frame"), [(181, 0.03), (200, 0.98)])
def test_a_crop_point_added_at_the_playhead_marks_the_start_of_its_frame(
    markup: MarkupPage, frame: int, into_frame: float
) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("relies on the dev site's test video frame times")
    given_a_marker_pair_with_its_editor_open(markup)
    given_the_crop_chart_is_open(markup)
    when_i_add_a_crop_point_at(markup, (frame + into_frame) / 30)
    then_a_crop_point_is_at(markup, frame / 30)


def test_crop_chart_sits_below_the_settings_editor(markup: MarkupPage) -> None:
    if markup.host != DEV_SITE_HOST:
        pytest.skip("the chart placement fix is for the generic yt_clipper site")
    given_a_marker_pair_with_its_editor_open(markup)
    given_the_crop_chart_is_open(markup)
    then_the_crop_chart_is_below_the_settings_editor(markup)


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_a_marker_pair_with_its_editor_open(markup: MarkupPage) -> None:
    markup.measure_frame_rate()
    markup.add_marker_pair(PAIR_START, PAIR_END)
    markup.open_marker_pair(0)


@step
def given_the_crop_chart_is_open(markup: MarkupPage) -> None:
    markup.press("Alt+KeyD")
    markup.page.wait_for_selector("#cropChartCanvas")


@step
def given_a_crop_point_in_the_middle_panned_right(markup: MarkupPage) -> None:
    # In pan-only mode a resize applies to every crop point, so narrow the crop first, then make
    # it dynamic by panning a new middle point.
    video = markup.reveal("video")
    y = video["y"] + video["height"] / 2
    right_edge = video["x"] + video["width"] - 4
    ctrl_drag(markup, (right_edge, y), (right_edge - 300, y))
    when_i_add_a_crop_point_at(markup, MIDDLE_POINT_TIME)
    inside = video["x"] + video["width"] * 0.3
    ctrl_drag(markup, (inside, y), (inside + 150, y))
    offsets = [crop_x(point["crop"]) for point in crop_points(markup)]
    markup.report(f"crop point x offsets {offsets}")
    assert offsets[1] > offsets[0], "the middle crop point should be panned right of the start"
    markup.shot("dynamic-crop")


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_seek_to(markup: MarkupPage, seconds: float) -> None:
    markup.seek(seconds, presented=True)
    markup.next_frames(3)  # the preview loop updates the chip on the presented frame


@step
def when_i_pause_mid_pan_and_seek_within_the_frame(markup: MarkupPage) -> str:
    # The test video is 30 fps. Land early in a frame mid-pan, then move the playhead most of a frame
    # later: the same frame stays on screen, so the crop must not move.
    frame = round((PAIR_START + MIDDLE_POINT_TIME) / 2 * 30)
    when_i_seek_to(markup, (frame + 0.1) / 30)
    on_screen = markup.page.locator("#interp-crop-value").inner_text()
    markup.page.evaluate(
        f"() => {{ document.querySelector('video').currentTime = {(frame + 0.9) / 30}; }}"
    )
    markup.next_frames(3)
    markup.report(f"crop chip on frame {frame}: {on_screen!r}")
    return on_screen


@step
def when_i_switch_the_crop_easing_away_and_back(markup: MarkupPage) -> None:
    # A crop easing change redraws the crop without a seek, outside the per-frame loop.
    markup.page.evaluate(
        """() => {
            const select = document.querySelector('#crop-point-easing-input');
            const original = select.value;
            for (const value of ['smoothInOut', original]) {
                select.value = value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }"""
    )
    markup.next_frames(3)


@step
def when_i_add_a_crop_point_at(markup: MarkupPage, seconds: float) -> None:
    # A point marks the frame on screen, so wait for the seek to present it.
    markup.seek(seconds, presented=True)
    count = len(crop_points(markup))
    markup.press("Alt+KeyA")
    assert len(crop_points(markup)) == count + 1


@step
def when_i_ctrl_scroll_to_zoom_the_crop_chart(markup: MarkupPage) -> tuple[float, float]:
    before = crop_chart_x_range(markup)
    x, y = markup.center_of("#cropChartCanvas")
    markup.page.mouse.move(x, y)
    markup.page.keyboard.down("Control")
    for _ in range(4):
        markup.page.mouse.wheel(0, -100)
    markup.page.keyboard.up("Control")
    zoomed = crop_chart_x_range(markup)
    markup.report(f"crop chart x range {before} -> {zoomed}")
    assert zoomed[1] - zoomed[0] < before[1] - before[0], "ctrl+scroll should zoom the chart in"
    return zoomed


@step
def when_i_click_a_crop_point(markup: MarkupPage, index: int) -> None:
    x, y = crop_point_position(markup, index)
    markup.page.mouse.click(x, y)
    markup.next_frames()


@step
def when_i_delete_crop_point(markup: MarkupPage, index: int) -> None:
    count = len(crop_points(markup))
    x, y = crop_point_position(markup, index)
    markup.page.keyboard.down("Alt")
    markup.page.keyboard.down("Shift")
    markup.page.mouse.click(x, y)
    markup.page.keyboard.up("Shift")
    markup.page.keyboard.up("Alt")
    assert markup.eventually(f"n => {CROP_CHART_JS}.data.datasets[0].data.length === n", count - 1)


@step
def when_i_quickly_drag_crop_point_right(markup: MarkupPage, index: int) -> None:
    # Two coarse moves: the in-flight seeks of a fast drag must still end on the final position.
    x, y = crop_point_position(markup, index)
    markup.page.mouse.move(x, y)
    markup.page.mouse.down()
    markup.page.mouse.move(x + 40, y, steps=2)
    markup.page.mouse.up()


# ─── then ───────────────────────────────────────────────────────────────────


@step
def then_the_crop_chip_x_is_between_the_first_two_points(markup: MarkupPage) -> None:
    first, second = (crop_x(point["crop"]) for point in crop_points(markup)[:2])
    chip = markup.page.locator("#interp-crop-value").inner_text()
    markup.report(f"chip {chip!r}, point x offsets {first} and {second}")
    markup.shot("crop-chip-interpolated")
    assert min(first, second) < crop_x(chip) < max(first, second)


@step
def then_a_crop_point_is_at(markup: MarkupPage, seconds: float) -> None:
    times = [point["x"] for point in crop_points(markup)]
    markup.report(f"crop point times {times}")
    assert any(abs(time - seconds) < 1e-5 for time in times)


@step
def then_the_crop_chip_is_unchanged(markup: MarkupPage, on_screen: str) -> None:
    chip = markup.page.locator("#interp-crop-value").inner_text()
    markup.report(f"crop chip after the seek and easing switch: {chip!r}")
    assert chip == on_screen


@step
def then_the_crop_chart_is_drawn(markup: MarkupPage) -> None:
    markup.box_of("#cropChartCanvas")
    markup.shot("crop-chart-sections")


@step
def then_the_crop_chart_zoom_is_unchanged(markup: MarkupPage, zoomed: tuple[float, float]) -> None:
    now = crop_chart_x_range(markup)
    markup.report(f"crop chart x range {now}")
    assert now == pytest.approx(zoomed)


@step
def then_crop_point_moved_later(markup: MarkupPage, index: int, before: float) -> None:
    after = crop_points(markup)[index]["x"]
    markup.report(f"crop point {index} {before:.3f}s -> {after:.3f}s")
    assert after > before


@step
def then_the_video_is_at_crop_point(markup: MarkupPage, index: int) -> None:
    point_time = crop_points(markup)[index]["x"]
    # The drag's last seek may still be landing.
    markup.eventually(
        "t => { const v = document.querySelector('video');"
        " return !v.seeking && Math.abs(v.currentTime - t) < 0.05; }",
        point_time,
    )
    video_time = markup.current_time()
    markup.report(f"point at {point_time:.3f}s, video at {video_time:.3f}s")
    assert video_time == pytest.approx(point_time, abs=0.05)


@step
def then_the_crop_chart_is_below_the_settings_editor(markup: MarkupPage) -> None:
    editor = markup.box_of("#ytc-editor")
    chart = markup.box_of("#cropChartCanvas")
    markup.report(f"editor bottom {editor['y'] + editor['height']:.0f}, chart top {chart['y']:.0f}")
    markup.shot("crop-chart-placement")
    assert chart["y"] >= editor["y"] + editor["height"] - 1


# ─── page state ─────────────────────────────────────────────────────────────

# The crop chart's Chart.js (v2) instance; the userscript loads Chart.js as a page global.
CROP_CHART_JS = (
    "Object.values(Chart.instances).find((chart) => chart.canvas.id === 'cropChartCanvas')"
)


def crop_points(markup: MarkupPage) -> list[dict]:
    return markup.page.evaluate(
        f"() => {CROP_CHART_JS}.data.datasets[0].data.map((p) => ({{ x: p.x, crop: p.crop }}))",
    )


def crop_chart_x_range(markup: MarkupPage) -> tuple[float, float]:
    low, high = markup.page.evaluate(
        f"() => {{ const s = Object.values({CROP_CHART_JS}.scales).find((s) => s.isHorizontal());"
        " return [s.min, s.max]; }",
    )
    return low, high


def crop_point_position(markup: MarkupPage, index: int) -> tuple[float, float]:
    """A crop point's position in the viewport, from the chart's own layout."""
    markup.reveal("#cropChartCanvas")
    x, y = markup.page.evaluate(
        f"(i) => {{ const chart = {CROP_CHART_JS};"
        " const element = chart.getDatasetMeta(0).data[i];"
        # Chart.js 2 keeps the drawn position under _model; Chart.js 4 has it on the element.
        " const point = element._model ?? element;"
        " const box = chart.canvas.getBoundingClientRect();"
        " return [box.left + point.x, box.top + point.y]; }",
        index,
    )
    return x, y


def crop_x(crop: str) -> float:
    return float(crop.split(":")[0])


def ctrl_drag(markup: MarkupPage, start: tuple[float, float], end: tuple[float, float]) -> None:
    """Ctrl+drag on the video from `start` to `end`, approaching `start` from the left so the crop
    overlay's Ctrl+hover has picked the region under it (edge resize or inside pan)."""
    markup.page.keyboard.down("Control")
    markup.page.mouse.move(start[0] - 20, start[1])
    markup.page.mouse.move(*start, steps=3)
    markup.page.mouse.down()
    markup.page.mouse.move(*end, steps=8)
    markup.page.mouse.up()
    markup.page.keyboard.up("Control")
