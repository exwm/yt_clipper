"""
Animated WebP preview encoding (libwebp).

Runs as a second ffmpeg pass over an already-produced clip file to emit a
downscaled animated WebP sibling. WebP has broader browser support than AVIF
(all major browsers since 2020) at a small file-size disadvantage: WebP uses
VP8 internally vs. AVIF's AV1, so files are typically 20-30% larger at
comparable perceptual quality. WebP is the "embed-anywhere" preview; AVIF is
the smaller-file premium option.

Format-agnostic helpers (dimensions, scale filter, HDR detection, sibling
path, ffmpeg runner) live in ``previews/shared.py``. This module holds the
libwebp-specific encoder constants, the WebP-calibrated quality heuristic,
command assembly, and the public entry points.

Sources for encoder/tuning decisions are cited inline next to each constant
or parameter. Project-specific heuristics (quality adjustments) are marked
as such.
"""

from pathlib import Path
from typing import List, Optional

from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.log_helpers import LogPath
from clipper.previews.shared import (
    DEFAULT_PREVIEW_DIM_TIERS,
    buildScaleFilter,
    computePreviewDimensions,
    getPreviewSiblingPath,
    isHdrSource,
    runFfmpegPreviewCommand,
)
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.PREVIEWS)

# ---------------------------------------------------------------------------
# Encoder constants — decisions and sources
# ---------------------------------------------------------------------------

WEBP_FILE_EXTENSION = "webp"
WEBP_PREVIEW_LABEL = "WebP preview"
WEBP_MERGED_PREVIEW_LABEL = "merged WebP preview"

# WebP previews share the default source-resolution tier table. Animated WebP
# compresses less efficiently than AVIF (VP8 vs. AV1) so coarser tiers would
# be defensible, but for cross-format consistency in user expectations we keep
# the same tiers and let per-file quality do the equalizing.
WEBP_PREVIEW_DIM_TIERS = DEFAULT_PREVIEW_DIM_TIERS

# libwebp quality is on an ASCENDING 0-100 scale (opposite of AVIF CRF).
# Default 75 is tuned for still photography. For animated previews at reduced
# resolution the 60-80 band is an intentionally narrow "safe for most inputs"
# range — lower values push file size down at the cost of visible block/ring
# artifacts; higher values produce files that approach the main clip in size.
# The band sits ~5 points higher than a method-4 encode would justify because
# method-6 (see WEBP_PREVIEW_COMPRESSION_LEVEL) gives back the size penalty.
# Sources:
#   https://ffmpeg.org/ffmpeg-codecs.html#libwebp
#   https://developers.google.com/speed/webp/docs/cwebp
#   https://developers.google.com/speed/webp/docs/using#quality_vs_size
WEBP_PREVIEW_QUALITY_BASE = 70
WEBP_PREVIEW_QUALITY_MIN = 60
WEBP_PREVIEW_QUALITY_MAX = 80

# libwebp -preset selects a set of internal parameters pre-tuned for content
# type: none / default / picture / photo / drawing / icon / text.
# "picture" is the right pick for mixed video content (flat regions + crisp
# edges, e.g. screen recordings, UI, animation); "photo" is tuned for
# continuous-tone outdoor photography. "picture" is the safer default for
# unknown/variable source content (gameplay, vlog, animation, live video).
# Sources:
#   https://ffmpeg.org/ffmpeg-codecs.html#libwebp
#   https://developers.google.com/speed/webp/docs/cwebp
WEBP_PREVIEW_PRESET = "picture"

# -compression_level is libwebp's method (0=fastest/largest, 6=slowest/
# smallest). Level 6 runs extra rate-distortion optimization passes, buying
# back most of the size gap vs. AVIF — real-world cwebp benchmarks report
# ~5-10% smaller files at equal quality vs. level 4. We pay this because WebP
# is the compatibility-first preview format (older Safari, webmail, Firefox
# < 113); users who opt in are already choosing the "slower but embeds
# everywhere" path. Expect ~2-3x encode time per preview vs. level 4.
# Source: https://ffmpeg.org/ffmpeg-codecs.html#libwebp
# Source: https://developers.google.com/speed/webp/docs/cwebp
WEBP_PREVIEW_COMPRESSION_LEVEL = 6

# -loop 0 = infinite loop; matches browser expectation for <img> embeds and
# animated thumbnails. -loop 1 would play once then freeze on last frame.
# Source: https://ffmpeg.org/ffmpeg-codecs.html#libwebp
WEBP_PREVIEW_LOOP = 0

