"""Sidecar writes — per-fingerprint config + per-final-encode meta.

Two distinct sidecars live in this module:

1. **Per-fingerprint ``config.json``** — written into each
   ``<title>-pair{N}/<encoder_fingerprint>/`` directory. Describes
   the encoder configuration that produced this fingerprint.
   Human-readable provenance, plus the encode_args_signature for
   hash-collision defense in the cache gate.

2. **Per-final-encode ``<output>.encode-meta.json``** — written
   next to each final ``.webm`` / ``.mp4`` output. Captures the
   encoder fingerprint + picked CRF the file was produced under.
   Lets the orchestrator detect on subsequent runs whether an
   existing output is "still current" (matches the user's settings)
   or stale (settings have moved). Drives the sidecar UX: existing
   files with matching settings are skipped quietly; existing files
   with mismatching settings get a WARNING-level "re-run with
   --overwrite to re-encode" notice.

Per-fingerprint sidecars are write-once (preserve first_seen_utc).
Encode-meta sidecars are rewritten on every successful encode (the
file's bytes change, so the sidecar's metadata changes with it).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_config_sidecar(
    fingerprint_dir: Path,
    encoder_fingerprint: str,
    encode_args_signature: dict[str, Any],
    yt_clipper_version: str,
) -> Path:
    """Write the per-fingerprint ``config.json`` sidecar (idempotent).

    If the sidecar already exists, leaves it alone — fingerprints are
    1:1 with signatures, so the existing file is correct and its
    ``first_seen_utc`` is the load-bearing field we don't want to
    rewrite. If absent, writes a fresh one stamped with the current
    UTC timestamp.

    Note: ``algorithm_version`` is intentionally NOT included here.
    A given fingerprint dir might host runs across multiple algorithm
    versions (the fingerprint is encoder-only), so the first-seen
    version would go stale on later re-uses. Per-run history records
    track ``algorithm_version`` instead.

    Returns the sidecar path either way so callers can log it or
    diff against it.
    """
    fingerprint_dir.mkdir(parents=True, exist_ok=True)
    sidecar_path = fingerprint_dir / "config.json"
    if sidecar_path.exists():
        return sidecar_path
    payload = {
        "encoder_fingerprint": encoder_fingerprint,
        "yt_clipper_version": yt_clipper_version,
        "first_seen_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "encode_args_signature": encode_args_signature,
    }
    sidecar_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return sidecar_path


# ---------------------------------------------------------------------------
# Per-final-encode encode-meta sidecar
# ---------------------------------------------------------------------------


_ENCODE_META_SUFFIX = ".encode-meta.json"


@dataclass(frozen=True)
class EncodeMetaCheck:
    """Result of comparing an existing output's sidecar to current
    expectations.

    - ``status="match"``: file exists, sidecar present, fingerprint
      AND picked CRF match the current run.
    - ``status="mismatch"``: file exists, sidecar present, but
      fingerprint or picked CRF differs.
    - ``status="missing"``: file exists, sidecar absent (older file
      from before this feature shipped, or sidecar was deleted).
    - ``status="absent"``: file doesn't exist.

    ``existing`` is the sidecar's payload dict when present so the
    caller can render a settings diff in the WARNING-level log line
    on mismatch.
    """

    status: str  # "match" | "mismatch" | "missing" | "absent"
    existing: dict[str, Any] | None


def write_encode_meta_sidecar(
    output_path: Path,
    *,
    encoder_fingerprint: str,
    encode_args_signature: dict[str, Any],
    picked_crf: int,
    algorithm_version: int,
    yt_clipper_version: str,
) -> Path:
    """Write ``<output_path>.encode-meta.json`` after a successful
    final encode.

    Always overwrites — the file's bytes are fresh, so the sidecar
    must reflect the run that produced them. ``finalized_utc`` is
    the timestamp the sidecar was written (i.e. when the encode
    completed). Unlike the per-fingerprint config sidecar, this one
    DOES include ``algorithm_version`` because it's rewritten on
    every encode (so it never goes stale).
    """
    sidecar_path = output_path.with_suffix(output_path.suffix + _ENCODE_META_SUFFIX)
    payload = {
        "encoder_fingerprint": encoder_fingerprint,
        "encode_args_signature": encode_args_signature,
        "picked_crf": picked_crf,
        "algorithm_version": algorithm_version,
        "yt_clipper_version": yt_clipper_version,
        "finalized_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    sidecar_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return sidecar_path


def check_encode_meta_sidecar(
    output_path: Path,
    *,
    expected_fingerprint: str,
    expected_picked_crf: int,
) -> EncodeMetaCheck:
    """Compare the existing output's sidecar against current expectations.

    No I/O side effects — just reads and classifies. Caller decides
    what to log and whether to encode.
    """
    if not output_path.is_file():
        return EncodeMetaCheck(status="absent", existing=None)
    sidecar_path = output_path.with_suffix(output_path.suffix + _ENCODE_META_SUFFIX)
    if not sidecar_path.is_file():
        return EncodeMetaCheck(status="missing", existing=None)
    try:
        payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return EncodeMetaCheck(status="missing", existing=None)
    if (
        payload.get("encoder_fingerprint") == expected_fingerprint
        and payload.get("picked_crf") == expected_picked_crf
    ):
        return EncodeMetaCheck(status="match", existing=payload)
    return EncodeMetaCheck(status="mismatch", existing=payload)
