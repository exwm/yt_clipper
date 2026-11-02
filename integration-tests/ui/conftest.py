"""Fixtures for the markup userscript's UI tests (pytest + pytest-playwright).

Each test gets `markup`: a fresh page on the dev site (or, with --youtube URL, on that YouTube video)
with the userscript injected and activated. Run them through `just ui-test` (dev site) or
`just ui-test-youtube`, which build the bundle first. Screenshots go to sandbox/ui-shots/<test>/ (<test>-<variant>/ for a parametrized test).
"""

import ctypes
import json
import re
import shutil
import sys
import warnings
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from harness import steps
from harness.dev_site import (
    DEFAULT_VIDEO_SECONDS,
    EXTRA_VIDEO_SECONDS,
    VIDEO_STYLES,
    build,
    require_urls,
    serving,
    test_video_name,
)
from harness.environment import REAL_REFRESH_MS, InconclusiveEnvironment, check_real_display
from harness.hosts import DEV_SITE_HOST, YOUTUBE_HOST, activate_markup, open_dev_site, open_youtube
from harness.markup_page import MarkupPage
from harness.page_problems import PageProblems
from harness.paths import BUNDLE, REPO, SANDBOX, SHOTS
from harness.simulated_display import DisplayStats, simulated_display

if TYPE_CHECKING:
    from playwright.sync_api import BrowserContext, Page, Playwright

YOUTUBE_PROFILE = SANDBOX / "ui-test-youtube-profile"
YOUTUBE_STORAGE_TO_CLEAR = "cookies,local_storage,indexeddb,service_workers,cache_storage,websql"


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("markup ui")
    group.addoption("--youtube", metavar="URL", help="run on this YouTube video, not the dev site")
    # 0: each worker serves on a free port the OS picks, so parallel runs and reserved ranges never collide.
    group.addoption("--dev-site-port", type=int, default=0)
    group.addoption("--video-seconds", type=int, default=DEFAULT_VIDEO_SECONDS)
    group.addoption(
        "--video-style",
        choices=sorted(VIDEO_STYLES),
        default="testsrc",
        help="the dev site's test video: testsrc for the tests, calm for showcase shots",
    )
    group.addoption("--showcase-release", default="", help="release in showcase.toml to capture")
    group.addoption(
        "--look-scenario", default="", help="just ui-look: the showcase scenario to set up"
    )
    group.addoption(
        "--look-selector",
        action="append",
        default=[],
        help="just ui-look: the element to shoot (repeat to shoot the box around several)",
    )
    group.addoption("--look-step", default="now", help="just ui-look: a name for this try")
    group.addoption(
        "--look-light-page",
        action="store_true",
        help="just ui-look: a white page around the player, like YouTube's light theme",
    )
    group.addoption(
        "--look-hover", default="", help="just ui-look: also shoot with the pointer here"
    )
    group.addoption(
        "--look-padding", type=int, default=24, help="just ui-look: pixels around the element"
    )
    group.addoption(
        "--update-assets",
        action="store_true",
        help="also write showcase shots that name an asset into assets/image/",
    )
    group.addoption(
        "--assumed-frame-rate",
        action="store_true",
        help="run only the tests of 5.49's frame timing, with the frame rate never measured: frame steps and frame times stay at the assumed 60 fps",
    )
    group.addoption(
        "--userscript",
        metavar="PATH",
        default=str(BUNDLE),
        help="test this userscript (e.g. a release's .js) instead of the freshly built bundle",
    )


def userscript_path(config: pytest.Config) -> Path:
    return Path(config.getoption("userscript")).resolve()


def is_ci_build(config: pytest.Config) -> bool:
    """Whether the userscript under test was built by CI: Parcel inlines `IS_CI_BUILD` as a constant."""
    path = userscript_path(config)
    return path.exists() and "IS_CI_BUILD = true" in path.read_text(encoding="utf-8")


