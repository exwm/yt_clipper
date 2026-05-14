"""Progress display for long ffmpeg encodes.

Wraps an ffmpeg invocation in a ``rich.live.Live`` display that
shows:

- The latest ffmpeg status line (e.g. ``frame= 1234 fps= 30
  q=29.0 time=00:42 bitrate= 1200kbps speed=2.5x``) as a
  transient line that overwrites in place — mirrors ffmpeg's
  familiar native progress format.
- A progress bar driven by ``-progress pipe:1`` machine-parseable
  output on stdout, with elapsed + ETA columns.

ffmpeg uses ``\\r`` carriage returns for its progress line, not
``\\n`` — line-buffered reading would never flush it. We read raw
byte chunks and split on either delimiter so each frame-update
arrives promptly. Lines containing ``frame=`` + ``fps=`` are
treated as progress (replace the transient text); everything else
(setup / decoder info / errors) is scrolled above the bar via
``Live.console.print``.

The Live display is ``transient=True`` so the bar disappears when
the encode completes, leaving the log clean for whatever follows.
"""

from __future__ import annotations

import collections
import contextlib
import re
import shlex
import subprocess
import threading
import time
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timedelta
from typing import IO, Generator

from rich.console import Console, Group
from rich.live import Live
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.text import Text

# ffmpeg's stderr stats line: ``frame=  123 fps= 30 q=29.0 ...`` —
# the ``frame=N`` value is what we extract to advance the bar.
# Captures variable whitespace between ``frame=`` and the number.
_STATS_FRAME_RE = re.compile(r"frame=\s*(\d+)")

# Idle threshold below which the cancellation-time diagnostic is
# skipped. A clean fast exit shouldn't print "encode idle for 0:00:01"
# — that's noise, not signal. Above this, the diagnostic line tells
# the operator how long ffmpeg had been frozen at cancellation time.
_IDLE_MIN_SECONDS_FOR_DIAGNOSTIC = 2.0

# Rolling-buffer size for ffmpeg's recent NON-stats stderr lines —
# decoder banners, ``[https @ ...] Opening 'url'`` setup, error
# messages, etc. These accumulate above the current stats line in
# the transient Live region so the operator can see what ffmpeg is
# doing during the setup window (before any ``frame=`` lines arrive)
# and during a hang (last line stays frozen while elapsed ticks).
# Stats lines are tracked separately and shown in a single
# in-place slot below the buffer; piling stats refreshes into the
# rolling buffer would evict every banner within 0.5s at the typical
# 10x/s stats period.
_RECENT_NON_STATS_LINES_MAX = 6


def _format_idle_duration(seconds: float) -> str:
    """Render ``seconds`` as ``H:MM:SS`` matching the visual
    convention of rich's :class:`TimeElapsedColumn`. Negative or
    sub-second values render as ``0:00:00`` (clamped to zero, not
    negative) so the diagnostic never reports a misleading
    negative duration."""
    return str(timedelta(seconds=max(0, int(seconds))))


