"""Tests for ``run_cache.delta`` — auto-delta computation + render.

Two surfaces under test:
- ``compute_prior_run_deltas``: takes prior runs + current state,
  produces structured rows with re-interpolated kbps@tgt and
  config-diff labels.
- ``format_prior_run_deltas_block``: renders rows to a multi-line
  string suitable for the aggregate summary report.
"""

from __future__ import annotations

from pathlib import Path

from clipper.encode_crf_search.run_cache import (
    PriorRun,
    PriorRunDelta,
    compute_prior_run_deltas,
    format_prior_run_deltas_block,
)


def _prior(
    *,
    encoder_fingerprint: str = "abc",
    optimal_crf: int = 30,
    probes: list[tuple[int, float, float]] | None = None,
    encoder_config: dict[str, object] | None = None,
    run_id: str = "260509T100000",
) -> PriorRun:
    extras = encoder_config or {"codec": "vp9", "aq_mode": 0}
    return PriorRun(
        run_id=run_id,
        run_jsonl_path=Path("/tmp/x"),
        encoder_fingerprint=encoder_fingerprint,
        search_fingerprint="search123abc",
        encode_args_signature={
            "codec_args": "<args>",
            "filter_graph": "",
            "extras": extras,
        },
        algorithm_version=1,
        yt_clipper_version="5.43.0",
        pair_identity={"clip_start": 0.0, "clip_end": 10.0, "source_video_id": {}},
        optimal_crf=optimal_crf,
        probes=probes or [],
    )


# ---------------------------------------------------------------------------
# compute_prior_run_deltas
# ---------------------------------------------------------------------------


def test_compute_prior_run_deltas_no_priors_returns_only_current_row() -> None:
    rows = compute_prior_run_deltas(
        prior_runs=[],
        current_encoder_config={"codec": "vp9", "aq_mode": 0},
        current_kbps_at_target=14000.0,
        current_picked_crf=30,
        current_target_vmaf_low=95.0,
    )
    assert len(rows) == 1
    assert rows[0].is_current is True
    assert rows[0].kbps_at_target == 14000.0
    assert rows[0].picked_crf == 30
    assert rows[0].delta_kbps_pct is None
    assert rows[0].delta_picked_crf is None


def test_compute_prior_run_deltas_basic_comparison() -> None:
    """Pair 2's mode 4 vs mode 0 from the real workflow — the kbps@tgt
    delta should be sensibly negative when the current run is more
    efficient."""
    prior = _prior(
        encoder_fingerprint="mode4",
        optimal_crf=26,
        probes=[
            (20, 99.0, 22000.0),
            (26, 95.5, 15500.0),
            (33, 91.8, 10700.0),
        ],
        encoder_config={"codec": "vp9", "aq_mode": 4},
    )
    rows = compute_prior_run_deltas(
        prior_runs=[prior],
        current_encoder_config={"codec": "vp9", "aq_mode": 0},
        current_kbps_at_target=14000.0,
        current_picked_crf=30,
        current_target_vmaf_low=95.0,
    )
    assert len(rows) == 2
    assert rows[0].is_current
    assert rows[0].picked_crf == 30
    assert not rows[1].is_current
    # Prior probes bracket p5=95 between (26, 95.5) and (33, 91.8).
    # Linear interp: t = (95.5 - 95) / (95.5 - 91.8) ≈ 0.135
    # kbps = 15500 + 0.135 * (10700 - 15500) ≈ 14852
    assert rows[1].kbps_at_target is not None
    assert 14600 < rows[1].kbps_at_target < 15100
    assert rows[1].picked_crf == 26
    assert rows[1].delta_picked_crf == 30 - 26  # +4
    # Current 14000 vs prior ~14852 → ~-5.7%
    assert rows[1].delta_kbps_pct is not None
    assert rows[1].delta_kbps_pct < 0


