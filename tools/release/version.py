"""Set or check the release version everywhere it is written.

    uv run python tools/release/version.py set 5.48.0
    uv run python tools/release/version.py check 5.48.0
    uv run python tools/release/version.py check          (all locations agree)

Each location is an exact pattern with an expected count, so a moved or reformatted line fails
loudly instead of being skipped. Files keep their line endings.
"""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEMVER = r"\d+\.\d+\.\d+"


@dataclass(frozen=True)
class VersionLocation:
    path: str
    # The line(s) holding the version, with {version} in its place.
    pattern: str
    count: int = 1

    def regex(self) -> re.Pattern[str]:
        before, after = self.pattern.split("{version}")
        return re.compile(f"(?m)^({re.escape(before)})({SEMVER})({re.escape(after)})$")


LOCATIONS = (
    VersionLocation("package.json", '  "version": "{version}",'),
    VersionLocation("pyproject.toml", 'version = "{version}"'),
    VersionLocation("uv.lock", 'name = "clipper"\nversion = "{version}"'),
    VersionLocation("src/clipper/version.py", '__version__ = "{version}"'),
    VersionLocation(".github/workflows/yt_clipper_ci.yml", '  VERSION: "{version}"'),
    # The userscript header repeats @version (see the BANNER GUARD lines).
    VersionLocation("src/markup/yt_clipper.ts", "// @version      {version}", count=2),
    VersionLocation("src/markup/appState.ts", "export const __version__ = '{version}';"),
)


def read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as file:
        return file.read()


def write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        file.write(text)


def found_versions(location: VersionLocation, text: str) -> list[str]:
    # A CRLF file still matches: the pattern's line breaks and the line ends allow a \r before \n.
    return [match[2] for match in location.regex().finditer(text.replace("\r\n", "\n"))]


def check(root: Path, version: str | None) -> list[str]:
    """Problems with the version locations: a wrong count of matches, or versions that differ from
    `version` (or from each other when no version is given)."""
    problems = []
    seen: dict[str, list[str]] = {}
    for location in LOCATIONS:
        versions = found_versions(location, read(root / location.path))
        if len(versions) != location.count:
            problems.append(
                f"{location.path}: expected {location.count} match(es), found {len(versions)}",
            )
        for found in versions:
            seen.setdefault(found, []).append(location.path)
    expected = {version} if version else set(list(seen)[:1])
    problems.extend(
        f"{', '.join(dict.fromkeys(paths))}: version {found}, expected {', '.join(expected)}"
        for found, paths in seen.items()
        if found not in expected
    )
    return problems


def set_version(root: Path, version: str) -> list[str]:
    """Write `version` into every location. Writes nothing if any location's count is off."""
    problems = check(root, None)
    count_problems = [problem for problem in problems if "match(es)" in problem]
    if count_problems:
        return count_problems
    for location in LOCATIONS:
        path = root / location.path
        text = read(path)
        uses_crlf = "\r\n" in text
        updated = location.regex().sub(rf"\g<1>{version}\g<3>", text.replace("\r\n", "\n"))
        write(path, updated.replace("\n", "\r\n") if uses_crlf else updated)
    return check(root, version)


def semver(value: str) -> str:
    if not re.fullmatch(SEMVER, value):
        raise argparse.ArgumentTypeError(f"not a X.Y.Z version: {value}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Set or check the release version everywhere it is written.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("set").add_argument("version", type=semver)
    commands.add_parser("check").add_argument("version", type=semver, nargs="?")
    args = parser.parse_args()
    problems = (
        set_version(REPO, args.version) if args.command == "set" else check(REPO, args.version)
    )
    for problem in problems:
        print(problem, file=sys.stderr)
    if problems:
        sys.exit(1)
    print(f"version {args.version or 'consistent'} in {len(LOCATIONS)} files")


if __name__ == "__main__":
    main()
