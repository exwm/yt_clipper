"""Compute and render the auto-delta block for the aggregate summary.

Phase 3's user-facing payoff. After Phase 2 starts accumulating
per-fingerprint history on disk, this module reads those prior runs
back and produces a structured comparison: for each distinct prior
encoder configuration on a given clip, what was the predicted
bitrate to hit the *current* run's target VMAF, and how does it
compare to the current run?

Two design decisions worth flagging:

- **Re-interpolate, don't trust the saved value.** Each prior run's
  JSONL stores ``kbps_at_target_vmaf`` from when *that* run wrote
  it — at *that* run's target. If the user changed
  ``--target-vmaf-low`` since, the saved value is comparing apples
  and oranges. We reach back into the prior run's probe data and
  re-interpolate at the current target to keep the comparison
  apples-to-apples.

- **Diff label, not full label.** The prior-run row's label shows
  only the encoder settings that *differ* from the current run.
  Two runs that share aq-mode but differ on tile-rows show
  ``tile-rows=2`` (the prior value) — terse, easy to scan, gives
  a git-diff-like read of what the user changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .history import PriorRun


@dataclass(frozen=True)
class PriorRunDelta:
    """One row in the auto-delta block.

    ``is_current=True`` rows represent the just-completed run and
    have no deltas (rendered as ``—``); ``is_current=False`` rows
    are prior configurations with computed deltas vs. the current
    row.
    """

    config_label: str
    kbps_at_target: float | None
    delta_kbps_pct: float | None
    picked_crf: int | None
    delta_picked_crf: int | None
    is_current: bool


def compute_prior_run_deltas(
    *,
    prior_runs: list[PriorRun],
    current_encoder_config: dict[str, Any],
    current_kbps_at_target: float | None,
    current_picked_crf: int | None,
    current_target_vmaf_low: float,
) -> list[PriorRunDelta]:
    """Build the delta rows for one clip.

    Returns one row for the current run (``is_current=True``,
    no deltas) followed by one row per prior fingerprint (sorted
    by recency, most recent first — preserving caller-provided
    order). Each prior row's ``kbps_at_target`` is re-interpolated
    on the prior run's own probe data at the *current* target
    VMAF, so cross-target user changes don't poison the comparison.

    Both the current row and the prior rows label themselves with
    the keys that differ across the comparison set. The current row
    shows the union of "any-prior-differs" keys with the current
    run's values; each prior row shows only the keys it differs on
    with its own (prior) values. Reads side-by-side as a git-diff:
    the current row defines the baseline, prior rows show what
    changed.
    """
    union_diff_keys = _union_diff_keys(
        current_encoder_config,
        [prior.encoder_config for prior in prior_runs],
    )
    rows: list[PriorRunDelta] = [
        PriorRunDelta(
            config_label=_format_label_for_keys(
                current_encoder_config, union_diff_keys,
            ),
            kbps_at_target=current_kbps_at_target,
            delta_kbps_pct=None,
            picked_crf=current_picked_crf,
            delta_picked_crf=None,
            is_current=True,
        ),
    ]
    for prior in prior_runs:
        prior_kbps = _interpolate_kbps_from_probes(
            prior.probes, current_target_vmaf_low,
        )
        delta_kbps_pct: float | None = None
        if (
            current_kbps_at_target is not None
            and prior_kbps is not None
            and prior_kbps > 0
        ):
            delta_kbps_pct = (
                (current_kbps_at_target - prior_kbps) / prior_kbps * 100.0
            )
        delta_picked_crf: int | None = None
        if current_picked_crf is not None and prior.optimal_crf is not None:
            delta_picked_crf = current_picked_crf - prior.optimal_crf
        rows.append(
            PriorRunDelta(
                config_label=_format_diff_label(
                    current=current_encoder_config,
                    prior=prior.encoder_config,
                ),
                kbps_at_target=prior_kbps,
                delta_kbps_pct=delta_kbps_pct,
                picked_crf=prior.optimal_crf,
                delta_picked_crf=delta_picked_crf,
                is_current=False,
            ),
        )
    return rows


def _union_diff_keys(
    current: dict[str, Any],
    priors: list[dict[str, Any]],
) -> set[str]:
    """Return the set of keys that differ between ``current`` and any
    prior in ``priors``. ``None`` values in priors are skipped (treating
    absent ≡ None) so a settings field that wasn't recorded in an older
    run doesn't pollute the diff."""
    diff_keys: set[str] = set()
    for prior in priors:
        for key in set(current.keys()) | set(prior.keys()):
            cv = current.get(key)
            pv = prior.get(key)
            if cv == pv:
                continue
            if pv is None:
                continue
            diff_keys.add(key)
    return diff_keys


