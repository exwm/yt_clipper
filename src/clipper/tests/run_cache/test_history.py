"""Tests for ``run_cache.history.load_prior_runs`` and parsing.

The history loader is the read-side of the per-fingerprint storage
layout phase 2 introduced. It must:
- Parse the run_header / search_result / trial records correctly.
- Filter to phase=probe/verify only (skip baseline + reference).
- Skip files missing required records (crashed runs, partials).
- Group by encoder_fingerprint and return one most-recent per group.
- Sort by run_id descending (most recent first).
- Honor ``exclude_fingerprint``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from clipper.sample_guided_encode.run_cache import PriorRun, load_prior_runs


def _make_run_jsonl(
    path: Path,
    *,
    run_id: str,
    encoder_fingerprint: str,
    optimal_crf: int | None = 30,
    probes: list[tuple[int, dict[str, float], float]] | None = None,
    encoder_config_summary: dict[str, Any] | None = None,
    include_search_result: bool = True,
) -> None:
    """Write a synthetic run JSONL covering header + trials + result.

    ``probes`` is a list of ``(crf, summary_dict, bitrate_kbps)`` tuples
    that get serialized as ``trial`` records with phase=probe.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = [
        {
            "type": "run_header",
            "run_id": run_id,
            "run_timestamp_utc": "2026-05-09T10:06:06Z",
            "algorithm_version": 1,
            "encoder_fingerprint": encoder_fingerprint,
            "search_fingerprint": "search12345",
            "yt_clipper_version": "5.43.0",
            "encoder_config_summary": (
                encoder_config_summary or {"codec": "vp9", "aq_mode": 0}
            ),
            "encode_args_signature": "<signature>",
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
            "frame_count": 80,
            "encode_seconds": 5.0,
            "size_percent_of_reference": 50.0,
            "encoded_size_bytes": 1000000,
            "trial_duration_seconds": 4.0,
            "bitrate_kbps": bitrate,
            "summary": summary,
            "per_frame_vmaf": [],
        })
    if include_search_result:
        records.append({
            "type": "search_result",
            "optimal_crf": optimal_crf,
            "optimal_summary": None,
            "kbps_at_target_vmaf": None,
            "trial_count": len(probes or []),
            "search_seconds": 25.0,
            "search_frames": 240,
            "final_frames_estimate": 1000,
        })
    with path.open("w", encoding="utf-8") as fp:
        for rec in records:
            fp.write(json.dumps(rec) + "\n")


def test_load_prior_runs_returns_empty_when_dir_missing(tmp_path: Path) -> None:
    """First-run case: no pair dir on disk yet."""
    pair_dir = tmp_path / "no-such-pair"
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert runs == []


def test_load_prior_runs_returns_empty_when_dir_empty(tmp_path: Path) -> None:
    pair_dir = tmp_path / "title-pair1"
    pair_dir.mkdir()
    assert load_prior_runs(pair_dir, low_pct=5) == []


def test_load_prior_runs_parses_one_run(tmp_path: Path) -> None:
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc123"
    _make_run_jsonl(
        fp_dir / "run-260509T100000.jsonl",
        run_id="260509T100000",
        encoder_fingerprint="abc123",
        optimal_crf=30,
        probes=[
            (20, {"p5": 99.0}, 22000.0),
            (30, {"p5": 96.0}, 15000.0),
            (42, {"p5": 90.0}, 8000.0),
        ],
    )
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 1
    assert isinstance(runs[0], PriorRun)
    assert runs[0].encoder_fingerprint == "abc123"
    assert runs[0].optimal_crf == 30
    assert runs[0].probes == [(20, 99.0, 22000.0), (30, 96.0, 15000.0), (42, 90.0, 8000.0)]


def test_load_prior_runs_picks_most_recent_per_fingerprint(tmp_path: Path) -> None:
    """Two runs in the same fingerprint dir → most recent wins."""
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc123"
    _make_run_jsonl(
        fp_dir / "run-260509T100000.jsonl",
        run_id="260509T100000",
        encoder_fingerprint="abc123",
        optimal_crf=30,
    )
    _make_run_jsonl(
        fp_dir / "run-260509T120000.jsonl",
        run_id="260509T120000",
        encoder_fingerprint="abc123",
        optimal_crf=32,
    )
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 1
    assert runs[0].run_id == "260509T120000"
    assert runs[0].optimal_crf == 32


def test_load_prior_runs_groups_by_fingerprint(tmp_path: Path) -> None:
    """Distinct fingerprint dirs each contribute one run."""
    pair_dir = tmp_path / "title-pair1"
    _make_run_jsonl(
        pair_dir / "abc" / "run-260509T100000.jsonl",
        run_id="260509T100000",
        encoder_fingerprint="abc",
        optimal_crf=26,
    )
    _make_run_jsonl(
        pair_dir / "def" / "run-260509T120000.jsonl",
        run_id="260509T120000",
        encoder_fingerprint="def",
        optimal_crf=30,
    )
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 2
    # Sorted by run_id descending — most recent first.
    assert runs[0].encoder_fingerprint == "def"
    assert runs[1].encoder_fingerprint == "abc"


