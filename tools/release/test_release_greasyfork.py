import pytest
from greasyfork import differences, parse_userscript

RELEASE = """\
// ==UserScript==
// @version      5.48.0
// @version      5.48.0
// @downloadURL  https://update.greasyfork.org/scripts/543460/yt_clipper.user.js
// @require      https://cdn.example/a.js
// @require      https://cdn.example/b.js
// ==/UserScript==
code();
"""
# How Greasy Fork serves it: duplicate @version dropped, update URLs moved to the header's end.
SERVED = """\
// ==UserScript==
// @version      5.48.0
// @require      https://cdn.example/a.js
// @require      https://cdn.example/b.js
// @downloadURL https://update.greasyfork.org/scripts/543460/yt_clipper.user.js
// ==/UserScript==
code();
"""


@pytest.mark.parametrize(
    ("served", "problem"),
    [
        (SERVED, None),
        (SERVED.replace("5.48.0", "5.47.1"), "version 5.47.1"),
        (SERVED.replace("b.js", "c.js"), "@require"),
        (SERVED.replace("code();", "other();"), "code"),
        ("not a userscript", "version None"),
    ],
)
def test_differences(served: str, problem: str | None) -> None:
    problems = differences(parse_userscript(RELEASE), parse_userscript(served))
    if problem is None:
        assert problems == []
    else:
        assert any(problem in message for message in problems)
