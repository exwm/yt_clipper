"""Hold crop points: a hold point shows the crop of the crop point before it and follows it when it
changes. The flag is saved and loaded with the markers."""

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
from test_crop_easing import when_i_save_the_markers

# Full-height crops, so a drag at the video's middle row starts inside them. Crops are x:y:w:h in
# the default 1920x1080 crop resolution.
CROP_A = "0:0:960:1080"
CROP_B = "640:0:960:1080"
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
        markup, pair((CROP_A, False), (CROP_B, False), (CROP_B, True))
    )
    moved = when_i_pan_crop_point(markup, 1, 100)
    then_the_crop_points_are(markup, [(CROP_A, False), (moved, False), (moved, True)])


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


# ─── given ──────────────────────────────────────────────────────────────────


@step
def given_a_pair_with_its_crop_chart_open(markup: MarkupPage, marker_pair: dict) -> None:
    markup.load_saved_marker_pairs([marker_pair])
    markup.open_marker_pair(0)
    open_the_crop_chart(markup)


# ─── when ───────────────────────────────────────────────────────────────────


@step
def when_i_select_crop_point(markup: MarkupPage, index: int) -> None:
    select_crop_point(markup, index)


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
def then_only_hold_points_have_a_yellow_bar(markup: MarkupPage, holds: list[int], normal: list[int]) -> None:
    # The playhead line is drawn on the chart too, so park it between points and grid ticks. A bare
    # grid tick shows the bar stands apart from a grid line.
    markup.seek(5.3, presented=True)
    markup.page.mouse.move(0, 0)
    markup.next_frames()
    shares = chart_bar_color_shares(markup, [*holds, *normal], bare_tick_time=5.0)
    markup.report(f"share of each column in the bar's color, by point index (-1 is the bare tick): {shares}")
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
