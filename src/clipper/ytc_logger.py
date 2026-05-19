import atexit
import logging
import shutil
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from types import TracebackType
from typing import IO, Dict, Generator

import coloredlogs
import verboselogs
from rich.console import Console
from rich.logging import RichHandler
from rich.style import Style
from rich.theme import Theme

from clipper.clipper_types import ClipperPaths, ClipperState

RICH_LOG_FORMAT = r"%(message)s"
COLORED_LOGS_LOG_FORMAT = r"[%(asctime)s] %(levelname)s: %(message)s"
# Per-line timestamps are hour:minute:second only — within a single
# run, the date doesn't change, and the on-disk log file is anchored
# to an absolute ISO timestamp via the startup REPORT line. Saves
# ~9 chars of horizontal real estate on every log line.
DATE_FORMAT = "%H:%M:%S"

# CRITICAL = 50
# FATAL = CRITICAL
# ERROR = 40
REPORT = 34
HEADER = 33
NOTICE = 32
# WARNING = 30
# WARN = WARNING
IMPORTANT = 29
# INFO = 20
# DEBUG = 10
# NOTSET = 0

# Per-level colors. Picked for distinguishability across adjacent
# severity tiers — previously NOTICE and HEADER were both blue and
# IMPORTANT / WARNING / ERROR were all in the red-orange family, so
# levels read as a single warm blob. Current palette spreads them:
# - subdued (DEBUG / VERBOSE / INFO): grey / gold / white
# - positive (SUCCESS): green
# - structural blue family: NOTICE = cyan, HEADER = dodger_blue,
#   REPORT = plum (purple)
# - warm severity: IMPORTANT = yellow, WARNING = orange,
#   ERROR = red — each step up the severity scale a distinct hue.
THEME_COLORS_LOG_LEVELS = {
    "logging.level.info": "white",
    "logging.level.success": "spring_green2",
    "logging.level.debug": "gold3",
    "logging.level.warning": "dark_orange",
    "logging.level.important": "yellow3",
    "logging.level.notice": "cyan",
    "logging.level.header": "dodger_blue1",
    "logging.level.report": "plum2",
    "logging.level.verbose": "light_slate_grey",
    "logging.level.error": "red3",
    "log.time": Style(color="light_steel_blue1"),
}

THEME_RICH_CONSOLE = Theme(THEME_COLORS_LOG_LEVELS)