def test_compute_prior_run_deltas_unbracketed_target_returns_none_kbps() -> None:
    """If the prior run's probes don't reach the current target VMAF
    (e.g. the user changed --crf-search-target-vmaf-low to a value outside the
    prior run's curve), the kbps@tgt is None and so is its delta."""
    prior = _prior(
        encoder_fingerprint="mode4",
        probes=[
            (20, 99.5, 22000.0),
            (25, 98.0, 18000.0),
            (30, 97.0, 14000.0),
        ],
    )
    rows = compute_prior_run_deltas(
        prior_runs=[prior],
        current_encoder_config={"codec": "vp9"},
        current_kbps_at_target=10000.0,
        current_picked_crf=35,
        current_target_vmaf_low=92.0,  # below all prior probes
    )
    assert rows[1].kbps_at_target is None
    assert rows[1].delta_kbps_pct is None
    # Picked-CRF delta still computable from saved prior.optimal_crf.
    assert rows[1].delta_picked_crf is not None


def test_compute_prior_run_deltas_zero_current_picked_crf_skips_delta() -> None:
    """Fail-case: current run produced no picked CRF (search couldn't
    find one). delta_picked_crf is None."""
    prior = _prior(optimal_crf=30)
    rows = compute_prior_run_deltas(
        prior_runs=[prior],
        current_encoder_config={},
        current_kbps_at_target=None,
        current_picked_crf=None,
        current_target_vmaf_low=95.0,
    )
    assert rows[1].delta_picked_crf is None


def test_compute_prior_run_deltas_label_shows_only_diff_keys() -> None:
    prior = _prior(
        encoder_config={
            "codec": "vp9", "aq_mode": 4, "tile_rows": 2, "speed": 1.0,
        },
    )
    rows = compute_prior_run_deltas(
        prior_runs=[prior],
        current_encoder_config={
            "codec": "vp9", "aq_mode": 0, "tile_rows": 0, "speed": 1.0,
        },
        current_kbps_at_target=14000.0,
        current_picked_crf=30,
        current_target_vmaf_low=95.0,
    )
    label = rows[1].config_label
    assert "aq_mode=4" in label
    assert "tile_rows=2" in label
    assert "codec" not in label  # matches current → omitted
    assert "speed" not in label


def test_compute_prior_run_deltas_current_row_shows_diff_keys_with_current_values() -> None:
    """The current row mirrors the prior row's diff structure: keys
    that differ across the comparison set, with the current run's
    values. Reads side-by-side like a git diff."""
    prior = _prior(
        encoder_config={
            "codec": "vp9", "encodeSpeed": 4, "aq_mode": 0,
        },
    )
    rows = compute_prior_run_deltas(
        prior_runs=[prior],
        current_encoder_config={
            "codec": "vp9", "encodeSpeed": 2, "aq_mode": 0,
        },
        current_kbps_at_target=11000.0,
        current_picked_crf=36,
        current_target_vmaf_low=95.0,
    )
    current_label = rows[0].config_label
    prior_label = rows[1].config_label
    # Diff key is encodeSpeed only — both rows show their own value.
    assert "encodeSpeed=2" in current_label  # current's value
    assert "encodeSpeed=4" in prior_label  # prior's value
    # Matching keys are omitted from both rows.
    assert "codec" not in current_label
    assert "aq_mode" not in current_label


def test_compute_prior_run_deltas_current_label_unions_across_priors() -> None:
    """When multiple priors differ on different keys, the current row
    surfaces ALL diff dimensions so it serves as the comparison
    baseline for every prior row."""
    prior_a = _prior(
        encoder_fingerprint="a",
        run_id="2",
        encoder_config={"codec": "vp9", "aq_mode": 4, "tile_rows": 2},
    )
    prior_b = _prior(
        encoder_fingerprint="b",
        run_id="1",
        encoder_config={"codec": "vp9", "aq_mode": 0, "encodeSpeed": 4},
    )
    rows = compute_prior_run_deltas(
        prior_runs=[prior_a, prior_b],
        current_encoder_config={
            "codec": "vp9", "aq_mode": 0, "tile_rows": 0, "encodeSpeed": 2,
        },
        current_kbps_at_target=12000.0,
        current_picked_crf=32,
        current_target_vmaf_low=95.0,
    )
    current_label = rows[0].config_label
    # Union of "any-prior-differs" keys is {aq_mode, tile_rows, encodeSpeed}.
    # Current's values show for all three.
    assert "tile_rows=0" in current_label  # differs from prior_a
    assert "encodeSpeed=2" in current_label  # differs from prior_b
    # aq_mode matches prior_b but differs from prior_a → still in union.
    assert "aq_mode=0" in current_label
    assert "codec" not in current_label  # matches all priors