class EncodeProgressTracker:
    """Runs the Live display + two reader threads for one ffmpeg
    invocation. Construct via :func:`track_encode_progress`."""

    def __init__(
        self,
        total_frames: int,
        label: str,
        console: Console,
        silent_non_progress: bool = False,
        spinner_only: bool = False,
    ) -> None:
        # When ``silent_non_progress`` is True, stderr lines that
        # aren't ffmpeg's ``frame= ... fps= ...`` stats line are
        # dropped silently rather than scrolled above the bar. Used
        # for CRF-search trial encodes: we want the bar to advance
        # (via the stats line) but don't want 20+ copies of the
        # decoder / encoder setup banner cluttering the log.
        #
        # When ``spinner_only`` is True, render only a spinner +
        # label + the transient stats line — no progress bar, no
        # m-of-n / ETA. Right for trial encodes where ffmpeg's
        # setup time dominates the sub-second actual encode and a
        # bar that mostly sits at ``0/N`` is misleading; the
        # spinner says "running" honestly and the operator sees
        # ffmpeg's live stats line for the moment it's encoding.
        self._silent_non_progress = silent_non_progress
        self._console = console
        # ``_status_text`` is the transient text element rendered
        # above the spinner row in the Live group. Its ``.plain``
        # is recomputed by :meth:`_push_line` from two pieces of
        # state: a rolling buffer of recent non-stats lines and a
        # single in-place slot for ffmpeg's latest stats line. The
        # operator sees up to N banner lines + the current encoding
        # stats, giving live visibility into both the setup window
        # (banners only, no stats yet) and the encoding window
        # (banners scroll out, stats refresh in place).
        self._status_text = Text("", style="dim")
        self._recent_non_stats_lines: collections.deque[str] = collections.deque(
            maxlen=_RECENT_NON_STATS_LINES_MAX,
        )
        self._latest_stats_line: str = ""
        # ``_last_frame_count`` is the highest frame number we've
        # ever seen from ffmpeg for this encode; ``_last_progress_ts``
        # is the monotonic clock time at the moment that highest
        # frame number arrived. Both feed the cancellation
        # diagnostic, which reports "encode idle for X — last
        # frame=N" when the encode exits abnormally. Tracking the
        # count separately means ffmpeg repeating ``frame=0`` 100x/s
        # during a hung input read doesn't falsely reset the
        # progress timestamp — only a strictly-greater frame value
        # counts as progress.
        self._last_frame_count: int = 0
        self._last_progress_ts: float = time.monotonic()
        if spinner_only:
            columns = (
                SpinnerColumn(),
                TextColumn("[bold]{task.description}[/bold]"),
                TimeElapsedColumn(),
            )
        else:
            columns = (
                SpinnerColumn(),
                TextColumn("[bold]{task.description}[/bold]"),
                BarColumn(),
                MofNCompleteColumn(),
                TextColumn("•"),
                TimeElapsedColumn(),
                TextColumn("•"),
                TimeRemainingColumn(),
            )
        self._progress = Progress(
            *columns,
            console=console,
            transient=True,
            auto_refresh=False,
        )
        self._task_id = self._progress.add_task(
            label,
            total=total_frames if total_frames > 0 else None,
        )
        self._live: Live | None = None
        self._stdout_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._stop = threading.Event()

    def attach(
        self,
        stdout: IO[bytes] | None,
        stderr: IO[bytes] | None,
    ) -> None:
        """Start reader threads on the given Popen pipes. Either may
        be ``None`` (e.g. when the subprocess didn't capture that
        stream); the corresponding thread is simply not started."""
        if stdout is not None:
            self._stdout_thread = threading.Thread(
                target=self._read_stdout,
                args=(stdout,),
                daemon=True,
            )
            self._stdout_thread.start()
        if stderr is not None:
            self._stderr_thread = threading.Thread(
                target=self._read_stderr,
                args=(stderr,),
                daemon=True,
            )
            self._stderr_thread.start()

    def _push_stderr_line(self, line: str) -> None:
        """Route an incoming stderr line into the transient display.

        Stats lines (containing both ``frame=`` and ``fps=``) replace
        the single in-place ``_latest_stats_line`` slot — at ffmpeg's
        10x/s stats period they'd otherwise evict every banner line
        from the rolling buffer in well under a second. Every other
        line appends to ``_recent_non_stats_lines``, a bounded deque
        whose oldest entries are evicted as new ones arrive. The
        rendered text is the buffer followed by the latest stats
        line, joined by newlines — gives the operator the last few
        banner / setup / error lines for context AND the current
        encoding stats below them.
        """
        if "frame=" in line and "fps=" in line:
            self._latest_stats_line = line
        else:
            self._recent_non_stats_lines.append(line)
        parts: list[str] = list(self._recent_non_stats_lines)
        if self._latest_stats_line:
            parts.append(self._latest_stats_line)
        self._status_text.plain = "\n".join(parts)

    def _read_stdout(self, pipe: IO[bytes]) -> None:
        """Parse ``-progress pipe:1`` key=value lines from stdout.
        Each ``frame=N`` advances the Progress task; ``progress=end``
        cleanly terminates the reader."""
        try:
            for line_bytes in iter(pipe.readline, b""):
                if self._stop.is_set():
                    break
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if line.startswith("frame="):
                    try:
                        n = int(line.split("=", 1)[1])
                    except (ValueError, IndexError):
                        continue
                    if n > self._last_frame_count:
                        self._last_frame_count = n
                        self._last_progress_ts = time.monotonic()
                    self._progress.update(self._task_id, completed=n)
                elif line == "progress=end":
                    break
        except (OSError, ValueError):
            # Pipe closed mid-read or decoding error — reader thread
            # should never crash the encode itself.
            pass

    def _read_stderr(self, pipe: IO[bytes]) -> None:
        """Read ffmpeg's stderr, split on ``\\r`` or ``\\n``. Every
        non-empty line is routed through :meth:`_push_stderr_line`
        so the transient region reflects ffmpeg's most recent
        output — banners during setup, then the latest stats line
        once encoding starts. Non-stats lines also scroll above the
        bar in non-silent mode so scrollback keeps the full log."""
        buffer = bytearray()
        try:
            while not self._stop.is_set():
                chunk = pipe.read(512)
                if not chunk:
                    break
                buffer.extend(chunk)
                while True:
                    cr_idx = buffer.find(b"\r")
                    lf_idx = buffer.find(b"\n")
                    candidates = [p for p in (cr_idx, lf_idx) if p >= 0]
                    if not candidates:
                        break
                    split_at = min(candidates)
                    line = bytes(buffer[:split_at]).decode(
                        "utf-8", errors="replace",
                    ).rstrip()
                    del buffer[:split_at + 1]
                    if not line:
                        continue
                    # Always route through the buffer so the
                    # transient region reflects the most recent
                    # ffmpeg output — banners and stats alike.
                    self._push_stderr_line(line)
                    if "frame=" in line and "fps=" in line:
                        # ffmpeg's stats line is flushed eagerly per
                        # stats_period (vs ``-progress pipe:1`` which
                        # avio-buffers and only flushes at exit on
                        # short encodes). Extracting the frame number
                        # from here is what actually keeps the bar
                        # moving on trial-window-sized encodes.
                        match = _STATS_FRAME_RE.search(line)
                        if match is not None:
                            n = int(match.group(1))
                            if n > self._last_frame_count:
                                self._last_frame_count = n
                                self._last_progress_ts = time.monotonic()
                            self._progress.update(
                                self._task_id,
                                completed=n,
                            )
                    elif self._silent_non_progress:
                        # Trial-encode mode: don't scroll banners
                        # above the bar (20+ repeats across trials
                        # would flood the log). The transient
                        # buffer above still shows them live so the
                        # operator can see what ffmpeg is doing.
                        continue
                    elif self._live is not None:
                        # ffmpeg output is plain text — never rich
                        # markup — so disable markup parsing here.
                        # File paths routinely contain ``[...]``
                        # (e.g. youtube IDs ``[youtube@id]``) and
                        # would otherwise be parsed as a style tag
                        # and either mangle the line or raise.
                        self._live.console.print(line, markup=False)
                    else:
                        self._console.print(line, markup=False)
        except (OSError, ValueError):
            pass

    def __enter__(self) -> EncodeProgressTracker:
        # Re-anchor the idle clock to "now" at activation. Construction
        # may happen well before the ffmpeg subprocess actually starts
        # (caller builds the tracker, then opens the ``with`` block,
        # then spawns Popen). Without this reset, the idle column
        # would already show the construction-to-activation delay as
        # accumulated idle time on the very first render.
        self._last_progress_ts = time.monotonic()
        group = Group(self._status_text, self._progress)
        self._live = Live(
            group,
            console=self._console,
            refresh_per_second=4,
            transient=True,
        )
        self._live.start()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, *_exc_info: object) -> None:
        # Signal reader threads to stop and join with a timeout so
        # a stuck pipe can't block run completion.
        self._stop.set()
        for thread in (self._stdout_thread, self._stderr_thread):
            if thread is not None:
                thread.join(timeout=2.0)
        # Persist only the last stats line to scrollback — the
        # rolling banner buffer above it would re-emit lines that
        # already scrolled past in non-silent mode and would
        # introduce 3-5 new lines per trial in silent mode. The
        # one-line stats footprint matches the prior convention.
        final_stats = self._latest_stats_line
        # Idle-at-exit diagnostic: when the encode exits abnormally
        # (KeyboardInterrupt, raised error) AND ffmpeg had been
        # silent on frame-progress for long enough, leave a
        # one-line summary in scrollback before the persisted final
        # stats. Tells the operator how long ffmpeg had been frozen
        # at cancellation — the bare ``frame= ...`` stats line
        # below it can't convey that on its own (the text looks
        # identical 1s after emission and 100s after).
        idle_diagnostic: str | None = None
        if exc_type is not None:
            idle_seconds = time.monotonic() - self._last_progress_ts
            if idle_seconds >= _IDLE_MIN_SECONDS_FOR_DIAGNOSTIC:
                idle_diagnostic = (
                    f"encode idle for {_format_idle_duration(idle_seconds)}"
                    f" — last frame={self._last_frame_count}"
                )
        if self._live is not None:
            self._live.stop()
        if idle_diagnostic is not None:
            self._console.print(idle_diagnostic, style="yellow", markup=False)
        if final_stats:
            # ``markup=False`` because ffmpeg's stats line is plain
            # text — any literal ``[...]`` (e.g. a file path with a
            # youtube id) would otherwise be parsed as rich markup
            # and mangle the line.
            self._console.print(final_stats, style="dim", markup=False)