# The frame decision groups' flags (feature-flags.ts), each a release. A `frame_timing` mode sets
# every group to its release; a test with no mode runs on the userscript's defaults.
FRAME_TIMING_FLAGS = (
    "placementTiming",
    "seekTiming",
    "loopTiming",
    "stepsTiming",
    "compareTiming",
    "frameRateTiming",
    "cropEaseTiming",
    "cinematicTiming",
)
# 'next' makes 5.48's decisions until a fix lands there: map it to "5.49" or a mode of its own
# once one does.
RELEASE_MODES = {"5.48": "5.48", "next": "5.48", "5.49": "5.49"}


def frame_timing_flags(node: pytest.Item) -> dict[str, str | bool]:
    """The flags a `frame_timing` mode sets: "5.49" is the whole-build flag, "5.48" every group."""
    marker = node.get_closest_marker("frame_timing")
    if marker is None:
        return {}
    if marker.args[0] == "5.49":
        return {"frameTiming549": True}
    return {"frameTiming549": False, **dict.fromkeys(FRAME_TIMING_FLAGS, marker.args[0])}


def built_frame_timing(config: pytest.Config) -> str | None:
    """The frame timing the userscript under test defaults to, read from its bundled flags: None
    when the groups' releases mix modes."""
    path = userscript_path(config)
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    if re.search(r"frameTiming549: \{\s*default: (true|!0)", text):
        return "5.49"
    modes = set()
    for flag in FRAME_TIMING_FLAGS:
        found = re.search(rf"{flag}: frameTimingFlag\(\s*[\"'](5\.48|5\.49|next)[\"']", text)
        if found is None:
            return None
        modes.add(RELEASE_MODES[found[1]])
    return modes.pop() if len(modes) == 1 else None


def needs_flag_overrides(item: pytest.Item, built_mode: str | None) -> bool:
    """A frame timing test needs the popup's override only when its mode isn't the built default."""
    marker = item.get_closest_marker("frame_timing")
    return item.get_closest_marker("local_build") is not None or (
        marker is not None and marker.args[0] != built_mode
    )


def measures_the_rate(item: pytest.Item) -> bool:
    """A test of the measured rate, or a `measured` row: with Measure off it runs as its assumed twin."""
    callspec = getattr(item, "callspec", None)
    measured_row = callspec is not None and callspec.params.get("measured") is True
    return measured_row or item.get_closest_marker("measured_rate") is not None


def runs_at_the_assumed_rate(item: pytest.Item) -> bool:
    """A test --assumed-frame-rate keeps: only 5.49's frame timing measures the rate, so the other
    tests run as they do without the option."""
    marker = item.get_closest_marker("frame_timing")
    is_549 = marker is not None and marker.args[0] == "5.49"
    return is_549 and not measures_the_rate(item)


