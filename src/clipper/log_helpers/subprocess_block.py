"""Sub-phase rules that bracket external-subprocess invocations.

Tools like ``yt-dlp`` and ``video2x`` stream their own output
directly to stdout/stderr (carriage-return progress bars, etc.).
Capturing and re-emitting that line-by-line through our logger
would prefix every line with a subsystem chip but would also
destroy the progress-bar overwrites — the cure worse than the
disease.

Instead we visually scope the streamed output with a pair of
sub-phase rules. The opening rule announces what's about to run;
the closing rule (emitted on context exit) names the returncode
or the exception that terminated the block. The subprocess's own
output flows between the two rules and is attributed by proximity:

    ┄┄┄ yt-dlp · download ┄┄┄
    <yt-dlp progress bars stream through>
    ┄┄┄ yt-dlp done (rc=0) ┄┄┄
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator, Protocol


class _RuleLogger(Protocol):
    """Minimal protocol for the loggers we accept — only ``rule``
    is used here, but typing it loosely lets both ``YTCLogger`` and
    ``SubsystemLogger`` flow through."""

    def rule(
        self,
        title: str | None = ...,
        *,
        sub: bool = ...,
    ) -> None: ...


class SubprocessBlock:
    """Mutable status carrier passed to the ``with`` body so the
    caller can record the subprocess returncode. The closing rule
    reads it on exit."""

    def __init__(self) -> None:
        self.returncode: int | None = None

    def set_returncode(self, rc: int | None) -> None:
        self.returncode = rc


@contextmanager
def subprocess_block(
    tool_name: str,
    *,
    logger: _RuleLogger,
    action: str = "",
) -> Generator[SubprocessBlock, None, None]:
    """Bracket a subprocess invocation with open + close sub-rules.

    Usage:

        with subprocess_block("yt-dlp", logger=logger, action="download") as block:
            process = subprocess.run(args=..., check=False)
            block.set_returncode(process.returncode)

    The opening rule renders as ``yt-dlp · download``; the closing
    rule renders as ``yt-dlp done (rc=0)`` (or just ``yt-dlp done``
    if no returncode was recorded). On exception, the close becomes
    ``yt-dlp failed (<ExceptionName>)`` and the exception
    propagates.
    """
    open_title = tool_name if not action else f"{tool_name} · {action}"
    logger.rule(title=open_title, sub=True)
    block = SubprocessBlock()
    try:
        yield block
    except BaseException as exc:
        close_title = f"{tool_name} failed ({type(exc).__name__})"
        logger.rule(title=close_title, sub=True)
        raise
    else:
        if block.returncode is not None:
            close_title = f"{tool_name} done (rc={block.returncode})"
        else:
            close_title = f"{tool_name} done"
        logger.rule(title=close_title, sub=True)
