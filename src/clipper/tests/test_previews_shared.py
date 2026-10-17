import pytest

from clipper.previews import shared


@pytest.mark.parametrize(
    ("value", "expected"),
    [(480, 480), (720.0, 720), (481, 482), (479.6, 480)],
)
def test_roundUpToEven(value: float, expected: int) -> None:
    assert shared.roundUpToEven(value) == expected


@pytest.mark.parametrize(
    ("sourceWidth", "sourceHeight", "expectedLongEdge"),
    [
        (3840, 2160, 720),  # 4K landscape: short edge 2160 -> tier 2160 -> 720
        (2560, 1440, 640),  # 1440p landscape: short edge 1440 -> tier 1440 -> 640
        (1920, 1080, 540),  # 1080p landscape: short edge 1080 -> tier 1080 -> 540
        (1280, 720, 480),  # 720p landscape: short edge 720 -> tier 720 -> 480
        (854, 480, 360),  # 480p landscape: short edge 480 -> tier 480 -> 360
        (1080, 1920, 540),  # 1080p portrait: short edge 1080 -> tier 1080 -> 540
        (720, 1280, 480),  # 720p portrait: short edge 720 -> tier 720 -> 480
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


@pytest.mark.parametrize(
    ("source", "override", "expected"),
    [
        # Long edge 540; the short edge 1080 * 540/1920 = 303.75 rounds up to even
        ((1920, 1080), None, (540, 304)),
        ((1080, 1920), None, (304, 540)),
        # The override sets the long edge; 1080 * 480/1920 = 270, already even
        ((1920, 1080), 480, (480, 270)),
    ],
)
def test_computePreviewDimensions(
    source: tuple[int, int],
    override: int | None,
    expected: tuple[int, int],
) -> None:
    assert shared.computePreviewDimensions(*source, override=override) == expected


def test_computePreviewDimensions_both_dims_even() -> None:
    for source in [(1920, 1080), (1280, 720), (854, 480), (1080, 1920), (3840, 2160)]:
        width, height = shared.computePreviewDimensions(*source)
        assert width % 2 == 0, f"width not even for source {source}: {width}"
        assert height % 2 == 0, f"height not even for source {source}: {height}"


def test_buildScaleFilter_has_no_backslashes() -> None:
    scaleFilter = shared.buildScaleFilter(540, 304)
    assert scaleFilter == "scale=540:304:flags=lanczos"
    assert "\\" not in scaleFilter


@pytest.mark.parametrize(
    ("stream", "isHdr"),
    [
        ({"color_primaries": "bt2020", "color_trc": "smpte2084"}, True),
        ({"color_primaries": "bt2020nc", "color_trc": "arib-std-b67"}, True),
        # Older ffprobe names the field ``color_transfer``
        ({"color_primaries": "bt2020", "color_transfer": "smpte2084"}, True),
        ({"color_primaries": "bt709", "color_trc": "bt709"}, False),
        # Missing metadata is SDR
        ({}, False),
        # BT.2020 primaries without a PQ or HLG transfer is SDR wide gamut
        ({"color_primaries": "bt2020", "color_trc": "bt709"}, False),
    ],
)
def test_isHdrSource(stream: dict[str, str], isHdr: bool) -> None:
    assert shared.isHdrSource(stream) == isHdr


@pytest.mark.parametrize(
    ("clip", "extension", "ending"),
    [
        ("clip.webm", "avif", "clip.preview.avif"),
        # Only the last suffix is replaced
        ("My Song-Album.mp4", "avif", "My Song-Album.preview.avif"),
        ("clip.webm", "webp", "clip.preview.webp"),
        ("clip.webm", "gif", "clip.preview.gif"),
        ("clip.webm", ".avif", "clip.preview.avif"),
    ],
)
def test_getPreviewSiblingPath(clip: str, extension: str, ending: str) -> None:
    assert shared.getPreviewSiblingPath(clip, extension).endswith(ending)
