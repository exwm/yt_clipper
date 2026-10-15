"""Fixtures for the markup userscript's UI tests (pytest + pytest-playwright).

Each test gets `markup`: a fresh page on the dev site (or, with --youtube URL, on that YouTube video)
with the userscript injected and activated. Run them through `just ui-test` (dev site) or
`just ui-test-youtube`, which build the bundle first. Screenshots go to sandbox/ui-shots/<test>/.
"""

import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from harness import steps
from harness.dev_site import (
    DEFAULT_PORT,
    DEFAULT_VIDEO_SECONDS,
    build,
    require_urls,
    serving,
    test_video_name,
)
from harness.hosts import DEV_SITE_HOST, YOUTUBE_HOST, activate_markup, open_dev_site, open_youtube
from harness.markup_page import MarkupPage
from harness.page_problems import PageProblems
from harness.paths import BUNDLE, REPO, SANDBOX, SHOTS

if TYPE_CHECKING:
    from playwright.sync_api import BrowserContext, Page, Playwright

YOUTUBE_PROFILE = SANDBOX / "ui-test-youtube-profile"
YOUTUBE_STORAGE_TO_CLEAR = "cookies,local_storage,indexeddb,service_workers,cache_storage,websql"


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("markup ui")
    group.addoption("--youtube", metavar="URL", help="run on this YouTube video, not the dev site")
    group.addoption("--dev-site-port", type=int, default=DEFAULT_PORT)
    group.addoption("--video-seconds", type=int, default=DEFAULT_VIDEO_SECONDS)
    group.addoption(
        "--userscript",
        metavar="PATH",
        default=str(BUNDLE),
        help="test this userscript (e.g. a release's .js) instead of the freshly built bundle",
    )


def userscript_path(config: pytest.Config) -> Path:
    return Path(config.getoption("userscript")).resolve()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "platform: depends on the video platform (its player, seeking, controls, or layout), so it"
        " also runs on YouTube (just ui-test-youtube selects these); the rest run on the dev site",
    )
    # Build the dev site once, in the main process: parallel workers (pytest-xdist) only serve it.
    is_worker = hasattr(config, "workerinput")
    if not is_worker and not config.getoption("youtube") and not config.option.collectonly:
        build(int(config.getoption("video_seconds")), userscript_path(config))


@dataclass(frozen=True)
class DevSite:
    url: str
    video_name: str


@pytest.fixture(scope="session")
def youtube_url(pytestconfig: pytest.Config) -> str | None:
    return pytestconfig.getoption("youtube")


@pytest.fixture(scope="session")
def dev_site(
    pytestconfig: pytest.Config,
    youtube_url: str | None,
    worker_id: str,
) -> Iterator[DevSite | None]:
    if youtube_url:
        yield None
        return
    # Each parallel worker (gw0, gw1, ...) serves on its own port; a serial run is "master".
    worker_index = int(worker_id.removeprefix("gw")) if worker_id.startswith("gw") else 0
    port = int(pytestconfig.getoption("dev_site_port")) + worker_index
    video_name = test_video_name(int(pytestconfig.getoption("video_seconds")))
    with serving(port) as url:
        yield DevSite(url=url, video_name=video_name)


CONTEXT_OPTIONS = {"viewport": {"width": 1280, "height": 900}, "locale": "en-US"}


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    return {**browser_context_args, **CONTEXT_OPTIONS}


@pytest.fixture(scope="session")
def youtube_context(
    pytestconfig: pytest.Config,
    playwright: "Playwright",
) -> Iterator["BrowserContext"]:
    """One browser with a persistent profile for the YouTube run, so YouTube's player scripts and
    styles come from the HTTP cache after the first test instead of being fetched again. Each test
    still gets a fresh page with YouTube's cookies and storage cleared (see \browser_page)."""
    context = playwright.chromium.launch_persistent_context(
        str(YOUTUBE_PROFILE),
        channel=pytestconfig.getoption("browser_channel"),
        headless=not pytestconfig.getoption("headed"),
        # YouTube's CSP blocks injected scripts; Tampermonkey is exempt from it, so bypass it here.
        bypass_csp=True,
        **CONTEXT_OPTIONS,
    )
    yield context
    context.close()


