"""Regenerate one release's changelog section on every release-prep run.

    uv run python tools/release/changelog.py drop 5.48.0         (before commit-and-tag-version)
    uv run python tools/release/changelog.py highlights 5.48.0   (after it)

commit-and-tag-version writes a section only when the version has none, so the old section is dropped
first. The hand-written part (an optional summary line and the Highlights) lives in
release-notes/<version>.md and is inserted under the version heading, so regenerating never loses it.
"""

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CHANGELOG = REPO / "changelog.md"
RELEASE_NOTES = REPO / "release-notes"


def _heading(version: str) -> re.Pattern[str]:
    return re.compile(rf"(?m)^## \[{re.escape(version)}\]")


def drop_section(text: str, version: str) -> str:
    """The changelog without `version`'s section (its heading up to the next version's)."""
    match = _heading(version).search(text)
    if not match:
        return text
    following = re.compile(r"(?m)^## \[").search(text, match.end())
    end = following.start() if following else len(text)
    return text[: match.start()] + text[end:]


def insert_highlights(text: str, version: str, highlights: str) -> str:
    """`highlights` inserted right under `version`'s heading line."""
    match = _heading(version).search(text)
    if not match:
        raise ValueError(f"changelog has no section for {version}")
    line_end = text.index("\n", match.end()) + 1
    return f"{text[:line_end]}\n{highlights.strip()}\n{text[line_end:]}"


def read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as file:
        return file.read()


def write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        file.write(text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate one release's changelog section.")
    parser.add_argument("command", choices=["drop", "highlights"])
    parser.add_argument("version")
    args = parser.parse_args()

    text = read(CHANGELOG)
    if args.command == "drop":
        write(CHANGELOG, drop_section(text, args.version))
        return
    notes = RELEASE_NOTES / f"{args.version}.md"
    if not notes.exists():
        print(f"no {notes.relative_to(REPO)}, so no highlights", file=sys.stderr)
        return
    write(CHANGELOG, insert_highlights(text, args.version, read(notes)))


if __name__ == "__main__":
    main()