class YTCLogger(verboselogs.VerboseLogger):
    console = Console(soft_wrap=True, highlight=True, theme=THEME_RICH_CONSOLE)
    no_rich_logs = False

    def log(
        self,
        level: int,
        msg: object,
        *args: object,
        exc_info: None
        | bool
        | tuple[type[BaseException], BaseException, TracebackType | None]
        | tuple[None, None, None]
        | BaseException = None,
        stack_info: bool = False,
        stacklevel: int = 1,
        extra: Dict[str, object] | None = None,
    ) -> None:
        if not self.no_rich_logs:
            level_name = logging.getLevelName(level)
            color = self.console.get_style(f"logging.level.{level_name.lower()}")

            msg = f"[{color}]{msg}"
            if extra is None:
                extra = {}
            extra["markup"] = True

        return super().log(
            level,
            msg,
            *args,
            exc_info=exc_info,
            stack_info=stack_info,
            stacklevel=stacklevel,
            extra=extra,
        )

    def set_no_rich_logs(self) -> None:
        self.no_rich_logs = True

    def success(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(verboselogs.SUCCESS, msg, *args, **kwargs)

    def info(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.ERROR, msg, *args, **kwargs)

    def debug(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.DEBUG, msg, *args, **kwargs)

    def verbose(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(verboselogs.VERBOSE, msg, *args, **kwargs)

    def important(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(IMPORTANT, msg, *args, **kwargs)

    def notice(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(NOTICE, msg, *args, **kwargs)

    def header(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(HEADER, msg, *args, **kwargs)

    def report(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(REPORT, msg, *args, **kwargs)

    # Route critical / fatal through our log() override too —
    # otherwise stdlib's Logger.critical bypasses our markup-wrapping
    # path and the operator sees literal "[bold]chip[/bold]:" text.
    def critical(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.CRITICAL, msg, *args, **kwargs)

    def fatal(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.CRITICAL, msg, *args, **kwargs)

    def rule(
        self,
        title: str | None = None,
        *,
        sub: bool = False,
        level: int | None = None,
        char: str | None = None,
        width: int | None = None,
    ) -> None:
        """Emit a horizontal rule, optionally with a centered title.

        Replaces the legacy ``logger.info("-" * 80)`` and
        ``logger.header("#" * 30 + " Title " + "#" * 30)`` patterns.

        Three default styles, picked by the ``title`` / ``sub`` combo:

        - **Top-level titled** (``rule(title=...)``): HEADER level
          (dodger_blue1) + heavy ``━`` glyph. Phase-boundary banners
          — they should pop.
        - **Sub-phase titled** (``rule(title=..., sub=True)``):
          HEADER level (same color as the parent) + dashed ``┄``
          glyph. Same color signals "still a header" while the
          dashed weight signals "nested under the most recent
          top-level rule."
        - **Untitled** (``rule()``): INFO level (white) + light
          ``─`` glyph. Soft separators between sub-blocks of the
          same phase; they should be subtle.

        Either default can be overridden via ``level`` / ``char``.
        Width auto-detects from the terminal (capped at 100) so the
        rule fits one line; the ~30-char RichHandler time + level
        prefix is budgeted out automatically.
        """
        from clipper.log_helpers import render_rule
        if level is None:
            level = HEADER if title else logging.INFO
        if char is None:
            char = ("┄" if sub else "━") if title else "─"
        if width is None:
            cols = shutil.get_terminal_size((80, 24)).columns
            # RichHandler prepends a time + level column block before
            # the message body. Budget ~30 chars for that prefix so
            # the rule fits on one line; otherwise it soft-wraps and
            # the title lands on a second line.
            available = cols - 30
            width = min(100, max(40, available))
        self.log(level, render_rule(title, char=char, width=width))


logger = YTCLogger(__name__)


class Subsystem:
    """Canonical subsystem names used by ``make_subsystem_logger``.

    Centralizes the prefix strings so a typo doesn't fork a subsystem
    into two variants (``"clipmaker"`` vs ``"clip-maker"``). Also
    makes the full subsystem inventory discoverable in one place.

    Naming convention: lowercase, kebab-case, no trailing colon. The
    underline-decorated prefix is added by ``SubsystemLogger``.
    """

    CLI = "cli"
    CLIP_MAKER = "clip-maker"
    SAMPLE_ENCODE = "sample-encode"
    FFMPEG_CODEC = "ffmpeg-codec"
    FFMPEG_FILTER = "ffmpeg-filter"
    FFPROBE = "ffprobe"
    PLATFORMS = "platforms"
    PREVIEWS = "previews"
    QUALITY_VMAF = "quality-vmaf"
    SETTINGS = "settings"
    VIDEO2X = "video2x"
    YTDL = "ytdl"


# Context-local "which marker pair am I logging for". Set by
# ``pair_context(N)`` around per-pair work in the makeClips loop;
# read by SubsystemLogger when building each chip. Unset (default
# None) means the log isn't pair-scoped — e.g. setup, summary,
# tooling-version banner.
_current_pair: ContextVar[int | None] = ContextVar(
    "yt_clipper_current_pair",
    default=None,
)


@contextmanager
def pair_context(pair_index: int) -> Generator[None, None, None]:
    """Wrap a block of code so every NOTICE+ log emitted inside it
    gets a ``· pair {pair_index + 1}`` suffix on its subsystem chip.

    Used by the makeClips loop to scope each marker pair's work::

        for markerPairIndex, _marker in enumerate(settings["markerPairs"]):
            with pair_context(markerPairIndex):
                ...  # all log lines inside auto-tagged with pair index

    Resets the context var on exit so subsequent loop iterations
    (and tear-down code that runs after the loop) aren't tagged.
    """
    token = _current_pair.set(pair_index)
    try:
        yield
    finally:
        _current_pair.reset(token)


class SubsystemLogger:
    """Wraps the global ``logger`` and prefixes operator-facing
    messages with a bold subsystem chip (``clip-maker:``,
    ``sample-guided:``, etc.).

    When inside a ``pair_context(N)`` scope, the chip extends to
    ``clip-maker · pair N+1:`` so every line during that pair's
    processing carries pair context implicitly — operators don't
    need to remember which ``━━━ Marker pair N ━━━`` banner is
    most recent.

    The prefix is applied to every level — INFO and VERBOSE
    included — so multi-subsystem interleaving stays attributable
    and a ``grep "<subsystem>:"`` returns the full output from that
    subsystem regardless of severity. ``rule(...)`` is the lone
    exception; rule titles carry their own semantics and the chip
    would clash with the centered title.

    Rich markup composes with the level-color wrap that ``YTCLogger.log``
    adds: the chip's ``[bold]...[/bold]`` applies on top of the
    level color, so the chip reads as bold in the level's hue with
    the rest of the message at the same color, plain weight.
    """

    def __init__(self, name: str) -> None:
        self._name = name

    def _build_chip(self) -> str:
        pair = _current_pair.get()
        if pair is not None:
            return f"[bold]{self._name} ({pair + 1})[/bold]: "
        return f"[bold]{self._name}[/bold]: "

    def _prefixed(self, msg: object) -> object:
        if isinstance(msg, str):
            return f"{self._build_chip()}{msg}"
        return msg

    def success(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.success(self._prefixed(msg), *args, **kwargs)

    def important(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.important(self._prefixed(msg), *args, **kwargs)

    def warning(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.warning(self._prefixed(msg), *args, **kwargs)

    def notice(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.notice(self._prefixed(msg), *args, **kwargs)

    def header(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.header(self._prefixed(msg), *args, **kwargs)

    def report(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.report(self._prefixed(msg), *args, **kwargs)

    def error(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.error(self._prefixed(msg), *args, **kwargs)

    def critical(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.critical(self._prefixed(msg), *args, **kwargs)

    def fatal(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.fatal(self._prefixed(msg), *args, **kwargs)

    def info(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.info(self._prefixed(msg), *args, **kwargs)

    def verbose(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.verbose(self._prefixed(msg), *args, **kwargs)

    def debug(self, msg: object, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.debug(self._prefixed(msg), *args, **kwargs)

    def rule(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logger.rule(*args, **kwargs)


def make_subsystem_logger(name: str) -> SubsystemLogger:
    """Factory for a subsystem-prefixed logger. Each module that
    wants its operator-facing messages tagged with a subsystem name
    replaces ``from clipper.ytc_logger import logger`` with::

        from clipper.ytc_logger import make_subsystem_logger
        logger = make_subsystem_logger("clip-maker")

    NOTICE+ calls then render as ``clip-maker: <message>`` with
    ``clip-maker`` underlined in the level color.
    """
    return SubsystemLogger(name)


def setUpLogger(cs: ClipperState) -> None:
    atexit.register(logging.shutdown)

    if not cs.settings["noRichLogs"]:
        setUpLoggerWithRich(cs)
    else:
        logger.set_no_rich_logs()
        setUpLoggerWithColoredLogs(cs)


def setUpLoggerWithRich(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths
    base_log_level = settings.get("logLevel") or verboselogs.VERBOSE

    verboselogs.add_log_level(IMPORTANT, "IMPORTANT")
    verboselogs.add_log_level(NOTICE, "NOTICE")
    verboselogs.add_log_level(HEADER, "HEADER")
    verboselogs.add_log_level(REPORT, "REPORT")

    rich_log_handler = get_rich_log_handler(level=base_log_level)
    # Publish the terminal handler's console so live-display callers
    # (rich.live.Live wrapped trackers) can share it. See
    # :func:`get_terminal_log_console`.
    global _terminal_log_console  # noqa: PLW0603 — single-writer publication of the shared console
    _terminal_log_console = rich_log_handler.console
    rich_colored_report_log_handler = get_rich_log_handler(
        level=NOTICE,
        file=cs.reportStreamColored,
        color=True,
    )
    rich_report_log_handler = get_rich_log_handler(level=NOTICE, file=cs.reportStream, color=False)

    logging.basicConfig(
        level=base_log_level,
        format=RICH_LOG_FORMAT,
        datefmt=DATE_FORMAT,
        handlers=[
            rich_log_handler,
            rich_colored_report_log_handler,
            rich_report_log_handler,
        ],
    )

    if settings["preview"]:
        return

    cp.logFilePath = f"{cp.clipsPath}/{settings['titleSuffix']}.log"
    # assume file will be closed by rich.console.Console or else at program exit
    f = open(cp.logFilePath, "a", encoding="utf-8")  # noqa: SIM115
    rich_file_log_handler = get_rich_log_handler(level=base_log_level, file=f, color=False)
    logger.addHandler(rich_file_log_handler)


def get_rich_log_handler(
    level: int,
    file: IO[str] | None = None,
    color: bool = True,
) -> RichHandler:
    console = Console(
        file=file,
        soft_wrap=True,
        highlight=color,
        force_terminal=color,
        no_color=not color,
    )
    console.push_theme(theme=THEME_RICH_CONSOLE)

    log_handler = RichHandler(
        console=console,
        rich_tracebacks=False,
        omit_repeated_times=False,
        log_time_format=DATE_FORMAT,
        show_path=False,
    )
    log_handler.setFormatter(logging.Formatter(RICH_LOG_FORMAT, datefmt=DATE_FORMAT))
    log_handler.setLevel(level)

    return log_handler


# Module-level handle on the RichHandler's terminal-facing console.
# Anything that wants to render a rich.live.Live block while the
# logger is also writing log lines MUST use this exact Console
# instance, otherwise the Live's anti-clobber logic (which lifts
# the live region above incoming console.print calls) doesn't fire
# and log lines smear across the live region. Set by
# :func:`setUpLoggerWithRich` once the terminal handler is built.
_terminal_log_console: Console | None = None


def get_terminal_log_console() -> Console | None:
    """Return the RichHandler's terminal console, or ``None`` if the
    rich path isn't set up (e.g. ``--no-rich-logs`` mode, or the
    logger hasn't been initialised yet).

    The search progress tracker (and per-encode tracker) call this
    to share a console with the logger so rich coordinates live-
    region updates against incoming log lines. Without sharing, each
    log line during an active Live writes through a separate Console
    that doesn't know about the live region, leaving the spinner /
    bar smeared into the log line on the same row.
    """
    return _terminal_log_console


def setUpLoggerWithColoredLogs(cs: ClipperState) -> None:
    settings = cs.settings
    cp = cs.clipper_paths

    verboselogs.add_log_level(29, "IMPORTANT")
    verboselogs.add_log_level(32, "NOTICE")
    verboselogs.add_log_level(33, "HEADER")
    verboselogs.add_log_level(34, "REPORT")

    formatString = r"[%(asctime)s] (ln %(lineno)d) %(levelname)s: %(message)s"
    coloredlogs.DEFAULT_LOG_FORMAT = formatString
    coloredlogs.DEFAULT_FIELD_STYLES["levelname"] = {"color": "white"}
    coloredlogs.DEFAULT_LEVEL_STYLES["DEBUG"] = {"color": 219}  # pink # type: ignore
    coloredlogs.DEFAULT_LEVEL_STYLES["IMPORTANT"] = {"color": 209}  # orange  # type: ignore
    coloredlogs.DEFAULT_LEVEL_STYLES["NOTICE"] = {"color": "magenta"}
    coloredlogs.DEFAULT_LEVEL_STYLES["HEADER"] = {"color": "blue"}
    coloredlogs.DEFAULT_LEVEL_STYLES["REPORT"] = {"color": "cyan"}

    datefmt = "%y-%m-%d %H:%M:%S"
    log_level = settings.get("logLevel") or verboselogs.VERBOSE
    coloredlogs.install(level=log_level, datefmt=datefmt)

    coloredFormatter = coloredlogs.ColoredFormatter(datefmt=datefmt)

    reportHandler = logging.StreamHandler(cs.reportStream)
    reportHandler.setLevel(32)
    logger.addHandler(reportHandler)
    reportHandlerColored = logging.StreamHandler(cs.reportStreamColored)
    reportHandlerColored.setLevel(32)
    reportHandlerColored.setFormatter(coloredFormatter)
    logger.addHandler(reportHandlerColored)

    if not settings["preview"]:
        cp.logFilePath = f"{cp.clipsPath}/{settings['titleSuffix']}.log"
        fileHandler = logging.FileHandler(
            filename=cp.logFilePath,
            mode="a",
            encoding="utf-8",
        )
        formatter = coloredlogs.BasicFormatter(fmt=formatString, datefmt=datefmt)
        fileHandler.setFormatter(formatter)
        logger.addHandler(fileHandler)


def printReport(cs: ClipperState) -> None:
    reportColored = cs.reportStreamColored.getvalue()
    logger.rule(title="Summary Report")
    print(reportColored)

    report = cs.reportStream.getvalue()
    printToLogFile(cs.clipper_paths, report)


def printToLogFile(cp: ClipperPaths, msg: str) -> None:
    if Path(cp.logFilePath).is_file():
        with open(cp.logFilePath, "a", encoding="utf-8") as f:
            f.write(msg)
