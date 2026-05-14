"""
Animated AVIF preview encoding (SVT-AV1 via libsvtav1 + AVIF muxer).

Runs as a second ffmpeg pass over an already-produced clip file to emit a
downscaled animated AVIF sibling for ``<img>`` embeds, Discord hover previews,
and similar web-embed contexts. Orthogonal to the main video codec pipeline
in ``ffmpeg_codec.py`` — never touches hardware-accelerated frame paths.

Format-agnostic helpers (dimension picking, scale filter, HDR detection,
sibling path, ffmpeg runner, concat-copy merge) live in ``previews/shared.py``.
This module holds the SVT-AV1 / AVIF-specific encoder constants, the AVIF-
calibrated CRF heuristic, command assembly, and the public entry points.

Sources for encoder/tuning decisions are cited inline next to each constant
or parameter. Project-specific heuristics (CRF adjustments) are marked as such.
"""

from pathlib import Path
from typing import List, Optional

from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.log_helpers import LogPath
from clipper.previews.shared import (
    DEFAULT_PREVIEW_DIM_TIERS,
    buildScaleFilter,
    computePreviewDimensions,
    concatCopyPreviewVideos,
    getPreviewSiblingPath,
    isHdrSource,
    probeVideoDimensions,
    runFfmpegPreviewCommand,
)
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.PREVIEWS)

# ---------------------------------------------------------------------------
# Encoder constants — decisions and sources
# ---------------------------------------------------------------------------

AVIF_FILE_EXTENSION = "avif"
AVIF_PREVIEW_LABEL = "AVIF preview"
AVIF_MERGED_PREVIEW_LABEL = "merged AVIF preview"

# AVIF previews use the shared default source-resolution tier table. Kept as an
# AVIF-scoped alias so the table can diverge in the future (e.g. if real-world
# feedback indicates animated AVIF wants coarser buckets than a future WebP
# path) without touching the shared defaults or other format modules.
AVIF_PREVIEW_DIM_TIERS = DEFAULT_PREVIEW_DIM_TIERS

# CRF band for animated AVIF previews. SVT-AV1 CRF scale is 0-63 (default 50,
# far too lossy for preview use). The 30-40 band is an intentionally narrow
# "safe for most inputs" range — bounded swing over a wide variety of sources
# produces more predictable preview quality than an aggressive content-adaptive
# curve. Primary-delivery guidance recommends tighter CRF at smaller resolutions
# (SD ~22-28, 720p ~24-30) because the viewer sees pixels at 1:1; preview use
# (short loop, small embed) tolerates a looser setting. Band kept narrow because
# streaming-guide numbers are calibrated for the 1:1 case, not this one.
# Sources:
#   https://ffmpeg.party/guides/av1/
#   https://ottverse.com/analysis-of-svt-av1-presets-and-crf-values/
AVIF_PREVIEW_CRF_BASE = 35
AVIF_PREVIEW_CRF_MIN = 30
AVIF_PREVIEW_CRF_MAX = 40

# SVT-AV1 preset 0-13 (0 slowest/best, 13 fastest). Preset 8 is the common
# speed/quality pick for preview-class encodes.
# Sources:
#   https://32blog.com/en/ffmpeg/ffmpeg-v8-svtav1-optimal-settings
#   https://ottverse.com/analysis-of-svt-av1-presets-and-crf-values/
AVIF_PREVIEW_DEFAULT_PRESET = 8

# SVT-AV1 tune modes: 0=VQ (perceptual), 1=PSNR (SVT default), 2=SSIM.
# For previews humans will watch at reduced resolution, tune=0 retains more
# fine detail and sharpness. Tune=1/2 score better on PSNR/SSIMU2 but look
# softer. If artifacting feedback arrives later, tune=2 is the fallback.
# Sources:
#   https://wiki.x266.mov/docs/encoders/SVT-AV1
#   https://streaminglearningcenter.com/articles/svt-av1-and-libaom-tune-for-psnr-by-default.html
AVIF_PREVIEW_TUNE = 0

# enable-overlays=1 inserts overlay reference frames that restore the
# high-frequency detail dropped by alt-ref temporal prediction. Small
# bitrate cost, noticeable quality gain at preview-regime bitrates.
# Sources:
#   https://gitlab.com/AOMediaCodec/SVT-AV1/-/blob/master/Docs/Parameters.md
#   https://wiki.x266.mov/blog/svt-av1-deep-dive
AVIF_PREVIEW_ENABLE_OVERLAYS = 1

