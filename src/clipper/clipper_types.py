import enum
import io
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Dict, List, Union

UNKNOWN_PROPERTY = "unknown"

DictStrAny = Dict[str, Any]
ExtendedRealNumber = Union[int, float, Fraction]
SpeedMap = List[DictStrAny]
CropMap = List[DictStrAny]
Settings = Dict[str, Any]


@dataclass()
class ClipperPaths:
    """Paths to executables and input/output directories."""

    ffmpegPath: str = "ffmpeg"
    ffprobePath: str = "ffprobe"
    ffplayPath: str = "ffplay"
    clipsPath: str = "./webms"
    tempPath: str = "./temp"
    logFilePath: str = ""


@dataclass(frozen=True)
class ClipperState:
    """Central state for yt_clipper functions."""

    settings: Settings = field(default_factory=dict)
    clipper_paths: ClipperPaths = ClipperPaths()
    reportStream = io.StringIO()
    reportStreamColored = io.StringIO()


class MissingMergeInput(Exception):
    pass


class BadMergeInput(Exception):
    pass


class MissingMarkerPairFilePath(Exception):
    pass


class KnownPlatform(enum.Enum):
    youtube = "youtube"
    vlive = "vlive"
