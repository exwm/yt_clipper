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

from clipper.sample_guided_encode.run_cache import (
    canonicalize_codec_args,
    canonicalize_filter_graph,
    compute_encoder_fingerprint,
    compute_search_fingerprint,
)

# ---------------------------------------------------------------------------
# canonicalize_codec_args
# ---------------------------------------------------------------------------


def test_canonicalize_codec_args_strips_crf() -> None:
    a = canonicalize_codec_args("-c:v libvpx-vp9 -crf 30 -aq-mode 0")
    b = canonicalize_codec_args("-c:v libvpx-vp9 -crf 42 -aq-mode 0")
    assert a == b
    assert "<CRF>" in a


def test_canonicalize_codec_args_strips_qmin_and_qmax() -> None:
    a = canonicalize_codec_args("-crf 30 -qmin 15 -qmax 43")
    b = canonicalize_codec_args("-crf 42 -qmin 15 -qmax 55")
    assert a == b


def test_canonicalize_codec_args_sorts_flags() -> None:
    """Reordering flag emission in source code shouldn't flip the
    canonical form — the fingerprint is about behavior, not source
    layout."""
    a = canonicalize_codec_args("-c:v libvpx-vp9 -aq-mode 0 -tile-rows 0")
    b = canonicalize_codec_args("-tile-rows 0 -aq-mode 0 -c:v libvpx-vp9")
    assert a == b


def test_canonicalize_codec_args_distinguishes_flag_value_changes() -> None:
    a = canonicalize_codec_args("-c:v libvpx-vp9 -aq-mode 0")
    b = canonicalize_codec_args("-c:v libvpx-vp9 -aq-mode 4")
    assert a != b


def test_canonicalize_codec_args_handles_boolean_flags() -> None:
    """A flag without a following value (boolean style) should be
    preserved standalone after sorting."""
    a = canonicalize_codec_args("-c:v libx264 -fastfirstpass")
    assert "-fastfirstpass" in a
    assert "-c:v libx264" in a


def test_canonicalize_codec_args_collapses_whitespace() -> None:
    a = canonicalize_codec_args("  -c:v   libvpx-vp9   -aq-mode 0  ")
    b = canonicalize_codec_args("-c:v libvpx-vp9 -aq-mode 0")
    assert a == b


def test_canonicalize_codec_args_empty_input_returns_empty() -> None:
    assert canonicalize_codec_args("") == ""
    assert canonicalize_codec_args("   ") == ""


# ---------------------------------------------------------------------------
# canonicalize_filter_graph
# ---------------------------------------------------------------------------


def test_canonicalize_filter_graph_strips_trim_range() -> None:
    a = canonicalize_filter_graph("trim=12.5:34.7,scale=w=iw/2:h=ih/2")
    b = canonicalize_filter_graph("trim=100.1:200.4,scale=w=iw/2:h=ih/2")
    assert a == b
    assert "trim=<RANGE>" in a


def test_canonicalize_filter_graph_preserves_filter_order() -> None:
    """Filter chains are order-sensitive (each filter feeds the next),
    so canonicalization must preserve order — unlike codec args."""
    a = canonicalize_filter_graph("scale=1920:1080,format=yuv420p")
    b = canonicalize_filter_graph("format=yuv420p,scale=1920:1080")
    assert a != b


def test_canonicalize_filter_graph_distinguishes_filter_changes() -> None:
    a = canonicalize_filter_graph("trim=0:10,scale=1920:1080")
    b = canonicalize_filter_graph("trim=0:10,scale=1280:720")
    assert a != b


# ---------------------------------------------------------------------------
# compute_encoder_fingerprint
# ---------------------------------------------------------------------------


def _vp9_args_at(crf: int, aq_mode: int = 0, tile_rows: int = 0) -> str:
    """Helper: build a vp9-shaped codec args string with the given knobs."""
    return (
        f"-c:v libvpx-vp9 -pix_fmt yuv420p -slices 8 "
        f"-aq-mode {aq_mode} -row-mt 1 -tile-columns 6 -tile-rows {tile_rows} "
        f"-qmin 15 -crf {crf} -qmax {crf + 13} -b:v 0k -force_key_frames 1 -g 240"
    )


def _vp9_extras() -> dict[str, object]:
    return {
        "width": 1920,
        "height": 1080,
        "r_frame_rate": 60,
        "speed": 1.0,
        "enableHDR": False,
        "twoPass": False,
        "encodeSpeed": 2,
    }


def test_encoder_fingerprint_stable_across_crf_changes() -> None:
    fp_a, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", _vp9_extras())
    fp_b, _ = compute_encoder_fingerprint(_vp9_args_at(42), "trim=0:10", _vp9_extras())
    assert fp_a == fp_b


