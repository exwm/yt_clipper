from typing import List, Optional

import pytest

from clipper import argparser
from clipper import argparser_suggestions as suggestions

# A compact stand-in for the real parser's options, chosen to exercise the
# scorer: cookie aliases that must collapse to one suggestion, a short flag
# whose letters resemble a long typo (-asl), and a terse flag that shares only
# a dash with a typo (-vsdz) and so must not match.
OPTION_GROUPS: List[List[str]] = [
    ["--cookies", "--cookiesfile", "--cookiefile", "-cf"],
    ["--auto-subs-lang", "-asl"],
    ["--audio-delay", "-ad"],
    ["--audio", "-a"],
    ["--video-stabilization-dynamic-zoom", "-vsdz"],
    ["--print-versions"],
]


@pytest.mark.parametrize(
    ("optionStrings", "expected"),
    [
        pytest.param(["--cookies", "-cf"], "--cookies (-cf)", id="long and short"),
        pytest.param(["--print-versions"], "--print-versions", id="long only"),
        pytest.param(["-cf"], "-cf", id="short only"),
        pytest.param(
            ["--cookies", "--cookiesfile", "-cf"],
            "--cookies (-cf)",
            id="first long, first short",
        ),
    ],
)
def test_formatOptionForSuggestion(optionStrings: List[str], expected: str) -> None:
    assert suggestions.formatOptionForSuggestion(optionStrings) == expected


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        # All cookie aliases resolve to one argument, so they collapse to a
        # single suggestion rendered with the canonical long flag.
        pytest.param("--cookie", ["--cookies (-cf)"], id="collapse aliases"),
        pytest.param("--coks", ["--cookies (-cf)"], id="long typo"),
        pytest.param("-cff", ["--cookies (-cf)"], id="short typo"),
        pytest.param("--zzzzzz", [], id="nothing similar"),
    ],
)
def test_suggestKnownOptions(token: str, expected: List[str]) -> None:
    assert suggestions.suggestKnownOptions(token, OPTION_GROUPS) == expected


@pytest.mark.parametrize(
    ("token", "present", "absent"),
    [
        # A short flag's letters resembling the typo is a real match worth keeping.
        pytest.param("--asld", "--auto-subs-lang (-asl)", None, id="short-flag letters match"),
        # Sharing only a dash must not surface a terse, unrelated flag.
        pytest.param("--asd", None, "--video-stabilization-dynamic-zoom (-vsdz)", id="dash overlap"),
    ],
)
def test_suggestKnownOptions_dash_stripping(
    token: str,
    present: Optional[str],
    absent: Optional[str],
) -> None:
    result = suggestions.suggestKnownOptions(token, OPTION_GROUPS)
    if present is not None:
        assert present in result
    if absent is not None:
        assert absent not in result


def test_suggestKnownOptions_caps_results() -> None:
    rhyming = [["--coast"], ["--toast"], ["--roast"], ["--boast"]]
    result = suggestions.suggestKnownOptions("--moast", rhyming)
    assert len(result) == suggestions.MAX_SUGGESTIONS_PER_FLAG


def test_formatUnknownArgumentsError_message_layout() -> None:
    # One assertion owns the whole message format: a suggested flag and a stray
    # value orphaned by an unknown flag.
    message = suggestions.formatUnknownArgumentsError(["--cookie", "extra.txt"], OPTION_GROUPS)
    assert message.splitlines() == [
        "Unknown arguments were provided:",
        "  '--cookie': did you mean --cookies (-cf)?",
        "  Unmatched values: 'extra.txt'",
    ]


def test_formatUnknownArgumentsError_reports_no_similar_option() -> None:
    message = suggestions.formatUnknownArgumentsError(["--zzzzzz"], OPTION_GROUPS)
    assert "  '--zzzzzz': no similar option found" in message


def test_getOptionGroups_groups_each_arguments_spellings() -> None:
    optionGroups = suggestions.getOptionGroups(argparser.getArgParser())
    cookieGroup = next(group for group in optionGroups if "--cookiefile" in group)
    assert {"--cookies", "--cookiesfile", "-cf"} <= set(cookieGroup)
