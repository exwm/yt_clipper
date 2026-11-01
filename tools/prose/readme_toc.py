"""Check that the readme's table of contents links every heading, and every link has a heading.

    uv run python tools/prose/readme_toc.py [readme.md]

Exits 1 when a heading has no `- [..](#slug)` entry or an entry points at no heading.
"""

import re
import sys
from pathlib import Path

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")
TOC_LINK = re.compile(r"^\s*[-*] \[.*\]\(#([^)\s]+)\)\s*$")
MARKDOWN_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")


def slug(heading: str, seen: dict[str, int]) -> str:
    """GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens, repeats numbered."""
    text = MARKDOWN_LINK.sub(r"\1", heading).replace("\\", "").lower()
    base = re.sub(r"[^\w\- ]", "", text).replace(" ", "-")
    count = seen.get(base, 0)
    seen[base] = count + 1
    return base if count == 0 else f"{base}-{count}"


def toc_problems(markdown: str) -> list[str]:
    headings: dict[str, int] = {}
    links: dict[str, int] = {}
    seen: dict[str, int] = {}
    in_fence = False
    for number, line in enumerate(markdown.splitlines(), start=1):
        if FENCE.match(line):
            in_fence = not in_fence
        elif in_fence:
            continue
        elif heading := HEADING.match(line):
            headings.setdefault(slug(heading[2], seen), number)
        elif link := TOC_LINK.match(line):
            links.setdefault(link[1], number)
    return [
        f"{number}: heading has no table of contents entry (#{anchor})"
        for anchor, number in headings.items()
        if anchor not in links
    ] + [
        f"{number}: table of contents entry points at no heading (#{anchor})"
        for anchor, number in links.items()
        if anchor not in headings
    ]


def main(path: Path) -> int:
    problems = toc_problems(path.read_text(encoding="utf-8"))
    for problem in problems:
        print(f"{path.name}:{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "readme.md")))