# 8-bit yuv420p is WebP's native format. Animated WebP does not support 10-bit
# or HDR — this is a hard format limitation (VP8 is 8-bit only), not a
# Phase-1 tradeoff like on AVIF.
# Source: https://developers.google.com/speed/webp/docs/riff_container
WEBP_PREVIEW_PIX_FMT = "yuv420p"

# WebP is a RIFF container. It has an optional ICCP chunk for color profiles
# but most encoders/decoders ignore it and assume sRGB (~BT.709). Unlike AVIF,
# there are no standard `color_primaries`/`color_trc`/`colorspace` atoms in
# the container, so we don't emit ffmpeg color-tag flags here.
# Source: https://developers.google.com/speed/webp/docs/riff_container

# Browser support for animated WebP:
#   Chrome 32+ (Jan 2014)
#   Firefox 65+ (Jan 2019)
#   Safari 14+ (Sep 2020, macOS Big Sur)
#   Edge (Chromium, matches Chrome)
# Broader than animated AVIF (Chrome 85/2020, Firefox 113/2023, Safari 16.4/
# 2023) — WebP wins when the embed target is webmail or older Safari.
# Source: https://caniuse.com/webp-animation


# ---------------------------------------------------------------------------
# WebP-specific helpers
# ---------------------------------------------------------------------------


def pickPreviewQuality(
    sourceCrf: Optional[int],
    sourceWidth: int,
    sourceHeight: int,
    previewWidth: int,
    previewHeight: int,
    override: Optional[int] = None,
) -> int:
    """Derive preview quality on libwebp's ascending 0-100 scale.

    Same axes as ``avif.pickPreviewCrf`` but sign-flipped: libwebp quality is
    higher-is-better, the opposite of SVT-AV1 CRF. Kept deliberately narrow
    via the 60-80 band so the heuristic produces predictable output.

    Axes:

    1. Pixel-reduction ratio (primary, grounded in DSP).
       Downsampling low-pass-filters the compression-artifact band, so an
       aggressively downsampled preview can tolerate lower quality without
       visible damage. Opposite sign direction vs. AVIF CRF.
       Sources:
         https://en.wikipedia.org/wiki/Downsampling_(signal_processing)
         https://ccrma.stanford.edu/~jos/sasp/Filtering_Downsampling.html

    2. Source CRF as a quality ceiling, not a dial (generational-loss).
       When the source is already heavily compressed (sourceCrf >= 35), don't
       waste bits faithfully reproducing the source's existing artifacts —
       cap quality at BASE so the preview stays compact.
       Sources:
         https://goughlui.com/2016/11/22/video-compression-x264-crf-generational-loss-testing/
         https://en.wikipedia.org/wiki/Generation_loss

    3. Preview absolute long edge (secondary, weak signal).
       Small previews are viewed at small display sizes where a slight
       quality drop is not visible; larger previews benefit from mild
       tightening. Kept small — streaming-guide tables are calibrated for
       1:1 primary delivery, not preview/embed use.
       Source: https://developers.google.com/speed/webp/docs/using#quality_vs_size
    """
    if override is not None and override >= 0:
        return override

    quality = WEBP_PREVIEW_QUALITY_BASE

    srcPixels = max(1, sourceWidth * sourceHeight)
    pxRatio = (previewWidth * previewHeight) / srcPixels
    if pxRatio <= 0.10:   # very aggressive downsample -> lower quality is fine
        quality -= 5
    elif pxRatio <= 0.25:
        quality -= 2
    # else: preview is large relative to source; leave base alone.

    previewLongEdge = max(previewWidth, previewHeight)
    if previewLongEdge <= 400:
        quality -= 2
    elif previewLongEdge >= 640:
        quality += 2

    maxQuality = WEBP_PREVIEW_QUALITY_MAX
    if sourceCrf is not None and sourceCrf >= 35:
        maxQuality = min(maxQuality, WEBP_PREVIEW_QUALITY_BASE)

    return max(WEBP_PREVIEW_QUALITY_MIN, min(maxQuality, quality))


def buildWebpPreviewCommand(
    ffmpegPath: str,
    srcPath: str,
    outPath: str,
    previewWidth: int,
    previewHeight: int,
    quality: int,
    compressionLevel: int,
    overwrite: bool,
) -> str:
    """Build the ffmpeg command string that encodes one animated WebP preview."""
    overwriteFlag = "-y" if overwrite else "-n"
    scaleFilter = buildScaleFilter(previewWidth, previewHeight)
    return (
        f'{ffmpegPath} -hide_banner {overwriteFlag} -i "{srcPath}" '
        f'-vf "{scaleFilter}" '
        f"-c:v libwebp "
        f"-quality {quality} "
        f"-preset {WEBP_PREVIEW_PRESET} "
        f"-compression_level {compressionLevel} "
        f"-loop {WEBP_PREVIEW_LOOP} "
        f"-pix_fmt {WEBP_PREVIEW_PIX_FMT} "
        f"-an "
        f'-f webp "{outPath}"'
    )


