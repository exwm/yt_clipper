"""Marker-pair settings dump, formatted for diffability and quiet
re-runs.

The legacy dump squashed ~30 fields onto a single ~600-character
line. Two problems:

- **Not diffable.** A single-field change (``aq-mode 0 → 2``) shows
  up as a full-line diff between two run logs, drowning the actual
  change in noise.
- **Repeats during CRF search.** ``getMarkerPairSettings`` runs once
  per trial encode; settings don't change between trials, so the
  same dump fires N times per pair.

This module fixes both:

1. Renders settings as section-grouped, column-aligned ``key:
   value`` lines. Plain text, no box characters — line-level diff
   tools (``diff``, eyeball) operate cleanly.
2. Memoizes the last-printed snapshot per marker pair (process-
   local). Subsequent calls with an identical snapshot emit nothing
   (silent no-change happy path); calls with a changed snapshot
   emit only the changed-row diff.
"""

from __future__ import annotations

from typing import Any, Callable, Mapping

from rich.highlighter import NullHighlighter

# section name -> {key: stringified value}. Sections render in
# insertion order; within a section, keys also render in insertion
# order. Building the snapshot is the single source of truth for
# rendering order — change the snapshot order to change the log
# order.
SettingsSnapshot = dict[str, dict[str, str]]


# In-process memo: marker_pair_index -> last-printed snapshot. Lets
# subsequent calls skip emitting an identical dump (the CRF-search
# trial-encode noise reduction win).
_LAST_PRINTED: dict[int, SettingsSnapshot] = {}


def reset_settings_log_memo() -> None:
    """Clear the in-process snapshot memo. Test-only helper — production
    code never re-runs the same pair from scratch within one process."""
    _LAST_PRINTED.clear()


def log_settings_dump(log_method: Callable[..., None], msg: str) -> None:
    """Log ``msg`` with rich's repr-highlighter disabled FOR THIS
    MESSAGE ONLY.

    Settings dumps already use explicit markup (bold section headers,
    dim keys) for hierarchy; the auto-highlighter would re-tint
    numbers / booleans / identifier-like words on top, breaking the
    consistent look. ``record.highlighter`` (rich-handler convention)
    overrides the handler's default per-record, so other log lines
    keep their normal highlight behavior.

    The caller passes a bound logger method
    (e.g. ``logger.info`` / ``logger.notice``); we forward via
    ``extra=`` which the YTCLogger merges with its own
    ``extra["markup"] = True``. A fresh dict per call avoids
    mutating any shared state.
    """
    log_method(msg, extra={"highlighter": NullHighlighter()})