@pytest.fixture
def browser_page(request: pytest.FixtureRequest, youtube_url: str | None) -> Iterator["Page"]:
    """A fresh page: pytest-playwright's own on the dev site, or one in the YouTube profile."""
    if not youtube_url:
        yield request.getfixturevalue("page")
        return
    context: BrowserContext = request.getfixturevalue("youtube_context")
    context.clear_cookies()
    page = context.new_page()
    # Clear what a previous test left on YouTube's origin (not the HTTP cache, which is the point).
    page.context.new_cdp_session(page).send(
        "Storage.clearDataForOrigin",
        {"origin": "https://www.youtube.com", "storageTypes": YOUTUBE_STORAGE_TO_CLEAR},
    )
    yield page
    page.close()


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item: pytest.Item) -> Iterator[None]:
    # Keep each phase's report on the test, so the markup fixture can tell whether the test failed.
    report = yield
    setattr(item, f"report_{report.when}", report)
    return report


@pytest.fixture
def markup(
    browser_page: "Page",
    request: pytest.FixtureRequest,
    youtube_url: str | None,
    dev_site: DevSite | None,
) -> Iterator[MarkupPage]:
    host = YOUTUBE_HOST if youtube_url else DEV_SITE_HOST
    test_name = request.node.originalname.removeprefix("test_").replace("_", "-")
    shots_dir = SHOTS / (f"{test_name}-{host.name}" if youtube_url else test_name)
    shutil.rmtree(shots_dir, ignore_errors=True)
    shots_dir.mkdir(parents=True)
    steps.TIMINGS.clear()
    userscript = userscript_path(request.config)
    problems = PageProblems(on_youtube=bool(youtube_url), require_urls=require_urls(userscript))
    page = browser_page
    problems.watch(page)
    with steps.timed("(open the page)"):
        if youtube_url:
            open_youtube(page, youtube_url, userscript)
        else:
            assert dev_site is not None
            open_dev_site(page, dev_site.url, dev_site.video_name)
    with steps.timed("(activate the markup)"):
        activate_markup(page)

    yield MarkupPage(page, host, shots_dir)

    call_report = getattr(request.node, "report_call", None)
    if call_report is not None and call_report.failed:
        failure_shot = shots_dir / "failure.png"
        page.screenshot(path=str(failure_shot))
        print(f"\n  failure screenshot: {failure_shot.relative_to(REPO)}")
        print("  last console lines:")
        for line in problems.console[-20:]:
            print(f"    {line}")
    # Reports carry the timings to the main process, which prints the summary for every worker.
    request.node.user_properties.append(
        ("step_timings", [(t.label, t.seconds) for t in steps.TIMINGS]),
    )
    assert not problems.errors, "\n".join(problems.errors)


SLOWEST_STEPS = 10


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    """List the slowest steps of the run, so the suite's cost stays visible as it grows."""
    timings = [
        (report.nodeid.split("::")[-1], label, seconds)
        for reports in terminalreporter.stats.values()
        for report in reports
        if getattr(report, "when", None) == "teardown"
        for name, recorded in getattr(report, "user_properties", [])
        if name == "step_timings"
        for label, seconds in recorded
    ]
    if not timings:
        return
    total = sum(seconds for _, _, seconds in timings)
    terminalreporter.section(f"slowest UI steps ({total:.0f}s in {len(timings)} steps)")
    for test, label, seconds in sorted(timings, key=lambda timing: timing[2], reverse=True)[
        :SLOWEST_STEPS
    ]:
        terminalreporter.write_line(f"{seconds:6.2f}s  {label}  [{test}]")
