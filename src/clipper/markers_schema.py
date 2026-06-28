"""Validate markers JSON files against the schema of what the markup script saves (src/schema).

A markers JSON file may come from someone else, and its values reach ffmpeg command lines, so
only the keys and value shapes the markup script writes are accepted.
"""

import json
import sys
from collections.abc import Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, ValidationError

# Frozen releases bundle src/schema at the archive root.
SCHEMA_PATH = (
    Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    / "schema"
    / "markers.schema.json"
)


# Settings only the markup script reads. An invalid one is dropped instead of stopping the run.
MARKUP_ONLY_SETTINGS = frozenset(
    {
        "newMarkerSpeed",
        "newMarkerCrop",
        "isVerticalVideo",
        "videoTag",
        "version",
        "date",
        # The markup bakes these into each pair's cropPath.
        "cropPointEasingCinematicMargin",
        "cropPointEasingCinematicZoomMargin",
    },
)


@dataclass(frozen=True)
class MarkersValidation:
    droppedKeys: list[str] = field(default_factory=list)
    droppedInvalidSettings: list[str] = field(default_factory=list)
    globalErrors: list[str] = field(default_factory=list)
    # Keyed by marker pair index.
    pairErrors: dict[int, list[str]] = field(default_factory=dict)


@cache
def markersValidator() -> Draft202012Validator:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Draft202012Validator(schema)


def normalizeLegacyFormat(markers: dict[str, Any]) -> None:
    """Rewrite the legacy shapes the markup script still loads into the current format."""
    if "markerPairs" not in markers and "markers" in markers:
        markers["markerPairs"] = markers.pop("markers")
    for pair in markers.get("markerPairs") or []:
        if isinstance(pair, dict) and isinstance(pair.get("speed"), str):
            # A non-numeric speed stays a string, which validation then reports.
            with suppress(ValueError):
                pair["speed"] = float(pair["speed"])


def validateMarkers(markers: dict[str, Any]) -> MarkersValidation:
    """Drop keys the schema does not know (in place), then report what is invalid."""
    validator = markersValidator()
    droppedKeys = dropUnknownKeys(validator, markers)

    droppedInvalidSettings: list[str] = []
    globalErrors: list[str] = []
    pairErrors: dict[int, list[str]] = {}
    for error in list(validator.iter_errors(markers)):
        path = list(error.absolute_path)
        message = f"{formatPath(path)}: {describeError(error)}"
        if path and path[0] in MARKUP_ONLY_SETTINGS:
            markers.pop(path[0], None)
            droppedInvalidSettings.append(message)
        elif len(path) >= 2 and path[0] == "markerPairs" and isinstance(path[1], int):
            pairErrors.setdefault(path[1], []).append(message)
        else:
            globalErrors.append(message)
    return MarkersValidation(
        droppedKeys=droppedKeys,
        droppedInvalidSettings=droppedInvalidSettings,
        globalErrors=globalErrors,
        pairErrors=pairErrors,
    )


def dropUnknownKeys(validator: Draft202012Validator, markers: dict[str, Any]) -> list[str]:
    dropped: list[str] = []
    for error in list(validator.iter_errors(markers)):
        if error.validator != "additionalProperties" or not isinstance(error.schema, Mapping):
            continue
        unknown = set(error.instance) - set(error.schema.get("properties", {}))
        for key in sorted(unknown):
            del error.instance[key]
            dropped.append(formatPath([*error.absolute_path, key]))
    return dropped


def describeError(error: ValidationError) -> str:
    # A pattern means nothing to a user, so say what the value should look like instead.
    schema = error.schema
    if error.validator == "pattern" and isinstance(schema, Mapping) and "description" in schema:
        return f"{error.instance!r} should be {schema['description']}"
    return error.message


def formatPath(path: Sequence[Any]) -> str:
    formatted = ""
    for part in path:
        formatted += f"[{part}]" if isinstance(part, int) else f".{part}"
    return formatted.removeprefix(".") or "(top level)"