# 8-bit yuv420p is the broadest-compatible pixel format across AVIF decoders.
# HDR / 10-bit previews are out of scope for Phase 1.
# Source: https://trac.ffmpeg.org/wiki/Encode/AV1
AVIF_PREVIEW_PIX_FMT = "yuv420p"

# qmin/qmax bound per-frame adaptive QP around the target CRF. Without bounds,
# a complex scene can collapse to worst-quality (QP 63) or spend bits chasing
# pristine reproduction on an easy frame. Mirrors the pattern in
# ffmpeg_codec.py: qmin stays well below CRF (a fixed ceiling on "how clean a
# frame is allowed to get"), qmax rides a fixed delta above CRF.
# Sources:
#   https://gitlab.com/AOMediaCodec/SVT-AV1/-/blob/master/Docs/Parameters.md
#   (project convention: src/clipper/ffmpeg_codec.py qmax/qmin formula)
AVIF_PREVIEW_QMIN = 15
AVIF_PREVIEW_QMAX_DELTA = 13  # qmax = crf + delta, clamped below.
AVIF_PREVIEW_QMAX_CAP = 55

# Keyframe interval. 1-second GOP matches the project convention used by the
# main codec paths in ffmpeg_codec.py (`-force_key_frames 1 -g ~fps`). Short
# GOP enables precise browser seeking in <img>/<video> AVIF embeds; the cost
# is modest file-size growth from more intra frames, acceptable for preview
# use where file is already small. SVT-AV1 accepts the "Ns" form so the
# frame count is derived from the clip's actual framerate.
# Source: https://gitlab.com/AOMediaCodec/SVT-AV1/-/blob/master/Docs/Parameters.md
AVIF_PREVIEW_KEYINT = "1s"

# Explicit color metadata tags. Without them, AVIF decoders fall back to
# per-implementation defaults and can show visible color shifts between
# browsers (most commonly Firefox vs. Chrome). Tag as BT.709 TV-range, which
# is what ~all consumer video content uses and what the main codec paths in
# ffmpeg_codec.py already write for SDR output.
# Source: https://deepwiki.com/FFmpeg/FFmpeg/3.1.3-color-space-and-pixel-format-handling
AVIF_PREVIEW_COLOR_PRIMARIES = "bt709"
AVIF_PREVIEW_COLOR_TRC = "bt709"
AVIF_PREVIEW_COLORSPACE = "bt709"
AVIF_PREVIEW_COLOR_RANGE = "tv"

# FFmpeg AVIF muxer shipped in 6.1. libsvtav1 has been in ffmpeg since 4.4.
# Documented as a runtime requirement; no Python probe — ffmpeg's own error
# on missing support is clear enough.
# Source: https://www.phoronix.com/news/FFmpeg-AVIF-Muxing

# HDR preservation is intentionally off in Phase 1. Animated AVIF previews are
# always emitted as SDR BT.709 yuv420p 8-bit, even when the source clip is HDR.
#
# Reasons this door is closed:
#   - Browser *animated* AVIF HDR rendering is inconsistent. Chrome/Edge have
#     rough edges around HDR animated sequences (still-image HDR is further
#     along). Firefox animated-AVIF is recent and its HDR path is patchy.
#     Safari is the most consistent but still not uniform. A 10-bit BT.2020
#     preview can render correctly in one browser and washed/crushed in another.
#   - Non-HDR viewer displays require the browser to tonemap on the fly, and
#     browser AVIF tonemappers are immature. A pre-tonemapped SDR preview is
#     substantially more predictable than trusting per-browser runtime tonemap.
#   - libsvtav1 10-bit is slower; the preview is a secondary artifact and the
#     encoder config already leans toward "speed/size over fidelity".
#   - The main codec pipeline in ffmpeg_codec.py typically produces SDR output
#     for most clips, so tagging the preview as HDR would misdescribe the
#     content the user actually sees in the finished clip.
#
# Future HDR branch slots in at the "# HDR preview branch would go here" marker
# in makeAvifPreview: switch `-pix_fmt` to yuv420p10le, swap the color tags to
# bt2020 + smpte2084 (PQ) or arib-std-b67 (HLG) matching the source, and decide
# a tonemap policy for SDR-display viewers — probably an explicit preview-tonemap
# toggle rather than trusting the browser. Detection (`isHdrSource` in shared.py)
# is kept wired in so the feature surface is visible; only the branch is disabled.
PRESERVE_HDR_IN_PREVIEW = False


# ---------------------------------------------------------------------------
# AVIF-specific helpers
# ---------------------------------------------------------------------------


