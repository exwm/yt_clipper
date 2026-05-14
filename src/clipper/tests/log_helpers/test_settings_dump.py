"""Tests for the marker-pair settings dump helper.

The helper has two responsibilities: build a stable, section-grouped
snapshot from the live ``mp`` / ``mps`` dicts, and render it
diffably. Tests cover snapshot completeness (every legacy field
survives the format change), diff correctness (only-changed rows
emerge, identical snapshots produce ``None``), and the in-process
memo (first call full, repeat call silent, change call diff).
"""

from __future__ import annotations

from typing import Any

import pytest

from clipper.log_helpers.settings_dump import (
    SettingsSnapshot,
    build_auto_encode_settings_snapshot,
    build_global_settings_snapshot,
    build_marker_pair_settings_snapshot,
    emit_marker_pair_settings_log,
    render_settings_diff,
    render_settings_table,
    reset_settings_log_memo,
)


@pytest.fixture(autouse=True)
def _reset_memo() -> None:
    reset_settings_log_memo()


def _baseline_mp_mps() -> tuple[dict[str, Any], dict[str, Any]]:
    mp: dict[str, Any] = {
        "isVariableSpeed": False,
        "outputDuration": 12.5,
    }
    mps: dict[str, Any] = {
        "titlePrefix": "lynn",
        "videoCodec": "vp9",
        "crf": 30,
        "encodeSpeed": 2,
        "twoPass": False,
        "enableHDR": False,
        "targetMaxBitrate": 0,
        "autoTargetMaxBitrate": 14000,
        "audio": True,
        "denoise": {"desc": "off"},
        "enableSpeedMaps": True,
        "minterpFpsMultiplier": 1.0,
        "minterpMode": "MCI",
        "minterpTool": "ffmpeg",
        "minterpFPS": 60,
        "loop": "none",
        "videoStabilization": {"desc": "off"},
        "videoStabilizationMaxAngle": -1,
        "videoStabilizationMaxShift": -1,
        "videoStabilizationDynamicZoom": False,
    }
    return mp, mps


def test_snapshot_includes_every_section() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert set(snap.keys()) == {
        "Identity",
        "Encoding",
        "Bitrate",
        "Audio",
        "Speed",
        "Motion-interp",
        "Looping",
        "Stabilization",
        "Output",
    }


def test_snapshot_uses_kebab_case_keys_with_no_whitespace() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(
        mp, mps,
        marker_pair_index=0,
        bitrate_factor=1.5,
        bitrate_crop_factor=0.6,
        bitrate_fps_factor=2.0,
    )
    for section, fields in snap.items():
        for key, value in fields.items():
            assert " " not in key, f"key {key!r} in [{section}] contains whitespace"
            assert " " not in value, f"value {value!r} for {key} in [{section}] contains whitespace"


def test_snapshot_renders_unlimited_for_negative_stab_thresholds() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert snap["Stabilization"]["max-angle"] == "unlimited"
    assert snap["Stabilization"]["max-shift"] == "unlimited"


def test_snapshot_renders_numeric_stab_thresholds_with_units() -> None:
    mp, mps = _baseline_mp_mps()
    mps["videoStabilizationMaxAngle"] = 5
    mps["videoStabilizationMaxShift"] = 30
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert snap["Stabilization"]["max-angle"] == "5deg"
    assert snap["Stabilization"]["max-shift"] == "30px"


def test_snapshot_includes_fade_duration_only_when_loop_is_fade() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert "fade-duration" not in snap["Looping"]
    mps["loop"] = "fade"
    mps["fadeDuration"] = 0.25
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert snap["Looping"]["fade-duration"] == "0.25s"


def test_snapshot_omits_bitrate_factors_when_not_provided() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert "bitrate-factor" not in snap["Bitrate"]
    snap = build_marker_pair_settings_snapshot(
        mp, mps,
        marker_pair_index=0,
        bitrate_factor=1.5,
        bitrate_crop_factor=0.6,
        bitrate_fps_factor=2.0,
    )
    assert snap["Bitrate"]["bitrate-factor"] == "1.5"
    assert snap["Bitrate"]["crop-factor"] == "0.6"
    assert snap["Bitrate"]["fps-factor"] == "2"


