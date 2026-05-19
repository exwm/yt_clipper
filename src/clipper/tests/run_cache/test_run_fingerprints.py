"""Tests for ``orchestrator._compute_run_fingerprints``.

Covers the glue function that turns a settings dict + marker snapshot
+ SampleGuidedEncodeTarget into a full fingerprint bundle (encoder + search +
config summary). This is the function the orchestrator calls at the
top of every sample-guided encode to pin the per-run JSONL to a fingerprint
subdirectory.

The function itself is private (underscore prefix), but exposed here
for integration coverage so behavior changes are caught without
needing a full live encode harness.
"""

from __future__ import annotations

from clipper.sample_guided_encode.orchestrator import _compute_run_fingerprints
from clipper.sample_guided_encode.types import SampleGuidedEncodeTarget


def _settings(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "videoCodec": "vp9",
        "width": 1920,
        "height": 1080,
        "r_frame_rate": 60,
        "enableHDR": False,
        "twoPass": False,
        "encodeSpeed": 2,
    }
    base.update(overrides)
    return base


def _snapshot(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "speed": 1.0,
        "averageSpeed": 1.0,
        "isVariableSpeed": False,
    }
    base.update(overrides)
    return base


def _target() -> SampleGuidedEncodeTarget:
    return SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0,
        target_vmaf_low=95.0,
        target_vmaf_low_pct=5,
        crf_min=20,
        crf_max=42,
    )


def test_compute_run_fingerprints_smoke() -> None:
    """Synthetic settings + snapshot produce a non-empty bundle."""
    fps = _compute_run_fingerprints("vp9", _settings(), _snapshot(), _target())
    assert len(fps.encoder_fingerprint) == 12
    assert len(fps.search_fingerprint) == 12
    assert fps.encode_args_signature  # non-empty dict
    assert fps.encoder_config["codec"] == "vp9"


def test_compute_run_fingerprints_stable_across_calls() -> None:
    """Identical inputs ⇒ identical fingerprints. This is the
    foundational property the cache depends on."""
    a = _compute_run_fingerprints("vp9", _settings(), _snapshot(), _target())
    b = _compute_run_fingerprints("vp9", _settings(), _snapshot(), _target())
    assert a.encoder_fingerprint == b.encoder_fingerprint
    assert a.search_fingerprint == b.search_fingerprint
    assert a.encode_args_signature == b.encode_args_signature


def test_compute_run_fingerprints_flips_on_codec_change() -> None:
    a = _compute_run_fingerprints("vp9", _settings(videoCodec="vp9"), _snapshot(), _target())
    b = _compute_run_fingerprints("h264", _settings(videoCodec="h264"), _snapshot(), _target())
    assert a.encoder_fingerprint != b.encoder_fingerprint


def test_compute_run_fingerprints_flips_on_speed_change() -> None:
    """Speed feeds the filter graph (setpts) and the GOP size, so
    same encoder settings + different speed must produce different
    fingerprints."""
    a = _compute_run_fingerprints("vp9", _settings(), _snapshot(speed=1.0), _target())
    b = _compute_run_fingerprints("vp9", _settings(), _snapshot(speed=2.0), _target())
    assert a.encoder_fingerprint != b.encoder_fingerprint


def test_compute_run_fingerprints_flips_on_hdr_change() -> None:
    a = _compute_run_fingerprints("vp9", _settings(enableHDR=False), _snapshot(), _target())
    b = _compute_run_fingerprints("vp9", _settings(enableHDR=True), _snapshot(), _target())
    assert a.encoder_fingerprint != b.encoder_fingerprint


def test_compute_run_fingerprints_search_fp_independent_of_encoder_settings() -> None:
    """Encoder changes shouldn't bust the search fingerprint, since it
    only encodes target-VMAF / CRF-range parameters."""
    a = _compute_run_fingerprints("vp9", _settings(width=1920), _snapshot(), _target())
    b = _compute_run_fingerprints("vp9", _settings(width=1280), _snapshot(), _target())
    assert a.encoder_fingerprint != b.encoder_fingerprint
    assert a.search_fingerprint == b.search_fingerprint


def test_compute_run_fingerprints_search_fp_flips_on_target_change() -> None:
    target_a = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=95.0, target_vmaf_low_pct=5,
        crf_min=20, crf_max=42,
    )
    target_b = SampleGuidedEncodeTarget(
        target_vmaf_mean=92.0, target_vmaf_low=92.0, target_vmaf_low_pct=5,
        crf_min=20, crf_max=42,
    )
    a = _compute_run_fingerprints("vp9", _settings(), _snapshot(), target_a)
    b = _compute_run_fingerprints("vp9", _settings(), _snapshot(), target_b)
    # Encoder fingerprint stable; search fingerprint different.
    assert a.encoder_fingerprint == b.encoder_fingerprint
    assert a.search_fingerprint != b.search_fingerprint


def test_compute_run_fingerprints_encoder_config_contains_readable_fields() -> None:
    """The ``encoder_config`` (signature.extras) feeds the auto-delta
    render's diff label — must contain the human-readable knobs."""
    fps = _compute_run_fingerprints("vp9", _settings(), _snapshot(), _target())
    config = fps.encoder_config
    assert "codec" in config
    assert "width" in config
    assert "height" in config
    assert "speed" in config
    assert "enableHDR" in config


def test_compute_run_fingerprints_stable_across_twoPass_toggle() -> None:
    """``twoPass`` is force-disabled for trial / reference / baseline
    encodes (see ``_TRIAL_PIPELINE_OVERRIDES``), so trial bytes don't
    depend on the user's two-pass setting. The fingerprint must be
    stable across the toggle — otherwise users lose cache hits when
    flipping two-pass between runs, even though the picked CRF would
    be identical."""
    a = _compute_run_fingerprints("vp9", _settings(twoPass=False), _snapshot(), _target())
    b = _compute_run_fingerprints("vp9", _settings(twoPass=True), _snapshot(), _target())
    assert a.encoder_fingerprint == b.encoder_fingerprint
    assert "twoPass" not in a.encoder_config


def test_compute_run_fingerprints_stable_across_videoStabilization_toggle() -> None:
    """``videoStabilization`` is force-disabled for trials (same
    rationale as ``twoPass`` — vidstabdetect + vidstabtransform are
    skipped during search). The fingerprint must be stable across the
    toggle so toggling stabilization doesn't bust the cache."""
    disabled = {"enabled": False, "desc": "Disabled"}
    enabled = {
        "enabled": True, "shakiness": 6, "zoomspeed": 0.2,
        "smoothing": 6, "desc": "Medium",
    }
    a = _compute_run_fingerprints(
        "vp9", _settings(videoStabilization=disabled), _snapshot(), _target(),
    )
    b = _compute_run_fingerprints(
        "vp9", _settings(videoStabilization=enabled), _snapshot(), _target(),
    )
    assert a.encoder_fingerprint == b.encoder_fingerprint
    assert "videoStabilization" not in a.encoder_config


def test_compute_run_fingerprints_signature_strips_per_trial_crf() -> None:
    """The signature is the canonicalized command. A sentinel CRF=30
    is used internally; canonicalization should strip it to <CRF>
    so the signature doesn't leak the sentinel."""
    fps = _compute_run_fingerprints("vp9", _settings(), _snapshot(), _target())
    codec_args = fps.encode_args_signature["codec_args"]
    # 30 should appear nowhere as a literal CRF value (we'd see it as
    # `-crf 30` if canonicalization broke).
    assert "-crf 30" not in codec_args
    assert "<CRF>" in codec_args
