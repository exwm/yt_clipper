from pathlib import Path

from jest_slowest import slowest_lines

ROOT = Path("/home/example/yt_clipper")


def _report(*suites: tuple[str, list[tuple[str, int | None]]]) -> dict:
    return {
        "testResults": [
            {
                "name": name,
                "assertionResults": [{"fullName": test, "duration": ms} for test, ms in tests],
            }
            for name, tests in suites
        ]
    }


def test_lists_the_slowest_tests_first_with_paths_from_the_root() -> None:
    report = _report(
        (str(ROOT / "src/a.test.ts"), [("fast", 10), ("slow", 2500)]),
        (str(ROOT / "src/b.test.ts"), [("no duration", None), ("middle", 400)]),
    )
    assert slowest_lines(report, ROOT, 3) == [
        "slowest 3 of 4 jest tests:",
        "    2.50s  src/a.test.ts :: slow",
        "    0.40s  src/b.test.ts :: middle",
        "    0.01s  src/a.test.ts :: fast",
    ]


def test_a_suite_outside_the_root_keeps_its_full_path() -> None:
    outside = Path("/home/example/elsewhere/c.test.ts")
    report = _report((str(outside), [("only", 1000)]))
    assert slowest_lines(report, ROOT, 10)[1] == f"    1.00s  {outside.as_posix()} :: only"