def test_snapshot_rounds_long_floats_to_compact_repr() -> None:
    mp, mps = _baseline_mp_mps()
    mp["outputDuration"] = 10.054210666666668
    snap = build_marker_pair_settings_snapshot(
        mp, mps,
        marker_pair_index=0,
        bitrate_factor=0.14585783410972753,
    )
    assert snap["Output"]["duration"] == "10.05s"
    assert snap["Bitrate"]["bitrate-factor"] == "0.1459"


def test_render_table_one_line_per_section_with_aligned_section_column() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    out = render_settings_table(snap, title="Marker Pair 1 settings")
    assert out.startswith("Marker Pair 1 settings\n")
    body_lines = [line for line in out.splitlines()[1:] if line.strip()]
    # One line per non-empty section, all single-line.
    assert all(line.startswith("  [") for line in body_lines)
    # The body of each line begins at the same column (section header
    # padding aligns the key=value block across all sections).
    body_starts = {
        line.index("]") + 1 + len(line[line.index("]") + 1:]) - len(line[line.index("]") + 1:].lstrip())
        for line in body_lines
    }
    assert len(body_starts) == 1, f"misaligned section bodies: {body_starts}"
    # Encoding row contains every Encoding field as key=value pairs.
    encoding_line = next(line for line in body_lines if line.startswith("  [Encoding]"))
    for token in ("codec=vp9", "crf=30", "two-pass=false"):
        assert token in encoding_line
    # No box characters or other decoration that would noise up diffs.
    for forbidden in ("│", "─", "┌", "┐", "└", "┘"):
        assert forbidden not in out


def test_render_diff_returns_none_for_identical_snapshots() -> None:
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    assert render_settings_diff(snap, snap) is None


def test_render_diff_shows_only_changed_rows() -> None:
    mp, mps = _baseline_mp_mps()
    prior = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    mps["crf"] = 26
    current = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    diff = render_settings_diff(prior, current, title="Marker Pair 1 settings changed:")
    assert diff is not None
    assert "[Encoding]" in diff
    # The unchanged sections (Identity, Bitrate, ...) must not appear.
    assert "[Identity]" not in diff
    assert "[Stabilization]" not in diff
    # The unchanged keys in the changed section must not appear.
    assert "codec=" not in diff
    # The changed row must show `key: prior -> current` inline.
    assert "crf: 30 -> 26" in diff


def test_render_diff_handles_added_or_removed_keys() -> None:
    mp, mps = _baseline_mp_mps()
    prior = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    mps["loop"] = "fade"
    mps["fadeDuration"] = 0.5
    current = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    diff = render_settings_diff(prior, current)
    assert diff is not None
    assert "(unset) -> 0.5s" in diff
    assert "none -> fade" in diff


def test_render_diff_uses_kebab_case_keys() -> None:
    mp, mps = _baseline_mp_mps()
    prior = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    mps["videoStabilizationMaxAngle"] = 5
    current = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    diff = render_settings_diff(prior, current)
    assert diff is not None
    assert "max-angle:" in diff


def test_render_table_with_markup_emits_bold_header_and_dim_keys() -> None:
    import re as _re
    mp, mps = _baseline_mp_mps()
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    out = render_settings_table(snap, markup=True)
    # Section header wrapped in [bold]\[Encoding][/] — bracket escaped.
    assert "[bold]\\[Encoding][/]" in out
    # Each key is wrapped in [dim]<key>=[/] so the value pops.
    assert "[dim]codec=[/]vp9" in out
    # Visible alignment: strip markup tags + the bracket-escape, then
    # confirm the body of every section starts at the same column.
    def visible(line: str) -> str:
        line = _re.sub(r"\[(?:bold|dim|/)\]", "", line)
        return line.replace("\\[", "[")
    visible_lines = [visible(line) for line in out.splitlines() if "\\[" in line]
    body_starts = {
        line.index("]") + 1 + len(line[line.index("]") + 1:])
        - len(line[line.index("]") + 1:].lstrip())
        for line in visible_lines
    }
    assert len(body_starts) == 1, f"misaligned bodies: {body_starts}"