def pickPreviewCrf(
    sourceCrf: Optional[int],
    sourceWidth: int,
    sourceHeight: int,
    previewWidth: int,
    previewHeight: int,
    override: Optional[int] = None,
) -> int:
    """Derive preview CRF from signals we can interpret confidently.

    The heuristic keys on two axes with real theoretical/empirical backing, plus
    a small secondary nudge by preview size. Source bitrate is intentionally
    *not* used — it correlates poorly with perceptual quality (grainy/noisy
    content wastes bitrate; simple content undershoots it), so it is too noisy
    to drive a small directional nudge. The coefficient magnitudes themselves
    are project heuristics, bounded by the narrow min/max band.

    Axes:

    1. Pixel-reduction ratio (primary, grounded in DSP).
       Downsampling is a low-pass filter that attenuates the high-frequency
       band where compression artifacts (block edges, ringing, mosquito noise)
       live. An aggressively downsampled preview can therefore tolerate a
       higher CRF without visible damage — the source artifacts are smoothed
       by the scale step before the preview encode sees them.
       Sources:
         https://en.wikipedia.org/wiki/Downsampling_(signal_processing)
         https://ccrma.stanford.edu/~jos/sasp/Filtering_Downsampling.html

    2. Source CRF as a safety floor, not a dial (grounded empirically).
       Generational-loss testing shows the first re-encode of already-lossy
       content introduces noticeable damage in one pass, with most quality
       lost early. Spending extra bits on a lossy source buys less than on a
       clean one — the preview would faithfully reproduce the source's
       artifacts instead of capturing signal. When the source is known to be
       heavily compressed, the preview CRF floor is raised so we don't waste
       bits; we do not pull the preview *looser* on lossy sources either,
       because we still want a decent-looking artifact.
       Sources:
         https://goughlui.com/2016/11/22/video-compression-x264-crf-generational-loss-testing/
         https://en.wikipedia.org/wiki/Generation_loss

    3. Preview absolute long edge (secondary, weak signal).
       Small previews are typically viewed at small display sizes (hover
       thumbnails, embeds) where a slight CRF bump is not visible; larger
       previews benefit from a mild tightening. Kept intentionally small
       because streaming-guide CRF-by-resolution tables are calibrated for
       1:1 primary delivery, not preview/embed use.
       Sources:
         https://ottverse.com/analysis-of-svt-av1-presets-and-crf-values/
         https://ffmpeg.party/guides/av1/
    """
    if override is not None and override >= 0:
        return override

    crf = AVIF_PREVIEW_CRF_BASE

    srcPixels = max(1, sourceWidth * sourceHeight)
    pxRatio = (previewWidth * previewHeight) / srcPixels
    if pxRatio <= 0.10:   # e.g. 1080p source -> 360p preview: very aggressive downsample
        crf += 2
    elif pxRatio <= 0.25:  # e.g. 1080p source -> 540p preview: moderate downsample
        crf += 1
    # else: preview is large relative to source; leave base alone.

    previewLongEdge = max(previewWidth, previewHeight)
    if previewLongEdge <= 400:
        crf += 1
    elif previewLongEdge >= 640:
        crf -= 1

    minCrf = AVIF_PREVIEW_CRF_MIN
    if sourceCrf is not None and sourceCrf >= 35:
        minCrf = max(minCrf, AVIF_PREVIEW_CRF_BASE)

    return max(minCrf, min(AVIF_PREVIEW_CRF_MAX, crf))


def buildAvifPreviewCommand(
    ffmpegPath: str,
    srcPath: str,
    outPath: str,
    previewWidth: int,
    previewHeight: int,
    crf: int,
    preset: int,
    overwrite: bool,
) -> str:
    """Build the ffmpeg command string that encodes one animated AVIF preview."""
    overwriteFlag = "-y" if overwrite else "-n"
    scaleFilter = buildScaleFilter(previewWidth, previewHeight)
    svtParams = (
        f"tune={AVIF_PREVIEW_TUNE}"
        f":enable-overlays={AVIF_PREVIEW_ENABLE_OVERLAYS}"
        f":keyint={AVIF_PREVIEW_KEYINT}"
    )
    qmax = min(AVIF_PREVIEW_QMAX_CAP, crf + AVIF_PREVIEW_QMAX_DELTA)
    qmin = min(AVIF_PREVIEW_QMIN, crf)
    return (
        f'{ffmpegPath} -hide_banner {overwriteFlag} -i "{srcPath}" '
        f'-vf "{scaleFilter}" '
        f"-c:v libsvtav1 -preset {preset} -crf {crf} "
        f"-qmin {qmin} -qmax {qmax} "
        f"-pix_fmt {AVIF_PREVIEW_PIX_FMT} "
        f"-color_primaries {AVIF_PREVIEW_COLOR_PRIMARIES} "
        f"-color_trc {AVIF_PREVIEW_COLOR_TRC} "
        f"-colorspace {AVIF_PREVIEW_COLORSPACE} "
        f"-color_range {AVIF_PREVIEW_COLOR_RANGE} "
        f"-svtav1-params {svtParams} "
        f"-an "
        f'-f avif "{outPath}"'
    )


