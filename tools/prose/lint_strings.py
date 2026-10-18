"""Lint the user-facing strings in source files with vale: `--help` text, tooltips, and messages.

    uv run python tools/prose/lint_strings.py src

Vale reads only the comments in code files. This pulls the string literals out, lints them with
the `.strings` profile in .vale.ini, and prints each alert at the string's source line. It is
advisory and always exits 0.
"""

import ast
import itertools
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MIN_WORDS = 4
# Markup, format specs, paths, CSS declarations, and code rather than prose.
CODE_LIKE = re.compile(r"[{}<>=\[\]|#$\\]|://|^[\w./-]+$|\b[a-z-]+:\s*[^;\s]+(?:\s[^;\s]+){0,3};")
SKIPPED_FILES = re.compile(
    r"(^|[\\/])(tests?|__mocks__)[\\/]|(^|[\\/])test_[^\\/]*\.py$|\.(test|fixtures)\.ts$|\.d\.ts$",
)
TS_STRING = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`""")
TS_PLACEHOLDER = re.compile(r"\$\{[^}]*\}")


def placeholder(index: int) -> str:
    # Numbered, so two interpolations in a row are not a repeated word.
    return f"X{index}"


@dataclass(frozen=True)
class SourceString:
    path: str
    line: int
    text: str


def is_prose(text: str) -> bool:
    return (
        len(text.split()) >= MIN_WORDS
        and re.match(r"[A-Za-z(]", text) is not None
        and not CODE_LIKE.search(text)
    )


def python_strings(path: str, source: str) -> list[SourceString]:
    """String constants and f-strings, minus docstrings (vale already lints those as comments)."""
    tree = ast.parse(source)
    skipped: set[int] = set()
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if (
            isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and body
        ):
            first = body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                skipped.add(id(first.value))
        if isinstance(node, ast.JoinedStr):
            skipped.update(id(part) for part in node.values)
    found = []
    for node in ast.walk(tree):
        if id(node) in skipped:
            continue
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            text = node.value
        elif isinstance(node, ast.JoinedStr):
            interpolations = itertools.count(1)
            text = "".join(
                part.value
                if isinstance(part, ast.Constant) and isinstance(part.value, str)
                else placeholder(next(interpolations))
                for part in node.values
            )
        else:
            continue
        found.append(SourceString(path, node.lineno, text))
    return found


def fill_ts_placeholders(text: str) -> str:
    interpolations = itertools.count(1)
    return TS_PLACEHOLDER.sub(lambda _: placeholder(next(interpolations)), text)


def typescript_strings(path: str, source: str) -> list[SourceString]:
    found = []
    for match in TS_STRING.finditer(source):
        line_start = source.rfind("\n", 0, match.start()) + 1
        if source[line_start : match.start()].lstrip().startswith(("//", "*", "/*")):
            continue
        text = next(group for group in match.groups() if group is not None)
        line = source.count("\n", 0, match.start()) + 1
        found.append(SourceString(path, line, fill_ts_placeholders(text)))
    return found


def prose_strings(root: Path) -> list[SourceString]:
    found = []
    for file in [root] if root.is_file() else sorted(root.rglob("*")):
        relative = (
            file.relative_to(REPO).as_posix() if file.is_relative_to(REPO) else file.as_posix()
        )
        if file.suffix not in (".py", ".ts") or SKIPPED_FILES.search(relative):
            continue
        source = file.read_text(encoding="utf-8")
        extract = python_strings if file.suffix == ".py" else typescript_strings
        for string in extract(relative, source):
            text = " ".join(string.text.split())
            if is_prose(text):
                found.append(SourceString(string.path, string.line, text))
    return found


def corpus(strings: list[SourceString]) -> str:
    """One paragraph per string, so string i is on corpus line 2 * i + 1."""
    return "\n\n".join(string.text for string in strings) + "\n"


def located_alerts(strings: list[SourceString], alerts: list[dict]) -> list[str]:
    lines = []
    for alert in sorted(alerts, key=lambda alert: (alert["Line"], alert["Span"][0])):
        string = strings[(alert["Line"] - 1) // 2]
        lines.append(
            f"{string.path}:{string.line}: {alert['Severity']} {alert['Check']}: {alert['Message']}\n"
            f"    {string.text}",
        )
    return lines


def main(roots: list[str]) -> None:
    if shutil.which("vale") is None:
        print("vale is not installed: `scoop install vale` or `brew install vale`.")
        return
    strings = [string for root in roots for string in prose_strings(Path(root).resolve())]
    with tempfile.TemporaryDirectory() as folder:
        text_file = Path(folder) / "source.strings"
        text_file.write_text(corpus(strings), encoding="utf-8")
        result = subprocess.run(
            [
                "vale",
                "--config",
                str(REPO / ".vale.ini"),
                "--output=JSON",
                "--no-exit",
                str(text_file),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
    if result.returncode != 0 or not result.stdout.strip():
        print(result.stderr or result.stdout)
        return
    alerts = [alert for file_alerts in json.loads(result.stdout).values() for alert in file_alerts]
    for line in located_alerts(strings, alerts):
        print(line)
    print(f"{len(alerts)} alerts in {len(strings)} strings.")


if __name__ == "__main__":
    main(sys.argv[1:] or ["src"])
