"""Per-marker-pair sample-guided encode orchestrator + encoder integration.

The user-facing entry point is :func:`run_sample_guided_encode_for_marker_pair`,
called by ``clip_maker.makeClips`` when ``--sample-guided-encode`` is set.
This module is the only one that knows about ``ClipperState``,
``makeClip``, and the marker-pair settings dict — the algorithm and
predicate modules stay free of those couplings.

Three layers:

1. **Reference + trial encoding** — :func:`_encode_windows_for_marker_pair`
   wraps repeated ``makeClip`` calls (one per sample window) with
   snapshot/restore around the non-idempotent ``getMarkerPairSettings``,
   plus settings overrides to disable minterp/v2x for trials. Trial
   files land in a temp subdirectory; the final encode at the chosen
   CRF goes to the user's clip output folder.

2. **Per-clip search loop** — :func:`run_sample_guided_encode_for_marker_pair`
   resolves targets from the settings dict, builds the per-(crf,
   window) measurement cache, drives :func:`find_optimal_crf_two_phase`
   with the right evaluator + on-trial-complete log callback, and
   does the final user-visible encode at the chosen CRF. Cross-pair
   learning is a settings-dict side channel: each successful search
   stashes its optimal CRF into the settings so the next pair seeds
   ``crf_max`` from it.

3. **Aggregate summary** — :class:`ClipSearchSummary` +
   :func:`format_aggregated_search_summary_log_block` render the
   per-clip results as a table at the bottom of the summary report.
   Only :func:`run_sample_guided_encode_for_marker_pair` produces the
   ``ClipSearchSummary`` instances; ``clip_maker`` collects them
   across pairs and calls the formatter once at the end.
"""

from __future__ import annotations

import copy
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable

from clipper.clipper_types import ClipperState
from clipper.ffmpeg_codec import getFfmpegVideoCodecArgs
from clipper.log_helpers import (
    LogPath,
    track_sample_guided_encode_progress,
)
from clipper.quality import (
    VmafSummary,
    measure_per_frame_vmaf_neg,
    summarize_vmaf,
)
from clipper.version import __version__ as YT_CLIPPER_VERSION
from clipper.ytc_logger import Subsystem, make_subsystem_logger

from .curve_fit import (
    ALGORITHM_VERSION,
    CurveFitSearchResult,
    find_crf_via_curve_fit,
    fit_curves,
    render_curve_ascii,
)
from .predicates import is_trial_confidently_decided
from .run_cache import (
    PriorRunDelta,
    check_encode_meta_sidecar,
    cleanup_orphaned_trial_files,
    compute_encoder_fingerprint,
    compute_prior_run_deltas,
    compute_search_fingerprint,
    evaluate_cache_reuse,
    format_prior_run_deltas_block,
    load_prior_runs,
    prime_trial_measurement_cache,
    reconstruct_result_from_jsonl,
    write_config_sidecar,
    write_encode_meta_sidecar,
)
from .search import (
    legacy_find_optimal_crf_two_phase,
    select_sample_windows,
)
from .types import (
    _REFERENCE_CRF_BY_CODEC,
    _REFERENCE_CRF_FALLBACK,
    DEFAULT_LOW_PERCENTILE,
    DEFAULT_TARGET_VMAF_MEAN,
    REFERENCE_SUFFIX_TEMPLATE,
    SUPPORTED_LOW_PERCENTILES,
    TRIAL_SUFFIX_TEMPLATE,
    SampleGuidedEncodeResult,
    SampleGuidedEncodeTarget,
    SampleGuidedEncodeTrial,
    SampleWindow,
    TrialMeasurement,
    default_low_threshold_for_percentile,
    get_low_percentile_value,
    min_frames_for_low_percentile,
)

logger = make_subsystem_logger(Subsystem.SAMPLE_ENCODE)

# ---------------------------------------------------------------------------
# Reference encode picks
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClipSearchSummary:
    """One row of the cross-clip aggregate summary emitted at end of run.

    Captures everything the consolidated table needs to render: clip
    identity (index + filename stem) plus the relevant fields from the
    search outcome. The makeClips loop collects these and the formatter
    below renders them as a single ``logger.report`` block.

    ``prior_run_deltas`` is the auto-delta block input — one
    ``PriorRunDelta`` per row in the deltas section for this clip
    (current run + one row per distinct prior encoder configuration).
    Empty when no prior runs exist on disk for this clip; the
    formatter omits the deltas section entirely in that case.
    """

    marker_pair_index: int
    file_name_stem: str
    result: SampleGuidedEncodeResult
    prior_run_deltas: tuple[PriorRunDelta, ...] = ()


def _emit_chart_for_cached_result(
    *,
    cached_result: SampleGuidedEncodeResult,
    target: SampleGuidedEncodeTarget,
    prior_jsonl_path: Path,
    fingerprint_dir: Path,
    file_name_stem: str,
    middle_window_index: int,
    source_fps: float,
    codec: str,
) -> None:
    """Re-render the curve-fit chart on a full cache hit, including
    the baseline (★) and reference (▲) markers a fresh-search chart
    has.

    Rebuilds the fit from reconstructed probe trials and re-renders
    against the *current* target. ``baseline`` is parsed back out of
    the prior JSONL's ``fit`` record (where the live-search path
    nested it). ``reference`` is recomputed: the on-disk
    ``.crfsearch-ref-w<N>.webm`` file's size + the middle window's
    frame count (from sample_windows + source_fps) reproduce the
    same bitrate the live path computes.
    """
    probes = [
        trial for trial in cached_result.trials
        if trial.phase in {"probe", "verify"}
    ]
    if len(probes) < 2:
        return  # not enough probes to fit; skip silently
    # Dedupe by CRF, prefer verify (final measurement at the picked CRF).
    by_crf: dict[int, SampleGuidedEncodeTrial] = {}
    for trial in probes:
        existing = by_crf.get(trial.crf)
        if existing is None or trial.phase == "verify":
            by_crf[trial.crf] = trial
    deduped = sorted(by_crf.values(), key=lambda t: t.crf)
    try:
        fit = fit_curves(deduped, target=target)
    except Exception as exc:
        logger.verbose(
            f"failed to rebuild fit from cached probes "
            f"({exc.__class__.__name__}: {exc}); skipping chart replay.",
        )
        return

    baseline = _baseline_from_prior_jsonl(prior_jsonl_path)
    reference = _reference_from_disk(
        fingerprint_dir=fingerprint_dir,
        file_name_stem=file_name_stem,
        middle_window_index=middle_window_index,
        sample_windows=cached_result.sample_windows,
        source_fps=source_fps,
        codec=codec,
    )

    chart_lines = render_curve_ascii(
        fit,
        target=target,
        chosen_crf=cached_result.optimal_crf or target.crf_min,
        baseline=baseline,
        reference=reference,
    )
    summary_line = (
        f"curve-fit (cached): {len(fit.valid_probes)}/"
        f"{len(deduped)} valid probes; chose crf="
        f"{cached_result.optimal_crf} (replayed from prior run; "
        f"target_low={target.target_vmaf_low}, "
        f"low_pct=p{target.target_vmaf_low_pct})"
    )
    # See curve_fit's matching notice — disabling rich's
    # ReprHighlighter is required so the legend's bright_X markup
    # isn't clobbered by attrib_name yellow on the "key=" tokens.
    logger.notice(
        "\n".join([summary_line, *chart_lines]),
        extra={"highlighter": None},
    )


def _baseline_from_prior_jsonl(jsonl_path: Path) -> SampleGuidedEncodeTrial | None:
    """Parse the baseline trial out of a prior run's ``fit`` record.

    The live-search path nests baseline data inside the JSONL fit
    record. Returns a synthesized ``SampleGuidedEncodeTrial`` with all six
    percentiles populated, or ``None`` if the record is absent /
    incomplete.
    """
    try:
        with jsonl_path.open("r", encoding="utf-8") as fp:
            for raw_line in fp:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") != "fit":
                    continue
                bl = rec.get("baseline")
                if not isinstance(bl, dict):
                    return None
                summary_rec = bl.get("summary") or {}
                summary = VmafSummary(
                    mean=float(summary_rec.get("mean", math.nan)),
                    p1=float(summary_rec.get("p1", math.nan)),
                    p5=float(summary_rec.get("p5", math.nan)),
                    p10=float(summary_rec.get("p10", math.nan)),
                    p15=float(summary_rec.get("p15", math.nan)),
                    p20=float(summary_rec.get("p20", math.nan)),
                    p25=float(summary_rec.get("p25", math.nan)),
                    minimum=float(summary_rec.get("minimum", math.nan)),
                    frame_count=int(summary_rec.get("frame_count", 0) or 0),
                )
                return SampleGuidedEncodeTrial(
                    crf=int(bl.get("crf", 0)),
                    summary=summary,
                    encode_seconds=0.0,
                    passed=False,
                    low_pct_enforced=False,
                    encoded_size_bytes=int(bl.get("encoded_size_bytes", 0) or 0),
                    size_percent_of_reference=0.0,
                    windows_used=1,
                    windows_total=1,
                    phase="baseline",
                    bitrate_kbps=float(bl.get("bitrate_kbps", 0.0) or 0.0),
                )
    except OSError:
        return None
    return None


def _reference_from_disk(
    *,
    fingerprint_dir: Path,
    file_name_stem: str,
    middle_window_index: int,
    sample_windows: list[SampleWindow],
    source_fps: float,
    codec: str,
) -> SampleGuidedEncodeTrial | None:
    """Reconstruct the reference marker from the on-disk ref encode.

    The live path computes ``ref_size_bytes`` from the cached path
    and ``ref_window_frames`` from the middle window's duration.
    For a cache replay we have neither in memory, but both are
    deterministic from disk + sample windows.
    """
    if not (0 <= middle_window_index < len(sample_windows)):
        return None
    ref_path = fingerprint_dir / (
        f"{file_name_stem}.crfsearch-ref-w{middle_window_index}.webm"
    )
    if not ref_path.is_file():
        return None
    try:
        ref_size_bytes = ref_path.stat().st_size
    except OSError:
        return None
    if ref_size_bytes <= 0:
        return None
    middle_window = sample_windows[middle_window_index]
    ref_window_frames = (
        round(middle_window.duration * source_fps) if source_fps > 0 else 0
    )
    if ref_window_frames <= 0:
        return None
    ref_duration_seconds = ref_window_frames / source_fps
    ref_bitrate_kbps = ref_size_bytes * 8 / ref_duration_seconds / 1000
    reference_crf = _REFERENCE_CRF_BY_CODEC.get(codec, _REFERENCE_CRF_FALLBACK)
    ref_summary = VmafSummary(
        mean=100.0, p1=100.0, p5=100.0, p10=100.0,
        p15=100.0, p20=100.0, p25=100.0,
        minimum=100.0, frame_count=ref_window_frames,
    )
    return SampleGuidedEncodeTrial(
        crf=reference_crf,
        summary=ref_summary,
        encode_seconds=0.0,
        passed=False,
        low_pct_enforced=False,
        encoded_size_bytes=ref_size_bytes,
        size_percent_of_reference=100.0,
        windows_used=1,
        windows_total=1,
        phase="reference",
        bitrate_kbps=ref_bitrate_kbps,
    )


def _emit_final_encode_sidecar_signal(
    *,
    output_path: Path,
    fingerprints: _RunFingerprints,
    picked_crf: int,
    encode_decision_threshold: float,
) -> None:
    """Emit a NOTICE / WARNING about the final-encode output, and
    write or refresh its ``.encode-meta.json`` sidecar accordingly.

    Two paths through this helper, distinguished by whether
    ``makeClip`` actually encoded vs skipped (detected via mtime):

    - **Encoded** (file mtime newer than the threshold the orchestrator
      captured before calling makeClip): write a fresh sidecar
      reflecting this run's fingerprint + picked CRF. Operator
      already saw the encode happen via the SUCCESS log line that
      makeClip emits — no additional signal needed here beyond the
      sidecar write.
    - **Skipped** (file existed pre-run, makeClip's
      ``mp["exists"] and not overwrite`` short-circuit fired):
      compare the existing sidecar against the current run's
      expectations. Match ⇒ NOTICE "already up to date." Mismatch
      or missing sidecar ⇒ WARNING with the diff and a re-run
      hint. Either way, the on-disk file isn't touched.

    Failures (sidecar I/O errors, missing output) are non-fatal —
    log at verbose and move on; the encode itself either succeeded
    or didn't, independent of sidecar bookkeeping.
    """
    if not output_path.is_file():
        return
    file_mtime = output_path.stat().st_mtime
    if file_mtime > encode_decision_threshold:
        try:
            write_encode_meta_sidecar(
                output_path,
                encoder_fingerprint=fingerprints.encoder_fingerprint,
                encode_args_signature=fingerprints.encode_args_signature,
                picked_crf=picked_crf,
                algorithm_version=ALGORITHM_VERSION,
                yt_clipper_version=YT_CLIPPER_VERSION,
            )
        except OSError as exc:
            logger.verbose(
                f"final encode: failed to write encode-meta sidecar for "
                f"{output_path.name}: {exc}",
            )
        return
    # File pre-existed and wasn't touched: compare against current expectations.
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint=fingerprints.encoder_fingerprint,
        expected_picked_crf=picked_crf,
    )
    if check.status == "match":
        logger.info(
            f"final encode: {output_path.name} already exists with "
            f"matching settings + crf={picked_crf}; skipped (use "
            f"--overwrite to force re-encode).",
        )
    elif check.status == "mismatch":
        prior_fp = (check.existing or {}).get("encoder_fingerprint", "?")
        prior_crf = (check.existing or {}).get("picked_crf", "?")
        logger.warning(
            f"final encode: {output_path.name} exists but settings "
            f"differ (prior fingerprint={prior_fp} crf={prior_crf}; "
            f"current fingerprint={fingerprints.encoder_fingerprint} "
            f"crf={picked_crf}). Re-run with --overwrite to re-encode "
            f"with current settings.",
        )
    else:  # "missing"
        logger.warning(
            f"final encode: {output_path.name} exists but no "
            f"encode-meta sidecar (prior settings unknown). Re-run "
            f"with --overwrite to re-encode with current settings.",
        )