def test_encoder_fingerprint_stable_across_trim_range() -> None:
    fp_a, _ = compute_encoder_fingerprint(
        _vp9_args_at(30), "trim=12.5:34.7", _vp9_extras(),
    )
    fp_b, _ = compute_encoder_fingerprint(
        _vp9_args_at(30), "trim=100.1:200.4", _vp9_extras(),
    )
    assert fp_a == fp_b


def test_encoder_fingerprint_flips_on_aq_mode_change() -> None:
    fp_old, _ = compute_encoder_fingerprint(
        _vp9_args_at(30, aq_mode=4), "trim=0:10", _vp9_extras(),
    )
    fp_new, _ = compute_encoder_fingerprint(
        _vp9_args_at(30, aq_mode=0), "trim=0:10", _vp9_extras(),
    )
    assert fp_old != fp_new


def test_encoder_fingerprint_flips_on_tile_rows_change() -> None:
    fp_old, _ = compute_encoder_fingerprint(
        _vp9_args_at(30, tile_rows=2), "trim=0:10", _vp9_extras(),
    )
    fp_new, _ = compute_encoder_fingerprint(
        _vp9_args_at(30, tile_rows=0), "trim=0:10", _vp9_extras(),
    )
    assert fp_old != fp_new


def test_encoder_fingerprint_flips_on_filter_graph_change() -> None:
    fp_a, _ = compute_encoder_fingerprint(
        _vp9_args_at(30), "trim=0:10,scale=1920:1080", _vp9_extras(),
    )
    fp_b, _ = compute_encoder_fingerprint(
        _vp9_args_at(30), "trim=0:10,scale=1280:720", _vp9_extras(),
    )
    assert fp_a != fp_b


def test_encoder_fingerprint_flips_on_speed_extra() -> None:
    """Speed shows up in the filter graph (setpts) and in extras as a
    belt-and-suspenders. A speed change must flip the fingerprint."""
    extras_a = _vp9_extras()
    extras_b = {**_vp9_extras(), "speed": 2.0}
    fp_a, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_a)
    fp_b, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_b)
    assert fp_a != fp_b


def test_encoder_fingerprint_flips_on_hdr_extra() -> None:
    extras_sdr = _vp9_extras()
    extras_hdr = {**_vp9_extras(), "enableHDR": True}
    fp_a, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_sdr)
    fp_b, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_hdr)
    assert fp_a != fp_b


def test_encoder_fingerprint_signature_is_deterministic() -> None:
    """Two calls with identical inputs return the same signature
    string (not just the same hash)."""
    _, sig_a = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", _vp9_extras())
    _, sig_b = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", _vp9_extras())
    assert sig_a == sig_b


def test_encoder_fingerprint_extras_keys_canonically_ordered() -> None:
    """Extras dict insertion order shouldn't affect the signature."""
    extras_a = {"width": 1920, "height": 1080, "speed": 1.0}
    extras_b = {"speed": 1.0, "height": 1080, "width": 1920}
    fp_a, sig_a = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_a)
    fp_b, sig_b = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", extras_b)
    assert fp_a == fp_b
    assert sig_a == sig_b


def test_encoder_fingerprint_is_short_and_hex() -> None:
    fp, _ = compute_encoder_fingerprint(_vp9_args_at(30), "trim=0:10", _vp9_extras())
    assert len(fp) == 12
    assert all(c in "0123456789abcdef" for c in fp)


# ---------------------------------------------------------------------------
# compute_search_fingerprint
# ---------------------------------------------------------------------------


def test_search_fingerprint_stable_across_identical_inputs() -> None:
    a = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    b = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    assert a == b


def test_search_fingerprint_flips_on_target_vmaf_low_change() -> None:
    a = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    b = compute_search_fingerprint(92.0, 5, 92.0, 16, 42)
    assert a != b


def test_search_fingerprint_flips_on_percentile_change() -> None:
    a = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    b = compute_search_fingerprint(95.0, 10, 92.0, 16, 42)
    assert a != b


def test_search_fingerprint_flips_on_crf_range_change() -> None:
    a = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    b = compute_search_fingerprint(95.0, 5, 92.0, 20, 42)
    assert a != b
    c = compute_search_fingerprint(95.0, 5, 92.0, 16, 51)
    assert a != c


def test_search_fingerprint_is_short_and_hex() -> None:
    fp = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    assert len(fp) == 12
    assert all(c in "0123456789abcdef" for c in fp)


def test_search_fingerprint_treats_int_and_float_consistently() -> None:
    """Avoid the trap where ``95`` and ``95.0`` hash to different
    fingerprints — both come from user-config plumbing where the
    int/float distinction is incidental."""
    a = compute_search_fingerprint(95, 5, 92, 16, 42)  # type: ignore[arg-type]
    b = compute_search_fingerprint(95.0, 5, 92.0, 16, 42)
    assert a == b
