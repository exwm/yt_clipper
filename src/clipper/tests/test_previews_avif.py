from clipper.previews import avif


def test_pickPreviewCrf_pixel_reduction_raises_crf() -> None:
    # Preview close to source size -> no pxRatio bump.
    crfLargePreview = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1280, previewHeight=720,  # px ratio ~0.44, above 0.25 -> no bump
    )
    # Aggressive downsample -> pxRatio <=0.10 -> +2 bump.
    crfSmallPreview = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=480, previewHeight=270,   # px ratio ~0.0625
    )
    assert crfSmallPreview > crfLargePreview


def test_pickPreviewCrf_lossy_source_raises_floor() -> None:
    # Preview dims chosen so the baseline dips below BASE: pxRatio > 0.25 (no
    # bump) and previewLongEdge >= 640 (-1 size nudge) -> CRF = BASE - 1.
    # A lossy source should clamp that back up to BASE via the floor.
    baseline = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1024, previewHeight=576,  # 16:9, pxRatio ~0.284, longEdge 1024
    )
    withLossySource = avif.pickPreviewCrf(
        sourceCrf=40,  # >= 35 floor trigger
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=1024, previewHeight=576,
    )
    assert baseline < avif.AVIF_PREVIEW_CRF_BASE
    assert withLossySource >= avif.AVIF_PREVIEW_CRF_BASE


def test_pickPreviewCrf_pristine_source_is_not_pulled_lower() -> None:
    # Pristine source should NOT tighten the preview — there's no benefit to
    # spending bits faithfully when the preview-side signals are fixed.
    withoutSourceCrf = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
    )
    withPristineSource = avif.pickPreviewCrf(
        sourceCrf=18,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
    )
    assert withoutSourceCrf == withPristineSource


def test_pickPreviewCrf_small_preview_nudged_up() -> None:
    smallPreviewCrf = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=360, previewHeight=202,  # long edge 360 <= 400 -> +1
    )
    # Same source, a preview just above the small-threshold but still in the
    # middle band (400 < longEdge < 640) -> no size nudge.
    midPreviewCrf = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=500, previewHeight=282,
    )
    assert smallPreviewCrf > midPreviewCrf


def test_pickPreviewCrf_large_preview_nudged_down() -> None:
    largePreviewCrf = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=3840, sourceHeight=2160,
        previewWidth=720, previewHeight=406,  # long edge 720 >= 640 -> -1
    )
    midPreviewCrf = avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=3840, sourceHeight=2160,
        previewWidth=500, previewHeight=282,
    )
    assert largePreviewCrf < midPreviewCrf


def test_pickPreviewCrf_always_in_band() -> None:
    # Sweep a few degenerate combinations and confirm nothing escapes the band.
    for sourceCrf in (None, 10, 30, 45, 63):
        for (sw, sh) in [(3840, 2160), (1920, 1080), (854, 480), (320, 240)]:
            for (pw, ph) in [(320, 180), (540, 304), (720, 406), (1280, 720)]:
                crf = avif.pickPreviewCrf(
                    sourceCrf=sourceCrf,
                    sourceWidth=sw, sourceHeight=sh,
                    previewWidth=pw, previewHeight=ph,
                )
                assert avif.AVIF_PREVIEW_CRF_MIN <= crf <= avif.AVIF_PREVIEW_CRF_MAX, (
                    f"CRF {crf} out of band for source={sw}x{sh}, "
                    f"preview={pw}x{ph}, sourceCrf={sourceCrf}"
                )


def test_pickPreviewCrf_override_bypasses_heuristic() -> None:
    assert avif.pickPreviewCrf(
        sourceCrf=None,
        sourceWidth=1920, sourceHeight=1080,
        previewWidth=540, previewHeight=304,
        override=22,
    ) == 22


