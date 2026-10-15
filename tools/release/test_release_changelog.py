import pytest
from changelog import credit_contributors, drop_section, insert_highlights

CHANGELOG = """# Changelog

## [5.48.0](https://example.com/compare) (2026-10-12)


### Features

* new thing

## [5.47.1](https://example.com/compare) (2026-06-23)

### Bug Fixes

* old fix
"""


@pytest.mark.parametrize(
    ("version", "kept", "dropped"),
    [
        ("5.48.0", "## [5.47.1]", "new thing"),
        ("5.47.1", "## [5.48.0]", "old fix"),
        ("5.49.0", "new thing", None),  # no section: unchanged
    ],
)
def test_drop_section(version: str, kept: str, dropped: str | None) -> None:
    text = drop_section(CHANGELOG, version)
    assert kept in text
    assert text.startswith("# Changelog\n")
    if dropped is None:
        assert text == CHANGELOG
    else:
        assert dropped not in text
        assert f"## [{version}]" not in text


def test_insert_highlights_goes_under_the_version_heading() -> None:
    text = insert_highlights(CHANGELOG, "5.48.0", "### Highlights\n\n* a highlight\n")
    heading_end = text.index("(2026-10-12)\n") + len("(2026-10-12)\n")
    assert text[heading_end:].startswith("\n### Highlights\n\n* a highlight\n")
    assert text.index("a highlight") < text.index("### Features")


def test_dropping_a_section_drops_its_highlights_so_reruns_never_duplicate_them() -> None:
    with_highlights = insert_highlights(CHANGELOG, "5.48.0", "### Highlights\n")
    assert "### Highlights" not in drop_section(with_highlights, "5.48.0")


CREDITS_CHANGELOG = """## [5.49.0](https://example.com/compare) (2026-10-15)

### Features

* **clipper:** add av1 ([#67](https://example.com/issues/67)) ([02318b0](https://example.com/c))
* **clipper:** owner pr ([#70](https://example.com/issues/70)) ([1111111](https://example.com/c))
* **clipper:** fixes an issue ([#71](https://example.com/issues/71)) ([2222222](https://example.com/c))
* **markup:** no number ([3333333](https://example.com/c))
* **clipper:** already by @someone in [#72](https://example.com/issues/72)

## [5.48.0](https://example.com/compare) (2026-10-12)

* **clipper:** older pr ([#60](https://example.com/issues/60))
"""
PULL_REQUEST_AUTHORS = {67: "GoyangiPics", 70: "exwm", 72: "someone", 60: "codedealer"}


def test_credit_contributors_credits_other_peoples_pull_requests_in_that_version() -> None:
    text, credited = credit_contributors(CREDITS_CHANGELOG, "5.49.0", PULL_REQUEST_AUTHORS.get)
    assert (
        "* **clipper:** add av1 by @GoyangiPics in [#67](https://example.com/issues/67) ([02318b0]("
        in text
    )
    assert credited == ["@GoyangiPics (#67)"]


@pytest.mark.parametrize(
    "line",
    [
        "* **clipper:** owner pr ([#70](https://example.com/issues/70)) ([1111111](https://example.com/c))",
        "* **clipper:** fixes an issue ([#71](https://example.com/issues/71)) ([2222222](https://example.com/c))",
        "* **markup:** no number ([3333333](https://example.com/c))",
        "* **clipper:** already by @someone in [#72](https://example.com/issues/72)",
        "* **clipper:** older pr ([#60](https://example.com/issues/60))",
    ],
    ids=[
        "the owner's pull request",
        "an issue",
        "no number",
        "already credited",
        "another version",
    ],
)
def test_credit_contributors_leaves_other_lines_as_they_are(line: str) -> None:
    text, _credited = credit_contributors(CREDITS_CHANGELOG, "5.49.0", PULL_REQUEST_AUTHORS.get)
    assert line in text.splitlines()


def test_crediting_again_changes_nothing() -> None:
    text, _credited = credit_contributors(CREDITS_CHANGELOG, "5.49.0", PULL_REQUEST_AUTHORS.get)
    assert credit_contributors(text, "5.49.0", PULL_REQUEST_AUTHORS.get) == (text, [])


def test_insert_highlights_needs_the_section() -> None:
    with pytest.raises(ValueError, match=r"no section for 5\.49\.0"):
        insert_highlights(CHANGELOG, "5.49.0", "### Highlights\n")
