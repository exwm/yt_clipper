"""
Generic preview-format dispatcher.

Design parallels ``ffmpeg_codec.getFfmpegVideoCodecArgs``: one top-level
dispatch function per concern (per-clip preview, merged preview), each
branching on the ``previewFormat`` string and delegating to a format-specific
implementation.
"""

from typing import List, Optional

from clipper.clipper_types import ClipperPaths, DictStrAny
from clipper.previews.avif import (
    AVIF_FILE_EXTENSION,
    makeAvifPreview,
    mergeAvifPreviews,
)
from clipper.previews.shared import getPreviewSiblingPath
from clipper.previews.webp import (
    WEBP_FILE_EXTENSION,
    makeWebpPreview,
    mergeWebpPreviews,
)

PREVIEW_FORMAT_NONE = "none"
PREVIEW_FORMAT_AVIF = "avif"
PREVIEW_FORMAT_WEBP = "webp"

SUPPORTED_PREVIEW_FORMATS = (
    PREVIEW_FORMAT_NONE,
    PREVIEW_FORMAT_AVIF,
    PREVIEW_FORMAT_WEBP,
)

# Maps each concrete format to its file extension. Callers that need to derive
# a preview path from a clip path (e.g. merged-clip → merged-preview naming)
# should go through ``getPreviewFileExtension`` rather than hardcoding the
# literal — hardcoding is how the "always .preview.avif" bug got in once.
_PREVIEW_FORMAT_EXTENSIONS = {
    PREVIEW_FORMAT_AVIF: AVIF_FILE_EXTENSION,
    PREVIEW_FORMAT_WEBP: WEBP_FILE_EXTENSION,
}


def getPreviewFileExtension(previewFormat: str) -> Optional[str]:
    """Return the file extension for ``previewFormat`` (e.g. ``"avif"``).

    Returns ``None`` for ``"none"`` or unknown formats so callers can branch
    without a second ``previewFormat == "none"`` check.
    """
    return _PREVIEW_FORMAT_EXTENSIONS.get(previewFormat)


def makePreview(
    cp: ClipperPaths,
    clipFilePath: str,
    previewFormat: str,
    mps: DictStrAny,
    overwrite: bool,
) -> Optional[str]:
    """Dispatch per-clip preview generation. Returns output path or None."""
    if previewFormat == PREVIEW_FORMAT_NONE:
        return None
    if previewFormat == PREVIEW_FORMAT_AVIF:
        return makeAvifPreview(cp, clipFilePath, mps, overwrite)
    if previewFormat == PREVIEW_FORMAT_WEBP:
        return makeWebpPreview(cp, clipFilePath, mps, overwrite)
    raise ValueError(f"Unsupported preview format: {previewFormat}")


def mergePreviews(
    cp: ClipperPaths,
    previewPaths: List[str],
    mergedClipFilePath: str,
    previewFormat: str,
    overwrite: bool,
) -> Optional[str]:
    """Dispatch merged-preview generation. Returns output path or None.

    The merged preview output path is derived from the merged main-clip path
    by swapping the extension (``Foo.webm`` -> ``Foo.preview.{ext}``), so
    callers pass the main-clip path and the dispatcher constructs the sibling.

    None signals "caller should decide" — typically the caller may skip, log,
    or fall back to re-encoding from the merged main clip.
    """
    if previewFormat == PREVIEW_FORMAT_NONE:
        return None
    extension = getPreviewFileExtension(previewFormat)
    if extension is None:
        raise ValueError(f"Unsupported preview format: {previewFormat}")
    mergedPreviewPath = getPreviewSiblingPath(mergedClipFilePath, extension)
    if previewFormat == PREVIEW_FORMAT_AVIF:
        return mergeAvifPreviews(cp, previewPaths, mergedPreviewPath, overwrite)
    if previewFormat == PREVIEW_FORMAT_WEBP:
        return mergeWebpPreviews(cp, previewPaths, mergedPreviewPath, overwrite)
    raise ValueError(f"Unsupported preview format: {previewFormat}")
