"""Check that Greasy Fork serves a published release's userscript.

    uv run python tools/release/greasyfork.py 5.48.0

Greasy Fork syncs the script from the latest GitHub release's yt_clipper.user.js when a release is
published (a repo webhook), so run this after publishing. Its sync URL ends in
`?private_token=none`: for a public repo the webhook otherwise reads the file from git at the
release tag, where it is not committed, instead of downloading the release asset. Greasy Fork
rewrites the header (it drops the duplicate @version and moves @downloadURL and @updateURL), so the
check compares the version, the @require list, and the code after the header.
"""

import re
import sys
import time
import urllib.request
from dataclasses import dataclass

GREASYFORK_SCRIPT = "https://update.greasyfork.org/scripts/543460/yt_clipper.user.js"
RELEASE_SCRIPT = (
    "https://github.com/exwm/yt_clipper/releases/download/v{version}/yt_clipper_{version}.js"
)
# The webhook sync takes a few seconds, and Greasy Fork's update URLs are cached briefly.
WAIT_SECONDS = 180
POLL_SECONDS = 15
HEADER_END = "// ==/UserScript=="


@dataclass(frozen=True)
class Userscript:
    version: str | None
    requires: tuple[str, ...]
    code: str


def parse_userscript(text: str) -> Userscript:
    header, _, code = text.partition(HEADER_END)
    version = re.search(r"^// @version\s+(\S+)", header, re.MULTILINE)
    requires = re.findall(r"^// @require\s+(\S+)", header, re.MULTILINE)
    return Userscript(version[1] if version else None, tuple(requires), code)


def differences(release: Userscript, served: Userscript) -> list[str]:
    problems = []
    if served.version != release.version:
        problems.append(f"Greasy Fork serves version {served.version}, not {release.version}")
    if served.requires != release.requires:
        problems.append("Greasy Fork's @require list differs from the release's")
    if served.code != release.code:
        problems.append("Greasy Fork's code differs from the release's")
    return problems


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    version = sys.argv[1]
    release = parse_userscript(fetch(RELEASE_SCRIPT.format(version=version)))
    deadline = time.monotonic() + WAIT_SECONDS
    while True:
        problems = differences(release, parse_userscript(fetch(GREASYFORK_SCRIPT)))
        if not problems or time.monotonic() > deadline:
            break
        print(f"waiting for Greasy Fork: {problems[0]}")
        time.sleep(POLL_SECONDS)
    if problems:
        sys.exit("\n".join(problems))
    print(f"Greasy Fork serves the v{version} userscript")


if __name__ == "__main__":
    main()
