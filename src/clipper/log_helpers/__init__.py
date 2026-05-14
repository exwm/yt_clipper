"""Shared logging helpers for the clipper.

Each helper is a small, well-tested formatting primitive — the
loggers themselves stay in :mod:`clipper.ytc_logger`. Putting the
formatters here keeps the call-site code focused on *what* it wants
to say, with the helper handling *how* it gets rendered (column
alignment, snapshot diffs, etc.).

Public surface (just settings-dump today):
"""

from .paths import LogPath, quoted_path
from .rules import render_rule
from .settings_dump import (
    SettingsSnapshot,
    build_auto_encode_settings_snapshot,
    build_global_settings_snapshot,
    build_marker_pair_settings_snapshot,
    emit_marker_pair_settings_log,
    log_settings_dump,
    render_settings_diff,
    render_settings_table,
    reset_settings_log_memo,
)
from .subprocess_block import SubprocessBlock, subprocess_block
from .tables import render_rich_table_to_text
from .timing import StageTimer, get_timer, render_timing_summary, time_stage

__all__ = [
    "LogPath",
    "SettingsSnapshot",
    "StageTimer",
    "SubprocessBlock",
    "build_auto_encode_settings_snapshot",
    "build_global_settings_snapshot",
    "build_marker_pair_settings_snapshot",
    "emit_marker_pair_settings_log",
    "get_timer",
    "log_settings_dump",
    "quoted_path",
    "render_rich_table_to_text",
    "render_rule",
    "render_settings_diff",
    "render_settings_table",
    "render_timing_summary",
    "reset_settings_log_memo",
    "subprocess_block",
    "time_stage",
]
