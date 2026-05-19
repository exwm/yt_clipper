"""sample-guided run cache: fingerprints, history, deltas, sidecars.

This package owns the cross-run identity story for the sample-guided
subsystem. The plan ships in phases; each phase adds a sibling module
without touching prior ones:

- ``fingerprint``  — phase 1: encoder + search fingerprints, the
  canonicalization recipe that makes them safe-and-stable.
- ``history``      — phase 3: load prior-run JSONLs, reconstruct
  ``SampleGuidedEncodeResult`` for cache hits, list distinct prior configs.
- ``delta``        — phase 3: ``PriorRunDelta`` + the auto-delta block
  that the aggregate-summary formatter renders.
- ``sidecar``      — phase 2 + 5: per-fingerprint ``config.json`` writes
  (phase 2) and the final-encode ``.encode-meta.json`` UX (phase 5).
- ``cache``        — phase 4: the strict freshness gate, full-hit
  reconstruction, partial-hit measurement priming.

Public API (just phase 1 today):
"""

from .cache import (
    CacheReuseDecision,
    cleanup_orphaned_trial_files,
    evaluate_cache_reuse,
    prime_trial_measurement_cache,
    reconstruct_result_from_jsonl,
)
from .delta import (
    PriorRunDelta,
    compute_prior_run_deltas,
    format_prior_run_deltas_block,
)
from .fingerprint import (
    canonicalize_codec_args,
    canonicalize_filter_graph,
    compute_encoder_fingerprint,
    compute_search_fingerprint,
)
from .history import PriorRun, load_prior_runs
from .sidecar import (
    EncodeMetaCheck,
    check_encode_meta_sidecar,
    write_config_sidecar,
    write_encode_meta_sidecar,
)

__all__ = [
    "CacheReuseDecision",
    "EncodeMetaCheck",
    "PriorRun",
    "PriorRunDelta",
    "canonicalize_codec_args",
    "canonicalize_filter_graph",
    "check_encode_meta_sidecar",
    "cleanup_orphaned_trial_files",
    "compute_encoder_fingerprint",
    "compute_prior_run_deltas",
    "compute_search_fingerprint",
    "evaluate_cache_reuse",
    "format_prior_run_deltas_block",
    "load_prior_runs",
    "prime_trial_measurement_cache",
    "reconstruct_result_from_jsonl",
    "write_config_sidecar",
    "write_encode_meta_sidecar",
]
