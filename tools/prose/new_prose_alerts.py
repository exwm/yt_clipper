"""Vale alerts on the prose added since a base revision: docs, user-facing strings, commit subjects.

    uv run python tools/prose/new_prose_alerts.py [BASE]

BASE defaults to the last release tag before the working copy's parent. Only alerts on lines added
since BASE count, so old text never blocks a release. Exits 1 on an error or warning; suggestions
are printed and pass.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from lint_strings import REPO, corpus, located_alerts, prose_strings

DOCS = re.compile(r"^(readme|quickstart)\.md$|^release-notes/[^/]+\.md$|^tools/encoding/README\.md$")
SOURCE = re.compile(r"^src/.+\.(py|ts)$")
BLOCKING = {"error", "warning"}
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def added_lines(unified_zero_diff: str) -> dict[str, set[int]]:
    """Each file's added line numbers in the new version, from `git diff -U0` output."""
    added: dict[str, set[int]] = {}
    path = None
    for line in unified_zero_diff.splitlines():
        if line.startswith("+++ "):
            path = None if line == "+++ /dev/null" else line.removeprefix("+++ b/")
        elif path and (hunk := HUNK.match(line)):
            start, count = int(hunk[1]), int(hunk[2] or 1)
            added.setdefault(path, set()).update(range(start, start + count))
    return added


def run(command: list[str]) -> str:
    return subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", check=True, cwd=REPO
    ).stdout


def vale_alerts(file: Path) -> list[dict]:
    out = run(["vale", "--config", str(REPO / ".vale.ini"), "--output=JSON", "--no-exit", str(file)])
    return [alert for alerts in json.loads(out or "{}").values() for alert in alerts]


def default_base() -> str:
    return run(["jj", "log", "-r", "latest(tags() & ::@-)", "--no-graph", "-T", "commit_id"]).strip()


def main(base: str) -> int:
    if shutil.which("vale") is None:
        print("vale is not installed: `scoop install vale` or `brew install vale`.")
        return 1
    added = added_lines(run(["git", "diff", "-U0", "--no-color", base, "--", "."]))
    findings: list[tuple[str, str]] = []

    for path in sorted(p for p in added if DOCS.search(p)):
        findings.extend(
            (alert["Severity"], f"{path}:{alert['Line']}: {alert['Check']}: {alert['Message']}")
            for alert in vale_alerts(REPO / path)
            if alert["Line"] in added[path]
        )

    strings = [
        string
        for path in sorted(p for p in added if SOURCE.search(p))
        for string in prose_strings(REPO / path)
        if string.line in added[path]
    ]
    if strings:
        with tempfile.TemporaryDirectory() as folder:
            text_file = Path(folder) / "source.strings"
            text_file.write_text(corpus(strings), encoding="utf-8")
            alerts = vale_alerts(text_file)
        # located_alerts sorts alerts the same way, and its lines repeat the severity printed first.
        findings += [
            (alert["Severity"], line.replace(f" {alert['Severity']} ", " ", 1))
            for alert, line in zip(
                sorted(alerts, key=lambda alert: (alert["Line"], alert["Span"][0])),
                located_alerts(strings, alerts),
                strict=True,
            )
        ]

    subjects = run(["jj", "log", "-r", f"{base}..@", "--no-graph", "-T", 'description.first_line() ++ "\\n\\n"'])
    with tempfile.TemporaryDirectory() as folder:
        subject_file = Path(folder) / "commits.subject"
        subject_file.write_text(subjects, encoding="utf-8")
        texts = subjects.splitlines()
        for alert in vale_alerts(subject_file):
            findings.append((alert["Severity"], f"subject: {alert['Check']}: {alert['Message']}\n    {texts[alert['Line'] - 1]}"))

    for severity, text in findings:
        print(f"{severity}: {text}")
    blocking = sum(severity in BLOCKING for severity, _ in findings)
    print(f"{blocking} errors or warnings, {len(findings) - blocking} suggestions in prose added since {base[:12]}.")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else default_base()))
