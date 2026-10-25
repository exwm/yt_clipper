"""Print the slowest tests from a Jest JSON report (`jest --json --outputFile=...`)."""

import json
import sys
from pathlib import Path


def _shown_path(name: str, root: Path) -> str:
    path = Path(name)
    return (path.relative_to(root) if path.is_relative_to(root) else path).as_posix()


def slowest_lines(report: dict, root: Path, count: int) -> list[str]:
    tests = [
        ((test.get("duration") or 0) / 1000, _shown_path(suite["name"], root), test["fullName"])
        for suite in report["testResults"]
        for test in suite["assertionResults"]
    ]
    return [
        f"slowest {count} of {len(tests)} jest tests:",
        *(
            f"  {seconds:6.2f}s  {file} :: {name}"
            for seconds, file, name in sorted(tests, reverse=True)[:count]
        ),
    ]


def main() -> None:
    report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    print("\n".join(slowest_lines(report, Path.cwd(), count)))


if __name__ == "__main__":
    main()