def test_buildAvifPreviewCommand_shape() -> None:
    command = avif.buildAvifPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.avif",
        previewWidth=540,
        previewHeight=304,
        crf=35,
        preset=8,
        overwrite=True,
    )
    assert "-c:v libsvtav1" in command
    assert "-crf 35" in command
    assert "-preset 8" in command
    assert "-an" in command
    assert "-f avif" in command
    assert "-c:a" not in command  # AVIF has no audio stream
    assert "tune=0" in command
    assert "enable-overlays=1" in command
    assert f"keyint={avif.AVIF_PREVIEW_KEYINT}" in command
    assert "scale=540:304:flags=lanczos" in command
    assert "-y" in command
    # qmin/qmax bound adaptive QP around the CRF target.
    assert f"-qmin {min(avif.AVIF_PREVIEW_QMIN, 35)}" in command
    assert f"-qmax {min(avif.AVIF_PREVIEW_QMAX_CAP, 35 + avif.AVIF_PREVIEW_QMAX_DELTA)}" in command
    # Explicit color metadata so browsers don't fall back to per-decoder defaults.
    assert f"-color_primaries {avif.AVIF_PREVIEW_COLOR_PRIMARIES}" in command
    assert f"-color_trc {avif.AVIF_PREVIEW_COLOR_TRC}" in command
    assert f"-colorspace {avif.AVIF_PREVIEW_COLORSPACE}" in command
    assert f"-color_range {avif.AVIF_PREVIEW_COLOR_RANGE}" in command


def test_buildAvifPreviewCommand_qmax_capped_on_high_crf() -> None:
    command = avif.buildAvifPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.avif",
        previewWidth=540,
        previewHeight=304,
        crf=avif.AVIF_PREVIEW_CRF_MAX,
        preset=8,
        overwrite=True,
    )
    expectedQmax = min(
        avif.AVIF_PREVIEW_QMAX_CAP,
        avif.AVIF_PREVIEW_CRF_MAX + avif.AVIF_PREVIEW_QMAX_DELTA,
    )
    assert f"-qmax {expectedQmax}" in command


def test_buildAvifPreviewCommand_qmin_never_exceeds_crf() -> None:
    # For an unusually low CRF (below AVIF_PREVIEW_QMIN), qmin should shrink
    # to CRF so the floor never crosses the target.
    lowCrf = max(0, avif.AVIF_PREVIEW_QMIN - 5)
    command = avif.buildAvifPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.avif",
        previewWidth=540,
        previewHeight=304,
        crf=lowCrf,
        preset=8,
        overwrite=True,
    )
    assert f"-qmin {lowCrf}" in command


def test_buildAvifPreviewCommand_no_overwrite_uses_dash_n() -> None:
    command = avif.buildAvifPreviewCommand(
        ffmpegPath="ffmpeg",
        srcPath="/tmp/src.webm",
        outPath="/tmp/src.preview.avif",
        previewWidth=540,
        previewHeight=304,
        crf=35,
        preset=8,
        overwrite=False,
    )
    assert " -n " in command
    assert " -y " not in command


def test_preserve_hdr_flag_is_off() -> None:
    # The HDR branch is intentionally disabled in Phase 1. Flipping this flag
    # should be accompanied by the actual 10-bit/BT.2020 encode path, so this
    # test guards against accidentally shipping a half-wired change.
    assert avif.PRESERVE_HDR_IN_PREVIEW is False


def test_getAvifPreviewPath_delegates_with_avif_extension() -> None:
    # Thin wrapper over the shared helper — just confirm the AVIF extension
    # is applied so callers don't need to remember the literal.
    assert avif.getAvifPreviewPath("clip.webm").endswith("clip.preview.avif")
    assert avif.getAvifPreviewPath("My Song-Album.mp4").endswith("My Song-Album.preview.avif")


def test_avif_tiers_alias_matches_shared_default() -> None:
    # AVIF currently reuses the shared default tier table. If this assertion
    # ever fails intentionally, AVIF has deliberately diverged and the helper
    # call in makeAvifPreview should keep passing AVIF_PREVIEW_DIM_TIERS.
    from clipper.previews.shared import DEFAULT_PREVIEW_DIM_TIERS
    assert avif.AVIF_PREVIEW_DIM_TIERS == DEFAULT_PREVIEW_DIM_TIERS