# Before -m deselects, so `-m "not unshipped_frame_timing"` sees the mark this adds.
@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    built_mode = built_frame_timing(config)
    for item in items:
        marker = item.get_closest_marker("frame_timing")
        if marker is not None and built_mode is not None and marker.args[0] != built_mode:
            item.add_marker(pytest.mark.unshipped_frame_timing)
    if config.getoption("assumed_frame_rate"):
        deselected = [item for item in items if not runs_at_the_assumed_rate(item)]
        if deselected:
            config.hook.pytest_deselected(items=deselected)
            items[:] = [item for item in items if runs_at_the_assumed_rate(item)]
    if not is_ci_build(config):
        return
    skip = pytest.mark.skip(reason="needs the feature flags popup, which CI builds leave out")
    for item in items:
        if needs_flag_overrides(item, built_mode):
            item.add_marker(skip)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "video_style(style): open the dev site on this test video (VIDEO_STYLES)"
    )
    config.addinivalue_line(
        "markers",
        "platform: depends on the video platform (its player, seeking, controls, or layout), so it"
        " also runs on YouTube (just ui-test-youtube selects these); the rest run on the dev site",
    )
    config.addinivalue_line(
        "markers",
        "local_build: needs the feature flags popup, which CI builds (the releases) leave out, so it"
        " is skipped against a CI-built userscript (just verify-release)",
    )
    config.addinivalue_line(
        "markers",
        "feature_flags(flags): open the page with these feature flags set as the popup stores them;"
        " mark the test local_build too",
    )
    config.addinivalue_line(
        "markers",
        'frame_timing(mode): run with every frame decision group on the release "5.48" or "5.49"'
        " (the groups' flags); unmarked tests run on the defaults; skipped against a CI-built"
        " userscript",
    )
    config.addinivalue_line(
        "markers",
        "unshipped_frame_timing: set on a frame_timing test whose mode isn't the userscript's"
        " default; just ui-test leaves these out, just ui-test-frame-549 runs them",
    )
    config.addinivalue_line(
        "markers",
        "display_rate(hz): run in chromium-headless-shell on a simulated display of this refresh rate"
        " (harness/simulated_display.py)",
    )
    config.addinivalue_line(
        "markers",
        "measured_rate: checks frame rate measurement, so --assumed-frame-rate leaves it out",
    )
    config.addinivalue_line(
        "markers",
        "timing: counts frames or refreshes as the video plays, so other tests' load can fail it;"
        " just ui-test runs these in a phase of their own",
    )
    config.addinivalue_line(
        "markers",
        "alone: loads the machine itself (CPU throttling), so it runs with no other test beside it",
    )
    config.addinivalue_line(
        "markers",
        "firefox_limit(reason): a known Firefox limit, a strict xfail under --browser firefox"
        " (just ui-test-firefox)",
    )
    # Build the dev site once, in the main process: parallel workers (pytest-xdist) only serve it.
    is_worker = hasattr(config, "workerinput")
    if not is_worker and not config.getoption("youtube") and not config.option.collectonly:
        build(
            int(config.getoption("video_seconds")),
            userscript_path(config),
            config.getoption("video_style"),
        )


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
    # A fixed port: each parallel worker (gw0, gw1, ...) serves on its own; a serial run is "master".
    port = int(pytestconfig.getoption("dev_site_port"))
    if port:
        port += int(worker_id.removeprefix("gw")) if worker_id.startswith("gw") else 0
    video_name = test_video_name(
        int(pytestconfig.getoption("video_seconds")), pytestconfig.getoption("video_style")
    )
    with serving(port) as url:
        yield DevSite(url=url, video_name=video_name)


# The simulated display a `display_rate` test's page runs on.
DISPLAY_STATS = pytest.StashKey[DisplayStats]()

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
    """A fresh page: pytest-playwright's own on the dev site, one on a simulated display, or one in
    the YouTube profile."""
    display_rate = request.node.get_closest_marker("display_rate")
    if display_rate and not youtube_url:
        if request.getfixturevalue("browser_name") != "chromium":
            pytest.skip("simulates displays in chromium-headless-shell")
        hz = display_rate.args[0]
        playwright: Playwright = request.getfixturevalue("playwright")
        with simulated_display(playwright, hz, CONTEXT_OPTIONS) as (page, stats):
            request.node.stash[DISPLAY_STATS] = stats
            yield page
        print(
            f"\n  {hz} Hz display: {stats.ticks} refreshes, {len(stats.missed_at)} missed,"
            f" {len(stats.page_late_at)} skipped by late refreshes"
        )
        assert stats.stalled_at is None, f"refresh {stats.stalled_at} never finished"
        return
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


@pytest.fixture(autouse=True)
def firefox_limits(request: pytest.FixtureRequest) -> None:
    limit = request.node.get_closest_marker("firefox_limit")
    if limit and request.getfixturevalue("browser_name") == "firefox":
        request.applymarker(pytest.mark.xfail(strict=True, reason=limit.args[0]))


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item: pytest.Item) -> Iterator[None]:
    # Keep each phase's report on the test, so the markup fixture can tell whether the test failed.
    report = yield
    setattr(item, f"report_{report.when}", report)
    return report


# Windows turns idle displays off, and Chrome then times frames with a 17 ms sleep (about 57 Hz), not
# the display's vsync (ui/gl/vsync_thread_win.cc), which skews every timing test.
ES_CONTINUOUS = 0x80000000
ES_DISPLAY_REQUIRED = 0x00000002


@pytest.fixture(scope="session", autouse=True)
def displays_stay_on() -> Iterator[None]:
    if sys.platform != "win32":
        yield
        return
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)
    yield
    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)


