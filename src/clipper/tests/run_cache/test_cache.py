"""Tests for ``run_cache.cache`` — freshness gate + reuse decisions.

Covers the core decision: given a prior run on disk, can the
current run safely reuse it (full / partial / not at all)? Each
freshness gate field gets a focused test that asserts the decision
flips to ``miss`` with a recognizable reason when that field
mismatches.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from clipper.sample_guided_encode.run_cache import (
    CacheReuseDecision,
    cleanup_orphaned_trial_files,
    evaluate_cache_reuse,
    prime_trial_measurement_cache,
    reconstruct_result_from_jsonl,
)
from clipper.sample_guided_encode.types import SampleGuidedEncodeTarget, SampleWindow


def _create_trial_files(
    fingerprint_dir: Path,
    file_name_stem: str,
    crfs_and_windows: list[tuple[int, int]],
    *,
    bytes_per_file: int = 1_000_000,
) -> None:
    """Materialize empty-but-real trial ``.webm`` files so the priming
    code's ``trial_path.is_file()`` + ``stat()`` checks succeed.

    The priming function uses the on-disk file size as the source of
    truth for ``encoded_size_bytes`` (the JSONL value is unreliable
    after legacy bugs), so tests need real files even though the
    contents don't matter for the cache structure under test.
    """
    fingerprint_dir.mkdir(parents=True, exist_ok=True)
    for crf, window_index in crfs_and_windows:
        trial_path = fingerprint_dir / (
            f"{file_name_stem}.crfsearch-trial-crf{crf}-w{window_index}.webm"
        )
        trial_path.write_bytes(b"\0" * bytes_per_file)


def _make_run_jsonl(
    path: Path,
    *,
    run_id: str = "260509T100000",
    encoder_fingerprint: str = "abc123def456",
    search_fingerprint: str = "search789",
    encode_args_signature: dict[str, Any] | None = None,
    algorithm_version: int = 1,
    yt_clipper_version: str = "5.43.0",
    pair_identity: dict[str, Any] | None = None,
    optimal_crf: int | None = 30,
    probes: list[tuple[int, dict[str, float], float]] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pid = pair_identity or {
        "clip_start": 0.0,
        "clip_end": 10.0,
        "source_video_id": {"path": "/src/video.mp4", "mtime": 1700000000.0},
    }
    sig: dict[str, Any] = encode_args_signature or {
        "codec_args": "<args>",
        "filter_graph": "",
        "extras": {"codec": "vp9", "aq_mode": 0},
    }
    records: list[dict[str, Any]] = [
        {
            "type": "run_header",
            "run_id": run_id,
            "run_timestamp_utc": "2026-05-09T10:00:00Z",
            "algorithm_version": algorithm_version,
            "encoder_fingerprint": encoder_fingerprint,
            "search_fingerprint": search_fingerprint,
            "yt_clipper_version": yt_clipper_version,
            "encode_args_signature": sig,
        },
        {
            "type": "search_meta",
            "marker_pair_index": 0,
            "marker_pair_number": 1,
            "title_suffix": "test",
            "codec": "vp9",
            "source_fps": 60,
            "clip_start": pid["clip_start"],
            "clip_end": pid["clip_end"],
            "final_frames_estimate": 600,
            "pair_identity": pid,
            "target": {"mean": 92.0, "low": 95.0, "low_percentile": 5,
                       "crf_min": 20, "crf_max": 42, "crf_absolute_max": 51},
            "sample_windows": [],
        },
    ]
    for crf, summary, bitrate in probes or []:
        records.append({
            "type": "trial",
            "trial_index": crf,
            "crf": crf,
            "phase": "probe",
            "passed": True,
            "low_pct_enforced": True,
            "windows_used": 1,
            "windows_total": 1,
            "window_indices": [0],
            "frame_count": 80,
            "encode_seconds": 5.0,
            "size_percent_of_reference": 50.0,
            "encoded_size_bytes": 1000000,
            "trial_duration_seconds": 4.0,
            "bitrate_kbps": bitrate,
            "summary": {**summary, "frame_count": 80},
            "per_frame_vmaf": [summary.get("p5", 95.0)] * 80,
        })
    records.append({
        "type": "search_result",
        "optimal_crf": optimal_crf,
        "optimal_summary": {
            "mean": 97.0, "p1": 93.0, "p5": 95.0, "p10": 96.0,
            "minimum": 90.0, "frame_count": 80,
        } if optimal_crf is not None else None,
        "kbps_at_target_vmaf": 14000.0,
        "trial_count": len(probes or []),
        "search_seconds": 25.0,
        "search_frames": 240,
        "final_frames_estimate": 600,
    })
    with path.open("w", encoding="utf-8") as fp:
        for rec in records:
            fp.write(json.dumps(rec) + "\n")


def _gate_inputs(**overrides: object) -> dict[str, Any]:
    """Default current-run inputs that match the synthetic JSONL above."""
    base: dict[str, Any] = {
        "encoder_fingerprint": "abc123def456",
        "encoder_signature": {
            "codec_args": "<args>",
            "filter_graph": "",
            "extras": {"codec": "vp9", "aq_mode": 0},
        },
        "search_fingerprint": "search789",
        "algorithm_version": 1,
        "yt_clipper_version": "5.43.0",
        "current_pair_identity": {
            "clip_start": 0.0,
            "clip_end": 10.0,
            "source_video_id": {"path": "/src/video.mp4", "mtime": 1700000000.0},
        },
        "low_pct": 5,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# evaluate_cache_reuse
# ---------------------------------------------------------------------------


def test_evaluate_cache_reuse_no_pair_dir_returns_miss(tmp_path: Path) -> None:
    decision = evaluate_cache_reuse(
        pair_dir=tmp_path / "no-such-pair",
        **_gate_inputs(),
    )
    assert decision.kind == "miss"
    assert decision.prior_run is None
    assert "no prior runs" in decision.reason.lower()


def test_evaluate_cache_reuse_full_hit_when_all_match(tmp_path: Path) -> None:
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
    )
    decision = evaluate_cache_reuse(pair_dir=pair_dir, **_gate_inputs())
    assert decision.kind == "full"
    assert decision.prior_run is not None
    assert decision.prior_run.optimal_crf == 30


def test_evaluate_cache_reuse_partial_hit_on_search_fp_difference(tmp_path: Path) -> None:
    """Same encoder fingerprint, different search fingerprint → partial."""
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        search_fingerprint="search-old",
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(search_fingerprint="search-new"),
    )
    assert decision.kind == "partial"
    assert decision.prior_run is not None
    assert "encoder match" in decision.reason


def test_evaluate_cache_reuse_miss_on_algorithm_version_bump(tmp_path: Path) -> None:
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        algorithm_version=1,
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(algorithm_version=2),
    )
    assert decision.kind == "miss"
    assert "algorithm_version" in decision.reason


def test_evaluate_cache_reuse_miss_on_major_version_bump(tmp_path: Path) -> None:
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        yt_clipper_version="5.43.0",
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(yt_clipper_version="6.0.0"),
    )
    assert decision.kind == "miss"
    assert "yt_clipper_version" in decision.reason


def test_evaluate_cache_reuse_miss_on_minor_version_bump(tmp_path: Path) -> None:
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        yt_clipper_version="5.43.0",
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(yt_clipper_version="5.44.0"),
    )
    assert decision.kind == "miss"


def test_evaluate_cache_reuse_hit_on_patch_version_bump(tmp_path: Path) -> None:
    """Patch-only differences are presumed bug-fix-only and don't bust
    the cache."""
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        yt_clipper_version="5.43.0",
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(yt_clipper_version="5.43.5"),
    )
    assert decision.kind == "full"


def test_evaluate_cache_reuse_miss_on_signature_mismatch(tmp_path: Path) -> None:
    """Defensive: hash matches but literal signature differs (collision
    or fingerprint-derivation bug). Refuse reuse."""
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        encode_args_signature={
            "codec_args": "<old-args>",
            "filter_graph": "",
            "extras": {"codec": "vp9"},
        },
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(encoder_signature={
            "codec_args": "<new-args>",
            "filter_graph": "",
            "extras": {"codec": "vp9"},
        }),
    )
    assert decision.kind == "miss"
    assert "signature" in decision.reason.lower()


def test_evaluate_cache_reuse_miss_on_clip_timing_shift(tmp_path: Path) -> None:
    """User added/removed marker pairs and pair{N} now points to a
    different time range."""
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        pair_identity={
            "clip_start": 0.0, "clip_end": 10.0,
            "source_video_id": {"path": "/src/video.mp4", "mtime": 1700000000.0},
        },
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(current_pair_identity={
            "clip_start": 5.0, "clip_end": 15.0,  # different!
            "source_video_id": {"path": "/src/video.mp4", "mtime": 1700000000.0},
        }),
    )
    assert decision.kind == "miss"
    assert "clip_start" in decision.reason or "clip_end" in decision.reason


def test_evaluate_cache_reuse_miss_on_source_change(tmp_path: Path) -> None:
    """Source video file changed (mtime differs)."""
    pair_dir = tmp_path / "1"
    _make_run_jsonl(
        pair_dir / "abc123def456" / "run-260509T100000.jsonl",
        pair_identity={
            "clip_start": 0.0, "clip_end": 10.0,
            "source_video_id": {"path": "/src/video.mp4", "mtime": 1700000000.0},
        },
    )
    decision = evaluate_cache_reuse(
        pair_dir=pair_dir,
        **_gate_inputs(current_pair_identity={
            "clip_start": 0.0, "clip_end": 10.0,
            "source_video_id": {"path": "/src/video.mp4", "mtime": 1800000000.0},
        }),
    )
    assert decision.kind == "miss"
    assert "source_video_id" in decision.reason


def test_evaluate_cache_reuse_picks_most_recent_run(tmp_path: Path) -> None:
    """Multiple runs in the fingerprint dir → freshness gate runs
    against the most recent."""
    pair_dir = tmp_path / "1"
    fp_dir = pair_dir / "abc123def456"
    _make_run_jsonl(fp_dir / "run-260509T100000.jsonl", optimal_crf=26)
    _make_run_jsonl(fp_dir / "run-260509T120000.jsonl", optimal_crf=30)
    decision = evaluate_cache_reuse(pair_dir=pair_dir, **_gate_inputs())
    assert decision.kind == "full"
    assert decision.prior_run is not None
    assert decision.prior_run.optimal_crf == 30  # most-recent


def test_evaluate_cache_reuse_miss_on_incomplete_run(tmp_path: Path) -> None:
    """A crashed prior (no search_result record) is treated as
    unusable."""
    pair_dir = tmp_path / "1"
    fp_dir = pair_dir / "abc123def456"
    fp_dir.mkdir(parents=True)
    # Only the run_header — no search_result.
    with (fp_dir / "run-260509T100000.jsonl").open("w") as fp:
        fp.write(json.dumps({
            "type": "run_header",
            "run_id": "260509T100000",
            "run_timestamp_utc": "2026-05-09T10:00:00Z",
            "algorithm_version": 1,
            "encoder_fingerprint": "abc123def456",
            "search_fingerprint": "search789",
            "yt_clipper_version": "5.43.0",
            "encoder_config_summary": {},
            "encode_args_signature": "<sig>",
        }) + "\n")
    decision = evaluate_cache_reuse(pair_dir=pair_dir, **_gate_inputs())
    assert decision.kind == "miss"
    assert "incomplete" in decision.reason.lower() or "unreadable" in decision.reason.lower()


# ---------------------------------------------------------------------------
# reconstruct_result_from_jsonl
# ---------------------------------------------------------------------------


def test_reconstruct_result_from_jsonl_returns_search_result(tmp_path: Path) -> None:
    jsonl_path = tmp_path / "run.jsonl"
    _make_run_jsonl(
        jsonl_path,
        optimal_crf=33,
        probes=[
            (20, {"p5": 99.0}, 22000.0),
            (30, {"p5": 96.0}, 15000.0),
            (33, {"p5": 95.0}, 13000.0),
        ],
    )
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=95.0,
        target_vmaf_low_pct=5,
        crf_min=20,
        crf_max=42,
    )
    result = reconstruct_result_from_jsonl(
        jsonl_path,
        target=target,
        sample_windows=[SampleWindow(start=0.0, end=4.0)],
        final_frames_estimate=600,
    )
    assert result is not None
    assert result.optimal_crf == 33
    assert len(result.trials) == 3
    assert result.target == target
    assert result.optimal_summary is not None
    assert result.optimal_summary.p5 == 95.0


def test_reconstruct_result_from_jsonl_missing_search_result_returns_none(
    tmp_path: Path,
) -> None:
    jsonl_path = tmp_path / "run.jsonl"
    with jsonl_path.open("w") as fp:
        fp.write(json.dumps({"type": "run_header"}) + "\n")
    target = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=95.0, target_vmaf_low_pct=5,
        crf_min=20, crf_max=42,
    )
    result = reconstruct_result_from_jsonl(
        jsonl_path, target=target, sample_windows=[], final_frames_estimate=0,
    )
    assert result is None


# ---------------------------------------------------------------------------
# prime_trial_measurement_cache
# ---------------------------------------------------------------------------


def test_prime_trial_measurement_cache_extracts_per_window_entries(
    tmp_path: Path,
) -> None:
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        encoder_fingerprint="abc",
        probes=[
            (20, {"p5": 99.0}, 22000.0),
            (30, {"p5": 96.0}, 15000.0),
        ],
    )
    _create_trial_files(fp_dir, "clip-1", [(20, 0), (30, 0)])
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    # Two probes ⇒ two cache entries, both at window_index=0.
    assert (20, 0) in cache
    assert (30, 0) in cache
    per_frame_20, encoded_size_bytes_20, path_20 = cache[(20, 0)]
    # The cache value's middle slot is encoded_size_bytes derived
    # from the on-disk trial file (NOT frame_count, NOT the
    # JSONL-stored value). _create_trial_files writes 1_000_000
    # bytes by default.
    assert encoded_size_bytes_20 == 1_000_000
    assert len(per_frame_20) == 80
    assert "crfsearch-trial-crf20-w0" in path_20.name


def test_prime_trial_measurement_cache_skips_non_probe_phases(tmp_path: Path) -> None:
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    jsonl_path = fp_dir / "run-x.jsonl"
    records = [
        {"type": "run_header", "run_id": "x"},
        {
            "type": "trial", "phase": "baseline",
            "crf": 28, "window_indices": [0], "encoded_size_bytes": 1_500_000,
            "summary": {"frame_count": 80, "p5": 95.0},
            "per_frame_vmaf": [95.0] * 80, "bitrate_kbps": 12000.0,
        },
        {
            "type": "trial", "phase": "probe",
            "crf": 30, "window_indices": [0], "encoded_size_bytes": 1_400_000,
            "summary": {"frame_count": 80, "p5": 96.0},
            "per_frame_vmaf": [96.0] * 80, "bitrate_kbps": 14000.0,
        },
        {"type": "search_result", "optimal_crf": 30},
    ]
    with jsonl_path.open("w") as fp:
        for r in records:
            fp.write(json.dumps(r) + "\n")
    _create_trial_files(fp_dir, "clip-1", [(28, 0), (30, 0)])
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (30, 0) in cache
    assert (28, 0) not in cache  # baseline excluded


def test_prime_trial_measurement_cache_handles_missing_dir(tmp_path: Path) -> None:
    """Missing fingerprint dir → empty cache, no exception."""
    cache = prime_trial_measurement_cache(
        fingerprint_dir=tmp_path / "no-such-dir",
        file_name_stem="clip-1",
    )
    assert cache == {}


def test_prime_trial_measurement_cache_harvests_from_crashed_run(tmp_path: Path) -> None:
    """A prior run that crashed before writing search_result still
    has valid trial records — those get harvested for the new
    search's measurement cache. Resilience to mid-run interruption."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    crashed_path = fp_dir / "run-crashed.jsonl"
    # No search_result, but two probe trials are present.
    crashed_records = [
        {"type": "run_header", "run_id": "crashed"},
        {
            "type": "trial", "phase": "probe",
            "crf": 25, "window_indices": [0], "encoded_size_bytes": 1_800_000,
            "summary": {"frame_count": 80, "p5": 97.0},
            "per_frame_vmaf": [97.0] * 80, "bitrate_kbps": 18000.0,
        },
        {
            "type": "trial", "phase": "probe",
            "crf": 30, "window_indices": [0], "encoded_size_bytes": 1_400_000,
            "summary": {"frame_count": 80, "p5": 95.5},
            "per_frame_vmaf": [95.5] * 80, "bitrate_kbps": 14000.0,
        },
    ]
    with crashed_path.open("w") as fp:
        for r in crashed_records:
            fp.write(json.dumps(r) + "\n")
    _create_trial_files(fp_dir, "clip-1", [(25, 0), (30, 0)])
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (25, 0) in cache
    assert (30, 0) in cache


