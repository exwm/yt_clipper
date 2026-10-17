"""Tests for the run-cache fingerprint primitives.

The encoder fingerprint must satisfy two invariants:
- **Safe**: any change that affects trial-encode bytes flips the
  fingerprint. We test this with representative encoder-flag changes
  (aq-mode, tile-rows, speed) and with extras-dict changes.
- **Stable**: per-trial / per-pair variance (CRF, qmin, qmax,
  trim-range) does NOT flip the fingerprint, and neither does
  reordering flag emission in the source command.

Both properties are necessary for the cache to be useful: safe means
no silent stale-cache hits when settings change; stable means the
cache survives no-op refactors.
"""

from __future__ import annotations

import pytest

from clipper.sample_guided_encode.run_cache import (
    canonicalize_codec_args,
    canonicalize_filter_graph,
    compute_encoder_fingerprint,
    compute_search_fingerprint,
)

# (a, b, same): codec args differing only in per-trial values or layout canonicalize the same
CODEC_ARGS_PAIRS = {
    "crf": ("-c:v libvpx-vp9 -crf 30 -aq-mode 0", "-c:v libvpx-vp9 -crf 42 -aq-mode 0", True),
    "qmin and qmax": ("-crf 30 -qmin 15 -qmax 43", "-crf 42 -qmin 15 -qmax 55", True),
    # The fingerprint is about behavior, not the order the source code emits flags in
    "flag order": ("-c:v libvpx-vp9 -aq-mode 0 -tile-rows 0", "-tile-rows 0 -aq-mode 0 -c:v libvpx-vp9", True),
    "whitespace": ("  -c:v   libvpx-vp9   -aq-mode 0  ", "-c:v libvpx-vp9 -aq-mode 0", True),
    "empty": ("", "   ", True),
    "flag value": ("-c:v libvpx-vp9 -aq-mode 0", "-c:v libvpx-vp9 -aq-mode 4", False),
}


@pytest.mark.parametrize(("a", "b", "same"), CODEC_ARGS_PAIRS.values(), ids=CODEC_ARGS_PAIRS.keys())
def test_canonicalize_codec_args(a: str, b: str, same: bool) -> None:
    assert (canonicalize_codec_args(a) == canonicalize_codec_args(b)) == same


def test_canonicalize_codec_args_marks_crf_keeps_boolean_flags_and_empties_blank_input() -> None:
    assert "<CRF>" in canonicalize_codec_args("-c:v libvpx-vp9 -crf 30 -aq-mode 0")
    # A flag without a value stays standalone after sorting
    boolean = canonicalize_codec_args("-c:v libx264 -fastfirstpass")
    assert "-fastfirstpass" in boolean
    assert "-c:v libx264" in boolean
    assert canonicalize_codec_args("") == ""


FILTER_GRAPH_PAIRS = {
    "trim range": ("trim=12.5:34.7,scale=w=iw/2:h=ih/2", "trim=100.1:200.4,scale=w=iw/2:h=ih/2", True),
    # Each filter feeds the next, so order matters, unlike codec args
    "filter order": ("scale=1920:1080,format=yuv420p", "format=yuv420p,scale=1920:1080", False),
    "filter change": ("trim=0:10,scale=1920:1080", "trim=0:10,scale=1280:720", False),
}


@pytest.mark.parametrize(("a", "b", "same"), FILTER_GRAPH_PAIRS.values(), ids=FILTER_GRAPH_PAIRS.keys())
def test_canonicalize_filter_graph(a: str, b: str, same: bool) -> None:
    assert (canonicalize_filter_graph(a) == canonicalize_filter_graph(b)) == same


def test_canonicalize_filter_graph_marks_the_trim_range() -> None:
    assert "trim=<RANGE>" in canonicalize_filter_graph("trim=12.5:34.7,scale=w=iw/2:h=ih/2")