def _interpolate_kbps_at_target_vmaf(
    trials: list[SampleGuidedEncodeTrial],
    target_vmaf_low: float,
    target_vmaf_low_pct: int,
) -> float | None:
    """Predicted bitrate at the CRF where ``p_low == target_vmaf_low``.

    Piecewise-linear interpolation across curve-fit probes (phase
    ``probe`` or ``verify`` — encoded with maxrate disabled). Excludes
    baseline trials (different bitrate regime, maxrate enabled) and
    reference trials (saturated near VMAF 100). Returns ``None`` when
    the target VMAF can't be bracketed by any pair of probes — i.e.
    every probe is either above target (clip is too easy for the
    range we searched) or every probe is below target (clip is too
    hard, target is unreachable in the searched CRF band). In both
    cases the comparable "kbps to hit target" metric is undefined.

    Why this exists: cross-config A/B testing (e.g. aq-mode 0 vs 4)
    needs an apples-to-apples efficiency metric. The picked CRF in
    the report differs across runs because each config shifts the
    curve, so comparing summary lines directly mixes "did the curve
    move?" with "did the picked CRF move?". Anchoring to a fixed VMAF
    target collapses both into one number: the bitrate each config
    needs to hit the same quality.
    """
    valid = [
        t for t in trials
        if t.phase in {"probe", "verify"}
        and t.bitrate_kbps > 0
        and t.summary.frame_count > 0
    ]
    if len(valid) < 2:
        return None
    points: list[tuple[int, float, float]] = []
    for trial in valid:
        p_low = float(get_low_percentile_value(trial.summary, target_vmaf_low_pct))
        if not math.isfinite(p_low):
            continue
        points.append((trial.crf, p_low, float(trial.bitrate_kbps)))
    if len(points) < 2:
        return None
    points.sort(key=lambda p: p[0])
    # VMAF decreases with CRF, so a target-bracket is a pair where
    # ``(vmaf_a - target)`` and ``(vmaf_b - target)`` have opposite
    # signs (or either equals zero). Walk segments lo→hi until one
    # straddles the target.
    for i in range(len(points) - 1):
        _, vmaf_a, kbps_a = points[i]
        _, vmaf_b, kbps_b = points[i + 1]
        if (vmaf_a - target_vmaf_low) * (vmaf_b - target_vmaf_low) <= 0:
            if vmaf_a == vmaf_b:
                return kbps_a
            t_frac = (vmaf_a - target_vmaf_low) / (vmaf_a - vmaf_b)
            return kbps_a + t_frac * (kbps_b - kbps_a)
    return None


def _format_baseline_delta_line(
    *,
    clip_label: str,
    result: SampleGuidedEncodeResult,
    target_low_pct: int,
) -> str | None:
    """Render the one-line "vs baseline" delta for a single clip.

    The baseline trial is the CRF yt_clipper would have auto-picked if
    --sample-guided-encode were OFF (encoded once at search start, phase tag
    ``"baseline"``). The picked is the search's chosen optimum.
    Returns ``None`` when either is absent — e.g. the search failed and
    has no optimal, or the run was fully served from cache and the
    baseline trial was skipped entirely.

    Size is extrapolated to the full final-encode length (same
    formula as the aggregate table's ``size_MB`` column) so the two
    points are on the same footing as the picked row directly above.
    """
    baseline = result.baseline_trial
    picked = next(
        (t for t in result.trials if t.crf == result.optimal_crf),
        None,
    )
    # Picked-only fallback: the search produced an optimal but no
    # baseline trial is available — happens when a cache hit replays a
    # prior run that pre-dates baseline persistence (the prior JSONL has
    # no ``fit`` record, or its ``baseline`` field is null). Emit an
    # explicit "not available" line so the absence is discoverable
    # instead of leaving the user to wonder why the section is missing.
    if picked is None:
        return None
    if baseline is None:
        return (
            f"{clip_label} not available — cached prior run has no "
            f"baseline data (re-run with --sample-guided-encode to capture it)"
        )

    def _pct_delta(new: float, old: float) -> float:
        return ((new - old) / old * 100.0) if old != 0 else 0.0

    def _est_size_mb(trial: SampleGuidedEncodeTrial) -> float | None:
        if trial.summary.frame_count > 0 and result.final_frames_estimate > 0:
            return (
                trial.encoded_size_bytes
                * (result.final_frames_estimate / trial.summary.frame_count)
                / (1024 * 1024)
            )
        return None

    b_size = _est_size_mb(baseline)
    p_size = _est_size_mb(picked)
    b_low = get_low_percentile_value(baseline.summary, target_low_pct)
    p_low = get_low_percentile_value(picked.summary, target_low_pct)

    segments = [
        f"kbps {baseline.bitrate_kbps:.0f}→{picked.bitrate_kbps:.0f} "
        f"({_pct_delta(picked.bitrate_kbps, baseline.bitrate_kbps):+.1f}%)",
        f"*p{target_low_pct} {b_low:.2f}→{p_low:.2f} ({p_low - b_low:+.2f})",
    ]
    if b_size is not None and p_size is not None:
        segments.append(
            f"size {b_size:.1f}→{p_size:.1f} MB "
            f"({_pct_delta(p_size, b_size):+.1f}%)",
        )
    return (
        f"{clip_label} crf {baseline.crf}→{picked.crf}: "
        + ", ".join(segments)
    )


def _format_baseline_deltas_block(
    clip_summaries: list[ClipSearchSummary],
    target_low_pct: int,
) -> str:
    """Render the multi-clip "vs baseline" delta section.

    One line per clip that has both a baseline and a picked trial.
    Returns the empty string when no clip qualifies (every search either
    cache-hit or failed before producing a picked optimal), so the
    caller can skip emitting the section entirely.
    """
    delta_lines: list[str] = []
    for clip in clip_summaries:
        line = _format_baseline_delta_line(
            clip_label=f"#{clip.marker_pair_index + 1}",
            result=clip.result,
            target_low_pct=target_low_pct,
        )
        if line is not None:
            delta_lines.append(line)
    if not delta_lines:
        return ""
    header = (
        "delta vs baseline (the CRF yt_clipper would have auto-picked "
        "without --sample-guided-encode):"
    )
    return "\n".join([header, *delta_lines])


def format_aggregated_search_summary_log_block(
    clip_summaries: list[ClipSearchSummary],
) -> str:
    """Render one consolidated cross-clip sample-guided summary table.

    Emitted as the final ``logger.report`` of a run so all per-clip
    optimal-CRF picks land together at the bottom of the Summary Report
    section. One row per marker pair: clip index, optimal CRF, VMAF
    mean + all six low percentiles (p1, p5, p10, p15, p20, p25) with
    the configured target percentile marked, trial count, search wall
    time, sample-vs-final frame ratio. The ratio is the load-bearing
    tuning signal: small = sampling is paying off; large = consider
    full-clip trials or reducing ``target_combined_frames``.

    Returns an empty string when ``clip_summaries`` is empty so the
    caller can skip emitting an empty section.
    """
    if not clip_summaries:
        return ""

    from rich import box
    from rich.table import Table

    from clipper.log_helpers import render_rich_table_to_text

    # Pull the configured target percentile from the first clip's result;
    # all clips in a single run share the same target so this is safe.
    first_target = clip_summaries[0].result.target
    target_low_pct = (
        first_target.target_vmaf_low_pct if first_target is not None else DEFAULT_LOW_PERCENTILE
    )

    def _label(pct: int) -> str:
        return f"*p{pct}" if target_low_pct == pct else f"p{pct}"

    header = (
        "aggregate summary across all marker pairs "
        f"(* = enforced low-percentile target; "
        f"kbps@tgt = predicted bitrate at the target VMAF, "
        f"the apples-to-apples cross-config efficiency metric):"
    )

    table = Table(
        box=box.SIMPLE_HEAD,
        show_edge=False,
        pad_edge=False,
        padding=(0, 1),
        collapse_padding=True,
    )
    for col_name in ("clip", "crf", "mean", _label(1), _label(5), _label(10),
                     _label(15), _label(20), _label(25), "kbps", "kbps@tgt",
                     "size_MB", "size%", "trials", "time", "sample%"):
        table.add_column(
            col_name,
            justify="left" if col_name == "clip" else "right",
        )
    # The file name is intentionally not a column here — the per-clip
    # success NOTICE earlier in the run already names every file. This
    # table is for cross-clip comparison; the clip index identifies each
    # row unambiguously.

    for clip in clip_summaries:
        result = clip.result
        crf = str(result.optimal_crf) if result.optimal_crf is not None else "fail"
        if result.optimal_summary is not None:
            mean = f"{result.optimal_summary.mean:.2f}"
            p1 = f"{result.optimal_summary.p1:.2f}"
            p5 = f"{result.optimal_summary.p5:.2f}"
            p10 = f"{result.optimal_summary.p10:.2f}"
            p15 = f"{result.optimal_summary.p15:.2f}"
            p20 = f"{result.optimal_summary.p20:.2f}"
            p25 = f"{result.optimal_summary.p25:.2f}"
        else:
            mean = "-"
            p1 = p5 = p10 = p15 = p20 = p25 = "-"
        # size% of the OPTIMAL trial relative to reference, plus the
        # absolute kbps and predicted final-encode size from the same
        # trial (if any matched the optimal CRF — fail-cases skip).
        size_pct = "-"
        kbps_str = "-"
        size_mb_str = "-"
        for trial in result.trials:
            if trial.crf == result.optimal_crf:
                size_pct = f"{trial.size_percent_of_reference:.0f}%"
                kbps_str = f"{trial.bitrate_kbps:.0f}"
                if (
                    trial.summary.frame_count > 0
                    and result.final_frames_estimate > 0
                ):
                    est_size_mb = (
                        trial.encoded_size_bytes
                        * (result.final_frames_estimate / trial.summary.frame_count)
                        / (1024 * 1024)
                    )
                    size_mb_str = f"{est_size_mb:.1f}"
                break
        # Apples-to-apples efficiency metric: predicted bitrate at the
        # CRF where p_low equals the configured target VMAF. Lets two
        # runs of the same clip with different encoder settings be
        # compared directly — the picked CRF differs across configs
        # but the kbps to hit the same VMAF target is comparable.
        kbps_at_target_str = "-"
        if result.target is not None:
            kbps_at_target = _interpolate_kbps_at_target_vmaf(
                result.trials,
                result.target.target_vmaf_low,
                result.target.target_vmaf_low_pct,
            )
            if kbps_at_target is not None:
                kbps_at_target_str = f"{kbps_at_target:.0f}"
        sample_pct = (
            f"{result.search_frames / result.final_frames_estimate * 100.0:.0f}%"
            if result.final_frames_estimate > 0
            else "-"
        )
        clip_label = f"#{clip.marker_pair_index + 1}"
        table.add_row(
            clip_label, crf, mean, p1, p5, p10, p15, p20, p25,
            kbps_str, kbps_at_target_str, size_mb_str, size_pct,
            str(len(result.trials)),
            f"{result.search_seconds:.1f}s", sample_pct,
        )

    lines: list[str] = [header, "", render_rich_table_to_text(table, width=140)]

    # Baseline-vs-picked delta — one line per clip. The baseline trial
    # is the CRF yt_clipper would have auto-picked if --sample-guided-encode were
    # OFF; the picked is what the search settled on. The per-trial log
    # already shows both points individually, but this puts the delta
    # directly next to the aggregate table for easy skimming.
    baseline_block = _format_baseline_deltas_block(clip_summaries, target_low_pct)
    lines.extend(["", baseline_block] if baseline_block else [])

    lines: list[str] = [header, "", render_rich_table_to_text(table, width=140)]

    # Auto-delta block: per-clip prior-run comparisons against
    # distinct encoder configurations seen on the same pair. Skipped
    # automatically by ``format_prior_run_deltas_block`` for clips
    # with no priors. Target VMAF is read from the first clip's
    # result (all clips in a run share the same target).
    target_low_value = (
        first_target.target_vmaf_low
        if first_target is not None
        else 0.0
    )
    rows_per_clip: list[tuple[str, list[PriorRunDelta]]] = [
        (
            f"#{clip.marker_pair_index + 1}",
            list(clip.prior_run_deltas),
        )
        for clip in clip_summaries
        if clip.prior_run_deltas
    ]
    if rows_per_clip:
        deltas_block = format_prior_run_deltas_block(
            rows_per_clip,
            target_vmaf_low=target_low_value,
        )
        if deltas_block:
            lines.append("")  # blank separator before the deltas section
            lines.append(deltas_block)
    return "\n".join(lines)


