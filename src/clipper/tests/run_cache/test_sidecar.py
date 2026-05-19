"""Tests for the per-fingerprint config sidecar writes.

The sidecar must be:
- **Idempotent**: running twice on the same dir doesn't rewrite (so
  ``first_seen_utc`` is preserved across runs).
- **Self-describing**: contains the encoder config summary, the
  canonicalized signature, and the yt_clipper version that wrote it.
- **JSON-parseable**: future readers in phase 3 (auto-delta) and
  phase 4 (cache gate) parse the JSON to extract fields, so it must
  be well-formed.
"""

from __future__ import annotations

import json
from pathlib import Path

from clipper.sample_guided_encode.run_cache import (
    check_encode_meta_sidecar,
    write_config_sidecar,
    write_encode_meta_sidecar,
)


def _signature(**extras_overrides: object) -> dict[str, object]:
    """Default structured signature for sidecar tests."""
    extras: dict[str, object] = {"codec": "vp9", "aq_mode": 0, "tile_rows": 0}
    extras.update(extras_overrides)
    return {"codec_args": "-aq-mode 0 ...", "filter_graph": "", "extras": extras}


def test_write_config_sidecar_creates_file_with_expected_fields(
    tmp_path: Path,
) -> None:
    fp_dir = tmp_path / "title-pair1" / "abc123def456"
    sig = _signature()
    sidecar_path = write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc123def456",
        encode_args_signature=sig,
        yt_clipper_version="5.43.0",
    )
    assert sidecar_path == fp_dir / "config.json"
    assert sidecar_path.exists()
    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert payload["encoder_fingerprint"] == "abc123def456"
    assert payload["yt_clipper_version"] == "5.43.0"
    assert payload["encode_args_signature"] == sig
    assert "first_seen_utc" in payload
    # algorithm_version intentionally omitted (per-fingerprint dirs may
    # span algorithm versions; first-seen value would go stale).
    assert "algorithm_version" not in payload


def test_write_config_sidecar_creates_parent_directories(tmp_path: Path) -> None:
    fp_dir = tmp_path / "deeply" / "nested" / "title-pair1" / "abc"
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    assert (fp_dir / "config.json").exists()


def test_write_config_sidecar_is_idempotent(tmp_path: Path) -> None:
    """A second call on an existing dir must not rewrite — first_seen_utc
    is the load-bearing field that distinguishes a re-run from a
    first-encounter, and rewriting it would lose that signal."""
    fp_dir = tmp_path / "title-pair1" / "abc"
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    sidecar_path = fp_dir / "config.json"
    original_content = sidecar_path.read_text(encoding="utf-8")
    original_mtime = sidecar_path.stat().st_mtime

    # Second call with different signature — should be a no-op.
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(codec="h264"),  # different!
        yt_clipper_version="9.99.0",  # different!
    )
    assert sidecar_path.read_text(encoding="utf-8") == original_content
    assert sidecar_path.stat().st_mtime == original_mtime


def test_write_config_sidecar_returns_existing_path_on_repeat_call(
    tmp_path: Path,
) -> None:
    fp_dir = tmp_path / "title-pair1" / "abc"
    path1 = write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    path2 = write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    assert path1 == path2


def test_write_config_sidecar_first_seen_utc_is_iso_zulu(tmp_path: Path) -> None:
    fp_dir = tmp_path / "title-pair1" / "abc"
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    payload = json.loads((fp_dir / "config.json").read_text(encoding="utf-8"))
    # YYYY-MM-DDTHH:MM:SSZ — 20 chars, ends with Z, no fractional seconds.
    timestamp = payload["first_seen_utc"]
    assert len(timestamp) == 20
    assert timestamp.endswith("Z")
    assert timestamp[10] == "T"


def test_write_config_sidecar_json_is_pretty_printed(tmp_path: Path) -> None:
    """Pretty-print so an operator can ``cat`` the file and read it
    without tooling."""
    fp_dir = tmp_path / "title-pair1" / "abc"
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        yt_clipper_version="5.43.0",
    )
    text = (fp_dir / "config.json").read_text(encoding="utf-8")
    # Pretty-printed JSON has newlines + indentation, not a single line.
    assert "\n" in text
    assert "  " in text


def test_write_config_sidecar_signature_is_nested_json(tmp_path: Path) -> None:
    """The whole point of switching to structured signature: extras
    aren't escaped-JSON-inside-JSON. The on-disk file must hold them
    as proper nested JSON for human readability."""
    fp_dir = tmp_path / "abc"
    write_config_sidecar(
        fp_dir,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(codec="vp9"),
        yt_clipper_version="5.43.0",
    )
    text = (fp_dir / "config.json").read_text(encoding="utf-8")
    # No escaped-JSON quotes inside a string value.
    assert '\\"' not in text
    payload = json.loads(text)
    assert isinstance(payload["encode_args_signature"], dict)
    assert isinstance(payload["encode_args_signature"]["extras"], dict)


