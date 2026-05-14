"""Horizontal-rule rendering for log section separators.

Replaces the legacy ``logger.info("-" * 80)`` and the
``"#" * 30 + " Title " + "#" * 30`` banner pattern with a
single helper that handles both untitled and titled rules.

The renderer is plain-text and width-aware so the same rule
reads identically in the live console, the on-disk log file,
and the captured report stream.
"""

from __future__ import annotations

DEFAULT_RULE_CHAR = "─"
DEFAULT_RULE_WIDTH = 80


def render_rule(
    title: str | None = None,
    *,
    char: str = DEFAULT_RULE_CHAR,
    width: int = DEFAULT_RULE_WIDTH,
) -> str:
    """Return a horizontal rule, optionally with a centered title.

    - ``render_rule()`` → a plain run of ``char`` repeating ``width``
      times.
    - ``render_rule("Summary Report")`` → ``── Summary Report ──``
      with the title centered inside the rule chars; widths balance
      so the line is exactly ``width`` characters when possible.
    - When the title is longer than ``width``, returns just the
      title surrounded by single spaces (no truncation — better to
      overflow than hide).

    The ``char`` defaults to a Unicode light-horizontal box-drawing
    glyph for cleaner aesthetics in modern terminals; pass ``"-"``
    for ASCII-only contexts.
    """
    if not title:
        return char * width
    decorated = f" {title} "
    if len(decorated) >= width:
        return decorated.strip()
    left = (width - len(decorated)) // 2
    right = width - left - len(decorated)
    return f"{char * left}{decorated}{char * right}"