# Reference encodes prioritize "VMAF measures the trial, not the
# reference's compromises." Low CRF (per codec) gets us there; preset
# speed is the next-largest knob. Slowest preset (encodeSpeed=0) buys
# only ~1 VMAF point over a moderate preset — diminishing returns at
# the CRF=18 quality ceiling — but takes 2-3x longer per window. Use
# encodeSpeed=2 (good-quality preset) so reference encodes don't
# dominate the search wall time. The reference still measures > 95
# VMAF NEG mean at this preset, well above the search target floor.
_REFERENCE_ENCODE_SPEED: int = 2


def reference_encode_picks_for_codec(codec: str) -> dict[str, Any]:
    """Settings overrides for a near-transparent reference encode.

    Low CRF, moderate preset, no bitrate cap so VMAF measures the
    *trial's* quality rather than reference compromises. Per-codec CRF
    accounts for the perceptual scale offset (vp9 ≈ h264 + 6, vp8 even
    smaller). Hardware h264 variants (nvenc, vulkan) share h264's CRF —
    slightly less efficient but still near-transparent at CRF 18.

    ``encodeSpeed`` was previously 0 (slowest preset); switched to 2
    (good-quality preset) for ~2-3x faster reference encodes. The
    quality difference at the CRF=18 transparency ceiling is < 1 VMAF
    point — invisible to the search since trial CRFs are 15-30 points
    away from the reference.
    """
    return {
        "crf": _REFERENCE_CRF_BY_CODEC.get(codec, _REFERENCE_CRF_FALLBACK),
        "autoTargetMaxBitrate": 0,  # 0 -> constant-quality, no -maxrate cap
        "encodeSpeed": _REFERENCE_ENCODE_SPEED,
        "twoPass": False,
    }


# ---------------------------------------------------------------------------
# Quality measurement glue
# ---------------------------------------------------------------------------


# Note: an earlier non-progressive ``measure_combined_vmaf_neg`` helper
# (encode all windows -> measure each -> concat per-frame lists) was
# removed when the orchestrator switched to per-window progressive
# measurement. The progressive flow inlines the equivalent logic in
# ``evaluate_trial`` so it can short-circuit between windows once
# :func:`is_trial_confidently_decided` says the verdict is settled.


# ---------------------------------------------------------------------------
# Orchestrator (integrates with clip_maker)
# ---------------------------------------------------------------------------


# mps overrides applied during reference + trial encodes to skip
# motion-interpolation and video2x-upscaling stages. CRF is per-frame so
# searching pre-interpolation produces a slightly conservative answer
# (uses marginally more bits than strictly needed in the final
# interpolated encode) — a safe error mode much cheaper than running
# minterp/v2x for every trial.
_TRIAL_PIPELINE_OVERRIDES: dict[str, Any] = {
    "minterpFpsMultiplier": 0,
    # ``"None"`` is the literal string ``argparser.py`` accepts for
    # disabled minterp; ``clip_maker.py``'s gate is
    # ``mps["minterpMode"] != "None"`` so any other string (including
    # the conceptually-correct "Disabled") leaks minterp through to
    # trial encodes — they end up running at the user's interpolated
    # fps (e.g. 60), tripling encode time for each trial. Use the
    # exact string the dispatcher checks for.
    "minterpMode": "None",
    "minterpTool": "ffmpeg",  # avoids the video2x branch in makeClip
    "audio": False,  # audio doesn't affect VMAF; skip the work
    # Disable the user's max-bitrate cap during trials. With the cap
    # active, trial encodes at low CRFs hit the bitrate ceiling and
    # produce byte-identical output across a CRF range — the encoder's
    # CRF↔quality response is masked. We want pure CRF response from
    # trials so the curve fit measures the encoder, not the constraint.
    # The reference encode also disables the cap (see
    # ``reference_encode_picks_for_codec``); matching trials gives
    # apples-to-apples comparison. The user's cap still applies to the
    # final encode (post-search), so the picked CRF + their bitrate
    # constraint compose at production time.
    "autoTargetMaxBitrate": 0,
    # Quiet the per-frame progress noise from ffmpeg during trial encodes.
    # Triggers a `-loglevel warning -nostats` injection in the command
    # builder. The final encode (after search converges) restores the
    # user's full settings, so production encodes still show normal
    # progress on stderr.
    "quietFfmpeg": True,
    # ``--overwrite`` is intent-for-the-final-output. Trial / ref /
    # baseline encodes are intermediate cache artifacts; their on-disk
    # files are byte-equivalent across runs of the same encoder
    # fingerprint by construction (that's what the fingerprint
    # guarantees), so re-encoding them on every run wastes work.
    # Force overwrite=False here so makeClip's ``mp["exists"]``
    # short-circuit fires and reuses prior intermediate files
    # regardless of the user's --overwrite flag. The final encode
    # still respects --overwrite (it doesn't go through this override
    # dict).
    "overwrite": False,
    # Two-pass shapes rate-control toward a target bitrate; CRF mode
    # targets quality directly, so the first pass is largely
    # redundant. Disabling it ~halves per-trial time when the user
    # has it on, with no measurable effect on the picked CRF. The
    # reference encode also forces ``twoPass=False`` (see
    # ``reference_encode_picks_for_codec``); this entry makes the
    # same guarantee for trial + baseline encodes regardless of the
    # reference/trial override layering order. The user's two-pass
    # setting still applies to the final encode (post-search), which
    # doesn't go through this override dict.
    "twoPass": False,
    # ``vidstabdetect`` + ``vidstabtransform`` are filter-graph
    # stages applied BEFORE the encoder; running them per trial adds
    # roughly the same per-frame cost as a second decode pass. The
    # detection result depends only on the source (not on CRF), so
    # the impact on the CRF↔VMAF curve is well-modelled by skipping
    # stabilization entirely during search. Trade-off: the picked
    # CRF predicts the UNSTABILIZED encoder response; the user's
    # final stabilized output may land slightly below the search's
    # predicted VMAF target because stabilization warp introduces
    # modest pixel noise. Acceptable in exchange for the speedup —
    # revisit if users report drift, or expose
    # ``--sample-guided-encode-stabilize=reuse`` as an opt-in escape hatch.
    "videoStabilization": {"enabled": False, "desc": "Disabled"},
}


# Settings dict key used by the orchestrator to share the most recent
# successful optimal CRF across marker-pair invocations within one CLI
# run. Cross-pair learning: subsequent pairs seed their search at this
# CRF as ``crf_max``, skipping Phase 1's wide initial probe when the
# clip-content correlations between pairs hold (typical case for
# multiple marker pairs cut from the same source video).
_PRIOR_OPTIMAL_CRF_SETTING_KEY: str = "_lastSampleGuidedOptimal"


@dataclass(frozen=True)
class _RunFingerprints:
    """Bundle of identifiers for one cache lookup.

    Computed once at the top of ``run_sample_guided_encode_for_marker_pair`` and
    threaded through the rest of the run for path naming, sidecar
    writing, and cache-gate checks.

    ``encode_args_signature`` is the structured dict from
    ``compute_encoder_fingerprint`` — ``{"codec_args", "filter_graph",
    "extras"}``. The ``extras`` sub-dict is the human-readable
    encoder-config knobs (codec, width/height, speed, HDR, twoPass,
    encodeSpeed, rotate, denoise, videoStabilization) — same data
    the auto-delta diff label diffs across runs.
    """

    encoder_fingerprint: str
    encode_args_signature: dict[str, Any]
    search_fingerprint: str

    @property
    def encoder_config(self) -> dict[str, Any]:
        """The ``signature["extras"]`` dict — readable encoder knobs."""
        extras = self.encode_args_signature.get("extras")
        return extras if isinstance(extras, dict) else {}


def _compute_run_fingerprints(
    codec: str,
    settings: dict[str, Any],
    originalMarkerSnapshot: dict[str, Any],
    target: SampleGuidedEncodeTarget,
) -> _RunFingerprints:
    """Build fingerprints + config summary for this run.

    Calls ``getFfmpegVideoCodecArgs`` with a synthetic ``mp`` / ``mps``
    populated from ``settings`` and the marker snapshot, plus the
    trial pipeline overrides applied. Uses a sentinel ``crf=30``;
    ``compute_encoder_fingerprint``'s canonicalization strips it.

    The synthetic mps is deliberately *minimal* — only the fields the
    codec-args generator actually reads. We deliberately don't call
    ``getMarkerPairSettings`` here because (a) it's non-idempotent
    and would mutate the snapshot, (b) it's expensive (probes ffmpeg)
    and (c) the codec-args generator only needs a small subset of the
    full mps. This synthesis is reproduced byte-for-byte across runs
    of the same settings, so the fingerprint is stable.

    Wrapped in a try / except so codec-args-generator failures don't
    crash the search — fall back to a fingerprint computed from the
    extras dict alone (less ideal, but the whole feature degrades
    gracefully). The fallback path emits an empty ``codec_args`` which
    the canonicalizer accepts cleanly.
    """
    fp_mp: dict[str, Any] = {
        "speed": float(originalMarkerSnapshot.get("speed", 1.0)),
        "averageSpeed": float(
            originalMarkerSnapshot.get("averageSpeed",
                originalMarkerSnapshot.get("speed", 1.0)),
        ),
        "isVariableSpeed": bool(originalMarkerSnapshot.get("isVariableSpeed", False)),
    }
    fp_mps: dict[str, Any] = {
        "videoCodec": codec,
        "minterpFPS": None,  # trial pipeline disables minterp
        "minterpTool": "ffmpeg",
        "r_frame_rate": settings.get("r_frame_rate", Fraction(30)),
        "enableHDR": bool(settings.get("enableHDR", False)),
        "targetSize": 0,  # trial pipeline disables target size
        "targetMaxBitrate": 0,  # trial pipeline disables maxrate
        "crf": 30,  # sentinel — canonicalized to <CRF>
    }
    codec_args = ""
    try:
        codec_args, _, _ = getFfmpegVideoCodecArgs(
            codec, cbr=None, mp=fp_mp, mps=fp_mps,
        )
    except Exception as exc:
        logger.verbose(
            f"fingerprint codec-args derivation failed "
            f"({exc.__class__.__name__}: {exc}); falling back to "
            f"extras-only fingerprint.",
        )

    # ``twoPass`` and ``videoStabilization`` are intentionally NOT in
    # extras: the trial pipeline forces both off (see
    # ``_TRIAL_PIPELINE_OVERRIDES``), so trial bytes are identical
    # regardless of what the user has them set to. Including them in
    # the fingerprint would needlessly invalidate the cache when the
    # user toggles either between runs, even though the picked CRF
    # would be the same.
    extras: dict[str, Any] = {
        "codec": codec,
        "width": settings.get("width"),
        "height": settings.get("height"),
        "r_frame_rate": str(settings.get("r_frame_rate", "")),
        "speed": float(originalMarkerSnapshot.get("speed", 1.0)),
        "enableHDR": bool(settings.get("enableHDR", False)),
        "encodeSpeed": int(settings.get("encodeSpeed", 4)),
        "rotate": settings.get("rotate"),
        "denoise": settings.get("denoise"),
    }

    encoder_fingerprint, signature = compute_encoder_fingerprint(
        codec_args=codec_args,
        filter_graph="",  # phase 4: extract real filter graph from clip_maker
        extras=extras,
    )
    search_fingerprint = compute_search_fingerprint(
        target_vmaf_low=target.target_vmaf_low,
        target_vmaf_low_pct=target.target_vmaf_low_pct,
        target_vmaf_mean=target.target_vmaf_mean,
        crf_min=target.crf_min,
        crf_max=target.crf_max,
    )
    return _RunFingerprints(
        encoder_fingerprint=encoder_fingerprint,
        encode_args_signature=signature,
        search_fingerprint=search_fingerprint,
    )