def _format_bool(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _format_number(value: object) -> str:
    """Format numbers compactly for log dumps.

    Floats: ``%.4g`` so values like ``0.14585783410972753`` render as
    ``0.1459`` (4 significant figures, scientific notation only when
    necessary). Trailing zeros are dropped so ``45.0`` → ``45``,
    ``1.0`` → ``1``. Integers and non-numeric values pass through
    unchanged.
    """
    if isinstance(value, bool):
        return _format_bool(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def _format_optional_unlimited(value: object, unit: str) -> str:
    """Render either ``unlimited`` (when the underlying field is < 0)
    or ``<rounded><unit>`` (no space — kept whitespace-free so the
    value is one shell-safe token)."""
    try:
        numeric = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)
    if numeric < 0:
        return "unlimited"
    return f"{_format_number(value)}{unit}"


def build_marker_pair_settings_snapshot(
    mp: Mapping[str, Any],
    mps: Mapping[str, Any],
    *,
    marker_pair_index: int,
    bitrate_factor: float | int | None = None,
    bitrate_crop_factor: float | int | None = None,
    bitrate_fps_factor: float | int | None = None,
) -> SettingsSnapshot:
    """Capture a stringified, section-grouped snapshot of marker-pair
    settings.

    Section / key order here IS the rendering order. Three locally-
    derived bitrate factors are passed in by the caller because they
    aren't on ``mp`` / ``mps``; everything else is read from there.
    Optional fields that aren't applicable (e.g. ``fadeDuration`` when
    ``loop != "fade"``, max-angle on a stab mode that doesn't use it)
    are simply omitted — keeping them out of the snapshot keeps them
    out of the diff.
    """
    snapshot: SettingsSnapshot = {}

    title_prefix = mps.get("titlePrefix", "")
    snapshot["Identity"] = {
        "title-prefix": str(title_prefix) if title_prefix else "(none)",
        "pair": str(marker_pair_index + 1),
        "variable-speed": _format_bool(mp.get("isVariableSpeed", False)),
    }

    snapshot["Encoding"] = {
        "codec": str(mps.get("videoCodec", "")),
        "crf": _format_number(mps.get("crf", "")),
        "encode-speed": _format_number(mps.get("encodeSpeed", "")),
        "two-pass": _format_bool(mps.get("twoPass", False)),
        "hdr": _format_bool(mps.get("enableHDR", False)),
    }

    bitrate: dict[str, str] = {
        "detected": f"{_format_number(mps.get('bit_rate', ''))}kbps",
        "target-max": f"{_format_number(mps.get('targetMaxBitrate', ''))}kbps",
        "auto-target-max": f"{_format_number(mps.get('autoTargetMaxBitrate', ''))}kbps",
    }
    if bitrate_factor is not None:
        bitrate["bitrate-factor"] = _format_number(bitrate_factor)
    if bitrate_crop_factor is not None:
        bitrate["crop-factor"] = _format_number(bitrate_crop_factor)
    if bitrate_fps_factor is not None:
        bitrate["fps-factor"] = _format_number(bitrate_fps_factor)
    snapshot["Bitrate"] = bitrate

    denoise_desc = ""
    denoise = mps.get("denoise")
    if isinstance(denoise, Mapping):
        denoise_desc = str(denoise.get("desc", ""))
    snapshot["Audio"] = {
        "audio": _format_bool(mps.get("audio", False)),
        "denoise": denoise_desc or "(none)",
    }

    snapshot["Speed"] = {
        "speed-maps": _format_bool(mps.get("enableSpeedMaps", False)),
    }

    minterp: dict[str, str] = {
        "fps-mult": _format_number(mps.get("minterpFpsMultiplier", "")),
        "mode": str(mps.get("minterpMode", "")),
        "tool": str(mps.get("minterpTool", "")),
        "target-fps": _format_number(mps.get("minterpFPS", "")),
    }
    snapshot["Motion-interp"] = minterp

    looping: dict[str, str] = {"mode": str(mps.get("loop", "none"))}
    if mps.get("loop") == "fade":
        looping["fade-duration"] = f"{_format_number(mps.get('fadeDuration', ''))}s"
    snapshot["Looping"] = looping

    stab_desc = ""
    stab = mps.get("videoStabilization")
    if isinstance(stab, Mapping):
        stab_desc = str(stab.get("desc", ""))
    snapshot["Stabilization"] = {
        "mode": stab_desc or "(none)",
        "max-angle": _format_optional_unlimited(
            mps.get("videoStabilizationMaxAngle", -1),
            "deg",
        ),
        "max-shift": _format_optional_unlimited(
            mps.get("videoStabilizationMaxShift", -1),
            "px",
        ),
        "dyn-zoom": _format_bool(mps.get("videoStabilizationDynamicZoom", False)),
    }

    snapshot["Output"] = {
        "duration": f"{_format_number(mp.get('outputDuration', ''))}s",
    }

    return snapshot


def build_auto_encode_settings_snapshot(
    encode_settings: Mapping[str, Any],
    *,
    color_space: str | None,
) -> SettingsSnapshot:
    """Snapshot of the auto-derived encoder defaults from
    ``getDefaultEncodeSettings``: the small set of values the clipper
    chooses based on detected bitrate alone, before any user override
    is layered on. Tiny — one section is enough."""
    color_space_text = color_space or (
        "unknown (bt709 will be assumed for color range operations)"
    )
    return {
        "Auto-determined": {
            "crf": _format_number(encode_settings.get("crf", "")),
            "auto-target-max": f"{_format_number(encode_settings.get('autoTargetMaxBitrate', ''))}kbps",
            "color-space": color_space_text,
            "two-pass": _format_bool(encode_settings.get("twoPass", False)),
            "encode-speed": _format_number(encode_settings.get("encodeSpeed", "")),
        },
    }


def build_global_settings_snapshot(
    settings: Mapping[str, Any],
    *,
    minterp_fps: object,
    target_max_bitrate_text: str,
) -> SettingsSnapshot:
    """Snapshot of the resolved global encoder configuration that
    applies to every marker pair unless the pair overrides it.

    Mirrors the per-pair snapshot's section layout where applicable
    so the operator can scan a global block + a per-pair block and
    quickly see "what did this pair override". A few fields belong
    only here (detected bitrate, rotate) and only at the global level
    is there a pre-resolution distinction between detected vs target
    bitrate. ``minterp_fps`` and ``target_max_bitrate_text`` are
    pre-computed by the caller because they require helpers
    (``getMinterpFPS`` / fallback "Auto" string) that aren't
    appropriate to inline here.
    """
    snapshot: SettingsSnapshot = {}

    snapshot["Encoding"] = {
        "codec": str(settings.get("videoCodec", "")),
        "crf": _format_number(settings.get("crf", "")),
        "encode-speed": _format_number(settings.get("encodeSpeed", "")),
        "two-pass": _format_bool(settings.get("twoPass", False)),
        "hdr": _format_bool(settings.get("enableHDR", False)),
        "rotate": str(settings.get("rotate", "")),
    }

    snapshot["Bitrate"] = {
        "detected": f"{_format_number(settings.get('bit_rate', ''))}kbps",
        "target-max": str(target_max_bitrate_text),
    }

    denoise_desc = ""
    denoise = settings.get("denoise")
    if isinstance(denoise, Mapping):
        denoise_desc = str(denoise.get("desc", ""))
    snapshot["Audio"] = {
        "audio": _format_bool(settings.get("audio", False)),
        "denoise": denoise_desc or "(none)",
    }

    snapshot["Speed"] = {
        "speed-maps": _format_bool(settings.get("enableSpeedMaps", False)),
    }

    snapshot["Motion-interp"] = {
        "fps-mult": _format_number(settings.get("minterpFpsMultiplier", "")),
        "mode": str(settings.get("minterpMode", "")),
        "tool": str(settings.get("minterpTool", "")),
        "target-fps": _format_number(minterp_fps),
    }

    looping: dict[str, str] = {"mode": str(settings.get("loop", "none"))}
    if settings.get("loop") == "fade":
        looping["fade-duration"] = f"{_format_number(settings.get('fadeDuration', ''))}s"
    snapshot["Looping"] = looping

    stab_desc = ""
    stab = settings.get("videoStabilization")
    if isinstance(stab, Mapping):
        stab_desc = str(stab.get("desc", ""))
    snapshot["Stabilization"] = {
        "mode": stab_desc or "(none)",
        "max-angle": _format_optional_unlimited(
            settings.get("videoStabilizationMaxAngle", -1),
            "deg",
        ),
        "max-shift": _format_optional_unlimited(
            settings.get("videoStabilizationMaxShift", -1),
            "px",
        ),
        "dyn-zoom": _format_bool(settings.get("videoStabilizationDynamicZoom", False)),
    }

    return snapshot


def render_settings_table(
    snapshot: SettingsSnapshot,
    *,
    title: str | None = None,
    markup: bool = False,
) -> str:
    """Render the snapshot one line per section: ``[Section]  k=v  k=v
    ...``.

    Section headers are right-padded to the longest section name so
    each section's fields begin at the same column — quick scanning
    by section. Two-space gap between key=value pairs to keep them
    visually grouped.

    With ``markup=False`` the output is plain text — no rich markup,
    no ANSI codes — so it diffs cleanly and reads identically in the
    on-disk log. With ``markup=True`` section headers render bold
    and keys render dim (rich markup tags), giving the live console
    a three-level visual hierarchy (section / key / value) without
    re-tinting each value-token. Padding is computed from the
    *visible* (un-styled) header length so columns still line up.
    """
    rendered_sections: list[tuple[str, str, str]] = []
    for section_name, fields in snapshot.items():
        if not fields:
            continue
        body_parts: list[str] = []
        for key, value in fields.items():
            if markup:
                body_parts.append(
                    f"[dim]{_escape_markup(key)}=[/]{_escape_markup(value)}",
                )
            else:
                body_parts.append(f"{key}={value}")
        body = "  ".join(body_parts)
        plain_header = f"[{section_name}]"
        styled_header = (
            f"[bold]\\[{_escape_markup(section_name)}][/]"
            if markup else plain_header
        )
        rendered_sections.append((plain_header, styled_header, body))
    if not rendered_sections:
        return title or ""
    section_width = max(len(plain) for plain, _, _ in rendered_sections)
    lines: list[str] = []
    if title:
        lines.append(title)
    for plain_header, styled_header, body in rendered_sections:
        # Pad based on the visible width (plain_header) so the column
        # aligns regardless of how many invisible markup chars the
        # styled header carries.
        visible_padding = " " * (section_width - len(plain_header))
        lines.append(f"  {styled_header}{visible_padding}  {body}")
    return "\n".join(lines)


def _escape_markup(text: str) -> str:
    """Escape ``[`` so rich treats it as a literal in markup mode.

    Section names and snapshot values are operator-supplied data, not
    markup — escape any ``[`` they contain so rich doesn't try to
    parse them as style tags.
    """
    return text.replace("[", "\\[")


def render_settings_diff(
    prior: SettingsSnapshot,
    current: SettingsSnapshot,
    *,
    title: str | None = None,
    markup: bool = False,
    compact: bool = False,
) -> str | None:
    """Render only the rows that differ between two snapshots.

    Returns ``None`` when the snapshots are identical so the caller
    can skip the log call entirely (the silent no-change happy path).
    Diff format mirrors ``render_settings_table`` for readability;
    each changed row prints as ``    key: prior → current``. A row
    that exists in only one snapshot is shown with ``(unset)`` for
    the missing side.

    ``compact=True`` flattens every changed key/value across all
    sections into ONE line with two-space separators, with no section
    headers — right for CRF-search trial diffs where the multi-line
    block repeats 20+ times per search and dominates the log. The
    section grouping is preserved by the iteration order so related
    keys stay adjacent.
    """
    sections = list(dict.fromkeys([*prior.keys(), *current.keys()]))
    diff_sections: list[tuple[str, list[tuple[str, str, str]]]] = []
    for section in sections:
        prior_fields = prior.get(section, {})
        current_fields = current.get(section, {})
        keys = list(dict.fromkeys([*prior_fields.keys(), *current_fields.keys()]))
        changed: list[tuple[str, str, str]] = []
        for key in keys:
            prior_value = prior_fields.get(key, "(unset)")
            current_value = current_fields.get(key, "(unset)")
            if prior_value != current_value:
                changed.append((key, prior_value, current_value))
        if changed:
            diff_sections.append((section, changed))
    if not diff_sections:
        return None

    if compact:
        # All key/value pairs on a single line, no section headers,
        # ordered by section traversal so adjacent keys stay grouped.
        if markup:
            # ``key:`` renders at default brightness as the operator's
            # primary anchor on each delta. The prior (left) value is
            # dimmed to signal "what we're moving FROM" — visual
            # weight goes to the current (right) value, which is the
            # actually-active state.
            items = [
                f"{_escape_markup(key)}: "
                f"[dim]{_escape_markup(prior_value)}[/] -> "
                f"{_escape_markup(current_value)}"
                for _, changed in diff_sections
                for key, prior_value, current_value in changed
            ]
        else:
            items = [
                f"{key}: {prior_value} -> {current_value}"
                for _, changed in diff_sections
                for key, prior_value, current_value in changed
            ]
        body = "  ".join(items)
        return f"{title} {body}" if title else body

    section_width = max(len(f"[{name}]") for name, _ in diff_sections)
    lines: list[str] = []
    if title:
        lines.append(title)
    for section, changed in diff_sections:
        plain_header = f"[{section}]"
        if markup:
            styled_header = f"[bold]\\[{_escape_markup(section)}][/]"
            # See the compact branch above for the styling rationale:
            # key at default brightness, prior value dim, current
            # value at default brightness. Visual weight on the new
            # state; prior is contextual.
            body_parts = [
                f"{_escape_markup(key)}: "
                f"[dim]{_escape_markup(prior_value)}[/] -> "
                f"{_escape_markup(current_value)}"
                for key, prior_value, current_value in changed
            ]
        else:
            styled_header = plain_header
            body_parts = [
                f"{key}: {prior_value} -> {current_value}"
                for key, prior_value, current_value in changed
            ]
        body = "  ".join(body_parts)
        visible_padding = " " * (section_width - len(plain_header))
        lines.append(f"  {styled_header}{visible_padding}  {body}")
    return "\n".join(lines)


def emit_marker_pair_settings_log(
    *,
    log_full: Callable[..., None],
    log_diff: Callable[..., None],
    marker_pair_index: int,
    snapshot: SettingsSnapshot,
    markup: bool = True,
    is_search_context: bool = False,
) -> None:
    """Emit the right log line for this snapshot, deduping repeats.

    Behavior:

    - First call for a marker pair (no prior memo): renders the full
      table and dispatches to ``log_full(message)``.
    - Subsequent call with an unchanged snapshot: emits nothing. This
      is the trial-encode noise-reduction win — CRF search invokes
      ``getMarkerPairSettings`` per trial; only the first trial
      prints.
    - Subsequent call with a changed snapshot: renders the diff
      against the memoized prior and dispatches to ``log_diff(message)``.

    ``is_search_context=True`` reframes the diff for CRF-search
    trial / reference / baseline encodes:

    - Title becomes ``"Marker Pair N CRF search using overrides:"``
      instead of the generic ``"settings changed:"`` — operators were
      reading the generic wording as "my pair settings were modified"
      when in fact the search was just probing alternative encoder
      settings, with the user's pair config untouched.
    - The memo is NOT updated, so the post-search final-encode dispatch
      still diffs against the operator's ORIGINAL configured snapshot
      (showing e.g. ``crf 18 -> 30`` for the search-picked value) —
      the one diff that's actually meaningful. Without this guard, the
      memo would track the most-recent trial's snapshot and the post-
      search diff would compare picked-crf-vs-last-trial-crf, which is
      noise.

    The two callbacks let the caller pick log levels: the full table
    is typically INFO, the diff is typically NOTICE (changes are more
    surprising and worth surfacing higher). ``markup`` defaults to
    True — the live RichHandler interprets rich markup, so the
    section / key / value visual hierarchy renders. Pass False from
    contexts that want literal plain text (tests, captured-string
    diffing).
    """
    title_full = f"Marker Pair {marker_pair_index + 1} settings"
    title_diff = (
        f"Marker Pair {marker_pair_index + 1} CRF search using overrides:"
        if is_search_context
        else f"Marker Pair {marker_pair_index + 1} settings changed:"
    )
    prior = _LAST_PRINTED.get(marker_pair_index)
    if prior is None:
        msg = render_settings_table(snapshot, title=title_full, markup=markup)
        if markup:
            log_settings_dump(log_full, msg)
        else:
            log_full(msg)
        # Don't anchor the memo on a trial-context snapshot — see the
        # ``is_search_context`` rationale in the docstring. The memo
        # for a brand-new pair stays empty so the first NON-trial call
        # logs the full table; trial-context first-call is a one-off
        # information dump that doesn't form the diff baseline.
        if not is_search_context:
            _LAST_PRINTED[marker_pair_index] = snapshot
        return
    # Search-context diffs render compact (single line, no section
    # headers) — the same key/value deltas repeat across every trial
    # and the multi-line block stacked 20+ times per search dominates
    # the log. Compact form keeps the operator-visible info while
    # staying scannable.
    diff_block = render_settings_diff(
        prior, snapshot,
        title=title_diff,
        markup=markup,
        compact=is_search_context,
    )
    if diff_block is None:
        return
    if markup:
        log_settings_dump(log_diff, diff_block)
    else:
        log_diff(diff_block)
    if not is_search_context:
        _LAST_PRINTED[marker_pair_index] = snapshot
