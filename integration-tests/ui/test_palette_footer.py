"""The command palette footer links to the releases and shows the markup script's version."""

from harness.markup_page import MarkupPage
from harness.steps import step


def test_palette_footer_shows_the_version_and_release_notes(markup: MarkupPage) -> None:
    when_i_open_the_palette(markup)
    then_the_footer_shows_the_version_and_links(markup)


@step
def when_i_open_the_palette(markup: MarkupPage) -> None:
    markup.page.click("#shortcutsTableToggleButton")


@step
def then_the_footer_shows_the_version_and_links(markup: MarkupPage) -> None:
    footer = markup.page.locator(".cmdp-footer")
    version = footer.locator(".cmdp-footer-version").inner_text()
    markup.report(f"version shown: {version}")
    assert version.startswith("v5.")
    assert footer.get_by_text("Releases").get_attribute("href") == "https://github.com/exwm/yt_clipper/releases"
    markup.shot("footer")