def test_prime_trial_measurement_cache_reads_frame_count_at_top_level(
    tmp_path: Path,
) -> None:
    """Production trial JSONL records store ``frame_count`` at the
    top level (alongside ``crf`` / ``phase``), NOT inside ``summary``
    — keeping ``summary`` percentile-only. The priming code must read
    from the right place. Regression for a bug where every priming
    call returned 0 entries because frame_count was looked up in the
    wrong dict, treated as 0, and the record was skipped.

    Also exercises ``encoded_size_bytes`` extraction (the cache
    value's middle slot is size in bytes, used by the live encode-
    and-measure path for trial bitrate / size_percent math)."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    jsonl_path = fp_dir / "run-x.jsonl"
    records = [
        {"type": "run_header", "run_id": "x"},
        # Production format: frame_count + encoded_size_bytes at top level.
        {
            "type": "trial",
            "phase": "probe",
            "crf": 30,
            "window_indices": [0],
            "frame_count": 80,  # <-- top-level
            "encoded_size_bytes": 750_000,  # <-- top-level
            "summary": {"p5": 96.0},  # <-- no frame_count
            "per_frame_vmaf": [96.0] * 80,
            "bitrate_kbps": 14000.0,
        },
        {"type": "search_result", "optimal_crf": 30},
    ]
    with jsonl_path.open("w") as fp:
        for r in records:
            fp.write(json.dumps(r) + "\n")
    _create_trial_files(fp_dir, "clip-1", [(30, 0)], bytes_per_file=750_000)
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (30, 0) in cache
    per_frame, encoded_size_bytes, _ = cache[(30, 0)]
    # Cache value's middle slot is encoded_size_bytes derived from
    # the on-disk trial file (NOT frame_count, NOT the JSONL value).
    assert encoded_size_bytes == 750_000
    assert len(per_frame) == 80


def test_prime_trial_measurement_cache_uses_disk_size_not_jsonl(
    tmp_path: Path,
) -> None:
    """The JSONL''s ``encoded_size_bytes`` value is not load-bearing —
    older buggy versions of priming corrupted it (storing frame_count,
    storing 0). The current code stat()s the trial file on disk for
    ground truth. Even a poisoned ``encoded_size_bytes`` field in the
    JSONL doesn''t affect the primed value if the disk file is
    intact."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    poisoned_path = fp_dir / "run-x.jsonl"
    poisoned_records = [
        {"type": "run_header", "run_id": "x"},
        {
            "type": "trial",
            "phase": "probe",
            "crf": 30,
            "window_indices": [0],
            "frame_count": 80,
            "encoded_size_bytes": 17,  # <-- poison (looks like frame count)
            "summary": {"p5": 96.0},
            "per_frame_vmaf": [96.0] * 80,
            "bitrate_kbps": 0.0,
        },
        {"type": "search_result", "optimal_crf": 30},
    ]
    with poisoned_path.open("w") as fp:
        for r in poisoned_records:
            fp.write(json.dumps(r) + "\n")
    # Real trial file with a real size — disk wins.
    _create_trial_files(fp_dir, "clip-1", [(30, 0)], bytes_per_file=2_500_000)
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (30, 0) in cache
    _, encoded_size_bytes, _ = cache[(30, 0)]
    # Comes from the disk file, not the JSONL''s 17-byte value.
    assert encoded_size_bytes == 2_500_000


