"""
Format-agnostic helpers shared by per-format preview modules.

Kept strictly format-agnostic: no SVT-AV1 / libwebp / x264 references live here.
Encoder constants, CRF tuning, and command assembly belong in the format
modules (``avif.py`` today; future ``webp.py`` / ``gif.py`` / ...).

The split exists so a second preview format can land without re-litigating the
dim-picking, sibling-path, ffmpeg-run, or concat-copy shapes.
"""

import contextlib
import re
import shlex
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple

import rich.markup

from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.log_helpers import LogPath, run_ffmpeg_with_progress
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.PREVIEWS)

# Default source-resolution tiers for picking a preview long edge. Indexed by
# source SHORT edge — the standard "Np" resolution naming, where 1080p means a
# 1080-short-edge source regardless of orientation. The returned value is the
# preview LONG edge; callers preserve aspect ratio when deriving the other
# dimension. Never upscale: callers cap at the source long edge.
#
# This is a project heuristic — not externally sourced. Format modules may
# import this table as-is or define their own if their encoder's compression
# curve warrants different bucket boundaries.
DEFAULT_PREVIEW_DIM_TIERS: Tuple[Tuple[int, int], ...] = (
    # (source_short_edge_min, preview_long_edge)
    (2160, 720),   # 4K and up         -> 720p preview
    (1440, 640),   # 1440p             -> 640p
    (1080, 540),   # 1080p             -> 540p
    (720, 480),    # 720p              -> 480p
    (480, 360),    # 480p              -> 360p
)


def roundUpToEven(value: float) -> int:
    """Round to the nearest even integer — required for 4:2:0 chroma subsampling."""
    rounded = round(value)
    return rounded + 1 if rounded % 2 else rounded


def pickPreviewLongEdge(
    sourceWidth: int,
    sourceHeight: int,
    tiers: Tuple[Tuple[int, int], ...] = DEFAULT_PREVIEW_DIM_TIERS,
    override: Optional[int] = None,
) -> int:
    """Pick the target longest-edge (px) for a preview from source resolution.

    Tier lookup keys on source SHORT edge; the returned value is the preview
    LONG edge. ``override`` (>0) bypasses the tier table. Never upscales: caps
    at the source long edge so previews are always <= source in each dimension.
    """
    if override and override > 0:
        return override
    sourceShortEdge = min(sourceWidth, sourceHeight)
    sourceLongEdge = max(sourceWidth, sourceHeight)
    for srcMin, previewLongEdge in tiers:
        if sourceShortEdge >= srcMin:
            return min(previewLongEdge, sourceLongEdge)
    return sourceLongEdge


def computePreviewDimensions(
    sourceWidth: int,
    sourceHeight: int,
    tiers: Tuple[Tuple[int, int], ...] = DEFAULT_PREVIEW_DIM_TIERS,
    override: Optional[int] = None,
) -> Tuple[int, int]:
    """Compute (width, height) preserving aspect ratio, both rounded up to even.

    Even-dim rounding is required for 4:2:0 chroma subsampling.
    """
    previewLongEdge = pickPreviewLongEdge(sourceWidth, sourceHeight, tiers, override)
    if sourceWidth >= sourceHeight:
        targetWidth = previewLongEdge
        targetHeight = sourceHeight * (previewLongEdge / sourceWidth)
    else:
        targetHeight = previewLongEdge
        targetWidth = sourceWidth * (previewLongEdge / sourceHeight)
    return (roundUpToEven(targetWidth), roundUpToEven(targetHeight))


def buildScaleFilter(previewWidth: int, previewHeight: int) -> str:
    """Plain W:H ffmpeg scale filter. Dimensions are pre-computed in Python so
    no ffmpeg ``if()``/escape gymnastics are needed in the filter graph."""
    return f"scale={previewWidth}:{previewHeight}:flags=lanczos"


def isHdrSource(mps: DictStrAny) -> bool:
    """True when source color metadata indicates HDR.

    Flags HDR when BT.2020 primaries combine with a known HDR transfer function
    (SMPTE 2084 / PQ or ARIB STD-B67 / HLG). Accepts both the ffprobe
    ``color_trc`` field name and the older ``color_transfer`` alias.
    """
    primaries = str(mps.get("color_primaries") or "").lower()
    transfer = str(mps.get("color_trc") or mps.get("color_transfer") or "").lower()
    hdrPrimaries = primaries in {"bt2020", "bt2020nc", "bt2020c"}
    hdrTransfer = transfer in {"smpte2084", "arib-std-b67", "pq", "hlg"}
    return hdrPrimaries and hdrTransfer