def run_sample_guided_encode_for_marker_pair(  # noqa: PLR0912 — phased orchestration with conditional logging and cross-pair state; splitting would obscure the per-clip flow
    cs: ClipperState,
    markerPairIndex: int,
    *,
    originalMarkerSnapshot: dict[str, Any],
) -> dict[str, Any] | None:
    """Replace ``makeClip``'s normal call for one marker pair with a
    quality-targeted encode flow: reference + binary-search trials +
    final encode at the chosen CRF.

    Wrapped in try/except so a search failure (encode crash, VMAF parse
    error, missing reference) falls back to a normal makeClip call rather
    than aborting the whole run.

    Imported lazily inside the function to avoid an import cycle —
    ``clip_maker`` imports this module's pure pieces, so this orchestrator
    can't import ``clip_maker`` at module load time.
    """
    # Lazy import sidesteps the clip_maker -> sample_guided_encode -> clip_maker
    # cycle. Module-level pure pieces stay importable from clip_maker without
    # the orchestrator dragging clip_maker back in.
    from clipper.clip_maker import getDefaultEncodeSettings, makeClip

    settings = cs.settings
    try:
        # The marker pair is currently the pristine snapshot (caller has
        # NOT yet run any makeClip for this pair). Read the source fps and
        # marker timing from the snapshot directly — getMarkerPairSettings
        # would mutate them.
        clip_start = float(originalMarkerSnapshot.get("start", 0.0))
        clip_end = float(originalMarkerSnapshot.get("end", 0.0))
        # source_fps comes from settings (loaded from ffprobe) since the
        # marker JSON itself doesn't carry it.
        source_fps = _resolve_source_fps(settings)
        codec = settings.get("videoCodec", "vp9")

        target_vmaf_low_pct = int(
            settings.get("targetVmafLowPercentile") or DEFAULT_LOW_PERCENTILE,
        )
        if target_vmaf_low_pct not in SUPPORTED_LOW_PERCENTILES:
            logger.warning(
                f"unsupported --target-vmaf-low-percentile "
                f"{target_vmaf_low_pct}; falling back to "
                f"{DEFAULT_LOW_PERCENTILE}.",
            )
            target_vmaf_low_pct = DEFAULT_LOW_PERCENTILE

        target_vmaf_mean = float(
            settings.get("targetVmafMean") or DEFAULT_TARGET_VMAF_MEAN,
        )
        # ``targetVmafLow`` defaults to None in argparser when unset,
        # so the default scales with the chosen percentile. Setting it
        # explicitly via the CLI overrides this auto-default.
        explicit_low = settings.get("targetVmafLow")
        target_vmaf_low = (
            float(explicit_low)
            if explicit_low is not None
            else default_low_threshold_for_percentile(target_vmaf_low_pct)
        )

        # Cross-marker-pair learning: when a previous marker pair in this
        # run already converged on an optimal CRF, that's a strong prior
        # for the current pair (same source video, similar content). Seed
        # the search by lowering ``crf_max`` to the prior optimal so
        # Phase 1 probes there first instead of the wide default ceiling
        # (42). If the current pair is similarly compressible the search
        # finishes in 1-2 trials. If it's harder, Phase 1's bisection
        # walks downward; if it's easier, galloping expansion explores
        # higher CRFs from the prior optimal as the new starting point.
        prior_optimal_crf = settings.get(_PRIOR_OPTIMAL_CRF_SETTING_KEY)
        crf_max_for_search = SampleGuidedEncodeTarget.crf_max
        if (
            isinstance(prior_optimal_crf, int)
            and SampleGuidedEncodeTarget.crf_min <= prior_optimal_crf <= SampleGuidedEncodeTarget.crf_absolute_max
        ):
            crf_max_for_search = prior_optimal_crf
            logger.info(
                f"using "
                f"prior pair's optimal crf={prior_optimal_crf} as starting "
                f"upper bound (galloping expansion will probe higher if "
                f"this clip compresses better).",
            )

        # Floor ``crf_min`` two above the reference encode's CRF for the
        # selected codec. Trials at crf <= ref_crf are roughly the same
        # quality as the reference (or higher) and saturate at VMAF ~100
        # — measuring "how close is this trial to the reference?" when
        # they're effectively the same encode. ``ref_crf + 1`` sits
        # close enough to the reference to still saturate frequently;
        # ``ref_crf + 2`` gives the lowest probe meaningful separation
        # from the reference and reliably produces a distinct VMAF
        # measurement that anchors the curve.
        reference_crf = _REFERENCE_CRF_BY_CODEC.get(codec, _REFERENCE_CRF_FALLBACK)
        crf_min_for_search = max(SampleGuidedEncodeTarget.crf_min, reference_crf + 2)
        target = SampleGuidedEncodeTarget(
            target_vmaf_mean=target_vmaf_mean,
            target_vmaf_low=target_vmaf_low,
            target_vmaf_low_pct=target_vmaf_low_pct,
            crf_min=crf_min_for_search,
            crf_max=crf_max_for_search,
        )

        # Estimate the final encode's frame count. ``averageSpeed`` from the
        # marker pair scales output duration vs source duration. With minterp
        # disabled in trials the multiplier doesn't apply. final_fps =
        # source_fps * averageSpeed; final_duration = (clip_end - clip_start)
        # / averageSpeed; → final_frames = source_fps * (clip_end - clip_start).
        # That cancels the speed factor — output frame count equals source
        # frame count over the clip range. Holds for normal-speed and
        # speed-modified clips alike (dropped frames at >1x speed match the
        # frame-rate scaling in averageSpeed).
        average_speed = float(originalMarkerSnapshot.get("speed", 1.0)) or 1.0
        clip_duration = max(0.0, clip_end - clip_start)
        final_frames_estimate = (
            round(source_fps * clip_duration / average_speed) if source_fps > 0 else 0
        )

        # Floor matches the user's chosen low percentile so trial frame
        # counts always satisfy that percentile's enforcement threshold.
        # Without this, p1 target (floor=100) would silently degrade to
        # mean-only enforcement on most clips because the default would
        # apply instead. NO upper cap: the floor is the *minimum* count
        # at which the percentile is statistically defined, not the
        # count at which it has converged. Empirically (lynn pair-2
        # corpus), p20 measurements at floor=15 oscillate by 1+ point
        # across runs while at 80 frames they stabilize within ~0.3.
        # The 10%-of-final scaling in select_sample_windows gives
        # roughly 50-150 frames on typical short clips — well above the
        # noise floor for the supported percentiles. Very long clips
        # (5000+ frames) sample 500+ frames per trial; the per-trial
        # cost is real but accuracy beats speed for the search verdict.
        floor_for_pct = min_frames_for_low_percentile(target_vmaf_low_pct)
        sample_windows = select_sample_windows(
            clip_start=clip_start,
            clip_end=clip_end,
            source_fps=source_fps,
            final_frames_estimate=final_frames_estimate,
            min_combined_frames=floor_for_pct,
        )
        # Middle window is the discovery window for Phase 1 of the
        # two-phase search — a single sample drawn from the heart of the
        # clip is the most representative single-window probe.
        middle_window_index = len(sample_windows) // 2

        sample_total_frames_estimate = (
            sum(round(w.duration * source_fps) for w in sample_windows) if source_fps > 0 else 0
        )
        per_window_frame_estimate = sample_total_frames_estimate // max(1, len(sample_windows))

        low_pct_label = f"p{target.target_vmaf_low_pct}"
        logger.info(
            f""
            f"{len(sample_windows)} sample windows "
            f"(~{sample_total_frames_estimate} frames at full sampling, "
            f"~{per_window_frame_estimate} per phase-1 trial; "
            f"final encode ~{final_frames_estimate} frames), "
            f"target mean>={target.target_vmaf_mean} "
            f"{low_pct_label}>={target.target_vmaf_low}, "
            f"crf range [{target.crf_min}, {target.crf_max}]",
        )

        ffmpeg_path = cs.clipper_paths.ffmpegPath
        reference_picks = reference_encode_picks_for_codec(codec)

        # ---- Per-run history JSONL (run cache foundation) ----------------
        # Each run gets its own JSONL file under
        # ``<clipsPath>/temp/sample-encodes/<N>/<encoder_fingerprint>/
        #   run-<UTC-ts>.jsonl``
        # where ``<N>`` is the marker-pair number (1-indexed). The path is
        # already title-scoped because ``clipsPath`` is the per-title
        # output dir (yt_clipper.py appends ``/<titleSuffix>``); so we
        # don't repeat the title in the subdir name. Prior runs accumulate
        # as siblings rather than getting truncated away. The fingerprint
        # subdirectory groups runs by encoder configuration; sibling
        # fingerprint dirs represent distinct configurations on the same
        # clip and feed the auto-delta render. A ``config.json`` sidecar
        # in each fingerprint dir is human-readable provenance (which
        # encoder settings produced this fingerprint) and is the read-side
        # input for the auto-delta diff label.
        title_suffix = settings.get("titleSuffix", "clip")
        fingerprints = _compute_run_fingerprints(
            codec=codec,
            settings=settings,
            originalMarkerSnapshot=originalMarkerSnapshot,
            target=target,
        )
        pair_dir = (
            Path(cs.clipper_paths.clipsPath)
            / "temp" / "sample-encodes"
            / f"{markerPairIndex + 1}"
        )
        fingerprint_dir = pair_dir / fingerprints.encoder_fingerprint
        fingerprint_dir.mkdir(parents=True, exist_ok=True)
        run_id = datetime.now(timezone.utc).strftime("%y%m%dT%H%M%S")
        trials_metadata_path = fingerprint_dir / f"run-{run_id}.jsonl"

        # Sidecar is idempotent: first run on a fingerprint creates it,
        # subsequent runs leave it alone (preserving ``first_seen_utc``).
        try:
            write_config_sidecar(
                fingerprint_dir=fingerprint_dir,
                encoder_fingerprint=fingerprints.encoder_fingerprint,
                encode_args_signature=fingerprints.encode_args_signature,
                yt_clipper_version=YT_CLIPPER_VERSION,
            )
        except OSError as exc:
            logger.warning(
                f"failed to write fingerprint sidecar "
                f"({LogPath(fingerprint_dir / 'config.json')}): {exc}",
            )

        # Pair identity: enables the cache gate to detect a marker-pair
        # index shift (user added/removed pairs between runs and pair{N}
        # now points to a different time range). Stored as a sub-object
        # so the freshness check has a single field to look up.
        input_video = settings.get("inputVideo")
        source_video_id: dict[str, Any] = {"path": input_video}
        if input_video:
            try:
                source_video_id["mtime"] = Path(input_video).stat().st_mtime
            except OSError:
                source_video_id["mtime"] = None
        pair_identity = {
            "clip_start": clip_start,
            "clip_end": clip_end,
            "source_video_id": source_video_id,
        }

        # ---- Per-window caches shared across phases -------------------------
        # Reference encodes are lazy: each window is encoded the first time
        # a trial wants it, so Phase 1 only pays for one ref encode if
        # Phase 2/3 never need the others (rare but possible). Reference
        # paths and sizes are keyed by window_index.
        reference_path_cache: dict[int, Path] = {}
        reference_size_cache: dict[int, int] = {}
        # Trial measurements keyed by (crf, window_index). When the same
        # CRF is probed across phases (Phase 1 candidate -> Phase 2
        # validation reuses the middle window's measurement; Phase 3 may
        # re-test boundary CRFs), we don't re-encode or re-measure.
        trial_measurement_cache: dict[
            tuple[int, int],
            tuple[list[float], int, Path],
        ] = {}

        # ---- Cache reuse evaluation ----------------------------------------
        # IMPORTANT: this MUST run before we open / write to the new run's
        # JSONL. Otherwise the cache lookup globs ``run-*.jsonl`` and
        # finds the file we're about to populate (no ``search_result``
        # yet), classifies it as a crashed run, and falls through to
        # "miss" on every run. Build pair_identity (above) and the
        # in-memory caches (above) first, then evaluate; THEN open the
        # JSONL for writing.
        #
        # Strict freshness gate: algorithm version, yt_clipper version,
        # encode_args signature equality, pair_identity match. On full
        # hit we'll skip baseline + search entirely; on partial hit we'll
        # prime ``trial_measurement_cache`` from the prior run's
        # measurements (encoder bytes are equivalent — only the search
        # target moved).
        cache_decision = evaluate_cache_reuse(
            pair_dir=pair_dir,
            encoder_fingerprint=fingerprints.encoder_fingerprint,
            encoder_signature=fingerprints.encode_args_signature,
            search_fingerprint=fingerprints.search_fingerprint,
            algorithm_version=ALGORITHM_VERSION,
            yt_clipper_version=YT_CLIPPER_VERSION,
            current_pair_identity=pair_identity,
            low_pct=target.target_vmaf_low_pct,
        )
        # Diagnostic dump (visible at -v): show the full lookup state
        # so an unexpected cache miss can be debugged without tracing
        # source. The NOTICE-level lines below cover the operator-facing
        # decision; this is the deeper context.
        logger.verbose(
            f"cache lookup for pair {markerPairIndex + 1}: "
            f"pair_dir={LogPath(pair_dir)} "
            f"encoder_fp={fingerprints.encoder_fingerprint} "
            f"search_fp={fingerprints.search_fingerprint} "
            f"algo_v={ALGORITHM_VERSION} "
            f"yt_clipper_v={YT_CLIPPER_VERSION} "
            f"pair_identity={pair_identity}",
        )

        # Now that the cache lookup has seen "before-this-run" state,
        # safe to start writing the new run's JSONL. The first append
        # creates the file lazily.
        def _append_trials_metadata_line(record: dict[str, Any]) -> None:
            """Append one JSON object per line, crash-safe."""
            try:
                with trials_metadata_path.open("a", encoding="utf-8") as fp:
                    fp.write(json.dumps(record) + "\n")
            except OSError as exc:
                logger.warning(
                    f"failed to write trials metadata "
                    f"({LogPath(trials_metadata_path)}): {exc}",
                )

        # First record: run_header. Pinpoints which run this JSONL is, what
        # algorithm version produced it, and which fingerprints it claims
        # — all needed by the cache-gate of FUTURE runs to decide reuse
        # vs. re-run.
        _append_trials_metadata_line({
            "type": "run_header",
            "run_id": run_id,
            "run_timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "algorithm_version": ALGORITHM_VERSION,
            "encoder_fingerprint": fingerprints.encoder_fingerprint,
            "search_fingerprint": fingerprints.search_fingerprint,
            "yt_clipper_version": YT_CLIPPER_VERSION,
            "encode_args_signature": fingerprints.encode_args_signature,
        })
        _append_trials_metadata_line({
            "type": "search_meta",
            "marker_pair_index": markerPairIndex,
            "marker_pair_number": markerPairIndex + 1,
            "title_suffix": title_suffix,
            "codec": codec,
            "source_fps": source_fps,
            "clip_start": clip_start,
            "clip_end": clip_end,
            "final_frames_estimate": final_frames_estimate,
            "pair_identity": pair_identity,
            "target": {
                "mean": target.target_vmaf_mean,
                "low": target.target_vmaf_low,
                "low_percentile": target.target_vmaf_low_pct,
                "crf_min": target.crf_min,
                "crf_max": target.crf_max,
                "crf_absolute_max": target.crf_absolute_max,
            },
            "sample_windows": [
                {"start": w.start, "end": w.end, "duration": w.duration}
                for w in sample_windows
            ],
        })
        # Per-trial captures: keyed by trial number so on_trial_complete
        # can pair the per-frame data with the search's phase/passed verdict.
        pending_trial_per_frame: dict[int, list[float]] = {}
        pending_trial_window_indices: dict[int, list[int]] = {}

        # Drop trial encodes lacking a completed JSONL record:
        # those are partial files from a Ctrl-C / crash mid-encode,
        # and makeClip's ``mp["exists"]`` short-circuit would feed
        # them to VMAF as if they were good.
        trial_file_stem = f"{title_suffix}-{markerPairIndex + 1}"
        try:
            removed = cleanup_orphaned_trial_files(
                fingerprint_dir, trial_file_stem,
            )
            if removed:
                logger.info(
                    f""
                    f"cleaned up {len(removed)} orphan trial file(s) "
                    f"with no completed JSONL record (interrupted prior "
                    f"encodes)",
                )
        except OSError as exc:
            logger.verbose(
                f"orphan trial cleanup failed ({exc}); "
                f"existing trial files will be trusted as-is.",
            )

        # Always harvest trial measurements from any prior runs in
        # this fingerprint dir — independent of the cache decision.
        # Even a crashed prior (no search_result) might have produced
        # valid trial records before crashing; those measurements are
        # still byte-equivalent to what the current run would produce
        # at the same CRF, so they can short-circuit identical probes.
        # Net effect: fresh searches after partial prior runs still
        # benefit from the work that was done.
        primed_from_history = prime_trial_measurement_cache(
            fingerprint_dir=fingerprint_dir,
            file_name_stem=trial_file_stem,
        )
        if primed_from_history:
            trial_measurement_cache.update(primed_from_history)
            logger.verbose(
                f"primed {len(primed_from_history)} trial "
                f"measurements from prior history at "
                f"{LogPath(fingerprint_dir)} (used by partial-hit cache + by "
                f"the search loop's trial_measurement_cache)",
            )

        cached_result: SampleGuidedEncodeResult | None = None
        if cache_decision.kind == "full" and cache_decision.prior_run is not None:
            logger.info(
                f""
                f"cache HIT (full) — reusing prior run "
                f"{cache_decision.prior_run.run_id}, search skipped. "
                f"{cache_decision.reason}",
            )
            cached_result = reconstruct_result_from_jsonl(
                cache_decision.prior_run.run_jsonl_path,
                target=target,
                sample_windows=sample_windows,
                final_frames_estimate=final_frames_estimate,
            )
            # Mirror the prior trial records into the new run JSONL so
            # this run's file stands alone — future runs can partial-prime
            # off it without having to chase the chain back to the
            # original.
            try:
                with cache_decision.prior_run.run_jsonl_path.open(
                    "r", encoding="utf-8",
                ) as fp:
                    for raw_line in fp:
                        line = raw_line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if rec.get("type") == "trial":
                            _append_trials_metadata_line(rec)
            except OSError as exc:
                logger.verbose(
                    f"failed to mirror prior trials into "
                    f"new JSONL ({exc}); cache hit still proceeds.",
                )

            # Re-render the curve-fit chart from the reconstructed
            # probe data + current target, so a cache hit produces the
            # same visual a fresh search would. We rebuild the fit via
            # ``fit_curves`` (using the *current* target) rather than
            # replaying the cached ASCII chart string — adapts the red
            # target line if the user changed --target-vmaf-low between
            # runs, and survives any future improvements to the chart
            # rendering.
            if cached_result is not None and cached_result.optimal_crf is not None:
                _emit_chart_for_cached_result(
                    cached_result=cached_result,
                    target=target,
                    prior_jsonl_path=cache_decision.prior_run.run_jsonl_path,
                    fingerprint_dir=fingerprint_dir,
                    file_name_stem=f"{title_suffix}-{markerPairIndex + 1}",
                    middle_window_index=middle_window_index,
                    source_fps=source_fps,
                    codec=codec,
                )
        elif cache_decision.kind == "partial" and cache_decision.prior_run is not None:
            # Trial-measurement priming already happened above
            # (always-on harvest from the fingerprint dir). This branch
            # just logs the partial-hit verdict.
            logger.info(
                f""
                f"cache HIT (partial) — encoder matches, search params "
                f"differ; {len(primed_from_history)} trial measurements "
                f"primed from prior runs. {cache_decision.reason}",
            )
        elif cache_decision.prior_run is not None:
            # Gate failed but a prior parsed cleanly — name the
            # failing check.
            logger.info(
                f""
                f"cache MISS — prior run {cache_decision.prior_run.run_id} "
                f"found but stale; re-running fresh. "
                f"Reason: {cache_decision.reason}",
            )
        else:
            # No usable prior — either the fingerprint dir doesn't
            # exist, or it does but the most-recent file failed to
            # parse (predates the run_header schema, was truncated
            # mid-write, or crashed before writing search_result).
            # The decision's reason text distinguishes these cases.
            logger.info(
                f""
                f"cache MISS — {cache_decision.reason} "
                f"(running fresh; encoder_fp="
                f"{fingerprints.encoder_fingerprint}).",
            )

        def get_or_encode_reference_window(window_index: int) -> Path | None:
            """Return reference encode path for a single window, encoding lazily.

            ``None`` indicates encode failure; caller should propagate
            failure up so the search can fall back to a normal makeClip.
            """
            if window_index in reference_path_cache:
                return reference_path_cache[window_index]
            paths = _encode_windows_for_marker_pair(
                cs=cs,
                markerPairIndex=markerPairIndex,
                originalMarkerSnapshot=originalMarkerSnapshot,
                windows=sample_windows,
                settings_overrides={
                    **reference_picks,
                    **_TRIAL_PIPELINE_OVERRIDES,
                    # Surface "sample-guided encode — reference encode (crf=N
                    # wK)" on the spinner row instead of the generic
                    # "encoding" label. Including the CRF + window
                    # matches the format used by trial encodes (via
                    # the search tracker) and the baseline probe
                    # below — every sample-guided-context encode the
                    # operator sees on the spinner reads the same
                    # way.
                    "ffmpegProgressLabel": (
                        "sample-guided encode — reference encode "
                        f"(crf={reference_picks['crf']} "
                        f"w{window_index + 1} "
                        f"{sample_windows[window_index].start:.1f}"
                        f"-{sample_windows[window_index].end:.1f}s)"
                    ),
                },
                suffix_template=REFERENCE_SUFFIX_TEMPLATE,
                label=f"reference window {window_index + 1}",
                output_dir=fingerprint_dir,
                windows_to_encode=[window_index],
            )
            if not paths:
                return None
            ref_path = paths[0]
            reference_path_cache[window_index] = ref_path
            reference_size_cache[window_index] = (
                ref_path.stat().st_size if ref_path.is_file() else 0
            )
            return ref_path

        def encode_and_measure_window(
            crf: int,
            window_index: int,
        ) -> tuple[list[float], int, Path] | None:
            """Encode one (crf, window) and measure VMAF NEG vs the reference.

            Cached: returns the cached result on subsequent calls with the
            same key, so cross-phase candidate re-evaluation is free.
            Returns ``None`` on encode or measurement failure.
            """
            key = (crf, window_index)
            if key in trial_measurement_cache:
                return trial_measurement_cache[key]
            ref_path = get_or_encode_reference_window(window_index)
            if ref_path is None:
                return None
            paths = _encode_windows_for_marker_pair(
                cs=cs,
                markerPairIndex=markerPairIndex,
                originalMarkerSnapshot=originalMarkerSnapshot,
                windows=sample_windows,
                settings_overrides={
                    "crf": crf,
                    **_TRIAL_PIPELINE_OVERRIDES,
                    # ``sampleGuidedEncodeTrial=True`` tells the search
                    # tracker (via runffmpegCommand) this is a probe
                    # — bump the "trial N" counter and treat the
                    # label as a SUFFIX. Reference / baseline
                    # encodes omit this flag so their full label is
                    # shown verbatim, and the counter doesn't tick
                    # for them.
                    "sampleGuidedEncodeTrial": True,
                    # Suffix appended after the search tracker's
                    # "sample-guided encode — trial N" — surfaces the CRF +
                    # window of the currently-encoding probe on the
                    # spinner row so the operator can see context
                    # in real time. The ``start-end`` timestamps
                    # name *which* slice of the clip is being probed
                    # (sampled windows are scattered across the
                    # clip's middle 80%), so the operator can map
                    # the spinner back to the source video without
                    # cross-referencing the JSONL.
                    "ffmpegProgressLabel": (
                        f"(crf={crf} w{window_index + 1} "
                        f"{sample_windows[window_index].start:.1f}"
                        f"-{sample_windows[window_index].end:.1f}s)"
                    ),
                },
                suffix_template=TRIAL_SUFFIX_TEMPLATE,
                label=f"trial crf={crf} window {window_index + 1}",
                output_dir=fingerprint_dir,
                template_format_args={"crf": crf},
                windows_to_encode=[window_index],
            )
            if not paths:
                return None
            trial_path = paths[0]
            try:
                per_frame = measure_per_frame_vmaf_neg(
                    ffmpeg_path=ffmpeg_path,
                    reference_path=ref_path,
                    encoded_path=trial_path,
                )
            except Exception as exc:
                logger.warning(
                    f"VMAF measurement failed for window "
                    f"{window_index + 1} of trial crf={crf}: {exc}",
                )
                return None
            size_bytes = trial_path.stat().st_size if trial_path.is_file() else 0
            trial_measurement_cache[key] = (per_frame, size_bytes, trial_path)
            return per_frame, size_bytes, trial_path

        # ---- Outer search-progress tracker scope ---------------------------
        # Open ONE :class:`SearchProgressTracker` here — BEFORE the
        # eager middle-reference encode below — so EVERY ffmpeg
        # invocation in this search (eager reference, baseline, lazy
        # references, trials) sees the same active scope. Critically,
        # this also activates the filter-graph registry used by
        # ``substitute_filter_graphs`` in ``runffmpegCommand``: the
        # registry is bound by ``track_sample_guided_encode_progress``, so the
        # eager reference encode at line below would otherwise log its
        # full ``-vf "..."`` filter graph inline (no registry → no
        # substitution).
        #
        # Manual ``__enter__`` / ``__exit__`` instead of a ``with``
        # block to avoid re-indenting the ~500 lines of search +
        # baseline + result-finalization that follow.
        outer_search_progress_cm: Any = None
        if cached_result is None:
            outer_search_progress_cm = track_sample_guided_encode_progress()
            outer_search_progress_cm.__enter__()

        # Eagerly encode the middle reference up-front so Phase 1 starts
        # immediately. The other reference windows stay lazy so a clip
        # whose Phase 2 fails-fast (rare) hasn't paid for unused refs.
        if get_or_encode_reference_window(middle_window_index) is None:
            logger.warning(
                f"reference "
                f"encode failed for middle window; falling back to normal "
                f"makeClip without search.",
            )
            settings["markerPairs"][markerPairIndex] = copy.deepcopy(
                originalMarkerSnapshot,
            )
            return makeClip(cs, markerPairIndex)

        # Reference encode chart anchor: synthesize a probe-like
        # ``SampleGuidedEncodeTrial`` for the middle reference window so the
        # chart can plot a marker at (reference_crf, 100 VMAF,
        # reference_bitrate). The reference is the comparison ceiling
        # by definition (VMAF against itself is 100) — this gives the
        # operator a visual anchor for the high-quality end of the
        # curve without spending another encode. Bitrate is derived
        # from the existing reference's encoded size + window duration.
        ref_size_bytes = reference_size_cache.get(middle_window_index, 0)
        ref_window_frames = (
            round(sample_windows[middle_window_index].duration * source_fps)
            if source_fps > 0
            else 0
        )
        ref_duration_seconds = (
            ref_window_frames / source_fps
            if source_fps > 0 and ref_window_frames > 0
            else 0.0
        )
        ref_bitrate_kbps = (
            ref_size_bytes * 8 / ref_duration_seconds / 1000
            if ref_duration_seconds > 0
            else 0.0
        )
        reference_marker: SampleGuidedEncodeTrial | None = None
        if ref_size_bytes > 0 and ref_window_frames > 0:
            ref_summary = VmafSummary(
                mean=100.0, p1=100.0, p5=100.0, p10=100.0,
                p15=100.0, p20=100.0, p25=100.0,
                minimum=100.0, frame_count=ref_window_frames,
            )
            reference_marker = SampleGuidedEncodeTrial(
                crf=reference_crf,
                summary=ref_summary,
                encode_seconds=0.0,
                passed=False,
                low_pct_enforced=False,
                encoded_size_bytes=ref_size_bytes,
                size_percent_of_reference=100.0,
                windows_used=1,
                windows_total=1,
                phase="reference",
                bitrate_kbps=ref_bitrate_kbps,
            )

        # Trial counter shared across the evaluate_trial closure and the
        # per-trial completion callback so log lines say "phase1 trial 1, 2,
        # 3...; phase2 trial 4..." rather than just "trial crf=X" — easier
        # to track progress visually across phases.
        trial_counter = {"n": 0}

        # Tracks which trial numbers were fully primed from the cache
        # (every window had a measurement on hand before the encode loop
        # started). Used by ``on_trial_complete`` to render ``[cached]``
        # instead of ``[X.Xs]`` for those trials, so the log makes the
        # cache-vs-fresh distinction obvious at a glance.
        cached_trial_numbers: set[int] = set()

        def evaluate_trial_for_windows(
            crf: int,
            window_indices: list[int],
        ) -> TrialMeasurement:
            """Encode + measure ``window_indices`` for ``crf`` with caching.

            Progressive sampling within a trial: encodes windows one at a
            time, measures, and short-circuits once the verdict is
            confident. Cache hits are free (no re-encode, no re-measure)
            so when Phase 2 re-evaluates the Phase 1 candidate at all
            windows, the middle window costs nothing extra.
            """
            trial_counter["n"] += 1
            all_cached = all(
                (crf, w) in trial_measurement_cache for w in window_indices
            )
            if all_cached:
                cached_trial_numbers.add(trial_counter["n"])
            label = (
                "from prior-run cache"
                if all_cached
                else "single-window discovery"
                if len(window_indices) == 1
                else f"all {len(window_indices)} windows"
            )
            verb = "reusing" if all_cached else "encoding"
            logger.info(
                f"trial {trial_counter['n']}: {verb} crf={crf} ({label})...",
            )
            per_frame_combined: list[float] = []
            encoded_size_total = 0
            ref_size_total = 0
            paths: list[Path] = []
            windows_used = 0

            for window_index in window_indices:
                result = encode_and_measure_window(crf, window_index)
                if result is None:
                    # Skip this window but keep going — another may work,
                    # and even partial data is enough for pass/fail above
                    # the frame floor.
                    continue
                per_frame, size_bytes, trial_path = result
                per_frame_combined.extend(per_frame)
                encoded_size_total += size_bytes
                ref_size_total += reference_size_cache.get(window_index, 0)
                paths.append(trial_path)
                windows_used += 1
                partial_summary = summarize_vmaf(per_frame_combined)
                if is_trial_confidently_decided(partial_summary, target):
                    break

            summary = summarize_vmaf(per_frame_combined)
            # Stash per-frame data for the JSONL dump in on_trial_complete,
            # which knows phase + final passed verdict + encode_seconds.
            pending_trial_per_frame[trial_counter["n"]] = list(per_frame_combined)
            pending_trial_window_indices[trial_counter["n"]] = list(window_indices)
            # Bitrate at this CRF: bytes * 8 / duration_seconds / 1000.
            # Per-frame size scales linearly with frame count, so the
            # trial-subset kbps equals the full-encode kbps at the same
            # CRF — the prediction the curve-fit's bitrate sub-chart
            # plots and the joint-tuning logic compares against the
            # user's max-bitrate setting (when applicable).
            duration_seconds = (
                summary.frame_count / source_fps
                if source_fps > 0 and summary.frame_count > 0
                else 0.0
            )
            bitrate_kbps = (
                encoded_size_total * 8 / duration_seconds / 1000
                if duration_seconds > 0
                else 0.0
            )
            return TrialMeasurement(
                summary=summary,
                encoded_size_bytes=encoded_size_total,
                encoded_paths=paths,
                windows_used=windows_used,
                windows_total=len(window_indices),
                reference_size_bytes_for_windows=ref_size_total,
                bitrate_kbps=bitrate_kbps,
            )

        def on_trial_complete(trial: SampleGuidedEncodeTrial) -> None:
            # The search-level progress display advances its trial
            # counter inside ``run_trial_ffmpeg`` (on encode start),
            # not here — so the spinner can show the *current*
            # trial's CRF in real time rather than the previous
            # trial's. Nothing to do here for the progress display;
            # this callback only logs the per-trial summary line
            # below and persists the JSONL record.
            verdict = "PASS" if trial.passed else "FAIL"
            checks = f"mean+{low_pct_label}" if trial.low_pct_enforced else "mean only"
            # Show all six low percentiles for visibility; mark the one
            # actually being enforced so the user can see at a glance
            # whether the target threshold is being cleared.
            def _marker(pct: int) -> str:
                return "*" if target.target_vmaf_low_pct == pct else " "
            phase_label = f" [{trial.phase}]" if trial.phase else ""
            # Estimated full-encode size: per-frame bytes scale linearly
            # so total ≈ encoded_size_bytes * (final_frames /
            # trial_frames). Surfaces the picked CRF's predicted file
            # size next to its quality so operators can see both axes
            # of the trade-off without parsing the JSONL metadata.
            est_size_mb = (
                trial.encoded_size_bytes
                * (final_frames_estimate / trial.summary.frame_count)
                / (1024 * 1024)
                if trial.summary.frame_count > 0 and final_frames_estimate > 0
                else 0.0
            )
            # Render ``[cached]`` for fully-primed trials (no fresh
            # encode, no fresh VMAF measurement) so the log makes the
            # cache-vs-fresh distinction obvious at a glance instead
            # of looking like a buggy ``[0.0s]``.
            timing_tag = (
                "cached"
                if trial_counter["n"] in cached_trial_numbers
                else f"{trial.encode_seconds:.1f}s"
            )
            # Column-align per-trial metrics so trials read as a
            # vertical scan: trial number / crf / mean / each pX /
            # kbps / size / size% / frames / windows / verdict /
            # checks / timing each get a fixed width. Percentile
            # chunks use a 10-char column so ``*p1=92.30`` and
            # `` p10=92.30`` end at the same offset.
            def _pct_col(pct: int) -> str:
                val = getattr(trial.summary, f"p{pct}")
                chunk = f"{_marker(pct)}p{pct}={val:.2f}"
                # 11-char column absorbs the worst case ``*p10=100.00``
                # so chunks line up regardless of whether the percentile
                # is 1 / 5 (2-char name) or 10 / 15 / 20 / 25 (3-char).
                return f"{chunk:<11}"
            phase_prefix = f"{phase_label.lstrip()} " if phase_label else ""
            logger.info(
                f"{phase_prefix}trial {trial_counter['n']:>2}: "
                f"crf={trial.crf:>2} -> "
                f"mean={trial.summary.mean:>6.2f}  "
                f"{_pct_col(1)} {_pct_col(5)} {_pct_col(10)} "
                f"{_pct_col(15)} {_pct_col(20)} {_pct_col(25)} "
                f"kbps={trial.bitrate_kbps:>6.0f}  "
                f"est={est_size_mb:>5.1f}MB  "
                f"size={trial.size_percent_of_reference:>3.0f}%  "
                f"frames={trial.summary.frame_count:>5}  "
                f"win={trial.windows_used}/{trial.windows_total}  "
                f"{verdict} ({checks})  "
                f"[{timing_tag}]",
            )
            per_frame = pending_trial_per_frame.pop(trial_counter["n"], [])
            window_indices = pending_trial_window_indices.pop(trial_counter["n"], [])
            # ``trial.bitrate_kbps`` is now populated upstream; recompute
            # ``trial_duration_seconds`` here purely for the JSONL record.
            trial_duration_seconds = (
                trial.summary.frame_count / source_fps
                if source_fps > 0 and trial.summary.frame_count > 0
                else 0.0
            )
            _append_trials_metadata_line({
                "type": "trial",
                "trial_index": trial_counter["n"],
                "crf": trial.crf,
                "phase": trial.phase,
                "passed": trial.passed,
                "low_pct_enforced": trial.low_pct_enforced,
                "windows_used": trial.windows_used,
                "windows_total": trial.windows_total,
                "window_indices": window_indices,
                "frame_count": trial.summary.frame_count,
                "encode_seconds": round(trial.encode_seconds, 2),
                "size_percent_of_reference": round(trial.size_percent_of_reference, 2),
                "encoded_size_bytes": trial.encoded_size_bytes,
                "trial_duration_seconds": round(trial_duration_seconds, 3),
                "bitrate_kbps": round(trial.bitrate_kbps, 1),
                "summary": {
                    "mean": round(trial.summary.mean, 2),
                    "p1": round(trial.summary.p1, 2),
                    "p5": round(trial.summary.p5, 2),
                    "p10": round(trial.summary.p10, 2),
                    "p15": round(trial.summary.p15, 2),
                    "p20": round(trial.summary.p20, 2),
                    "p25": round(trial.summary.p25, 2),
                    "minimum": round(trial.summary.minimum, 2),
                },
                "per_frame_vmaf": [round(v, 2) for v in per_frame],
            })

        # (The outer ``SearchProgressTracker`` and its filter-graph
        # registry are already opened earlier — before the eager
        # middle-reference encode — so every ffmpeg invocation in
        # this search shares the same scope. See that block for the
        # rationale. The unmatched ``__exit__`` is at the bottom of
        # the search dispatch.)

        # ---- Baseline auto-pick probe -------------------------------------
        # Encode at the (CRF, max-bitrate) pair that yt_clipper would
        # auto-pick if --sample-guided-encode were OFF. Lets the operator
        # see "what the default would have given me" alongside the
        # curve-fit pick. With maxrate ENABLED for this trial only —
        # all other trials disable maxrate to measure pure CRF response.
        # Skipped on full cache hit — the prior run already produced
        # this baseline data.
        baseline_trial: SampleGuidedEncodeTrial | None = None
        if cached_result is None:
            try:
                source_bitrate_kbps = int(settings.get("bit_rate") or 0)
                auto_settings = getDefaultEncodeSettings(source_bitrate_kbps)
                auto_crf = int(auto_settings.get("crf", 30))
                auto_max_bitrate = int(auto_settings.get("autoTargetMaxBitrate", 0))
                if (
                    source_bitrate_kbps > 0
                    and target.crf_min <= auto_crf <= target.crf_absolute_max
                ):
                    baseline_overrides = {
                        # Inherit minterp/v2x/audio overrides — baseline must
                        # match the trial pipeline (no upscaling, no audio,
                        # source-fps) so its VMAF is comparable to the
                        # curve-fit probes' VMAF measurements.
                        **{
                            k: v
                            for k, v in _TRIAL_PIPELINE_OVERRIDES.items()
                            if k != "autoTargetMaxBitrate"
                        },
                        "crf": auto_crf,
                        "targetMaxBitrate": auto_max_bitrate,
                        "autoTargetMaxBitrate": auto_max_bitrate,
                        # See the reference-encode call site for
                        # rationale — the operator needs to know
                        # what's running on the spinner row.
                        "ffmpegProgressLabel": (
                            "sample-guided encode — baseline auto-pick "
                            f"(crf={auto_crf} "
                            f"maxrate={auto_max_bitrate}kbps "
                            f"w{middle_window_index + 1} "
                            f"{sample_windows[middle_window_index].start:.1f}"
                            f"-{sample_windows[middle_window_index].end:.1f}s)"
                        ),
                    }
                    baseline_paths = _encode_windows_for_marker_pair(
                        cs=cs,
                        markerPairIndex=markerPairIndex,
                        originalMarkerSnapshot=originalMarkerSnapshot,
                        windows=sample_windows,
                        settings_overrides=baseline_overrides,
                        suffix_template=".crfsearch-baseline",
                        label=(
                            f"baseline auto-pick crf={auto_crf} "
                            f"maxrate={auto_max_bitrate}kbps"
                        ),
                        output_dir=fingerprint_dir,
                        windows_to_encode=[middle_window_index],
                    )
                    if baseline_paths:
                        baseline_path = baseline_paths[0]
                        ref_path = get_or_encode_reference_window(middle_window_index)
                        if ref_path is not None:
                            try:
                                per_frame_baseline = measure_per_frame_vmaf_neg(
                                    ffmpeg_path=ffmpeg_path,
                                    reference_path=ref_path,
                                    encoded_path=baseline_path,
                                )
                                baseline_summary = summarize_vmaf(per_frame_baseline)
                                baseline_size_bytes = (
                                    baseline_path.stat().st_size
                                    if baseline_path.is_file()
                                    else 0
                                )
                                baseline_duration = (
                                    baseline_summary.frame_count / source_fps
                                    if source_fps > 0 and baseline_summary.frame_count > 0
                                    else 0.0
                                )
                                baseline_kbps = (
                                    baseline_size_bytes * 8 / baseline_duration / 1000
                                    if baseline_duration > 0
                                    else 0.0
                                )
                                baseline_trial = SampleGuidedEncodeTrial(
                                    crf=auto_crf,
                                    summary=baseline_summary,
                                    encode_seconds=0.0,
                                    passed=False,
                                    low_pct_enforced=False,
                                    encoded_size_bytes=baseline_size_bytes,
                                    size_percent_of_reference=0.0,
                                    windows_used=1,
                                    windows_total=1,
                                    phase="baseline",
                                    bitrate_kbps=baseline_kbps,
                                )
                                logger.info(
                                    f"baseline (yt_clipper auto-pick): "
                                    f"crf={auto_crf} maxrate={auto_max_bitrate}kbps -> "
                                    f"mean={baseline_summary.mean:.2f} "
                                    f"p{target.target_vmaf_low_pct}="
                                    f"{get_low_percentile_value(baseline_summary, target.target_vmaf_low_pct):.2f} "
                                    f"actual_kbps={baseline_kbps:.0f}",
                                )
                            except Exception as exc:
                                logger.warning(
                                    f"baseline VMAF measurement failed: {exc}",
                                )
            except Exception as exc:
                logger.warning(f"baseline auto-pick probe failed: {exc}")

        # ---- Run the search ------------------------------------------------
        # ``reference_size_bytes`` here is a best-effort total used for
        # full-windows trials. Per-trial measurements carry their own
        # ``reference_size_bytes_for_windows`` so subset-window trials
        # report accurate size%.
        full_reference_size_bytes = sum(reference_size_cache.values())
        algorithm = settings.get("sampleGuidedEncodeAlg") or "curve-fit"
        curve_fit_result: CurveFitSearchResult | None = None
        if cached_result is not None:
            # Full cache hit: skip the search entirely and use the
            # reconstructed result. The fit / chart records aren't
            # re-rendered here (the prior JSONL has them); future
            # runs would inherit them via the trial-mirror copy
            # earlier in this function.
            result = cached_result
        elif algorithm == "legacy-bisection":
            # Old strict-pass/fail Phase 1/2/3 architecture with cascade
            # fallback. Kept for rollback during the curve-fit transition;
            # selection happens via --sample-guided-encode-alg.
            #
            # The ``track_sample_guided_encode_progress`` context manager opens a
            # single Live display that spans every trial in the search,
            # so the operator sees ``sample-guided encode — trial N`` advance
            # across all probes plus the current trial's ffmpeg stats
            # line — instead of a fresh per-trial spinner that resets
            # every encode.
            with track_sample_guided_encode_progress():
                result = legacy_find_optimal_crf_two_phase(
                    target=target,
                    n_windows=len(sample_windows),
                    middle_window_index=middle_window_index,
                    evaluate_trial_for_windows=evaluate_trial_for_windows,
                    sample_windows=sample_windows,
                    reference_size_bytes=full_reference_size_bytes,
                    final_frames_estimate=final_frames_estimate,
                    on_trial_complete=on_trial_complete,
                )
        else:
            # Default: curve-fit. Probe a few CRFs with the middle window
            # only (1-window probes — curve-fit averages noise across CRF
            # points rather than across windows), fit piecewise / linear /
            # log models, pick via knee detection. The orchestrator's
            # ``evaluate_trial_for_windows`` does the encode + measure;
            # we wrap it in a single-window callback for the curve-fit
            # entry point.
            def probe_at_crf(crf: int) -> TrialMeasurement:
                return evaluate_trial_for_windows(crf, [middle_window_index])

            # See the legacy-bisection branch above for the
            # ``track_sample_guided_encode_progress`` rationale — same display
            # spans every curve-fit probe + refit + refinement trial.
            with track_sample_guided_encode_progress():
                result, curve_fit_result = find_crf_via_curve_fit(
                    target=target,
                    evaluate_at_crf=probe_at_crf,
                    on_trial_complete=on_trial_complete,
                    final_frames_estimate=final_frames_estimate,
                    reference_size_bytes=full_reference_size_bytes,
                    baseline_trial=baseline_trial,
                    reference_marker=reference_marker,
                )
            # Curve-fit fills the result without sample_windows (it
            # doesn't know about them); attach now. Also attach the
            # baseline trial here so the summary block's
            # delta-vs-baseline formatter can pull it without rescanning
            # trials (the baseline isn't a search probe and isn't part
            # of ``result.trials``).
            result = SampleGuidedEncodeResult(
                optimal_crf=result.optimal_crf,
                optimal_summary=result.optimal_summary,
                trials=result.trials,
                target=target,
                sample_windows=sample_windows,
                reference_size_bytes=full_reference_size_bytes,
                search_frames=result.search_frames,
                final_frames_estimate=final_frames_estimate,
                search_seconds=result.search_seconds,
                baseline_trial=baseline_trial,
            )
            # Append the fit + picks to the JSONL metadata so the
            # search file is self-describing for offline analysis.
            _append_trials_metadata_line({
                "type": "fit",
                "algorithm": "curve-fit",
                "low_pct": curve_fit_result.fit.low_pct,
                "valid_probe_crfs": [
                    p.crf for p in curve_fit_result.fit.valid_probes
                ],
                "linear_slope": round(curve_fit_result.fit.linear_slope, 4),
                "linear_intercept": round(curve_fit_result.fit.linear_intercept, 4),
                "log_slope": round(curve_fit_result.fit.log_slope, 4),
                "log_intercept": round(curve_fit_result.fit.log_intercept, 4),
                "picks": {
                    model: dict(pick_map)
                    for model, pick_map in
                    curve_fit_result.picks.by_curve_and_heuristic.items()
                },
                "chosen_curve": curve_fit_result.picks.chosen_curve,
                "chosen_heuristic": curve_fit_result.picks.chosen_heuristic,
                "chosen_crf": curve_fit_result.picks.chosen_crf,
                "refit_reasons": curve_fit_result.refit_reasons,
                "compressibility": (
                    {
                        "mean_kbps_per_vmaf": round(
                            curve_fit_result.compressibility.mean_kbps_per_vmaf,
                            1,
                        ),
                        "at_chosen_crf_kbps_per_vmaf": (
                            round(
                                curve_fit_result
                                .compressibility
                                .at_chosen_crf_kbps_per_vmaf,
                                1,
                            )
                            if curve_fit_result.compressibility.at_chosen_crf_kbps_per_vmaf
                            is not None
                            else None
                        ),
                        "segments": [
                            {
                                "lo_crf": lo,
                                "hi_crf": hi,
                                "kbps_per_vmaf": round(score, 1),
                            }
                            for lo, hi, score in
                            curve_fit_result.compressibility.segments
                        ],
                    }
                    if curve_fit_result.compressibility is not None
                    else None
                ),
                "ascii_chart": render_curve_ascii(
                    curve_fit_result.fit,
                    target=target,
                    chosen_crf=curve_fit_result.picks.chosen_crf,
                    baseline=baseline_trial,
                    reference=reference_marker,
                ),
                "baseline": (
                    {
                        "crf": baseline_trial.crf,
                        "bitrate_kbps": round(baseline_trial.bitrate_kbps, 1),
                        "encoded_size_bytes": baseline_trial.encoded_size_bytes,
                        # Frame count goes top-level on the baseline
                        # dict (matching the trial-record schema where
                        # ``summary`` is just percentiles and
                        # ``frame_count`` lives at the record level).
                        # Needed by cache replay so the
                        # delta-vs-baseline line can extrapolate the
                        # baseline's projected full-encode size.
                        "frame_count": baseline_trial.summary.frame_count,
                        "summary": {
                            "mean": round(baseline_trial.summary.mean, 2),
                            "p1": round(baseline_trial.summary.p1, 2),
                            "p5": round(baseline_trial.summary.p5, 2),
                            "p10": round(baseline_trial.summary.p10, 2),
                            "p15": round(baseline_trial.summary.p15, 2),
                            "p20": round(baseline_trial.summary.p20, 2),
                            "p25": round(baseline_trial.summary.p25, 2),
                            "minimum": round(baseline_trial.summary.minimum, 2),
                        },
                    }
                    if baseline_trial is not None
                    else None
                ),
            })

        # Close the outer search-progress tracker (opened before
        # baseline). All encodes belonging to this search have
        # completed by this point; the JSONL tail below does no
        # encoding, so keeping the Live region closed during that
        # avoids needlessly redrawing it.
        if outer_search_progress_cm is not None:
            outer_search_progress_cm.__exit__(None, None, None)

        # Tail of the trials JSONL: the search verdict + summary stats so
        # the file is self-contained for offline analysis without needing
        # to also parse the run's stdout / log.
        # The kbps@tgt cross-config efficiency metric, persisted alongside
        # the picked CRF. The auto-delta render in a later phase reads this
        # back from prior-run JSONLs and re-interpolates against the current
        # run's target VMAF for an apples-to-apples comparison.
        kbps_at_target_vmaf = _interpolate_kbps_at_target_vmaf(
            result.trials,
            target.target_vmaf_low,
            target.target_vmaf_low_pct,
        )
        _append_trials_metadata_line({
            "type": "search_result",
            "optimal_crf": result.optimal_crf,
            "optimal_summary": (
                {
                    "mean": round(result.optimal_summary.mean, 2),
                    "p1": round(result.optimal_summary.p1, 2),
                    "p5": round(result.optimal_summary.p5, 2),
                    "p10": round(result.optimal_summary.p10, 2),
                    "p15": round(result.optimal_summary.p15, 2),
                    "p20": round(result.optimal_summary.p20, 2),
                    "p25": round(result.optimal_summary.p25, 2),
                    "minimum": round(result.optimal_summary.minimum, 2),
                    "frame_count": result.optimal_summary.frame_count,
                }
                if result.optimal_summary is not None
                else None
            ),
            "kbps_at_target_vmaf": (
                round(kbps_at_target_vmaf, 2)
                if kbps_at_target_vmaf is not None
                else None
            ),
            "trial_count": len(result.trials),
            "search_seconds": round(result.search_seconds, 2),
            "search_frames": result.search_frames,
            "final_frames_estimate": result.final_frames_estimate,
        })

        # ---- Auto-delta: load prior-run history for this clip ------------
        # Scans sibling fingerprint directories under ``pair_dir`` for
        # other distinct configurations and builds one delta row per. Each
        # prior run's kbps@tgt is re-interpolated at the CURRENT target
        # VMAF, so the comparison stays apples-to-apples even when the
        # user changed --target-vmaf-low between runs. Failures here are
        # non-fatal — the search succeeded; we just won't render deltas.
        prior_run_deltas: tuple[PriorRunDelta, ...] = ()
        try:
            prior_runs = load_prior_runs(
                pair_dir,
                low_pct=target.target_vmaf_low_pct,
                exclude_fingerprint=fingerprints.encoder_fingerprint,
            )
            if prior_runs:
                prior_run_deltas = tuple(
                    compute_prior_run_deltas(
                        prior_runs=prior_runs,
                        current_encoder_config=fingerprints.encoder_config,
                        current_kbps_at_target=kbps_at_target_vmaf,
                        current_picked_crf=result.optimal_crf,
                        current_target_vmaf_low=target.target_vmaf_low,
                    ),
                )
        except OSError as exc:
            logger.verbose(
                f"could not load prior runs for delta render "
                f"({exc}); skipping auto-delta block.",
            )

        # ---- Final encode at the chosen CRF (full pipeline restored) -------
        final_crf = result.optimal_crf if result.optimal_crf is not None else target.crf_min
        # Sample-vs-final ratio shows whether sampling was actually saving
        # work. Small ratio (~10-20%) = sampling paid off. Large ratio
        # (>50%) = consider full-clip trials or fewer / smaller windows.
        sample_ratio_pct = (
            result.search_frames / result.final_frames_estimate * 100.0
            if result.final_frames_estimate > 0
            else 0.0
        )
        if result.optimal_crf is None or result.optimal_summary is None:
            logger.warning(
                f"no trial "
                f"cleared targets even at crf={target.crf_min}; final encode "
                f"will use crf={target.crf_min} (best effort). "
                f"[{len(result.trials)} trials, "
                f"{result.search_seconds:.1f}s, "
                f"{result.search_frames} search frames vs "
                f"~{result.final_frames_estimate} final frames "
                f"({sample_ratio_pct:.0f}%)]",
            )
        else:
            optimal_low_value = get_low_percentile_value(
                result.optimal_summary,
                target.target_vmaf_low_pct,
            )
            # If refinement-relaxation accepted a measurement below the
            # user's strict target, surface the shortfall explicitly so
            # the operator sees we traded quality for speed. The
            # annotation is folded into the existing trial-summary
            # bracket because the rich logger treats bracketed content
            # starting with a word as broken markup and strips it; the
            # trial summary starts with a digit so it survives intact.
            mean_shortfall = target.target_vmaf_mean - result.optimal_summary.mean
            low_shortfall = target.target_vmaf_low - optimal_low_value
            shortfall_note = ""
            if mean_shortfall > 0 or low_shortfall > 0:
                missed_axes: list[str] = []
                if mean_shortfall > 0:
                    missed_axes.append(f"mean -{mean_shortfall:.2f}")
                if low_shortfall > 0:
                    missed_axes.append(f"{low_pct_label} -{low_shortfall:.2f}")
                shortfall_note = (
                    f", refined below strict target: {', '.join(missed_axes)}"
                )
            # Pull bitrate + estimated final size from the trial that
            # matches the picked CRF (cache hit guarantees one exists).
            optimal_trial = next(
                (t for t in result.trials if t.crf == result.optimal_crf),
                None,
            )
            optimal_bitrate_kbps = (
                optimal_trial.bitrate_kbps if optimal_trial is not None else 0.0
            )
            optimal_est_size_mb = (
                optimal_trial.encoded_size_bytes
                * (result.final_frames_estimate / optimal_trial.summary.frame_count)
                / (1024 * 1024)
                if optimal_trial is not None
                and optimal_trial.summary.frame_count > 0
                and result.final_frames_estimate > 0
                else 0.0
            )
            logger.report(
                f"optimal "
                f"crf={final_crf} mean={result.optimal_summary.mean:.2f} "
                f"{low_pct_label}={optimal_low_value:.2f} "
                f"(p1={result.optimal_summary.p1:.2f} "
                f"p10={result.optimal_summary.p10:.2f}) "
                f"bitrate={optimal_bitrate_kbps:.0f}kbps "
                f"est_size={optimal_est_size_mb:.1f}MB "
                f"[{len(result.trials)} trials, "
                f"{result.search_seconds:.1f}s, "
                f"{result.search_frames} search frames vs "
                f"~{result.final_frames_estimate} final frames "
                f"({sample_ratio_pct:.0f}%)"
                f"{shortfall_note}]",
            )
            # Stash the optimal CRF so the next marker pair's search can
            # seed off it. Only when the search converged successfully —
            # we don't want a fallback ``crf_min`` from a failed search
            # poisoning the next pair's starting bound.
            settings[_PRIOR_OPTIMAL_CRF_SETTING_KEY] = result.optimal_crf

        settings["markerPairs"][markerPairIndex] = copy.deepcopy(
            originalMarkerSnapshot,
        )
        # User-visible final encode: full pipeline (minterp / v2x / audio
        # all restored from the snapshot), and our chosen CRF wins via
        # the user-flag merge order in updateEncodeSettings.
        #
        # Disable the max-bitrate cap on the final encode under
        # --sample-guided-encode. Trials already measure with the cap
        # disabled (see ``_TRIAL_PIPELINE_OVERRIDES``); if the final
        # encode then has a binding cap, the encoder uses fewer bits at
        # the picked CRF and the per-frame VMAF drops below what trials
        # measured. The search's prediction would no longer match
        # reality. By disabling the cap on the final too, the picked
        # CRF reliably produces the quality the search measured. The
        # user retains control via --target-vmaf-low (raise it for
        # smaller files at the same CRF, lower it for larger files).
        original_user_crf = settings.get("crf")
        original_target_max_bitrate = settings.get("targetMaxBitrate")
        original_auto_target_max_bitrate = settings.get("autoTargetMaxBitrate")
        # Capture the run-start mtime so the sidecar UX below can
        # detect whether makeClip actually encoded vs skipped (any
        # file produced or modified since this point is "fresh").
        # Subtract 1s of slack to absorb filesystem mtime granularity.
        encode_decision_threshold = time.time() - 1.0
        try:
            settings["crf"] = final_crf
            settings["targetMaxBitrate"] = 0
            settings["autoTargetMaxBitrate"] = 0
            logger.rule(title=f"Encode ({markerPairIndex + 1})", sub=True)
            final_marker = makeClip(cs, markerPairIndex)
        finally:
            if original_user_crf is None:
                settings.pop("crf", None)
            else:
                settings["crf"] = original_user_crf
            if original_target_max_bitrate is None:
                settings.pop("targetMaxBitrate", None)
            else:
                settings["targetMaxBitrate"] = original_target_max_bitrate
            if original_auto_target_max_bitrate is None:
                settings.pop("autoTargetMaxBitrate", None)
            else:
                settings["autoTargetMaxBitrate"] = original_auto_target_max_bitrate

        # ---- Final-encode sidecar UX --------------------------------------
        # Compare the on-disk output against the encoder fingerprint +
        # picked CRF this run computed. If makeClip actually encoded
        # (file mtime is newer than ``encode_decision_threshold``), write
        # a fresh sidecar reflecting this run. If makeClip skipped
        # because the file already existed and overwrite was off, read
        # the sidecar and log a NOTICE / WARNING describing whether the
        # existing file matches current settings.
        if final_marker is not None and final_crf is not None:
            output_path_str = final_marker.get("filePath")
            if output_path_str:
                _emit_final_encode_sidecar_signal(
                    output_path=Path(output_path_str),
                    fingerprints=fingerprints,
                    picked_crf=final_crf,
                    encode_decision_threshold=encode_decision_threshold,
                )

        # ---- Per-clip headline ---------------------------------------------
        # NOTICE-level one-liner: picked CRF + key VMAF metrics + bitrate
        # + output file. Lands in the on-disk Summary Report so the
        # operator can scan every clip's outcome without parsing the full
        # aggregate table. Skipped if the search failed or if the encode
        # didn't actually produce a file.
        encoded_ok = final_marker is not None and (
            final_marker.get("returncode") == 0 or final_marker.get("exists")
        )
        if (
            encoded_ok
            and result.optimal_summary is not None
            and result.optimal_crf is not None
            and final_marker is not None
        ):
            optimal = result.optimal_summary
            target_pct_label = f"p{target.target_vmaf_low_pct}"
            low_value = get_low_percentile_value(optimal, target.target_vmaf_low_pct)
            kbps_str = ""
            for trial in result.trials:
                if trial.crf == result.optimal_crf:
                    kbps_str = f"  kbps={trial.bitrate_kbps:.0f}"
                    break
            file_name = final_marker.get("fileName", "")
            logger.notice(
                f"done: crf={result.optimal_crf}  mean={optimal.mean:.2f}  "
                f"{target_pct_label}={low_value:.2f}{kbps_str}  "
                f"-> {LogPath(file_name)}",
            )

        # Stash the search result on the returned marker so the makeClips
        # loop can collect it for the cross-clip aggregate summary. The
        # auto-delta rows also ride along here — clip_maker passes them
        # through to the ``ClipSearchSummary`` it builds, and the
        # formatter renders them as a block under the main summary table.
        if final_marker is not None:
            final_marker["sampleGuidedEncodeResult"] = result
            final_marker["priorRunDeltas"] = prior_run_deltas
        return final_marker
    except Exception as exc:
        logger.warning(
            f"marker pair {markerPairIndex + 1} failed "
            f"(non-fatal, falling back to normal makeClip): {exc}",
        )
        settings["markerPairs"][markerPairIndex] = copy.deepcopy(
            originalMarkerSnapshot,
        )
        from clipper.clip_maker import makeClip as _makeClip

        return _makeClip(cs, markerPairIndex)