def test_load_prior_runs_excludes_fingerprint(tmp_path: Path) -> None:
    """``exclude_fingerprint`` filters out the current run's dir
    so cross-config delta doesn't include the current config as
    a 'prior'."""
    pair_dir = tmp_path / "title-pair1"
    _make_run_jsonl(
        pair_dir / "abc" / "run-260509T100000.jsonl",
        run_id="260509T100000",
        encoder_fingerprint="abc",
    )
    _make_run_jsonl(
        pair_dir / "def" / "run-260509T120000.jsonl",
        run_id="260509T120000",
        encoder_fingerprint="def",
    )
    runs = load_prior_runs(pair_dir, low_pct=5, exclude_fingerprint="def")
    assert len(runs) == 1
    assert runs[0].encoder_fingerprint == "abc"


def test_load_prior_runs_skips_runs_missing_search_result(tmp_path: Path) -> None:
    """A crashed run that didn't write search_result must be ignored."""
    pair_dir = tmp_path / "title-pair1"
    _make_run_jsonl(
        pair_dir / "abc" / "run-260509T100000.jsonl",
        run_id="260509T100000",
        encoder_fingerprint="abc",
        include_search_result=False,
    )
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert runs == []


def test_load_prior_runs_skips_baseline_and_reference_trials(tmp_path: Path) -> None:
    """The auto-delta uses pure CRF-response curves; baseline and
    reference trials would skew interpolation."""
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc"
    fp_dir.mkdir(parents=True)
    records = [
        {
            "type": "run_header",
            "run_id": "260509T100000",
            "run_timestamp_utc": "2026-05-09T10:00:00Z",
            "algorithm_version": 1,
            "encoder_fingerprint": "abc",
            "search_fingerprint": "x",
            "yt_clipper_version": "5.43.0",
            "encoder_config_summary": {"codec": "vp9"},
            "encode_args_signature": "x",
        },
        {
            "type": "trial",
            "phase": "baseline",  # <- excluded
            "crf": 28,
            "summary": {"p5": 95.0},
            "bitrate_kbps": 12000.0,
        },
        {
            "type": "trial",
            "phase": "reference",  # <- excluded
            "crf": 18,
            "summary": {"p5": 99.5},
            "bitrate_kbps": 25000.0,
        },
        {
            "type": "trial",
            "phase": "probe",  # <- included
            "crf": 30,
            "summary": {"p5": 96.0},
            "bitrate_kbps": 14000.0,
        },
        {
            "type": "search_result",
            "optimal_crf": 30,
        },
    ]
    with (fp_dir / "run-260509T100000.jsonl").open("w", encoding="utf-8") as fp:
        for r in records:
            fp.write(json.dumps(r) + "\n")
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 1
    assert runs[0].probes == [(30, 96.0, 14000.0)]


def test_load_prior_runs_skips_invalid_jsonl_lines(tmp_path: Path) -> None:
    """Invalid JSON lines are skipped, not fatal — a half-written
    record from a crash shouldn't poison the whole file."""
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc"
    fp_dir.mkdir(parents=True)
    valid_records = [
        {
            "type": "run_header",
            "run_id": "260509T100000",
            "run_timestamp_utc": "2026-05-09T10:00:00Z",
            "algorithm_version": 1,
            "encoder_fingerprint": "abc",
            "search_fingerprint": "x",
            "yt_clipper_version": "5.43.0",
            "encoder_config_summary": {"codec": "vp9"},
            "encode_args_signature": "x",
        },
        {
            "type": "search_result",
            "optimal_crf": 30,
        },
    ]
    with (fp_dir / "run-x.jsonl").open("w", encoding="utf-8") as fp:
        fp.write(json.dumps(valid_records[0]) + "\n")
        fp.write("not-json garbage\n")
        fp.write(json.dumps(valid_records[1]) + "\n")
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 1
    assert runs[0].run_id == "260509T100000"


def test_load_prior_runs_extracts_correct_low_pct(tmp_path: Path) -> None:
    """Each prior trial's summary holds all six percentiles; the
    loader extracts whichever the current run uses (decoupled from
    the prior run's choice)."""
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc"
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        run_id="x",
        encoder_fingerprint="abc",
        probes=[
            (20, {"p1": 90.0, "p5": 95.0, "p20": 98.0}, 20000.0),
        ],
    )
    runs_p5 = load_prior_runs(pair_dir, low_pct=5)
    runs_p20 = load_prior_runs(pair_dir, low_pct=20)
    assert runs_p5[0].probes == [(20, 95.0, 20000.0)]
    assert runs_p20[0].probes == [(20, 98.0, 20000.0)]


def test_load_prior_runs_skips_files_with_invalid_p_low(tmp_path: Path) -> None:
    """Trials with NaN p_low or zero/negative bitrate are filtered
    out — they'd corrupt interpolation."""
    pair_dir = tmp_path / "title-pair1"
    fp_dir = pair_dir / "abc"
    _make_run_jsonl(
        fp_dir / "run-x.jsonl",
        run_id="x",
        encoder_fingerprint="abc",
        probes=[
            (20, {"p5": float("nan")}, 20000.0),  # excluded
            (25, {"p5": 95.0}, 0.0),  # excluded (zero bitrate)
            (30, {"p5": 96.0}, 14000.0),  # included
        ],
    )
    runs = load_prior_runs(pair_dir, low_pct=5)
    assert len(runs) == 1
    assert runs[0].probes == [(30, 96.0, 14000.0)]