@contextmanager
def track_encode_progress(
    *,
    total_frames: int,
    label: str,
    console: Console | None = None,
    silent_non_progress: bool = False,
    spinner_only: bool = False,
) -> Generator[EncodeProgressTracker, None, None]:
    """Context manager wrapping an ffmpeg invocation with a Live
    progress display.

    Usage::

        proc = subprocess.Popen(
            shlex.split(cmd_with_progress_flag),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        with track_encode_progress(total_frames=N, label="encoding") as tracker:
            tracker.attach(proc.stdout, proc.stderr)
            returncode = proc.wait()

    ``total_frames`` of 0 (unknown duration) is acceptable —
    rich renders a pulsing bar instead of a percentage. The reader
    threads still update the m-of-n column as frames are processed.

    ``console`` defaults to the logger's terminal console (see
    :func:`clipper.ytc_logger.get_terminal_log_console`) so rich can
    coordinate live-region updates with incoming log lines on the
    same console. Falls back to a fresh ``Console(stderr=True)``
    when the logger hasn't been initialised yet (e.g. under
    ``--no-rich-logs`` or before ``setUpLogger`` ran).
    """
    if console is None:
        from clipper.ytc_logger import get_terminal_log_console
        console = get_terminal_log_console() or Console(stderr=True)
    tracker = EncodeProgressTracker(
        total_frames,
        label,
        console,
        silent_non_progress=silent_non_progress,
        spinner_only=spinner_only,
    )
    with tracker:
        yield tracker