# ---------------------------------------------------------------------------
# cleanup_orphaned_trial_files
# ---------------------------------------------------------------------------


def test_cleanup_orphaned_trial_files_keeps_vouched(tmp_path: Path) -> None:
    """A trial file with a matching JSONL record stays put."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        encoder_fingerprint="abc",
        probes=[(30, {"p5": 96.0}, 14000.0)],
    )
    _create_trial_files(fp_dir, "clip-1", [(30, 0)])
    deleted = cleanup_orphaned_trial_files(fp_dir, "clip-1")
    assert deleted == []
    assert (fp_dir / "clip-1.crfsearch-trial-crf30-w0.webm").is_file()


def test_cleanup_orphaned_trial_files_deletes_unvouched(tmp_path: Path) -> None:
    """A trial file with NO JSONL record (interrupted-mid-encode
    orphan) gets deleted."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    # JSONL only vouches for crf=30; trial file at crf=42 is orphaned.
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        encoder_fingerprint="abc",
        probes=[(30, {"p5": 96.0}, 14000.0)],
    )
    _create_trial_files(fp_dir, "clip-1", [(30, 0), (42, 0)])
    deleted = cleanup_orphaned_trial_files(fp_dir, "clip-1")
    assert len(deleted) == 1
    assert deleted[0].name == "clip-1.crfsearch-trial-crf42-w0.webm"
    # crf=30 file kept; crf=42 file deleted.
    assert (fp_dir / "clip-1.crfsearch-trial-crf30-w0.webm").is_file()
    assert not (fp_dir / "clip-1.crfsearch-trial-crf42-w0.webm").exists()


