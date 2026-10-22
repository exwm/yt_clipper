"""Telling the user when their markup or clipper script is out of date."""

import json
import re
import ssl
import sys
import urllib.request
from collections.abc import Callable
from pathlib import Path

import certifi
from rich.markup import escape

from clipper.log_helpers import LogPath
from clipper.settings_file import decodeSettingsFile
from clipper.version import __version__
from clipper.ytc_logger import Subsystem, make_subsystem_logger

logger = make_subsystem_logger(Subsystem.SETTINGS)

RELEASES_URL = "https://github.com/exwm/yt_clipper/releases/latest"
LATEST_RELEASE_API = "https://api.github.com/repos/exwm/yt_clipper/releases/latest"
# Read by every install in the folder that holds the install folders, so settings carry over.
SHARED_ARGS_FILE = "yt_clipper_default_args.txt"


def installsFolder(installDir: Path) -> Path:
    """The folder that holds the install folders. Windows' Extract All puts the zip's own top folder
    inside a folder of the same name, so such an install sits one folder deeper."""
    parent = installDir.parent
    return parent.parent if parent.name == installDir.name else parent


def installArgsFile(folder: Path) -> Path:
    """An install folder's default_args.txt, also when Extract All nested the install one deeper."""
    nested = folder / folder.name / "default_args.txt"
    return nested if nested.exists() else folder / "default_args.txt"


def hasActiveArgs(argsFile: Path) -> bool:
    try:
        raw = argsFile.read_bytes()
    except OSError:
        return False
    text, _fallbackEncoding = decodeSettingsFile(raw)
    return any(line.strip() and not line.strip().startswith("#") for line in text.splitlines())


def showStartupNotices() -> None:
    """Notices about updating, shown once the logger is set up. Only frozen releases show them:
    other installs update another way (pipx, git)."""
    if not getattr(sys, "frozen", False):
        return
    noticeSettingsLeftInOtherInstalls(Path(sys.executable).resolve().parent)


def fetchLatestReleaseVersion() -> str:
    request = urllib.request.Request(
        LATEST_RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "yt_clipper"},
    )
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(request, timeout=3, context=context) as response:
        return json.load(response)["tag_name"]


def checkForUpdates(fetchLatest: Callable[[], str] = fetchLatestReleaseVersion) -> str:
    """What `--check-for-updates` prints: whether GitHub has a newer release than this one."""
    try:
        latest = fetchLatest()
    except Exception as error:
        # A URLError keeps the useful message in its reason.
        return f"Could not check for updates: {getattr(error, 'reason', error)}. See {RELEASES_URL}"
    newest, current = parseVersion(latest), parseVersion(__version__)
    if newest is None or current is None:
        return f"Could not read the latest version ({latest!r}). See {RELEASES_URL}"
    if newest > current:
        return f"yt_clipper {latest.lstrip('v')} is available (this is {__version__}). Download it from {RELEASES_URL}"
    return f"No newer version than yt_clipper {__version__} is out."


def noticeSettingsLeftInOtherInstalls(installDir: Path) -> None:
    """A new version unzips to a new folder, so an older install's default_args.txt (e.g. its
    cookies) no longer applies. Point the user to the shared file every version reads."""
    holder = installsFolder(installDir)
    shared = holder / SHARED_ARGS_FILE
    if shared.exists() or hasActiveArgs(installDir / "default_args.txt"):
        return
    others = [
        folder
        for folder in holder.glob("yt_clipper_*")
        if folder.is_dir()
        and installDir not in (folder, folder / folder.name)
        and hasActiveArgs(installArgsFile(folder))
    ]
    if not others:
        return
    newest = max(others, key=lambda folder: installArgsFile(folder).stat().st_mtime)
    logger.notice(
        f"{escape(newest.name)} has settings in its default_args.txt that this install does not "
        f"use. Move them to {LogPath(shared)} so every version uses them.",
    )


def parseVersion(version: object) -> tuple[int, int, int] | None:
    """The (major, minor, patch) of a version string such as "5.49.0" or "5.31.0+c42ee43"."""
    match = re.match(r"^\s*v?(\d+)\.(\d+)\.(\d+)", version) if isinstance(version, str) else None
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def warnIfMarkersNewerThanClipper(markersVersion: object) -> None:
    """A newer markup script may save settings this clipper does not know, which it then skips."""
    markup = parseVersion(markersVersion)
    clipper = parseVersion(__version__)
    if markup is None or clipper is None or markup <= clipper:
        return
    logger.warning(
        f"This markers JSON was saved by markup script {escape(str(markersVersion))}, "
        f"which is newer than this clipper script ({__version__}). "
        "Settings this clipper does not know are skipped. "
        f"Download the latest clipper script: {RELEASES_URL}",
    )