def run_ffmpeg_with_progress(
    cmd: str,
    *,
    total_frames: int,
    label: str,
    console: Console | None = None,
    silent_non_progress: bool = False,
    spinner_only: bool = False,
) -> int:
    """Convenience helper: append ``-progress pipe:1`` to ``cmd``,
    spawn a Popen with stdout/stderr captured, run a tracker around
    the wait, return the subprocess returncode.

    The caller is responsible for shell-splitting; we insert the
    ``-progress pipe:1 -stats_period 0.1`` flags right after the
    ffmpeg binary path so they take effect as global options (ffmpeg
    requires global flags BEFORE inputs/outputs — appending them
    after the output silently makes ffmpeg treat them as
    output-specific options on a phantom next output, and the
    progress stream never opens)."""
    parts = shlex.split(cmd)
    # Inject global flags right after the binary path so ffmpeg
    # parses them as global, not as flags applying to the (already-
    # specified) output file. ``-stats_period 0.1`` flushes progress
    # 10x/s so short encodes (CRF-search trial windows) get visible
    # bar advances instead of jumping 0 -> done at the end.
    parts = [parts[0], "-progress", "pipe:1", "-stats_period", "0.1", *parts[1:]]
    proc = subprocess.Popen(
        parts,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0,
    )
    try:
        with track_encode_progress(
            total_frames=total_frames,
            label=label,
            console=console,
            silent_non_progress=silent_non_progress,
            spinner_only=spinner_only,
        ) as tracker:
            tracker.attach(proc.stdout, proc.stderr)
            returncode = proc.wait()
    finally:
        # Ensure pipes are closed even if the tracker context raises.
        for pipe in (proc.stdout, proc.stderr):
            if pipe is not None and not pipe.closed:
                with contextlib.suppress(OSError):
                    pipe.close()
    return returncode


# Active search-level tracker for the current execution context. Set
# by the CRF-search orchestrator before invoking the search algorithm;
# read by :func:`run_ffmpeg_with_progress` (via
# :func:`runffmpegCommand`) so trial ffmpeg invocations route their
# stderr through the shared search-level Live display instead of
# spawning their own per-trial Live. ContextVar (not module global) so
# nested or concurrent searches stay isolated cleanly.
_active_search_progress: ContextVar[SearchProgressTracker | None] = ContextVar(
    "active_search_progress",
    default=None,
)


def get_active_search_progress() -> SearchProgressTracker | None:
    """Return the currently-active search-level tracker, if any.

    Callers in the ffmpeg-invocation path consult this to decide
    whether to spawn a per-encode Live display (the default) or
    delegate to a shared search-level display via
    :meth:`SearchProgressTracker.run_trial_ffmpeg`.
    """
    return _active_search_progress.get()


@contextmanager
def active_search_progress(
    tracker: SearchProgressTracker,
) -> Generator[None, None, None]:
    """Bind ``tracker`` as the active search-level tracker for the
    duration of the ``with`` block. Restores the previous value
    (typically ``None``) on exit so the binding doesn't leak across
    sibling searches."""
    token = _active_search_progress.set(tracker)
    try:
        yield
    finally:
        _active_search_progress.reset(token)