def test_cleanup_orphaned_trial_files_skips_other_pairs(tmp_path: Path) -> None:
    """A trial file for a different pair (different stem) isn't
    touched even if no JSONL records match it."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        encoder_fingerprint="abc",
        probes=[(30, {"p5": 96.0}, 14000.0)],
    )
    _create_trial_files(fp_dir, "clip-1", [(30, 0)])
    _create_trial_files(fp_dir, "other-pair", [(42, 0)])
    deleted = cleanup_orphaned_trial_files(fp_dir, "clip-1")
    # Only clip-1's orphans (none here) are candidates; other-pair's
    # files are out of scope and untouched.
    assert deleted == []
    assert (fp_dir / "other-pair.crfsearch-trial-crf42-w0.webm").is_file()


def test_cleanup_orphaned_trial_files_skips_non_trial_files(tmp_path: Path) -> None:
    """Reference / baseline / config.json files don't match the
    trial pattern and shouldn't be deleted by this function."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    (fp_dir / "config.json").write_text("{}")
    (fp_dir / "clip-1.crfsearch-ref-w0.webm").write_bytes(b"\0" * 1000)
    (fp_dir / "clip-1.crfsearch-baseline.webm").write_bytes(b"\0" * 1000)
    deleted = cleanup_orphaned_trial_files(fp_dir, "clip-1")
    assert deleted == []
    assert (fp_dir / "config.json").exists()
    assert (fp_dir / "clip-1.crfsearch-ref-w0.webm").exists()
    assert (fp_dir / "clip-1.crfsearch-baseline.webm").exists()


