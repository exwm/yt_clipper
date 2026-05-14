import pytest

from clipper.previews import shared


def test_roundUpToEven_already_even() -> None:
    assert shared.roundUpToEven(480) == 480
    assert shared.roundUpToEven(720.0) == 720


def test_roundUpToEven_rounds_up_from_odd() -> None:
    assert shared.roundUpToEven(481) == 482
    assert shared.roundUpToEven(479.6) == 480


@pytest.mark.parametrize(
    ("sourceWidth", "sourceHeight", "expectedLongEdge"),
    [
        (3840, 2160, 720),   # 4K landscape: short edge 2160 -> tier 2160 -> 720
        (2560, 1440, 640),   # 1440p landscape: short edge 1440 -> tier 1440 -> 640
        (1920, 1080, 540),   # 1080p landscape: short edge 1080 -> tier 1080 -> 540
        (1280, 720, 480),    # 720p landscape: short edge 720 -> tier 720 -> 480
        (854, 480, 360),     # 480p landscape: short edge 480 -> tier 480 -> 360
        (1080, 1920, 540),   # 1080p portrait: short edge 1080 -> tier 1080 -> 540
        (720, 1280, 480),    # 720p portrait: short edge 720 -> tier 720 -> 480
    ],
)
def test_pickPreviewLongEdge_default_tiers(
    sourceWidth: int,
    sourceHeight: int,
    expectedLongEdge: int,
) -> None:
    assert shared.pickPreviewLongEdge(sourceWidth, sourceHeight) == expectedLongEdge


def test_pickPreviewLongEdge_below_smallest_tier_never_upscales() -> None:
    # 240p source: short edge 240 clears no tier -> preview matches source long edge.
    assert shared.pickPreviewLongEdge(426, 240) == 426
    assert shared.pickPreviewLongEdge(240, 426) == 426


def test_pickPreviewLongEdge_override_bypasses_tiers() -> None:
    assert shared.pickPreviewLongEdge(3840, 2160, override=320) == 320
    # 0 or None override falls back to tier table.
    assert shared.pickPreviewLongEdge(3840, 2160, override=0) == 720
    assert shared.pickPreviewLongEdge(3840, 2160, override=None) == 720


def test_pickPreviewLongEdge_custom_tiers_apply() -> None:
    # Format modules can pass their own tiers; confirm the parameter is honored.
    coarserTiers = ((1080, 480), (480, 240))
    assert shared.pickPreviewLongEdge(1920, 1080, tiers=coarserTiers) == 480
    assert shared.pickPreviewLongEdge(854, 480, tiers=coarserTiers) == 240
    # Below smallest custom tier -> source long edge.
    assert shared.pickPreviewLongEdge(426, 240, tiers=coarserTiers) == 426


def test_computePreviewDimensions_landscape_1080p() -> None:
    # 1080p landscape -> long edge 540, height = 1080 * 540/1920 = 303.75 -> even = 304.
    assert shared.computePreviewDimensions(1920, 1080) == (540, 304)


def test_computePreviewDimensions_portrait_1080p() -> None:
    # 1080p portrait -> long edge 540 on height; width = 1080 * 540/1920 = 303.75 -> 304.
    assert shared.computePreviewDimensions(1080, 1920) == (304, 540)


def test_computePreviewDimensions_both_dims_even() -> None:
    for source in [(1920, 1080), (1280, 720), (854, 480), (1080, 1920), (3840, 2160)]:
        width, height = shared.computePreviewDimensions(*source)
        assert width % 2 == 0, f"width not even for source {source}: {width}"
        assert height % 2 == 0, f"height not even for source {source}: {height}"


def test_computePreviewDimensions_override_preserves_aspect() -> None:
    # override=480 sets long edge; height = 1080 * 480/1920 = 270 (already even).
    assert shared.computePreviewDimensions(1920, 1080, override=480) == (480, 270)


def test_buildScaleFilter_has_no_backslashes() -> None:
    scaleFilter = shared.buildScaleFilter(540, 304)
    assert scaleFilter == "scale=540:304:flags=lanczos"
    assert "\\" not in scaleFilter


def test_isHdrSource_flags_bt2020_pq() -> None:
    assert shared.isHdrSource({"color_primaries": "bt2020", "color_trc": "smpte2084"})


def test_isHdrSource_flags_bt2020_hlg() -> None:
    assert shared.isHdrSource({"color_primaries": "bt2020nc", "color_trc": "arib-std-b67"})


def test_isHdrSource_accepts_color_transfer_alias() -> None:
    # Older ffprobe field name is ``color_transfer``; detection should accept both.
    assert shared.isHdrSource({"color_primaries": "bt2020", "color_transfer": "smpte2084"})


def test_isHdrSource_sdr_sources_are_not_flagged() -> None:
    assert not shared.isHdrSource({"color_primaries": "bt709", "color_trc": "bt709"})
    assert not shared.isHdrSource({})  # missing metadata -> treat as SDR, not HDR
    # BT.2020 primaries alone (SDR wide-gamut) without PQ/HLG transfer is not HDR.
    assert not shared.isHdrSource({"color_primaries": "bt2020", "color_trc": "bt709"})


def test_getPreviewSiblingPath_replaces_last_suffix_only() -> None:
    assert shared.getPreviewSiblingPath("clip.webm", "avif").endswith("clip.preview.avif")
    # Path.with_suffix replaces only the last suffix; intermediate dots survive.
    assert shared.getPreviewSiblingPath("My Song-Album.mp4", "avif").endswith(
        "My Song-Album.preview.avif",
    )


def test_getPreviewSiblingPath_is_format_agnostic() -> None:
    # Any extension the caller provides goes through unchanged.
    assert shared.getPreviewSiblingPath("clip.webm", "webp").endswith("clip.preview.webp")
    assert shared.getPreviewSiblingPath("clip.webm", "gif").endswith("clip.preview.gif")


def test_getPreviewSiblingPath_strips_leading_dot_on_extension() -> None:
    # Callers may pass either ``avif`` or ``.avif``; output should be identical.
    withoutDot = shared.getPreviewSiblingPath("clip.webm", "avif")
    withDot = shared.getPreviewSiblingPath("clip.webm", ".avif")
    assert withoutDot == withDot