# Per-search registry of ffmpeg filter-graph strings the verbose
# command-logger has already emitted. During a CRF search a single
# trial's ``-vf "..."`` expression can run multi-thousand chars (the
# crop / sendcmd / scale chain — especially for dynamic crops with
# many keyframes) and is essentially identical across 20+ trials +
# reference encodes. Logging the full string every time buries every
# other VERBOSE line.
#
# Instead we register each unique filter graph once, assign it a
# small integer id, log it as ``filter-graph #N: <full expr>``, and
# replace subsequent occurrences in the printed command with
# ``[filter-graph #N]``. The on-disk log stays grep-able (the full
# expr appears once with its id) while per-trial command lines stay
# scannable.
#
# Scope is the active CRF search: registered graphs reset between
# searches so the numbering starts at 1 each time and graphs from
# unrelated pairs don't accumulate.
_active_filter_graph_registry: ContextVar[dict[str, int] | None] = ContextVar(
    "active_filter_graph_registry",
    default=None,
)

# ffmpeg ``-vf "EXPR"`` flag in a shell-quoted command. The
# clipper builds commands with double-quoted filter expressions
# (see ``clip_maker.py``) — match ``-vf "..."`` greedily but stop
# at the closing double quote.
_FILTER_GRAPH_FLAG_RE = re.compile(r'(-vf\s+)"([^"]+)"')

# Filter graphs shorter than this aren't worth replacing — the
# placeholder ``[filter-graph #N]`` is itself ~18 chars, and the
# "filter-graph #N: <expr>" emit line costs a log row. Tuned for
# the dynamic-crop case (typical short ``-vf`` is the loop filter,
# typical long one is the crop+scale chain in the 1000+ chars).
_FILTER_GRAPH_MIN_LEN_TO_SUBSTITUTE = 200


def get_active_filter_graph_registry() -> dict[str, int] | None:
    """Return the active filter-graph registry, or None when no
    search is in progress (callers should then log full commands).
    """
    return _active_filter_graph_registry.get()


@contextmanager
def active_filter_graph_registry() -> Generator[dict[str, int], None, None]:
    """Bind a fresh empty registry for the ``with`` block. Entered
    by :func:`track_crf_search_progress` so every CRF search gets
    its own numbering scheme; reset on exit so registries don't
    leak between searches."""
    registry: dict[str, int] = {}
    token = _active_filter_graph_registry.set(registry)
    try:
        yield registry
    finally:
        _active_filter_graph_registry.reset(token)


def substitute_filter_graphs(cmd: str) -> tuple[str, list[tuple[int, str]]]:
    """Replace each long ``-vf "EXPR"`` in ``cmd`` with
    ``-vf <filter-graph #N>`` against the active registry.

    Returns ``(substituted_cmd, new_entries)`` where ``new_entries``
    is the list of ``(id, expr)`` pairs for graphs that were JUST
    added to the registry (not previously seen). The caller is
    expected to log each new entry once so the on-disk log carries
    the full expr keyed by its id.

    The placeholder uses ANGLE brackets (``<filter-graph #N>``) not
    square brackets. Rich's markup parser treats ``[X]`` as a style
    span open tag and silently strips unknown tags from the
    rendered output — square-bracket placeholders would render as
    ``-vf  -crf 23 ...`` (placeholder eaten). Angle brackets have
    no special meaning in rich markup and round-trip intact.

    No-op when no registry is active (returns the cmd unchanged and
    an empty list) so non-search call sites keep their existing
    full-command verbose output.
    """
    registry = get_active_filter_graph_registry()
    if registry is None:
        return cmd, []
    new_entries: list[tuple[int, str]] = []

    def _replace(match: re.Match[str]) -> str:
        flag_prefix = match.group(1)
        expr = match.group(2)
        if len(expr) < _FILTER_GRAPH_MIN_LEN_TO_SUBSTITUTE:
            return match.group(0)
        if expr not in registry:
            graph_id = len(registry) + 1
            registry[expr] = graph_id
            new_entries.append((graph_id, expr))
        return f"{flag_prefix}<filter-graph #{registry[expr]}>"

    new_cmd = _FILTER_GRAPH_FLAG_RE.sub(_replace, cmd)
    return new_cmd, new_entries


