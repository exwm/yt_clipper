from clipper.previews import webp


def test_pickPreviewQuality_pixel_reduction_lowers_quality() -> None:
    # Preview close to source size -> no pxRatio adjustment (keep base).
    qualityLargePreview = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1280, previewHeight=720,  # pxRatio ~0.44 -> no adjustment
    )
    # Aggressive downsample -> pxRatio <= 0.10 -> -5 quality (smaller files).
    qualitySmallPreview = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=480, previewHeight=270,   # pxRatio ~0.0625
    )
    assert qualitySmallPreview < qualityLargePreview


def test_pickPreviewQuality_lossy_source_caps_quality() -> None:
    # Preview dims chosen so the baseline rises above BASE: pxRatio > 0.25 (no
    # reduction) and previewLongEdge >= 640 (+2 nudge) -> quality = BASE + 2.
    # A lossy source should clamp that back down to BASE via the ceiling.
    baseline = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1024, previewHeight=576,  # 16:9, pxRatio ~0.284, longEdge 1024
    )
    withLossySource = webp.pickPreviewQuality(
        sourceCrf=40,  # >= 35 ceiling trigger
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1024, previewHeight=576,
    )
    assert baseline > webp.WEBP_PREVIEW_QUALITY_BASE
    assert withLossySource <= webp.WEBP_PREVIEW_QUALITY_BASE


def test_pickPreviewQuality_pristine_source_is_not_pushed_higher() -> None:
    # Symmetry with the AVIF heuristic: pristine source should NOT tighten
    # the preview. There's no benefit to spending extra bits faithfully
    # when the preview-side signals are fixed.
    withoutSourceCrf = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
    )
    withPristineSource = webp.pickPreviewQuality(
        sourceCrf=18,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
    )
    assert withoutSourceCrf == withPristineSource


def test_pickPreviewQuality_small_preview_nudged_down() -> None:
    smallPreviewQuality = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=360, previewHeight=202,  # long edge 360 <= 400 -> -2
    )
    midPreviewQuality = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=500, previewHeight=282,  # 400 < longEdge < 640 -> no nudge
    )
    assert smallPreviewQuality < midPreviewQuality


def test_pickPreviewQuality_large_preview_nudged_up() -> None:
    largePreviewQuality = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=3840, sourceHeight=2160,
        previewWidth=720, previewHeight=406,  # long edge 720 >= 640 -> +2
    )
    midPreviewQuality = webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=3840, sourceHeight=2160,
        previewWidth=500, previewHeight=282,
    )
    assert largePreviewQuality > midPreviewQuality


def test_pickPreviewQuality_always_in_band() -> None:
    # Sweep degenerate combinations; confirm nothing escapes the band.
    for sourceCrf in (None, 10, 30, 45, 63):
        for (sw, sh) in [(3840, 2160), (1920, 1080), (854, 480), (320, 240)]:
            for (pw, ph) in [(320, 180), (540, 304), (720, 406), (1280, 720)]:
                quality = webp.pickPreviewQuality(
                    sourceCrf=sourceCrf,
                    sourceWidth=sw, sourceHeight=sh,
                    previewWidth=pw, previewHeight=ph,
                )
                assert webp.WEBP_PREVIEW_QUALITY_MIN <= quality <= webp.WEBP_PREVIEW_QUALITY_MAX, (
                    f"quality {quality} out of band for source={sw}x{sh}, "
                    f"preview={pw}x{ph}, sourceCrf={sourceCrf}"
                )


def test_pickPreviewQuality_override_bypasses_heuristic() -> None:
    assert webp.pickPreviewQuality(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
        override=82,  # deliberately outside the [55, 75] band — override is trusted
    ) == 82


def test_buildWebpPreviewCommand_shape() -> None:
    command = webp.buildWebpPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.webp",
        previewWidth=540,
        previewHeight=304,
        quality=65,
        compressionLevel=4,
        overwrite=True,
    )
    assert "-c:v libwebp" in command
    assert "-quality 65" in command
    assert f"-preset {webp.WEBP_PREVIEW_PRESET}" in command
    assert "-compression_level 4" in command
    assert f"-loop {webp.WEBP_PREVIEW_LOOP}" in command
    assert "-an" in command
    assert "-f webp" in command
    assert "-c:a" not in command  # animated WebP has no audio stream
    assert f"-pix_fmt {webp.WEBP_PREVIEW_PIX_FMT}" in command
    assert "scale=540:304:flags=lanczos" in command
    assert "-y" in command
    # WebP does not support AVIF-style color tags or qmin/qmax — confirm we
    # don't accidentally emit them (would fail ffmpeg parse for libwebp).
    assert "-qmin" not in command
    assert "-qmax" not in command
    assert "-color_primaries" not in command
    assert "-svtav1-params" not in command


def test_buildWebpPreviewCommand_no_overwrite_uses_dash_n() -> None:
    command = webp.buildWebpPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.webp",
        previewWidth=540,
        previewHeight=304,
        quality=65,
        compressionLevel=4,
        overwrite=False,
    )
    assert " -n " in command
    assert " -y " not in command


def test_getWebpPreviewPath_delegates_with_webp_extension() -> None:
    assert webp.getWebpPreviewPath("clip.webm").endswith("clip.preview.webp")
    assert webp.getWebpPreviewPath("My Song-Album.mp4").endswith("My Song-Album.preview.webp")


def test_webp_tiers_alias_matches_shared_default() -> None:
    from clipper.previews.shared import DEFAULT_PREVIEW_DIM_TIERS
    assert webp.WEBP_PREVIEW_DIM_TIERS == DEFAULT_PREVIEW_DIM_TIERS


def test_mergeWebpPreviews_returns_none_phase1() -> None:
    # Phase 1 limitation: WebP concat-copy is unsupported; merged preview is
    # deliberately skipped. Callers expect None so they don't treat it as a
    # success.
    result = webp.mergeWebpPreviews(
        cp=None,  # type: ignore[arg-type]  (unused in phase-1 skip path)
        previewPaths=["/tmp/a.preview.webp", "/tmp/b.preview.webp"],
        mergedPreviewPath="/tmp/merged.preview.webp",
        overwrite=True,
    )
    assert result is None