def getAvifPreviewPath(clipFilePath: str) -> str:
    """Sibling ``.preview.avif`` path for a clip file.

    Thin wrapper over the shared helper with the format extension fixed to
    ``avif``. Exists so callers don't have to remember the extension literal.
    """
    return getPreviewSiblingPath(clipFilePath, AVIF_FILE_EXTENSION)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def makeAvifPreview(
    cp: ClipperPaths,
    clipFilePath: str,
    mps: DictStrAny,
    overwrite: bool,
) -> Optional[str]:
    """Encode an animated AVIF preview sibling for a finished clip.

    Returns the output path on success, ``None`` on skip or failure.
    """
    avifFilePath = getAvifPreviewPath(clipFilePath)

    if Path(avifFilePath).is_file() and not overwrite:
        logger.notice(
            f"Skipped existing {AVIF_PREVIEW_LABEL}: "
            f"{LogPath(Path(avifFilePath).name)}",
        )
        return avifFilePath

    sourceWidth = int(mps.get("width") or 0)
    sourceHeight = int(mps.get("height") or 0)
    if sourceWidth <= 0 or sourceHeight <= 0:
        logger.warning(
            "Skipping AVIF preview: source width/height unknown on marker pair settings.",
        )
        return None

    if isHdrSource(mps) and not PRESERVE_HDR_IN_PREVIEW:
        # HDR preview branch would go here. See PRESERVE_HDR_IN_PREVIEW above for
        # why the SDR BT.709 path is used even when the source is HDR-tagged.
        logger.notice(
            "Source color metadata indicates HDR; encoding AVIF preview as SDR BT.709 "
            "(HDR-preserving preview path is disabled in this build).",
        )

    previewWidth, previewHeight = computePreviewDimensions(
        sourceWidth,
        sourceHeight,
        tiers=AVIF_PREVIEW_DIM_TIERS,
        override=mps.get("previewMaxDim") or None,
    )

    crf = pickPreviewCrf(
        sourceCrf=mps.get("crf"),
        sourceWidth=sourceWidth,
        sourceHeight=sourceHeight,
        previewWidth=previewWidth,
        previewHeight=previewHeight,
        override=mps.get("previewQuality"),
    )

    preset = int(mps.get("previewPreset") or AVIF_PREVIEW_DEFAULT_PRESET)

    command = buildAvifPreviewCommand(
        ffmpegPath=cp.ffmpegPath,
        srcPath=clipFilePath,
        outPath=avifFilePath,
        previewWidth=previewWidth,
        previewHeight=previewHeight,
        crf=crf,
        preset=preset,
        overwrite=overwrite,
    )

    logger.info(
        f"Generating AVIF preview: {previewWidth}x{previewHeight} crf={crf} preset={preset}",
    )
    return runFfmpegPreviewCommand(command, avifFilePath, AVIF_PREVIEW_LABEL)


def mergeAvifPreviews(
    cp: ClipperPaths,
    previewPaths: List[str],
    mergedPreviewPath: str,
    overwrite: bool,
) -> Optional[str]:
    """Merge per-clip AVIF previews into a single animated AVIF.

    Fast path (concat-copy): all inputs share (width, height).
    Fallback: returns ``None``, letting the caller decide whether to re-encode
    from the merged main clip instead.
    """
    if not previewPaths:
        return None

    if Path(mergedPreviewPath).is_file() and not overwrite:
        logger.notice(
            f"Skipped existing {AVIF_MERGED_PREVIEW_LABEL}: "
            f"{LogPath(Path(mergedPreviewPath).name)}",
        )
        return mergedPreviewPath

    dimensions = [probeVideoDimensions(cp, path) for path in previewPaths]
    if any(dim is None for dim in dimensions):
        logger.warning(
            "Skipping concat-copy of AVIF previews: "
            "could not probe one or more preview dimensions.",
        )
        return None

    if len(set(dimensions)) != 1:
        logger.notice(
            "AVIF preview dimensions differ across clips; skipping concat-copy merge.",
        )
        return None

    return concatCopyPreviewVideos(
        cp,
        previewPaths,
        mergedPreviewPath,
        overwrite,
        AVIF_MERGED_PREVIEW_LABEL,
    )