@contextmanager
def track_crf_search_progress(
    *,
    label: str = "CRF search",
    console: Console | None = None,
) -> Generator[SearchProgressTracker, None, None]:
    """Bundle :class:`SearchProgressTracker` setup + contextvar
    binding into one ``with`` block.

    Usage::

        with track_crf_search_progress() as tracker:
            ...run search...

    Equivalent to entering the tracker AND
    :func:`active_search_progress` in tandem — the typical call site
    needs both, so collapsing them here keeps orchestrator wiring
    one ``with`` statement instead of two.

    **Nesting**: when an outer tracker is already active (e.g. the
    orchestrator opened one around the whole "baseline + reference
    + trials" span), this context manager yields that existing
    tracker WITHOUT opening a second Live. Lets the inner
    search-dispatch ``with`` statements stay in place as no-ops
    while one outer scope owns the continuous-elapsed timer.
    """
    existing = get_active_search_progress()
    if existing is not None:
        yield existing
        return
    tracker = SearchProgressTracker(label=label, console=console)
    # Open a fresh filter-graph registry alongside the tracker so
    # every CRF search gets its own per-search ``#N`` numbering.
    # Trial / reference / baseline ffmpeg invocations consult the
    # registry to substitute long ``-vf "..."`` expressions with
    # compact ``[filter-graph #N]`` placeholders.
    with tracker, active_search_progress(tracker), active_filter_graph_registry():
        yield tracker


