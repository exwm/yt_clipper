from pathlib import Path

import pytest
from lint_strings import (
    SourceString,
    corpus,
    is_prose,
    located_alerts,
    prose_strings,
    python_strings,
    typescript_strings,
)

PYTHON = '''\
"""Module docstring is a comment, not a string."""


def build(parser, count):
    """Function docstring is skipped too."""
    parser.add_argument(
        "--fast-trim",
        help="Generate outputs quickly "
        "without re-encoding.",
    )
    print(f"Merged {count} clips into one webm.")
    print(f"{count} {count} clips were skipped here.")
'''

TYPESCRIPT = """\
// flashMessage('A comment is not a string to lint', 'red');
flashMessage('Shared URL payload claims too many items, refusing to load.', 'red');
const label = `Zoom ${level}x around the crop center`;
"""


def texts(strings: list[SourceString]) -> list[tuple[int, str]]:
    return [(string.line, string.text) for string in strings]


def test_python_strings_skip_docstrings_and_join_concatenation_and_fstrings() -> None:
    found = texts(python_strings("argparser.py", PYTHON))
    assert (8, "Generate outputs quickly without re-encoding.") in found
    assert (11, "Merged X1 clips into one webm.") in found
    assert (12, "X1 X2 clips were skipped here.") in found
    assert not any("docstring" in text for _, text in found)


def test_typescript_strings_skip_comments_and_fill_placeholders() -> None:
    found = texts(typescript_strings("share-url.ts", TYPESCRIPT))
    assert (2, "Shared URL payload claims too many items, refusing to load.") in found
    assert (3, "Zoom X1x around the crop center") in found
    assert not any("comment" in text for _, text in found)


def test_a_file_or_a_folder_can_be_linted(tmp_path: Path) -> None:
    (tmp_path / "argparser.py").write_text(PYTHON, encoding="utf-8")
    for path in (tmp_path, tmp_path / "argparser.py"):
        assert "Merged X1 clips into one webm." in [string.text for string in prose_strings(path)]


@pytest.mark.parametrize(
    ("text", "prose"),
    [
        ("Subtitles are burned into the video.", True),
        ("Use firefox or a cookies file; it works.", True),
        ("too short here", False),
        ("--video-codec", False),
        ("src/clipper/yt_clipper.py", False),
        ('<div class="yt_clipper-chip">the chip label</div>', False),
        ("{name} merged into {count} files", False),
        ("https://github.com/exwm/yt_clipper/releases are here", False),
        ("123 frames were dropped here", False),
        ("width: 100%; height: calc(100% - 20px); position: relative;", False),
        ("run-cache: prior run X1 missing its header record (file was truncated); ignoring.", True),
    ],
)
def test_is_prose(text: str, prose: bool) -> None:
    assert is_prose(text) is prose


def test_located_alerts_point_at_the_source_line() -> None:
    strings = [
        SourceString("a.py", 10, "First string here."),
        SourceString("b.ts", 20, "Second one will run."),
    ]
    assert corpus(strings).splitlines()[2] == "Second one will run."
    alert = {
        "Line": 3,
        "Span": [12, 15],
        "Severity": "suggestion",
        "Check": "ytc-style.Will",
        "Message": "m",
    }
    assert located_alerts(strings, [alert]) == [
        "b.ts:20: suggestion ytc-style.Will: m\n    Second one will run.",
    ]
