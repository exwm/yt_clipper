"""Path formatting for log messages.

Every file path that lands in a log message needs three things:

1. **Markup safety** — rich interprets ``[`` as the start of a style
   tag. A path with ``[`` in it (rare but possible on user file
   systems) would either render as garbled markup or trigger a
   parser error. ``rich.markup.escape`` neutralizes the brackets.
2. **Visible boundary** — wrapping the path in double quotes
   delimits it from surrounding prose so the reader can tell where
   the path starts and ends, especially when paths contain spaces.
3. **Copy-pasteable** — both PowerShell and bash respect double
   quotes around a path argument, so the quoted form can be
   ``&``-prefixed in PS or pasted into bash without re-quoting.

``quoted_path(path)`` rolls all three into a single call. The
single source of truth for the convention; ad-hoc inline
``f'"{rich.markup.escape(p)}"'`` at the call site is the failure
mode this helper exists to prevent.
"""

from __future__ import annotations

from pathlib import Path

import rich.markup


class LogPath:
    """Wrap a file path so it auto-quotes when interpolated into an
    f-string (or any ``str.format`` context).

    Call site::

        logger.success(f'Generated: {LogPath(mp["fileName"])}')

    On interpolation (``__format__``) or ``str()``, the wrapped
    value renders as ``"<rich-escaped>"`` so:

    - rich-markup brackets in the path don't break the parser,
    - the path boundary is visibly delimited,
    - the quoted form pastes cleanly into PowerShell or bash.

    ``None`` renders as ``(none)`` so the call site doesn't need
    an extra ``if path is not None`` branch.
    """

    __slots__ = ("_value",)

    def __init__(self, path: str | Path | None) -> None:
        self._value = path

    def __format__(self, _format_spec: str) -> str:
        if self._value is None:
            return "(none)"
        return f'"{rich.markup.escape(str(self._value))}"'

    def __str__(self) -> str:
        return self.__format__("")

    def __repr__(self) -> str:
        return f"LogPath({self._value!r})"


def quoted_path(path: str | Path | None) -> str:
    """Plain-function alias for ``LogPath(p)`` rendered to a string.

    Use when a path string is needed outside an f-string context
    (joining lists, building a non-template message, etc.). Inside
    an f-string, prefer ``f'{LogPath(p)}'`` — slightly cleaner.
    """
    return str(LogPath(path))
