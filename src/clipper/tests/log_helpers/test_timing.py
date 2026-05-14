"""Tests for the StageTimer and run-timing renderer."""

from __future__ import annotations

import pytest

from clipper.log_helpers.timing import (
    StageTimer,
    get_timer,
    render_timing_summary,
)


@pytest.fixture(autouse=True)
def _reset_global_timer() -> None:
    get_timer().reset()


def test_stage_timer_records_in_order() -> None:
    timer = StageTimer()
    with timer.stage("a"):
        pass
    with timer.stage("b"):
        pass
    names = [name for name, _ in timer.records()]
    assert names == ["a", "b"]


def test_stage_timer_records_repeated_names_as_separate_entries() -> None:
    timer = StageTimer()
    with timer.stage("encode"):
        pass
    with timer.stage("encode"):
        pass
    assert [name for name, _ in timer.records()] == ["encode", "encode"]


def test_stage_timer_elapsed_is_nonnegative() -> None:
    timer = StageTimer()
    with timer.stage("noop"):
        pass
    [(_, elapsed)] = timer.records()
    assert elapsed >= 0.0


def test_render_returns_empty_when_no_stages() -> None:
    get_timer().reset()
    assert render_timing_summary() == ""


def test_render_includes_all_stage_names_and_total() -> None:
    timer = get_timer()
    with timer.stage("(1) crf search"):
        pass
    with timer.stage("(1) encode"):
        pass
    out = render_timing_summary()
    assert "(1) crf search" in out
    assert "(1) encode" in out
    assert "total" in out