def _resolve_source_fps(settings: dict[str, Any]) -> float:
    """Best-effort source FPS resolution from settings.

    Returns 0.0 if unknown — ``select_sample_windows`` falls back to
    full-clip sampling in that case.
    """
    raw = settings.get("r_frame_rate") or settings.get("avg_frame_rate")
    if not raw:
        return 0.0
    try:
        return float(Fraction(raw))
    except (ValueError, ZeroDivisionError, TypeError):
        return 0.0


def _encode_windows_for_marker_pair(  # noqa: PLR0913 — keyword-only params; bundling into a config object obscures call sites
    *,
    cs: ClipperState,
    markerPairIndex: int,
    originalMarkerSnapshot: dict[str, Any],
    windows: list[SampleWindow],
    settings_overrides: dict[str, Any],
    suffix_template: str,
    label: str,
    output_dir: Path,
    template_format_args: dict[str, Any] | None = None,
    on_window_encoded: Callable[[int, Path], bool] | None = None,
    windows_to_encode: list[int] | None = None,
) -> list[Path]:
    """Encode each sample window via makeClip with overridden settings.

    ``output_dir`` is the directory the encoded ``.webm`` files land in.
    Caller passes the per-fingerprint ``trials/`` or ``refs/`` subdir
    so trial encodes group with the encoder configuration that produced
    them — the granular reuse story for the future cache-gate phase.
    The directory is created on first use.

    Restores a fresh deep-copy of the marker snapshot before each window
    so ``getMarkerPairSettings``'s non-idempotent mutations don't compound
    across iterations (it shifts ``mp.start/end`` by ``mps.delay``,
    multiplies the crop by ``cropMultipleX/Y``, mutates speedMap point
    x-coords). Returns the list of produced output paths in window order;
    on failure to produce any one window's output, returns an empty list
    so the caller can short-circuit.

    ``on_window_encoded`` is the progressive-sampling hook: called after
    each successful per-window encode with ``(window_index, output_path)``.
    If it returns ``True``, the loop short-circuits and skips remaining
    windows. Used by the trial-evaluation flow to measure VMAF after each
    window and exit early once the verdict is confident, saving 33-67%
    of trial encode time on clearly easy or clearly hard clips.

    ``windows_to_encode`` is an optional index filter: when provided, only
    those window indices are encoded (in the order given); the suffix and
    ``on_window_encoded`` callback still receive the *global* window
    index from ``windows`` so cached / measured artifacts stay aligned
    with the original sample-window list. Used by the two-phase search
    flow to encode only the middle window in Phase 1, then specific
    additional windows in Phase 2/3, while keeping suffix-based on-disk
    caches consistent across phases.
    """
    from clipper.clip_maker import makeClip

    settings = cs.settings
    template_format_args = template_format_args or {}
    saved_settings = {key: settings.get(key) for key in settings_overrides}
    output_paths: list[Path] = []

    # Caller-provided per-fingerprint output dir keeps trial/ref encodes
    # grouped with the configuration that produced them.
    output_dir.mkdir(parents=True, exist_ok=True)
    trial_output_dir_str = str(output_dir)

    indices_to_encode = (
        list(windows_to_encode) if windows_to_encode is not None else list(range(len(windows)))
    )

    try:
        for key, value in settings_overrides.items():
            settings[key] = value

        for window_index in indices_to_encode:
            window = windows[window_index]
            settings["markerPairs"][markerPairIndex] = copy.deepcopy(
                originalMarkerSnapshot,
            )
            mp = settings["markerPairs"][markerPairIndex]
            mp["start"] = window.start
            mp["end"] = window.end
            # Mirror trial-pipeline overrides into mp["overrides"] too.
            # ``getMarkerPairSettings`` builds mps as
            # ``{**settings, **mp["overrides"]}``, so marker-pair JSON
            # overrides take precedence — without this mirror, a clip
            # whose JSON sets ``minterpFpsMultiplier`` (or any other
            # override key we want to disable) would have minterp leak
            # through into trial encodes despite our settings-level
            # disable. The deep copy of ``originalMarkerSnapshot`` per
            # iteration means these mutations don't compound across
            # windows or trials.
            mp_overrides = mp.get("overrides")
            if isinstance(mp_overrides, dict):
                mp_overrides.update(settings_overrides)

            suffix = suffix_template.format(
                window_index=window_index,
                **template_format_args,
            )
            # VERBOSE-level so non-verbose runs only see per-trial summary
            # lines, not 3+ window-encoding announcements per trial. The
            # important info (which trial passed, final CRF) stays at
            # NOTICE / REPORT.
            logger.verbose(
                f"encoding {label} window {window_index + 1}/"
                f"{len(windows)} suffix={suffix} "
                f"range=[{window.start:.3f}, {window.end:.3f}]",
            )
            marker = makeClip(
                cs,
                markerPairIndex,
                outputSuffix=suffix,
                outputDir=trial_output_dir_str,
            )
            if not marker:
                logger.warning(
                    f"{label} window {window_index + 1} "
                    f"produced no marker; aborting this pass.",
                )
                return []
            file_path = marker.get("filePath")
            if not file_path or not Path(file_path).is_file():
                logger.warning(
                    f"{label} window {window_index + 1} did "
                    f"not produce a file at {LogPath(file_path)}; aborting this pass.",
                )
                return []
            output_paths.append(Path(file_path))
            if on_window_encoded is not None and on_window_encoded(
                window_index,
                Path(file_path),
            ):
                # Progressive-sampling early exit — caller has decided
                # the verdict is confident enough that further windows
                # would just be extra encode work.
                break
        return output_paths
    finally:
        for key, original in saved_settings.items():
            if original is None:
                settings.pop(key, None)
            else:
                settings[key] = original
