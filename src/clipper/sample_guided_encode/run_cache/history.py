"""Load prior sample-guided runs from the per-fingerprint history dirs.

Phase 3 read-side companion to Phase 2's storage layout. Walks each
``<title>-pair{N}/<encoder_fingerprint>/`` directory under the
sample-guided temp dir, parses each ``run-*.jsonl``, and returns the
minimal subset of each run needed by the auto-delta render: the
fingerprints, the picked CRF, the canonicalized signature, the
encoder config summary, and a sorted list of probe ``(crf, p_low,
bitrate)`` tuples for kbps@tgt re-interpolation at the current
run's target VMAF.

Filters and ordering:

- One ``PriorRun`` returned per distinct ``encoder_fingerprint`` —
  if the fingerprint dir holds multiple runs, the most recent
  (lexicographic-greatest ``run_id``) wins. Older runs are kept on
  disk for forensics but don't show up in delta render.
- Crashed / partial runs (missing ``search_result``) are skipped
  silently — they're still on disk, just not usable for comparison.
- Optional ``exclude_fingerprint`` parameter so the current run's
  own fingerprint can be excluded from the result without the caller
  having to filter the list.
- Returned list is sorted by ``run_id`` descending (most recent
  first), so ``[0]`` is the most-recently-seen distinct
  configuration.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PriorRun:
    """One historical sample-guided run, loaded for delta rendering
    AND cache-reuse evaluation.

    Holds enough state to (a) re-interpolate kbps@tgt at any target
    VMAF, (b) label the run by its encoder configuration in the
    delta block (via ``encode_args_signature["extras"]``), and (c)
    feed the cache-reuse freshness gate (algorithm version,
    yt_clipper version, encode_args signature literal-equality
    re-check, pair-identity match).

    ``encode_args_signature`` is the structured dict
    ``{"codec_args": str, "filter_graph": str, "extras": dict}``
    from ``compute_encoder_fingerprint``. The ``extras`` sub-dict is
    the human-readable knobs the auto-delta diff label diffs against
    — that's the single source of truth for "what does this encoder
    config look like" (no separate ``encoder_config_summary``).
    """

    run_id: str
    run_jsonl_path: Path
    encoder_fingerprint: str
    search_fingerprint: str
    encode_args_signature: dict[str, Any]
    algorithm_version: int
    yt_clipper_version: str
    pair_identity: dict[str, Any]
    optimal_crf: int | None
    # Sorted (crf, p_low, bitrate_kbps) tuples for piecewise-linear
    # bitrate interpolation. Only includes phase=probe/verify trials —
    # baseline (different bitrate regime) and reference (saturated)
    # are filtered out at parse time.
    probes: list[tuple[int, float, float]] = field(default_factory=list)

    @property
    def encoder_config(self) -> dict[str, Any]:
        """Convenience accessor for ``signature["extras"]`` — the
        human-readable knobs the auto-delta diff label uses."""
        if isinstance(self.encode_args_signature, dict):
            extras = self.encode_args_signature.get("extras")
            if isinstance(extras, dict):
                return extras
        return {}


def load_prior_runs(
    pair_dir: Path,
    low_pct: int,
    *,
    exclude_fingerprint: str | None = None,
) -> list[PriorRun]:
    """Walk ``pair_dir`` for prior runs and return one per distinct
    encoder fingerprint.

    Returns ``[]`` if ``pair_dir`` doesn't exist (first run on this
    pair) or contains no parseable run files. Pass ``exclude_fingerprint``
    to filter out the current run's own fingerprint dir — typical
    use is to scan only OTHER configs for cross-config delta.
    """
    if not pair_dir.exists() or not pair_dir.is_dir():
        return []
    runs_by_fp: dict[str, PriorRun] = {}
    for fingerprint_dir in sorted(pair_dir.iterdir()):
        if not fingerprint_dir.is_dir():
            continue
        if exclude_fingerprint and fingerprint_dir.name == exclude_fingerprint:
            continue
        run_files = sorted(fingerprint_dir.glob("run-*.jsonl"))
        if not run_files:
            continue
        # Most recent run within this fingerprint dir
        prior = _parse_prior_run(run_files[-1], low_pct)
        if prior is not None:
            runs_by_fp[prior.encoder_fingerprint] = prior
    return sorted(
        runs_by_fp.values(),
        key=lambda run: run.run_id,
        reverse=True,
    )


def _parse_prior_run(jsonl_path: Path, low_pct: int) -> PriorRun | None:  # noqa: PLR0912 — straight-line record dispatch + diagnostic logging
    """Parse one run JSONL into a ``PriorRun``.

    Returns ``None`` for crashed / partial runs (no ``search_result``
    record), unreadable files (I/O error or invalid JSON line), or
    files missing the ``run_header`` we depend on for fingerprint
    metadata. On any None-return, emits a VERBOSE log line naming
    the specific failure mode so an operator running with ``-v`` can
    diagnose without source-reading.
    """
    # Lazy import to avoid a top-level dependency on the logger from
    # a module that's also used by tests with synthetic loggers.
    from clipper.ytc_logger import logger

    header: dict[str, Any] | None = None
    search_meta: dict[str, Any] | None = None
    result_record: dict[str, Any] | None = None
    probes: list[tuple[int, float, float]] = []
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
                if rec_type == "run_header":
                    header = rec
                elif rec_type == "search_meta":
                    search_meta = rec
                elif rec_type == "trial":
                    if rec.get("phase") not in {"probe", "verify"}:
                        continue
                    crf = rec.get("crf")
                    summary = rec.get("summary") or {}
                    bitrate = rec.get("bitrate_kbps")
                    p_low = summary.get(f"p{low_pct}")
                    if crf is None or bitrate is None or p_low is None:
                        continue
                    if not (math.isfinite(p_low) and bitrate > 0):
                        continue
                    probes.append((int(crf), float(p_low), float(bitrate)))
                elif rec_type == "search_result":
                    result_record = rec
    except OSError as exc:
        logger.verbose(
            f"run-cache: prior run {jsonl_path.name} unreadable: {exc}",
        )
        return None
    if header is None:
        logger.verbose(
            f"run-cache: prior run {jsonl_path.name} missing run_header "
            f"record (predates phase-2 storage layout, or file was "
            f"truncated mid-write); ignoring.",
        )
        return None
    if result_record is None:
        logger.verbose(
            f"run-cache: prior run {jsonl_path.name} missing search_result "
            f"record (search crashed before completion); ignoring. "
            f"Delete this file to clear it from cache lookups.",
        )
        return None
    pair_identity = (
        dict(search_meta.get("pair_identity", {})) if search_meta else {}
    )
    raw_signature = header.get("encode_args_signature")
    encode_args_signature: dict[str, Any] = (
        raw_signature if isinstance(raw_signature, dict) else {}
    )
    return PriorRun(
        run_id=str(header.get("run_id", "")),
        run_jsonl_path=jsonl_path,
        encoder_fingerprint=str(header.get("encoder_fingerprint", "")),
        search_fingerprint=str(header.get("search_fingerprint", "")),
        encode_args_signature=encode_args_signature,
        algorithm_version=int(header.get("algorithm_version", 0)),
        yt_clipper_version=str(header.get("yt_clipper_version", "")),
        pair_identity=pair_identity,
        optimal_crf=result_record.get("optimal_crf"),
        probes=sorted(probes, key=lambda probe: probe[0]),
    )
