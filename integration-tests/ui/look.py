"""Close-ups of UI elements for visual work, set up by the showcase's named scenarios: one shot per
density (1x and 2x), at rest and with the pointer over --look-hover. Not named test_*, so `just
ui-test` skips it; run it with `just ui-look`, which repeats it per background video and stacks the
shots into a comparison sheet (look_sheet.py)."""

import shutil

import pytest
from harness.markup_page import MarkupPage
from harness.paths import SANDBOX
from showcase_scenarios import SCENARIOS

LOOK = SANDBOX / "ui-look"


@pytest.mark.parametrize(
    "density",
    [
        pytest.param(1, marks=pytest.mark.browser_context_args(device_scale_factor=1), id="1x"),
        pytest.param(2, marks=pytest.mark.browser_context_args(device_scale_factor=2), id="2x"),
    ],
)
def test_look(markup: MarkupPage, density: int, pytestconfig: pytest.Config) -> None:
    option = pytestconfig.getoption
    scenario = str(option("look_scenario"))
    if scenario not in SCENARIOS:
        raise pytest.UsageError(f"--look-scenario must be one of: {', '.join(SCENARIOS)}")
    selectors: list[str] = option("look_selector")
    padding = int(option("look_padding"))
    if option("look_light_page"):
        markup.page.add_style_tag(content="html, body { background: #fff !important; }")
    SCENARIOS[scenario](markup)

    out = LOOK / scenario
    out.mkdir(parents=True, exist_ok=True)
    name = f"{option('look_step')}~{option('video_style')}~{density}x"
    markup.page.mouse.move(0, 0)
    shutil.copyfile(markup.shot_of("rest", selectors, padding), out / f"{name}~rest.png")
    if hover := option("look_hover"):
        markup.page.hover(hover)
        shutil.copyfile(markup.shot_of("hover", selectors, padding), out / f"{name}~hover.png")
