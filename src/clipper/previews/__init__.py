"""
Animated preview generation for finished clips.

Public API:
    makePreview, mergePreviews          — format-agnostic dispatchers
    getPreviewFileExtension             — format -> file extension lookup
    PREVIEW_FORMAT_NONE / _AVIF / _WEBP — format identifiers
    SUPPORTED_PREVIEW_FORMATS           — tuple of all accepted identifiers

Two concrete formats today: animated AVIF (smaller files, newer browsers) and
animated WebP (broader browser support, slightly larger files). The dispatcher
design leaves room for a future AV1-in-MP4 or GIF preview.
"""

from clipper.previews.dispatcher import (
    PREVIEW_FORMAT_AVIF,
    PREVIEW_FORMAT_NONE,
    PREVIEW_FORMAT_WEBP,
    SUPPORTED_PREVIEW_FORMATS,
    getPreviewFileExtension,
    makePreview,
    mergePreviews,
)

__all__ = [
    "PREVIEW_FORMAT_AVIF",
    "PREVIEW_FORMAT_NONE",
    "PREVIEW_FORMAT_WEBP",
    "SUPPORTED_PREVIEW_FORMATS",
    "getPreviewFileExtension",
    "makePreview",
    "mergePreviews",
]