def _vp9_args_at(crf: int, aq_mode: int = 0, tile_rows: int = 0) -> str:
    """Helper: build a vp9-shaped codec args string with the given knobs."""
    return (
        f"-c:v libvpx-vp9 -pix_fmt yuv420p -slices 8 "
        f"-aq-mode {aq_mode} -row-mt 1 -tile-columns 6 -tile-rows {tile_rows} "
        f"-qmin 15 -crf {crf} -qmax {crf + 13} -b:v 0k -force_key_frames 1 -g 240"
    )


VP9_EXTRAS = {
    "width": 1920,
    "height": 1080,
    "r_frame_rate": 60,
    "speed": 1.0,
    "enableHDR": False,
    "twoPass": False,
    "encodeSpeed": 2,
}
BASE = (_vp9_args_at(30), "trim=0:10", VP9_EXTRAS)

# (a, b, same): (codec args, filter graph, extras) pairs
ENCODER_PAIRS = {
    "crf": (BASE, (_vp9_args_at(42), "trim=0:10", VP9_EXTRAS), True),
    "trim range": (
        (_vp9_args_at(30), "trim=12.5:34.7", VP9_EXTRAS),
        (_vp9_args_at(30), "trim=100.1:200.4", VP9_EXTRAS),
        True,
    ),
    "extras order": (
        (_vp9_args_at(30), "trim=0:10", {"width": 1920, "height": 1080, "speed": 1.0}),
        (_vp9_args_at(30), "trim=0:10", {"speed": 1.0, "height": 1080, "width": 1920}),
        True,
    ),
    "aq-mode": ((_vp9_args_at(30, aq_mode=4), "trim=0:10", VP9_EXTRAS), BASE, False),
    "tile-rows": ((_vp9_args_at(30, tile_rows=2), "trim=0:10", VP9_EXTRAS), BASE, False),
    "filter graph": (
        (_vp9_args_at(30), "trim=0:10,scale=1920:1080", VP9_EXTRAS),
        (_vp9_args_at(30), "trim=0:10,scale=1280:720", VP9_EXTRAS),
        False,
    ),
    # Speed also reaches the filter graph (setpts); extras carry it too
    "speed extra": (BASE, (_vp9_args_at(30), "trim=0:10", {**VP9_EXTRAS, "speed": 2.0}), False),
    "hdr extra": (BASE, (_vp9_args_at(30), "trim=0:10", {**VP9_EXTRAS, "enableHDR": True}), False),
}


@pytest.mark.parametrize(("a", "b", "same"), ENCODER_PAIRS.values(), ids=ENCODER_PAIRS.keys())
def test_encoder_fingerprint(a: tuple, b: tuple, same: bool) -> None:
    fingerprint_a, signature_a = compute_encoder_fingerprint(*a)
    fingerprint_b, signature_b = compute_encoder_fingerprint(*b)
    assert (fingerprint_a == fingerprint_b) == same
    # Equal inputs give the same signature string, not just the same hash
    assert (signature_a == signature_b) == same


SEARCH_BASE = (95.0, 5, 92.0, 16, 42)
SEARCH_PAIRS = {
    "identical": (SEARCH_BASE, True),
    # int and float come from config plumbing where the difference is incidental
    "int and float": ((95, 5, 92, 16, 42), True),
    "target vmaf low": ((92.0, 5, 92.0, 16, 42), False),
    "percentile": ((95.0, 10, 92.0, 16, 42), False),
    "crf range low": ((95.0, 5, 92.0, 20, 42), False),
    "crf range high": ((95.0, 5, 92.0, 16, 51), False),
}


@pytest.mark.parametrize(("other", "same"), SEARCH_PAIRS.values(), ids=SEARCH_PAIRS.keys())
def test_search_fingerprint(other: tuple, same: bool) -> None:
    assert (compute_search_fingerprint(*SEARCH_BASE) == compute_search_fingerprint(*other)) == same


def test_fingerprints_are_12_hex_digits() -> None:
    fingerprints = [compute_encoder_fingerprint(*BASE)[0], compute_search_fingerprint(*SEARCH_BASE)]
    for fingerprint in fingerprints:
        assert len(fingerprint) == 12
        assert all(c in "0123456789abcdef" for c in fingerprint)