class SearchProgressTracker:
    """Live progress display that spans an entire CRF search rather
    than a single ffmpeg invocation.

    Renders as a transient Live block:

    - A status line for the latest ffmpeg stats from the trial
      currently encoding (``frame= N fps= ... time= ... bitrate=
      ... speed= ...``).
    - A spinner + ``CRF search — trial N`` counter + elapsed time.

    No progress bar: the total trial count for a search isn't known
    up front (bisection may short-circuit; two-phase + curve-fit add
    variable numbers of validation / refinement probes). A bar with
    no honest endpoint is more misleading than helpful — the spinner
    + monotonically-increasing counter conveys "still running, N
    trials in" without faking a denominator.

    Trial encodes route their stderr here via
    :meth:`run_trial_ffmpeg` (called by :func:`runffmpegCommand` when
    a search tracker is active in the current context). Non-progress
    stderr lines (decoder / encoder setup banners) are dropped
    silently — they'd repeat per trial and flood the log.

    The final ffmpeg stats line is captured on exit and re-printed
    after the transient Live region clears, leaving a one-line
    "last thing the search did" footprint in the operator's
    scrollback (same convention as :class:`EncodeProgressTracker`).
    """

    def __init__(
        self,
        label: str = "CRF search",
        console: Console | None = None,
    ) -> None:
        self._label = label
        if console is None:
            # Share the logger's terminal console so rich's
            # live-region anti-clobber logic fires when log lines
            # arrive during the search — otherwise each
            # ``logger.info`` per trial smears across the spinner +
            # counter line. Fall back to a stderr Console only when
            # the logger hasn't been initialised (no-rich-logs path
            # or pre-setUp).
            from clipper.ytc_logger import get_terminal_log_console
            console = get_terminal_log_console() or Console(stderr=True)
        self._console = console
        self._status_text = Text("", style="dim")
        # Same idle-tracking state as ``EncodeProgressTracker`` —
        # see its ``__init__`` for the design rationale. The search
        # tracker resets these per-trial (in ``_run_subprocess``) so
        # a slow prior trial doesn't bleed staleness into the next
        # trial's idle accounting.
        self._last_frame_count: int = 0
        self._last_progress_ts: float = time.monotonic()
        # Same rolling-buffer + latest-stats setup as
        # ``EncodeProgressTracker`` — see its ``__init__`` for the
        # rationale. Per-trial reset happens in ``_run_subprocess``
        # so banners from the prior trial don't leak into the next.
        self._recent_non_stats_lines: collections.deque[str] = collections.deque(
            maxlen=_RECENT_NON_STATS_LINES_MAX,
        )
        self._latest_stats_line: str = ""
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold]{task.description}[/bold]"),
            TimeElapsedColumn(),
            console=self._console,
            transient=True,
            auto_refresh=False,
        )
        self._task_id = self._progress.add_task(
            f"{label} — starting",
            total=None,
        )
        self._trials_started = 0
        self._live: Live | None = None

    def _begin_trial_display(self, label: str = "") -> None:
        """Advance the trial counter and update the spinner description.

        Called at the start of every trial encode (from
        :meth:`run_trial_ffmpeg`). ``label`` is a context suffix —
        typically ``"(crf=27 w1)"`` — appended after ``trial N`` so
        the operator can see *which* CRF is being probed without
        watching the post-trial summary log lines. Empty ``label``
        falls back to bare ``"trial N"``.

        Counter is "encoded trial" semantics: cached trials (served
        from the run-cache without re-encoding) don't bump it because
        they don't invoke this method. The post-completion log line
        from ``on_trial_complete`` still names every trial (cached or
        fresh) so the cache-hit story stays visible there.
        """
        self._trials_started += 1
        desc = f"{self._label} — trial {self._trials_started}"
        if label:
            desc = f"{desc} {label}"
        self._progress.update(self._task_id, description=desc)

    def run_trial_ffmpeg(self, cmd: str, label: str = "") -> int:
        """Run an ffmpeg trial encode whose stderr feeds the shared
        Live display. Advances the trial counter and shows
        ``"trial N {label}"`` (e.g. ``"trial 3 (crf=27 w1)"``).
        Returns the subprocess returncode.
        """
        self._begin_trial_display(label)
        return self._run_subprocess(cmd)

    def run_phase_ffmpeg(self, cmd: str, label: str = "") -> int:
        """Run a non-trial ffmpeg encode (reference / baseline) whose
        stderr feeds the shared Live display.

        Does NOT advance the trial counter — the displayed phase
        label takes the description verbatim
        (e.g. ``"CRF search — reference encode (crf=18 w1 3.2-4.0s)"``)
        so the operator sees what's running with no implication
        about trial numbering. Caller passes a full label, including
        the ``"CRF search —"`` prefix, to match the trial-row format.
        """
        if label:
            self._progress.update(self._task_id, description=label)
        return self._run_subprocess(cmd)

    def _push_stderr_line(self, line: str) -> None:
        """Route an incoming stderr line into the transient display.

        Same rolling-buffer + latest-stats-slot scheme as
        :meth:`EncodeProgressTracker._push_stderr_line` — see that
        method's docstring for the rationale. The buffer is reset
        per-trial in :meth:`_run_subprocess` so banner lines from a
        prior trial don't bleed into the next trial's display.
        """
        if "frame=" in line and "fps=" in line:
            self._latest_stats_line = line
        else:
            self._recent_non_stats_lines.append(line)
        parts: list[str] = list(self._recent_non_stats_lines)
        if self._latest_stats_line:
            parts.append(self._latest_stats_line)
        self._status_text.plain = "\n".join(parts)

    def _run_subprocess(self, cmd: str) -> int:
        """Spawn the ffmpeg subprocess, route its stderr stats line
        into the shared ``_status_text``, drain stdout, and persist
        the final stats line to scrollback on completion.

        Same ``-progress pipe:1 -stats_period 0.1`` injection as
        :func:`run_ffmpeg_with_progress` so the stats line flushes
        10x/s — the bar source on short trial / reference encodes
        where ``-progress pipe:1`` alone avio-buffers until exit.

        Non-progress stderr (banner / decoder noise) is dropped: the
        search log is dense enough with the per-trial summary line
        and the persisted final-stats line; replaying ffmpeg setup
        banners on every probe would bury both.
        """
        # Reset per-trial state. Each trial encode has its own
        # frame counter and its own setup-banner stream — the
        # prior trial's final frame count, timestamp, and banner
        # buffer would falsely imply progress (or staleness) in
        # the gap between trials. Anchor "no progress yet" and
        # "no banners yet" to the moment this trial actually
        # starts.
        self._last_frame_count = 0
        self._last_progress_ts = time.monotonic()
        self._recent_non_stats_lines.clear()
        self._latest_stats_line = ""
        self._status_text.plain = ""
        parts = shlex.split(cmd)
        parts = [
            parts[0], "-progress", "pipe:1", "-stats_period", "0.1",
            *parts[1:],
        ]
        proc = subprocess.Popen(
            parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        stop = threading.Event()

        def read_stderr(pipe: IO[bytes]) -> None:
            # Same \r/\n splitting strategy as
            # EncodeProgressTracker._read_stderr — ffmpeg uses \r for
            # in-place stats updates, line-buffered reads would never
            # see them.
            buffer = bytearray()
            try:
                while not stop.is_set():
                    chunk = pipe.read(512)
                    if not chunk:
                        break
                    buffer.extend(chunk)
                    while True:
                        cr_idx = buffer.find(b"\r")
                        lf_idx = buffer.find(b"\n")
                        candidates = [p for p in (cr_idx, lf_idx) if p >= 0]
                        if not candidates:
                            break
                        split_at = min(candidates)
                        line = bytes(buffer[:split_at]).decode(
                            "utf-8", errors="replace",
                        ).rstrip()
                        del buffer[:split_at + 1]
                        if not line:
                            continue
                        # Route every line through the rolling
                        # buffer + latest-stats slot. Trial mode
                        # never scrolls banners above the bar (20+
                        # repeats across trials would flood the
                        # log), but the buffer above the spinner
                        # still surfaces them live so the operator
                        # can see what ffmpeg is doing during the
                        # setup window of a stuck trial.
                        self._push_stderr_line(line)
                        if "frame=" in line and "fps=" in line:
                            # Mirror EncodeProgressTracker: only a
                            # strictly-greater frame number counts
                            # as progress. ffmpeg can repeat the
                            # same ``frame=0`` stats line for
                            # minutes during a hung input read; we
                            # want the progress timestamp to stay
                            # frozen through that, not be falsely
                            # reset on every stats refresh.
                            match = _STATS_FRAME_RE.search(line)
                            if match is not None:
                                n = int(match.group(1))
                                if n > self._last_frame_count:
                                    self._last_frame_count = n
                                    self._last_progress_ts = time.monotonic()
            except (OSError, ValueError):
                pass

        stderr_thread = threading.Thread(
            target=read_stderr, args=(proc.stderr,), daemon=True,
        )
        stderr_thread.start()
        # stdout (``-progress pipe:1``) is captured to keep the pipe
        # drained so ffmpeg doesn't block on a full kernel buffer;
        # we don't read from it because the stderr stats line is the
        # bar's source (avio buffering makes the pipe:1 stream
        # unreliable on short trial encodes anyway — see
        # run_ffmpeg_with_progress' design notes).

        def drain_stdout(pipe: IO[bytes]) -> None:
            try:
                while not stop.is_set():
                    if not pipe.read(4096):
                        break
            except (OSError, ValueError):
                pass

        stdout_thread = threading.Thread(
            target=drain_stdout, args=(proc.stdout,), daemon=True,
        )
        stdout_thread.start()

        try:
            returncode = proc.wait()
        finally:
            stop.set()
            for thread in (stderr_thread, stdout_thread):
                thread.join(timeout=2.0)
            for pipe in (proc.stdout, proc.stderr):
                if pipe is not None and not pipe.closed:
                    with contextlib.suppress(OSError):
                        pipe.close()
        # Persist this encode's final ffmpeg stats line to scrollback
        # before the next encode starts overwriting the buffer.
        # Without this, only the search-level ``__exit__`` would
        # leave a footprint — losing the per-encode visibility the
        # operator had under the old per-encode tracker (each encode
        # had its own ``EncodeProgressTracker.__exit__`` that
        # printed the final line). The shared console means rich
        # lifts the Live region, prints the line, and redraws the
        # bar below.
        #
        # Persist ONLY the stats line, not the rolling banner
        # buffer above it — that buffer's banners would re-emit
        # every trial's setup chatter (4-line clusters every probe)
        # and overwhelm the scrollback. Banners stay live-only.
        # Reset the buffers so the next trial starts clean.
        final_stats = self._latest_stats_line
        if final_stats:
            # ``markup=False`` because ffmpeg's stats line is plain
            # text — any literal ``[...]`` (e.g. a file path with a
            # youtube id) would otherwise be parsed as rich markup
            # and mangle the line.
            self._console.print(final_stats, style="dim", markup=False)
            self._latest_stats_line = ""
            self._recent_non_stats_lines.clear()
            self._status_text.plain = ""
        return returncode

    def __enter__(self) -> SearchProgressTracker:
        # See EncodeProgressTracker.__enter__ for why we re-anchor
        # the idle clock at activation rather than relying on the
        # ``__init__`` value.
        self._last_progress_ts = time.monotonic()
        group = Group(self._status_text, self._progress)
        self._live = Live(
            group,
            console=self._console,
            refresh_per_second=4,
            transient=True,
        )
        self._live.start()
        return self

    def __exit__(self, exc_type: type[BaseException] | None, *_exc_info: object) -> None:
        # Persist only the stats line — banners in the rolling
        # buffer would pollute scrollback with the in-progress
        # trial's setup chatter on every search exit. See
        # EncodeProgressTracker.__exit__ for the matching
        # one-line-footprint rationale.
        # Same idle-at-exit diagnostic too: if the search exited
        # abnormally (Ctrl+C during a trial that wedged), tell the
        # operator how long the in-flight trial had been idle.
        final_stats = self._latest_stats_line
        idle_diagnostic: str | None = None
        if exc_type is not None:
            idle_seconds = time.monotonic() - self._last_progress_ts
            if idle_seconds >= _IDLE_MIN_SECONDS_FOR_DIAGNOSTIC:
                idle_diagnostic = (
                    f"encode idle for {_format_idle_duration(idle_seconds)}"
                    f" — last frame={self._last_frame_count}"
                )
        if self._live is not None:
            self._live.stop()
        if idle_diagnostic is not None:
            self._console.print(idle_diagnostic, style="yellow", markup=False)
        if final_stats:
            # ``markup=False`` because ffmpeg's stats line is plain
            # text — any literal ``[...]`` (e.g. a file path with a
            # youtube id) would otherwise be parsed as rich markup
            # and mangle the line.
            self._console.print(final_stats, style="dim", markup=False)