def _format_label_for_keys(
    config: dict[str, Any], keys: set[str],
) -> str:
    """Render ``key=value`` pairs (alphabetical) for the given keys
    against ``config``. Used for the current row's label so it
    surfaces the same dimensions the prior rows differ on."""
    parts = [
        f"{key}={config[key]}"
        for key in sorted(keys)
        if key in config and config[key] is not None
    ]
    if not parts:
        return "(current)"
    return " ".join(parts)


def _interpolate_kbps_from_probes(
    probes: list[tuple[int, float, float]],
    target_p_low: float,
) -> float | None:
    """Piecewise-linear bitrate interpolation at the CRF where
    ``p_low == target_p_low``. Probes are pre-sorted by CRF.

    VMAF decreases monotonically with CRF, so a target bracket is a
    consecutive pair of probes whose ``(p_low - target)`` values have
    opposite signs (or either equals zero). Returns ``None`` if no
    such bracket exists — the prior run's probe range doesn't reach
    the current target, and the comparison metric is undefined.
    """
    if len(probes) < 2:
        return None
    for i in range(len(probes) - 1):
        _, vmaf_a, kbps_a = probes[i]
        _, vmaf_b, kbps_b = probes[i + 1]
        if (vmaf_a - target_p_low) * (vmaf_b - target_p_low) <= 0:
            if vmaf_a == vmaf_b:
                return kbps_a
            t_frac = (vmaf_a - target_p_low) / (vmaf_a - vmaf_b)
            return kbps_a + t_frac * (kbps_b - kbps_a)
    return None


def _format_diff_label(
    *,
    current: dict[str, Any],
    prior: dict[str, Any],
) -> str:
    """Render a prior config's diff label: the keys whose prior value
    differs from current, formatted as ``key=value`` of the prior.

    Example: current is ``{aq_mode: 0, tile_rows: 0, codec: vp9}``,
    prior is ``{aq_mode: 4, tile_rows: 2, codec: vp9}`` → ``aq_mode=4
    tile_rows=2``. ``codec`` is omitted because it matches.

    Keys present in only one dict are also flagged. ``None`` values
    are skipped (treating absent ≡ None) so a settings field that
    wasn't recorded in an older run doesn't pollute the diff.
    """
    diffs: list[str] = []
    for key in sorted(set(current.keys()) | set(prior.keys())):
        cv = current.get(key)
        pv = prior.get(key)
        if cv == pv:
            continue
        if pv is None:
            continue  # prior didn't track this field; absence isn't a diff
        diffs.append(f"{key}={pv}")
    if not diffs:
        return "(no diff)"
    return " ".join(diffs)


def format_prior_run_deltas_block(
    rows_per_clip: list[tuple[str, list[PriorRunDelta]]],
    target_vmaf_low: float,
) -> str:
    """Render the auto-delta section as a single multi-line string.

    ``rows_per_clip`` is a list of ``(clip_label, rows)`` pairs. Each
    ``rows`` list typically starts with the current-run row and is
    followed by prior-run rows. Clips with no prior runs (i.e.
    only the current row) are skipped — there's nothing to compare.

    Returns the empty string if no clip has any priors.
    """
    from rich import box
    from rich.table import Table

    from clipper.log_helpers import render_rich_table_to_text

    visible: list[tuple[str, list[PriorRunDelta]]] = [
        (label, rows)
        for label, rows in rows_per_clip
        if any(not row.is_current for row in rows)
    ]
    if not visible:
        return ""
    header = (
        f"prior-run deltas (* = current run, kbps@tgt = "
        f"interpolated bitrate at p_low={target_vmaf_low}):"
    )
    table = Table(
        box=box.SIMPLE_HEAD,
        show_edge=False,
        pad_edge=False,
        padding=(0, 1),
        collapse_padding=True,
    )
    table.add_column("pair", justify="left")
    table.add_column("config", justify="left", no_wrap=True)
    table.add_column("kbps@tgt", justify="right")
    table.add_column("Δ kbps", justify="right")
    table.add_column("crf", justify="right")
    table.add_column("Δ crf", justify="right")
    for clip_label, rows in visible:
        for row in rows:
            kbps = (
                f"{row.kbps_at_target:.0f}"
                if row.kbps_at_target is not None
                else "-"
            )
            d_kbps = (
                f"{row.delta_kbps_pct:+.1f}%"
                if row.delta_kbps_pct is not None
                else ("—" if row.is_current else "-")
            )
            crf_str = (
                str(row.picked_crf) if row.picked_crf is not None else "-"
            )
            d_crf = (
                f"{row.delta_picked_crf:+d}"
                if row.delta_picked_crf is not None
                else ("—" if row.is_current else "-")
            )
            label_marker = "*" if row.is_current else " "
            label = f"{label_marker} {row.config_label}"
            table.add_row(clip_label, label, kbps, d_kbps, crf_str, d_crf)
    return "\n".join([header, "", render_rich_table_to_text(table, width=140)])