# ---------------------------------------------------------------------------
# Per-final-encode encode-meta sidecar
# ---------------------------------------------------------------------------


def _touch(path: Path, contents: str = "") -> Path:
    """Create a placeholder file so encode-meta sidecar tests can use
    ``output_path`` paths that look like real encodes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")
    return path


def test_write_encode_meta_sidecar_creates_file_with_expected_fields(
    tmp_path: Path,
) -> None:
    output_path = _touch(tmp_path / "clip-1.webm")
    sig = _signature()
    sidecar_path = write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="abc123",
        encode_args_signature=sig,
        picked_crf=30,
        algorithm_version=1,
        yt_clipper_version="5.43.0",
    )
    assert sidecar_path == output_path.with_suffix(".webm.encode-meta.json")
    payload = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert payload["encoder_fingerprint"] == "abc123"
    assert payload["picked_crf"] == 30
    assert payload["encode_args_signature"] == sig
    assert payload["algorithm_version"] == 1
    assert payload["yt_clipper_version"] == "5.43.0"
    assert "finalized_utc" in payload


def test_write_encode_meta_sidecar_overwrites_on_subsequent_call(
    tmp_path: Path,
) -> None:
    """Unlike the per-fingerprint config.json, encode-meta sidecars
    are rewritten each successful encode — the file's bytes change,
    so the metadata must too."""
    output_path = _touch(tmp_path / "clip-1.webm")
    write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(aq_mode=4),
        picked_crf=26,
        algorithm_version=1,
        yt_clipper_version="5.43.0",
    )
    write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="def",
        encode_args_signature=_signature(aq_mode=0),
        picked_crf=30,
        algorithm_version=2,
        yt_clipper_version="5.43.0",
    )
    payload = json.loads(
        output_path.with_suffix(".webm.encode-meta.json").read_text(encoding="utf-8"),
    )
    assert payload["encoder_fingerprint"] == "def"
    assert payload["picked_crf"] == 30
    assert payload["algorithm_version"] == 2


def test_check_encode_meta_sidecar_match(tmp_path: Path) -> None:
    output_path = _touch(tmp_path / "clip-1.webm")
    write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="abc123",
        encode_args_signature=_signature(),
        picked_crf=30,
        algorithm_version=1,
        yt_clipper_version="5.43.0",
    )
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint="abc123",
        expected_picked_crf=30,
    )
    assert check.status == "match"
    assert check.existing is not None


def test_check_encode_meta_sidecar_mismatch_on_fingerprint(tmp_path: Path) -> None:
    output_path = _touch(tmp_path / "clip-1.webm")
    write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="old-fp",
        encode_args_signature=_signature(),
        picked_crf=30,
        algorithm_version=1,
        yt_clipper_version="5.43.0",
    )
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint="new-fp",
        expected_picked_crf=30,
    )
    assert check.status == "mismatch"
    assert check.existing is not None
    assert check.existing["encoder_fingerprint"] == "old-fp"


def test_check_encode_meta_sidecar_mismatch_on_picked_crf(tmp_path: Path) -> None:
    output_path = _touch(tmp_path / "clip-1.webm")
    write_encode_meta_sidecar(
        output_path,
        encoder_fingerprint="abc",
        encode_args_signature=_signature(),
        picked_crf=26,
        algorithm_version=1,
        yt_clipper_version="5.43.0",
    )
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint="abc",
        expected_picked_crf=30,
    )
    assert check.status == "mismatch"


def test_check_encode_meta_sidecar_missing_when_sidecar_absent(tmp_path: Path) -> None:
    """Output exists but no sidecar — typical for files produced
    before this feature shipped, or sidecars deleted by accident."""
    output_path = _touch(tmp_path / "clip-1.webm")
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint="abc",
        expected_picked_crf=30,
    )
    assert check.status == "missing"
    assert check.existing is None


def test_check_encode_meta_sidecar_absent_when_output_missing(tmp_path: Path) -> None:
    check = check_encode_meta_sidecar(
        tmp_path / "no-such-file.webm",
        expected_fingerprint="abc",
        expected_picked_crf=30,
    )
    assert check.status == "absent"


def test_check_encode_meta_sidecar_handles_corrupt_sidecar(tmp_path: Path) -> None:
    """A corrupt sidecar (non-JSON content) is treated like a missing
    sidecar — defensive: don't crash on weird on-disk state."""
    output_path = _touch(tmp_path / "clip-1.webm")
    sidecar_path = output_path.with_suffix(".webm.encode-meta.json")
    sidecar_path.write_text("not valid json", encoding="utf-8")
    check = check_encode_meta_sidecar(
        output_path,
        expected_fingerprint="abc",
        expected_picked_crf=30,
    )
    assert check.status == "missing"
