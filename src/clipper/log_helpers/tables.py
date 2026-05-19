"""Render rich tables to plain text for the logger.

The sample-guided aggregate summary and the per-clip prior-run delta
block are tabular outputs that previously used hand-padded f-string
columns. ``rich.Table`` handles the alignment arithmetic and lets us
add per-column styling without recomputing widths.

We render to plain text (no ANSI) because the logger wraps every
message in its level-color markup, and feeds the same string to the
plain ``reportStream`` and the on-disk log file. Letting rich's auto-
colors leak through would conflict with that wrapping and clutter
the on-disk artifacts.
"""

from __future__ import annotations

import io

from rich.console import Console
from rich.table import Table


def render_rich_table_to_text(table: Table, *, width: int | None = None) -> str:
    """Render a ``rich.Table`` to a plain-text string.

    Output has no ANSI codes, no terminal-detection wrapping, and a
    fixed width (defaults to 120) so the same table reads identically
    in the live console (where the logger applies the level color
    on top), the report stream, and the on-disk log file.

    Trailing newline is stripped so the caller can compose the table
    with other lines via ``"\\n".join(...)`` without empty rows.
    """
    buf = io.StringIO()
    console = Console(
        file=buf,
        soft_wrap=False,
        force_terminal=False,
        no_color=True,
        width=width or 120,
    )
    console.print(table)
    return buf.getvalue().rstrip("\n")
