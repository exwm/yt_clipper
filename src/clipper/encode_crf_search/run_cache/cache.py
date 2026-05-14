"""Cache-reuse evaluation: freshness gate + full / partial hit data.

Phase 4. The read-side counterpart to phase 2's storage layout +
phase 3's auto-delta. Decides whether a current run can short-
circuit work by reusing a prior run's data:

- **Full hit** ⇒ skip the search entirely. Same encoder fingerprint
  AND same search fingerprint AND every freshness gate field
  matches. Reconstructs a ``CrfSearchResult`` from the prior JSONL
  and returns it; the orchestrator proceeds straight to the final
  encode at the prior's picked CRF.
- **Partial hit** ⇒ same encoder fingerprint, different search
  fingerprint (e.g. user changed ``--crf-search-target-vmaf-low``). Trial
  encodes are byte-equivalent — we can prime
  ``trial_measurement_cache`` with the prior run's per-frame VMAF
  measurements at each (crf, window_index) so the new search
  reuses them and only encodes new CRFs.
- **Miss** ⇒ no usable prior, OR a prior was found but a freshness
  gate failed. The reason string is logged at INFO so operators
  can see why reuse didn't happen.

The freshness gate is intentionally strict (the user's principle:
"err on the side of re-encoding"). Every check must pass:

- ``algorithm_version`` exact match
- ``yt_clipper_version`` major-minor match (patch updates are
  presumed bug-fix-only)
- Source video identity match (path + mtime, or a similar identity
  the caller passes through ``current_pair_identity``)
- Marker timing match (``clip_start`` / ``clip_end`` within 1ms)
- ``encode_args_signature`` literal equality (hash-collision
  defense)
- Prior run completed (has a ``search_result`` record — guaranteed
  by the loader, but documented here for clarity)
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from .history import PriorRun, _parse_prior_run

if TYPE_CHECKING:
    from ..types import (
        CrfSearchResult,
        CrfSearchTarget,
        CrfSearchTrial,
        SampleWindow,
        VmafSummary,
    )

# Marker timing comparisons within this many seconds count as a
# match. Marker pairs are floats from the markers JSON; round-trip
# through JSON serialization can introduce sub-millisecond rounding.
_PAIR_TIMING_EPSILON_SECONDS: float = 0.001


@dataclass(frozen=True)
class CacheReuseDecision:
    """Outcome of the cache-reuse evaluation for one marker pair.

    - ``kind="full"``: caller should skip the search and use the
      reconstructed ``CrfSearchResult`` available via
      ``full_hit_reconstruct``. Final encode proceeds normally.
    - ``kind="partial"``: caller should run the search but prime
      ``trial_measurement_cache`` from the prior run via
      ``partial_hit_prime_cache``.
    - ``kind="miss"``: no reuse, run fresh.

    ``reason`` is human-readable, suitable for logging. Always
    populated, including on hits (so the log line shows what made
    the hit valid).
    """

    kind: Literal["full", "partial", "miss"]
    prior_run: PriorRun | None
    reason: str


def evaluate_cache_reuse(
    *,
    pair_dir: Path,
    encoder_fingerprint: str,
    encoder_signature: dict[str, Any],
    search_fingerprint: str,
    algorithm_version: int,
    yt_clipper_version: str,
    current_pair_identity: dict[str, Any],
    low_pct: int,
) -> CacheReuseDecision:
    """Evaluate whether a prior run can be reused for the current run.

    Looks under ``<pair_dir>/<encoder_fingerprint>/`` (the same
    directory the current run will write into) for the most-recent
    completed prior run, then runs every freshness gate check
    against it. The encoder fingerprint already pins us to the
    "byte-equivalent encodes" partition of history, so the gate is
    really verifying that *this specific* prior is fresh enough to
    trust — not "is there any prior we could reuse."
    """
    fingerprint_dir = pair_dir / encoder_fingerprint
    if not fingerprint_dir.is_dir():
        return CacheReuseDecision(
            kind="miss",
            prior_run=None,
            reason="no prior runs found at this encoder fingerprint",
        )
    run_files = sorted(fingerprint_dir.glob("run-*.jsonl"))
    if not run_files:
        return CacheReuseDecision(
            kind="miss",
            prior_run=None,
            reason="fingerprint dir exists but contains no run files",
        )
    # Walk from most-recent to oldest, returning the first that parses
    # cleanly. Resilient to crashed-mid-run orphan files: a partial
    # JSONL from an interrupted run shouldn't poison cache lookups
    # forever; we just skip it and try the next one. The verbose log
    # in ``_parse_prior_run`` reports each skip with a reason so the
    # operator can clean up if they want, but reuse keeps working.
    prior: PriorRun | None = None
    skipped_count = 0
    for run_file in reversed(run_files):
        prior = _parse_prior_run(run_file, low_pct)
        if prior is not None:
            break
        skipped_count += 1
    if prior is None:
        return CacheReuseDecision(
            kind="miss",
            prior_run=None,
            reason=(
                f"all {len(run_files)} prior run file(s) at this "
                f"fingerprint are incomplete or unreadable "
                f"(see -v output for per-file reasons)"
            ),
        )
    if skipped_count > 0:
        # A valid prior was found, but we walked past N broken ones.
        # Worth flagging so the operator knows there's orphaned data.
        # The decision is still a hit/miss based on the valid prior;
        # this is just provenance.
        from clipper.log_helpers import LogPath
        from clipper.ytc_logger import logger
        logger.verbose(
            f"run-cache: skipped {skipped_count} unreadable run file(s) "
            f"at {LogPath(fingerprint_dir)} before finding a valid prior "
            f"({prior.run_id}). Stale files can be deleted safely.",
        )

    ok, gate_reason = _freshness_gate_passes(
        prior=prior,
        current_algorithm_version=algorithm_version,
        current_yt_clipper_version=yt_clipper_version,
        current_encoder_signature=encoder_signature,
        current_pair_identity=current_pair_identity,
    )
    if not ok:
        return CacheReuseDecision(
            kind="miss", prior_run=prior, reason=gate_reason,
        )

    if prior.search_fingerprint == search_fingerprint:
        return CacheReuseDecision(
            kind="full",
            prior_run=prior,
            reason="all freshness gates passed; full encoder + search match",
        )
    return CacheReuseDecision(
        kind="partial",
        prior_run=prior,
        reason=(
            "encoder match (trial encodes reusable); search params differ "
            f"(prior search_fp={prior.search_fingerprint}, current={search_fingerprint})"
        ),
    )


def _freshness_gate_passes(
    *,
    prior: PriorRun,
    current_algorithm_version: int,
    current_yt_clipper_version: str,
    current_encoder_signature: dict[str, Any],
    current_pair_identity: dict[str, Any],
) -> tuple[bool, str]:
    """Strict freshness gate for cache reuse.

    Returns ``(ok, reason)``. On failure, ``reason`` names the
    specific check that failed so the log line can explain why we
    re-ran fresh — turns "cache miss" into "cache miss because X."
    On pass, ``reason`` describes which checks succeeded for sanity.
    """
    if prior.algorithm_version != current_algorithm_version:
        return False, (
            f"algorithm_version={prior.algorithm_version} "
            f"< current={current_algorithm_version} "
            f"(curve-fit logic changed; prior picks may be wrong)"
        )
    if not _major_minor_matches(prior.yt_clipper_version, current_yt_clipper_version):
        return False, (
            f"yt_clipper_version={prior.yt_clipper_version} "
            f"!= current={current_yt_clipper_version} "
            f"(major or minor differs; encoder behavior may have shifted)"
        )
    if prior.encode_args_signature != current_encoder_signature:
        return False, (
            "encode_args_signature mismatch (hash collision or "
            "fingerprint derivation drift; refusing to reuse)"
        )
    pair_ok, pair_reason = _pair_identity_matches(
        prior.pair_identity, current_pair_identity,
    )
    if not pair_ok:
        return False, pair_reason
    return True, (
        "algorithm_version + yt_clipper_version + encode_args_signature + "
        "pair_identity all match"
    )


def _major_minor_matches(prior_version: str, current_version: str) -> bool:
    """Loose version match: ``X.Y.*`` of prior must equal ``X.Y.*``
    of current. Patch differences are ignored — bug fixes shouldn't
    invalidate the cache.

    Returns ``False`` for empty / malformed versions (defensive: a
    missing version means we don't know what produced the prior, so
    treat it as stale).
    """
    if not prior_version or not current_version:
        return False
    prior_parts = prior_version.split(".")
    current_parts = current_version.split(".")
    if len(prior_parts) < 2 or len(current_parts) < 2:
        return False
    return prior_parts[:2] == current_parts[:2]


def _pair_identity_matches(
    prior: dict[str, Any], current: dict[str, Any],
) -> tuple[bool, str]:
    """Match marker timing within an epsilon, plus source video id
    exact match. Source video id is the dict shape the orchestrator
    writes (path + mtime); we compare structurally rather than
    field-by-field to keep this future-proof.
    """
    prior_start = float(prior.get("clip_start", 0.0))
    prior_end = float(prior.get("clip_end", 0.0))
    current_start = float(current.get("clip_start", 0.0))
    current_end = float(current.get("clip_end", 0.0))
    if abs(prior_start - current_start) > _PAIR_TIMING_EPSILON_SECONDS:
        return False, (
            f"clip_start mismatch (prior={prior_start}, current={current_start}; "
            "marker pair index may have shifted)"
        )
    if abs(prior_end - current_end) > _PAIR_TIMING_EPSILON_SECONDS:
        return False, (
            f"clip_end mismatch (prior={prior_end}, current={current_end}; "
            "marker pair index may have shifted)"
        )
    prior_source = prior.get("source_video_id") or {}
    current_source = current.get("source_video_id") or {}
    if prior_source != current_source:
        return False, (
            "source_video_id mismatch (input video changed: different "
            f"path / mtime — prior={prior_source}, current={current_source})"
        )
    return True, "pair_identity matches"


# ---------------------------------------------------------------------------
# Full-hit reconstruction
# ---------------------------------------------------------------------------


def reconstruct_result_from_jsonl(  # noqa: PLR0912 — straight-line record dispatch + summary fallback
    jsonl_path: Path,
    *,
    target: CrfSearchTarget,
    sample_windows: list[SampleWindow],
    final_frames_estimate: int,
) -> CrfSearchResult | None:
    """Rebuild a ``CrfSearchResult`` from a prior run's JSONL.

    For full cache hits — caller drops the result into the same slot
    the search loop would have populated, so downstream code (final
    encode, JSONL write, log render) doesn't need to know the result
    came from the cache.

    Reconstructs all trial records into ``CrfSearchTrial`` objects
    so the kbps@tgt interpolator and the per-trial summary line
    have data to chew on. Returns ``None`` if the JSONL is missing
    the required ``search_result`` record (already filtered by
    ``_parse_prior_run`` earlier in the pipeline, but defensive
    re-check here makes this function safe to call directly).
    """
    # Local imports to avoid the encoder-search ↔ types ↔ cache cycle.
    from ..types import (
        CrfSearchResult,
        CrfSearchTrial,
        VmafSummary,
    )

    trials: list[CrfSearchTrial] = []
    result_record: dict[str, Any] | None = None
    fit_baseline_record: dict[str, Any] | None = None
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
                rec_type = rec.get("type")
                if rec_type == "trial":
                    trial = _trial_from_record(
                        rec, CrfSearchTrial, VmafSummary,
                    )
                    if trial is not None:
                        trials.append(trial)
                elif rec_type == "search_result":
                    result_record = rec
                elif rec_type == "fit":
                    # The baseline trial is stored embedded in the fit
                    # record (not as a top-level trial record), so a
                    # cache hit can replay it for the delta-vs-baseline
                    # summary line without re-encoding it.
                    candidate = rec.get("baseline")
                    if isinstance(candidate, dict):
                        fit_baseline_record = candidate
    except OSError:
        return None
    if result_record is None:
        return None

    optimal_crf = result_record.get("optimal_crf")
    optimal_summary: VmafSummary | None = None
    # Prefer the matching trial's summary as ``optimal_summary`` — trial
    # records carry all six percentiles (p1/p5/p10/p15/p20/p25) plus the
    # mean/min, while the search_result's optimal_summary historically
    # only stored a subset. Falls back to whatever optimal_summary the
    # search_result holds if no trial matches the picked CRF.
    if optimal_crf is not None:
        for trial in trials:
            if trial.crf == optimal_crf:
                optimal_summary = trial.summary
                break
    if optimal_summary is None:
        optimal_summary_record = result_record.get("optimal_summary")
        if optimal_summary_record is not None:
            optimal_summary = _summary_from_record(
                optimal_summary_record, VmafSummary,
            )

    # The fit record's baseline schema is a subset of the trial record's
    # (crf + bitrate + size + frame_count + summary), so the existing
    # trial reader handles it; missing trial-only fields get defaults.
    # Annotating with phase="baseline" preserves the role even though
    # downstream code reads it off the dedicated ``baseline_trial``
    # field rather than scanning ``trials`` for the phase tag.
    baseline_trial: CrfSearchTrial | None = None
    if fit_baseline_record is not None:
        baseline_record = dict(fit_baseline_record)
        baseline_record.setdefault("phase", "baseline")
        baseline_trial = _trial_from_record(
            baseline_record, CrfSearchTrial, VmafSummary,
        )

    return CrfSearchResult(
        optimal_crf=optimal_crf,
        optimal_summary=optimal_summary,
        trials=trials,
        target=target,
        sample_windows=list(sample_windows),
        reference_size_bytes=0,
        search_frames=int(result_record.get("search_frames", 0) or 0),
        final_frames_estimate=final_frames_estimate,
        search_seconds=float(result_record.get("search_seconds", 0.0) or 0.0),
        baseline_trial=baseline_trial,
    )


def _trial_from_record(
    rec: dict[str, Any],
    trial_cls: type[CrfSearchTrial],
    summary_cls: type[VmafSummary],
) -> CrfSearchTrial | None:
    """Convert one JSONL ``trial`` record back into a ``CrfSearchTrial``.

    Returns ``None`` for records missing required fields — they get
    silently dropped from the reconstructed result rather than
    crashing the cache hit.

    The ``trial_cls`` / ``summary_cls`` parameters take the actual
    classes from ``..types`` (rather than this module importing them
    at module scope) to keep the encoder-search ↔ types ↔ cache
    cycle import-safe.
    """
    summary_record = rec.get("summary")
    if summary_record is None:
        return None
    # Trial records store ``frame_count`` at the top level (the summary
    # sub-dict is just percentiles). Merge it into the summary view so
    # ``_summary_from_record`` can populate ``VmafSummary.frame_count``
    # — without this the reconstructed summary has frame_count=0 and
    # downstream est-size / bitrate-per-frame math breaks.
    summary_view = dict(summary_record)
    if "frame_count" not in summary_view and "frame_count" in rec:
        summary_view["frame_count"] = rec["frame_count"]
    summary = _summary_from_record(summary_view, summary_cls)
    if summary is None:
        return None
    crf = rec.get("crf")
    if crf is None:
        return None
    return trial_cls(
        crf=int(crf),
        summary=summary,
        encode_seconds=float(rec.get("encode_seconds", 0.0) or 0.0),
        passed=bool(rec.get("passed", False)),
        low_pct_enforced=bool(rec.get("low_pct_enforced", False)),
        encoded_size_bytes=int(rec.get("encoded_size_bytes", 0) or 0),
        size_percent_of_reference=float(
            rec.get("size_percent_of_reference", 0.0) or 0.0,
        ),
        windows_used=int(rec.get("windows_used", 0) or 0),
        windows_total=int(rec.get("windows_total", 0) or 0),
        phase=str(rec.get("phase", "")),
        bitrate_kbps=float(rec.get("bitrate_kbps", 0.0) or 0.0),
    )


def _summary_from_record(
    rec: dict[str, Any], summary_cls: type[VmafSummary],
) -> VmafSummary | None:
    """Convert a ``summary`` sub-object from JSONL into a
    ``VmafSummary``.

    Older runs may have lacked some percentile fields; fill missing
    values with NaN so callers that care about a specific percentile
    can detect "not measured" via ``math.isfinite``.
    """
    def _f(key: str) -> float:
        val = rec.get(key)
        if val is None:
            return math.nan
        try:
            return float(val)
        except (TypeError, ValueError):
            return math.nan

    return summary_cls(
        mean=_f("mean"),
        p1=_f("p1"),
        p5=_f("p5"),
        p10=_f("p10"),
        p15=_f("p15"),
        p20=_f("p20"),
        p25=_f("p25"),
        minimum=_f("minimum"),
        frame_count=int(rec.get("frame_count", 0) or 0),
    )


# ---------------------------------------------------------------------------
# Partial-hit cache priming
# ---------------------------------------------------------------------------


_TRIAL_FILENAME_PATTERN = re.compile(
    r"^(?P<stem>.+)\.crfsearch-trial-crf(?P<crf>\d+)-w(?P<window>\d+)\.(?P<ext>webm|mp4)$",
)


def cleanup_orphaned_trial_files(  # noqa: PLR0912 — straight-line JSONL walk + file walk
    fingerprint_dir: Path,
    file_name_stem: str,
) -> list[Path]:
    """Delete trial encode files lacking a corresponding completed
    JSONL trial record. Returns the list of paths actually deleted.

    A trial encode is "vouched" only if some JSONL in this dir holds
    a ``trial`` record naming the same ``(crf, window_index)`` with
    ``phase`` ∈ {probe, verify}. The record is written by
    ``on_trial_complete``, which runs *after* the encode finishes
    AND VMAF measurement succeeds — so its presence guarantees the
    file on disk was a clean, complete encode.

    A trial file with NO vouching JSONL record is an orphan,
    typically from a Ctrl-C / crash interrupt that killed ffmpeg
    mid-write. Without cleanup, ``makeClip``'s ``mp["exists"]``
    short-circuit would later treat the partial file as a valid
    cached encode and feed it to VMAF, producing garbage
    measurements.

    Reference encodes (``.crfsearch-ref-...``) and baseline
    (``.crfsearch-baseline...``) aren't covered here — they don't
    write JSONL records to vouch against. An interrupted ref / baseline
    encode would still cause issues; left as a separate concern.
    """
    if not fingerprint_dir.is_dir():
        return []
    # Collect vouched (crf, window_index) pairs across every JSONL.
    vouched: set[tuple[int, int]] = set()
    for jsonl_path in fingerprint_dir.glob("run-*.jsonl"):
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
                    if rec.get("type") != "trial":
                        continue
                    if rec.get("phase") not in {"probe", "verify"}:
                        continue
                    crf = rec.get("crf")
                    window_indices = rec.get("window_indices") or []
                    if crf is None or not window_indices:
                        continue
                    for w in window_indices:
                        if not isinstance(crf, (int, float)) or not isinstance(w, (int, float)):
                            continue
                        vouched.add((int(crf), int(w)))
        except OSError:
            continue
    # Walk trial files (this stem only, to avoid touching neighboring
    # pairs' artifacts that happen to share the dir).
    deleted: list[Path] = []
    for trial_path in fingerprint_dir.iterdir():
        if not trial_path.is_file():
            continue
        match = _TRIAL_FILENAME_PATTERN.match(trial_path.name)
        if match is None:
            continue
        if match.group("stem") != file_name_stem:
            continue
        try:
            crf = int(match.group("crf"))
            window_index = int(match.group("window"))
        except ValueError:
            continue
        if (crf, window_index) in vouched:
            continue
        try:
            trial_path.unlink()
        except OSError:
            continue
        deleted.append(trial_path)
    return deleted


def prime_trial_measurement_cache(  # noqa: PLR0912 — straight-line record dispatch + multiple gates
    *,
    fingerprint_dir: Path,
    file_name_stem: str,
) -> dict[tuple[int, int], tuple[list[float], int, Path]]:
    """Build a ``trial_measurement_cache`` dict by harvesting
    ``trial`` records from every run JSONL in ``fingerprint_dir``,
    keyed by ``(crf, window_index)``.

    Resilient to crashed prior runs: a JSONL missing
    ``search_result`` is unusable for full-hit reconstruction, but
    its trial records are still valid (the encoder fingerprint
    matches by definition — all files in this dir share it — so
    trial encodes are byte-equivalent). Harvesting across all runs
    means a prior crash doesn't waste the trial work it produced
    before crashing.

    Walks files most-recent-first; first record at a given
    ``(crf, window_index)`` wins (so the freshest measurement
    survives if the same probe was repeated across runs). Filters
    to ``phase in {probe, verify}``; baseline / reference don't
    belong in the trial measurement cache.

    The trial file path is reconstructed from the conventional
    suffix template (``.crfsearch-trial-crf{crf}-w{window_index}``)
    plus the file name stem and fingerprint dir. If the file
    actually exists on disk, the orchestrator's
    ``mp["exists"]`` check skips the encode too. If not (user
    cleaned ``temp/crf-search/``), the cache entry is still
    populated with the pseudo-path — the encode step re-creates the
    file, the cached measurement is reused.
    """
    primed: dict[tuple[int, int], tuple[list[float], int, Path]] = {}
    if not fingerprint_dir.is_dir():
        return primed
    run_files = sorted(fingerprint_dir.glob("run-*.jsonl"), reverse=True)
    for jsonl_path in run_files:
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
                    if rec.get("type") != "trial":
                        continue
                    if rec.get("phase") not in {"probe", "verify"}:
                        continue
                    crf = rec.get("crf")
                    window_indices = rec.get("window_indices")
                    per_frame = rec.get("per_frame_vmaf")
                    summary = rec.get("summary") or {}
                    # ``frame_count`` lives at the trial-record top
                    # level (alongside crf / phase), NOT inside
                    # ``summary``. Fall back to the summary dict for
                    # backward compat with any older format that
                    # might have stored it there.
                    frame_count = int(
                        rec.get("frame_count")
                        or summary.get("frame_count", 0)
                        or 0,
                    )
                    if (
                        crf is None
                        or per_frame is None
                        or not window_indices
                        or frame_count <= 0
                    ):
                        continue
                    # A trial may have spanned multiple windows; the
                    # per_frame_vmaf list is the concatenation across
                    # them. For partial-hit priming we want per-window
                    # entries, but the JSONL doesn't preserve the
                    # per-window split — cache the trial under the
                    # FIRST window index only. Subsequent windows of
                    # the same trial will re-measure (small cost;
                    # partial reuse is still a net win on the encode
                    # side via ``mp["exists"]``).
                    window_index = int(window_indices[0])
                    key = (int(crf), window_index)
                    if key in primed:
                        # Most-recent file (we walk reversed) already
                        # populated this key; keep the freshest.
                        continue
                    trial_filename = (
                        f"{file_name_stem}.crfsearch-trial-crf{crf}-w{window_index}.webm"
                    )
                    trial_path = fingerprint_dir / trial_filename
                    # Source-of-truth for ``encoded_size_bytes``: the
                    # trial file on disk. The JSONL value is unreliable
                    # — older buggy versions of priming stored
                    # ``frame_count`` (small int, e.g. 17 / 80) where
                    # bytes (MB-scale) belong, and that corruption
                    # propagated through the JSONL chain on cache
                    # hits. Statting the actual file gives us the
                    # real size regardless of what the JSONL claims.
                    #
                    # If the file is gone, skip priming for this
                    # (crf, window) — the orchestrator''s ``mp["exists"]``
                    # check will let makeClip re-encode it fresh,
                    # producing a correct size measurement.
                    if not trial_path.is_file():
                        continue
                    try:
                        file_size_bytes = trial_path.stat().st_size
                    except OSError:
                        continue
                    if file_size_bytes <= 0:
                        continue
                    primed[key] = (
                        [float(v) for v in per_frame],
                        file_size_bytes,
                        trial_path,
                    )
        except OSError:
            continue
    return primed