def getPreviewSiblingPath(clipFilePath: str, formatExtension: str) -> str:
    """Sibling path convention: replace the clip's extension with .preview.{ext}.

    ``Path.with_suffix`` replaces the last suffix only, so ``some.clip.webm``
    becomes ``some.clip.preview.{ext}``. A leading dot on ``formatExtension``
    is stripped so callers may pass either ``"avif"`` or ``".avif"``.
    """
    extension = formatExtension.lstrip(".")
    return str(Path(clipFilePath).with_suffix(f".preview.{extension}"))


def probeVideoDimensions(cp: ClipperPaths, path: str) -> Optional[Tuple[int, int]]:
    """Return (width, height) for the first video stream of ``path`` via ffprobe.

    Returns ``None`` when the probe fails or output is malformed — caller
    decides the fallback.
    """
    probeCommand = (
        f"{cp.ffprobePath} -v error -select_streams v:0 "
        f'-show_entries stream=width,height -of csv=p=0:s=x "{path}"'
    )
    try:
        result = subprocess.run(
            shlex.split(probeCommand),
            check=False,
            capture_output=True,
            text=True,
        )
    except (OSError, ValueError):
        return None
    if result.returncode != 0:
        return None
    match = re.match(r"^\s*(\d+)x(\d+)\s*$", result.stdout)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)))


def runFfmpegPreviewCommand(
    command: str,
    outPath: str,
    previewLabel: str,
) -> Optional[str]:
    """Run an ffmpeg preview command, log success/failure, return outPath or None.

    ``previewLabel`` names the artifact in logs (e.g. ``"AVIF preview"``,
    ``"merged AVIF preview"``) so every format module reports consistently.
    """
    logger.info(f"Encoding {previewLabel}...")
    # ``rich.markup.escape`` so paths / metadata values containing
    # ``[...]`` tokens don't get parsed as style spans and stripped
    # from the rendered command line. Same convention :class:`LogPath`
    # uses internally for path interpolations.
    logger.verbose(
        f"Using ffmpeg command: {rich.markup.escape(command)}\n",
    )
    # total_frames=0 → pulsing bar with elapsed only. Preview clip
    # frame count isn't known at this call site; the tracker still
    # gives a visible signal that the subprocess is alive.
    returncode = run_ffmpeg_with_progress(
        command,
        total_frames=0,
        label=previewLabel,
    )
    out_log = LogPath(Path(outPath).name)
    if returncode == 0:
        logger.success(f"Successfully generated {previewLabel}: {out_log}")
        return outPath
    logger.error(
        f"Failed to generate {previewLabel}: {out_log} "
        f"(error code: {returncode}).",
    )
    return None


def concatCopyPreviewVideos(
    cp: ClipperPaths,
    inputPaths: List[str],
    outputPath: str,
    overwrite: bool,
    previewLabel: str,
) -> Optional[str]:
    """Merge same-codec, same-dim previews into one file via ffmpeg concat-copy.

    Pre-conditions the caller must enforce:
      1. All inputs share codec and dimensions (required by the concat muxer's
         ``-c copy`` stream-copy path).
      2. Exists-skip gating has already been applied. Per-format merge policy
         varies (some formats may re-encode when concat-copy is unavailable),
         so exists-skip stays at the call site rather than being baked in here.

    Writes a temp inputs.txt next to the output and deletes it on completion.
    """
    if not inputPaths:
        return None

    outputDir = Path(outputPath).parent
    outputDir.mkdir(parents=True, exist_ok=True)
    inputsTxtPath = str(outputDir / f"concat-inputs-{Path(outputPath).stem}.txt")
    with open(inputsTxtPath, "w+", encoding="utf-8") as inputsTxt:
        for path in inputPaths:
            escapedPath = path.replace("'", r"'\''")
            inputsTxt.write(f"file '{escapedPath}'\n")

    overwriteFlag = "-y" if overwrite else "-n"
    concatCommand = (
        f"{cp.ffmpegPath} -hide_banner {overwriteFlag} "
        f'-f concat -safe 0 -i "{inputsTxtPath}" -c copy "{outputPath}"'
    )
    logger.info(
        f"Concat-copy merging into {LogPath(Path(outputPath).name)}.",
    )
    try:
        return runFfmpegPreviewCommand(concatCommand, outputPath, previewLabel)
    finally:
        with contextlib.suppress(OSError):
            Path(inputsTxtPath).unlink()
