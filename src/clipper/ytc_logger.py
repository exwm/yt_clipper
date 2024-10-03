import atexit
import logging
from pathlib import Path
from types import TracebackType
from typing import IO, Dict

import coloredlogs
import verboselogs
from rich.console import Console
from rich.logging import RichHandler
from rich.style import Style
from rich.theme import Theme

from clipper.clipper_types import ClipperPaths, ClipperState

RICH_LOG_FORMAT = r"%(message)s"
COLORED_LOGS_LOG_FORMAT = r"[%(asctime)s] %(levelname)s: %(message)s"
DATE_FORMAT = "%y-%m-%d %H:%M:%S"

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

THEME_COLORS_LOG_LEVELS = {
    "logging.level.info": "white",
    "logging.level.success": "spring_green2",
    "logging.level.debug": "gold3",
    "logging.level.warning": "dark_orange",
    "logging.level.important": "orange_red1",
    "logging.level.notice": "slate_blue1",
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

    def success(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(verboselogs.SUCCESS, msg, *args, **kwargs)

    def info(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.INFO, msg, *args, **kwargs)

    def warning(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.WARNING, msg, *args, **kwargs)

    def error(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.ERROR, msg, *args, **kwargs)

    def debug(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(logging.DEBUG, msg, *args, **kwargs)

    def verbose(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(verboselogs.VERBOSE, msg, *args, **kwargs)

    def important(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(IMPORTANT, msg, *args, **kwargs)

    def notice(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(NOTICE, msg, *args, **kwargs)

    def header(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        # msg = f"[dodger_blue2]{msg}"
        # kwargs["extra"] = {"markup": True}
        self.log(HEADER, msg, *args, **kwargs)

    def report(self, msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        self.log(REPORT, msg, *args, **kwargs)


logger = YTCLogger(__name__)


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

    cp.logFilePath = f'{cp.clipsPath}/{settings["titleSuffix"]}.log'
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
        cp.logFilePath = f'{cp.clipsPath}/{settings["titleSuffix"]}.log'
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
    logger.info("-" * 80)
    logger.header(f"""{"#" * 30} Summary Report {"#" * 30}""")
    print(reportColored)

    report = cs.reportStream.getvalue()
    printToLogFile(cs.clipper_paths, report)


def printToLogFile(cp: ClipperPaths, msg: str) -> None:
    if Path(cp.logFilePath).is_file():
        with open(cp.logFilePath, "a", encoding="utf-8") as f:
            f.write(msg)
