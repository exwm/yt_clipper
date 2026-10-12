import pytest
from changelog import drop_section, insert_highlights

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


def test_insert_highlights_needs_the_section() -> None:
    with pytest.raises(ValueError, match=r"no section for 5\.49\.0"):
        insert_highlights(CHANGELOG, "5.49.0", "### Highlights\n")