def test_cleanup_orphaned_trial_files_handles_missing_dir(tmp_path: Path) -> None:
    """Non-existent dir → empty result, no exception."""
    deleted = cleanup_orphaned_trial_files(
        tmp_path / "no-such-dir", "clip-1",
    )
    assert deleted == []


def test_prime_trial_measurement_cache_skips_when_trial_file_missing(
    tmp_path: Path,
) -> None:
    """If the trial encode file isn''t on disk, priming skips this
    (crf, window_index). The orchestrator''s makeClip will then
    re-encode it fresh, producing a correct size + measurement."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        encoder_fingerprint="abc",
        probes=[(30, {"p5": 96.0}, 14000.0)],
    )
    # No _create_trial_files() call — files are absent.
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (30, 0) not in cache


def test_prime_trial_measurement_cache_combines_across_multiple_runs(
    tmp_path: Path,
) -> None:
    """Multiple prior runs in the same fingerprint dir contribute
    their union of trials. Earlier-encoded CRFs from a crashed run
    plus newer ones from a complete run should all show up."""
    fp_dir = tmp_path / "abc"
    fp_dir.mkdir()
    _make_run_jsonl(
        fp_dir / "run-260509T100000.jsonl",  # earlier
        encoder_fingerprint="abc",
        probes=[(20, {"p5": 99.0}, 22000.0), (25, {"p5": 97.0}, 18000.0)],
    )
    _make_run_jsonl(
        fp_dir / "run-260509T120000.jsonl",  # later
        encoder_fingerprint="abc",
        probes=[(30, {"p5": 96.0}, 14000.0), (35, {"p5": 94.0}, 11000.0)],
    )
    _create_trial_files(
        fp_dir, "clip-1", [(20, 0), (25, 0), (30, 0), (35, 0)],
    )
    cache = prime_trial_measurement_cache(
        fingerprint_dir=fp_dir,
        file_name_stem="clip-1",
    )
    assert (20, 0) in cache
    assert (25, 0) in cache
    assert (30, 0) in cache
    assert (35, 0) in cache


# ---------------------------------------------------------------------------
# CacheReuseDecision basics
# ---------------------------------------------------------------------------


def test_cache_reuse_decision_dataclass_is_frozen() -> None:
    """Decision is immutable so callers can pass it around without
    worrying about mutation."""
    decision = CacheReuseDecision(kind="miss", prior_run=None, reason="x")
    import dataclasses
    assert dataclasses.is_dataclass(decision)
    # frozen=True on the dataclass means assignment raises.
    try:
        decision.kind = "full"  # type: ignore[misc]
    except dataclasses.FrozenInstanceError:
        pass
    else:
        msg = "expected FrozenInstanceError on attribute assignment"
        raise AssertionError(msg)
