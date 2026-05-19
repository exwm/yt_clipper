"""VMAF-targeted empirical CRF binary-search driver.

When the user passes ``--sample-guided-encode``, each marker pair is encoded
at multiple trial CRFs, measured against a near-transparent reference
encode, and the lowest CRF (= most compression) whose VMAF NEG clears
both the mean and the configured low-percentile target becomes the
final encode's CRF. Trials use sampled windows of the source range to
keep search wall time modest, and skip motion interpolation / video2x
upscaling since CRF maps the same way perceptually whether
interpolation is applied post-encoder or not.

Package layout (each submodule is the natural import target for code
that needs only its slice of the search):

- :mod:`.types` — data shapes (:class:`SampleGuidedEncodeTarget`,
  :class:`SampleGuidedEncodeTrial`, :class:`TrialMeasurement`,
  :class:`SampleGuidedEncodeResult`, :class:`SampleWindow`,
  :class:`ClipSearchSummary`), constants, and percentile-table
  helpers. No I/O, no algorithms.
- :mod:`.predicates` — pure decision predicates: ``passes_targets``,
  ``is_trial_confidently_decided``, distance-to-boundary,
  fast-fail / hopeless / step-down-skip calibration helpers, fallback
  level finder. The "why did the search make this decision?" layer.
- :mod:`.search` — sampling (``select_sample_windows``), single-phase
  bisection (``find_optimal_crf``), and the multi-phase orchestrator
  (``find_optimal_crf_two_phase``). Pure algorithms; takes injected
  evaluator callbacks rather than touching the encoder pipeline.
- :mod:`.orchestrator` — the user-facing entry point
  ``run_sample_guided_encode_for_marker_pair`` plus the encoder integration
  glue. Only this module knows about ``ClipperState`` / ``makeClip``.

This ``__init__.py`` re-exports the names that ``clip_maker`` and the
test suite import via ``from clipper.sample_guided_encode import ...``.
The ``X as X`` aliases tell linters these are intentionally re-
exported rather than unused.

Compared to ab-av1's ``crf-search`` (https://alexheretic.github.io/posts/ab-av1/):

- We use **frame-count-sized windows** instead of fixed 20-second
  samples because yt_clipper clips are typically 3-30 seconds long
  and ab-av1's long-form defaults would degrade to full-clip on most
  of our workload.
- We aggregate by **concatenating per-frame VMAF lists then
  summarizing** (giving us mean + p1 + p5 + p10) rather than
  mean-of-means; lets us enforce a percentile target. ab-av1 is
  mean-only.
- We **encode a near-transparent reference** rather than measuring
  trials against the source directly, because our pipeline applies
  crop / speed / fade filters that change output dimensions and frame
  timing relative to the source — we can't VMAF differently-shaped
  videos. ab-av1 encodes raw and so doesn't have this problem.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Curve-fit re-exports (default search algorithm)
# ---------------------------------------------------------------------------
from .curve_fit import CurveFit as CurveFit
from .curve_fit import CurveFitSearchResult as CurveFitSearchResult
from .curve_fit import HeuristicPicks as HeuristicPicks
from .curve_fit import find_crf_via_curve_fit as find_crf_via_curve_fit
from .curve_fit import render_curve_ascii as render_curve_ascii

# ---------------------------------------------------------------------------
# Orchestrator re-exports (encoder integration entry points)
# ---------------------------------------------------------------------------
from .orchestrator import ClipSearchSummary as ClipSearchSummary
from .orchestrator import (
    format_aggregated_search_summary_log_block as format_aggregated_search_summary_log_block,
)
from .orchestrator import reference_encode_picks_for_codec as reference_encode_picks_for_codec
from .orchestrator import (
    run_sample_guided_encode_for_marker_pair as run_sample_guided_encode_for_marker_pair,
)

# ---------------------------------------------------------------------------
# Predicate re-exports (passes_targets + calibration / hopeless / fallback)
# ---------------------------------------------------------------------------
from .predicates import DEFAULT_CONFIDENCE_MARGIN as DEFAULT_CONFIDENCE_MARGIN
from .predicates import (
    DEFAULT_HOPELESS_EXTRAPOLATION_BUFFER as DEFAULT_HOPELESS_EXTRAPOLATION_BUFFER,
)
from .predicates import (
    DEFAULT_STEP_DOWN_SKIP_BUFFER as DEFAULT_STEP_DOWN_SKIP_BUFFER,
)
from .predicates import (
    _calibration_says_phase3_hopeless as _calibration_says_phase3_hopeless,
)
from .predicates import (
    _calibration_says_step_down_wont_help as _calibration_says_step_down_wont_help,
)
from .predicates import _distance_to_pass_boundary as _distance_to_pass_boundary
from .predicates import (
    _find_best_pass_at_fallback_level as _find_best_pass_at_fallback_level,
)
from .predicates import _phase1_to_phase2_bridge_pct as _phase1_to_phase2_bridge_pct
from .predicates import _predict_phase2_fast_fail as _predict_phase2_fast_fail
from .predicates import (
    _refinement_extrapolation_says_hopeless as _refinement_extrapolation_says_hopeless,
)
from .predicates import is_trial_confidently_decided as is_trial_confidently_decided
from .predicates import passes_targets as passes_targets

# ---------------------------------------------------------------------------
# Search-algorithm re-exports (sampling, bisection, two-phase)
# ---------------------------------------------------------------------------
from .search import (
    DEFAULT_PHASE2_FAST_FAIL_MARGIN as DEFAULT_PHASE2_FAST_FAIL_MARGIN,
)
from .search import (
    DEFAULT_PHASE3_STEP_DOWN_LIMIT as DEFAULT_PHASE3_STEP_DOWN_LIMIT,
)
from .search import (
    DEFAULT_TARGET_RELAXATION_CAP as DEFAULT_TARGET_RELAXATION_CAP,
)
from .search import (
    DEFAULT_TARGET_RELAXATION_PER_STEP as DEFAULT_TARGET_RELAXATION_PER_STEP,
)
from .search import (
    MIN_PHASE1_TRIALS_FOR_CALIBRATION as MIN_PHASE1_TRIALS_FOR_CALIBRATION,
)
from .search import _relaxed_target as _relaxed_target
from .search import find_optimal_crf as find_optimal_crf  # back-compat alias
from .search import (
    find_optimal_crf_two_phase as find_optimal_crf_two_phase,  # back-compat alias
)
from .search import legacy_find_optimal_crf as legacy_find_optimal_crf
from .search import (
    legacy_find_optimal_crf_two_phase as legacy_find_optimal_crf_two_phase,
)
from .search import select_sample_windows as select_sample_windows

# ---------------------------------------------------------------------------
# Type re-exports (data shapes, constants, percentile helpers)
# ---------------------------------------------------------------------------
from .types import DEFAULT_LOW_PERCENTILE as DEFAULT_LOW_PERCENTILE
from .types import DEFAULT_N_WINDOWS as DEFAULT_N_WINDOWS
from .types import DEFAULT_TARGET_SAMPLE_PERCENT as DEFAULT_TARGET_SAMPLE_PERCENT
from .types import DEFAULT_TARGET_TRIAL_FRAMES as DEFAULT_TARGET_TRIAL_FRAMES
from .types import DEFAULT_TARGET_VMAF_MEAN as DEFAULT_TARGET_VMAF_MEAN
from .types import MIN_FRAMES_FOR_RELIABLE_P1 as MIN_FRAMES_FOR_RELIABLE_P1
from .types import REFERENCE_SUFFIX_TEMPLATE as REFERENCE_SUFFIX_TEMPLATE
from .types import SUPPORTED_LOW_PERCENTILES as SUPPORTED_LOW_PERCENTILES
from .types import TRIAL_SUFFIX_TEMPLATE as TRIAL_SUFFIX_TEMPLATE
from .types import SampleGuidedEncodeResult as SampleGuidedEncodeResult
from .types import SampleGuidedEncodeTarget as SampleGuidedEncodeTarget
from .types import SampleGuidedEncodeTrial as SampleGuidedEncodeTrial
from .types import SampleWindow as SampleWindow
from .types import TrialMeasurement as TrialMeasurement
from .types import default_low_threshold_for_percentile as default_low_threshold_for_percentile
from .types import get_low_percentile_value as get_low_percentile_value
from .types import min_frames_for_low_percentile as min_frames_for_low_percentile