def test_render_diff_with_markup_dims_prior_value_only() -> None:
    """Only the prior (left) value renders dim. The key label and the
    current (right) value render at default brightness.

    Visual logic: the operator's primary anchor on each delta is the
    KEY (what changed), so it gets full brightness. The PRIOR value
    is context — what we moved FROM — so it's dimmed. The CURRENT
    value is the active state, gets full brightness.
    """
    mp, mps = _baseline_mp_mps()
    prior = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    mps["crf"] = 26
    current = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    diff = render_settings_diff(prior, current, markup=True)
    assert diff is not None
    # Section header still bold (existing).
    assert "[bold]\\[Encoding][/]" in diff
    # Key at default brightness (no [dim]); prior wrapped in [dim];
    # current at default brightness.
    assert "crf:" in diff
    assert "[dim]crf" not in diff  # key is NOT dim
    assert "[dim]30[/] -> 26" in diff  # prior IS dim, current is not


def test_escape_markup_keeps_literal_brackets_in_values() -> None:
    snap: SettingsSnapshot = {"Custom": {"weird": "[not-a-tag]"}}
    out = render_settings_table(snap, markup=True)
    # The value's literal `[` is escaped to `\[` so rich renders it
    # rather than parsing it as markup.
    assert "weird=[/]\\[not-a-tag]" in out


def test_emit_dispatches_full_then_diff_then_silent() -> None:
    mp, mps = _baseline_mp_mps()
    full_calls: list[str] = []
    diff_calls: list[str] = []

    snap_a = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_a,
        markup=False,
    )
    assert len(full_calls) == 1
    assert len(diff_calls) == 0
    assert "[Identity]" in full_calls[0]

    # Repeat with the same snapshot — should be silent.
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_a,
        markup=False,
    )
    assert len(full_calls) == 1
    assert len(diff_calls) == 0

    # Change one field — diff path fires.
    mps["crf"] = 26
    snap_b = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_b,
        markup=False,
    )
    assert len(full_calls) == 1
    assert len(diff_calls) == 1
    assert "30 -> 26" in diff_calls[0]


def test_auto_encode_snapshot_has_one_section_with_all_fields() -> None:
    snap = build_auto_encode_settings_snapshot(
        {"crf": 33, "autoTargetMaxBitrate": 14000, "twoPass": True, "encodeSpeed": 2},
        color_space="bt709",
    )
    assert list(snap.keys()) == ["Auto-determined"]
    fields = snap["Auto-determined"]
    assert fields["crf"] == "33"
    assert fields["auto-target-max"] == "14000kbps"
    assert fields["color-space"] == "bt709"
    assert fields["two-pass"] == "true"
    assert fields["encode-speed"] == "2"


def test_auto_encode_snapshot_falls_back_for_unknown_color_space() -> None:
    snap = build_auto_encode_settings_snapshot(
        {"crf": 33, "autoTargetMaxBitrate": 14000, "twoPass": False, "encodeSpeed": 2},
        color_space=None,
    )
    assert "unknown" in snap["Auto-determined"]["color-space"]


def test_global_snapshot_includes_detected_bitrate_and_rotate() -> None:
    settings: dict[str, Any] = {
        "videoCodec": "vp9", "crf": 33, "encodeSpeed": 2, "twoPass": True,
        "enableHDR": False, "rotate": "0", "bit_rate": 8500,
        "audio": True, "denoise": {"desc": "off"}, "enableSpeedMaps": True,
        "minterpFpsMultiplier": 1.0, "minterpMode": "MCI", "minterpTool": "ffmpeg",
        "loop": "none", "videoStabilization": {"desc": "off"},
        "videoStabilizationMaxAngle": -1, "videoStabilizationMaxShift": -1,
        "videoStabilizationDynamicZoom": False,
    }
    snap = build_global_settings_snapshot(
        settings,
        minterp_fps=60,
        target_max_bitrate_text="14000kbps",
    )
    # Identity / Output sections from the per-pair snapshot are NOT present
    # at the global level — they're per-pair.
    assert "Identity" not in snap
    assert "Output" not in snap
    # Detected bitrate and rotate are global-only.
    assert snap["Bitrate"]["detected"] == "8500kbps"
    assert snap["Bitrate"]["target-max"] == "14000kbps"
    assert snap["Encoding"]["rotate"] == "0"


