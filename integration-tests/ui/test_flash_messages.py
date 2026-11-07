"""Flash messages show below the marker pair editor, as on YouTube."""

from harness.markup_page import MarkupPage
from harness.steps import step

EDITOR = "#settings-editor-div"
FLASH = ".flash-div"


def test_a_flash_message_shows_below_the_marker_pair_editor(markup: MarkupPage) -> None:
    given_a_marker_pair_with_its_editor_open(markup)
    when_a_flash_message_shows(markup)
    then_it_is_below_the_editor(markup)


@step
def given_a_marker_pair_with_its_editor_open(markup: MarkupPage) -> None:
    markup.load_marker_pairs([(2, 4)])
    markup.open_marker_pair(0)
    markup.page.wait_for_selector(EDITOR)


@step
def when_a_flash_message_shows(markup: MarkupPage) -> None:
    # Opening the timeline zoom flashes that it is on.
    markup.press("Shift+KeyF")
    markup.page.locator(FLASH).filter(has_text="Timeline zoom").wait_for()


@step
def then_it_is_below_the_editor(markup: MarkupPage) -> None:
    editor = markup.box_of(EDITOR)
    flash = markup.box_of(f"{FLASH}:has-text('Timeline zoom')")
    markup.report(f"editor bottom {editor['y'] + editor['height']:.0f}, flash top {flash['y']:.0f}")
    assert flash["y"] >= editor["y"] + editor["height"] - 1
    markup.shot_of("flash-below-editor", [EDITOR, f"{FLASH}:has-text('Timeline zoom')"], padding=10)