MEDIAN_REFRESH_MS = """() => new Promise((done) => {
    const times = [];
    const onFrame = (time) => {
        times.push(time);
        if (times.length < 31) requestAnimationFrame(onFrame);
        else {
            const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
            done(gaps[15]);
        }
    };
    requestAnimationFrame(onFrame);
})"""
# The median frame gap this worker last measured.
measured_refresh_ms: list[float] = []


def check_refresh_is_60_hz(page: "Page", is_timing: bool) -> None:
    """The timing tests expect a 60 Hz display: one that isn't makes them inconclusive, and the rest
    warn once. Measured once per worker while it reads 60 Hz (`displays_stay_on` keeps it there),
    and per timing test after it didn't, so a rerun can find the displays awake."""
    is_60_hz = REAL_REFRESH_MS[0] <= (measured_refresh_ms or [0])[-1] <= REAL_REFRESH_MS[1]
    if measured_refresh_ms and (is_60_hz or not is_timing):
        return
    median_ms = page.evaluate(MEDIAN_REFRESH_MS)
    measured_refresh_ms.append(median_ms)
    try:
        check_real_display(median_ms)
    except InconclusiveEnvironment as inconclusive:
        if is_timing:
            raise
        warnings.warn(str(inconclusive), stacklevel=1)


@pytest.fixture
def markup(
    browser_page: "Page",
    request: pytest.FixtureRequest,
    youtube_url: str | None,
    dev_site: DevSite | None,
) -> Iterator[MarkupPage]:
    host = YOUTUBE_HOST if youtube_url else DEV_SITE_HOST
    test_name = request.node.originalname.removeprefix("test_").replace("_", "-")
    # Each variant gets its own folder: parallel workers run the variants at once.
    callspec = getattr(request.node, "callspec", None)
    if callspec is not None:
        test_name += "-" + re.sub(r"[^\w.]+", "-", callspec.id).strip("-")
    shots_dir = SHOTS / (f"{test_name}-{host.name}" if youtube_url else test_name)
    shutil.rmtree(shots_dir, ignore_errors=True)
    shots_dir.mkdir(parents=True)
    steps.TIMINGS.clear()
    userscript = userscript_path(request.config)
    problems = PageProblems(on_youtube=bool(youtube_url), require_urls=require_urls(userscript))
    page = browser_page
    problems.watch(page)
    # Measure off (the default) for --assumed-frame-rate, so playing never measures mid-test, else on,
    # as a user turns it on.
    assumed = request.config.getoption("assumed_frame_rate")
    measure = "false" if assumed else "true"
    page.add_init_script(
        f"try {{ localStorage.setItem('ytc-measure-frame-rate', '{measure}'); }} catch {{}}"
    )
    flags_marker = request.node.get_closest_marker("feature_flags")
    flags = {**(flags_marker.args[0] if flags_marker else {}), **frame_timing_flags(request.node)}
    if flags:
        stored = json.dumps(json.dumps(flags))
        page.add_init_script(
            f"try {{ localStorage.setItem('yt_clipper_feature_flags', {stored}); }} catch {{}}"
        )
    with steps.timed("(open the page)"):
        if youtube_url:
            open_youtube(page, youtube_url, userscript)
        else:
            assert dev_site is not None
            style = request.node.get_closest_marker("video_style")
            video_name = (
                test_video_name(EXTRA_VIDEO_SECONDS, style.args[0])
                if style
                else dev_site.video_name
            )
            open_dev_site(page, dev_site.url, video_name)
    with steps.timed("(activate the markup)"):
        activate_markup(page)
    display = request.node.stash.get(DISPLAY_STATS, None)
    if display is None:
        is_timing = any(request.node.get_closest_marker(mark) for mark in ("timing", "alone"))
        check_refresh_is_60_hz(page, is_timing)

    # pytest-playwright traces only its own page; the YouTube and simulated display contexts are ours.
    traced = not youtube_url and display is None and request.config.getoption("tracing") != "off"
    yield MarkupPage(
        page, host, shots_dir, tracing=traced, assumed_frame_rate=assumed, display=display
    )

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