def test_emit_markup_path_passes_null_highlighter_extra() -> None:
    """When ``markup=True`` (the production default), emit must route
    through ``log_settings_dump`` so the auto-highlighter is disabled
    for this record only — without affecting other log lines."""
    from rich.highlighter import NullHighlighter

    mp, mps = _baseline_mp_mps()
    captured: list[tuple[str, dict]] = []

    def fake_logger_info(msg: str, **kwargs: object) -> None:
        captured.append((msg, kwargs))

    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=fake_logger_info,
        log_diff=fake_logger_info,
        marker_pair_index=0,
        snapshot=snap,
        markup=True,
    )
    assert len(captured) == 1
    msg, kwargs = captured[0]
    assert "[bold]\\[Identity][/]" in msg
    extra = kwargs.get("extra", {})
    assert isinstance(extra.get("highlighter"), NullHighlighter)


def test_emit_separate_pair_indices_have_independent_memos() -> None:
    mp, mps = _baseline_mp_mps()
    full_calls: list[str] = []
    diff_calls: list[str] = []
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap,
        markup=False,
    )
    snap = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=1)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=1,
        snapshot=snap,
        markup=False,
    )
    # Both pairs printed their first-time full table; neither went silent.
    assert len(full_calls) == 2
    assert len(diff_calls) == 0


def test_emit_search_context_retitles_diff_and_skips_memo_anchor() -> None:
    """CRF-search trial / reference / baseline calls (``is_search_context=True``)
    must (a) frame the diff as "CRF search using overrides:" — NOT
    "settings changed:" — and (b) leave the memo pinned to the user's
    original snapshot so the post-search final-encode diff fires against
    THAT, not the last trial's snapshot."""
    mp, mps = _baseline_mp_mps()
    full_calls: list[str] = []
    diff_calls: list[str] = []

    # 1. Operator's original pair settings (crf=18) — non-search context
    # anchors memo. This mirrors the orchestrator's pre-emit call before
    # the CRF search begins, which logs the operator's baseline so trial
    # encodes can diff against it.
    mps["crf"] = 18
    snap_orig = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_orig,
        markup=False,
    )
    assert len(full_calls) == 1
    assert len(diff_calls) == 0

    # 2. First CRF-search trial (crf=30) — search context. Diff fires
    # against the original; title must NOT say "settings changed".
    mps["crf"] = 30
    snap_trial1 = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_trial1,
        markup=False,
        is_search_context=True,
    )
    assert len(diff_calls) == 1
    assert "CRF search using overrides" in diff_calls[0]
    assert "settings changed" not in diff_calls[0]
    assert "18 -> 30" in diff_calls[0]
    # Search-context diff is compact: single line, no section headers
    # like ``[Encoding]`` / ``[Bitrate]``. Verifies the operator sees
    # ``... overrides: crf: 18 -> 30  target-max: 0 -> 14209kbps ...``
    # instead of a multi-line block.
    assert "\n" not in diff_calls[0]
    assert "[Encoding]" not in diff_calls[0]
    assert "[Bitrate]" not in diff_calls[0]

    # 3. Second CRF-search trial (crf=27). The memo is STILL pinned to
    # the original snap_orig (search-context calls don't bump the memo),
    # so the diff is 18 -> 27 (against the original) — NOT 30 -> 27
    # (which would mean the memo had been bumped to trial1).
    mps["crf"] = 27
    snap_trial2 = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_trial2,
        markup=False,
        is_search_context=True,
    )
    assert len(diff_calls) == 2
    assert "18 -> 27" in diff_calls[1]
    assert "30 -> 27" not in diff_calls[1]

    # 4. Post-search final encode (search picked crf=25) — non-search
    # context. Diff fires against the original (18 -> 25), proving the
    # trials didn't pollute the memo.
    mps["crf"] = 25
    snap_final = build_marker_pair_settings_snapshot(mp, mps, marker_pair_index=0)
    emit_marker_pair_settings_log(
        log_full=full_calls.append,
        log_diff=diff_calls.append,
        marker_pair_index=0,
        snapshot=snap_final,
        markup=False,
    )
    assert len(diff_calls) == 3
    assert "settings changed" in diff_calls[2]
    assert "18 -> 25" in diff_calls[2]
