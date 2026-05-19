"""Encoder + search fingerprints for the sample-guided run cache.

Two fingerprints answer two distinct questions:

- ``encoder_fingerprint`` — would two trial encodes at the same CRF
  produce identical bytes? Derived from the actual ffmpeg encoder args
  (with per-trial / per-pair variance stripped) plus the filter graph
  (likewise) plus a defensive extras dict of fields that may not be
  visible in the command but semantically belong to encoder identity.
  Same fingerprint ⇒ byte-equivalent trial output at the same CRF.

- ``search_fingerprint`` — would the curve-fit search explore the same
  probe space and pick the same CRF given the same encoder curve? A
  small field-curated hash over target VMAF + CRF range. Algorithm-level
  state, not encoder.

Why derive-then-canonicalize for the encoder fingerprint:

- A hand-curated dict-of-fields hash is *unsafe*. Easy to forget to add
  a new field when a new setting ships, leading to silent stale-cache
  hits when output behavior actually changed.
- A raw-string hash of the ffmpeg command is *unstable*. Reordering
  flag emission in source code (a no-op refactor) flips the hash and
  busts the cache for no real reason.

Canonicalization sits between: derive from the actual command (auto-
captures any new flag), then sort flags so reorder-only changes don't
flip the hash. The user-facing rule is "if the byte output of a trial
encode would change, the fingerprint flips; otherwise it doesn't."
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

# Per-trial / per-pair variance gets stripped to placeholder tokens
# before tokenization so the fingerprint is independent of the CRF a
# trial happens to be sweeping. ``-qmin`` and ``-qmax`` are CRF-derived
# in our codec wrappers, so they get the same treatment.
_PER_TRIAL_FLAG_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"-crf\s+\d+"), "-crf <CRF>"),
    (re.compile(r"-qmin\s+\d+"), "-qmin <QMIN>"),
    (re.compile(r"-qmax\s+\d+"), "-qmax <QMAX>"),
)


# ---------------------------------------------------------------------------
# Canonicalization
# ---------------------------------------------------------------------------


def canonicalize_codec_args(codec_args: str) -> str:
    """Normalize a codec-args string for stable hashing.

    1. Replace per-trial flag values (CRF, qmin, qmax) with placeholders.
    2. Tokenize into ``(flag, value)`` pairs. A token starting with ``-``
       is a flag; the next token is its value if it doesn't itself start
       with ``-``. Boolean-style flags (no following value) keep ``None``
       as their value.
    3. Sort pairs alphabetically by flag name.
    4. Re-serialize with single-space separators.

    Tokenization is whitespace-only by design — codec args in our usage
    never contain quoted values with embedded spaces. If that ever
    changes the canonicalization step needs to grow a real shell-style
    parser, but defaulting to that today would be over-engineering.
    """
    s = codec_args.strip()
    for pattern, replacement in _PER_TRIAL_FLAG_PATTERNS:
        s = pattern.sub(replacement, s)
    tokens = s.split()
    pairs: list[tuple[str, str | None]] = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.startswith("-"):
            if i + 1 < len(tokens) and not tokens[i + 1].startswith("-"):
                pairs.append((token, tokens[i + 1]))
                i += 2
            else:
                pairs.append((token, None))
                i += 1
        else:
            # Stray positional token (shouldn't happen in our codec args
            # output, but handled defensively): synthesize a sortable
            # key so it doesn't disappear in the sort and doesn't
            # collide with a real flag.
            pairs.append((f"<positional:{i}>", token))
            i += 1
    pairs.sort(key=lambda pair: pair[0])
    parts: list[str] = []
    for flag, value in pairs:
        if flag.startswith("<positional:"):
            parts.append(value or "")
        elif value is None:
            parts.append(flag)
        else:
            parts.append(f"{flag} {value}")
    return " ".join(parts)


def canonicalize_filter_graph(filter_graph: str) -> str:
    """Normalize a filter-graph string for stable hashing.

    Filter graphs are order-sensitive (each comma-separated filter
    feeds the next), so we don't sort them. We do strip whitespace
    and normalize the per-pair ``trim`` time range to a placeholder,
    since the pair's start/end is captured separately in
    ``pair_identity`` and shouldn't redundantly bust the encoder
    fingerprint.
    """
    s = filter_graph.strip()
    s = re.sub(r"trim=[\d.]+:[\d.]+", "trim=<RANGE>", s)
    return s


# ---------------------------------------------------------------------------
# Fingerprints
# ---------------------------------------------------------------------------


def compute_encoder_fingerprint(
    codec_args: str,
    filter_graph: str,
    extras: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Build the encoder fingerprint and its underlying signature.

    Returns ``(fingerprint, signature)``:

    - ``signature`` is a structured dict with the canonicalized
      codec args, filter graph, and extras as nested fields. Stored
      verbatim in the per-run header / config sidecar so future runs
      can do a literal-equality re-check against this run's signature
      as defense against hash collisions. Nested JSON is much more
      legible than embedding a JSON-serialized string inside another
      JSON string.
    - ``fingerprint`` is the sha256 of the signature's canonical JSON
      serialization (sort_keys + compact separators) truncated to 12
      hex chars — short and stable, suitable as a directory name.

    ``extras`` is a small dict of fields that may not be visible in the
    command but semantically belong to TRIAL-bytes encoder identity:
    width, height, source FPS, speed, HDR mode, encodeSpeed, rotate,
    denoise. Most of these DO show up in the command, but listing them
    explicitly is belt-and-suspenders against future flags that derive
    conditionally from one of these fields.

    Settings that the trial pipeline forces off (``twoPass``,
    ``videoStabilization``; see ``_TRIAL_PIPELINE_OVERRIDES``) are
    intentionally EXCLUDED — trial bytes are independent of those
    user settings, so the fingerprint must be too or toggling them
    between runs needlessly invalidates the cache.
    """
    signature: dict[str, Any] = {
        "codec_args": canonicalize_codec_args(codec_args),
        "filter_graph": canonicalize_filter_graph(filter_graph),
        "extras": extras,
    }
    canonical_json = json.dumps(signature, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()[:12]
    return fingerprint, signature


def compute_search_fingerprint(
    target_vmaf_low: float,
    target_vmaf_low_pct: int,
    target_vmaf_mean: float,
    crf_min: int,
    crf_max: int,
) -> str:
    """Hash search-only parameters that don't affect trial bytes but
    do steer which CRF the search ultimately picks.

    Two runs with the same encoder fingerprint AND the same search
    fingerprint should reach the same picked CRF (modulo measurement
    noise). When fingerprints match on encoder but diverge on search,
    the cache supports partial reuse: trial measurements at CRFs the
    prior run already encoded short-circuit the encode even though
    the picked CRF may move.
    """
    payload = json.dumps(
        {
            "target_vmaf_low": float(target_vmaf_low),
            "target_vmaf_low_pct": int(target_vmaf_low_pct),
            "target_vmaf_mean": float(target_vmaf_mean),
            "crf_min": int(crf_min),
            "crf_max": int(crf_max),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
