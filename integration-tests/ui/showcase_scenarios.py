"""Named page setups for release showcase shots (showcase.toml names them). Each builds on the feature
tests' own steps, so a showcase scenario breaks loudly when the feature it shows changes."""

from typing import Callable, Dict

from harness.markup_page import MarkupPage
from harness.steps import step
from test_crop_chart import (
    MIDDLE_POINT_TIME,
    PAIR_START,
    given_a_crop_point_in_the_middle_panned_right,
    given_a_marker_pair_with_its_editor_open,
    given_the_crop_chart_is_open,
    when_i_seek_to,
)
from test_crop_easing import (
    show_additional_settings,
    then_a_cinematic_path_is_baked,
    when_i_choose_easing,
)
from test_reframe import (
    given_a_marker_pair_with_a_narrowed_crop,
    given_reframe_is_on,
    given_the_minimap_is_shown,
)

Scenario = Callable[[MarkupPage], None]
SCENARIOS: Dict[str, Scenario] = {}


def scenario(name: str) -> Callable[[Scenario], Scenario]:
    def register(setup: Scenario) -> Scenario:
        SCENARIOS[name] = setup
        return setup

    return register


# A crop path with one section of each kind: static, a fast pan right, a pure zoom in, and a slower
# pan+zoom out. Crops are x:y:w:h in the default 1920x1080 crop resolution.
SECTIONS_PAIR = {
    "start": 3,
    "end": 15,
    "crop": "0:0:960:540",
    "enableZoomPan": True,
    "cropMap": [
        {"x": 3, "y": 0, "crop": "0:0:960:540"},
        {"x": 5, "y": 0, "crop": "0:0:960:540"},
        {"x": 7, "y": 0, "crop": "960:0:960:540"},
        {"x": 10, "y": 0, "crop": "1120:90:640:360"},
        {"x": 13, "y": 0, "crop": "320:400:960:540"},
        {"x": 15, "y": 0, "crop": "320:400:960:540"},
    ],
}

# A pan to a new crop that holds until a later pan: the end of the hold is a hold point.
HOLD_PAIR = {
    "start": 3,
    "end": 12,
    "crop": "0:270:960:540",
    "cropMap": [
        {"x": 3, "y": 0, "crop": "0:270:960:540"},
        {"x": 5, "y": 0, "crop": "800:100:960:540"},
        {"x": 8.7, "y": 0, "crop": "800:100:960:540", "hold": True},
        {"x": 12, "y": 0, "crop": "400:300:960:540"},
    ],
}
CHART_HEIGHT_PX = 160


@scenario("crop-chip-hovered")
def crop_chip_hovered(markup: MarkupPage) -> None:
    given_a_marker_pair_with_its_editor_open(markup)
    given_the_crop_chart_is_open(markup)
    given_a_crop_point_in_the_middle_panned_right(markup)
    when_i_seek_to(markup, (PAIR_START + MIDDLE_POINT_TIME) / 2)
    when_i_hover_the_crop_chip(markup)


@scenario("crop-chart-sections")
def crop_chart_sections(markup: MarkupPage) -> None:
    given_the_sections_pair_with_its_crop_chart_open(markup)


@scenario("reframe-minimap")
def reframe_minimap(markup: MarkupPage) -> None:
    given_a_marker_pair_with_a_narrowed_crop(markup)
    given_reframe_is_on(markup)
    given_the_minimap_is_shown(markup)


@scenario("cinematic-settings")
def cinematic_settings(markup: MarkupPage) -> None:
    given_the_sections_pair_with_its_crop_chart_open(markup)
    show_additional_settings(markup)
    when_i_choose_easing(markup, "cinematic")
    then_a_cinematic_path_is_baked(markup)
    markup.page.click("#cinematic-settings-modal-button")
    # The plot draws after the popover opens.
    markup.page.wait_for_selector(".ytc-cinematic-plot-canvas[data-cinematic-plotted='true']")


@scenario("hold-crop-points")
def hold_crop_points(markup: MarkupPage) -> None:
    markup.load_saved_marker_pairs([HOLD_PAIR])
    markup.open_marker_pair(0)
    given_the_crop_chart_is_open(markup)
    stretch_the_crop_chart(markup)
    # Off the chart, so no point is drawn in its hover colors.
    markup.page.mouse.move(0, 0)


@step
def given_the_sections_pair_with_its_crop_chart_open(markup: MarkupPage) -> None:
    markup.load_saved_marker_pairs([SECTIONS_PAIR])
    markup.open_marker_pair(0)
    given_the_crop_chart_is_open(markup)
    stretch_the_crop_chart(markup)


def stretch_the_crop_chart(markup: MarkupPage) -> None:
    # The chart fills its container, which the layout keeps short; stretch it so the point labels
    # do not crowd the sections.
    markup.page.evaluate(
        """(height) => {
          const canvas = document.querySelector('#cropChartCanvas');
          canvas.parentElement.style.height = height + 'px';
          Object.values(Chart.instances).find((chart) => chart.canvas === canvas).resize();
        }""",
        CHART_HEIGHT_PX,
    )
    markup.reveal("#cropChartCanvas")


@step
def when_i_hover_the_crop_chip(markup: MarkupPage) -> None:
    # The chip's value shows as a live tooltip bubble only while hovered.
    markup.page.hover(".crop-chip-copy")
    markup.page.wait_for_selector(".crop-chip-value", state="visible")