def test_compute_prior_run_deltas_multiple_priors_preserve_order() -> None:
    p1 = _prior(encoder_fingerprint="a", run_id="1", optimal_crf=26)
    p2 = _prior(encoder_fingerprint="b", run_id="2", optimal_crf=30)
    rows = compute_prior_run_deltas(
        prior_runs=[p2, p1],
        current_encoder_config={},
        current_kbps_at_target=14000.0,
        current_picked_crf=33,
        current_target_vmaf_low=95.0,
    )
    assert len(rows) == 3
    assert rows[0].is_current
    assert rows[1].picked_crf == 30  # p2 (passed first)
    assert rows[2].picked_crf == 26  # p1 (passed second)


# ---------------------------------------------------------------------------
# format_prior_run_deltas_block
# ---------------------------------------------------------------------------


def test_format_prior_run_deltas_block_empty_when_no_priors() -> None:
    rows = [
        PriorRunDelta(
            config_label="(current)",
            kbps_at_target=14000.0,
            delta_kbps_pct=None,
            picked_crf=30,
            delta_picked_crf=None,
            is_current=True,
        ),
    ]
    block = format_prior_run_deltas_block([("#1", rows)], target_vmaf_low=95.0)
    assert block == ""


def test_format_prior_run_deltas_block_renders_priors() -> None:
    rows = [
        PriorRunDelta(
            config_label="(current)",
            kbps_at_target=14000.0,
            delta_kbps_pct=None,
            picked_crf=30,
            delta_picked_crf=None,
            is_current=True,
        ),
        PriorRunDelta(
            config_label="aq_mode=4 tile_rows=2",
            kbps_at_target=14800.0,
            delta_kbps_pct=-5.4,
            picked_crf=26,
            delta_picked_crf=4,
            is_current=False,
        ),
    ]
    block = format_prior_run_deltas_block([("#2", rows)], target_vmaf_low=95.0)
    assert "prior-run deltas" in block
    assert "p_low=95.0" in block
    assert "#2" in block
    assert "aq_mode=4 tile_rows=2" in block
    assert "14800" in block  # prior kbps
    assert "14000" in block  # current kbps
    assert "-5.4%" in block
    assert "+4" in block


def test_format_prior_run_deltas_block_skips_clips_with_no_priors() -> None:
    """A clip whose only row is the current run shouldn't appear
    in the block — there's nothing to compare."""
    no_prior_rows = [
        PriorRunDelta(
            config_label="(current)",
            kbps_at_target=14000.0,
            delta_kbps_pct=None,
            picked_crf=30,
            delta_picked_crf=None,
            is_current=True,
        ),
    ]
    with_prior_rows = [
        no_prior_rows[0],
        PriorRunDelta(
            config_label="aq_mode=4",
            kbps_at_target=14800.0,
            delta_kbps_pct=-5.4,
            picked_crf=26,
            delta_picked_crf=4,
            is_current=False,
        ),
    ]
    block = format_prior_run_deltas_block(
        [("#1", no_prior_rows), ("#2", with_prior_rows)],
        target_vmaf_low=95.0,
    )
    assert "#2" in block
    assert "#1" not in block  # skipped


def test_format_prior_run_deltas_block_handles_missing_kbps_gracefully() -> None:
    """When prior probes don't bracket current target, kbps@tgt is
    None — block should render '-' rather than crash."""
    rows = [
        PriorRunDelta(
            config_label="(current)",
            kbps_at_target=14000.0,
            delta_kbps_pct=None,
            picked_crf=30,
            delta_picked_crf=None,
            is_current=True,
        ),
        PriorRunDelta(
            config_label="aq_mode=4",
            kbps_at_target=None,  # unbracketed
            delta_kbps_pct=None,
            picked_crf=26,
            delta_picked_crf=4,
            is_current=False,
        ),
    ]
    block = format_prior_run_deltas_block([("#2", rows)], target_vmaf_low=95.0)
    assert "#2" in block
    assert "-" in block  # placeholder for missing kbps