def getWebpPreviewPath(clipFilePath: str) -> str:
    """Sibling ``.preview.webp`` path for a clip file.

    Thin wrapper over the shared helper with the format extension fixed to
    ``webp``. Exists so callers don't have to remember the extension literal.
    """
    return getPreviewSiblingPath(clipFilePath, WEBP_FILE_EXTENSION)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def makeWebpPreview(
    cp: ClipperPaths,
    clipFilePath: str,
    mps: DictStrAny,
    overwrite: bool,
) -> Optional[str]:
    """Encode an animated WebP preview sibling for a finished clip.

    Returns the output path on success, ``None`` on skip or failure.
    """
    webpFilePath = getWebpPreviewPath(clipFilePath)

    if Path(webpFilePath).is_file() and not overwrite:
        logger.notice(
            f"Skipped existing {WEBP_PREVIEW_LABEL}: "
            f"{LogPath(Path(webpFilePath).name)}",
        )
        return webpFilePath

    sourceWidth = int(mps.get("width") or 0)
    sourceHeight = int(mps.get("height") or 0)
    if sourceWidth <= 0 or sourceHeight <= 0:
        logger.warning(
            "Skipping WebP preview: source width/height unknown on marker pair settings.",
        )
        return None

    if isHdrSource(mps):
        # Animated WebP is 8-bit sRGB-only — this is a hard format limitation
        # (VP8 is 8-bit only), not a Phase-1 tradeoff we can flip. The ffmpeg
        # libwebp encoder implicitly converts HDR -> SDR, which can produce
        # washed/crushed colors. Log so this isn't a surprise to the user.
        logger.notice(
            "Source color metadata indicates HDR; WebP is 8-bit SDR-only and "
            "HDR content will be converted implicitly (colors may look flat).",
        )

    previewWidth, previewHeight = computePreviewDimensions(
        sourceWidth,
        sourceHeight,
        tiers=WEBP_PREVIEW_DIM_TIERS,
        override=mps.get("previewMaxDim") or None,
    )

    quality = pickPreviewQuality(
        sourceCrf=mps.get("crf"),
        sourceWidth=sourceWidth,
        sourceHeight=sourceHeight,
        previewWidth=previewWidth,
        previewHeight=previewHeight,
        override=mps.get("previewQuality"),
    )

    compressionLevel = int(
        mps.get("previewCompressionLevel") or WEBP_PREVIEW_COMPRESSION_LEVEL,
    )

    command = buildWebpPreviewCommand(
        ffmpegPath=cp.ffmpegPath,
        srcPath=clipFilePath,
        outPath=webpFilePath,
        previewWidth=previewWidth,
        previewHeight=previewHeight,
        quality=quality,
        compressionLevel=compressionLevel,
        overwrite=overwrite,
    )

    logger.info(
        f"Generating WebP preview: {previewWidth}x{previewHeight} "
        f"quality={quality} compression_level={compressionLevel}",
    )
    return runFfmpegPreviewCommand(command, webpFilePath, WEBP_PREVIEW_LABEL)


def mergeWebpPreviews(
    cp: ClipperPaths,
    previewPaths: List[str],
    mergedPreviewPath: str,
    overwrite: bool,
) -> Optional[str]:
    """Phase 1: merged WebP preview is not generated.

    WebP's RIFF container holds a single ANIM chunk and does not participate
    in ffmpeg's concat-copy path (unlike AVIF/ISOBMFF, whose stream-copy
    concat works when dimensions are uniform). Two alternative paths exist:

      1. External tool: ``webpmux`` supports animated-WebP stitching but adds
         a runtime dependency not currently bundled with the clipper.
      2. Re-encode from the merged main clip: requires threading the merged
         main clip path through the merge dispatcher and paying a second
         full encode.

    Both are Phase-2-plus. For now per-clip ``.preview.webp`` files are still
    generated and embed-ready; the merged main clip (.webm/.mp4) serves as
    the merged-visual fallback.

    Parameters are accepted to match the dispatcher contract but unused.
    """
    del cp, previewPaths, mergedPreviewPath, overwrite
    logger.notice(
        f"Skipped {WEBP_MERGED_PREVIEW_LABEL}: "
        "animated-WebP concat-copy is not supported in this build. "
        "Per-clip .preview.webp files are still produced; the merged main "
        "clip is the merged-visual fallback.",
    )
    return None
